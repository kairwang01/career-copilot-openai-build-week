/**
 * Admin portal callables — platform config, quotas, usage reports, user management.
 *
 * Role matrix (enforced server-side — frontend hiding is NOT sufficient):
 *   reviewer : adminGetDashboard, adminGetAuditLog, adminCheckAccess, adminWhoAmI,
 *              adminGetLlmConfig, adminListModels
 *   admin    : + adminGetQuotas,
 *                adminUpdateQuotas, adminListUsers, adminGetUserReport,
 *                adminAdjustCredits, adminSetSubscription, adminDeleteUser,
 *                adminCreateSampleAccounts, adminGetPrompts, adminUpdatePrompt,
 *                adminResetPrompt
 *   super    : + adminUpdateLlmConfig, adminUpsertModel, adminDeleteModel,
 *                adminTestModel, adminSetAdmin (LEGACY, deprecated),
 *                adminInviteAdmin, adminSetAdminRole, adminRemoveAdmin
 *
 * Security audit fixes applied (Sprint 3 Phase-0):
 *   A1  CRITICAL  Credit delta capped: |delta| ≤ 5000 per call; daily totals
 *                 ±20000 (operator) / ±100000 (super) via admin_daily_totals.
 *   A2  HIGH      adminSetAdmin now requires 'super' role.
 *   A3  HIGH      adminSetAdmin no longer returns admin_uids list.
 *   A4/A10 HIGH   reason: required, trimmed, minLength 10, maxLength 300.
 *   A6  MEDIUM    typeof uid === 'string' checks on all uid params.
 *   A7  MEDIUM    env UIDs hidden from plain admin list visibility.
 *   A12 LOW       Dashboard recent_events: uid masked to first 6 chars + '…'.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { randomBytes } from "crypto";
import { requireRole, getAdminRole, invalidateAccessCache, AdminEntry, AdminRole } from "../admin/roles";
import {
  CREDIT_LEDGER_COLLECTION,
  PLATFORM_CONFIG_COLLECTION,
  PLATFORM_DOCS,
  USAGE_EVENTS_COLLECTION,
  ADMIN_AUDIT_LOG_COLLECTION,
  ADMIN_DAILY_TOTALS_COLLECTION,
  USAGE_COUNTER_RECONCILIATION_REVIEWS_COLLECTION,
  QuotasDoc,
  LlmConfigDoc,
} from "../admin/schema";
import {
  DEFAULT_PLAN_QUOTAS,
  PLAN_KEYS,
  USER_VISIBLE_TOOL_KEYS,
  defaultToolQuota,
  effectivePlanQuotas,
  effectiveToolQuotas,
} from "../admin/quotaDefaults";
import {
  ensurePlatformCaches,
  getLlmConfigMasked,
  getQuotasConfigForAdmin,
  refreshPlatformCaches,
} from "../admin/platformConfig";
import {
  getTodayUsageTotals,
  logAdminAction,
  usageEventCountsAsMeteredAttempt,
  usageEventNetCreditCost,
} from "../admin/usageLog";
import { projectAdminUserProfile } from "../admin/userReportProjection";
import { USERS_COLLECTION, USER_FIELDS } from "../credits/schema";
import {
  ALL_SUBSCRIPTION_PLANS,
  assertPlanAllowedForRole,
} from "./setSubscriptionStatus";
import {
  JOB_POSTING_PURCHASE_UNAVAILABLE_MESSAGE,
  isLegacyJobPostingPurchasePlan,
} from "../billing/jobPostingPurchases";
import {
  ACCOUNT_DELETION_REQUESTS_COLLECTION,
  accountDeletionBillingBlocker,
  buildAccountDeletionPendingCleanup,
  completedAccountDeletionRequiresCredentialCleanup,
  decideAccountDeletionClaim,
  type AccountDeletionResult,
} from "../accountDeletion/plan";
import {
  CUSTOM_PROVIDER_CONFIG_COLLECTION,
  LEGACY_CUSTOM_PROVIDER_FIELD,
  deleteCustomProviderConfig,
} from "../llm/customProviderStore";

const SAMPLE_ACCOUNT_CREDITS = 100_000;

/**
 * Sample-account mutation is emulator-safe by default. Any non-emulator project
 * requires both an explicit enable flag and an exact project-id confirmation.
 */
export function isSampleAccountMutationEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.FUNCTIONS_EMULATOR === "true") return true;
  const projectId = (env.GCLOUD_PROJECT ?? env.GCP_PROJECT ?? "").trim();
  return Boolean(
    projectId &&
    env.ALLOW_SAMPLE_ACCOUNT_MUTATION === "true" &&
    env.SAMPLE_ACCOUNT_PROJECT_ID === projectId,
  );
}

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// ---------------------------------------------------------------------------
// Shared validation helpers
// ---------------------------------------------------------------------------

/**
 * Validates a uid param: must be a non-empty string, trimmed, max 128 chars.
 * Throws HttpsError('invalid-argument') on failure.
 */
function assertUid(uid: unknown, label = "uid"): string {
  if (typeof uid !== "string" || uid.trim().length === 0) {
    throw new HttpsError("invalid-argument", `${label} must be a non-empty string.`);
  }
  const trimmed = uid.trim();
  if (trimmed.length > 128) {
    throw new HttpsError("invalid-argument", `${label} is too long (max 128 chars).`);
  }
  return trimmed;
}

/**
 * Validates a reason param: required, trimmed, min 10, max 300 chars.
 * Throws HttpsError('invalid-argument') on failure.
 * Used by every callable that logs a reason (A4/A10).
 */
function assertReason(reason: unknown): string {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new HttpsError("invalid-argument", "reason is required and must be a non-empty string.");
  }
  const trimmed = reason.trim();
  if (trimmed.length < 10) {
    throw new HttpsError("invalid-argument", "reason must be at least 10 characters.");
  }
  if (trimmed.length > 300) {
    throw new HttpsError("invalid-argument", "reason must not exceed 300 characters.");
  }
  return trimmed;
}

function assertEmail(email: unknown, label = "email"): string {
  if (typeof email !== "string" || email.trim().length === 0) {
    throw new HttpsError("invalid-argument", `${label} must be a non-empty string.`);
  }
  const trimmed = email.trim().toLowerCase();
  if (trimmed.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new HttpsError("invalid-argument", `${label} must be a valid email address.`);
  }
  return trimmed;
}

function isAuthUserNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "auth/user-not-found"
  );
}

function samplePassword(): string {
  return `Cc-${randomBytes(9).toString("base64url")}-26!`;
}

function startOfUtcDaysAgo(days: number): Timestamp {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return Timestamp.fromDate(d);
}

function assertNonNegativeInt(value: unknown, label: string, max = 1_000_000): number {
  const v = Number(value ?? 0);
  if (!Number.isInteger(v) || v < 0 || v > max) {
    throw new HttpsError("invalid-argument", `${label} must be an integer between 0 and ${max}.`);
  }
  return v;
}

