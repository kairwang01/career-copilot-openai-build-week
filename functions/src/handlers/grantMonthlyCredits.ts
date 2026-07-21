/**
 * grantMonthlyCredits — scheduled Cloud Function (runs daily at 00:10 UTC).
 *
 * Tops up every PAID subscriber's balance by their plan's monthly AI-credit
 * allotment (credits/planCredits.ts). Balances accumulate — unused credits never
 * expire — matching the pricing-page promise.
 *
 * ENTITLEMENT GATE (decision 2026-06-17): a recurring top-up is granted ONLY to
 * users whose active billing entitlement exactly matches the user's current
 * plan, audience, and recurring subscription mode,
 * which is written exclusively by a real Stripe payment or an admin — NEVER by
 * self-service plan selection. A missing or mismatched entitlement grants nothing.
 *
 * Idempotency: each user's last grant period lives in a server-only
 * `credit_renewals/{uid}` doc. A user is topped up only when that period differs
 * from the current "YYYY-MM", so a retried or doubly-fired schedule can never
 * double-grant.
 *
 * A server-only run checkpoint lets later invocations resume after the configured
 * per-run cap. Completed periods exit after one document read. Free / add-on plans
 * are excluded from the paginated query.
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import * as admin from "firebase-admin";
import {
  DocumentReference,
  FieldPath,
  FieldValue,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { USERS_COLLECTION, USER_FIELDS } from "../credits/schema";
import {
  CREDIT_RENEWALS_COLLECTION,
  currentCreditPeriod,
  monthlyCreditsFor,
} from "../credits/planCredits";
import { PLAN_KEYS } from "../admin/quotaDefaults";
import { ensurePlatformCaches } from "../config/env";
import { hasExactBillingEntitlement } from "../billing/entitlement";
import { mapSettledWithConcurrency } from "../utils/asyncPool";
import { boundedRuntimeInteger } from "../utils/runtimeLimits";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/** Server-only entitlement collection — written ONLY by a real payment (Stripe
 *  webhook) or an admin, never by the client. Gates recurring credit grants. */
const BILLING_COLLECTION = "billing";

const CREDIT_RENEWAL_RUNS_COLLECTION = "credit_renewal_runs";
const RECURRING_PLAN_KEYS = PLAN_KEYS.filter(
  (plan) => plan !== "free" && plan !== "single_post" && plan !== "job_pack"
);

export const MONTHLY_CREDIT_PAGE_SIZE = boundedRuntimeInteger(
  process.env.MONTHLY_CREDIT_PAGE_SIZE,
  100,
  10,
  250
);
export const MONTHLY_CREDIT_MAX_USERS_PER_RUN = boundedRuntimeInteger(
  process.env.MONTHLY_CREDIT_MAX_USERS_PER_RUN,
  2_000,
  100,
  5_000
);
export const MONTHLY_CREDIT_CONCURRENCY = boundedRuntimeInteger(
  process.env.MONTHLY_CREDIT_CONCURRENCY,
  10,
  1,
  20
);

interface GrantRunStats {
  scanned: number;
  granted: number;
  skipped: number;
  failed: number;
}

async function grantUserMonthlyCredits(
  userDoc: QueryDocumentSnapshot,
  period: string
): Promise<boolean> {
  const uid = userDoc.id;
  const plan = userDoc.get(USER_FIELDS.subscriptionStatus) as string;
  const monthlyGrant = monthlyCreditsFor(plan);
  if (monthlyGrant <= 0) return false;

  const renewalRef = db.collection(CREDIT_RENEWALS_COLLECTION).doc(uid);
  const billingRef = db.collection(BILLING_COLLECTION).doc(uid);
  return db.runTransaction(async (tx) => {
    const renewalSnap = await tx.get(renewalRef);
    const billingSnap = await tx.get(billingRef);
    if (!hasExactBillingEntitlement(billingSnap.data(), plan, { subscriptionOnly: true })) {
      return false;
    }
    if (renewalSnap.exists && renewalSnap.get("period") === period) {
      return false;
    }
    const now = FieldValue.serverTimestamp();
    tx.set(
      userDoc.ref,
      {
        [USER_FIELDS.credits]: FieldValue.increment(monthlyGrant),
        [USER_FIELDS.updatedAt]: now,
      },
      { merge: true }
    );
    tx.set(
      renewalRef,
      { period, plan, granted_amount: monthlyGrant, granted_at: now },
      { merge: true }
    );
    return true;
  });
}

