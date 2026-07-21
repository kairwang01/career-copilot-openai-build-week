/**
 * responsiveness — derives a per-employer responsiveness aggregate from the
 * application_status_events audit log (the data we already write). Powers an
 * anti-ghosting "typically responds within ~N days" / "active recently" badge on
 * job cards, WITHOUT any realtime presence or chat.
 *
 * onApplicationStatusEventCreated (Firestore trigger):
 *   - last_action_at = max(existing, this event)  — any employer action = recent activity.
 *   - On the FIRST transition out of "Applied" for an application (deduped via a
 *     first_actioned_at flag on the application), add days-from-apply to a rolling
 *     sum/count so the badge can show the average time to first action.
 *
 * employer_responsiveness/{employerId} is a coarse, employer-level, backward-
 * looking aggregate — no candidate PII. Client read is allowed (firestore.rules);
 * writes are server-only.
 */

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const toMillis = (v: unknown): number | null =>
  v && typeof (v as { toMillis?: unknown }).toMillis === "function"
    ? (v as Timestamp).toMillis()
    : null;

export const onApplicationStatusEventCreatedFunction = onDocumentCreated(
  { document: "application_status_events/{eventId}", retry: true },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const employerId = typeof data.employer_id === "string" ? data.employer_id : "";
    const applicationId = typeof data.application_id === "string" ? data.application_id : "";
    const fromStatus = typeof data.from_status === "string" ? data.from_status : "";
    const eventAt = data.created_at as Timestamp | undefined;
    if (!employerId) return;

    const respRef = db.collection("employer_responsiveness").doc(employerId);
    const appRef = applicationId ? db.collection("job_applications").doc(applicationId) : null;

    await db.runTransaction(async (tx) => {
      const respSnap = await tx.get(respRef);

      // Count days-to-first-action only on the first transition out of "Applied",
      // deduped via first_actioned_at so a back-and-forth can't double-count.
      let firstActionDays: number | null = null;
      if (fromStatus === "Applied" && appRef) {
        const appSnap = await tx.get(appRef);
        const app = appSnap.data();
        if (app && !app.first_actioned_at) {
          const appliedMs = toMillis(app.application_date);
          const eventMs = toMillis(eventAt);
          if (appliedMs !== null && eventMs !== null) {
            firstActionDays = Math.max(0, (eventMs - appliedMs) / 86_400_000);
          }
          tx.update(appRef, {
            first_actioned_at: eventAt ?? FieldValue.serverTimestamp(),
          });
        }
      }

      const cur = respSnap.exists ? respSnap.data()! : {};
      const sumDays = (typeof cur.sum_days === "number" ? cur.sum_days : 0) + (firstActionDays ?? 0);
      const count = (typeof cur.count === "number" ? cur.count : 0) + (firstActionDays !== null ? 1 : 0);
      const curLastMs = toMillis(cur.last_action_at) ?? 0;
      const eventMs = toMillis(eventAt) ?? 0;
      const lastActionAt = eventMs > curLastMs ? (eventAt ?? cur.last_action_at) : cur.last_action_at;

      tx.set(
        respRef,
        {
          employer_id: employerId,
          sum_days: sumDays,
          count,
          last_action_at: lastActionAt ?? FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });
  },
);
