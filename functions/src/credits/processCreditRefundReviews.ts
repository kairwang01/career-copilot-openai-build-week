/**
 * Durable retry worker for credit refunds that could not commit inline.
 *
 * The refund transaction is idempotent, so overlapping scheduler invocations are
 * safe. A bounded attempt count moves persistent infrastructure failures to a
 * manual-review state instead of retrying forever.
 */

import { randomUUID } from "node:crypto";
import * as admin from "firebase-admin";
import {
  DocumentReference,
  FieldPath,
  FieldValue,
  Timestamp,
} from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  applyCreditRefund,
  CREDIT_REFUND_REVIEWS_COLLECTION,
  RefundCreditsResult,
} from "./deductCredits";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export const CREDIT_REFUND_REVIEW_BATCH_SIZE = 50;
export const CREDIT_REFUND_LEGACY_SCAN_SIZE = 100;
export const MAX_CREDIT_REFUND_REVIEW_ATTEMPTS = 10;
export const CREDIT_REFUND_REVIEW_LEASE_MS = 5 * 60_000;
export const CREDIT_REFUND_RETRY_BASE_MS = 10 * 60_000;
export const CREDIT_REFUND_RETRY_MAX_MS = 6 * 60 * 60_000;

const CREDIT_REFUND_WORKER_STATE_COLLECTION = "credit_refund_worker_state";
const LEGACY_NEXT_ATTEMPT_CURSOR_ID = "legacy_next_attempt_at_v1";

type ApplyRefund = (
  uid: string,
  usageEventId: string
) => Promise<RefundCreditsResult>;

export interface CreditRefundReviewBatchOptions {
  limit?: number;
  legacyScanLimit?: number;
  maxAttempts?: number;
  applyRefund?: ApplyRefund;
  nowMs?: number;
  leaseMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  ownerTokenFactory?: () => string;
}

export interface CreditRefundReviewBatchStats {
  scanned: number;
  legacyScanned: number;
  legacyBackfilled: number;
  resolved: number;
  permanentFailures: number;
  retryPending: number;
  manualReview: number;
  skipped: number;
}

type ReviewOutcome =
  | "resolved"
  | "permanent_failure"
  | "retry_pending"
  | "manual_review"
  | "skipped";

interface ClaimedReview {
  uid: string;
  usageEventId: string;
  ownerToken: string;
  attempts: number;
}

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number
): number {
  if (!Number.isInteger(value) || Number(value) <= 0) return fallback;
  return Math.min(Number(value), maximum);
}

function nonNegativeCounter(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function boundedDuration(
  value: number | undefined,
  fallback: number,
  maximum: number
): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) return fallback;
  return Math.min(Number(value), maximum);
}

