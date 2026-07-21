/**
 * Auth middleware for Firebase HTTPS Callable functions.
 *
 * Firebase automatically verifies the Firebase Auth ID token for onCall functions.
 * This module provides helpers to assert that auth is present, require a verified
 * email at product boundaries, and extract the uid uniformly across handlers.
 *
 * Convention (all endpoints):
 *   Frontend sends the Firebase ID token via the standard callables mechanism.
 *   Product handlers call requireAuth(request) → authenticated + verified email.
 *   Signup and billing recovery handlers call requireAnyAuth(request) because they
 *   must work before verification or after access is otherwise restricted.
 *
 * For plain HTTPS functions (not callable), a manual token-verification helper
 * will be added here in Phase B if needed.
 */

import * as admin from "firebase-admin";
import { CallableRequest, HttpsError } from "firebase-functions/v2/https";
import { PLATFORM_CONFIG_COLLECTION, PLATFORM_DOCS } from "../admin/schema";

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * Asserts that the callable request was made by an authenticated user, without
 * requiring email verification. Keep this narrow: account bootstrap, checkout,
 * billing management, and recovery paths must remain reachable before verification.
 * Firebase Callable functions automatically verify the ID token; this helper
 * just confirms the auth context is present and returns the uid.
 *
 * @returns The authenticated user's uid.
 * @throws HttpsError("unauthenticated") if the request has no valid auth context.
 */
export function requireAnyAuth(request: CallableRequest): string {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "You must be signed in to use this feature."
    );
  }
  return request.auth.uid;
}

/**
 * Requires the product's supported Firebase identities (email/password or Google)
 * to carry Firebase's verified-email claim. The app does not support anonymous,
 * phone-only, or custom-token identities, so a missing claim fails closed too.
 */
export function requireAuth(request: CallableRequest): string {
  const uid = requireAnyAuth(request);
  if (request.auth?.token.email_verified !== true) {
    throw new HttpsError(
      "permission-denied",
      "Verify your email address before using Career CoPilot features."
    );
  }
  return uid;
}

/** Returns true if uid has admin custom claim or is listed in platform_config/access. */
export async function isAdminUid(uid: string, token?: Record<string, unknown>): Promise<boolean> {
  if (token?.admin === true) return true;

  const envAdmins = (process.env.ADMIN_UIDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (envAdmins.includes(uid)) return true;

  const snap = await admin
    .firestore()
    .collection(PLATFORM_CONFIG_COLLECTION)
    .doc(PLATFORM_DOCS.access)
    .get();
  const listed: string[] = snap.data()?.admin_uids ?? [];
  return listed.includes(uid);
}

/**
 * Asserts the caller is an authenticated admin.
 * Grant access via: custom claim admin:true, ADMIN_UIDS env, or platform_config/access.
 */
export async function requireAdmin(request: CallableRequest): Promise<string> {
  const uid = requireAuth(request);
  const ok = await isAdminUid(uid, request.auth?.token as Record<string, unknown> | undefined);
  if (!ok) {
    throw new HttpsError("permission-denied", "Admin access required.");
  }
  return uid;
}
