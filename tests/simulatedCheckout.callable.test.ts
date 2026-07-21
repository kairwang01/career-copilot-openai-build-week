/**
 * Simulated-checkout callable tests — real Firestore emulator + Admin SDK.
 * Proves: the simulated confirm is gated by BILLING_SIMULATION, and when enabled it
 * runs the SAME entitlement path as a real Stripe webhook — writing billing.active
 * and activating the plan/role/credits — so a demo payment is indistinguishable from
 * a real one downstream.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as admin from '../functions/node_modules/firebase-admin';
import { confirmSimulatedCheckoutImpl } from '../functions/src/handlers/stripeBilling';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-careercopilot';
const db = admin.firestore();

async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
}

async function seedUser(uid: string) {
  await db.collection('users').doc(uid).set({
    role: 'candidate', subscription_status: 'free', credits: 100, created_at: '2026-01-01',
  });
}

async function seedEmployer(uid: string) {
  await db.collection('users').doc(uid).set({
    role: 'employer', subscription_status: 'free', credits: 100, created_at: '2026-01-01',
  });
}

beforeEach(clearFirestore);
afterEach(() => { delete process.env.BILLING_SIMULATION; });

describe('confirmSimulatedCheckout', () => {
  it('is gated — throws when BILLING_SIMULATION is not enabled', async () => {
    delete process.env.BILLING_SIMULATION;
    await seedUser('emp1');
    await expect(confirmSimulatedCheckoutImpl('emp1', { planKey: 'starter' }))
      .rejects.toThrow(/simulation is not enabled/i);
  });

  it('activates a business plan via the real entitlement path when enabled', async () => {
    process.env.BILLING_SIMULATION = 'true';
    await seedEmployer('emp2');

    const res = await confirmSimulatedCheckoutImpl('emp2', { planKey: 'pending_biz_starter' });
    expect(res.status).toBe('active');
    expect(res.role).toBe('employer');
    expect(res.subscription_status).toBe('starter');

    // billing entitlement written exactly like the Stripe webhook does
    const billing = (await db.collection('billing').doc('emp2').get()).data()!;
    expect(billing.active).toBe(true);
    expect(billing.provider).toBe('stripe');
    expect(billing.plan).toBe('starter');

    // plan/role/credits activated on the user doc
    const user = (await db.collection('users').doc('emp2').get()).data()!;
    expect(user.role).toBe('employer');
    expect(user.subscription_status).toBe('starter');
    expect(user.credits).toBe(100 + 3000); // starter monthly grant
  });

  it('does not activate a business plan for a candidate account', async () => {
    process.env.BILLING_SIMULATION = 'true';
    await seedUser('cand-business');
    await expect(confirmSimulatedCheckoutImpl('cand-business', { planKey: 'pending_biz_starter' }))
      .rejects.toThrow(/candidate accounts cannot buy employer plans/i);
  });

  it('activates a paid candidate plan when enabled', async () => {
    process.env.BILLING_SIMULATION = 'true';
    await seedUser('cand1');
    const res = await confirmSimulatedCheckoutImpl('cand1', { planKey: 'accelerator' });
    expect(res.status).toBe('active');
    expect(res.subscription_status).toBe('accelerator');
    const billing = (await db.collection('billing').doc('cand1').get()).data()!;
    expect(billing.active).toBe(true);
  });

  it('rejects an unsupported plan', async () => {
    process.env.BILLING_SIMULATION = 'true';
    await seedUser('emp3');
    await expect(confirmSimulatedCheckoutImpl('emp3', { planKey: 'not_a_plan' }))
      .rejects.toThrow(/unsupported paid plan/i);
  });

  it('grants a one-off credit pack without changing plan or role', async () => {
    process.env.BILLING_SIMULATION = 'true';
    await seedUser('cand2'); // 100 credits, free candidate

    const res = await confirmSimulatedCheckoutImpl('cand2', { planKey: 'pack_500', sessionId: 'sess_A' });
    expect(res.status).toBe('active');
    expect(res.subscription_status).toBe('free'); // plan unchanged
    expect(res.role).toBe('candidate'); // role unchanged
    expect(res.credits).toBe(100 + 600); // pack_500 = 600 credits

    const user = (await db.collection('users').doc('cand2').get()).data()!;
    expect(user.credits).toBe(700);
    expect(user.subscription_status).toBe('free');
    // no subscription entitlement is written for a pack
    expect((await db.collection('billing').doc('cand2').get()).exists).toBe(false);
  });

  it('is idempotent per checkout session — a repeat confirm does not double-grant', async () => {
    process.env.BILLING_SIMULATION = 'true';
    await seedUser('cand3');

    const first = await confirmSimulatedCheckoutImpl('cand3', { planKey: 'pack_500', sessionId: 'sess_B' });
    expect(first.credits).toBe(700);
    const repeat = await confirmSimulatedCheckoutImpl('cand3', { planKey: 'pack_500', sessionId: 'sess_B' });
    expect(repeat.credits).toBe(700); // same session → no extra grant
    expect((repeat as { credits_added?: number }).credits_added).toBe(0);

    // a NEW checkout session grants again
    const second = await confirmSimulatedCheckoutImpl('cand3', { planKey: 'pack_500', sessionId: 'sess_C' });
    expect(second.credits).toBe(1300);
    expect((await db.collection('users').doc('cand3').get()).data()!.credits).toBe(1300);
  });
});
