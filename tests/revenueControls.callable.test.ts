/**
 * P0 revenue & abuse controls — callable-logic tests (emulator).
 *
 *  1. setSubscriptionStatus: paid/business plans require a real billing entitlement
 *     an exact active/status/plan/audience/mode billing contract or an explicit
 *     demo grant; an unpaid selection stays
 *     pending and never activates (no employer role, no paid credits).
 *  2. Free AI tools count toward the free-tier daily run cap.
 *
 * Run: firebase emulators:exec --only firestore --project demo-careercopilot \
 *        "npx vitest run tests/revenueControls.callable.test.ts"
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as admin from '../functions/node_modules/firebase-admin';
import { applySubscriptionSelection } from '../functions/src/handlers/setSubscriptionStatus';
import { adminSetSubscriptionImpl } from '../functions/src/handlers/adminPortal';
import { meterToolRun, recordFreeToolRun } from '../functions/src/credits/deductCredits';
import { FREE_TIER_DAILY_RUN_LIMIT, getUserTodayUsage } from '../functions/src/admin/usageLog';
import { refreshPlatformCaches, getActiveJobLimit } from '../functions/src/admin/platformConfig';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-careercopilot';
const db = admin.firestore();

async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await refreshPlatformCaches();
}

async function seedUser(uid: string, data: Record<string, unknown> = {}) {
  await db.collection('users').doc(uid).set({
    role: 'candidate', subscription_status: 'free', credits: 100, created_at: '2026-01-01', ...data,
  });
}

beforeEach(clearFirestore);
afterEach(() => { delete process.env.ALLOW_DEMO_GRANTS; });

describe('setSubscriptionStatus paid-entitlement gate', () => {
  it('blocks candidates from selecting a business plan', async () => {
    await seedUser('cand-business');
    await expect(applySubscriptionSelection('cand-business', 'pending_biz_pro'))
      .rejects.toThrow(/candidate accounts cannot be switched/i);

    const user = (await db.collection('users').doc('cand-business').get()).data()!;
    expect(user.role).toBe('candidate');
    expect(user.subscription_status).toBe('free');
  });

  it('blocks zero-payment activation of a BUSINESS plan → pending, no role/credit change', async () => {
    await seedUser('emp1', { role: 'employer' });
    const res = await applySubscriptionSelection('emp1', 'pending_biz_pro');

    expect(res.status).toBe('pending_payment');
    expect(res.role).toBe('employer');
    expect(res.subscription_status).toBe('free');  // NOT pro
    expect(res.pending_plan).toBe('pro');

    const user = (await db.collection('users').doc('emp1').get()).data()!;
    expect(user.role).toBe('employer');
    expect(user.subscription_status).toBe('free');
    expect(user.credits).toBe(100);                // no paid credits granted

    const billing = (await db.collection('billing').doc('emp1').get()).data()!;
    expect(billing.pending_plan).toBe('pro');
    expect(billing.active).toBe(false);
  });

  it('blocks zero-payment activation of a paid CANDIDATE plan', async () => {
    await seedUser('cand1');
    const res = await applySubscriptionSelection('cand1', 'pending_accelerator');

    expect(res.status).toBe('pending_payment');
    const user = (await db.collection('users').doc('cand1').get()).data()!;
    expect(user.subscription_status).toBe('free');
    expect(user.credits).toBe(100);
  });

  it('activates a business plan WITH a real billing entitlement (grant_source paid)', async () => {
    await seedUser('emp2', { role: 'employer' });
    await db.collection('billing').doc('emp2').set({
      active: true, status: 'active', plan: 'pro', audience: 'business', mode: 'subscription',
    });

    const res = await applySubscriptionSelection('emp2', 'pending_biz_pro');
    expect(res.status).toBe('active');
    expect(res.role).toBe('employer');
    expect(res.subscription_status).toBe('pro');
    expect(res.grant_source).toBe('paid');

    const user = (await db.collection('users').doc('emp2').get()).data()!;
    expect(user.role).toBe('employer');
    expect(user.credits).toBe(100 + 20000); // pro monthly allotment
  });

  it('does not use or deactivate an active lower-tier entitlement for an upgrade', async () => {
    await seedUser('emp-upgrade', {
      role: 'employer', subscription_status: 'starter', credits: 3100,
    });
    await db.collection('billing').doc('emp-upgrade').set({
      active: true, status: 'active', plan: 'starter', audience: 'business', mode: 'subscription',
    });

    const res = await applySubscriptionSelection('emp-upgrade', 'pending_biz_pro');

    expect(res.status).toBe('pending_payment');
    expect(res.subscription_status).toBe('starter');
    expect(res.pending_plan).toBe('pro');
    const user = (await db.collection('users').doc('emp-upgrade').get()).data()!;
    expect(user.subscription_status).toBe('starter');
    expect(user.credits).toBe(3100);
    const billing = (await db.collection('billing').doc('emp-upgrade').get()).data()!;
    expect(billing).toMatchObject({
      active: true,
      status: 'active',
      plan: 'starter',
      audience: 'business',
      mode: 'subscription',
      pending_plan: 'pro',
    });
  });

  it('lets a one-off payment complete its own plan without granting subscription credits', async () => {
    await seedUser('emp-single-post', { role: 'employer' });
    await db.collection('billing').doc('emp-single-post').set({
      active: true, status: 'active', plan: 'single_post', audience: 'business', mode: 'payment',
    });

    const res = await applySubscriptionSelection('emp-single-post', 'pending_biz_single_post');

    expect(res.status).toBe('active');
    expect(res.subscription_status).toBe('single_post');
    expect(res.grant_source).toBe('paid');
    expect(res.credits).toBe(100);
  });

  it('never uses a one-off payment to authorize a recurring subscription', async () => {
    await seedUser('emp-payment-to-pro', { role: 'employer' });
    await db.collection('billing').doc('emp-payment-to-pro').set({
      active: true, status: 'active', plan: 'single_post', audience: 'business', mode: 'payment',
    });

    const res = await applySubscriptionSelection('emp-payment-to-pro', 'pending_biz_pro');

    expect(res.status).toBe('pending_payment');
    expect(res.subscription_status).toBe('free');
    expect(res.credits).toBe(100);
    const billing = (await db.collection('billing').doc('emp-payment-to-pro').get()).data()!;
    expect(billing).toMatchObject({
      active: true,
      status: 'active',
      plan: 'single_post',
      audience: 'business',
      mode: 'payment',
      pending_plan: 'pro',
    });
  });

  it('demo switch activates but tags grant_source demo_preview and never writes billing.active', async () => {
    process.env.ALLOW_DEMO_GRANTS = 'true';
    await seedUser('emp3', { role: 'employer' });

    const res = await applySubscriptionSelection('emp3', 'pending_biz_starter');
    expect(res.status).toBe('active');
    expect(res.role).toBe('employer');
    expect(res.grant_source).toBe('demo_preview');

    const renewal = (await db.collection('credit_renewals').doc('emp3').get()).data()!;
    expect(renewal.grant_source).toBe('demo_preview');

    const billing = await db.collection('billing').doc('emp3').get();
    // A demo grant must never look like a real paid subscription.
    expect(billing.exists && billing.data()!.active === true).toBe(false);
  });

  it('lets a FREE plan with a monthly refill stay self-service', async () => {
    await seedUser('cand2', { subscription_status: 'accelerator' });
    const res = await applySubscriptionSelection('cand2', 'free');
    expect(res.status).toBe('active');
    expect(res.subscription_status).toBe('free');
    expect(res.role).toBe('candidate');
    expect(res.grant_source).toBe('self_service');

    const user = (await db.collection('users').doc('cand2').get()).data()!;
    expect(user.subscription_status).toBe('free');
    expect(user.credits).toBe(100 + 30);

    const billing = await db.collection('billing').doc('cand2').get();
    expect(billing.exists).toBe(false);
  });

  it('blocks an existing candidate from the free business entry', async () => {
    await seedUser('cand-free-biz');

    await expect(applySubscriptionSelection('cand-free-biz', 'pending_biz_free'))
      .rejects.toThrow(/candidate accounts cannot be switched/i);

    const user = (await db.collection('users').doc('cand-free-biz').get()).data()!;
    expect(user.role).toBe('candidate');
    expect(user.subscription_status).toBe('free');
  });

  it('blocks an existing candidate from business signup even when companyName is sent', async () => {
    await seedUser('cand-business-signup');

    await expect(applySubscriptionSelection('cand-business-signup', 'pending_biz_starter', {
      fullName: 'Candidate User',
      companyName: 'Acme',
    })).rejects.toThrow(/candidate accounts cannot be switched/i);

    const user = (await db.collection('users').doc('cand-business-signup').get()).data()!;
    expect(user.role).toBe('candidate');
    expect(user.subscription_status).toBe('free');
    expect(user.company_name).toBeUndefined();
  });

  it('can initialize a new business signup as an employer account', async () => {
    const res = await applySubscriptionSelection('new-business', 'pending_biz_starter', {
      fullName: 'Biz Owner',
      companyName: 'Acme',
    }, {
      authCreationTime: new Date().toUTCString(),
    });

    expect(res.status).toBe('pending_payment');
    expect(res.role).toBe('employer');
    expect(res.subscription_status).toBe('free');

    const user = (await db.collection('users').doc('new-business').get()).data()!;
    expect(user.role).toBe('employer');
    expect(user.company_name).toBe('Acme');
    expect(user.subscription_status).toBe('free');
    expect(user.organization_verified).toBe(false);
    expect(user.role_provenance).toBe('business_signup_callable');
    expect(user.role_provisioned_at).toBeTruthy();
  });

  it('promotes a fresh trigger-created candidate during business signup', async () => {
    await seedUser('trigger-first-business', {
      created_at: admin.firestore.Timestamp.now(),
    });

    const res = await applySubscriptionSelection('trigger-first-business', 'pending_biz_starter', {
      fullName: 'Biz Owner',
      companyName: 'Acme',
    }, {
      authCreationTime: new Date().toUTCString(),
    });

    expect(res.status).toBe('pending_payment');
    expect(res.role).toBe('employer');
    const user = (await db.collection('users').doc('trigger-first-business').get()).data()!;
    expect(user.role).toBe('employer');
    expect(user.company_name).toBe('Acme');
    expect(user.organization_verified).toBe(false);
    expect(user.role_provenance).toBe('business_signup_callable');
  });

  it.each([
    ['future', 60_000],
    ['old', -3 * 60_000],
  ] as const)('does not promote a candidate with a %s profile timestamp', async (_label, offsetMs) => {
    await seedUser(`candidate-${_label}-profile`, {
      created_at: admin.firestore.Timestamp.fromMillis(Date.now() + offsetMs),
    });

    await expect(applySubscriptionSelection(`candidate-${_label}-profile`, 'pending_biz_starter', {
      fullName: 'Candidate User',
      companyName: 'Acme',
    }, {
      authCreationTime: new Date().toUTCString(),
    })).rejects.toThrow(/candidate accounts cannot be switched/i);
  });

  it.each([
    ['future', 60_000],
    ['old', -3 * 60_000],
  ] as const)('does not promote a candidate with a %s Auth creation time', async (_label, offsetMs) => {
    await seedUser(`candidate-${_label}-auth`, {
      created_at: admin.firestore.Timestamp.now(),
    });

    await expect(applySubscriptionSelection(`candidate-${_label}-auth`, 'pending_biz_starter', {
      fullName: 'Candidate User',
      companyName: 'Acme',
    }, {
      authCreationTime: new Date(Date.now() + offsetMs).toUTCString(),
    })).rejects.toThrow(/candidate accounts cannot be switched/i);
  });

  it('blocks employer accounts from selecting candidate paid plans', async () => {
    await seedUser('emp-candidate-plan', { role: 'employer' });
    await expect(applySubscriptionSelection('emp-candidate-plan', 'pending_accelerator'))
      .rejects.toThrow(/employer accounts cannot be switched/i);
  });

  it('grants the monthly allotment at most once per month even when entitled (high-water mark)', async () => {
    await seedUser('emp4', { role: 'employer' });
    await db.collection('billing').doc('emp4').set({
      active: true, status: 'active', plan: 'starter', audience: 'business', mode: 'subscription',
    });

    await applySubscriptionSelection('emp4', 'pending_biz_starter'); // 3000
    const after1 = (await db.collection('users').doc('emp4').get()).data()!;
    expect(after1.credits).toBe(100 + 3000);

    await applySubscriptionSelection('emp4', 'pending_biz_starter'); // same month → no double grant
    const after2 = (await db.collection('users').doc('emp4').get()).data()!;
    expect(after2.credits).toBe(100 + 3000);
  });
});

describe('adminSetSubscription role-compatible overrides', () => {
  it('allows candidates to receive candidate tiers', async () => {
    await seedUser('admin-cand');
    await adminSetSubscriptionImpl('admin-uid', 'admin-cand', 'accelerator');

    const user = (await db.collection('users').doc('admin-cand').get()).data()!;
    expect(user.role).toBe('candidate');
    expect(user.subscription_status).toBe('accelerator');
  });

  it('rejects employer tiers for candidate accounts', async () => {
    await seedUser('admin-cand-business');
    await expect(adminSetSubscriptionImpl('admin-uid', 'admin-cand-business', 'starter'))
      .rejects.toThrow(/not available for candidate/i);

    const user = (await db.collection('users').doc('admin-cand-business').get()).data()!;
    expect(user.role).toBe('candidate');
    expect(user.subscription_status).toBe('free');
  });

  it('allows employer accounts to receive employer tiers and free', async () => {
    await seedUser('admin-emp', { role: 'employer' });
    await adminSetSubscriptionImpl('admin-uid', 'admin-emp', 'starter');
    await adminSetSubscriptionImpl('admin-uid', 'admin-emp', 'free');

    const user = (await db.collection('users').doc('admin-emp').get()).data()!;
    expect(user.role).toBe('employer');
    expect(user.subscription_status).toBe('free');
  });

  it('rejects candidate paid tiers for employer accounts', async () => {
    await seedUser('admin-emp-candidate', { role: 'employer' });
    await expect(adminSetSubscriptionImpl('admin-uid', 'admin-emp-candidate', 'executive'))
      .rejects.toThrow(/not available for employer/i);

    const user = (await db.collection('users').doc('admin-emp-candidate').get()).data()!;
    expect(user.role).toBe('employer');
    expect(user.subscription_status).toBe('free');
  });
});

describe('free AI tools count toward the free-tier daily run cap', () => {
  it('records a free run with credit_cost 0 / status free and increments the run counter', async () => {
    await seedUser('free1');
    const r = await recordFreeToolRun('free1', 'calculateCompatibility', { requestId: 'req_free_0001' });

    expect(r.counted).toBe(true);
    const events = await db.collection('usage_events').where('uid', '==', 'free1').get();
    expect(events.size).toBe(1);
    expect(events.docs[0].data()).toMatchObject({ tool: 'calculateCompatibility', credit_cost: 0, status: 'free' });
    await expect(getUserTodayUsage('free1')).resolves.toEqual({ runs: 1, credits: 0 });
  });

  it('is idempotent on requestId (no double count)', async () => {
    await seedUser('free2');
    await recordFreeToolRun('free2', 'free-tool', { requestId: 'req_free_dupe' });
    const dup = await recordFreeToolRun('free2', 'free-tool', { requestId: 'req_free_dupe' });

    expect(dup.duplicate).toBe(true);
    await expect(getUserTodayUsage('free2')).resolves.toEqual({ runs: 1, credits: 0 });
  });

  it('blocks a free-tier user after FREE_TIER_DAILY_RUN_LIMIT free runs', async () => {
    await seedUser('free3');
    for (let i = 0; i < FREE_TIER_DAILY_RUN_LIMIT; i++) {
      await recordFreeToolRun('free3', 'free-tool', { requestId: `req_cap_${i}` });
    }
    await expect(
      recordFreeToolRun('free3', 'free-tool', { requestId: 'req_cap_over' }),
    ).rejects.toThrow(/daily limit/i);
  });

  it('does NOT cap a paid user running free tools', async () => {
    await seedUser('paid1', { subscription_status: 'accelerator' });
    const total = FREE_TIER_DAILY_RUN_LIMIT + 2;
    for (let i = 0; i < total; i++) {
      await recordFreeToolRun('paid1', 'free-tool', { requestId: `req_paid_${i}` });
    }
    const usage = await getUserTodayUsage('paid1');
    expect(usage.runs).toBe(total);
  });
});

describe('admin-managed quota overrides', () => {
  async function setQuotas(data: Record<string, unknown>) {
    await db.collection('platform_config').doc('quotas').set(data, { merge: true });
    await refreshPlatformCaches();
  }

  it('uses plan_quotas.free.daily_run_limit instead of the default free cap', async () => {
    await seedUser('free_custom');
    await setQuotas({
      plan_quotas: {
        free: { daily_run_limit: 3, daily_credit_limit: 0, monthly_credit_grant: 0, active_job_limit: 3 },
      },
    });

    for (let i = 0; i < 3; i++) {
      await recordFreeToolRun('free_custom', 'free-tool', { requestId: `req_custom_${i}` });
    }
    await expect(
      recordFreeToolRun('free_custom', 'free-tool', { requestId: 'req_custom_over' }),
    ).rejects.toThrow(/daily limit of 3/i);
  });

  it('can apply daily run caps to a paid plan', async () => {
    await seedUser('paid_custom', { subscription_status: 'accelerator' });
    await setQuotas({
      plan_quotas: {
        accelerator: { daily_run_limit: 2, daily_credit_limit: 0, monthly_credit_grant: 750, active_job_limit: 0 },
      },
    });

    await recordFreeToolRun('paid_custom', 'free-tool', { requestId: 'req_paid_custom_1' });
    await recordFreeToolRun('paid_custom', 'free-tool', { requestId: 'req_paid_custom_2' });
    await expect(
      recordFreeToolRun('paid_custom', 'free-tool', { requestId: 'req_paid_custom_3' }),
    ).rejects.toThrow(/daily limit of 2/i);
  });

  it('uses dynamic tool credit_cost for deductions and usage events', async () => {
    await seedUser('cost_custom');
    await setQuotas({
      tool_quotas: {
        'email-crafter': { enabled: true, credit_cost: 7, allowed_plans: ['free', 'essentials', 'accelerator', 'executive', 'starter', 'growth', 'pro', 'single_post', 'job_pack'] },
      },
    });

    const result = await meterToolRun('cost_custom', 'email-crafter', 5, { requestId: 'req_cost_custom' });
    expect(result.creditCost).toBe(7);

    const user = (await db.collection('users').doc('cost_custom').get()).data()!;
    expect(user.credits).toBe(93);
    const events = await db.collection('usage_events').where('uid', '==', 'cost_custom').get();
    expect(events.docs[0].data()).toMatchObject({ tool: 'email-crafter', credit_cost: 7, status: 'deducted' });
  });

  it('blocks disabled tools and tools not allowed for the current plan', async () => {
    await seedUser('blocked_tool');
    await setQuotas({
      tool_quotas: {
        'email-crafter': { enabled: false, credit_cost: 5, allowed_plans: ['free'] },
        'cover-letter': { enabled: true, credit_cost: 20, allowed_plans: ['executive'] },
      },
    });

    await expect(meterToolRun('blocked_tool', 'email-crafter', 5)).rejects.toThrow(/temporarily unavailable/i);
    await expect(meterToolRun('blocked_tool', 'cover-letter', 20)).rejects.toThrow(/does not include/i);
  });

  it('uses dynamic monthly_credit_grant for future subscription activation only', async () => {
    await seedUser('grant_custom');
    await db.collection('billing').doc('grant_custom').set({
      active: true, status: 'active', plan: 'accelerator', audience: 'candidate', mode: 'subscription',
    });
    await setQuotas({
      plan_quotas: {
        accelerator: { daily_run_limit: 0, daily_credit_limit: 0, monthly_credit_grant: 1234, active_job_limit: 0 },
      },
    });

    const res = await applySubscriptionSelection('grant_custom', 'pending_accelerator');
    expect(res.status).toBe('active');
    expect(res.credits).toBe(100 + 1234);
  });

  it('uses dynamic active_job_limit defaults and overrides', async () => {
    await setQuotas({});
    expect(getActiveJobLimit('starter')).toBe(8);

    await setQuotas({
      plan_quotas: {
        starter: { daily_run_limit: 0, daily_credit_limit: 0, monthly_credit_grant: 3000, active_job_limit: 4 },
      },
    });
    expect(getActiveJobLimit('starter')).toBe(4);
  });
});
