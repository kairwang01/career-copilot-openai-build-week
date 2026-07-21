/**
 * discoverTalent — server-side employer talent search.
 *
 * WHY THIS EXISTS: firestore.rules deliberately block clients from reading other
 * users' profiles (owner-only reads protect resume_text PII). The old client-side
 * flow (listCandidateProfilesWithResume → per-candidate aiProxy match) therefore
 * died with "Missing or insufficient permissions" — and would have shipped every
 * candidate's full resume to the employer's browser if it hadn't.
 *
 * This callable reads only profiles whose owner explicitly enabled discovery,
 * builds a de-identified skills context (never resume text/contact/exact orgs),
 * runs matching on the server, and returns safe signals. A separate per-employer
 * candidate consent is required before any contact packet is released.
 *
 * Modes:
 *   { }                          → verified rail: nft_staked candidates, no AI run
 *   { jobDescription: string, requestId?: string }
 *                                 → match: scores up to MATCH_CANDIDATE_CAP candidates
 *
 * Cost: analyzeCandidateMatch is a free helper (creditKey null) — consistent with
 * the previous client-side behaviour. The cap bounds provider spend per search.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAuth } from "../middleware/auth";
import { recordObservedToolRun } from "../admin/usageLog";
import { claimFreeToolRun } from "../credits/deductCredits";
import { resolveProvider } from "../llm/models";
import { ensurePlatformCaches } from "../config/env";
import { TOOL_REGISTRY } from "../llm/toolRegistry";
import {
  normalizeTalentProfile,
  redactTalentDiscoveryText,
  talentProfileToDiscoveryContext,
} from "../utils/talentProfile";
import { mapSettledWithConcurrency } from "../utils/asyncPool";
import { getWeb3ConfigImpl } from "./web3Config";
import { validateAgainstSchema } from "../llm/schemaValidation";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const MAX_JD_CHARS = 20_000;
/** Hard per-search cap — each matched candidate is one LLM call. */
const MATCH_CANDIDATE_CAP = 8;
const MATCH_CONCURRENCY = 3;
const MATCH_TIMEOUT_MS = 12_000;
const VERIFIED_LIST_CAP = 10;
const CANDIDATE_SCAN_LIMIT = 60;
const MIN_CONTEXT_CHARS = 80;

interface SafeCandidateMatch {
  id: string;
  nft_staked: boolean;
  compatibilityScore: number;
  summary: string;
  strengths: string[];
  potentialGaps: string[];
  suggestedQuestions: string[];
}

interface CandidateRow {
  id: string;
  candidate_text: string;
  sensitive_terms: string[];
  nft_staked: boolean;
}

/** Mirrors aiProxy's lenient JSON parsing (markdown fences, trailing commas). */
function tryParseJson(str: string): unknown {
  let s = str.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    try {
      return JSON.parse(s.replace(/,(\s*[\]}])/g, "$1"));
    } catch {
      return undefined;
    }
  }
}

function toSafe(c: CandidateRow, parsed: {
  score?: number;
  summary?: string;
  strengths?: unknown;
  potentialGaps?: unknown;
  suggestedQuestions?: unknown;
}): SafeCandidateMatch {
  const clean = (value: string, max: number): string =>
    redactTalentDiscoveryText(value, c.sensitive_terms).slice(0, max);
  const strArr = (v: unknown): string[] =>
    Array.isArray(v)
      ? v
        .filter((x): x is string => typeof x === "string")
        .map((value) => clean(value, 500))
        .filter(Boolean)
        .slice(0, 10)
      : [];
  return {
    id: c.id,
    nft_staked: c.nft_staked,
    compatibilityScore: typeof parsed.score === "number" ? Math.max(0, Math.min(100, Math.round(parsed.score))) : 0,
    summary: typeof parsed.summary === "string" ? clean(parsed.summary, 2000) : "",
    strengths: strArr(parsed.strengths),
    potentialGaps: strArr(parsed.potentialGaps),
    suggestedQuestions: strArr(parsed.suggestedQuestions),
  };
}

