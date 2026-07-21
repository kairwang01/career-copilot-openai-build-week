/**
 * deductCredits — atomic Firestore credit deduction.
 *
 * This is the M9 core: a Firestore transaction that reads the user's credit
 * balance, rejects the request if insufficient, and writes the new balance —
 * all atomically. The LLM is only called AFTER this commits.
 *
 * Design guarantees:
 *  - Atomic: no partial deductions. Either the full cost is deducted or nothing.
 *  - Un-bypassable: runs server-side inside a Cloud Function; the client cannot skip it.
 *  - Concurrency-safe: Firestore transactions auto-retry on contention.
 *    A bounded retry cap prevents infinite loops under pathological load.
 *  - Single write target: users/{uid}.credits — one document per user,
 *    so per-user contention is low (M9's 100-concurrent target is across users).
 *
 * When Xiaoyi delivers the real schema:
 *  - Update USERS_COLLECTION and USER_FIELDS in schema.ts ONLY.
 *  - This file does not change.
 */

import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { ensurePlatformCaches, getToolCreditCost } from "../config/env";
import {
  refundUsageCredits,
  reserveUsageQuota,
  utcDayKey,
} from "../admin/usageLog";
import {
  CREDIT_LEDGER_COLLECTION,
  USAGE_COUNTER_RECONCILIATION_REVIEWS_COLLECTION,
  USAGE_EVENTS_COLLECTION,
} from "../admin/schema";
import { USERS_COLLECTION, USER_FIELDS } from "./schema";

// Initialise the Admin SDK once (idempotent — safe to call multiple times).
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/** Server-only recovery queue for refunds that could not be committed inline. */
export const CREDIT_REFUND_REVIEWS_COLLECTION = "credit_refund_reviews";

/**
 * Maximum number of transaction retries before surfacing a hard error.
 * Firestore retries automatically on contention; this cap prevents
 * runaway retries under extreme load.
 */
const MAX_RETRIES = 3;

export interface DeductCreditsOptions {
  /**
   * Optional client-generated idempotency key. When present, the same uid +
   * requestId can create at most one deducted usage event and one balance change.
   */
  requestId?: string;
}

export interface DeductCreditsResult {
  charged: boolean;
  duplicate: boolean;
  balanceAfter: number;
  usageEventId?: string;
}

export interface MeterToolRunResult extends DeductCreditsResult {
  creditCost: number;
}

export interface RefundableCharge {
  charged: boolean;
  usageEventId?: string;
}

export interface RefundCreditsResult {
  refunded: boolean;
  duplicate: boolean;
  amount: number;
  balanceAfter?: number;
  failureReason?: RefundFailureReason;
}

export type RefundFailureReason =
  | "usage_event_missing"
  | "usage_event_mismatch"
  | "invalid_credit_amount"
  | "user_missing"
  | "invalid_user_balance";

export function requireFreshToolRun(result: { duplicate: boolean }): void {
  if (result.duplicate) {
    throw new HttpsError(
      "already-exists",
      "This AI request was already submitted. Please wait for the current result."
    );
  }
}

function normalizeRequestId(requestId: string | undefined): string | undefined {
  if (requestId === undefined || requestId === null || requestId === "") return undefined;
  if (
    typeof requestId !== "string" ||
    requestId.length < 8 ||
    requestId.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/.test(requestId)
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Invalid requestId. It must be 8-128 URL-safe characters."
    );
  }
  return requestId;
}

