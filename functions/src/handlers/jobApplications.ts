/**
 * jobApplications — Job application management Cloud Functions.
 *
 * createJobApplicationFunction:
 *   Server-side replacement for the client-side addDoc() call.
 *   Validates the job posting exists, prevents duplicate applications,
 *   and writes with the Admin SDK (bypasses Firestore client rules).
 *
 * Why server-side?
 *  - Client cannot forge employer_id, job_title, or other fields — they are
 *    read from the authoritative job_postings document, not from the request.
 *  - Duplicate check is atomic — no double-apply race condition.
 *  - Firestore rules for job_applications forbid client creates; all writes
 *    go through this function.
 *
 * Region is inherited from setGlobalOptions() in index.ts (us-central1).
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth } from "../middleware/auth";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Resume files live in this bucket (matches VITE_FIREBASE_STORAGE_BUCKET and
// getApplicantResumeFile). Used to copy the original file into an
// application-scoped snapshot path at apply time.
const RESUME_BUCKET = process.env.RESUME_STORAGE_BUCKET || "career-copilot-a3168.firebasestorage.app";

interface CreateJobApplicationRequest {
  jobId: string;
  compatibilityScore?: number | null;
  screenerAnswers?: { questionId: string; answer: string }[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasMeaningfulValue = (value: unknown): boolean => {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasMeaningfulValue);
  return false;
};

const hasMeaningfulEntry = (value: unknown): boolean =>
  isRecord(value) && Object.values(value).some(hasMeaningfulValue);

const isTalentProfileReady = (profile: FirebaseFirestore.DocumentData | undefined): boolean => {
  if (!profile) return false;
  const basic = profile.basic;
  const intention = profile.intention;
  const hasName = isRecord(basic) && typeof basic.name === "string" && basic.name.trim().length > 0;
  const hasTarget =
    isRecord(intention) &&
    typeof intention.targetRole === "string" &&
    intention.targetRole.trim().length > 0;
  const hasHistory =
    (Array.isArray(profile.education) && profile.education.some(hasMeaningfulEntry)) ||
    (Array.isArray(profile.experience) && profile.experience.some(hasMeaningfulEntry));
  return hasName && hasTarget && hasHistory;
};

/**
 * Builds the stored screener answers from the candidate's raw answers, validated
 * against the JOB's questions. Required questions must be answered. The 'expected'
 * field is NEVER compared here — knockout is a display-only screening signal in the
 * employer packet, never an auto-reject. The prompt is frozen onto each answer so the
 * packet renders correctly even if the job's questions are later edited.
 */
function buildScreenerAnswers(
  questions: unknown,
  rawAnswers: unknown,
): { question_id: string; prompt: string; answer: string }[] {
  if (!Array.isArray(questions) || questions.length === 0) return [];
  const answerMap = new Map<string, string>();
  if (Array.isArray(rawAnswers)) {
    for (const a of rawAnswers) {
      if (!isRecord(a)) continue;
      const qid = typeof a.questionId === "string" ? a.questionId : "";
      const ans = typeof a.answer === "string" ? a.answer.trim().slice(0, 2000) : "";
      if (qid) answerMap.set(qid, ans);
    }
  }
  const out: { question_id: string; prompt: string; answer: string }[] = [];
  for (const q of questions) {
    if (!isRecord(q)) continue;
    const qid = typeof q.id === "string" ? q.id : "";
    const prompt = typeof q.prompt === "string" ? q.prompt : "";
    if (!qid) continue;
    const answer = answerMap.get(qid) ?? "";
    if (q.required === true && !answer) {
      throw new HttpsError("failed-precondition", `Please answer the required screening question: "${prompt}"`);
    }
    out.push({ question_id: qid, prompt, answer });
  }
  return out;
}