/** Advances a run cursor only when no overlapping invocation advanced it first. */
async function advanceRunCursor(
  runRef: DocumentReference,
  period: string,
  expectedCursor: string,
  cursor: string,
  complete: boolean,
  runLimitReached: boolean,
  stats: GrantRunStats
): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(runRef);
    if (snap.get("complete") === true) return false;
    const storedCursor = typeof snap.get("cursor_uid") === "string" ? snap.get("cursor_uid") : "";
    if (storedCursor !== expectedCursor) return false;

    const now = FieldValue.serverTimestamp();
    tx.set(
      runRef,
      {
        period,
        cursor_uid: cursor,
        complete,
        run_limit_reached: runLimitReached,
        last_invocation: stats,
        updated_at: now,
        ...(complete ? { completed_at: now } : {}),
      },
      { merge: true }
    );
    return true;
  });
}

export const grantMonthlyCreditsFunction = onSchedule(
  {
    // Daily invocations are bounded catch-up opportunities when a prior run hits
    // the cap or a transient failure. Completed periods exit after one read.
    schedule: "10 0 * * *",
    timeZone: "UTC",
    timeoutSeconds: 540,
    memory: "256MiB",
    retryCount: 3,
    maxRetrySeconds: 21_600,
    minBackoffSeconds: 60,
    maxBackoffSeconds: 3_600,
  },
  async () => {
    await ensurePlatformCaches();
    const period = currentCreditPeriod();
    const runRef = db.collection(CREDIT_RENEWAL_RUNS_COLLECTION).doc(period);
    const runSnap = await runRef.get();
    if (runSnap.get("complete") === true) {
      logger.info(`grantMonthlyCredits ${period}: already complete`);
      return;
    }

    let cursor = typeof runSnap.get("cursor_uid") === "string" ? runSnap.get("cursor_uid") : "";
    const stats: GrantRunStats = { scanned: 0, granted: 0, skipped: 0, failed: 0 };

    while (stats.scanned < MONTHLY_CREDIT_MAX_USERS_PER_RUN) {
      const pageSize = Math.min(
        MONTHLY_CREDIT_PAGE_SIZE,
        MONTHLY_CREDIT_MAX_USERS_PER_RUN - stats.scanned
      );
      let query = db
        .collection(USERS_COLLECTION)
        .where(USER_FIELDS.subscriptionStatus, "in", RECURRING_PLAN_KEYS)
        .orderBy(FieldPath.documentId())
        .limit(pageSize);
      if (cursor) query = query.startAfter(cursor);

      const snap = await query.get();
      if (snap.empty) {
        await advanceRunCursor(runRef, period, cursor, cursor, true, false, stats);
        logger.info(
          `grantMonthlyCredits ${period}: complete; granted ${stats.granted}, skipped ${stats.skipped}, scanned ${stats.scanned}`
        );
        return;
      }

      const expectedCursor = cursor;
      const settled = await mapSettledWithConcurrency(
        snap.docs,
        MONTHLY_CREDIT_CONCURRENCY,
        (userDoc) => grantUserMonthlyCredits(userDoc, period)
      );
      stats.scanned += snap.size;
      settled.forEach((result, index) => {
        if (result.status === "fulfilled") {
          if (result.value) stats.granted++;
          else stats.skipped++;
          return;
        }
        stats.failed++;
        logger.error(
          `grantMonthlyCredits ${period}: page item ${index} failed`,
          result.reason
        );
      });

      if (stats.failed > 0) {
        // Cursor is intentionally not advanced. Successful users are protected by
        // credit_renewals/{uid}; the retry replays this page without double grants.
        throw new Error(`Monthly credit grant failed for ${stats.failed} user(s).`);
      }

      cursor = snap.docs[snap.docs.length - 1].id;
      const complete = snap.size < pageSize;
      const runLimitReached =
        !complete && stats.scanned >= MONTHLY_CREDIT_MAX_USERS_PER_RUN;
      const advanced = await advanceRunCursor(
        runRef,
        period,
        expectedCursor,
        cursor,
        complete,
        runLimitReached,
        stats
      );
      if (!advanced) {
        logger.warn(
          `grantMonthlyCredits ${period}: another invocation advanced the run cursor`
        );
        return;
      }
      if (complete) {
        logger.info(
          `grantMonthlyCredits ${period}: complete; granted ${stats.granted}, skipped ${stats.skipped}, scanned ${stats.scanned}`
        );
        return;
      }
    }

    logger.warn(
      `grantMonthlyCredits ${period}: run cap reached at ${stats.scanned}; next scheduled invocation will resume`
    );
  },
);
