/**
 * listJobApplicants — server-side applicant funnel for a single job posting.
 *
 * WHY THIS EXISTS: firestore.rules deliberately block clients from reading other
 * users' profiles (owner-only reads protect resume_text PII). The old
 * ApplicantFunnel flow (getCandidateProfilesByIds → per-applicant client-side
 * analyzeCandidateMatch) therefore died with "Missing or insufficient
 * permissions" — and would have shipped each applicant's full resume to the
 * employer's browser if it hadn't.
 *
 * This callable keeps resumes server-side: it verifies the caller owns the job,
 * reads applications + candidate resumes with the Admin SDK, runs the
 * analyzeCandidateMatch prompt per applicant ON THE SERVER, and returns only
 * SAFE match data (no resume_text, no email, no contact info).
 *
 * Viewing your own applicants is FREE — applicants opted in by applying. The
 * wallet-unlock paywall (UnlockTalentModal) is for proactive talent discovery
 * (strangers), not for people who chose to apply to you. This mirrors
 * discoverTalent.ts's security model but for the inbound-applicant path.
 *
 * Cost note: each applicant with a resume is one LLM call. MATCH_CANDIDATE_CAP
 * bounds provider spend per request; applicants beyond the cap (or without a
 * resume) still appear in the list with score 0 and no analysis.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { requireAuth } from "../middleware/auth";
import { recordObservedToolRun } from "../admin/usageLog";
import { resolveProvider } from "../llm/models";
import { ensurePlatformCaches } from "../config/env";
import { TOOL_REGISTRY } from "../llm/toolRegistry";
import {
  buildCandidateMatchContext,
  normalizeTalentProfile,
  talentProfileToMatchText,
  type TalentProfileSnapshot,
} from "../utils/talentProfile";
import { mapSettledWithConcurrency } from "../utils/asyncPool";
import { claimFreeToolRun } from "../credits/deductCredits";
import { validateAgainstSchema } from "../llm/schemaValidation";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/** Hard per-request cap — each analyzed applicant is one LLM call. */
const MATCH_CANDIDATE_CAP = 12;
const MATCH_CONCURRENCY = 3;
const MATCH_TIMEOUT_MS = 12_000;

interface ScreenerAnswer {
  question_id: string;
  prompt: string;
  answer: string;
}

interface SafeApplicant {
  id: string;
  candidate_name: string;
  application_date: string | null;
  status: string;
  compatibility_score: number | null;
  summary: string;
  strengths: string[];
  potentialGaps: string[];
  suggestedQuestions: string[];
  analysis_status: "complete" | "failed" | "not_requested" | "no_context" | "not_analyzed_cap";
  talent_profile: TalentProfileSnapshot | null;
  status_history: StatusHistoryEvent[];
  screener_answers: ScreenerAnswer[];
}

interface ApplicationRow {
  application_id: string;
  candidate_id: string;
  candidate_name: string;
  application_date: string | null;
  status: string;
  screener_answers: ScreenerAnswer[];
}

interface StatusHistoryEvent {
  id: string;
  action: string | null;
  from_status: string;
  to_status: string;
  reason: string | null;
  candidate_note: string | null;
  skipped_statuses: string[];
  created_at: string | null;
}

function withoutContactInfo(profile: TalentProfileSnapshot | null): TalentProfileSnapshot | null {
  if (!profile) return null;
  return {
    ...profile,
    basic: profile.basic
      ? { ...profile.basic, email: "", phone: "" }
      : profile.basic,
  };
}

/** Mirrors aiProxy/discoverTalent lenient JSON parsing (markdown fences, trailing commas). */
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

function isoFromTimestamp(value: unknown): string | null {
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as Timestamp).toDate().toISOString();
  }
  return null;
}

function emptyApplicant(
  a: ApplicationRow,
  talentProfile: TalentProfileSnapshot | null,
  statusHistory: StatusHistoryEvent[],
  analysisStatus: SafeApplicant["analysis_status"] = "not_requested",
): SafeApplicant {
  return {
    id: a.application_id,
    candidate_name: a.candidate_name,
    application_date: a.application_date,
    status: a.status,
    compatibility_score: null,
    summary: "",
    strengths: [],
    potentialGaps: [],
    suggestedQuestions: [],
    analysis_status: analysisStatus,
    talent_profile: withoutContactInfo(talentProfile),
    status_history: statusHistory,
    screener_answers: a.screener_answers,
  };
}