/** Returns today's UTC date string as YYYYMMDD, used for daily-total doc ids. */
function utcTodayKey(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

export function profileAvatarUrl(profile: FirebaseFirestore.DocumentData | undefined, authUser?: admin.auth.UserRecord): string | null {
  const value = profile?.[USER_FIELDS.avatarUrl] ?? profile?.avatarUrl ?? profile?.photo_url;
  return typeof value === "string" && value.trim() ? value : authUser?.photoURL ?? null;
}

// ---------------------------------------------------------------------------
// A1: Credit adjustment caps
// ---------------------------------------------------------------------------

const PER_CALL_DELTA_CAP = 5_000;
const DAILY_TOTAL_CAP_ADMIN = 20_000;
const DAILY_TOTAL_CAP_SUPER = 100_000;

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/** Dashboard summary: users, today's usage, 7-day tool breakdown. */
export const adminGetDashboardFunction = onCall({ invoker: "public" }, async (request) => {
  await requireRole(request, "reviewer");

  const userLimit = 2000;
  const weekUsageLimit = 5000;
  const pendingReviewLimit = 100;
  const usersSnap = await db.collection(USERS_COLLECTION).limit(userLimit + 1).get();
  const today = await getTodayUsageTotals();

  const weekStart = startOfUtcDaysAgo(7);
  const usageSnap = await db
    .collection(USAGE_EVENTS_COLLECTION)
    .where("created_at", ">=", weekStart)
    .where("status", "in", ["deducted", "free"])
    .limit(weekUsageLimit + 1)
    .get();
  const usageDocs = usageSnap.docs.slice(0, weekUsageLimit);

  const byTool: Record<string, { runs: number; credits: number }> = {};
  const byUser: Record<string, number> = {};

  usageDocs.forEach((doc) => {
    const d = doc.data();
    if (!usageEventCountsAsMeteredAttempt(d)) return;
    const tool = typeof d.tool === "string" && d.tool.trim()
      ? d.tool
      : "(unknown)";
    const cost = usageEventNetCreditCost(d);
    const uid = d.uid as string;
    if (!byTool[tool]) byTool[tool] = { runs: 0, credits: 0 };
    byTool[tool].runs += 1;
    if (cost > 0) {
      byTool[tool].credits += cost;
      if (uid) byUser[uid] = (byUser[uid] ?? 0) + cost;
    }
  });

  // Uncharged ("observed") tool volume — recorded for visibility only, never hits a
  // credit counter or cap. Aggregated from a SEPARATE query and returned on its own
  // field so it never distorts the metered-attempt/net-spend metrics above. Reuses
  // the same (status, created_at) index the metered query already relies on.
  const freeUsageSnap = await db
    .collection(USAGE_EVENTS_COLLECTION)
    .where("created_at", ">=", weekStart)
    .where("status", "==", "observed")
    .limit(weekUsageLimit + 1)
    .get();
  const freeByTool: Record<string, { runs: number }> = {};
  freeUsageSnap.docs.slice(0, weekUsageLimit).forEach((doc) => {
    const rawTool = doc.data().tool;
    const tool = typeof rawTool === "string" && rawTool.trim()
      ? rawTool
      : "(unknown)";
    if (!freeByTool[tool]) freeByTool[tool] = { runs: 0 };
    freeByTool[tool].runs += 1;
  });

  const topUsers = Object.entries(byUser)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([uid, credits_spent]) => ({ uid, credits_spent }));

  const recentSnap = await db
    .collection(USAGE_EVENTS_COLLECTION)
    .orderBy("created_at", "desc")
    .limit(25)
    .get();
  const pendingCounterReviewSnap = await db
    .collection(USAGE_COUNTER_RECONCILIATION_REVIEWS_COLLECTION)
    .where("status", "==", "pending")
    .limit(pendingReviewLimit + 1)
    .get();

  // A12: mask uid to first 6 chars + '…'; explicitly select fields (no spread).
  const recent = recentSnap.docs.map((doc) => {
    const d = doc.data();
    const rawUid = typeof d.uid === "string" ? d.uid : "";
    return {
      id: doc.id,
      uid: rawUid.length > 6 ? rawUid.slice(0, 6) + "…" : rawUid,
      tool: d.tool ?? null,
      credit_cost: d.credit_cost ?? null,
      status: d.status ?? null,
      refund_status: d.refund_status ?? null,
      refund_usage_counter_status: d.refund_usage_counter_status ?? null,
      created_at: d.created_at?.toDate?.()?.toISOString?.() ?? null,
    };
  });

  const quotas = await getQuotasConfigForAdmin();

  return {
    user_count: Math.min(usersSnap.size, userLimit),
    users_truncated: usersSnap.size > userLimit,
    today_runs: today.runs,
    today_credits: today.credits,
    week_tool_breakdown: byTool,
    week_usage_truncated: usageSnap.size > weekUsageLimit,
    free_tool_breakdown: freeByTool,
    free_usage_truncated: freeUsageSnap.size > weekUsageLimit,
    top_users_week: topUsers,
    recent_events: recent,
    pending_usage_counter_reviews: Math.min(pendingCounterReviewSnap.size, pendingReviewLimit),
    pending_usage_counter_reviews_truncated: pendingCounterReviewSnap.size > pendingReviewLimit,
    quotas,
  };
});

// ---------------------------------------------------------------------------
// LLM Config
// ---------------------------------------------------------------------------

/** Masked LLM config for the settings form. */
export const adminGetLlmConfigFunction = onCall({ invoker: "public" }, async (request) => {
  await requireRole(request, "reviewer");
  return getLlmConfigMasked();
});

interface UpdateLlmRequest {
  gemini_api_key?: string;
  gemini_model?: string;
  gemini_fallback_model?: string;
  kairllm_api_key?: string;
  kairllm_base_url?: string;
  deepseek_api_key?: string;
  deepseek_base_url?: string;
}

/** Update API keys / models (empty string = leave unchanged). */
export const adminUpdateLlmConfigFunction = onCall({ invoker: "public" }, async (request) => {
  const { uid: adminUid } = await requireRole(request, "super");
  const data = (request.data ?? {}) as UpdateLlmRequest;

  const ref = db.collection(PLATFORM_CONFIG_COLLECTION).doc(PLATFORM_DOCS.llm);
  const existing = (await ref.get()).data() as LlmConfigDoc | undefined;
  const patch: LlmConfigDoc = {
    gemini_model: data.gemini_model?.trim() || existing?.gemini_model,
    gemini_fallback_model:
      data.gemini_fallback_model?.trim() || existing?.gemini_fallback_model,
    kairllm_base_url: data.kairllm_base_url?.trim() || existing?.kairllm_base_url,
    deepseek_base_url: data.deepseek_base_url?.trim() || existing?.deepseek_base_url,
    updated_at: new Date().toISOString(),
    updated_by: adminUid,
  };

  if (data.gemini_api_key?.trim()) patch.gemini_api_key = data.gemini_api_key.trim();
  if (data.kairllm_api_key?.trim()) patch.kairllm_api_key = data.kairllm_api_key.trim();
  if (data.deepseek_api_key?.trim()) patch.deepseek_api_key = data.deepseek_api_key.trim();

  // Firestore rejects `undefined` field values (ignoreUndefinedProperties is not
  // enabled), so a field that resolved to undefined — e.g. saving one provider
  // with a blank fallback model / base URL and no prior value — would make
  // ref.set() throw a 500 and block restoring keys. Drop undefined entries.
  for (const key of Object.keys(patch) as (keyof LlmConfigDoc)[]) {
    if (patch[key] === undefined) delete patch[key];
  }

  await ref.set(patch, { merge: true });
  await refreshPlatformCaches();
  await logAdminAction({
    admin_uid: adminUid,
    action: "update_llm_config",
    details: {
      gemini_model: patch.gemini_model ?? null,
      gemini_fallback_model: patch.gemini_fallback_model ?? null,
      kairllm_base_url: patch.kairllm_base_url ?? null,
      deepseek_base_url: patch.deepseek_base_url ?? null,
      gemini_api_key_changed: !!data.gemini_api_key?.trim(),
      kairllm_api_key_changed: !!data.kairllm_api_key?.trim(),
      deepseek_api_key_changed: !!data.deepseek_api_key?.trim(),
    },
  });
  return getLlmConfigMasked();
});

// ---------------------------------------------------------------------------
// Quotas
// ---------------------------------------------------------------------------

/** Get quota settings. */
export const adminGetQuotasFunction = onCall({ invoker: "public" }, async (request) => {
  await requireRole(request, "admin");
  return getQuotasConfigForAdmin();
});

type QuotaChange = { field: string; from: unknown; to: unknown };

/** Field-level diff of two quota configs for an auditable "who changed what from→to" trail. */
function diffQuotaConfig(before: QuotasDoc, after: QuotasDoc): QuotaChange[] {
  const changes: QuotaChange[] = [];
  const norm = (v: unknown) => (v === undefined ? null : v);
  const push = (field: string, from: unknown, to: unknown) => {
    if (JSON.stringify(norm(from)) !== JSON.stringify(norm(to))) {
      changes.push({ field, from: norm(from), to: norm(to) });
    }
  };
  const b = before as unknown as Record<string, unknown>;
  const a = after as unknown as Record<string, unknown>;
  for (const k of [
    "daily_tool_run_limit", "daily_credit_spend_limit", "per_user_daily_credit_limit",
    "free_max_output_tokens", "mi_min_tier", "mi_report_unlock_credits", "enabled",
  ]) {
    if (k in a) push(k, b[k], a[k]);
  }
  for (const plan of PLAN_KEYS) {
    const bp = (before.plan_quotas?.[plan] ?? {}) as Record<string, unknown>;
    const ap = (after.plan_quotas?.[plan] ?? {}) as Record<string, unknown>;
    for (const f of ["daily_run_limit", "daily_credit_limit", "monthly_credit_grant", "active_job_limit"]) {
      push(`plan.${plan}.${f}`, bp[f], ap[f]);
    }
  }
  const toolKeys = new Set([
    ...Object.keys(before.tool_quotas ?? {}),
    ...Object.keys(after.tool_quotas ?? {}),
  ]);
  for (const tool of toolKeys) {
    const bt = (before.tool_quotas?.[tool] ?? {}) as Record<string, unknown>;
    const at = (after.tool_quotas?.[tool] ?? {}) as Record<string, unknown>;
    push(`tool.${tool}.enabled`, bt.enabled, at.enabled);
    push(`tool.${tool}.credit_cost`, bt.credit_cost, at.credit_cost);
    push(`tool.${tool}.allowed_plans`, bt.allowed_plans, at.allowed_plans);
  }
  return changes;
}

