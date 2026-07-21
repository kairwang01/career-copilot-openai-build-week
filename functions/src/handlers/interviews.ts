/**
 * interviews — server-only interview scheduling for an application.
 *
 * Stored at application_interviews/{id}. firestore.rules let BOTH parties READ
 * their own interviews (candidate + the owning employer), but all WRITES go
 * through these Admin-SDK callables so the platform enforces the trust contract:
 *   - only the employer who OWNS the job may schedule / reschedule / cancel /
 *     complete an interview (verified against job_postings.employer_id).
 *   - only the CANDIDATE on the application may confirm attendance.
 *   - rescheduling / cancelling resets the candidate confirmation.
 * These records form the interview timeline shown next to the status history.
 *
 * Region/timeout inherited from setGlobalOptions() in index.ts.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth } from "../middleware/auth";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const FORMATS = new Set(["phone", "video", "onsite"]);
const INTERVIEW_STATUSES = new Set(["scheduled", "rescheduled", "cancelled", "completed"]);

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Verifies the caller owns the job behind this application; returns its refs.
async function loadAppForEmployer(uid: string, applicationId: string): Promise<{ jobId: string; candidateId: string }> {
  if (!applicationId) throw new HttpsError("invalid-argument", "applicationId is required.");
  const appSnap = await db.collection("job_applications").doc(applicationId).get();
  if (!appSnap.exists) throw new HttpsError("not-found", "Application not found.");
  const app = appSnap.data() ?? {};
  const jobId = typeof app.job_id === "string" ? app.job_id : "";
  const candidateId = typeof app.candidate_id === "string" ? app.candidate_id : "";
  const jobSnap = await db.collection("job_postings").doc(jobId).get();
  if (!jobSnap.exists || jobSnap.data()?.employer_id !== uid) {
    throw new HttpsError("permission-denied", "You do not own the job for this application.");
  }
  return { jobId, candidateId };
}

async function ownedInterview(uid: string, interviewId: string, party: "employer_id" | "candidate_id") {
  if (!interviewId) throw new HttpsError("invalid-argument", "interviewId is required.");
  const ref = db.collection("application_interviews").doc(interviewId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.[party] !== uid) {
    throw new HttpsError("permission-denied", "You can only change your own interviews.");
  }
  return { ref, data: snap.data() ?? {} };
}

export async function scheduleInterviewImpl(uid: string, data: Record<string, unknown>) {
  const applicationId = str(data.applicationId, 200);
  const { jobId, candidateId } = await loadAppForEmployer(uid, applicationId);
  const scheduledAt = str(data.scheduledAt, 40);
  if (!scheduledAt) throw new HttpsError("invalid-argument", "A scheduled date/time is required.");
  const format = str(data.format, 20);
  if (!FORMATS.has(format)) throw new HttpsError("invalid-argument", "Interview format is required.");

  const now = FieldValue.serverTimestamp();
  const ref = await db.collection("application_interviews").add({
    application_id: applicationId,
    job_id: jobId,
    employer_id: uid,
    candidate_id: candidateId,
    stage: str(data.stage, 80) || "Interview",
    scheduled_at: scheduledAt,
    timezone: str(data.timezone, 60),
    format,
    location_or_link: str(data.locationOrLink, 2048),
    interviewer: str(data.interviewer, 160),
    notes: str(data.notes, 2000),
    candidate_confirmed: false,
    interview_status: "scheduled",
    created_at: now,
    updated_at: now,
  });
  return { interviewId: ref.id };
}

export async function updateInterviewImpl(uid: string, data: Record<string, unknown>) {
  const { ref } = await ownedInterview(uid, str(data.interviewId, 200), "employer_id");
  const patch: Record<string, unknown> = { updated_at: FieldValue.serverTimestamp() };

  const interviewStatus = str(data.interviewStatus, 20);
  if (interviewStatus) {
    if (!INTERVIEW_STATUSES.has(interviewStatus)) throw new HttpsError("invalid-argument", "Invalid interview status.");
    patch.interview_status = interviewStatus;
    // Rescheduling or cancelling invalidates the candidate's prior confirmation.
    if (interviewStatus === "rescheduled" || interviewStatus === "cancelled") patch.candidate_confirmed = false;
  }
  if (data.scheduledAt !== undefined) {
    const s = str(data.scheduledAt, 40);
    if (s) { patch.scheduled_at = s; patch.candidate_confirmed = false; }
  }
  if (data.timezone !== undefined) patch.timezone = str(data.timezone, 60);
  if (data.format !== undefined) {
    const f = str(data.format, 20);
    if (!FORMATS.has(f)) throw new HttpsError("invalid-argument", "Interview format is invalid.");
    patch.format = f;
  }
  if (data.locationOrLink !== undefined) patch.location_or_link = str(data.locationOrLink, 2048);
  if (data.interviewer !== undefined) patch.interviewer = str(data.interviewer, 160);
  if (data.notes !== undefined) patch.notes = str(data.notes, 2000);
  if (data.stage !== undefined) patch.stage = str(data.stage, 80) || "Interview";

  await ref.update(patch);
  return { interviewId: ref.id };
}

export async function confirmInterviewImpl(uid: string, data: Record<string, unknown>) {
  const { ref, data: interview } = await ownedInterview(uid, str(data.interviewId, 200), "candidate_id");
  if (interview.interview_status === "cancelled") {
    throw new HttpsError("failed-precondition", "This interview was cancelled.");
  }
  await ref.update({ candidate_confirmed: true, updated_at: FieldValue.serverTimestamp() });
  return { interviewId: ref.id };
}

export const scheduleInterviewFunction = onCall({ invoker: "public" }, (request) =>
  scheduleInterviewImpl(requireAuth(request), request.data ?? {}));

export const updateInterviewFunction = onCall({ invoker: "public" }, (request) =>
  updateInterviewImpl(requireAuth(request), request.data ?? {}));

export const confirmInterviewFunction = onCall({ invoker: "public" }, (request) =>
  confirmInterviewImpl(requireAuth(request), request.data ?? {}));
