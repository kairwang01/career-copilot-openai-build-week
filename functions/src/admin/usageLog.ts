/**
 * Usage + credit ledger — written server-side from deductCredits / admin actions.
 */

import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  ADMIN_AUDIT_LOG_COLLECTION,
  CREDIT_LEDGER_COLLECTION,
  USAGE_COUNTERS_COLLECTION,
  USAGE_EVENTS_COLLECTION,
  UsageEventDoc,
} from "./schema";
import { HttpsError } from "firebase-functions/v2/https";
import { ensurePlatformCaches, getPlanQuota, getQuotasConfig, getToolQuota } from "./platformConfig";
import { tierFromSubscription, isBusinessUser } from "../llm/models";
import { USERS_COLLECTION, USER_FIELDS } from "../credits/schema";
import { normalizePlanKey } from "./quotaDefaults";

/**
 * Default daily tool-run cap for free-tier users (次数限制).
 * Applies only to users whose tier resolves to "free" AND who are not
 * business users. Runtime enforcement uses the admin-configurable plan quota;
 * this exported value is only the default used by tests and fallbacks.
 */
export const FREE_TIER_DAILY_RUN_LIMIT = 10;
/** Non-configurable fail-safe ceilings; configurable quotas may only be stricter. */
export const PLATFORM_DAILY_ATTEMPT_SAFETY_LIMIT = 10_000;
export const USER_DAILY_ATTEMPT_SAFETY_LIMIT = 500;

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

