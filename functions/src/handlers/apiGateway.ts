/**
 * Public API gateway — the *consumption* endpoint for the partner API keys minted
 * by the API Platform admin console (functions/src/handlers/apiPlatform.ts).
 *
 * The admin console could already create applications + scoped, hashed keys, but
 * nothing consumed them: `api_usage_logs` was read-only and `last_used_at` never
 * moved. This closes the loop. An external partner calls:
 *
 *   curl -H "Authorization: Bearer cc_live_xxx" https://<host>/publicApi/v1/jobs
 *
 * Per request the gateway: authenticates the Bearer secret by SHA-256 hash
 * (matching apiPlatform.ts `secretHash`), enforces the key's scope + per-minute
 * rate limit + monthly quota, runs the endpoint, then records usage
 * (`api_usage_logs` entry + `last_used_at`). Partner AI traffic routes through the
 * same `resolveProvider()` as first-party traffic (contract req #6), so tiering
 * and key pooling apply. No raw secret is ever stored or logged — only the prefix.
 *
 * Endpoints:
 *   GET  /v1/jobs            scope `jobs.read`      active job postings (no AI)
 *   POST /v1/resume/analyze  scope `resume.analyze` resume analysis via the LLM router
 */
import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createHash } from "crypto";
import { resolveProvider } from "../llm/models";
import { buildPrompt } from "../llm/prompts";
import { ANALYSIS_SCHEMA } from "./analyzeResume";
import { COVER_LETTER_SCHEMA } from "./generateCoverLetter";
import { ensurePlatformCaches } from "../config/env";
import {
  candidateAnalysisLanguageProtocol,
  coverLetterLanguageProtocol,
} from "../llm/languageProtocol";
import { requireStructuredResult } from "../llm/structuredResult";
import { correctiveInstruction, coverLetterDraftIssues } from "../llm/draftQuality";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const API_KEYS = "api_keys";
const API_USAGE_LOGS = "api_usage_logs";
const API_KEY_USAGE = "api_key_usage";
const API_USAGE_LOG_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;

/** Mirrors apiPlatform.ts `secretHash` — keys are stored only as this hash. */
function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isoOrNull(value: unknown): string | null {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  return typeof value === "string" ? value : null;
}

/** HTTP-shaped error so the router can map a thrown failure to a status + code. */
class GatewayError extends Error {
  statusCode: number;
  code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}
const fail = (statusCode: number, code: string, message: string) =>
  new GatewayError(statusCode, code, message);

interface AuthedKey {
  id: string;
  app_id: string;
  prefix: string;
  scopes: string[];
  status: string;
  rate_limit_per_min: number;
  monthly_quota: number;
  created_by: string;
  environment: string;
}

/** Resolve the Bearer secret to an active key, or throw 401/403. */
async function authenticate(authHeader: string): Promise<AuthedKey> {
  const match = /^Bearer\s+(.+)$/i.exec((authHeader || "").trim());
  if (!match) {
    throw fail(401, "missing_authorization", "Provide 'Authorization: Bearer <api_key>'.");
  }
  const secret = match[1].trim();
  const snap = await db.collection(API_KEYS).where("secret_hash", "==", sha256(secret)).limit(1).get();
  if (snap.empty) {
    throw fail(401, "invalid_key", "API key not recognized.");
  }
  const doc = snap.docs[0];
  const d = doc.data();
  if (d.status !== "active") {
    throw fail(403, "key_inactive", `This API key is ${d.status}.`);
  }
  return {
    id: doc.id,
    app_id: String(d.app_id ?? ""),
    prefix: String(d.prefix ?? ""),
    scopes: Array.isArray(d.scopes) ? (d.scopes as string[]) : [],
    status: String(d.status),
    rate_limit_per_min: Number(d.rate_limit_per_min ?? 60),
    monthly_quota: Number(d.monthly_quota ?? 10000),
    created_by: String(d.created_by ?? ""),
    environment: String(d.environment ?? "development"),
  };
}

