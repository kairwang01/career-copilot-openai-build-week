/**
 * onUserCreated — Firebase Auth trigger.
 *
 * Fires automatically when a new user registers via Firebase Auth.
 * Creates the initial users/{uid} Firestore document with:
 *   - 150 starting credits
 *   - role: "candidate" (business roles are provisioned server-side only)
 *   - subscription_status: "free"
 *
 * Without this document, deductCredits throws "not-found" and every
 * AI call fails. This trigger makes registration → AI call work end-to-end.
 */

import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { INITIAL_CREDITS, USERS_COLLECTION, USER_FIELDS } from "../credits/schema";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export const onUserCreatedFunction = functions
  .runWith({ failurePolicy: true })
  .auth.user().onCreate(async (user) => {
  const ref = db.collection(USERS_COLLECTION).doc(user.uid);

  try {
    // Run inside a transaction. This trigger races the client signup flow's
    // setSubscriptionStatus callable (which may have already written role:'employer'
    // for a business account). A plain read+set() could clobber that role if this
    // trigger's write landed last. In a transaction, Firestore aborts+retries our
    // commit if the doc we read as absent was created concurrently — so we re-read
    // and take the no-clobber "fill the gaps only" path instead.
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const now = Timestamp.now();

      if (!snap.exists) {
        tx.set(ref, {
          [USER_FIELDS.credits]: INITIAL_CREDITS,
          [USER_FIELDS.role]: "candidate",
          [USER_FIELDS.roleProvenance]: "auth_user_created_trigger",
          [USER_FIELDS.roleProvisionedAt]: now,
          [USER_FIELDS.subscriptionStatus]: "free",
          [USER_FIELDS.fullName]: user.displayName ?? null,
          [USER_FIELDS.avatarUrl]: user.photoURL ?? null,
          [USER_FIELDS.createdAt]: now,
          [USER_FIELDS.updatedAt]: now,
        });
        return;
      }

      // Doc already created by the signup flow (e.g. business signup set
      // role:'employer'). Never clobber role/subscription_status — only fill gaps.
      const existing = snap.data() || {};
      const patch: Record<string, unknown> = { [USER_FIELDS.updatedAt]: now };
      if (existing[USER_FIELDS.credits] == null) patch[USER_FIELDS.credits] = INITIAL_CREDITS;
      if (existing[USER_FIELDS.role] == null) patch[USER_FIELDS.role] = "candidate";
      if (existing[USER_FIELDS.roleProvenance] == null) {
        patch[USER_FIELDS.roleProvenance] = "auth_user_created_trigger";
      }
      if (existing[USER_FIELDS.roleProvisionedAt] == null) {
        patch[USER_FIELDS.roleProvisionedAt] = now;
      }
      if (existing[USER_FIELDS.subscriptionStatus] == null) patch[USER_FIELDS.subscriptionStatus] = "free";
      // Backfill created_at if a client profile upsert created the doc first without it.
      // Firestore orderBy('created_at') silently drops field-less docs, which would
      // make such users invisible in the admin user list.
      if (existing[USER_FIELDS.createdAt] == null) patch[USER_FIELDS.createdAt] = now;
      if (existing[USER_FIELDS.fullName] == null && user.displayName) {
        patch[USER_FIELDS.fullName] = user.displayName;
      }
      if (existing[USER_FIELDS.avatarUrl] == null && user.photoURL) {
        patch[USER_FIELDS.avatarUrl] = user.photoURL;
      }
      tx.set(ref, patch, { merge: true });
    });
    console.log(`onUserCreated: provisioned users/${user.uid} with ${INITIAL_CREDITS} credits`);
  } catch (err) {
    console.error(`onUserCreated: failed to provision users/${user.uid}`, err);
    // This transaction is idempotent. Retry instead of leaving a broken account.
    throw err;
  }
});
