/**
 * Usage-counter + idempotent deduction tests.
 *
 * Run: firebase emulators:exec --only firestore --project demo-careercopilot \
 *        "npx vitest run tests/usageCounters.callable.test.ts"
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as admin from '../functions/node_modules/firebase-admin';
import { deductCredits, recordFreeToolRun, refundCredits } from '../functions/src/credits/deductCredits';
import {
  getTodayUsageTotals,
  getUserTodayUsage,
  PLATFORM_DAILY_ATTEMPT_SAFETY_LIMIT,
  recordObservedToolRun,
  USER_DAILY_ATTEMPT_SAFETY_LIMIT,
  utcDayKey,
} from '../functions/src/admin/usageLog';
import { refreshPlatformCaches } from '../functions/src/admin/platformConfig';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-careercopilot';
const db = admin.firestore();

async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
}

async function seedUser(uid = 'user1', credits = 100) {
  await db.collection('users').doc(uid).set({
    role: 'candidate',
    subscription_status: 'free',
    credits,
    created_at: '2026-01-01',
  });
}

async function counterDocs() {
  const snap = await db.collection('usage_counters').get();
  return snap.docs.map((doc) => doc.data());
}

function usageCounterRefs(uid: string, dayKey = utcDayKey()) {
  return {
    global: db.collection('usage_counters').doc(`global_${dayKey}`),
    user: db.collection('usage_counters').doc(`user_${Buffer.from(uid).toString('base64url')}_${dayKey}`),
  };
}

beforeEach(async () => {
  await clearFirestore();
  await refreshPlatformCaches();
});

describe('usage counters and idempotent credit deduction', () => {
  it('deducts once, writes O(1) daily counters, and records ledger in the same transaction', async () => {
    await seedUser('user1', 100);

    const result = await deductCredits('user1', 7, 'resume-analysis', { requestId: 'req_counter_001' });

    expect(result.charged).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.balanceAfter).toBe(93);

    const user = (await db.collection('users').doc('user1').get()).data()!;
    expect(user.credits).toBe(93);

    const usageEvents = await db.collection('usage_events').where('uid', '==', 'user1').get();
    expect(usageEvents.size).toBe(1);
    expect(usageEvents.docs[0].data()).toMatchObject({
      uid: 'user1',
      tool: 'resume-analysis',
      credit_cost: 7,
      status: 'deducted',
      day_key: utcDayKey(),
      request_id: 'req_counter_001',
      balance_after: 93,
    });

    const counters = await counterDocs();
    expect(counters).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'global', day_key: utcDayKey(), runs: 1, credits: 7 }),
      expect.objectContaining({ scope: 'user', uid: 'user1', day_key: utcDayKey(), runs: 1, credits: 7 }),
    ]));

    const ledger = await db.collection('credit_ledger').where('uid', '==', 'user1').get();
    expect(ledger.size).toBe(1);
    expect(ledger.docs[0].data()).toMatchObject({
      amount: -7,
      balance_after: 93,
      reason: 'tool_deduction',
      tool: 'resume-analysis',
      request_id: 'req_counter_001',
    });

    await expect(getTodayUsageTotals()).resolves.toEqual({ runs: 1, credits: 7 });
    await expect(getUserTodayUsage('user1')).resolves.toEqual({ runs: 1, credits: 7 });
  });

  it('reuses requestId as an idempotency key and never double-charges', async () => {
    await seedUser('user1', 100);

    const first = await deductCredits('user1', 7, 'resume-analysis', { requestId: 'req_counter_002' });
    const second = await deductCredits('user1', 7, 'resume-analysis', { requestId: 'req_counter_002' });

    expect(first.charged).toBe(true);
    expect(second.charged).toBe(false);
    expect(second.duplicate).toBe(true);

    const user = (await db.collection('users').doc('user1').get()).data()!;
    expect(user.credits).toBe(93);

    const usageEvents = await db.collection('usage_events').where('uid', '==', 'user1').get();
    expect(usageEvents.size).toBe(1);
    const ledger = await db.collection('credit_ledger').where('uid', '==', 'user1').get();
    expect(ledger.size).toBe(1);
    await expect(getTodayUsageTotals()).resolves.toEqual({ runs: 1, credits: 7 });
    await expect(getUserTodayUsage('user1')).resolves.toEqual({ runs: 1, credits: 7 });
  });

  it('binds a refund to its original charge and refunds it at most once', async () => {
    await seedUser('refund-once', 100);
    const charge = await deductCredits('refund-once', 7, 'resume-analysis', {
      requestId: 'req_refund_once',
    });

    const first = await refundCredits('refund-once', charge);
    const replay = await refundCredits('refund-once', charge);

    expect(first).toMatchObject({ refunded: true, duplicate: false, amount: 7, balanceAfter: 100 });
    expect(replay).toMatchObject({ refunded: false, duplicate: true, amount: 7, balanceAfter: 100 });
    expect((await db.collection('users').doc('refund-once').get()).get('credits')).toBe(100);
    const usageEvents = await db.collection('usage_events').where('uid', '==', 'refund-once').get();
    expect(usageEvents.docs.filter((doc) => doc.get('status') === 'refunded')).toHaveLength(1);
    expect(usageEvents.docs.find((doc) => doc.id === charge.usageEventId)?.data()).toMatchObject({
      refund_status: 'refunded',
      refund_usage_counter_status: 'credits_reversed',
    });
    const ledger = await db.collection('credit_ledger').where('uid', '==', 'refund-once').get();
    expect(ledger.docs.filter((doc) => doc.get('reason') === 'tool_refund')).toHaveLength(1);
    await expect(getTodayUsageTotals()).resolves.toEqual({ runs: 1, credits: 0 });
    await expect(getUserTodayUsage('refund-once')).resolves.toEqual({ runs: 1, credits: 0 });
  });

  it('keeps one abuse-control attempt and reverses credits once under concurrent refunds', async () => {
    await seedUser('refund-concurrent', 100);
    const charge = await deductCredits('refund-concurrent', 7, 'resume-analysis', {
      requestId: 'req_refund_concurrent',
    });

    const results = await Promise.all([
      refundCredits('refund-concurrent', charge),
      refundCredits('refund-concurrent', charge),
    ]);

    expect(results.filter((result) => result.refunded)).toHaveLength(1);
    expect(results.filter((result) => result.duplicate)).toHaveLength(1);
    expect((await db.collection('users').doc('refund-concurrent').get()).get('credits')).toBe(100);
    await expect(getTodayUsageTotals()).resolves.toEqual({ runs: 1, credits: 0 });
    await expect(getUserTodayUsage('refund-concurrent')).resolves.toEqual({ runs: 1, credits: 0 });
  });

  it('reverses the original UTC-day credit counters when a refund settles later', async () => {
    const uid = 'refund-cross-day';
    const oldDay = '2026-01-02';
    await seedUser(uid, 100);
    const charge = await deductCredits(uid, 7, 'resume-analysis', {
      requestId: 'req_refund_cross_day',
    });
    const currentRefs = usageCounterRefs(uid);
    await Promise.all([currentRefs.global.delete(), currentRefs.user.delete()]);

    await db.collection('usage_events').doc(charge.usageEventId!).update({
      day_key: admin.firestore.FieldValue.delete(),
      created_at: admin.firestore.Timestamp.fromDate(new Date(`${oldDay}T12:00:00.000Z`)),
    });
    const oldRefs = usageCounterRefs(uid, oldDay);
    await oldRefs.global.set({ day_key: oldDay, scope: 'global', runs: 4, credits: 20 });
    await oldRefs.user.set({ day_key: oldDay, scope: 'user', uid, runs: 4, credits: 20 });

    await expect(refundCredits(uid, charge)).resolves.toMatchObject({ refunded: true, amount: 7 });
    expect((await oldRefs.global.get()).data()).toMatchObject({ runs: 4, credits: 13 });
    expect((await oldRefs.user.get()).data()).toMatchObject({ runs: 4, credits: 13 });
  });

  it('uses refund markers in the legacy fallback when counter documents are missing', async () => {
    const uid = 'refund-fallback';
    await seedUser(uid, 100);
    const charge = await deductCredits(uid, 7, 'resume-analysis', {
      requestId: 'req_refund_fallback',
    });
    const refs = usageCounterRefs(uid);
    await Promise.all([refs.global.delete(), refs.user.delete()]);

    await refundCredits(uid, charge);

    expect((await refs.global.get()).exists).toBe(false);
    expect((await refs.user.get()).exists).toBe(false);
    expect((await db.collection('usage_events').doc(charge.usageEventId!).get()).get('refund_usage_counter_status'))
      .toBe('event_fallback');
    await expect(getTodayUsageTotals()).resolves.toEqual({ runs: 1, credits: 0 });
    await expect(getUserTodayUsage(uid)).resolves.toEqual({ runs: 1, credits: 0 });
  });

  it('preserves restrictive counters and marks reconciliation when a refund would underflow', async () => {
    const uid = 'refund-counter-underflow';
    await seedUser(uid, 100);
    const charge = await deductCredits(uid, 7, 'resume-analysis', {
      requestId: 'req_refund_counter_underflow',
    });
    const refs = usageCounterRefs(uid);
    await Promise.all([
      refs.global.update({ credits: 3 }),
      refs.user.update({ credits: 3 }),
    ]);

    await expect(refundCredits(uid, charge)).resolves.toMatchObject({
      refunded: true,
      amount: 7,
      balanceAfter: 100,
    });
    expect((await refs.global.get()).get('credits')).toBe(3);
    expect((await refs.user.get()).get('credits')).toBe(3);
    expect((await db.collection('usage_events').doc(charge.usageEventId!).get()).get('refund_usage_counter_status'))
      .toBe('counter_underflow');
  });

  it('does not let a duplicate invocation refund the original invocation charge', async () => {
    await seedUser('refund-duplicate', 100);
    const original = await deductCredits('refund-duplicate', 7, 'resume-analysis', {
      requestId: 'req_refund_duplicate',
    });
    const duplicate = await deductCredits('refund-duplicate', 7, 'resume-analysis', {
      requestId: 'req_refund_duplicate',
    });

    const ignored = await refundCredits('refund-duplicate', duplicate);

    expect(ignored).toEqual({ refunded: false, duplicate: false, amount: 0 });
    expect((await db.collection('users').doc('refund-duplicate').get()).get('credits')).toBe(93);
    await refundCredits('refund-duplicate', original);
    expect((await db.collection('users').doc('refund-duplicate').get()).get('credits')).toBe(100);
  });

  it('falls back to legacy usage_events when a counter doc does not exist yet', async () => {
    const now = admin.firestore.Timestamp.now();
    await db.collection('usage_events').add({
      uid: 'legacy-user',
      tool: 'resume-analysis',
      credit_cost: 5,
      status: 'deducted',
      created_at: now,
    });
    await db.collection('usage_events').add({
      uid: 'legacy-user',
      tool: 'career-path',
      credit_cost: 11,
      status: 'deducted',
      created_at: now,
    });

    await expect(getTodayUsageTotals()).resolves.toEqual({ runs: 2, credits: 16 });
    await expect(getUserTodayUsage('legacy-user')).resolves.toEqual({ runs: 2, credits: 16 });
  });

  it('counts legacy free claims as metered attempts when counter documents are missing', async () => {
    const now = admin.firestore.Timestamp.now();
    await db.collection('usage_events').add({
      uid: 'legacy-free-user',
      tool: 'career-coach',
      credit_cost: 0,
      status: 'free',
      created_at: now,
    });

    await expect(getTodayUsageTotals()).resolves.toEqual({ runs: 1, credits: 0 });
    await expect(getUserTodayUsage('legacy-free-user')).resolves.toEqual({ runs: 1, credits: 0 });
  });

  it('atomically enforces the platform run cap under concurrent requests', async () => {
    await seedUser('global-cap-a');
    await seedUser('global-cap-b');
    await db.collection('platform_config').doc('quotas').set({
      enabled: true,
      daily_tool_run_limit: 1,
    });
    await refreshPlatformCaches();

    const outcomes = await Promise.allSettled([
      recordFreeToolRun('global-cap-a', 'free-tool', { requestId: 'req_global_cap_a' }),
      recordFreeToolRun('global-cap-b', 'free-tool', { requestId: 'req_global_cap_b' }),
    ]);

    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    await expect(getTodayUsageTotals()).resolves.toEqual({ runs: 1, credits: 0 });
  });

  it('atomically enforces a per-plan run cap for concurrent requests from one user', async () => {
    await seedUser('user-cap');
    await db.collection('platform_config').doc('quotas').set({
      enabled: true,
      plan_quotas: {
        free: {
          daily_run_limit: 1,
          daily_credit_limit: 0,
          monthly_credit_grant: 30,
          active_job_limit: 3,
        },
      },
    });
    await refreshPlatformCaches();

    const outcomes = await Promise.allSettled([
      recordFreeToolRun('user-cap', 'free-tool', { requestId: 'req_user_cap_one' }),
      recordFreeToolRun('user-cap', 'free-tool', { requestId: 'req_user_cap_two' }),
    ]);

    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    await expect(getUserTodayUsage('user-cap')).resolves.toEqual({ runs: 1, credits: 0 });
  });

  it('keeps hard platform and per-user attempt ceilings when configurable quotas are unlimited', async () => {
    const uid = 'hard-attempt-cap';
    await seedUser(uid);
    await db.collection('platform_config').doc('quotas').set({
      enabled: false,
      daily_tool_run_limit: 0,
      plan_quotas: {
        free: {
          daily_run_limit: 0,
          daily_credit_limit: 0,
          monthly_credit_grant: 30,
          active_job_limit: 3,
        },
      },
    });
    const refs = usageCounterRefs(uid);
    await Promise.all([
      refs.global.set({
        day_key: utcDayKey(),
        scope: 'global',
        runs: USER_DAILY_ATTEMPT_SAFETY_LIMIT,
        credits: 0,
      }),
      refs.user.set({
        day_key: utcDayKey(),
        scope: 'user',
        uid,
        runs: USER_DAILY_ATTEMPT_SAFETY_LIMIT,
        credits: 0,
      }),
    ]);
    await refreshPlatformCaches();

    await expect(
      recordFreeToolRun(uid, 'free-tool', { requestId: 'req_hard_user_cap' }),
    ).rejects.toMatchObject({ code: 'resource-exhausted' });

    await Promise.all([
      refs.global.update({ runs: PLATFORM_DAILY_ATTEMPT_SAFETY_LIMIT }),
      refs.user.update({ runs: 0 }),
    ]);
    await expect(
      recordFreeToolRun(uid, 'free-tool', { requestId: 'req_hard_platform_cap' }),
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
  });

  it('keeps a refunded request counted against the per-plan attempt cap', async () => {
    const uid = 'refund-run-cap';
    await seedUser(uid, 100);
    await db.collection('platform_config').doc('quotas').set({
      enabled: true,
      plan_quotas: {
        free: {
          daily_run_limit: 1,
          daily_credit_limit: 0,
          monthly_credit_grant: 30,
          active_job_limit: 3,
        },
      },
    });
    await refreshPlatformCaches();

    const charge = await deductCredits(uid, 7, 'resume-analysis', { requestId: 'req_refund_run_cap' });
    await refundCredits(uid, charge);

    await expect(
      deductCredits(uid, 7, 'resume-analysis', { requestId: 'req_refund_run_cap_retry' }),
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
    await expect(getUserTodayUsage(uid)).resolves.toEqual({ runs: 1, credits: 0 });
  });

  it('releases the per-plan net-credit cap after a settled refund', async () => {
    const uid = 'refund-credit-cap';
    await seedUser(uid, 100);
    await db.collection('platform_config').doc('quotas').set({
      enabled: true,
      plan_quotas: {
        free: {
          daily_run_limit: 0,
          daily_credit_limit: 7,
          monthly_credit_grant: 30,
          active_job_limit: 3,
        },
      },
    });
    await refreshPlatformCaches();

    const first = await deductCredits(uid, 7, 'resume-analysis', { requestId: 'req_refund_credit_cap_one' });
    await refundCredits(uid, first);
    await expect(
      deductCredits(uid, 7, 'resume-analysis', { requestId: 'req_refund_credit_cap_two' }),
    ).resolves.toMatchObject({ charged: true, balanceAfter: 93 });
    await expect(getUserTodayUsage(uid)).resolves.toEqual({ runs: 2, credits: 7 });
  });
});

describe('observed (uncharged) tool runs — admin visibility only, zero cap impact', () => {
  it('writes "observed" usage events but never charges, bumps counters, or counts toward the cap', async () => {
    await seedUser('obs-user', 50);

    await recordObservedToolRun('obs-user', 'career-coach');
    await recordObservedToolRun('obs-user', 'discover-talent');

    // The observed events exist (this is the admin volume signal).
    const events = await db.collection('usage_events').where('uid', '==', 'obs-user').get();
    expect(events.size).toBe(2);
    expect(events.docs.every((d) => d.data().status === 'observed')).toBe(true);
    expect(events.docs.every((d) => d.data().credit_cost === 0)).toBe(true);

    // No usage_counters written → the free-tier run cap input is untouched.
    expect((await counterDocs()).length).toBe(0);

    // Balance unchanged and the cap-read view sees ZERO runs, so these calls can never
    // push a free user toward resource-exhausted on other tools.
    const user = (await db.collection('users').doc('obs-user').get()).data()!;
    expect(user.credits).toBe(50);
    await expect(getUserTodayUsage('obs-user')).resolves.toEqual({ runs: 0, credits: 0 });
  });

  it('is invisible to the charged run counter when mixed with a real deduction', async () => {
    await seedUser('mix-user', 100);
    await recordObservedToolRun('mix-user', 'career-coach');
    await deductCredits('mix-user', 7, 'resume-analysis', { requestId: 'req_mix_001' });
    await recordObservedToolRun('mix-user', 'list-job-applicants');

    // Only the charged run counts; the 2 observed calls do not inflate runs/credits.
    await expect(getUserTodayUsage('mix-user')).resolves.toEqual({ runs: 1, credits: 7 });
    const events = await db.collection('usage_events').where('uid', '==', 'mix-user').get();
    expect(events.size).toBe(3); // 2 observed + 1 deducted
  });
});