export const listJobApplicantsFunction = onCall(
  { invoker: "public", timeoutSeconds: 90 },
  async (request) => {
  const uid = requireAuth(request);

  const raw = (request.data ?? {}) as { jobId?: unknown; includeAnalysis?: unknown; requestId?: unknown };
  const jobId = typeof raw.jobId === "string" ? raw.jobId.trim() : "";
  const includeAnalysis = raw.includeAnalysis !== false;
  if (!jobId) {
    throw new HttpsError("invalid-argument", "jobId is required.");
  }

  // 1. Verify the caller owns this job posting (authorization). employer_id is
  //    read from the authoritative job_postings doc — never trusted from input.
  const jobSnap = await db.collection("job_postings").doc(jobId).get();
  if (!jobSnap.exists) {
    throw new HttpsError("not-found", "Job posting not found.");
  }
  const job = jobSnap.data()!;
  if (job.employer_id !== uid) {
    throw new HttpsError("permission-denied", "You do not own this job posting.");
  }

  // Observability only — uncharged tool, never capped (see recordObservedToolRun).
  void recordObservedToolRun(uid, "list-job-applicants");

  const jobDescription = typeof job.description === "string" ? job.description.trim() : "";

  // 2. Read applications for this job (Admin SDK). Name/date/status live on the
  //    application doc, so the candidate user doc is only needed for resume_text.
  // Pathological-load cap, not pagination: far above realistic single-posting
  // volume, it stops a runaway posting from paging the whole collection into
  // memory. Note: beyond the cap Firestore truncates in doc-id order, so a
  // posting that ever exceeds it needs real pagination (tracked separately).
  const APPLICANTS_READ_CAP = 500;
  const appsSnap = await db
    .collection("job_applications")
    .where("job_id", "==", jobId)
    .where("employer_id", "==", uid)
    .limit(APPLICANTS_READ_CAP + 1)
    .get();

  if (appsSnap.empty) {
    return {
      applicants: [] as SafeApplicant[],
      applicants_truncated: false,
      status_history_truncated: false,
    };
  }

  const applicantsTruncated = appsSnap.size > APPLICANTS_READ_CAP;
  const applications: ApplicationRow[] = appsSnap.docs
    .slice(0, APPLICANTS_READ_CAP)
    .map((d) => {
      const data = d.data();
      return {
        application_id: d.id,
        candidate_id: typeof data.candidate_id === "string" ? data.candidate_id : "",
        candidate_name: typeof data.candidate_name === "string" ? data.candidate_name : "Candidate",
        application_date: isoFromTimestamp(data.application_date),
        status: typeof data.status === "string" ? data.status : "Applied",
        screener_answers: Array.isArray(data.screener_answers) ? (data.screener_answers as ScreenerAnswer[]) : [],
      };
    })
    .filter((a) => a.candidate_id);

  // First application per candidate for this job (one expected).
  const appByCandidate = new Map<string, ApplicationRow>();
  for (const a of applications) if (!appByCandidate.has(a.candidate_id)) appByCandidate.set(a.candidate_id, a);
  const appIds = applications.map((a) => a.application_id);
  const appIdSet = new Set(appIds);

  // Immutable status audit history for the employer packet. Read by job_id only
  // to avoid requiring a composite Firestore index, then filter defensively.
  const statusHistoryByAppId = new Map<string, StatusHistoryEvent[]>();
  const STATUS_HISTORY_READ_CAP = APPLICANTS_READ_CAP * 20;
  const eventsSnap = await db
    .collection("application_status_events")
    .where("job_id", "==", jobId)
    .limit(STATUS_HISTORY_READ_CAP + 1)
    .get();
  const statusHistoryTruncated = eventsSnap.size > STATUS_HISTORY_READ_CAP;
  eventsSnap.docs.slice(0, STATUS_HISTORY_READ_CAP).forEach((doc) => {
    const data = doc.data();
    const applicationId = typeof data.application_id === "string" ? data.application_id : "";
    if (!appIdSet.has(applicationId) || data.employer_id !== uid) return;
    const item: StatusHistoryEvent = {
      id: doc.id,
      action: typeof data.action === "string" ? data.action : null,
      from_status: typeof data.from_status === "string" ? data.from_status : "",
      to_status: typeof data.to_status === "string" ? data.to_status : "",
      reason: typeof data.reason === "string" ? data.reason : null,
      candidate_note: typeof data.candidate_note === "string" ? data.candidate_note : null,
      skipped_statuses: Array.isArray(data.skipped_statuses)
        ? data.skipped_statuses.filter((x): x is string => typeof x === "string")
        : [],
      created_at: isoFromTimestamp(data.created_at),
    };
    const list = statusHistoryByAppId.get(applicationId) ?? [];
    list.push(item);
    statusHistoryByAppId.set(applicationId, list);
  });
  statusHistoryByAppId.forEach((list) => {
    list.sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });
  });

  // Frozen submission snapshots (resume/profile AS APPLIED) from the server-only
  // application_snapshots collection, keyed by application id. Batched getAll.
  const snapshotByAppId = new Map<string, admin.firestore.DocumentData>();
  if (appIds.length) {
    const snapDocs = await db.getAll(...appIds.map((id) => db.collection("application_snapshots").doc(id)));
    snapDocs.forEach((s) => { if (s.exists) snapshotByAppId.set(s.id, s.data()!); });
  }

  // 3. Fetch candidate docs + Talent Profiles (Admin SDK). Resume text never
  //    leaves the server; structured Talent Profiles are returned only for this
  //    job-owning employer and are also used as match context.
  //
  //    We also read the live name here: candidate_name on the application is a
  //    snapshot frozen at apply time, and a write race during user provisioning
  //    can leave it empty (→ "Unnamed Candidate" in the UI). Reading full_name
  //    live recovers the name for both existing and future applications.
  const liveNameById = new Map<string, string>();
  const talentProfileById = new Map<string, TalentProfileSnapshot | null>();
  const candidateContextById = new Map<string, string>();
  const candidateIds = Array.from(new Set(applications.map((a) => a.candidate_id)));
  // Batch the by-id reads into two getAll calls (users, talent_profiles) instead
  // of 2N individual point reads. getAll preserves ref order → snaps[i] ↔ ids[i].
  // Guard the empty case: getAll throws on a zero-length spread.
  const [userSnaps, profileSnaps] = candidateIds.length
    ? await Promise.all([
        db.getAll(...candidateIds.map((cid) => db.collection("users").doc(cid))),
        db.getAll(...candidateIds.map((cid) => db.collection("talent_profiles").doc(cid))),
      ])
    : [[], []];
  candidateIds.forEach((cid, i) => {
    const snap = userSnaps[i];
    const talentSnap = profileSnaps[i];
    const data = snap && snap.exists ? snap.data() : undefined;
    const app = appByCandidate.get(cid);
    const snapshot = app ? snapshotByAppId.get(app.application_id) : undefined;
    // Prefer the frozen submission snapshot (resume/profile AS APPLIED); fall
    // back to the live docs only for legacy applications without a snapshot.
    const snapText = typeof snapshot?.resume_text_snapshot === "string" ? snapshot.resume_text_snapshot : "";
    const liveText = typeof data?.resume_text === "string" ? data.resume_text : "";
    // A present snapshot wins even when its text is empty (file-only applicant);
    // only legacy (no-snapshot) applications fall back to live text.
    const resumeText = snapshot ? snapText : liveText;
    const profileSource =
      snapshot && snapshot.talent_profile_snapshot
        ? (snapshot.talent_profile_snapshot as admin.firestore.DocumentData)
        : (talentSnap && talentSnap.exists ? talentSnap.data() : undefined);
    const talentProfile = normalizeTalentProfile(profileSource);
    talentProfileById.set(cid, talentProfile);
    const profileText = talentProfileToMatchText(talentProfile);
    candidateContextById.set(cid, buildCandidateMatchContext(resumeText, profileText));
    // The Talent Profile name is the candidate's own typed name (apply gate
    // guarantees it) — prefer it over users.full_name, which can be null for
    // OAuth sign-ins. (users has no email field, so that fallback is inert.)
    const tpName = typeof talentProfile?.basic?.name === "string" ? (talentProfile.basic.name as string).trim() : "";
    const fullName = typeof data?.full_name === "string" ? data.full_name.trim() : "";
    const email = typeof data?.email === "string" ? data.email.trim() : "";
    liveNameById.set(cid, tpName || fullName || email);
  });

  // Backfill snapshot names that are empty OR email-shaped (older applications
  // froze the login email before the name fix) from the live profile name.
  for (const a of applications) {
    const live = liveNameById.get(a.candidate_id);
    const stale = !a.candidate_name.trim() || a.candidate_name.includes("@");
    if (stale && live) a.candidate_name = live;
  }

  if (!includeAnalysis) {
    return {
      applicants: applications.map((a) => emptyApplicant(
        a,
        talentProfileById.get(a.candidate_id) ?? null,
        statusHistoryByAppId.get(a.application_id) ?? [],
        "not_requested",
      )),
    };
  }

  // 4. Run analyzeCandidateMatch per applicant ON THE SERVER. Applicants without
  //    resume/profile context (or beyond the cap) are returned unanalyzed rather
  //    than dropped.
  await claimFreeToolRun(uid, "list-job-applicants-analysis", {
    requestId: typeof raw.requestId === "string" ? raw.requestId : undefined,
  });
  await ensurePlatformCaches();
  const spec = TOOL_REGISTRY["analyzeCandidateMatch"];
  if (!spec) {
    throw new HttpsError("internal", "analyzeCandidateMatch is not registered.");
  }
  const provider = await resolveProvider(uid, undefined, "listJobApplicants");

  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 10) : [];

  const analyzable =
    jobDescription.length > 0
      ? applications.filter((a) => (candidateContextById.get(a.candidate_id) ?? "").trim().length > 0)
      : [];
  const pool = analyzable.slice(0, MATCH_CANDIDATE_CAP);
  const poolIds = new Set(pool.map((a) => a.application_id));

  const analyzedSettled = await mapSettledWithConcurrency(
    pool,
    MATCH_CONCURRENCY,
    async (a): Promise<SafeApplicant> => {
      try {
        const llmRequest = spec.build({ resumeText: candidateContextById.get(a.candidate_id)!, jobDescription });
        llmRequest.timeoutMs = MATCH_TIMEOUT_MS;
        llmRequest.maxOutputTokens = Math.min(llmRequest.maxOutputTokens ?? 1_200, 1_200);
        llmRequest.thinkingLevel = "low";
        const result = await provider.generate(llmRequest);
        const parsed = (result.raw !== undefined ? result.raw : tryParseJson(result.text)) as
          | Record<string, unknown>
          | undefined;
        if (!parsed || !llmRequest.responseSchema ||
            validateAgainstSchema(parsed, llmRequest.responseSchema).length > 0) {
          return emptyApplicant(
            a,
            talentProfileById.get(a.candidate_id) ?? null,
            statusHistoryByAppId.get(a.application_id) ?? [],
            "failed"
          );
        }
        return {
          id: a.application_id,
          candidate_name: a.candidate_name,
          application_date: a.application_date,
          status: a.status,
          compatibility_score: Math.max(0, Math.min(100, Math.round(parsed.score as number))),
          summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 2000) : "",
          strengths: strArr(parsed.strengths),
          potentialGaps: strArr(parsed.potentialGaps),
          suggestedQuestions: strArr(parsed.suggestedQuestions),
          analysis_status: "complete",
          talent_profile: withoutContactInfo(talentProfileById.get(a.candidate_id) ?? null),
          status_history: statusHistoryByAppId.get(a.application_id) ?? [],
          screener_answers: a.screener_answers,
        };
      } catch (e) {
        console.error(`listJobApplicants: match failed for candidate ${a.candidate_id}:`, e);
        return emptyApplicant(
          a,
          talentProfileById.get(a.candidate_id) ?? null,
          statusHistoryByAppId.get(a.application_id) ?? [],
          "failed"
        );
      }
    },
  );
  const analyzed = analyzedSettled.map((outcome, index) =>
    outcome.status === "fulfilled"
      ? outcome.value
      : emptyApplicant(
          pool[index],
          talentProfileById.get(pool[index].candidate_id) ?? null,
          statusHistoryByAppId.get(pool[index].application_id) ?? [],
          "failed"
        )
  );

  const unanalyzed = applications
    .filter((a) => !poolIds.has(a.application_id))
    .map((a) => emptyApplicant(
      a,
      talentProfileById.get(a.candidate_id) ?? null,
      statusHistoryByAppId.get(a.application_id) ?? [],
      (candidateContextById.get(a.candidate_id) ?? "").trim().length > 0
        ? "not_analyzed_cap"
        : "no_context"
    ));

  const applicants = [...analyzed, ...unanalyzed].sort(
    (x, y) => (y.compatibility_score ?? -1) - (x.compatibility_score ?? -1),
  );

  return {
    applicants,
    applicants_truncated: applicantsTruncated,
    status_history_truncated: statusHistoryTruncated,
  };
  }
);