/** Update global / per-user daily limits (0 = unlimited). */
export const adminUpdateQuotasFunction = onCall({ invoker: "public" }, async (request) => {
  const { uid: adminUid } = await requireRole(request, "admin");
  const data = (request.data ?? {}) as QuotasDoc;
  const before = await getQuotasConfigForAdmin();

  for (const key of Object.keys(data.plan_quotas ?? {})) {
    if (!PLAN_KEYS.includes(key as (typeof PLAN_KEYS)[number])) {
      throw new HttpsError("invalid-argument", `Unknown plan quota key: ${key}`);
    }
  }

  const basePlanQuotas = effectivePlanQuotas(data);
  const plan_quotas = {} as NonNullable<QuotasDoc["plan_quotas"]>;
  for (const key of PLAN_KEYS) {
    const row = basePlanQuotas[key] ?? DEFAULT_PLAN_QUOTAS[key];
    plan_quotas[key] = {
      daily_run_limit: assertNonNegativeInt(row.daily_run_limit, `plan_quotas.${key}.daily_run_limit`),
      daily_credit_limit: assertNonNegativeInt(row.daily_credit_limit, `plan_quotas.${key}.daily_credit_limit`),
      monthly_credit_grant: assertNonNegativeInt(row.monthly_credit_grant, `plan_quotas.${key}.monthly_credit_grant`),
      active_job_limit: assertNonNegativeInt(row.active_job_limit, `plan_quotas.${key}.active_job_limit`),
    };
  }

  const rawToolQuotas = data.tool_quotas ?? {};
  const allowedToolKeys = new Set([...USER_VISIBLE_TOOL_KEYS, ...Object.keys(rawToolQuotas)]);
  const effectiveTools = effectiveToolQuotas(data);
  const tool_quotas: NonNullable<QuotasDoc["tool_quotas"]> = {};
  for (const key of Array.from(allowedToolKeys).sort()) {
    if (!defaultToolQuota(key)) {
      throw new HttpsError("invalid-argument", `Unknown tool quota key: ${key}`);
    }
    const rawAllowed = rawToolQuotas[key]?.allowed_plans;
    if (Array.isArray(rawAllowed)) {
      for (const plan of rawAllowed) {
        if (!PLAN_KEYS.includes(plan)) {
          throw new HttpsError("invalid-argument", `Invalid allowed plan "${plan}" for tool ${key}.`);
        }
      }
    }
    const row = effectiveTools[key];
    if (!row) continue;
    const allowed = Array.isArray(row.allowed_plans) ? row.allowed_plans : [];
    const seen = new Set<string>();
    tool_quotas[key] = {
      enabled: row.enabled !== false,
      credit_cost: assertNonNegativeInt(row.credit_cost, `tool_quotas.${key}.credit_cost`, 100000),
      allowed_plans: allowed.filter((plan) => {
        if (!PLAN_KEYS.includes(plan) || seen.has(plan)) return false;
        seen.add(plan);
        return true;
      }),
    };
  }

  const patch: QuotasDoc = {
    daily_tool_run_limit: assertNonNegativeInt(data.daily_tool_run_limit, "daily_tool_run_limit"),
    daily_credit_spend_limit: assertNonNegativeInt(data.daily_credit_spend_limit, "daily_credit_spend_limit"),
    per_user_daily_credit_limit: assertNonNegativeInt(data.per_user_daily_credit_limit, "per_user_daily_credit_limit"),
    plan_quotas,
    tool_quotas,
    enabled: data.enabled !== false,
    updated_at: new Date().toISOString(),
    updated_by: adminUid,
  };

  // free_max_output_tokens: optional positive int, 256–32768.
  if (data.free_max_output_tokens !== undefined && data.free_max_output_tokens !== null) {
    const v = Number(data.free_max_output_tokens);
    if (!Number.isInteger(v) || v < 256 || v > 32768) {
      throw new HttpsError(
        "invalid-argument",
        "free_max_output_tokens must be an integer between 256 and 32768."
      );
    }
    patch.free_max_output_tokens = v;
  }

  // Mock-interview gate: which tier may run the simulation (post-MVP decision knob).
  if (data.mi_min_tier !== undefined && data.mi_min_tier !== null) {
    if (data.mi_min_tier !== "free" && data.mi_min_tier !== "paid") {
      throw new HttpsError("invalid-argument", 'mi_min_tier must be "free" or "paid".');
    }
    patch.mi_min_tier = data.mi_min_tier;
  }
  // Report unlock price for non-included tiers (0 = free unlock).
  if (data.mi_report_unlock_credits !== undefined && data.mi_report_unlock_credits !== null) {
    const v = Number(data.mi_report_unlock_credits);
    if (!Number.isInteger(v) || v < 0 || v > 100000) {
      throw new HttpsError(
        "invalid-argument",
        "mi_report_unlock_credits must be an integer between 0 and 100000."
      );
    }
    patch.mi_report_unlock_credits = v;
  }

  const changes = diffQuotaConfig(before, patch);
  await db.collection(PLATFORM_CONFIG_COLLECTION).doc(PLATFORM_DOCS.quotas).set(patch, { merge: true });
  await refreshPlatformCaches();
  await logAdminAction({
    admin_uid: adminUid,
    action: "update_quotas",
    // Auditable field-level diff (who changed which plan/tool from → to) rather than a
    // full config dump, so the audit log replays exactly what each admin edited.
    details: { changed_count: changes.length, changes },
  });
  return getQuotasConfigForAdmin();
});

// ---------------------------------------------------------------------------
// User listing and reports
// ---------------------------------------------------------------------------

interface ListUsersRequest {
  limit?: number;
  start_after_uid?: string;
  search?: string;
  roles?: string[];
  plans?: string[];
  created_after?: string;
}

const USER_LIST_SCAN_LIMIT = 2000;

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

async function authUsersByUid(uids: string[]): Promise<Map<string, admin.auth.UserRecord>> {
  const out = new Map<string, admin.auth.UserRecord>();
  for (let i = 0; i < uids.length; i += 100) {
    const res = await admin.auth().getUsers(uids.slice(i, i + 100).map((uid) => ({ uid })));
    res.users.forEach((user) => out.set(user.uid, user));
  }
  return out;
}

