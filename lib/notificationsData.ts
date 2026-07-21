/**
 * notificationsData — client-side helpers for users/{uid}/notifications.
 *
 * Notification docs are written server-side only (Admin SDK via the
 * onApplicationStatusChange Firestore trigger). Clients may:
 *   - read / list their own notifications (onSnapshot or getDocs)
 *   - update the `read` field to true (mark-read)
 *   - NOT create or delete (firestore.rules enforce this)
 */

import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  limit,
  type DocumentData,
  type Unsubscribe,
} from "firebase/firestore";
import { firestoreDb } from "./firebaseClient";

export interface AppNotification {
  id: string;
  type: string;
  application_id: string | null;
  job_title: string | null;
  status: string | null;
  candidate_note: string | null;
  read: boolean;
  created_at: { toMillis?: () => number; toDate?: () => Date } | null;
}

const CAP = 30;

const mapNotification = (id: string, data: DocumentData): AppNotification => ({
  id,
  type: String(data.type ?? "application_status"),
  application_id: data.application_id ?? null,
  job_title: data.job_title ?? null,
  status: data.status ?? null,
  candidate_note: typeof data.candidate_note === "string" ? data.candidate_note : null,
  read: data.read === true,
  created_at: data.created_at ?? null,
});

/**
 * Subscribe to the most recent notifications for `uid`.
 * Returns an unsubscribe function.
 * Notifications are ordered newest-first (client-sort fallback if timestamps are pending).
 */
export const subscribeNotifications = (
  uid: string,
  onChange: (notifications: AppNotification[]) => void,
  onError?: (err: Error) => void
): Unsubscribe => {
  const q = query(
    collection(firestoreDb, "users", uid, "notifications"),
    orderBy("created_at", "desc"),
    limit(CAP)
  );
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => mapNotification(d.id, d.data()));
      // secondary sort: ensure pending server timestamps (null) land at top
      rows.sort((a, b) => (b.created_at?.toMillis?.() ?? Date.now()) - (a.created_at?.toMillis?.() ?? Date.now()));
      onChange(rows);
    },
    (err) => onError?.(err)
  );
};

/**
 * One-shot fetch of the most recent notifications for `uid`.
 */
export const listNotifications = async (uid: string): Promise<AppNotification[]> => {
  const q = query(
    collection(firestoreDb, "users", uid, "notifications"),
    orderBy("created_at", "desc"),
    limit(CAP)
  );
  const snap = await getDocs(q);
  const rows = snap.docs.map((d) => mapNotification(d.id, d.data()));
  // Same fallback as subscribeNotifications: a pending server timestamp (null)
  // sorts to the top, so the one-shot and live paths order identically.
  rows.sort((a, b) => (b.created_at?.toMillis?.() ?? Date.now()) - (a.created_at?.toMillis?.() ?? Date.now()));
  return rows;
};

/**
 * Mark a single notification as read.
 * Firestore rules allow the owner to update only the `read` field.
 */
export const markNotificationRead = async (uid: string, notificationId: string): Promise<void> => {
  await updateDoc(
    doc(firestoreDb, "users", uid, "notifications", notificationId),
    { read: true }
  );
};

/**
 * Count unread notifications in a list (no extra Firestore query needed).
 */
export const unreadCount = (notifications: AppNotification[]): number =>
  notifications.filter((n) => !n.read).length;