function requireScope(key: AuthedKey, scope: string): void {
  if (!key.scopes.includes(scope)) {
    throw fail(403, "insufficient_scope", `This key is missing the required '${scope}' scope.`);
  }
}

/**
 * Atomically enforce + increment the per-minute rate limit and monthly quota.
 * Counters live in `api_key_usage/{keyId}` (separate from the key doc so auth
 * reads don't contend with usage writes). Window keys are derived from the clock,
 * so a new minute/month resets the relevant counter without a cleanup job.
 */
async function meterUsage(key: AuthedKey): Promise<void> {
  const now = new Date();
  const minuteKey = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
  const monthKey = now.toISOString().slice(0, 7); // YYYY-MM
  const ref = db.collection(API_KEY_USAGE).doc(key.id);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const u = snap.exists ? snap.data() ?? {} : {};
    const minuteCount = u.minute_key === minuteKey ? Number(u.minute_count ?? 0) : 0;
    const monthCount = u.month_key === monthKey ? Number(u.month_count ?? 0) : 0;
    if (minuteCount >= key.rate_limit_per_min) {
      throw fail(429, "rate_limited", `Rate limit of ${key.rate_limit_per_min} requests/minute exceeded.`);
    }
    if (monthCount >= key.monthly_quota) {
      throw fail(429, "quota_exceeded", `Monthly quota of ${key.monthly_quota} requests exceeded.`);
    }
    tx.set(
      ref,
      {
        minute_key: minuteKey,
        minute_count: minuteCount + 1,
        month_key: monthKey,
        month_count: monthCount + 1,
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });
}

/** Append an immutable usage entry + advance last_used_at. Key prefix only — never the secret. */
async function recordUsage(key: AuthedKey, endpoint: string, status: number, latencyMs: number): Promise<void> {
  const batch = db.batch();
  batch.set(db.collection(API_USAGE_LOGS).doc(), {
    timestamp: FieldValue.serverTimestamp(),
    // Firestore TTL is enabled for this field in firestore.indexes.json.
    expires_at: Timestamp.fromMillis(Date.now() + API_USAGE_LOG_RETENTION_MS),
    key_prefix: key.prefix,
    key_id: key.id,
    app_id: key.app_id,
    endpoint,
    status,
    latency_ms: latencyMs,
  });
  batch.update(db.collection(API_KEYS).doc(key.id), { last_used_at: FieldValue.serverTimestamp() });
  await batch.commit();
}

// ── Endpoints ──────────────────────────────────────────────────────────────

/** GET /v1/jobs — active job postings. Public-safe fields only; no AI, no auth user. */
async function handleListJobs(key: AuthedKey): Promise<unknown> {
  requireScope(key, "jobs.read");
  const snap = await db
    .collection("job_postings")
    .where("is_active", "==", true)
    .orderBy("created_at", "desc")
    .limit(50)
    .get();
  const jobs = snap.docs
    .map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        title: String(d.title ?? ""),
        company_name: d.company_name ?? null,
        location: d.location ?? null,
        work_mode: d.work_mode ?? null,
        employment_type: d.employment_type ?? null,
        salary_range: d.salary_range ?? null,
        created_at: isoOrNull(d.created_at),
      };
    });
  return { jobs, count: jobs.length };
}

