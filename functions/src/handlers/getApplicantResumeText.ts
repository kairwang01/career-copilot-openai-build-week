/**
 * getApplicantResumeText — lets the employer who owns a job VIEW the resume TEXT
 * of a candidate who APPLIED to that job.
 *
 * resume_text is owner-only in Firestore rules (PII), so employers can't read it
 * directly. This callable serves it ONLY to the job-owning employer, and ONLY
 * for applicants (people who opted in by applying) — same authorization as
 * getApplicantResumeFile (download). Passive talent-discovery candidates have no
 * application and are never exposed here.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth } from "../middleware/auth";
import { assertEmployerOwnsApplication } from "./applicantAccess";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

interface ApplicantResumeTextResult {
  resumeText: string;
}

export const getApplicantResumeTextFunction = onCall(
  { invoker: "public" },
  async (request): Promise<ApplicantResumeTextResult> => {
    const uid = requireAuth(request);

    const raw = (request.data ?? {}) as { applicationId?: unknown };
    const applicationId = typeof raw.applicationId === "string" ? raw.applicationId.trim() : "";
    if (!applicationId) {
      throw new HttpsError("invalid-argument", "applicationId is required.");
    }

    // Authorize: caller must own the job this candidate applied to.
    const { candidateId, appData } = await assertEmployerOwnsApplication(db, uid, applicationId);

    // Anti-ghosting "Reviewed" receipt: record the FIRST time the owning employer
    // opened this applicant's resume, so the candidate's My Applications can show
    // "Reviewed on {date}" instead of leaving them guessing whether anyone looked.
    // Idempotent (set once) and best-effort — never block the resume read.
    if (!appData.employer_viewed_at) {
      db.collection("job_applications").doc(applicationId)
        .update({ employer_viewed_at: FieldValue.serverTimestamp() })
        .catch(() => { /* non-fatal */ });
    }

    // Prefer the FROZEN submission snapshot (the resume AS APPLIED) so the
    // employer reviews what was submitted, not the candidate's later edits. Gate
    // on the snapshot DOC's existence (not text length) — a file-only applicant
    // has a legitimately-empty resume_text_snapshot that must still win over the
    // candidate's later-edited live text. Fall back to live only for legacy
    // applications that have no snapshot doc at all.
    const snapDoc = await db.collection("application_snapshots").doc(applicationId).get();
    if (snapDoc.exists) {
      const snap = snapDoc.data()!;
      return { resumeText: typeof snap.resume_text_snapshot === "string" ? snap.resume_text_snapshot : "" };
    }
    const userSnap = await db.collection("users").doc(candidateId).get();
    const userData = userSnap.exists ? userSnap.data()! : undefined;
    const resumeText = typeof userData?.resume_text === "string" ? userData.resume_text : "";

    return { resumeText };
  },
);