/** Paginated user list for the admin table. */
export const adminListUsersFunction = onCall({ invoker: "public" }, async (request) => {
  await requireRole(request, "admin");
  const {
    limit = 50,
    start_after_uid,
    search,
    roles = [],
    plans = [],
    created_after,
  } = (request.data ?? {}) as ListUsersRequest;
  const pageSize = Math.min(Math.max(limit, 1), 100);
  const term = typeof search === "string" ? search.trim().toLowerCase() : "";
  const roleSet = new Set(Array.isArray(roles) ? roles.filter((v) => typeof v === "string" && v) : []);
  const planSet = new Set(Array.isArray(plans) ? plans.filter((v) => typeof v === "string" && v) : []);
  const createdAfterMs = typeof created_after === "string" ? Date.parse(created_after) : NaN;
  const filtered = Boolean(term || roleSet.size || planSet.size || !Number.isNaN(createdAfterMs));

  let q = db
    .collection(USERS_COLLECTION)
    .orderBy(USER_FIELDS.createdAt, "desc")
    .limit(filtered ? USER_LIST_SCAN_LIMIT : pageSize);
  if (start_after_uid) {
    const cursor = await db.collection(USERS_COLLECTION).doc(start_after_uid).get();
    if (cursor.exists && !filtered) q = q.startAfter(cursor);
  }

  const snap = await q.get();
  const authByUid = await authUsersByUid(snap.docs.map((doc) => doc.id));
  const rows = snap.docs.map((doc) => {
    const d = doc.data();
    const authUser = authByUid.get(doc.id);
    return {
      uid: doc.id,
      email: authUser?.email ?? (typeof d.email === "string" ? d.email : null),
      full_name: d.full_name ?? authUser?.displayName ?? null,
      avatar_url: profileAvatarUrl(d, authUser),
      role: d.role ?? null,
      subscription_status: d.subscription_status ?? null,
      credits: d.credits ?? 0,
      created_at: toIso(d.created_at),
      updated_at: toIso(d.updated_at),
    };
  });
  const matching = filtered
    ? rows.filter((u) => {
        const joined = u.created_at ? Date.parse(u.created_at) : NaN;
        return (
          (!term ||
            u.uid.toLowerCase().includes(term) ||
            (u.full_name ?? "").toLowerCase().includes(term) ||
            (u.email ?? "").toLowerCase().includes(term)) &&
          (!roleSet.size || roleSet.has(u.role ?? "")) &&
          (!planSet.size || planSet.has(u.subscription_status ?? "")) &&
          (Number.isNaN(createdAfterMs) || (!Number.isNaN(joined) && joined >= createdAfterMs))
        );
      })
    : rows;
  const cursorIdx = filtered && start_after_uid
    ? matching.findIndex((u) => u.uid === start_after_uid)
    : -1;
  // A provided-but-unfound cursor means the results past the scan window are
  // exhausted — return an empty page instead of silently resetting to page 1,
  // which would loop the admin list forever.
  if (filtered && start_after_uid && cursorIdx === -1) {
    return { users: [], next_cursor: null };
  }
  const start = cursorIdx + 1; // -1 (no cursor) → 0
  const page = matching.slice(start, start + pageSize);
  return {
    users: page,
    next_cursor: filtered
      ? (page.length === pageSize && start + pageSize < matching.length ? page[page.length - 1].uid : null)
      : (snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1].id : null),
  };
});

interface UserReportRequest {
  uid: string;
}

/** Per-user profile and 7-day usage summary for the admin detail panel. */
export const adminGetUserReportFunction = onCall({ invoker: "public" }, async (request) => {
  await requireRole(request, "admin");
  const rawData = (request.data ?? {}) as UserReportRequest;
  // A6: explicit string type-check
  const uid = assertUid(rawData.uid);

  const weekStart = startOfUtcDaysAgo(7);
  const authInfoPromise = admin.auth().getUser(uid).then(
    (authUser) => ({
      email: authUser.email ?? null,
      email_verified: authUser.emailVerified,
      disabled: authUser.disabled,
      display_name: authUser.displayName ?? null,
      auth_created_at: authUser.metadata.creationTime ?? null,
      last_sign_in: authUser.metadata.lastSignInTime ?? null,
    }),
    () => null
  );
  const [userSnap, usageSnap, authInfo] = await Promise.all([
    db.collection(USERS_COLLECTION).doc(uid).get(),
    db
      .collection(USAGE_EVENTS_COLLECTION)
      .where("uid", "==", uid)
      .where("status", "in", ["deducted", "free"])
      .where("created_at", ">=", weekStart)
      .limit(201)
      .get(),
    authInfoPromise,
  ]);
  if (!userSnap.exists) throw new HttpsError("not-found", "User not found.");

  const byTool: Record<string, number> = {};
  let meteredAttempts = 0;
  usageSnap.docs.slice(0, 200).forEach((doc) => {
    const data = doc.data();
    if (!usageEventCountsAsMeteredAttempt(data)) return;
    meteredAttempts += 1;
    const tool = typeof data.tool === "string" && data.tool.trim()
      ? data.tool
      : "(unknown)";
    byTool[tool] = (byTool[tool] ?? 0) + 1;
  });

  const docData = userSnap.data() ?? {};
  return {
    profile: projectAdminUserProfile(uid, docData, authInfo?.email),
    auth: authInfo,
    week_runs: meteredAttempts,
    week_by_tool: byTool,
    week_usage_truncated: usageSnap.size > 200,
  };
});

// ---------------------------------------------------------------------------
// Credit adjustment — A1/A4/A6
// ---------------------------------------------------------------------------

interface AdjustCreditsRequest {
  uid: string;
  delta: number;
  reason: string;
}

/**
 * Atomically adjusts credits, consumes the operator's daily allowance, and
 * writes both immutable audit records. Failed operations consume nothing.
 */
