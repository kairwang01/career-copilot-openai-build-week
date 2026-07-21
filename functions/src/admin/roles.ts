/**
 * Admin RBAC — role resolution and enforcement.
 *
 * Role hierarchy (lowest → highest):
 *   reviewer(0) < admin(1) < super(2)
 *
 * Resolution order for a given uid:
 *   (a) ADMIN_UIDS env bootstrap list → 'super'
 *   (b) platform_config/access.admins map (new RBAC store) → entry.status==='active' ? entry.role : null
 *   (c) LEGACY platform_config/access.admin_uids string[] → 'admin'
 *
 * The access doc is read through the existing platform-config TTL cache so
 * repeated calls within one TTL window pay no Firestore read.
 */

import * as admin from "firebase-admin";
import { CallableRequest, HttpsError } from "firebase-functions/v2/https";
import { requireAuth } from "../middleware/auth";
import { PLATFORM_CONFIG_COLLECTION, PLATFORM_DOCS } from "./schema";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// ---------------------------------------------------------------------------
// Public types (other agents code against these)
// ---------------------------------------------------------------------------

export type AdminRole = "super" | "admin" | "reviewer";

export interface AdminEntry {
  role: AdminRole;
  email?: string | null;
  invited_by?: string | null;
  invited_at?: string | null;
  status: "active" | "disabled";
}

// ---------------------------------------------------------------------------
// Role ordering helpers
// ---------------------------------------------------------------------------

const ROLE_ORDER: Record<AdminRole, number> = {
  reviewer: 0,
  admin: 1,
  super: 2,
};

const ROLE_SUMMARIES: Record<AdminRole, string> = {
  reviewer: "Reviewer can view the dashboard, audit log, and masked model routing settings.",
  admin: "Admin can manage users, credits, subscriptions, prompt drafts, quotas, API platform read-only views, and masked model routing settings.",
  super: "Super can do everything admin can, plus model/key edits, prompt publishing, console access, billing, API platform management, and Web3 settings.",
};

/** Returns true when `actual` satisfies the `required` minimum. */
export function roleAtLeast(actual: AdminRole, required: AdminRole): boolean {
  return ROLE_ORDER[actual] >= ROLE_ORDER[required];
}

export function adminRoleDeniedMessage(actual: AdminRole | null, required: AdminRole): string {
  const current = actual ?? "none";
  return [
    "This admin action is blocked.",
    `Current admin role: ${current}.`,
    `Required role: ${required} or higher.`,
    actual ? ROLE_SUMMARIES[actual] : "This account has no active admin role.",
    ROLE_SUMMARIES[required],
  ].join(" ");
}

// ---------------------------------------------------------------------------
// In-process access-doc cache (piggybacked on 60-second TTL)
// ---------------------------------------------------------------------------

interface AccessDocShape {
  admin_uids?: string[];
  admins?: Record<string, AdminEntry>;
}

let _accessCache: AccessDocShape | null = null;
let _accessCacheAt = 0;
const ACCESS_TTL_MS = 60_000;

/** Reads the access doc, using a per-process 60-second cache. */
async function getAccessDoc(): Promise<AccessDocShape> {
  if (_accessCache !== null && Date.now() - _accessCacheAt < ACCESS_TTL_MS) {
    return _accessCache;
  }
  const snap = await db
    .collection(PLATFORM_CONFIG_COLLECTION)
    .doc(PLATFORM_DOCS.access)
    .get();
  _accessCache = snap.exists ? (snap.data() as AccessDocShape) : {};
  _accessCacheAt = Date.now();
  return _accessCache;
}

/** Force-invalidates the access doc cache (call after any write to the access doc). */
export function invalidateAccessCache(): void {
  _accessCache = null;
  _accessCacheAt = 0;
}

// ---------------------------------------------------------------------------
// Core role resolution
// ---------------------------------------------------------------------------

/**
 * Resolves the AdminRole for `uid`, or returns null if the user is not an admin.
 *
 * Resolution order:
 *   (a) ADMIN_UIDS env bootstrap → 'super'
 *   (b) platform_config/access.admins[uid] with status==='active' → entry.role
 *   (c) platform_config/access.admin_uids[] (legacy) → 'admin'
 */
export async function getAdminRole(uid: string): Promise<AdminRole | null> {
  // (a) env bootstrap → super
  const envUids = (process.env.ADMIN_UIDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (envUids.includes(uid)) return "super";

  const access = await getAccessDoc();

  // (b) new RBAC admins map
  if (access.admins && typeof access.admins === "object") {
    const entry: AdminEntry | undefined = access.admins[uid];
    if (entry && entry.status === "active") {
      return entry.role;
    }
    // Explicitly disabled or wrong status — do NOT fall through to legacy list
    if (entry && entry.status === "disabled") return null;
  }

  // (c) legacy admin_uids array → 'admin'
  const legacyUids: string[] = access.admin_uids ?? [];
  if (legacyUids.includes(uid)) return "admin";

  return null;
}

// ---------------------------------------------------------------------------
// Enforcement helper used by all callables
// ---------------------------------------------------------------------------

/**
 * Asserts the caller is authenticated and has at least `min` role.
 *
 * @param request  The Firebase CallableRequest.
 * @param min      Minimum required role ('reviewer' | 'admin' | 'super').
 * @returns        { uid, role } of the verified caller.
 * @throws HttpsError('unauthenticated')  — no auth token present.
 * @throws HttpsError('permission-denied') — authenticated but insufficient role.
 */
export async function requireRole(
  request: CallableRequest<unknown>,
  min: AdminRole
): Promise<{ uid: string; role: AdminRole }> {
  const uid = requireAuth(request);
  const role = await getAdminRole(uid);
  if (role === null || !roleAtLeast(role, min)) {
    throw new HttpsError(
      "permission-denied",
      adminRoleDeniedMessage(role, min)
    );
  }
  return { uid, role };
}