/** POST /v1/resume/analyze — structured resume analysis through the LLM router. */
async function handleResumeAnalyze(key: AuthedKey, body: unknown): Promise<unknown> {
  requireScope(key, "resume.analyze");
  const payload = (body ?? {}) as Record<string, unknown>;
  const resumeText = typeof payload.resume_text === "string" ? payload.resume_text.trim() : "";
  const marketName =
    typeof payload.market === "string" && payload.market.trim() ? payload.market.trim() : "Canadian";
  if (!resumeText) {
    throw fail(400, "invalid_request", "Request body must include a non-empty 'resume_text'.");
  }
  if (resumeText.length > 50000) {
    throw fail(400, "invalid_request", "'resume_text' exceeds the 50000 character limit.");
  }
  await ensurePlatformCaches();
  const outputLanguage = typeof payload.language === "string" ? payload.language : undefined;
  const prompt = `${buildPrompt("handler_resume_analysis", {
    marketName,
    outputLanguageInstruction: candidateAnalysisLanguageProtocol({ outputLanguage, marketName }),
  })}\n\nResume:\n${resumeText}`;
  // Partner traffic routes via the owning admin's tier so pooling/tiering apply
  // (contract req #6); the gateway never reads provider keys directly.
  let provider;
  try {
    provider = await resolveProvider(key.created_by, undefined, "apiResumeAnalyze");
    const generationStartedAt = Date.now();
    const result = await provider.generate({
      prompt,
      responseSchema: ANALYSIS_SCHEMA,
      maxOutputTokens: 4_096,
      thinkingLevel: "low",
      timeoutMs: 45_000,
    });
    return {
      analysis: requireStructuredResult(
        "apiResumeAnalyze",
        result,
        ANALYSIS_SCHEMA,
        generationStartedAt
      ),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/is not set|api_key/i.test(message)) {
      throw fail(503, "ai_unavailable", "AI provider is not configured. Try again later.");
    }
    throw fail(502, "ai_error", "The analysis provider failed. Please retry.");
  }
}

/** POST /v1/cover-letter — tailored cover letter from a resume + job description. */
async function handleCoverLetter(key: AuthedKey, body: unknown): Promise<unknown> {
  requireScope(key, "tools.generate");
  const payload = (body ?? {}) as Record<string, unknown>;
  const resumeText = typeof payload.resume_text === "string" ? payload.resume_text.trim() : "";
  const jobDescription = typeof payload.job_description === "string" ? payload.job_description.trim() : "";
  const marketName =
    typeof payload.market === "string" && payload.market.trim() ? payload.market.trim() : "Canadian";
  if (!resumeText || !jobDescription) {
    throw fail(400, "invalid_request", "Request body must include 'resume_text' and 'job_description'.");
  }
  if (resumeText.length > 50000 || jobDescription.length > 50000) {
    throw fail(400, "invalid_request", "'resume_text'/'job_description' exceed the 50000 character limit.");
  }
  await ensurePlatformCaches();
  const outputLanguage = typeof payload.language === "string" ? payload.language : undefined;
  const prompt = buildPrompt("handler_cover_letter", {
    marketName,
    resumeText,
    jobDescription,
    outputLanguageInstruction: coverLetterLanguageProtocol({ outputLanguage, marketName }),
  });
  try {
    const provider = await resolveProvider(key.created_by, undefined, "apiCoverLetter");
    const generationStartedAt = Date.now();
    let result = await provider.generate({
      prompt,
      responseSchema: COVER_LETTER_SCHEMA,
      maxOutputTokens: 2_048,
      thinkingLevel: "low",
      timeoutMs: 45_000,
    });
    let parsed = requireStructuredResult<{ letter: string }>(
      "apiCoverLetter",
      result,
      COVER_LETTER_SCHEMA,
      generationStartedAt
    );
    const issues = coverLetterDraftIssues(parsed.letter);
    if (issues.length > 0 && Date.now() - generationStartedAt < 25_000) {
      const retry = await provider.generate({
        prompt: `${prompt}\n\n${correctiveInstruction(issues)}`,
        responseSchema: COVER_LETTER_SCHEMA,
        maxOutputTokens: 2_048,
        thinkingLevel: "minimal",
        timeoutMs: 15_000,
      });
      const retryParsed = requireStructuredResult<{ letter: string }>(
        "apiCoverLetter.repair",
        retry,
        COVER_LETTER_SCHEMA,
        Date.now()
      );
      if (coverLetterDraftIssues(retryParsed.letter).length < issues.length) {
        result = retry;
        parsed = retryParsed;
      }
    }
    if (coverLetterDraftIssues(parsed.letter).length > 0) {
      throw new Error("Cover letter draft did not pass quality review.");
    }
    return { cover_letter: parsed };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/is not set|api_key/i.test(message)) {
      throw fail(503, "ai_unavailable", "AI provider is not configured. Try again later.");
    }
    throw fail(502, "ai_error", "The generation provider failed. Please retry.");
  }
}