export async function adminAdjustCreditsImpl(
  adminUidInput: string,
  adminRole: AdminRole,
  targetUidInput: unknown,
  delta: unknown,
  reasonInput: unknown,
): Promise<{ uid: string; credits: number }> {
  const adminUid = assertUid(adminUidInput, "adminUid");
  const uid = assertUid(targetUidInput);
  if (typeof delta !== "number" || !Number.isInteger(delta) || delta === 0) {
    throw new HttpsError("invalid-argument", "delta must be a non-zero integer.");
  }
  if (Math.abs(delta) > PER_CALL_DELTA_CAP) {
    throw new HttpsError(
      "invalid-argument",
      `|delta| must not exceed ${PER_CALL_DELTA_CAP} per call.`,
    );
  }
  const reason = assertReason(reasonInput);

  const dayKey = utcTodayKey();
  const cap = adminRole === "super" ? DAILY_TOTAL_CAP_SUPER : DAILY_TOTAL_CAP_ADMIN;
  const userRef = db.collection(USERS_COLLECTION).doc(uid);
  const dailyRef = db.collection(ADMIN_DAILY_TOTALS_COLLECTION).doc(`${adminUid}_${dayKey}`);
  const ledgerRef = db.collection(CREDIT_LEDGER_COLLECTION).doc();
  const auditRef = db.collection(ADMIN_AUDIT_LOG_COLLECTION).doc();
  const createdAt = new Date().toISOString();
  let beforeCredits = 0;
  let afterCredits = 0;

  await db.runTransaction(async (tx) => {
    const [dailySnap, userSnap] = await tx.getAll(dailyRef, userRef);
    if (!userSnap.exists) throw new HttpsError("not-found", "User not found.");

    const currentDailyTotal = Number(dailySnap.data()?.total ?? 0);
    if (!Number.isFinite(currentDailyTotal) || currentDailyTotal < 0) {
      throw new HttpsError("internal", "The operator daily adjustment total is invalid.");
    }
    const nextDailyTotal = currentDailyTotal + Math.abs(delta);
    if (nextDailyTotal > cap) {
      throw new HttpsError(
        "resource-exhausted",
        `Daily credit-adjustment cap exceeded. Limit: +/-${cap} per day.`,
      );
    }

    beforeCredits = Number(userSnap.get(USER_FIELDS.credits) ?? 0);
    if (!Number.isFinite(beforeCredits) || !Number.isInteger(beforeCredits) || beforeCredits < 0) {
      throw new HttpsError("failed-precondition", "The user's credit balance is invalid.");
    }
    afterCredits = beforeCredits + delta;
    if (afterCredits < 0) {
      throw new HttpsError("failed-precondition", "Adjustment would make credits negative.");
    }

    tx.set(dailyRef, {
      total: nextDailyTotal,
      operator_uid: adminUid,
      date: dayKey,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.update(userRef, {
      [USER_FIELDS.credits]: afterCredits,
      [USER_FIELDS.updatedAt]: createdAt,
    });
    tx.create(ledgerRef, {
      uid,
      amount: delta,
      balance_after: afterCredits,
      reason,
      admin_uid: adminUid,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.create(auditRef, {
      admin_uid: adminUid,
      action: "adjust_credits",
      target_uid: uid,
      details: {
        operatorUid: adminUid,
        operatorRole: adminRole,
        targetUid: uid,
        delta,
        beforeCredits,
        afterCredits,
        reason,
        createdAt,
      },
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { uid, credits: afterCredits };
}

/** Add or remove credits with an atomic audit trail. */
export const adminAdjustCreditsFunction = onCall({ invoker: "public" }, async (request) => {
  const { uid: adminUid, role: adminRole } = await requireRole(request, "admin");
  const rawData = (request.data ?? {}) as AdjustCreditsRequest;
  return adminAdjustCreditsImpl(adminUid, adminRole, rawData.uid, rawData.delta, rawData.reason);
});

// ---------------------------------------------------------------------------
// Subscription management
// ---------------------------------------------------------------------------

interface SetSubscriptionRequest {
  uid: string;
  subscription_status: string;
}

export async function adminSetSubscriptionImpl(adminUid: string, uid: string, subscriptionStatus: unknown) {
  if (typeof subscriptionStatus !== "string") {
    throw new HttpsError("invalid-argument", "subscription_status must be a string.");
  }
  const plan = subscriptionStatus.trim();
  if (!ALL_SUBSCRIPTION_PLANS.has(plan)) {
    throw new HttpsError("invalid-argument", `Unknown plan: ${plan}`);
  }
  if (isLegacyJobPostingPurchasePlan(plan)) {
    throw new HttpsError("failed-precondition", JOB_POSTING_PURCHASE_UNAVAILABLE_MESSAGE);
  }

  const userRef = db.collection(USERS_COLLECTION).doc(uid);
  const snap = await userRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "User not found.");
  const previous = snap.get(USER_FIELDS.subscriptionStatus) ?? null;
  const role = snap.get(USER_FIELDS.role) ?? "candidate";
  assertPlanAllowedForRole(role, plan);

  const patch: Record<string, unknown> = {
    [USER_FIELDS.subscriptionStatus]: plan,
    [USER_FIELDS.updatedAt]: new Date().toISOString(),
  };

  await userRef.update(patch);
  await logAdminAction({
    admin_uid: adminUid,
    action: "set_subscription",
    target_uid: uid,
    details: { from: previous, to: plan },
  });

  return { uid, subscription_status: plan };
}

/** Set a user's subscription tier (admin override). */
export const adminSetSubscriptionFunction = onCall({ invoker: "public" }, async (request) => {
  const { uid: adminUid } = await requireRole(request, "admin");
  const rawData = (request.data ?? {}) as SetSubscriptionRequest;
  // A6: explicit string check
  const uid = assertUid(rawData.uid);
  return adminSetSubscriptionImpl(adminUid, uid, rawData.subscription_status);
});

// ---------------------------------------------------------------------------
// User deletion + sample account provisioning
// ---------------------------------------------------------------------------

interface DeleteUserRequest {
  uid?: string;
  email?: string;
  reason: string;
}

interface AccountDeletionProgress {
  authExistedAtStart: boolean;
  profileExistedAtStart: boolean;
  authAbsent: boolean;
  profileAbsent: boolean;
  authDeleteApiSucceeded: boolean;
  profileDeleteApiSucceeded: boolean;
  privateCredentialsDeleteApiSucceeded: boolean;
  auditLogged: boolean;
}

async function updateAccountDeletionProgress(
  ref: admin.firestore.DocumentReference,
  ownerToken: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.get("status") !== "deleting" || snap.get("owner_token") !== ownerToken) {
      throw new HttpsError("aborted", "Account deletion ownership changed; retry the operation.");
    }
    tx.set(ref, {
      ...patch,
      lease_expires_at_ms: Date.now() + 2 * 60_000,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

async function releaseAccountDeletion(
  ref: admin.firestore.DocumentReference,
  ownerToken: string,
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.get("status") !== "deleting" || snap.get("owner_token") !== ownerToken) return;
    tx.set(ref, {
      status: "retryable",
      lease_expires_at_ms: 0,
      last_failed_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

/** Delete Firebase Auth, private credentials, and users/{uid}; inventory policy-bound records. */
export async function adminDeleteUserImpl(
  adminUid: string,
  adminRole: AdminRole,
  rawData: DeleteUserRequest,
): Promise<AccountDeletionResult> {
  const reason = assertReason(rawData.reason);

  let targetUid = typeof rawData.uid === "string" && rawData.uid.trim()
    ? assertUid(rawData.uid)
    : "";
  let authUser: admin.auth.UserRecord | null = null;
  let requestedEmail: string | null = null;

  if (!targetUid) {
    const email = assertEmail(rawData.email, "email");
    requestedEmail = email;
    try {
      authUser = await admin.auth().getUserByEmail(email);
      targetUid = authUser.uid;
    } catch (error) {
      if (isAuthUserNotFound(error)) {
        const prior = await db
          .collection(ACCOUNT_DELETION_REQUESTS_COLLECTION)
          .where("email", "==", email)
          .limit(2)
          .get();
        if (prior.empty) {
          throw new HttpsError("not-found", "Auth user not found for that email.");
        }
        if (prior.size !== 1) {
          throw new HttpsError(
            "failed-precondition",
            "More than one deletion record uses that email. Retry with the exact uid.",
          );
        }
        targetUid = assertUid(prior.docs[0].get("target_uid"), "stored target uid");
      } else {
        throw error;
      }
    }
  }

  if (targetUid === adminUid) {
    throw new HttpsError("failed-precondition", "Admins cannot delete their own account.");
  }

  const targetAdminRole = await getAdminRole(targetUid);
  if (targetAdminRole) {
    throw new HttpsError(
      "failed-precondition",
      "Admin or reviewer accounts must be removed from Access Control before account deletion."
    );
  }

  if (!authUser) {
    try {
      authUser = await admin.auth().getUser(targetUid);
    } catch (error) {
      if (!isAuthUserNotFound(error)) throw error;
    }
  }

  const userRef = db.collection(USERS_COLLECTION).doc(targetUid);
  const billingRef = db.collection("billing").doc(targetUid);
  const privateCredentialsRef = db.collection(CUSTOM_PROVIDER_CONFIG_COLLECTION).doc(targetUid);
  const deletionRef = db.collection(ACCOUNT_DELETION_REQUESTS_COLLECTION).doc(targetUid);
  const [profileSnap, billingSnap, privateCredentialsSnap, deletionSnap, userSubcollections] = await Promise.all([
    userRef.get(),
    billingRef.get(),
    privateCredentialsRef.get(),
    deletionRef.get(),
    userRef.listCollections(),
  ]);
  const profile = profileSnap.exists ? profileSnap.data() ?? {} : {};
  const hasLegacyPrivateCredentials = Object.prototype.hasOwnProperty.call(
    profile,
    LEGACY_CUSTOM_PROVIDER_FIELD,
  );
  const email = authUser?.email ??
    (typeof profile.email === "string" ? profile.email : null) ??
    (typeof deletionSnap.get("email") === "string" ? deletionSnap.get("email") : requestedEmail);
  const displayName = authUser?.displayName ?? (typeof profile.full_name === "string" ? profile.full_name : null);
  const billingBlocker = accountDeletionBillingBlocker(billingSnap.data());
  if (billingBlocker) {
    throw new HttpsError(
      "failed-precondition",
      "Account deletion is blocked until recurring billing is cancelled and its final status is verified.",
      billingBlocker,
    );
  }

  if (
    deletionSnap.exists &&
    ((deletionSnap.get("auth_absent") === true && authUser !== null) ||
      (deletionSnap.get("profile_absent") === true && profileSnap.exists))
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Account resources were recreated after a deletion attempt. Review the account as a new deletion request.",
    );
  }

  if (
    !authUser &&
    !profileSnap.exists &&
    !billingSnap.exists &&
    !privateCredentialsSnap.exists &&
    !deletionSnap.exists &&
    userSubcollections.length === 0
  ) {
    throw new HttpsError("not-found", "No Auth user or account data was found for that uid.");
  }

  const pendingCleanup = buildAccountDeletionPendingCleanup({
    uid: targetUid,
    userSubcollections: userSubcollections.map((collection) => collection.id),
  });
  const ownerToken = randomBytes(18).toString("base64url");
  const nowMs = Date.now();
  const claim = await db.runTransaction(async (tx) => {
    // Lock billing and the deletion tombstone together. Without this second check,
    // a checkout webhook could activate recurring billing after the preflight read
    // but immediately before deletion was claimed.
    const [snap, latestBillingSnap] = await tx.getAll(deletionRef, billingRef);
    const latestBillingBlocker = accountDeletionBillingBlocker(latestBillingSnap.data());
    if (latestBillingBlocker) {
      throw new HttpsError(
        "failed-precondition",
        "Account deletion is blocked until recurring billing is cancelled and its final status is verified.",
        latestBillingBlocker,
      );
    }
    const current = snap.exists
      ? (snap.data() as Record<string, unknown> & { result?: AccountDeletionResult })
      : undefined;
    const decision = decideAccountDeletionClaim(current, nowMs);
    if (
      decision.action !== "claim" &&
      !completedAccountDeletionRequiresCredentialCleanup(current)
    ) return decision;

    const progress: AccountDeletionProgress = {
      authExistedAtStart: current?.auth_existed_at_start === true || authUser !== null,
      profileExistedAtStart: current?.profile_existed_at_start === true || profileSnap.exists,
      authAbsent: current?.auth_absent === true || authUser === null,
      profileAbsent: current?.profile_absent === true || !profileSnap.exists,
      authDeleteApiSucceeded: current?.auth_delete_api_succeeded === true,
      profileDeleteApiSucceeded: current?.profile_delete_api_succeeded === true,
      privateCredentialsDeleteApiSucceeded:
        current?.private_credentials_delete_api_succeeded === true ||
        (!privateCredentialsSnap.exists && !hasLegacyPrivateCredentials),
      auditLogged: current?.audit_logged === true,
    };
    const deletionPatch: Record<string, unknown> = {
      status: "deleting",
      owner_token: ownerToken,
      lease_expires_at_ms: nowMs + 2 * 60_000,
      target_uid: targetUid,
      email,
      operator_uid: adminUid,
      operator_role: adminRole,
      reason,
      pending_cleanup: pendingCleanup,
      auth_existed_at_start: progress.authExistedAtStart,
      profile_existed_at_start: progress.profileExistedAtStart,
      auth_absent: progress.authAbsent,
      profile_absent: progress.profileAbsent,
      auth_delete_api_succeeded: progress.authDeleteApiSucceeded,
      profile_delete_api_succeeded: progress.profileDeleteApiSucceeded,
      private_credentials_delete_api_succeeded: progress.privateCredentialsDeleteApiSucceeded,
      audit_logged: progress.auditLogged,
      attempts: admin.firestore.FieldValue.increment(1),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (!snap.exists) deletionPatch.created_at = admin.firestore.FieldValue.serverTimestamp();
    tx.set(deletionRef, deletionPatch, { merge: true });
    return { action: "claimed" as const, progress };
  });

  if (claim.action === "completed") {
    return { ...claim.result, already_deleted: true };
  }
  if (claim.action === "pending") {
    throw new HttpsError("aborted", "Account deletion is already in progress. Retry with the same uid.");
  }

  let {
    authExistedAtStart,
    profileExistedAtStart,
    authAbsent,
    profileAbsent,
    authDeleteApiSucceeded,
    profileDeleteApiSucceeded,
    privateCredentialsDeleteApiSucceeded,
    auditLogged,
  } = claim.progress;

  try {
    if (!authAbsent) {
      try {
        await admin.auth().deleteUser(targetUid);
        authDeleteApiSucceeded = true;
      } catch (error) {
        if (!isAuthUserNotFound(error)) throw error;
      }
      authAbsent = true;
      await updateAccountDeletionProgress(deletionRef, ownerToken, {
        auth_absent: true,
        auth_delete_api_succeeded: authDeleteApiSucceeded,
      });
    }

    if (!privateCredentialsDeleteApiSucceeded) {
      await deleteCustomProviderConfig(targetUid);
      privateCredentialsDeleteApiSucceeded = true;
      await updateAccountDeletionProgress(deletionRef, ownerToken, {
        private_credentials_delete_api_succeeded: true,
      });
    }

    if (!profileAbsent) {
      await userRef.delete();
      profileDeleteApiSucceeded = true;
      profileAbsent = true;
      await updateAccountDeletionProgress(deletionRef, ownerToken, {
        profile_absent: true,
        profile_delete_api_succeeded: true,
      });
    }

    const deletedAuth = authExistedAtStart && authAbsent;
    const deletedProfile = profileExistedAtStart && profileAbsent;
    if (!auditLogged) {
      await logAdminAction({
        admin_uid: adminUid,
        action: "delete_user",
        target_uid: targetUid,
        details: {
          operatorUid: adminUid,
          operatorRole: adminRole,
          targetUid,
          email,
          displayName,
          deletedAuth,
          deletedProfile,
          authDeleteApiSucceeded,
          profileDeleteApiSucceeded,
          privateCredentialsDeleteApiSucceeded,
          pendingCleanup,
          deletionRequestId: deletionRef.id,
          reason,
          createdAt: new Date().toISOString(),
        },
      });
      auditLogged = true;
      await updateAccountDeletionProgress(deletionRef, ownerToken, { audit_logged: true });
    }

    const result: AccountDeletionResult = {
      uid: targetUid,
      email,
      deleted_auth: deletedAuth,
      deleted_profile: deletedProfile,
      deleted_private_credentials: privateCredentialsDeleteApiSucceeded,
      auth_absent: authAbsent,
      profile_absent: profileAbsent,
      pending_cleanup: pendingCleanup,
    };
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(deletionRef);
      const decision = decideAccountDeletionClaim<AccountDeletionResult>(
        snap.exists
          ? (snap.data() as Record<string, unknown> & { result?: AccountDeletionResult })
          : undefined,
        Date.now(),
      );
      if (decision.action === "completed") return decision.result;
      if (snap.get("status") !== "deleting" || snap.get("owner_token") !== ownerToken) {
        throw new HttpsError("aborted", "Account deletion ownership changed before completion.");
      }
      tx.set(deletionRef, {
        status: "completed",
        result,
        lease_expires_at_ms: 0,
        completed_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return result;
    });
  } catch (error) {
    try {
      await releaseAccountDeletion(deletionRef, ownerToken);
    } catch (releaseError) {
      console.error("adminDeleteUser: failed to release deletion lease", releaseError);
    }
    throw error;
  }
}

/** Delete a product user from Firebase Auth and users/{uid}. */
export const adminDeleteUserFunction = onCall({ invoker: "public" }, async (request) => {
  const { uid: adminUid, role: adminRole } = await requireRole(request, "admin");
  return adminDeleteUserImpl(adminUid, adminRole, (request.data ?? {}) as DeleteUserRequest);
});

const SAMPLE_ACCOUNT_DEFINITIONS = [
  {
    kind: "job_seeker",
    email: "sample.jobseeker@career-copilot.example.com",
    displayName: "Sample Job Seeker",
    role: "candidate",
    subscriptionStatus: "executive",
    companyName: null,
  },
  {
    kind: "employer",
    email: "sample.employer@career-copilot.example.com",
    displayName: "Sample Employer",
    role: "employer",
    subscriptionStatus: "pro",
    companyName: "Career CoPilot Demo Employer",
  },
] as const;

export const adminCreateSampleAccountsFunction = onCall({ invoker: "public" }, async (_request) => {
  const { uid: adminUid, role: adminRole } = await requireRole(_request, "super");
  if (!isSampleAccountMutationEnabled()) {
    throw new HttpsError(
      "failed-precondition",
      "Sample-account mutation is disabled for this project. Use the emulator or configure both explicit server safety flags.",
    );
  }
  const now = new Date().toISOString();
  const accounts: Array<{
    kind: string;
    uid: string;
    email: string;
    password: string;
    role: string;
    subscription_status: string;
    credits: number;
    created: boolean;
  }> = [];

  for (const definition of SAMPLE_ACCOUNT_DEFINITIONS) {
    const password = samplePassword();
    let created = false;
    let authUser: admin.auth.UserRecord;
    try {
      authUser = await admin.auth().getUserByEmail(definition.email);
      authUser = await admin.auth().updateUser(authUser.uid, {
        disabled: false,
        displayName: definition.displayName,
        emailVerified: true,
        password,
      });
    } catch (error) {
      if (!isAuthUserNotFound(error)) throw error;
      authUser = await admin.auth().createUser({
        email: definition.email,
        password,
        displayName: definition.displayName,
        emailVerified: true,
        disabled: false,
      });
      created = true;
    }

    const userRef = db.collection(USERS_COLLECTION).doc(authUser.uid);
    const currentProfile = await userRef.get();
    await userRef.set(
      {
        [USER_FIELDS.credits]: SAMPLE_ACCOUNT_CREDITS,
        [USER_FIELDS.role]: definition.role,
        [USER_FIELDS.roleProvenance]: "admin_sample_account",
        [USER_FIELDS.roleProvisionedAt]: now,
        [USER_FIELDS.organizationVerified]: false,
        [USER_FIELDS.subscriptionStatus]: definition.subscriptionStatus,
        [USER_FIELDS.fullName]: definition.displayName,
        [USER_FIELDS.companyName]: definition.companyName,
        email: definition.email,
        sample_account: true,
        preferred_language: "en",
        created_at: currentProfile.get(USER_FIELDS.createdAt) ?? now,
        updated_at: now,
      },
      { merge: true }
    );

    accounts.push({
      kind: definition.kind,
      uid: authUser.uid,
      email: definition.email,
      password,
      role: definition.role,
      subscription_status: definition.subscriptionStatus,
      credits: SAMPLE_ACCOUNT_CREDITS,
      created,
    });
  }

  await logAdminAction({
    admin_uid: adminUid,
    action: "create_sample_accounts",
    details: {
      operatorUid: adminUid,
      operatorRole: adminRole,
      accounts: accounts.map(({ kind, uid, email, role, subscription_status, credits, created }) => ({
        kind,
        uid,
        email,
        role,
        subscription_status,
        credits,
        created,
      })),
      createdAt: now,
    },
  });

  return { accounts };
});

// ---------------------------------------------------------------------------
// Admin management — LEGACY set_admin (super-only, A2)
// ---------------------------------------------------------------------------

interface SetAdminRequest {
  uid?: string;
  email?: string;
  makeAdmin: boolean;
}

/**
 * Grant or revoke legacy admin access (platform_config/access.admin_uids + custom claim).
 * Now requires 'super' role (A2). Does NOT return admin_uids list (A3).
 *
 * @deprecated Prefer adminInviteAdmin / adminSetAdminRole / adminRemoveAdmin.
 */
export const adminSetAdminFunction = onCall({ invoker: "public" }, async (request) => {
  const { uid: callerUid } = await requireRole(request, "super");
  const { uid: rawUid, email, makeAdmin } = (request.data ?? {}) as SetAdminRequest;
  if (typeof makeAdmin !== "boolean") {
    throw new HttpsError("invalid-argument", "makeAdmin (boolean) is required.");
  }

  // Resolve target uid from an explicit uid or an email lookup.
  let targetUid = (rawUid ?? "").trim();
  let targetEmail: string | undefined;
  if (!targetUid && email?.trim()) {
    try {
      const u = await admin.auth().getUserByEmail(email.trim());
      targetUid = u.uid;
      targetEmail = u.email ?? undefined;
    } catch {
      throw new HttpsError("not-found", `No Auth user with email ${email}.`);
    }
  }
  if (!targetUid) throw new HttpsError("invalid-argument", "uid or email is required.");
  // A6
  assertUid(targetUid, "uid");

  // Prevent super from demoting/disabling themselves
  if (targetUid === callerUid && !makeAdmin) {
    throw new HttpsError("failed-precondition", "You cannot revoke your own admin access.");
  }

  let existingClaims: Record<string, unknown> = {};
  try {
    const u = await admin.auth().getUser(targetUid);
    targetEmail = targetEmail ?? u.email ?? undefined;
    existingClaims = (u.customClaims ?? {}) as Record<string, unknown>;
  } catch {
    throw new HttpsError("not-found", "Target user not found in Auth.");
  }

  const accessRef = db.collection(PLATFORM_CONFIG_COLLECTION).doc(PLATFORM_DOCS.access);
  const accessSnap = await accessRef.get();
  const currentUids: string[] = accessSnap.data()?.admin_uids ?? [];
  const set = new Set(currentUids);

  if (makeAdmin) {
    set.add(targetUid);
  } else {
    set.delete(targetUid);
    if (set.size === 0) {
      throw new HttpsError("failed-precondition", "Cannot remove the last admin.");
    }
  }
  const nextUids = Array.from(set);

  await accessRef.set(
    { admin_uids: nextUids, updated_at: new Date().toISOString(), updated_by: callerUid },
    { merge: true }
  );
  await admin.auth().setCustomUserClaims(targetUid, { ...existingClaims, admin: makeAdmin });
  invalidateAccessCache();

  await logAdminAction({
    admin_uid: callerUid,
    action: "set_admin",
    target_uid: targetUid,
    details: { makeAdmin, email: targetEmail ?? null },
  });

  // A3: do NOT return admin_uids list
  return { uid: targetUid, email: targetEmail ?? null, admin: makeAdmin };
});

// ---------------------------------------------------------------------------
// New RBAC admin management callables (super-only)
// ---------------------------------------------------------------------------

interface InviteAdminRequest {
  email: string;
  role: "admin" | "reviewer";
}

/**
 * Invite a registered user as an admin or reviewer by email.
 * The user must already have a Firebase Auth account — they cannot be invited
 * before signing up ("ask them to register first" on not-found).
 * Super-only.
 */
export const adminInviteAdminFunction = onCall({ invoker: "public" }, async (request) => {
  const { uid: callerUid } = await requireRole(request, "super");
  const { email: rawEmail, role } = (request.data ?? {}) as InviteAdminRequest;

  if (typeof rawEmail !== "string" || rawEmail.trim().length === 0) {
    throw new HttpsError("invalid-argument", "email must be a non-empty string.");
  }
  const email = rawEmail.trim();
  if (email.length > 254) {
    throw new HttpsError("invalid-argument", "email is too long.");
  }
  if (role !== "admin" && role !== "reviewer") {
    throw new HttpsError("invalid-argument", "role must be 'admin' or 'reviewer'.");
  }

  // Resolve Auth user — require them to already have an account.
  let targetUid: string;
  let targetEmail: string | undefined;
  try {
    const u = await admin.auth().getUserByEmail(email);
    targetUid = u.uid;
    targetEmail = u.email ?? email;
  } catch {
    throw new HttpsError(
      "not-found",
      `No Firebase Auth account found for ${email}. Ask them to register first.`
    );
  }

  const invitedAt = new Date().toISOString();
  const entry: AdminEntry = {
    role,
    email: targetEmail ?? null,
    invited_by: callerUid,
    invited_at: invitedAt,
    status: "active",
  };

  const accessRef = db.collection(PLATFORM_CONFIG_COLLECTION).doc(PLATFORM_DOCS.access);
  await accessRef.set(
    {
      admins: { [targetUid]: entry },
      updated_at: invitedAt,
      updated_by: callerUid,
    },
    { merge: true }
  );

  // Set custom claim for fast-path checks
  const existingUser = await admin.auth().getUser(targetUid);
  const existingClaims = (existingUser.customClaims ?? {}) as Record<string, unknown>;
  await admin.auth().setCustomUserClaims(targetUid, { ...existingClaims, admin: true });
  invalidateAccessCache();

  await logAdminAction({
    admin_uid: callerUid,
    action: "invite_admin",
    target_uid: targetUid,
    details: { email: targetEmail ?? null, role, invited_at: invitedAt },
  });

  return {
    uid: targetUid,
    email: targetEmail ?? null,
    role,
    status: "active",
    invited_at: invitedAt,
  };
});

interface SetAdminRoleRequest {
  uid: string;
  role: AdminRole;
}

export function buildAdminRoleAccessPatch(
  adminsMap: Record<string, AdminEntry>,
  legacyDocUids: string[],
  targetUid: string,
  role: AdminRole
): { admins: Record<string, AdminEntry>; admin_uids: string[] } {
  const existing = adminsMap[targetUid];
  if (!existing && !legacyDocUids.includes(targetUid)) {
    throw new HttpsError("not-found", "Admin entry not found. Use adminInviteAdmin to add them first.");
  }

  return {
    admins: {
      [targetUid]: {
        ...(existing ?? { status: "active" as const }),
        role,
      },
    },
    admin_uids: legacyDocUids.filter((uid) => uid !== targetUid),
  };
}

/**
 * Change the role of an existing admin/reviewer entry.
 * Super-only. A super cannot change their own role.
 */
export const adminSetAdminRoleFunction = onCall({ invoker: "public" }, async (request) => {
  const { uid: callerUid } = await requireRole(request, "super");
  const rawData = (request.data ?? {}) as SetAdminRoleRequest;
  const targetUid = assertUid(rawData.uid);
  const { role } = rawData;

  if (role !== "super" && role !== "admin" && role !== "reviewer") {
    throw new HttpsError("invalid-argument", "role must be 'super', 'admin', or 'reviewer'.");
  }
  if (targetUid === callerUid) {
    throw new HttpsError("failed-precondition", "You cannot change your own role.");
  }

  const accessRef = db.collection(PLATFORM_CONFIG_COLLECTION).doc(PLATFORM_DOCS.access);
  const accessSnap = await accessRef.get();
  const adminsMap: Record<string, AdminEntry> = accessSnap.data()?.admins ?? {};
  const legacyDocUids: string[] = accessSnap.data()?.admin_uids ?? [];
  const accessPatch = buildAdminRoleAccessPatch(adminsMap, legacyDocUids, targetUid, role);

  await accessRef.set(
    { ...accessPatch, updated_at: new Date().toISOString(), updated_by: callerUid },
    { merge: true }
  );
  const existingUser = await admin.auth().getUser(targetUid);
  const existingClaims = (existingUser.customClaims ?? {}) as Record<string, unknown>;
  await admin.auth().setCustomUserClaims(targetUid, { ...existingClaims, admin: true });
  invalidateAccessCache();

  await logAdminAction({
    admin_uid: callerUid,
    action: "set_admin_role",
    target_uid: targetUid,
    details: { role },
  });

  return { uid: targetUid, role, status: accessPatch.admins[targetUid].status };
});

interface RemoveAdminRequest {
  uid: string;
}

/**
 * Disable (soft-delete) an admin/reviewer entry (status → 'disabled').
 * Super-only. A super cannot remove themselves.
 */
export const adminRemoveAdminFunction = onCall({ invoker: "public" }, async (request) => {
  const { uid: callerUid } = await requireRole(request, "super");
  const rawData = (request.data ?? {}) as RemoveAdminRequest;
  const targetUid = assertUid(rawData.uid);

  if (targetUid === callerUid) {
    throw new HttpsError("failed-precondition", "You cannot remove your own admin access.");
  }

  const accessRef = db.collection(PLATFORM_CONFIG_COLLECTION).doc(PLATFORM_DOCS.access);
  const accessSnap = await accessRef.get();
  const adminsMap: Record<string, AdminEntry> = accessSnap.data()?.admins ?? {};

  if (!adminsMap[targetUid]) {
    throw new HttpsError("not-found", "Admin entry not found.");
  }

  adminsMap[targetUid] = { ...adminsMap[targetUid], status: "disabled" };

  await accessRef.set(
    { admins: { [targetUid]: adminsMap[targetUid] }, updated_at: new Date().toISOString(), updated_by: callerUid },
    { merge: true }
  );

  // Revoke custom claim
  try {
    const u = await admin.auth().getUser(targetUid);
    const existing = (u.customClaims ?? {}) as Record<string, unknown>;
    await admin.auth().setCustomUserClaims(targetUid, { ...existing, admin: false });
    // Also revoke refresh tokens for immediate effect (partial A8 mitigation)
    await admin.auth().revokeRefreshTokens(targetUid);
  } catch {
    // Non-fatal: entry is already disabled in the access doc
  }
  invalidateAccessCache();

  await logAdminAction({
    admin_uid: callerUid,
    action: "remove_admin",
    target_uid: targetUid,
    details: { status: "disabled" },
  });

  return { uid: targetUid, status: "disabled" };
});

type AdminListRow = {
  uid: string;
  email: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  role: AdminRole;
  status: string;
  invited_at: string | null;
  source: "rbac" | "legacy_doc" | "env";
};

export function filterAdminRowsForViewer(rows: AdminListRow[], viewerRole: AdminRole): AdminListRow[] {
  if (viewerRole === "super") return rows;
  if (viewerRole === "admin") {
    return rows.filter((row) => row.role === "reviewer");
  }
  return [];
}

/**
 * List console-user entries visible to the caller.
 * Admin sees reviewers; super sees admins and reviewers.
 */
export const adminListAdminsFunction = onCall({ invoker: "public" }, async (request) => {
  const { role: viewerRole } = await requireRole(request, "admin");

  const accessSnap = await db.collection(PLATFORM_CONFIG_COLLECTION).doc(PLATFORM_DOCS.access).get();
  const adminsMap: Record<string, AdminEntry> = accessSnap.data()?.admins ?? {};
  const legacyDocUids: string[] = accessSnap.data()?.admin_uids ?? [];
  const envUids = (process.env.ADMIN_UIDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // New RBAC entries
  const rbacAdmins: AdminListRow[] = await Promise.all(
    Object.entries(adminsMap).map(async ([uid, entry]) => {
      return {
        uid,
        email: entry.email ?? null,
        role: entry.role,
        status: entry.status,
        invited_at: entry.invited_at ?? null,
        source: "rbac",
      };
    })
  );

  // Legacy doc entries (not already in RBAC map)
  const legacyAdmins: AdminListRow[] = await Promise.all(
    legacyDocUids
      .filter((uid) => !adminsMap[uid])
      .map(async (uid) => {
        try {
          const u = await admin.auth().getUser(uid);
          return { uid, email: u.email ?? null, role: "admin" as AdminRole, status: "active" as const, invited_at: null, source: "legacy_doc" as const };
        } catch {
          return { uid, email: null, role: "admin" as AdminRole, status: "active" as const, invited_at: null, source: "legacy_doc" as const };
        }
      })
  );

  // Env bootstrap entries (super-only visibility, A7)
  const envAdmins: AdminListRow[] = await Promise.all(
    envUids
      .filter((uid) => !adminsMap[uid] && !legacyDocUids.includes(uid))
      .map(async (uid) => {
        try {
          const u = await admin.auth().getUser(uid);
          return { uid, email: u.email ?? null, role: "super" as AdminRole, status: "active" as const, invited_at: null, source: "env" as const };
        } catch {
          return { uid, email: null, role: "super" as AdminRole, status: "active" as const, invited_at: null, source: "env" as const };
        }
      })
  );

  const rows = filterAdminRowsForViewer([...rbacAdmins, ...legacyAdmins, ...envAdmins], viewerRole);
  if (rows.length === 0) return { admins: [] };
  const [authByUid, profileSnaps] = await Promise.all([
    authUsersByUid(rows.map((row) => row.uid)),
    db.getAll(...rows.map((row) => db.collection(USERS_COLLECTION).doc(row.uid))),
  ]);
  const profileByUid = new Map(profileSnaps.map((snap) => [snap.id, snap.data() ?? {}]));
  return {
    admins: rows.map((row) => {
      const authUser = authByUid.get(row.uid);
      const profile = profileByUid.get(row.uid);
      return {
        ...row,
        email: row.email ?? authUser?.email ?? (typeof profile?.email === "string" ? profile.email : null),
        display_name: authUser?.displayName ?? (typeof profile?.full_name === "string" ? profile.full_name : null),
        avatar_url: profileAvatarUrl(profile, authUser),
      };
    }),
  };
});

// ---------------------------------------------------------------------------
// Utility callables
// ---------------------------------------------------------------------------

/** Check if the signed-in user has admin access (for UI gate). */
export const adminCheckAccessFunction = onCall({ invoker: "public" }, async (request) => {
  if (!request.auth || request.auth.token.email_verified !== true) return { admin: false };
  const uid = request.auth.uid;
  // Use the SAME authority the privileged callables enforce (getAdminRole over the
  // RBAC store + env/legacy resolution), so the UI gate can never disagree with
  // what the functions actually allow — and a disabled entry resolves to null → denied.
  const ok = (await getAdminRole(uid)) !== null;
  return { admin: ok, uid };
});

/**
 * Returns the caller's admin role.
 * Any valid admin role (reviewer, admin, super) can call this.
 * Used by the admin UI to render role-gated sections.
 */
export const adminWhoAmIFunction = onCall({ invoker: "public" }, async (request) => {
  const { uid, role } = await requireRole(request, "reviewer");
  return { uid, role };
});

export interface AuditLogEntry {
  id: string;
  admin_uid: string;
  action: string;
  target_uid: string | null;
  details: Record<string, unknown>;
  created_at: string | null;
}

interface AuditLogRequest {
  limit?: number;
  start_after_id?: string;
}

export function resolveAuditLogPageRequest(data: unknown) {
  const { limit = 25, start_after_id } = (data ?? {}) as AuditLogRequest;
  return {
    limit: Math.min(Math.max(Number.isFinite(limit) ? Number(limit) : 25, 1), 100),
    start_after_id: typeof start_after_id === "string" && start_after_id ? start_after_id : undefined,
  };
}

/** Paginated admin audit log, newest first. */
export const adminGetAuditLogFunction = onCall({ invoker: "public" }, async (request) => {
  await requireRole(request, "reviewer");
  const { limit, start_after_id } = resolveAuditLogPageRequest(request.data);

  let q = db
    .collection(ADMIN_AUDIT_LOG_COLLECTION)
    .orderBy("created_at", "desc")
    .limit(limit + 1);
  if (start_after_id) {
    const cursor = await db.collection(ADMIN_AUDIT_LOG_COLLECTION).doc(start_after_id).get();
    if (cursor.exists) q = q.startAfter(cursor);
  }

  const snap = await q.get();
  const docs = snap.docs.slice(0, limit);

  const entries: AuditLogEntry[] = docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      admin_uid: d.admin_uid as string,
      action: d.action as string,
      target_uid: (d.target_uid as string | null) ?? null,
      details: (d.details as Record<string, unknown>) ?? {},
      created_at: d.created_at?.toDate?.()?.toISOString?.() ?? null,
    };
  });

  return { entries, next_cursor: snap.docs.length > limit ? docs[docs.length - 1].id : null };
});
