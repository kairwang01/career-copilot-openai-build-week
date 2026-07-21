/**
 * getApplicantResumeFile — lets an employer download the ORIGINAL resume file of
 * a candidate who APPLIED to one of their jobs.
 *
 * WHY A FUNCTION: resume files live at resumes/{uid}/… with OWNER-ONLY Storage
 * rules (PII). Employers cannot read them directly. This callable enforces the
 * same relationship the inbound-applicant funnel uses (listJobApplicants.ts):
 * the caller must own the job the candidate applied to. Talent-discovery
 * (passive) candidates are deliberately NOT downloadable — only people who chose
 * to apply to this employer.
 *
 * The file is returned inline as base64 (resumes are capped at <10 MB on upload,
 * comfortably within the callable response limit) so there is no signed-URL IAM
 * dependency. resume_text continues to stay server-side; this is the file only.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAuth } from "../middleware/auth";
import { assertEmployerOwnsApplication } from "./applicantAccess";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// The resume files were uploaded by the client to this bucket
// (VITE_FIREBASE_STORAGE_BUCKET). Target it explicitly so we never read the
// wrong (e.g. legacy *.appspot.com) default bucket.
const RESUME_BUCKET = process.env.RESUME_STORAGE_BUCKET || "career-copilot-a3168.firebasestorage.app";

const SIGNED_URL_TTL_MS = 5 * 60 * 1000; // short-lived download link
// base64 of a 7 MB file ≈ 9.33 MB, which (plus the JSON envelope) stays under the
// ~10 MB callable response limit. Larger files must go via the signed URL.
const MAX_INLINE_BYTES = 7 * 1024 * 1024;

interface ApplicantResumeFileResult {
  available: boolean;
  url?: string;
  fileName?: string;
  contentType?: string;
  base64?: string;
}

export const getApplicantResumeFileFunction = onCall(
  { invoker: "public", memory: "512MiB" },
  async (request): Promise<ApplicantResumeFileResult> => {
    const uid = requireAuth(request);

    const raw = (request.data ?? {}) as { applicationId?: unknown };
    const applicationId = typeof raw.applicationId === "string" ? raw.applicationId.trim() : "";
    if (!applicationId) {
      throw new HttpsError("invalid-argument", "applicationId is required.");
    }

    // 1. Authorize: caller must own the job this candidate applied to (shared
    //    single-sourced check with getApplicantResumeText).
    const { candidateId } = await assertEmployerOwnsApplication(db, uid, applicationId);

    // 2. Resolve the file path. Prefer the FROZEN submission snapshot copied at
    //    apply time (application_resumes/{applicationId}/…) so HR gets the file
    //    AS SUBMITTED even after the candidate replaces/deletes their resume.
    //    Fall back to the candidate's live file only for legacy applications.
    const snapDoc = await db.collection("application_snapshots").doc(applicationId).get();
    const snapData = snapDoc.exists ? snapDoc.data()! : undefined;
    const snapPath = typeof snapData?.resume_file_snapshot_path === "string" ? snapData.resume_file_snapshot_path : "";
    const snapName = typeof snapData?.resume_file_snapshot_name === "string" ? snapData.resume_file_snapshot_name : "";
    let path = "";
    let storedName = "";
    if (snapPath.startsWith(`application_resumes/${applicationId}/`)) {
      path = snapPath;
      storedName = snapName;
    } else {
      // Legacy fallback: read the candidate's live resume-file reference.
      const userSnap = await db.collection("users").doc(candidateId).get();
      const userData = userSnap.exists ? userSnap.data()! : undefined;
      const livePath = typeof userData?.resume_file_path === "string" ? userData.resume_file_path : "";
      // Defense-in-depth: only serve a file inside THIS candidate's own namespace.
      if (livePath.startsWith(`resumes/${candidateId}/`)) {
        path = livePath;
        storedName = typeof userData?.resume_file_name === "string" ? userData.resume_file_name : "";
      }
    }

    if (!path) {
      return { available: false };
    }

    // 3. Return the file. Prefer a short-lived signed URL (no response-size ceiling,
    //    works for any allowed file size). If URL signing isn't available on the
    //    runtime service account (no Token Creator IAM role), fall back to inline
    //    base64 — bounded so it can never exceed the callable response limit.
    const file = admin.storage().bucket(RESUME_BUCKET).file(path);
    const [exists] = await file.exists();
    if (!exists) {
      return { available: false };
    }

    let contentType = "application/octet-stream";
    let size = 0;
    try {
      const [meta] = await file.getMetadata();
      if (typeof meta.contentType === "string" && meta.contentType) contentType = meta.contentType;
      size = Number(meta.size) || 0;
    } catch {
      /* non-fatal: fall back to octet-stream / unknown size */
    }
    const fileName = storedName || path.split("/").pop() || "resume";
    // Sanitize for the Content-Disposition header (ASCII, no quotes).
    const safeName = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");

    try {
      const [url] = await file.getSignedUrl({
        action: "read",
        expires: Date.now() + SIGNED_URL_TTL_MS,
        responseDisposition: `attachment; filename="${safeName}"`,
      });
      return { available: true, url, fileName, contentType };
    } catch (signErr) {
      // Signing unavailable (no signBlob IAM). Inline base64 fallback, bounded.
      if (size > MAX_INLINE_BYTES) {
        console.warn("getApplicantResumeFile: signed URL unavailable and file too large for inline fallback:", signErr);
        throw new HttpsError(
          "resource-exhausted",
          "This résumé is too large to download in-app right now. Please try again later.",
        );
      }
      const [buf] = await file.download();
      return { available: true, fileName, contentType, base64: buf.toString("base64") };
    }
  },
);