function requestDocPart(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function usageEventRef(uid: string, requestId: string | undefined): admin.firestore.DocumentReference {
  if (!requestId) return db.collection(USAGE_EVENTS_COLLECTION).doc();
  return db.collection(USAGE_EVENTS_COLLECTION).doc(`req_${requestDocPart(uid)}_${requestDocPart(requestId)}`);
}

/**
 * Atomically deducts `cost` credits from `users/{uid}`.
 *
 * @param uid   - Firebase Auth user ID.
 * @param cost  - Number of credits to deduct (must be > 0).
 * @param tool  - Tool name for error messages (e.g. "resume-analysis").
 *
 * @throws HttpsError("failed-precondition") — insufficient credits.
 * @throws HttpsError("not-found")           — user document does not exist.
 * @throws HttpsError("resource-exhausted")  — too many concurrent requests; retry.
 * @throws HttpsError("internal")            — unexpected error.
 */
export async function deductCredits(
  uid: string,
  cost: number,
  tool: string,
  options: DeductCreditsOptions = {}
): Promise<DeductCreditsResult> {
  // Guard against an unknown/missing tool cost (e.g. TOOL_CREDIT_COSTS["typo"] === undefined).
  // Without this, `current - undefined` writes NaN to the balance and corrupts the account.
  if (typeof cost !== "number" || !Number.isSafeInteger(cost) || cost <= 0) {
    throw new HttpsError(
      "invalid-argument",
      `Invalid credit cost for ${tool}. This is a configuration error.`
    );
  }

  await ensurePlatformCaches();

  const userRef = db.collection(USERS_COLLECTION).doc(uid);
  const requestId = normalizeRequestId(options.requestId);
  const eventRef = usageEventRef(uid, requestId);

  if (requestId) {
    const existing = await eventRef.get();
    if (existing.exists) {
      const data = existing.data() ?? {};
      return {
        charged: false,
        duplicate: true,
        balanceAfter: Number(data.balance_after ?? 0),
        usageEventId: eventRef.id,
      };
    }
  }

  let attempt = 0;
  let balanceAfter = 0;
  let duplicate = false;

  while (attempt < MAX_RETRIES) {
    try {
      await db.runTransaction(async (tx) => {
        const existing = requestId ? await tx.get(eventRef) : null;
        if (existing?.exists) {
          const data = existing.data() ?? {};
          duplicate = true;
          balanceAfter = Number(data.balance_after ?? 0);
          return;
        }

        const snap = await tx.get(userRef);

        if (!snap.exists) {
          throw new HttpsError(
            "not-found",
            `User profile not found. Please sign out and sign back in.`
          );
        }

        const current = snap.get(USER_FIELDS.credits) ?? 0;
        if (typeof current !== "number" || !Number.isSafeInteger(current) || current < 0) {
          throw new HttpsError(
            "failed-precondition",
            "Your credit balance requires support review before another tool can run.",
          );
        }

        if (current < cost) {
          throw new HttpsError(
            "failed-precondition",
            `Insufficient credits for ${tool}. ` +
              `Required: ${cost}, available: ${current}. ` +
              `Please purchase more credits.`
          );
        }

        balanceAfter = current - cost;
        const dayKey = utcDayKey();
        await reserveUsageQuota(tx, uid, cost, tool, snap, dayKey);
        tx.update(userRef, { [USER_FIELDS.credits]: balanceAfter });
        tx.set(eventRef, {
          uid,
          tool,
          credit_cost: cost,
          status: "deducted",
          day_key: dayKey,
          request_id: requestId ?? null,
          balance_after: balanceAfter,
          created_at: FieldValue.serverTimestamp(),
        });
        tx.set(db.collection(CREDIT_LEDGER_COLLECTION).doc(), {
          uid,
          amount: -cost,
          balance_after: balanceAfter,
          reason: "tool_deduction",
          tool,
          request_id: requestId ?? null,
          created_at: FieldValue.serverTimestamp(),
        });
      });

      return {
        charged: !duplicate,
        duplicate,
        balanceAfter,
        usageEventId: eventRef.id,
      };
    } catch (err) {
      // Re-throw our own HttpsErrors immediately — no retry needed.
      if (err instanceof HttpsError) throw err;

      attempt++;

      if (attempt >= MAX_RETRIES) {
        console.error(`deductCredits: all ${MAX_RETRIES} attempts failed`, {
          uid,
          cost,
          tool,
          err,
        });
        throw new HttpsError(
          "resource-exhausted",
          "Too many concurrent requests. Please try again in a moment."
        );
      }

      // Brief back-off before retry (exponential: 50ms, 100ms, 200ms …)
      await new Promise((r) => setTimeout(r, 50 * Math.pow(2, attempt - 1)));
    }
  }

  throw new HttpsError(
    "resource-exhausted",
    "Too many concurrent requests. Please try again in a moment."
  );
}

/**
 * Applies the admin-configured price for a user-visible tool. A configured cost
 * of 0 is still metered as a free run so daily run caps and audit counters work.
 */
export async function meterToolRun(
  uid: string,
  tool: string,
  defaultCost: number,
  options: DeductCreditsOptions = {}
): Promise<MeterToolRunResult> {
  await ensurePlatformCaches();
  const creditCost = getToolCreditCost(tool, defaultCost);
  if (creditCost > 0) {
    return { ...(await deductCredits(uid, creditCost, tool, options)), creditCost };
  }
  const run = await recordFreeToolRun(uid, tool, options);
  return {
    charged: false,
    duplicate: run.duplicate,
    balanceAfter: 0,
    creditCost: 0,
  };
}

/** Claims one paid/config-priced AI execution and rejects requestId replays. */
export async function claimMeteredToolRun(
  uid: string,
  tool: string,
  defaultCost: number,
  options: DeductCreditsOptions = {}
): Promise<MeterToolRunResult> {
  const result = await meterToolRun(uid, tool, defaultCost, options);
  requireFreshToolRun(result);
  return result;
}

export interface RecordFreeRunResult {
  counted: boolean;
  duplicate: boolean;
}

/**
 * Meters a FREE AI tool run (credit_cost 0). Free helpers (creditKey:null in the tool
 * registry) don't deduct credits, but they must still (a) count toward the free-tier
 * daily run cap — otherwise they are an unbounded free-LLM faucet — and (b) leave a
 * usage event + counter so ALL AI usage is observable. Mirrors deductCredits'
 * idempotency (same uid+requestId records the run at most once) without touching the
 * credit balance or the ledger.
 *
 * @throws HttpsError("resource-exhausted") — free-tier daily run cap reached.
 */
export async function recordFreeToolRun(
  uid: string,
  tool: string,
  options: DeductCreditsOptions = {}
): Promise<RecordFreeRunResult> {
  await ensurePlatformCaches();

  const requestId = normalizeRequestId(options.requestId);
  const eventRef = usageEventRef(uid, requestId);

  if (requestId) {
    const existing = await eventRef.get();
    if (existing.exists) {
      return { counted: false, duplicate: true };
    }
  }

  let duplicate = false;
  await db.runTransaction(async (tx) => {
    if (requestId) {
      const existing = await tx.get(eventRef);
      if (existing.exists) {
        duplicate = true;
        return;
      }
    }
    const dayKey = utcDayKey();
    const userSnap = await tx.get(db.collection(USERS_COLLECTION).doc(uid));
    await reserveUsageQuota(tx, uid, 0, tool, userSnap, dayKey);
    tx.set(eventRef, {
      uid,
      tool,
      credit_cost: 0,
      status: "free",
      day_key: dayKey,
      request_id: requestId ?? null,
      balance_after: null,
      created_at: FieldValue.serverTimestamp(),
    });
  });

  return { counted: !duplicate, duplicate };
}

/** Claims one free AI execution and rejects requestId replays. */
export async function claimFreeToolRun(
  uid: string,
  tool: string,
  options: DeductCreditsOptions = {}
): Promise<RecordFreeRunResult> {
  const result = await recordFreeToolRun(uid, tool, options);
  requireFreshToolRun(result);
  return result;
}

function noRefund(failureReason?: RefundFailureReason): RefundCreditsResult {
  return {
    refunded: false,
    duplicate: false,
    amount: 0,
    ...(failureReason ? { failureReason } : {}),
  };
}

function validUsageEventId(usageEventId: unknown): usageEventId is string {
  return (
    typeof usageEventId === "string" &&
    usageEventId.length > 0 &&
    Buffer.byteLength(usageEventId, "utf8") <= 1_500 &&
    !usageEventId.includes("/")
  );
}

function canonicalUtcDayKey(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && utcDayKey(parsed) === value ? value : undefined;
}

function originalUsageDayKey(eventData: admin.firestore.DocumentData): string | undefined {
  const stored = eventData.day_key;
  const canonicalStored = canonicalUtcDayKey(stored);
  if (canonicalStored) return canonicalStored;

  const createdAt = typeof eventData.created_at?.toDate === "function"
    ? eventData.created_at.toDate()
    : typeof eventData.created_at === "string"
      ? new Date(eventData.created_at)
      : undefined;
  return createdAt instanceof Date && Number.isFinite(createdAt.getTime())
    ? utcDayKey(createdAt)
    : undefined;
}

function nonNegativeCounter(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * Executes only the idempotent refund transaction. Recovery workers call this
 * primitive directly so a retry failure never creates a second queue record.
 */
export async function applyCreditRefund(
  uid: string,
  usageEventId: string
): Promise<RefundCreditsResult> {
  if (!validUsageEventId(usageEventId)) return noRefund("usage_event_mismatch");

  const usageEventRef = db.collection(USAGE_EVENTS_COLLECTION).doc(usageEventId);
  const userRef = db.collection(USERS_COLLECTION).doc(uid);
  const refundDocPart = requestDocPart(usageEventId);
  const refundEventRef = db.collection(USAGE_EVENTS_COLLECTION).doc(`refund_${refundDocPart}`);
  const refundLedgerRef = db.collection(CREDIT_LEDGER_COLLECTION).doc(`refund_${refundDocPart}`);

  return db.runTransaction(async (tx): Promise<RefundCreditsResult> => {
    const usageEvent = await tx.get(usageEventRef);
    if (!usageEvent.exists) return noRefund("usage_event_missing");
    const eventData = usageEvent.data() ?? {};
    const amount = eventData.credit_cost ?? 0;
    if (eventData.uid !== uid || eventData.status !== "deducted") {
      return noRefund("usage_event_mismatch");
    }
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) {
      return noRefund("invalid_credit_amount");
    }
    if (eventData.refund_status === "refunded") {
      const rawBalanceAfter = Number(eventData.refund_balance_after);
      return {
        refunded: false,
        duplicate: true,
        amount,
        ...(Number.isFinite(rawBalanceAfter) ? { balanceAfter: rawBalanceAfter } : {}),
      };
    }

    const user = await tx.get(userRef);
    if (!user.exists) return noRefund("user_missing");
    const current = user.get(USER_FIELDS.credits) ?? 0;
    if (typeof current !== "number" || !Number.isSafeInteger(current) || current < 0) {
      return noRefund("invalid_user_balance");
    }
    const balanceAfter = current + amount;
    if (!Number.isSafeInteger(balanceAfter)) return noRefund("invalid_user_balance");
    const now = FieldValue.serverTimestamp();
    const usageDayKey = originalUsageDayKey(eventData);
    const usageCounterStatus = await refundUsageCredits(
      tx,
      uid,
      amount,
      usageDayKey,
    );
    tx.update(userRef, { [USER_FIELDS.credits]: balanceAfter });
    tx.update(usageEventRef, {
      refund_status: "refunded",
      refund_usage_counter_status: usageCounterStatus,
      refunded_at: now,
      refund_balance_after: balanceAfter,
    });
    tx.set(refundEventRef, {
      uid,
      tool: eventData.tool ?? "refund",
      credit_cost: amount,
      status: "refunded",
      day_key: utcDayKey(),
      request_id: eventData.request_id ?? null,
      original_usage_event_id: usageEventRef.id,
      balance_after: balanceAfter,
      created_at: now,
    });
    tx.set(refundLedgerRef, {
      uid,
      amount,
      balance_after: balanceAfter,
      reason: "tool_refund",
      tool: eventData.tool ?? null,
      request_id: eventData.request_id ?? null,
      original_usage_event_id: usageEventRef.id,
      created_at: now,
    });
    if (usageCounterStatus === "counter_underflow" || usageCounterStatus === "unknown_day") {
      tx.set(
        db.collection(USAGE_COUNTER_RECONCILIATION_REVIEWS_COLLECTION).doc(usageEventRef.id),
        {
          uid,
          usage_event_id: usageEventRef.id,
          day_key: usageDayKey ?? null,
          reason: usageCounterStatus,
          status: "pending",
          created_at: now,
          updated_at: now,
        },
        { merge: true },
      );
    }
    return { refunded: true, duplicate: false, amount, balanceAfter };
  });
}

/**
 * Persists the minimum recovery envelope. The reason is a fixed code and the
 * record deliberately omits prompts, model output, request payloads, and errors.
 */
async function enqueueCreditRefundReview(
  uid: string,
  usageEventId: string,
  reason = "refund_transaction_failed"
): Promise<void> {
  if (!validUsageEventId(usageEventId)) {
    throw new Error("Invalid usage event id for refund recovery.");
  }

  const reviewRef = db.collection(CREDIT_REFUND_REVIEWS_COLLECTION).doc(usageEventId);
  const usageEventRef = db.collection(USAGE_EVENTS_COLLECTION).doc(usageEventId);
  await db.runTransaction(async (tx) => {
    const review = await tx.get(reviewRef);
    const usageEvent = await tx.get(usageEventRef);
    const eventData = usageEvent.data() ?? {};
    const rawAmount = Number(eventData.credit_cost ?? 0);
    const amount = Number.isFinite(rawAmount) && rawAmount > 0 ? rawAmount : 0;
    const now = FieldValue.serverTimestamp();
    const existingStatus = review.exists ? String(review.get("status") ?? "") : "";
    const existingLeaseExpiry = review.exists
      ? review.get("lease_expires_at")
      : undefined;
    const existingOwnerToken = review.exists ? review.get("owner_token") : undefined;
    const nextAttemptAt =
      typeof existingOwnerToken === "string" && existingLeaseExpiry
        ? existingLeaseExpiry
        : now;
    const terminal = ["resolved", "failed_permanent", "manual_review"].includes(
      existingStatus
    );

    if (terminal) {
      tx.set(
        reviewRef,
        {
          enqueue_count: nonNegativeCounter(review.get("enqueue_count")) + 1,
          last_enqueued_at: now,
          updated_at: now,
        },
        { merge: true }
      );
      return;
    }

    tx.set(
      reviewRef,
      {
        uid,
        usage_event_id: usageEventId,
        amount,
        reason,
        status: "pending",
        next_attempt_at: nextAttemptAt,
        attempts: nonNegativeCounter(review.get("attempts")),
        enqueue_count: nonNegativeCounter(review.get("enqueue_count")) + 1,
        last_enqueued_at: now,
        updated_at: now,
        ...(!review.exists ? { created_at: now } : {}),
      },
      { merge: true }
    );
  });
}

/**
 * Refunds the exact server-written usage event. A transient transaction failure
 * is converted into a durable, deterministic recovery item. If that safety write
 * also fails, the error is surfaced so the calling function cannot report a
 * silently lost refund.
 */
export async function refundCredits(
  uid: string,
  charge: RefundableCharge
): Promise<RefundCreditsResult> {
  if (!charge.charged || !validUsageEventId(charge.usageEventId)) {
    return noRefund();
  }

  let result: RefundCreditsResult;
  try {
    result = await applyCreditRefund(uid, charge.usageEventId);
  } catch (err) {
    console.error("refundCredits transaction failed; scheduling recovery", {
      errorType: err instanceof Error ? err.name : "UnknownError",
    });
    try {
      await enqueueCreditRefundReview(uid, charge.usageEventId);
    } catch (recoveryErr) {
      console.error("refundCredits recovery enqueue failed", {
        errorType: recoveryErr instanceof Error ? recoveryErr.name : "UnknownError",
      });
      throw new HttpsError(
        "internal",
        "Credit refund recovery could not be scheduled. Please contact support."
      );
    }
    return noRefund();
  }

  // A transaction may complete without refunding when the source event or
  // account is inconsistent. That is still money-equivalent customer impact,
  // so leave a durable operator record instead of silently returning a miss.
  if (result.failureReason) {
    try {
      await enqueueCreditRefundReview(
        uid,
        charge.usageEventId,
        `refund_invariant_${result.failureReason}`
      );
    } catch (recoveryErr) {
      console.error("refundCredits recovery enqueue failed", {
        errorType: recoveryErr instanceof Error ? recoveryErr.name : "UnknownError",
      });
      throw new HttpsError(
        "internal",
        "Credit refund recovery could not be scheduled. Please contact support."
      );
    }
  }
  return result;
}