export async function discoverTalentImpl(uid: string, data: Record<string, unknown> = {}) {
  // Business-only gate: this endpoint reads candidate resumes server-side, so it
  // must never be callable by candidate accounts.
  const meSnap = await db.collection("users").doc(uid).get();
  const role = meSnap.exists ? (meSnap.data()?.role as string | undefined) : undefined;
  if (role !== "employer" && role !== "agency") {
    throw new HttpsError("permission-denied", "Talent discovery is available to business accounts only.");
  }

  const raw = (data ?? {}) as { jobDescription?: unknown; requestId?: unknown };
  const jobDescription = typeof raw.jobDescription === "string" ? raw.jobDescription.trim() : "";
  if (jobDescription.length > MAX_JD_CHARS) {
    throw new HttpsError("invalid-argument", `jobDescription must be ≤ ${MAX_JD_CHARS} characters.`);
  }
  if (raw.requestId !== undefined && typeof raw.requestId !== "string") {
    throw new HttpsError("invalid-argument", "requestId must be a string.");
  }
  // Optional for compatibility with deployed clients that predate request ids.
  // New callers should reuse one requestId for retries of the same search.
  if (jobDescription) {
    await claimFreeToolRun(uid, "discover-talent-match", {
      requestId: raw.requestId as string | undefined,
    });
  }

  // Observability only — uncharged tool, never capped (see recordObservedToolRun).
  void recordObservedToolRun(uid, "discover-talent");

  // The admin Web3 switch is the product contract: when disabled, the product
  // must not surface verified/staked talent signals from persisted nft_* fields.
  const web3Enabled = (await getWeb3ConfigImpl()).enabled;

  // Discovery is explicit and reversible. Profiles without discoverable=true
  // are never read into the matching pool; the default/missing value is false.
  const profileQuery = await db
    .collection("talent_profiles")
    .where("discoverable", "==", true)
    .limit(CANDIDATE_SCAN_LIMIT)
    .get();

  const profileDocs = profileQuery.docs;
  const userSnaps = profileDocs.length
    ? await db.getAll(...profileDocs.map((profileDoc) => db.collection("users").doc(profileDoc.id)))
    : [];
  const withContext: CandidateRow[] = profileDocs
    .map((profileDoc, i) => {
      const userSnap = userSnaps[i];
      const user = userSnap?.exists ? userSnap.data() ?? {} : {};
      if (user.role !== "candidate") return null;
      const context = talentProfileToDiscoveryContext(normalizeTalentProfile(profileDoc.data()));
      return {
        id: profileDoc.id,
        candidate_text: context.text,
        sensitive_terms: context.sensitiveTerms,
        nft_staked: web3Enabled && user.nft_staked === true,
      };
    })
    .filter((candidate): candidate is CandidateRow =>
      candidate !== null && candidate.candidate_text.trim().length >= MIN_CONTEXT_CHARS);

  // Verified-rail listing: no AI, no resume content leaves the server.
  if (!jobDescription) {
    const verified = withContext
      .filter((c) => c.nft_staked)
      .slice(0, VERIFIED_LIST_CAP)
      .map((c) => toSafe(c, {}));
    return { candidates: verified, eligible: withContext.length };
  }

  // Match mode — one LLM call per candidate, hard-capped.
  await ensurePlatformCaches();
  // The request claim above counts this search once before any candidate scan or
  // model fan-out. recordObservedToolRun remains volume-only and never caps.
  const spec = TOOL_REGISTRY["analyzeCandidateMatch"];
  if (!spec) {
    throw new HttpsError("internal", "analyzeCandidateMatch is not registered.");
  }
  const provider = await resolveProvider(uid, undefined, "discoverTalent");

  const pool = withContext.slice(0, MATCH_CANDIDATE_CAP);
  const settled = await mapSettledWithConcurrency(
    pool,
    MATCH_CONCURRENCY,
    async (c) => {
      const llmRequest = spec.build({ resumeText: c.candidate_text, jobDescription });
      llmRequest.timeoutMs = MATCH_TIMEOUT_MS;
      llmRequest.maxOutputTokens = Math.min(llmRequest.maxOutputTokens ?? 1_200, 1_200);
      llmRequest.thinkingLevel = "low";
      const result = await provider.generate(llmRequest);
      const parsed = (result.raw !== undefined ? result.raw : tryParseJson(result.text)) as
        | Record<string, unknown>
        | undefined;
      if (!parsed || !llmRequest.responseSchema ||
          validateAgainstSchema(parsed, llmRequest.responseSchema).length > 0) {
        throw new Error(`unparseable match result for candidate ${c.id}`);
      }
      return toSafe(c, parsed as Parameters<typeof toSafe>[1]);
    },
  );

  const candidates = settled
    .filter((s): s is PromiseFulfilledResult<SafeCandidateMatch> => s.status === "fulfilled")
    .map((s) => s.value)
    .sort((a, b) => b.compatibilityScore - a.compatibilityScore);

  const failures = settled.length - candidates.length;
  if (failures > 0) {
    console.warn(`discoverTalent: ${failures}/${settled.length} candidate matches failed`);
  }

  return {
    candidates,
    scanned: pool.length,
    eligible: withContext.length,
    failures,
    analysisStatus: failures > 0 ? "partial" : "complete",
  };
}

export const discoverTalentFunction = onCall({ invoker: "public" }, async (request) => {
  const uid = requireAuth(request);
  return discoverTalentImpl(uid, request.data ?? {});
});