function timestampMillis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (
    value &&
    typeof value === "object" &&
    "toMillis" in value &&
    typeof (value as { toMillis?: unknown }).toMillis === "function"
  ) {
    const parsed = Number((value as { toMillis: () => number }).toMillis());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function creditRefundRetryDelayMs(
  attempts: number,
  baseMs = CREDIT_REFUND_RETRY_BASE_MS,
  maximumMs = CREDIT_REFUND_RETRY_MAX_MS
): number {
  const exponent = Math.max(0, Math.min(nonNegativeCounter(attempts) - 1, 20));
  return Math.min(maximumMs, baseMs * 2 ** exponent);
}

function validDocumentId(value: string): boolean {
  return value.length > 0 && !value.includes("/") && Buffer.byteLength(value, "utf8") <= 1_500;
}

/**
 * Advances a durable cursor across pending reviews and backfills records made
 * before next_attempt_at became mandatory. Firestore range queries omit a
 * document when the ordered field is absent, so the normal due-work query can
 * never discover those legacy records by itself.
 */
async function backfillLegacyNextAttemptAt(
  nowMs: number,
  scanLimit: number
): Promise<{ scanned: number; backfilled: number }> {
  const reviews = db.collection(CREDIT_REFUND_REVIEWS_COLLECTION);
  const stateRef = db
    .collection(CREDIT_REFUND_WORKER_STATE_COLLECTION)
    .doc(LEGACY_NEXT_ATTEMPT_CURSOR_ID);

  return db.runTransaction(async (tx) => {
    const state = await tx.get(stateRef);
    const rawCursor = state.get("cursor_id");
    const cursor =
      typeof rawCursor === "string" && validDocumentId(rawCursor)
        ? rawCursor
        : "";
    const baseQuery = reviews
      .where("status", "==", "pending")
      .orderBy(FieldPath.documentId(), "asc");
    const firstPage = await tx.get(
      cursor
        ? baseQuery.startAfter(cursor).limit(scanLimit)
        : baseQuery.limit(scanLimit)
    );
    const docs = [...firstPage.docs];

    // Wrap within the same bounded transaction so every pending document is
    // eventually visited even when long-lived future retries sort first.
    if (cursor && docs.length < scanLimit) {
      const wrapped = await tx.get(
        baseQuery.endAt(cursor).limit(scanLimit - docs.length)
      );
      docs.push(...wrapped.docs);
    }

    const now = Timestamp.fromMillis(nowMs);
    let backfilled = 0;
    for (const review of docs) {
      if (timestampMillis(review.get("next_attempt_at")) !== null) continue;
      tx.update(review.ref, {
        next_attempt_at: now,
        legacy_next_attempt_backfilled_at: now,
        updated_at: now,
      });
      backfilled++;
    }

    if (docs.length > 0) {
      tx.set(
        stateRef,
        {
          cursor_id: docs[docs.length - 1].id,
          last_scan_at: now,
          last_scanned_count: docs.length,
          last_backfilled_count: backfilled,
        },
        { merge: true }
      );
    } else if (cursor) {
      tx.set(
        stateRef,
        {
          cursor_id: FieldValue.delete(),
          last_scan_at: now,
          last_scanned_count: 0,
          last_backfilled_count: 0,
        },
        { merge: true }
      );
    }

    return { scanned: docs.length, backfilled };
  });
}

async function claimReview(
  reviewRef: DocumentReference,
  maxAttempts: number,
  nowMs: number,
  leaseMs: number,
  ownerToken: string
): Promise<ClaimedReview | "manual_review" | null> {
  return db.runTransaction(async (tx) => {
    const review = await tx.get(reviewRef);
    if (!review.exists || review.get("status") !== "pending") return null;

    const nextAttemptAtMs = timestampMillis(review.get("next_attempt_at"));
    if (nextAttemptAtMs !== null && nextAttemptAtMs > nowMs) return null;
    const leaseExpiresAtMs = timestampMillis(review.get("lease_expires_at"));
    if (leaseExpiresAtMs !== null && leaseExpiresAtMs > nowMs) return null;

    const attempts = nonNegativeCounter(review.get("attempts")) + 1;
    const now = Timestamp.fromMillis(nowMs);
    if (attempts > maxAttempts) {
      tx.update(reviewRef, {
        status: "manual_review",
        attempts,
        last_error_code: "retry_limit_reached",
        last_attempt_at: now,
        updated_at: now,
        next_attempt_at: FieldValue.delete(),
        lease_expires_at: FieldValue.delete(),
        owner_token: FieldValue.delete(),
      });
      return "manual_review";
    }

    const leaseExpiresAt = Timestamp.fromMillis(nowMs + leaseMs);
    tx.update(reviewRef, {
      attempts,
      owner_token: ownerToken,
      lease_expires_at: leaseExpiresAt,
      // A crashed worker becomes queryable again exactly when its lease expires.
      next_attempt_at: leaseExpiresAt,
      last_attempt_at: now,
      updated_at: now,
    });
    return {
      uid: typeof review.get("uid") === "string" ? review.get("uid") : "",
      usageEventId:
        typeof review.get("usage_event_id") === "string"
          ? review.get("usage_event_id")
          : reviewRef.id,
      ownerToken,
      attempts,
    };
  });
}

async function markResolved(
  reviewRef: DocumentReference,
  result: RefundCreditsResult,
  ownerToken: string,
  nowMs: number
): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const review = await tx.get(reviewRef);
    if (
      !review.exists ||
      review.get("status") !== "pending" ||
      review.get("owner_token") !== ownerToken
    ) return false;
    const now = Timestamp.fromMillis(nowMs);
    tx.update(reviewRef, {
      status: "resolved",
      resolution: result.duplicate ? "already_refunded" : "refunded",
      resolved_amount: result.amount,
      resolved_balance_after: result.balanceAfter ?? null,
      resolved_at: now,
      updated_at: now,
      last_error_code: FieldValue.delete(),
      next_attempt_at: FieldValue.delete(),
      lease_expires_at: FieldValue.delete(),
      owner_token: FieldValue.delete(),
    });
    return true;
  });
}

