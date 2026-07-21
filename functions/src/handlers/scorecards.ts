/**
 * scorecards — structured, employer-only interview evaluation.
 *
 * Stored at application_scorecards/{id}. Unlike application_interviews, these
 * documents contain hiring judgement and internal evidence, so candidates never
 * read them directly. Employers may read their own scorecards; all writes go
 * through this callable so the platform can prove:
 *   - the caller owns the job behind the interview.
 *   - every scorecard is tied to a real, non-cancelled interview.
 *   - recommendation + numeric ratings are normalized server-side.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth } from "../middleware/auth";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const RECOMMENDATIONS = new Set(["strong_hire", "hire", "hold", "no_hire"]);
const RATING_KEYS = new Set(["role_fit", "technical_skill", "problem_solving", "communication", "evidence_depth"]);

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

function intInRange(value: unknown, label: string, min = 1, max = 5): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
  if (n < min || n > max) throw new HttpsError("invalid-argument", `${label} must be between ${min} and ${max}.`);
  return n;
}

function cleanRatings(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpsError("invalid-argument", "Scorecard ratings are required.");
  }
  const out: Record<string, number> = {};
  for (const key of RATING_KEYS) {
    const raw = (value as Record<string, unknown>)[key];
    out[key] = intInRange(raw, key);
  }
  return out;
}

async function loadInterviewForEmployer(uid: string, interviewId: string) {
  if (!interviewId) throw new HttpsError("invalid-argument", "interviewId is required.");
  const ref = db.collection("application_interviews").doc(interviewId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Interview not found.");
  const interview = snap.data() ?? {};
  if (interview.employer_id !== uid) {
    throw new HttpsError("permission-denied", "You can only score interviews for your own jobs.");
  }
  if (interview.interview_status === "cancelled") {
    throw new HttpsError("failed-precondition", "Cancelled interviews cannot be scored.");
  }
  const applicationId = typeof interview.application_id === "string" ? interview.application_id : "";
  const jobId = typeof interview.job_id === "string" ? interview.job_id : "";
  const candidateId = typeof interview.candidate_id === "string" ? interview.candidate_id : "";
  if (!applicationId || !jobId || !candidateId) {
    throw new HttpsError("failed-precondition", "Interview is missing application, job, or candidate references.");
  }
  const jobSnap = await db.collection("job_postings").doc(jobId).get();
  if (!jobSnap.exists || jobSnap.data()?.employer_id !== uid) {
    throw new HttpsError("permission-denied", "You do not own the job for this interview.");
  }
  return { interview, applicationId, jobId, candidateId };
}

export async function upsertScorecardImpl(uid: string, data: Record<string, unknown>) {
  const interviewId = str(data.interviewId, 200);
  const { interview, applicationId, jobId, candidateId } = await loadInterviewForEmployer(uid, interviewId);

  const recommendation = str(data.recommendation, 40);
  if (!RECOMMENDATIONS.has(recommendation)) {
    throw new HttpsError("invalid-argument", "A valid recommendation is required.");
  }
  const ratings = cleanRatings(data.ratings);
  const overallScore = intInRange(data.overallScore, "overallScore");
  const evidence = str(data.evidence, 3000);
  if (!evidence) {
    throw new HttpsError("invalid-argument", "Evidence is required.");
  }

  const scorecardId = str(data.scorecardId, 200);
  const now = FieldValue.serverTimestamp();
  const payload = {
    application_id: applicationId,
    interview_id: interviewId,
    job_id: jobId,
    employer_id: uid,
    candidate_id: candidateId,
    stage: str(data.stage, 80) || (typeof interview.stage === "string" ? interview.stage : "Interview"),
    recommendation,
    overall_score: overallScore,
    ratings,
    evidence,
    concerns: str(data.concerns, 3000),
    next_steps: str(data.nextSteps, 2000),
    private_notes: str(data.privateNotes, 3000),
    updated_at: now,
  };

  let ref: admin.firestore.DocumentReference;
  if (scorecardId) {
    ref = db.collection("application_scorecards").doc(scorecardId);
    const existing = await ref.get();
    if (!existing.exists || existing.data()?.employer_id !== uid || existing.data()?.interview_id !== interviewId) {
      throw new HttpsError("permission-denied", "You can only update your own scorecard for this interview.");
    }
    await ref.update(payload);
  } else {
    ref = db.collection("application_scorecards").doc(interviewId);
    const existing = await ref.get();
    if (existing.exists) {
      if (existing.data()?.employer_id !== uid) {
        throw new HttpsError("permission-denied", "You can only update your own scorecard for this interview.");
      }
      await ref.update(payload);
    } else {
      await ref.create({ ...payload, created_at: now });
    }
  }

  return { scorecardId: ref.id };
}

export const upsertScorecardFunction = onCall({ invoker: "public" }, (request) =>
  upsertScorecardImpl(requireAuth(request), request.data ?? {}));