/** GET /v1/usage — the calling key's own rate-limit/quota status + recent calls. */
async function handleUsage(key: AuthedKey): Promise<unknown> {
  requireScope(key, "usage.read");
  const now = new Date();
  const minuteKey = now.toISOString().slice(0, 16);
  const monthKey = now.toISOString().slice(0, 7);
  const counterSnap = await db.collection(API_KEY_USAGE).doc(key.id).get();
  const c = counterSnap.exists ? counterSnap.data() ?? {} : {};
  // Fetch the actual newest rows at the database boundary. Reading an arbitrary
  // 100 rows and sorting them in memory silently dropped newer calls at scale.
  const logsSnap = await db.collection(API_USAGE_LOGS)
    .where("key_id", "==", key.id)
    .orderBy("timestamp", "desc")
    .limit(20)
    .get();
  const recent = logsSnap.docs
    .map((doc) => {
      const d = doc.data();
      return {
        timestamp: isoOrNull(d.timestamp),
        endpoint: String(d.endpoint ?? ""),
        status: Number(d.status ?? 0),
        latency_ms: Number(d.latency_ms ?? 0),
      };
    });
  return {
    rate_limit_per_min: key.rate_limit_per_min,
    monthly_quota: key.monthly_quota,
    minute_used: c.minute_key === minuteKey ? Number(c.minute_count ?? 0) : 0,
    month_used: c.month_key === monthKey ? Number(c.month_count ?? 0) : 0,
    recent,
  };
}

function endpointLabel(method: string, path: string): string {
  return `${method} ${path}`;
}

export const publicApiFunction = onRequest({ invoker: "public", cors: false }, async (req, res) => {
  const startedAt = Date.now();
  // Strip the function mount prefix and trailing slashes so routing is host-agnostic
  // (works behind both /publicApi/... and a rewrite at /api/...).
  const path = req.path.replace(/^\/+/, "/").replace(/\/+$/, "") || "/";
  const label = endpointLabel(req.method, path);
  let key: AuthedKey | null = null;
  try {
    key = await authenticate(req.get("authorization") ?? "");
    await meterUsage(key);

    let result: unknown;
    if (req.method === "GET" && /\/v1\/jobs$/.test(path)) {
      result = await handleListJobs(key);
    } else if (req.method === "POST" && /\/v1\/resume\/analyze$/.test(path)) {
      result = await handleResumeAnalyze(key, req.body);
    } else if (req.method === "POST" && /\/v1\/cover-letter$/.test(path)) {
      result = await handleCoverLetter(key, req.body);
    } else if (req.method === "GET" && /\/v1\/usage$/.test(path)) {
      result = await handleUsage(key);
    } else {
      throw fail(404, "not_found", `No endpoint matches ${req.method} ${path}.`);
    }

    res.status(200).json({ ok: true, data: result });
    try {
      await recordUsage(key, label, 200, Date.now() - startedAt);
    } catch (logError) {
      console.warn("Public API success logging failed", logError);
    }
  } catch (err) {
    const statusCode = err instanceof GatewayError ? err.statusCode : 500;
    const code = err instanceof GatewayError ? err.code : "internal_error";
    const message = err instanceof GatewayError ? err.message : "An internal error occurred.";
    // Log usage even on failure (only once a key is authenticated) so partners can
    // see their error rate; pre-auth failures aren't attributable to a key.
    if (key) {
      try {
        await recordUsage(key, label, statusCode, Date.now() - startedAt);
      } catch {
        /* logging must never mask the original error */
      }
    }
    res.status(statusCode).json({ ok: false, error: { code, message } });
  }
});
