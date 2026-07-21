/**
 * Durable credit-refund recovery tests (Firestore emulator).
 *
 * Run with:
 * firebase emulators:exec --only firestore --project demo-careercopilot \
 *   "npx vitest run tests/creditRefundRecovery.callable.test.ts"
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as admin from "../functions/node_modules/firebase-admin";
import {
  CREDIT_REFUND_REVIEWS_COLLECTION,
  refundCredits,
} from "../functions/src/credits/deductCredits";
import {
  creditRefundRetryDelayMs,
  processCreditRefundReviewsBatch,
} from "../functions/src/credits/processCreditRefundReviews";

const PROJECT = process.env.GCLOUD_PROJECT || "demo-careercopilot";
const db = admin.firestore();

async function clearFirestore(): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
  await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    { method: "DELETE" }
  );
}

async function seedDeductedUsage(
  uid: string,
  usageEventId: string,
  amount = 10
): Promise<void> {
  await db.collection("users").doc(uid).set({ credits: 90 });
  await db.collection("usage_events").doc(usageEventId).set({
    uid,
    tool: "test-tool",
    credit_cost: amount,
    status: "deducted",
    request_id: "test-request-id",
  });
}

async function seedPendingReview(
  uid: string,
  usageEventId: string,
  amount = 10
): Promise<void> {
  await db.collection(CREDIT_REFUND_REVIEWS_COLLECTION).doc(usageEventId).set({
    uid,
    usage_event_id: usageEventId,
    amount,
    reason: "refund_transaction_failed",
    status: "pending",
    next_attempt_at: new Date(0),
    attempts: 0,
    enqueue_count: 1,
  });
}

beforeEach(clearFirestore);
afterEach(() => vi.restoreAllMocks());

describe("durable credit refund recovery", () => {
  it("queues a deterministic, prompt-free review when the inline transaction fails", async () => {
    const uid = "refund-queue-user";
    const usageEventId = "refund-queue-event";
    await seedDeductedUsage(uid, usageEventId, 10);

    vi.spyOn(db, "runTransaction").mockRejectedValueOnce(
      new Error("simulated inline transaction failure")
    );

    const result = await refundCredits(uid, { charged: true, usageEventId });
    expect(result).toMatchObject({ refunded: false, duplicate: false, amount: 0 });

    const review = (
      await db.collection(CREDIT_REFUND_REVIEWS_COLLECTION).doc(usageEventId).get()
    ).data()!;
    expect(review).toMatchObject({
      uid,
      usage_event_id: usageEventId,
      amount: 10,
      reason: "refund_transaction_failed",
      status: "pending",
      next_attempt_at: expect.anything(),
      attempts: 0,
      enqueue_count: 1,
    });
    expect(review).not.toHaveProperty("prompt");
    expect(review).not.toHaveProperty("request_payload");
    expect(review).not.toHaveProperty("model_output");
    expect(review).not.toHaveProperty("error_message");
  });

  it("throws when both the refund and its recovery queue write fail", async () => {
    const uid = "refund-queue-failure-user";
    const usageEventId = "refund-queue-failure-event";
    await seedDeductedUsage(uid, usageEventId, 10);

    vi.spyOn(db, "runTransaction")
      .mockRejectedValueOnce(new Error("simulated inline failure"))
      .mockRejectedValueOnce(new Error("simulated queue failure"));

    await expect(
      refundCredits(uid, { charged: true, usageEventId })
    ).rejects.toThrow(/recovery could not be scheduled/i);
  });

  it("queues a completed but non-applicable inline refund for operator recovery", async () => {
    const uid = "refund-inconsistent-user";
    const usageEventId = "refund-inconsistent-event";

    await expect(refundCredits(uid, { charged: true, usageEventId })).resolves.toMatchObject({
      refunded: false,
      failureReason: "usage_event_missing",
    });
    expect(
      (await db.collection(CREDIT_REFUND_REVIEWS_COLLECTION).doc(usageEventId).get()).data(),
    ).toMatchObject({
      uid,
      status: "pending",
      reason: "refund_invariant_usage_event_missing",
    });
  });

  it("processes a pending review and resolves it after one idempotent refund", async () => {
    const uid = "refund-worker-user";
    const usageEventId = "refund-worker-event";
    await seedDeductedUsage(uid, usageEventId, 10);
    await seedPendingReview(uid, usageEventId, 10);

    const stats = await processCreditRefundReviewsBatch();
    expect(stats).toMatchObject({ scanned: 1, resolved: 1 });
    expect((await db.collection("users").doc(uid).get()).get("credits")).toBe(100);
    expect(
      (await db.collection("usage_events").doc(usageEventId).get()).get(
        "refund_status"
      )
    ).toBe("refunded");

    const reviewRef = db
      .collection(CREDIT_REFUND_REVIEWS_COLLECTION)
      .doc(usageEventId);
    expect((await reviewRef.get()).data()).toMatchObject({
      status: "resolved",
      resolution: "refunded",
      resolved_amount: 10,
      attempts: 1,
    });

    // Simulate a replayed queue item. The source event is already refunded, so
    // the balance must stay unchanged and the review resolves as a duplicate.
    // Resolved records intentionally have no next_attempt_at; reopening such a
    // legacy-shaped record must not make it invisible to the range query.
    await reviewRef.set({ status: "pending", attempts: 0 }, { merge: true });
    expect((await reviewRef.get()).get("next_attempt_at")).toBeUndefined();
    const replayStats = await processCreditRefundReviewsBatch();
    expect(replayStats).toMatchObject({
      scanned: 1,
      legacyBackfilled: 1,
      resolved: 1,
    });
    expect((await db.collection("users").doc(uid).get()).get("credits")).toBe(100);
    expect((await reviewRef.get()).data()).toMatchObject({
      status: "resolved",
      resolution: "already_refunded",
      resolved_amount: 10,
      attempts: 1,
    });
  });

  it("rotates a bounded legacy scan past future retries without starvation", async () => {
    const nowMs = 2_100_000_000_000;
    const future = new Date(nowMs + 60_000);
    await Promise.all([
      db.collection(CREDIT_REFUND_REVIEWS_COLLECTION).doc("a-future").set({
        status: "pending",
        next_attempt_at: future,
      }),
      db.collection(CREDIT_REFUND_REVIEWS_COLLECTION).doc("b-future").set({
        status: "pending",
        next_attempt_at: future,
      }),
      seedDeductedUsage("legacy-user", "z-legacy", 10),
      db.collection(CREDIT_REFUND_REVIEWS_COLLECTION).doc("z-legacy").set({
        uid: "legacy-user",
        usage_event_id: "z-legacy",
        amount: 10,
        status: "pending",
        attempts: 0,
      }),
    ]);

    const first = await processCreditRefundReviewsBatch({
      nowMs,
      limit: 1,
      legacyScanLimit: 2,
    });
    expect(first).toMatchObject({
      scanned: 0,
      legacyScanned: 2,
      legacyBackfilled: 0,
    });

    const second = await processCreditRefundReviewsBatch({
      nowMs,
      limit: 1,
      legacyScanLimit: 2,
    });
    expect(second).toMatchObject({
      scanned: 1,
      legacyScanned: 2,
      legacyBackfilled: 1,
      resolved: 1,
    });
    expect((await db.collection("users").doc("legacy-user").get()).get("credits")).toBe(100);
  });

  it("marks a non-applicable refund as a permanent failure", async () => {
    const uid = "refund-missing-event-user";
    const usageEventId = "refund-missing-event";
    await seedPendingReview(uid, usageEventId, 10);

    const stats = await processCreditRefundReviewsBatch();
    expect(stats.permanentFailures).toBe(1);
    expect(
      (
        await db
          .collection(CREDIT_REFUND_REVIEWS_COLLECTION)
          .doc(usageEventId)
          .get()
      ).data()
    ).toMatchObject({
      status: "failed_permanent",
      last_error_code: "usage_event_missing",
      attempts: 1,
    });
  });

  it("keeps transient failures pending, then stops at the bounded retry limit", async () => {
    const uid = "refund-transient-user";
    const usageEventId = "refund-transient-event";
    await seedPendingReview(uid, usageEventId, 10);
    const failingRefund = async () => {
      throw new Error("simulated transient Firestore failure");
    };

    const nowMs = 1_800_000_000_000;
    const first = await processCreditRefundReviewsBatch({
      maxAttempts: 2,
      applyRefund: failingRefund,
      nowMs,
      retryBaseMs: 1_000,
      retryMaxMs: 4_000,
    });
    expect(first.retryPending).toBe(1);

    const deferred = await processCreditRefundReviewsBatch({
      maxAttempts: 2,
      applyRefund: failingRefund,
      nowMs,
      retryBaseMs: 1_000,
      retryMaxMs: 4_000,
    });
    expect(deferred.scanned).toBe(0);

    const second = await processCreditRefundReviewsBatch({
      maxAttempts: 2,
      applyRefund: failingRefund,
      nowMs: nowMs + 1_000,
      retryBaseMs: 1_000,
      retryMaxMs: 4_000,
    });
    expect(second.manualReview).toBe(1);

    const review = (
      await db.collection(CREDIT_REFUND_REVIEWS_COLLECTION).doc(usageEventId).get()
    ).data()!;
    expect(review).toMatchObject({
      status: "manual_review",
      attempts: 2,
      last_error_code: "retry_limit_reached",
    });
    expect(
      (await db.collection(CREDIT_REFUND_REVIEWS_COLLECTION).get()).size
    ).toBe(1);

    const third = await processCreditRefundReviewsBatch({
      maxAttempts: 2,
      applyRefund: failingRefund,
      nowMs: nowMs + 10_000,
    });
    expect(third.scanned).toBe(0);
  });

  it("moves failing records behind other due work instead of starving the fixed first page", async () => {
    await Promise.all([
      seedPendingReview("refund-a-user", "refund-a"),
      seedPendingReview("refund-b-user", "refund-b"),
      seedPendingReview("refund-c-user", "refund-c"),
    ]);
    const nowMs = 1_900_000_000_000;
    const firstCalls: string[] = [];

    const first = await processCreditRefundReviewsBatch({
      limit: 2,
      nowMs,
      retryBaseMs: 60_000,
      applyRefund: async (_uid, usageEventId) => {
        firstCalls.push(usageEventId);
        throw new Error("simulated persistent failure");
      },
      ownerTokenFactory: () => "first-worker",
    });
    expect(firstCalls).toEqual(["refund-a", "refund-b"]);
    expect(first).toMatchObject({ scanned: 2, retryPending: 2 });

    const secondCalls: string[] = [];
    const second = await processCreditRefundReviewsBatch({
      limit: 2,
      nowMs,
      retryBaseMs: 60_000,
      applyRefund: async (_uid, usageEventId) => {
        secondCalls.push(usageEventId);
        return {
          refunded: true,
          duplicate: false,
          amount: 10,
          balanceAfter: 100,
        };
      },
      ownerTokenFactory: () => "second-worker",
    });
    expect(secondCalls).toEqual(["refund-c"]);
    expect(second).toMatchObject({ scanned: 1, resolved: 1 });
  });

  it("leases a claimed record so an overlapping worker cannot process it", async () => {
    await seedPendingReview("refund-lease-user", "refund-lease");
    const nowMs = 2_000_000_000_000;
    let releaseRefund!: () => void;
    let refundStarted!: () => void;
    const started = new Promise<void>((resolve) => { refundStarted = resolve; });
    const release = new Promise<void>((resolve) => { releaseRefund = resolve; });

    const first = processCreditRefundReviewsBatch({
      nowMs,
      leaseMs: 60_000,
      ownerTokenFactory: () => "lease-owner-a",
      applyRefund: async () => {
        refundStarted();
        await release;
        return { refunded: true, duplicate: false, amount: 10, balanceAfter: 100 };
      },
    });
    await started;

    const overlapping = await processCreditRefundReviewsBatch({
      nowMs,
      leaseMs: 60_000,
      ownerTokenFactory: () => "lease-owner-b",
      applyRefund: async () => {
        throw new Error("overlapping worker must not reach the refund");
      },
    });
    expect(overlapping.scanned).toBe(0);

    releaseRefund();
    await expect(first).resolves.toMatchObject({ resolved: 1 });
  });

  it("caps exponential retry delays", () => {
    expect(creditRefundRetryDelayMs(1, 1_000, 5_000)).toBe(1_000);
    expect(creditRefundRetryDelayMs(2, 1_000, 5_000)).toBe(2_000);
    expect(creditRefundRetryDelayMs(20, 1_000, 5_000)).toBe(5_000);
  });
});