function utcDayStart(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function utcDayKey(date = new Date()): string {
  return utcDayStart(date).toISOString().slice(0, 10);
}

function globalUsageCounterId(dayKey: string): string {
  return `global_${dayKey}`;
}

function userUsageCounterId(uid: string, dayKey: string): string {
  return `user_${Buffer.from(uid).toString("base64url")}_${dayKey}`;
}

function counterTotals(data: admin.firestore.DocumentData | undefined): { runs: number; credits: number } {
  const parse = (value: unknown, field: "runs" | "credits") => {
    if (value === undefined || value === null) return 0;
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
    console.error("Usage counter contains an invalid value", { field });
    throw new HttpsError(
      "failed-precondition",
      "Usage metering is temporarily unavailable while counters are reconciled.",
    );
  };
  return { runs: parse(data?.runs, "runs"), credits: parse(data?.credits, "credits") };
}

function counterRefs(uid: string, dayKey: string) {
  return {
    global: db.collection(USAGE_COUNTERS_COLLECTION).doc(globalUsageCounterId(dayKey)),
    user: db.collection(USAGE_COUNTERS_COLLECTION).doc(userUsageCounterId(uid, dayKey)),
  };
}

/** A refunded event still consumes an abuse-control attempt, but no net credits. */
export function usageEventCreditsAreBillable(data: admin.firestore.DocumentData | undefined): boolean {
  return data?.status === "deducted" && data.refund_status !== "refunded";
}

/** Returns validated net spend for one source event and fails closed on corruption. */
export function usageEventNetCreditCost(data: admin.firestore.DocumentData | undefined): number {
  if (!usageEventCreditsAreBillable(data)) return 0;
  const cost = data?.credit_cost;
  if (typeof cost === "number" && Number.isSafeInteger(cost) && cost >= 0) return cost;
  console.error("Usage event contains an invalid credit cost");
  throw new HttpsError(
    "failed-precondition",
    "Usage metering is temporarily unavailable while usage records are reconciled.",
  );
}

/** Claim events count once; refund and volume-only observation events do not. */
export function usageEventCountsAsMeteredAttempt(data: admin.firestore.DocumentData | undefined): boolean {
  return data?.status === "deducted" || data?.status === "free";
}

// Fallback scans run only when the per-day counter doc is missing (first run of
// the day / legacy days). Never enforce a quota from a truncated scan: admin
// limits can exceed this safety bound, so an incomplete result must fail closed
// until an operator rebuilds the derived counter.
const USAGE_SCAN_LIMIT = 2000;

function assertUsageScanComplete(size: number, scope: "global" | "user"): void {
  if (size <= USAGE_SCAN_LIMIT) return;
  console.error("Usage counter fallback scan exceeded its safe bound", {
    scope,
    limit: USAGE_SCAN_LIMIT,
  });
  throw new HttpsError(
    "failed-precondition",
    "Usage metering is temporarily unavailable while counters are reconciled.",
  );
}

async function scanTodayUsageTotals(): Promise<{ runs: number; credits: number }> {
  const dayStartTs = Timestamp.fromDate(utcDayStart());
  const snap = await db
    .collection(USAGE_EVENTS_COLLECTION)
    .where("created_at", ">=", dayStartTs)
    .where("status", "in", ["deducted", "free"])
    .limit(USAGE_SCAN_LIMIT + 1)
    .get();
  assertUsageScanComplete(snap.size, "global");
  let runs = 0;
  let credits = 0;
  snap.forEach((doc) => {
    if (usageEventCountsAsMeteredAttempt(doc.data())) runs += 1;
    credits += usageEventNetCreditCost(doc.data());
  });
  return { runs, credits };
}

async function scanUserTodayUsage(uid: string): Promise<{ runs: number; credits: number }> {
  const dayStartTs = Timestamp.fromDate(utcDayStart());
  const snap = await db
    .collection(USAGE_EVENTS_COLLECTION)
    .where("uid", "==", uid)
    .where("created_at", ">=", dayStartTs)
    .where("status", "in", ["deducted", "free"])
    .limit(USAGE_SCAN_LIMIT + 1)
    .get();
  assertUsageScanComplete(snap.size, "user");
  let runs = 0;
  let credits = 0;
  snap.forEach((doc) => {
    if (usageEventCountsAsMeteredAttempt(doc.data())) runs += 1;
    credits += usageEventNetCreditCost(doc.data());
  });
  return { runs, credits };
}

export async function getTodayUsageTotals(): Promise<{ runs: number; credits: number }> {
  const dayKey = utcDayKey();
  const doc = await db.collection(USAGE_COUNTERS_COLLECTION).doc(globalUsageCounterId(dayKey)).get();
  if (doc.exists) return counterTotals(doc.data());
  return scanTodayUsageTotals();
}

export async function getUserTodayUsage(uid: string): Promise<{ runs: number; credits: number }> {
  const dayKey = utcDayKey();
  const doc = await db.collection(USAGE_COUNTERS_COLLECTION).doc(userUsageCounterId(uid, dayKey)).get();
  if (doc.exists) return counterTotals(doc.data());
  return scanUserTodayUsage(uid);
}

export async function getUserTodayCredits(uid: string): Promise<number> {
  return (await getUserTodayUsage(uid)).credits;
}

/** Returns metered attempts today (UTC), including attempts later refunded. */
export async function getUserTodayRuns(uid: string): Promise<number> {
  return (await getUserTodayUsage(uid)).runs;
}

export function writeUsageCounters(
  tx: admin.firestore.Transaction,
  uid: string,
  creditCost: number,
  dayKey = utcDayKey()
): void {
  const updatedAt = FieldValue.serverTimestamp();
  const delta = {
    runs: FieldValue.increment(1),
    credits: FieldValue.increment(creditCost),
    updated_at: updatedAt,
  };
  tx.set(
    db.collection(USAGE_COUNTERS_COLLECTION).doc(globalUsageCounterId(dayKey)),
    {
      day_key: dayKey,
      scope: "global",
      ...delta,
    },
    { merge: true }
  );
  tx.set(
    db.collection(USAGE_COUNTERS_COLLECTION).doc(userUsageCounterId(uid, dayKey)),
    {
      day_key: dayKey,
      scope: "user",
      uid,
      ...delta,
    },
    { merge: true }
  );
}

/**
 * Releases the net credit-spend reservation for a settled refund. The metered
 * attempt remains reserved as an abuse-control slot, matching free-tool claims.
 * The caller must invoke this from the same transaction that marks the source
 * usage event refunded, which makes the balance and quota compensation atomic.
 */
export async function refundUsageCredits(
  tx: admin.firestore.Transaction,
  uid: string,
  creditCost: number,
  dayKey: string | undefined,
): Promise<
  | "credits_reversed"
  | "counter_underflow"
  | "partial_counter_fallback"
  | "event_fallback"
  | "unknown_day"
> {
  if (!dayKey || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return "unknown_day";

  const refs = counterRefs(uid, dayKey);
  const [globalSnap, userSnap] = await tx.getAll(refs.global, refs.user);
  const updatedAt = FieldValue.serverTimestamp();

  const decrement = (
    ref: admin.firestore.DocumentReference,
    snap: admin.firestore.DocumentSnapshot,
    scope: "global" | "user",
  ): "missing" | "updated" | "underflow" => {
    if (!snap.exists) return "missing";
    const totals = counterTotals(snap.data());
    if (totals.credits < creditCost) {
      // The source event is authoritative for the user's refund, but the
      // derived counter is already inconsistent. Preserve its restrictive
      // value instead of erasing spend belonging to other requests; the marker
      // tells operations to rebuild this UTC day from source events.
      console.error("Usage counter refund would underflow; reconciliation required", {
        scope,
        dayKey,
      });
      return "underflow";
    }
    tx.update(ref, {
      credits: totals.credits - creditCost,
      updated_at: updatedAt,
    });
    return "updated";
  };

  const globalResult = decrement(refs.global, globalSnap, "global");
  const userResult = decrement(refs.user, userSnap, "user");
  if (globalResult === "underflow" || userResult === "underflow") return "counter_underflow";
  if (globalSnap.exists && userSnap.exists) return "credits_reversed";
  if (globalSnap.exists || userSnap.exists) return "partial_counter_fallback";
  return "event_fallback";
}

function assertQuotaSnapshot(
  userSnap: admin.firestore.DocumentSnapshot,
  totals: { runs: number; credits: number },
  userUsage: { runs: number; credits: number },
  cost: number,
  tool: string,
): void {
  if (!userSnap.exists) {
    throw new HttpsError("not-found", "User profile not found. Please sign out and sign back in.");
  }

  const quotas = getQuotasConfig();
  const enforceLimits = quotas.enabled !== false;
  const runLimit = quotas.daily_tool_run_limit ?? 0;
  const creditLimit = quotas.daily_credit_spend_limit ?? 0;
  const userLimit = quotas.per_user_daily_credit_limit ?? 0;

  if (totals.runs >= PLATFORM_DAILY_ATTEMPT_SAFETY_LIMIT) {
    throw new HttpsError(
      "resource-exhausted",
      "Platform daily safety limit reached. Try again tomorrow.",
    );
  }
  if (userUsage.runs >= USER_DAILY_ATTEMPT_SAFETY_LIMIT) {
    throw new HttpsError(
      "resource-exhausted",
      "Your daily safety limit has been reached. Try again tomorrow.",
    );
  }

  if (enforceLimits && runLimit > 0 && totals.runs >= runLimit) {
    throw new HttpsError("resource-exhausted", "Platform daily analysis limit reached. Try again tomorrow.");
  }
  if (enforceLimits && creditLimit > 0 && totals.credits + cost > creditLimit) {
    throw new HttpsError("resource-exhausted", "Platform daily credit spend limit reached.");
  }
  if (enforceLimits && userLimit > 0 && userUsage.credits + cost > userLimit) {
    throw new HttpsError("resource-exhausted", "Your daily usage limit has been reached.");
  }

  const subscriptionStatus = userSnap.get(USER_FIELDS.subscriptionStatus) as string | undefined;
  const role = userSnap.get(USER_FIELDS.role) as string | undefined;
  const tier = tierFromSubscription(subscriptionStatus);
  const business = isBusinessUser(role, subscriptionStatus);
  const planKey = normalizePlanKey(subscriptionStatus);

  const toolQuota = getToolQuota(tool);
  if (toolQuota) {
    if (!toolQuota.enabled) {
      throw new HttpsError("failed-precondition", "This tool is temporarily unavailable.");
    }
    if (!toolQuota.allowed_plans.includes(planKey)) {
      throw new HttpsError("permission-denied", "Your current plan does not include this tool.");
    }
  }

  const planQuota = getPlanQuota(planKey);
  const shouldApplyPlanRunLimit = planKey !== "free" || (tier === "free" && !business);
  if (
    enforceLimits &&
    shouldApplyPlanRunLimit &&
    planQuota.daily_run_limit > 0 &&
    userUsage.runs >= planQuota.daily_run_limit
  ) {
    throw new HttpsError(
      "resource-exhausted",
      `You have reached your daily limit of ${planQuota.daily_run_limit} metered AI requests. ` +
        "Upgrade your plan for higher limits, or try again tomorrow.",
    );
  }
  if (
    enforceLimits &&
    planQuota.daily_credit_limit > 0 &&
    userUsage.credits + cost > planQuota.daily_credit_limit
  ) {
    throw new HttpsError("resource-exhausted", "Your plan's daily credit limit has been reached.");
  }
}

async function legacyUsageTotalsInTransaction(
  tx: admin.firestore.Transaction,
  uid?: string,
): Promise<{ runs: number; credits: number }> {
  const dayStartTs = Timestamp.fromDate(utcDayStart());
  let query: admin.firestore.Query = db
    .collection(USAGE_EVENTS_COLLECTION)
    .where("created_at", ">=", dayStartTs)
    .where("status", "in", ["deducted", "free"]);
  if (uid) query = query.where("uid", "==", uid);
  const snap = await tx.get(query.limit(USAGE_SCAN_LIMIT + 1));
  assertUsageScanComplete(snap.size, uid ? "user" : "global");
  let runs = 0;
  let credits = 0;
  snap.forEach((doc) => {
    if (usageEventCountsAsMeteredAttempt(doc.data())) runs += 1;
    credits += usageEventNetCreditCost(doc.data());
  });
  return { runs, credits };
}

/**
 * Atomically validates and reserves one daily quota slot in the caller's
 * Firestore transaction. Reading the counter documents under the same
 * transaction lock prevents concurrent requests from all passing a stale cap.
 */
export async function reserveUsageQuota(
  tx: admin.firestore.Transaction,
  uid: string,
  cost: number,
  tool: string,
  userSnap: admin.firestore.DocumentSnapshot,
  dayKey = utcDayKey(),
): Promise<void> {
  const refs = counterRefs(uid, dayKey);
  const [globalSnap, userCounterSnap] = await tx.getAll(refs.global, refs.user);
  const totals = globalSnap.exists
    ? counterTotals(globalSnap.data())
    : await legacyUsageTotalsInTransaction(tx);
  const userUsage = userCounterSnap.exists
    ? counterTotals(userCounterSnap.data())
    : await legacyUsageTotalsInTransaction(tx, uid);

  assertQuotaSnapshot(userSnap, totals, userUsage, cost, tool);

  const updatedAt = FieldValue.serverTimestamp();
  tx.set(refs.global, {
    day_key: dayKey,
    scope: "global",
    runs: globalSnap.exists ? FieldValue.increment(1) : totals.runs + 1,
    credits: globalSnap.exists ? FieldValue.increment(cost) : totals.credits + cost,
    updated_at: updatedAt,
  }, { merge: true });
  tx.set(refs.user, {
    day_key: dayKey,
    scope: "user",
    uid,
    runs: userCounterSnap.exists ? FieldValue.increment(1) : userUsage.runs + 1,
    credits: userCounterSnap.exists ? FieldValue.increment(cost) : userUsage.credits + cost,
    updated_at: updatedAt,
  }, { merge: true });
}

export async function logUsageEvent(
  uid: string,
  tool: string,
  creditCost: number,
  status: "deducted" | "refunded"
): Promise<void> {
  const payload: Omit<UsageEventDoc, "created_at"> & { created_at: FieldValue } = {
    uid,
    tool,
    credit_cost: creditCost,
    status,
    day_key: utcDayKey(),
    request_id: null,
    created_at: FieldValue.serverTimestamp(),
  };
  await db.collection(USAGE_EVENTS_COLLECTION).add(payload);
}

/**
 * Records an uncharged tool call for admin VOLUME visibility only.
 *
 * Unlike recordFreeToolRun, this deliberately does NOT (a) enforce any quota
 * (checkQuotasOrThrow) or (b) bump usage counters — so it can never throw
 * resource-exhausted and never inflates the run counter the free-tier cap reads.
 * It is therefore invisible to the user's experience: zero behavior change, just an
 * observability breadcrumb. Best-effort and non-throwing — a logging failure must
 * never break the tool it instruments.
 */
export async function recordObservedToolRun(uid: string, tool: string): Promise<void> {
  try {
    await db.collection(USAGE_EVENTS_COLLECTION).add({
      uid,
      tool,
      credit_cost: 0,
      status: "observed",
      day_key: utcDayKey(),
      request_id: null,
      balance_after: null,
      created_at: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error("recordObservedToolRun failed", { uid, tool, err });
  }
}

export async function logCreditLedger(entry: {
  uid: string;
  amount: number;
  balance_after: number;
  reason: string;
  tool?: string;
  admin_uid?: string;
}): Promise<void> {
  await db.collection(CREDIT_LEDGER_COLLECTION).add({
    ...entry,
    created_at: FieldValue.serverTimestamp(),
  });
}

/**
 * Append-only admin audit trail. Every admin mutation (credit adjust, tier
 * change, admin grant/revoke, LLM/quota config) writes one entry here. Never log
 * raw secrets — pass only "_changed" booleans for keys.
 */
export async function logAdminAction(entry: {
  admin_uid: string;
  action: string;
  target_uid?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  await db.collection(ADMIN_AUDIT_LOG_COLLECTION).add({
    admin_uid: entry.admin_uid,
    action: entry.action,
    target_uid: entry.target_uid ?? null,
    details: entry.details ?? {},
    created_at: FieldValue.serverTimestamp(),
  });
}

export async function checkQuotasOrThrow(uid: string, cost: number, tool: string): Promise<void> {
  await ensurePlatformCaches();
  // Run these reads in parallel for performance.
  const [totals, userUsage, userSnap] = await Promise.all([
    getTodayUsageTotals(),
    getUserTodayUsage(uid),
    admin.firestore().collection(USERS_COLLECTION).doc(uid).get(),
  ]);

  assertQuotaSnapshot(userSnap, totals, userUsage, cost, tool);
}