async function markPermanentFailure(
  reviewRef: DocumentReference,
  failureCode: string,
  ownerToken: string,
  nowMs: number
): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const review = await tx.get(reviewRef);
    if (
      !review.exists ||
      review.get("status") !== "pending" ||
      review.get("owner_token") !== ownerToken
    ) return false;
    const now = Timestamp.fromMillis(nowMs);
    tx.update(reviewRef, {
      status: "failed_permanent",
      last_error_code: failureCode,
      resolved_at: now,
      updated_at: now,
      next_attempt_at: FieldValue.delete(),
      lease_expires_at: FieldValue.delete(),
      owner_token: FieldValue.delete(),
    });
    return true;
  });
}

async function markTransientFailure(
  reviewRef: DocumentReference,
  maxAttempts: number,
  ownerToken: string,
  nowMs: number,
  retryBaseMs: number,
  retryMaxMs: number
): Promise<ReviewOutcome> {
  return db.runTransaction(async (tx) => {
    const review = await tx.get(reviewRef);
    if (!review.exists) return "skipped";
    const status = String(review.get("status") ?? "");
    if (status === "resolved") return "resolved";
    if (status === "failed_permanent") return "permanent_failure";
    if (status === "manual_review") return "manual_review";
    if (status !== "pending" || review.get("owner_token") !== ownerToken) {
      return "skipped";
    }

    const attempts = nonNegativeCounter(review.get("attempts"));
    const exhausted = attempts >= maxAttempts;
    const now = Timestamp.fromMillis(nowMs);
    const nextAttemptAt = Timestamp.fromMillis(
      nowMs + creditRefundRetryDelayMs(attempts, retryBaseMs, retryMaxMs)
    );
    tx.update(reviewRef, {
      status: exhausted ? "manual_review" : "pending",
      last_error_code: exhausted ? "retry_limit_reached" : "refund_retry_failed",
      updated_at: now,
      next_attempt_at: exhausted ? FieldValue.delete() : nextAttemptAt,
      lease_expires_at: FieldValue.delete(),
      owner_token: FieldValue.delete(),
    });
    return exhausted ? "manual_review" : "retry_pending";
  });
}

async function processReview(
  reviewRef: DocumentReference,
  applyRefund: ApplyRefund,
  maxAttempts: number,
  nowMs: number,
  leaseMs: number,
  retryBaseMs: number,
  retryMaxMs: number,
  ownerToken: string
): Promise<ReviewOutcome> {
  const claimed = await claimReview(
    reviewRef,
    maxAttempts,
    nowMs,
    leaseMs,
    ownerToken
  );
  if (!claimed) return "skipped";
  if (claimed === "manual_review") return "manual_review";

  if (!validDocumentId(claimed.uid) || !validDocumentId(claimed.usageEventId)) {
    return await markPermanentFailure(
      reviewRef,
      "invalid_review_record",
      claimed.ownerToken,
      nowMs
    ) ? "permanent_failure" : "skipped";
  }

  try {
    const result = await applyRefund(claimed.uid, claimed.usageEventId);
    if (result.refunded || result.duplicate) {
      return await markResolved(reviewRef, result, claimed.ownerToken, nowMs)
        ? "resolved"
        : "skipped";
    }

    return await markPermanentFailure(
      reviewRef,
      result.failureReason ?? "refund_not_applicable",
      claimed.ownerToken,
      nowMs
    ) ? "permanent_failure" : "skipped";
  } catch (err) {
    logger.error("Credit refund recovery attempt failed", {
      errorType: err instanceof Error ? err.name : "UnknownError",
    });
    return markTransientFailure(
      reviewRef,
      maxAttempts,
      claimed.ownerToken,
      nowMs,
      retryBaseMs,
      retryMaxMs
    );
  }
}

