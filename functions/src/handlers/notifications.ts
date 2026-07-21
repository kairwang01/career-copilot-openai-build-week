/**
 * notifications — Firestore-triggered Cloud Functions.
 *
 * onApplicationStatusChangeFunction:
 *   Fires on UPDATE of a job_applications document (not create/delete), and acts
 *   only when before.status !== after.status.
 *   When before.status !== after.status, writes a notification doc to
 *   users/{candidate_id}/notifications/{auto} so the candidate learns
 *   their application moved through the hiring funnel.
 *
 *   Delivery is retryable and idempotent. Deterministic document ids make a
 *   repeated event safe; transient failures are rethrown so they are not lost.
 *
 * Region is inherited from setGlobalOptions() in index.ts (us-central1).
 */

import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { classifyTransition, renderInterviewProgressEmail } from "../email/interviewProgress";
import { ensurePlatformCaches, getAppBaseUrl } from "../admin/platformConfig";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Where the candidate logs in to view "My Applications". Resolved from Firestore
// platform_config/app at runtime, with env var and hardcoded fallback.
function resolveAppBaseUrlForEmail(): string {
  return (getAppBaseUrl()
    || process.env.APP_BASE_URL
    || "https://copilot.kairwang.cloud").replace(/\/$/, "");
}

// Firestore doc ids can't contain "/"; keep them tidy and deterministic.
const safeId = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, "_");

// create() throws ALREADY_EXISTS (gRPC code 6) when the deterministic id is
// re-used — that just means we already wrote this exact transition. Swallow it.
export const isAlreadyExistsError = (err: unknown): boolean => {
  const code = (err as { code?: number | string })?.code;
  return code === 6 || code === "already-exists";
};

const isAuthUserNotFound = (err: unknown): boolean =>
  (err as { code?: string })?.code === "auth/user-not-found";

export const onApplicationStatusChangeFunction = onDocumentUpdated(
  { document: "job_applications/{appId}", retry: true },
  async (event) => {
    try {
      await ensurePlatformCaches();
      const before = event.data?.before?.data();
      const after = event.data?.after?.data();

      // Nothing to do if we can't read both snapshots.
      if (!before || !after) return;

      // Only act when status actually changed.
      if (before.status === after.status) return;

      const candidateId: string | undefined = after.candidate_id;
      if (!candidateId) return;

      const appId = event.params.appId;
      // Normalize once so the in-app feed and the email dedupe on the SAME key.
      const { kind, status } = classifyTransition(before.status, after.status);

      // 1) In-app notification — deterministic id per (application, normalized
      //    status) so an employer toggling a stage back and forth can't flood the
      //    candidate's feed (one notification per distinct stage reached).
      // Candidate-facing note the employer attached to this transition (the
      // internal `reason` is never surfaced — it stays in the audit event).
      const candidateNote = typeof after.last_status_note === "string" ? after.last_status_note : null;
      const notifRef = db
        .collection("users")
        .doc(candidateId)
        .collection("notifications")
        .doc(safeId(`${appId}_${status}`));
      try {
        await notifRef.create({
          type: "application_status",
          application_id: appId,
          job_title: after.job_title ?? null,
          status,
          candidate_note: candidateNote,
          read: false,
          created_at: FieldValue.serverTimestamp(),
        });
      } catch (err) {
        if (!isAlreadyExistsError(err)) throw err;
        await notifRef.set(
          { candidate_note: candidateNote, read: false, updated_at: FieldValue.serverTimestamp() },
          { merge: true },
        );
      }

      // 2) Email the candidate on a meaningful forward stage change.
      //    Delivered by the Firebase "Trigger Email" extension watching `mail`.
      if (kind) {
        // company/location live on the job posting, not on the application.
        let company = "";
        let location = "";
        try {
          const jobSnap = await db.collection("job_postings").doc(String(after.job_id)).get();
          company = (jobSnap.data()?.company_name as string) ?? "";
          location = (jobSnap.data()?.location as string) ?? "";
        } catch { /* non-fatal */ }

        // recipient + display name + language — the user doc rarely stores email,
        // so fall back to the authoritative Firebase Auth record.
        const userSnap = await db.collection("users").doc(candidateId).get();
        const u = (userSnap.data() ?? {}) as Record<string, unknown>;
        let email = typeof u.email === "string" ? u.email : "";
        if (!email) {
          try {
            email = (await admin.auth().getUser(candidateId)).email ?? "";
          } catch (err) {
            if (!isAuthUserNotFound(err)) throw err;
          }
        }

        if (email) {
          const candidateName = (typeof u.full_name === "string" && u.full_name.trim())
            ? u.full_name.trim()
            : (typeof after.candidate_name === "string" ? after.candidate_name : "");
          const rendered = renderInterviewProgressEmail({
            lang: typeof u.preferred_language === "string" ? u.preferred_language : "en",
            kind,
            candidateName,
            jobTitle: typeof after.job_title === "string" ? after.job_title : "the role",
            company,
            location,
            status,
            appId,
            baseUrl: resolveAppBaseUrlForEmail(),
          });
          // Idempotent enqueue: one email per (application, status) even on retries.
          try {
            await db.collection("mail").doc(safeId(`${appId}_${status}`)).create({
              to: [email],
              message: { subject: rendered.subject, html: rendered.html, text: rendered.text },
              _meta: {
                type: "application_progress",
                application_id: appId,
                candidate_id: candidateId,
                status,
                created_at: FieldValue.serverTimestamp(),
              },
            });
          } catch (err) {
            if (!isAlreadyExistsError(err)) throw err;
          }
        }
      }
    } catch (err) {
      console.error("onApplicationStatusChange: failed to write notification", err);
      throw err;
    }
  }
);
