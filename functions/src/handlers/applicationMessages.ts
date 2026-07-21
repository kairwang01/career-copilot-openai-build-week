/**
 * applicationMessages — server-only in-application messaging between the employer who
 * owns the job and the candidate on the application (BOSS-style direct comms; the
 * foundation for Indeed-style automated templates and recruiter outreach).
 *
 * Stored at application_messages/{id}. firestore.rules let BOTH parties READ the
 * thread for their own application; all WRITES go through this Admin-SDK callable so
 * the platform enforces the trust contract:
 *   - the sender is genuinely a PARTICIPANT (the job-owning employer OR the candidate).
 *   - the body is bounded and non-empty.
 *   - every message is an immutable, timestamped, attributable record — the audit
 *     trail of who said what, when (no client can forge or backdate it).
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

/** Employer-side message presets (the candidate always sends "custom" free text). */
const MESSAGE_TEMPLATES = new Set([
  "interview_invite",
  "request_info",
  "rejection",
  "offer_followup",
  "custom",
]);
const MAX_BODY = 4000;

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Resolves the caller's role on this application from the AUTHORITATIVE refs (the
 * application's candidate_id and the owning job's employer_id), or throws if the
 * caller is neither party. This is the whole authorization surface for messaging.
 */
async function authorizeParty(
  uid: string,
  applicationId: string,
): Promise<{ jobId: string; candidateId: string; employerId: string; senderRole: "candidate" | "employer" }> {
  if (!applicationId) throw new HttpsError("invalid-argument", "applicationId is required.");
  const appSnap = await db.collection("job_applications").doc(applicationId).get();
  if (!appSnap.exists) throw new HttpsError("not-found", "Application not found.");
  const app = appSnap.data() ?? {};
  const jobId = typeof app.job_id === "string" ? app.job_id : "";
  const candidateId = typeof app.candidate_id === "string" ? app.candidate_id : "";
  if (!jobId || !candidateId) {
    throw new HttpsError("failed-precondition", "Application is missing job or candidate references.");
  }
  const jobSnap = await db.collection("job_postings").doc(jobId).get();
  const employerId = jobSnap.exists ? (jobSnap.data()?.employer_id as string) : "";
  if (!employerId) throw new HttpsError("not-found", "The job for this application no longer exists.");

  let senderRole: "candidate" | "employer";
  if (uid === candidateId) senderRole = "candidate";
  else if (uid === employerId) senderRole = "employer";
  else throw new HttpsError("permission-denied", "You are not a participant in this application.");

  return { jobId, candidateId, employerId, senderRole };
}

export async function sendApplicationMessageImpl(uid: string, data: Record<string, unknown>) {
  const applicationId = str(data.applicationId, 200);
  const { jobId, candidateId, employerId, senderRole } = await authorizeParty(uid, applicationId);

  const body = str(data.body, MAX_BODY);
  if (!body) throw new HttpsError("invalid-argument", "Message body is required.");

  // Only employers attach a template tag; candidate replies are always "custom".
  const requested = str(data.templateKey, 40);
  const template =
    senderRole === "employer" && MESSAGE_TEMPLATES.has(requested) ? requested : "custom";

  const now = FieldValue.serverTimestamp();
  const ref = await db.collection("application_messages").add({
    application_id: applicationId,
    job_id: jobId,
    employer_id: employerId,
    candidate_id: candidateId,
    sender_uid: uid,
    sender_role: senderRole,
    body,
    template_key: template,
    created_at: now,
  });

  return { messageId: ref.id, senderRole };
}

export const sendApplicationMessageFunction = onCall({ invoker: "public" }, (request) =>
  sendApplicationMessageImpl(requireAuth(request), request.data ?? {}));