/** Processes one bounded page; exported for emulator tests and operator tooling. */
export async function processCreditRefundReviewsBatch(
  options: CreditRefundReviewBatchOptions = {}
): Promise<CreditRefundReviewBatchStats> {
  const limit = boundedPositiveInteger(
    options.limit,
    CREDIT_REFUND_REVIEW_BATCH_SIZE,
    100
  );
  const legacyScanLimit = boundedPositiveInteger(
    options.legacyScanLimit,
    CREDIT_REFUND_LEGACY_SCAN_SIZE,
    100
  );
  const maxAttempts = boundedPositiveInteger(
    options.maxAttempts,
    MAX_CREDIT_REFUND_REVIEW_ATTEMPTS,
    25
  );
  const applyRefund = options.applyRefund ?? applyCreditRefund;
  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const leaseMs = boundedDuration(options.leaseMs, CREDIT_REFUND_REVIEW_LEASE_MS, 30 * 60_000);
  const retryBaseMs = boundedDuration(options.retryBaseMs, CREDIT_REFUND_RETRY_BASE_MS, 24 * 60 * 60_000);
  const retryMaxMs = Math.max(
    retryBaseMs,
    boundedDuration(options.retryMaxMs, CREDIT_REFUND_RETRY_MAX_MS, 7 * 24 * 60 * 60_000)
  );
  const ownerTokenFactory = options.ownerTokenFactory ?? randomUUID;
  const legacy = await backfillLegacyNextAttemptAt(nowMs, legacyScanLimit);
  const pending = await db
    .collection(CREDIT_REFUND_REVIEWS_COLLECTION)
    .where("status", "==", "pending")
    .where("next_attempt_at", "<=", Timestamp.fromMillis(nowMs))
    .orderBy("next_attempt_at", "asc")
    .orderBy(FieldPath.documentId(), "asc")
    .limit(limit)
    .get();
  const stats: CreditRefundReviewBatchStats = {
    scanned: pending.size,
    legacyScanned: legacy.scanned,
    legacyBackfilled: legacy.backfilled,
    resolved: 0,
    permanentFailures: 0,
    retryPending: 0,
    manualReview: 0,
    skipped: 0,
  };

  for (const review of pending.docs) {
    const outcome = await processReview(
      review.ref,
      applyRefund,
      maxAttempts,
      nowMs,
      leaseMs,
      retryBaseMs,
      retryMaxMs,
      ownerTokenFactory()
    );
    if (outcome === "resolved") stats.resolved++;
    else if (outcome === "permanent_failure") stats.permanentFailures++;
    else if (outcome === "retry_pending") stats.retryPending++;
    else if (outcome === "manual_review") stats.manualReview++;
    else stats.skipped++;
  }

  return stats;
}

export const processCreditRefundReviewsFunction = onSchedule(
  {
    schedule: "*/10 * * * *",
    timeZone: "UTC",
    timeoutSeconds: 300,
    memory: "256MiB",
    maxInstances: 1,
    retryCount: 0,
  },
  async () => {
    const stats = await processCreditRefundReviewsBatch();
    logger.info("Credit refund recovery batch complete", stats);
  }
);