export async function createJobApplicationImpl(
  uid: string,
  data: CreateJobApplicationRequest,
  email?: string,
) {
  if (!data.jobId?.trim()) {
    throw new HttpsError("invalid-argument", "jobId is required.");
  }

  // 1. Verify the job posting exists, is still open, and read trusted fields.
  const jobSnap = await db.collection("job_postings").doc(data.jobId).get();
  if (!jobSnap.exists) {
    throw new HttpsError("not-found", "Job posting not found.");
  }
  const jobData = jobSnap.data()!;
  if (jobData.is_active === false) {
    throw new HttpsError("failed-precondition", "This job is no longer accepting applications.");
  }

  // Screener answers (Indeed/LinkedIn-style), validated against the job's questions.
  const screenerAnswers = buildScreenerAnswers(jobData.screener_questions, data.screenerAnswers);

  // 2. Enforce the reusable Talent Profile requirement server-side. The UI also
  // blocks early, but this is the authoritative apply path and must be bypass-safe.
  const talentProfileSnap = await db.collection("talent_profiles").doc(uid).get();
  const talentProfile = talentProfileSnap.exists ? talentProfileSnap.data() : undefined;
  if (!isTalentProfileReady(talentProfile)) {
    throw new HttpsError("failed-precondition", "Complete your Talent Profile before applying.");
  }

  // 3. A resume is REQUIRED — the whole HR-review value depends on it. Accept
  //    either the parsed text or an uploaded file.
  const userSnap = await db.collection("users").doc(uid).get();
  const userData = userSnap.exists ? userSnap.data() : undefined;
  const resumeText = typeof userData?.resume_text === "string" ? userData.resume_text : "";
  const resumeFilePath = typeof userData?.resume_file_path === "string" ? userData.resume_file_path : "";
  const resumeFileName = typeof userData?.resume_file_name === "string" ? userData.resume_file_name : "";
  const hasResumeFile = resumeFilePath.startsWith(`resumes/${uid}/`);
  if (resumeText.trim().length === 0 && !hasResumeFile) {
    throw new HttpsError("failed-precondition", "Add your resume before applying.");
  }

  // 4. Freeze the candidate's display name. Prefer the Talent Profile name
  //    (apply gate guarantees basic.name) over users.full_name (null for OAuth
  //    sign-ins with no displayName) so the employer never sees the login email.
  const tpBasic = talentProfile?.basic as Record<string, unknown> | undefined;
  const tpName = typeof tpBasic?.name === "string" ? tpBasic.name.trim() : "";
  const fullName = typeof userData?.full_name === "string" ? userData.full_name.trim() : "";
  const candidateName: string = tpName || fullName || email || "Candidate";

  // 5. Legacy dedup: applications created before deterministic ids used an
  //    auto-id, so a re-apply would not collide on the new id. Catch those with a
  //    field query. (The deterministic create below is the ATOMIC guard for new
  //    and concurrent applications; this only covers the legacy transition.)
  const legacy = await db
    .collection("job_applications")
    .where("candidate_id", "==", uid)
    .where("job_id", "==", data.jobId)
    .limit(1)
    .get();
  if (!legacy.empty) {
    throw new HttpsError("already-exists", "You have already applied to this job.");
  }

  // 6. Atomically create the application AND its FROZEN SUBMISSION SNAPSHOT in one
  //    batch. Deterministic doc id `${uid}_${jobId}` makes a concurrent
  //    double-apply impossible — batch.create rejects the whole commit with
  //    ALREADY_EXISTS if the doc exists. The snapshot lives in a SEPARATE
  //    server-only collection so it never bloats the candidate's My Applications
  //    stream (which subscribes to the application docs). HR reads it via the
  //    Admin-SDK callables; firestore.rules deny all client access.
  //    NOTE: no `submitted_at` on the job_applications doc — that would break the
  //    employer status-update rule (validJobApplication uses a keys().hasOnly
  //    whitelist). application_date is the canonical submission time; the snapshot
  //    carries its own submitted_at.
  const applicationId = `${uid}_${data.jobId}`;
  const appRef = db.collection("job_applications").doc(applicationId);
  const snapRef = db.collection("application_snapshots").doc(applicationId);
  try {
    // Clamp the client-supplied score to a sane 0-100 integer (or null) so a
    // forged/garbage value can't be persisted on the application doc.
    const rawScore = Number(data.compatibilityScore);
    const compatibilityScore = Number.isFinite(rawScore)
      ? Math.max(0, Math.min(100, Math.round(rawScore)))
      : null;
    const batch = db.batch();
    batch.create(appRef, {
      job_id: data.jobId,
      candidate_id: uid,
      employer_id: jobData.employer_id ?? null,
      job_title: jobData.title ?? null,
      candidate_name: candidateName,
      status: "Applied",
      compatibility_score: compatibilityScore,
      screener_answers: screenerAnswers,
      notes: null,
      application_date: FieldValue.serverTimestamp(),
    });
    batch.create(snapRef, {
      application_id: applicationId,
      candidate_id: uid,
      employer_id: jobData.employer_id ?? null,
      resume_text_snapshot: resumeText,
      talent_profile_snapshot: talentProfile ?? null,
      screener_answers_snapshot: screenerAnswers,
      resume_file_snapshot_path: null,
      resume_file_snapshot_name: null,
      submitted_at: FieldValue.serverTimestamp(),
    });
    await batch.commit();
  } catch (e) {
    if ((e as { code?: number }).code === 6 /* ALREADY_EXISTS */) {
      throw new HttpsError("already-exists", "You have already applied to this job.");
    }
    throw e;
  }

  // 7. Best-effort: COPY the original resume file to an application-scoped path so
  //    the file snapshot survives the candidate replacing/deleting their resume
  //    (resumeStorage deletes the old object on re-upload). Failure is non-fatal —
  //    the text snapshot above already preserves the reviewable content.
  if (hasResumeFile) {
    try {
      const ext = resumeFilePath.includes(".") ? resumeFilePath.slice(resumeFilePath.lastIndexOf(".")) : "";
      const snapshotPath = `application_resumes/${applicationId}/resume${ext}`;
      const bucket = admin.storage().bucket(RESUME_BUCKET);
      await bucket.file(resumeFilePath).copy(bucket.file(snapshotPath));
      await snapRef.update({
        resume_file_snapshot_path: snapshotPath,
        resume_file_snapshot_name: resumeFileName || `resume${ext}`,
      });
    } catch (copyErr) {
      console.warn(`createJobApplication: resume file snapshot copy failed for ${applicationId}:`, copyErr);
    }
  }

  return { applicationId };
}

export const createJobApplicationFunction = onCall((request) =>
  createJobApplicationImpl(
    requireAuth(request),
    (request.data ?? {}) as CreateJobApplicationRequest,
    request.auth?.token?.email,
  ));
