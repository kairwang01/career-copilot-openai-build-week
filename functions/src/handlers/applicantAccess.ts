/**
 * Shared authorization for employer access to an APPLICANT's resume.
 *
 * Both getApplicantResumeFile (download the original file) and
 * getApplicantResumeText (view the parsed text) must enforce the SAME rule:
 * the caller is the employer who owns the job that the application targets, and
 * only candidates who chose to apply (not passive talent-discovery profiles) are
 * exposed. Keeping this in one place prevents the two security checks from
 * drifting apart.
 */

import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";

/**
 * Verifies `uid` owns the job the given application targets and returns the
 * application's candidate + job ids. employer_id is read from the authoritative
 * job_postings doc, never trusted from the application doc or client input
 * (mirrors listJobApplicants.ts). Throws HttpsError on any failure.
 */
export async function assertEmployerOwnsApplication(
  db: admin.firestore.Firestore,
  uid: string,
  applicationId: string,
): Promise<{ candidateId: string; jobId: string; appData: admin.firestore.DocumentData }> {
  const appSnap = await db.collection("job_applications").doc(applicationId).get();
  if (!appSnap.exists) {
    throw new HttpsError("not-found", "Application not found.");
  }
  const appData = appSnap.data()!;
  const candidateId = typeof appData.candidate_id === "string" ? appData.candidate_id : "";
  const jobId = typeof appData.job_id === "string" ? appData.job_id : "";
  if (!candidateId || !jobId) {
    throw new HttpsError("failed-precondition", "Application is missing a candidate or job reference.");
  }

  const jobSnap = await db.collection("job_postings").doc(jobId).get();
  if (!jobSnap.exists || jobSnap.data()!.employer_id !== uid) {
    throw new HttpsError("permission-denied", "You do not own the job for this application.");
  }

  // appData is the (lean) job_applications doc. The frozen submission snapshot
  // lives in application_snapshots/{applicationId} (read separately by callers).
  return { candidateId, jobId, appData };
}
