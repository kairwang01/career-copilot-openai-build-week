/**
 * Simulated-cancel callable tests — real Firestore emulator + Admin SDK.
 * Proves: simulated cancel is gated by BILLING_SIMULATION, and when enabled it
 * runs the SAME downgrade path as the real Stripe subscription.deleted webhook —
 * clearing billing.active and resetting plan/role to free WITHOUT touching credits.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as admin from '../functions/node_modules/firebase-admin';
import {
  billingPortalReturnPathForAudience,
  cancelSubscriptionSimulatedImpl,
  confirmSimulatedCheckoutImpl,
  createBillingPortalSessionImpl,
} from '../functions/src/handlers/stripeBilling';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-careercopilot';
const db = admin.firestore();

async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
}

async function seedActiveSubscriber(uid: string) {
  // Activate a paid candidate plan first via the existing simulated checkout path,
  // so billing.active=true and the user is a real subscriber to cancel.
  process.env.BILLING_SIMULATION = 'true';
  await db.collection('users').doc(uid).set({
    role: 'candidate', subscription_status: 'free', credits: 100, created_at: '2026-01-01',
  });
  await confirmSimulatedCheckoutImpl(uid, { planKey: 'accelerator' });
}

beforeEach(clearFirestore);
afterEach(() => { delete process.env.BILLING_SIMULATION; });

describe('cancelSubscriptionSimulated', () => {
  it('is gated — throws when BILLING_SIMULATION is not enabled', async () => {
    await seedActiveSubscriber('cand1');
    delete process.env.BILLING_SIMULATION;
    await expect(cancelSubscriptionSimulatedImpl('cand1'))
      .rejects.toThrow(/simulation is not enabled/i);
  });

  it('downgrades an active subscriber to free and keeps credits', async () => {
    await seedActiveSubscriber('cand2');
    const creditsBefore = (await db.collection('users').doc('cand2').get()).get('credits');

    const res = await cancelSubscriptionSimulatedImpl('cand2');
    expect(res.status).toBe('cancelled');
    expect(res.subscription_status).toBe('free');

    const billing = (await db.collection('billing').doc('cand2').get()).data()!;
    expect(billing.active).toBe(false);

    const user = (await db.collection('users').doc('cand2').get()).data()!;
    expect(user.subscription_status).toBe('free');
    expect(user.role).toBe('candidate');
    expect(user.credits).toBe(creditsBefore); // credits preserved
  });

  it('is idempotent — returns inactive when there is no active subscription', async () => {
    process.env.BILLING_SIMULATION = 'true';
    await db.collection('users').doc('cand3').set({
      role: 'candidate', subscription_status: 'free', credits: 50, created_at: '2026-01-01',
    });
    const res = await cancelSubscriptionSimulatedImpl('cand3');
    expect(res.status).toBe('inactive');
  });
});

describe('createBillingPortalSession (simulation branch)', () => {
  it('returns the in-app manage URL when simulation is enabled', async () => {
    await seedActiveSubscriber('cand4');
    const res = await createBillingPortalSessionImpl('cand4');
    expect(res.url).toBe('/billing/manage');
    expect(res.simulated).toBe(true);
  });

  it('throws when there is no active subscription (real mode)', async () => {
    delete process.env.BILLING_SIMULATION;
    await db.collection('users').doc('cand5').set({
      role: 'candidate', subscription_status: 'free', credits: 0, created_at: '2026-01-01',
    });
    await expect(createBillingPortalSessionImpl('cand5'))
      .rejects.toThrow(/no active subscription/i);
  });

  it('routes Stripe Portal returns to the correct workspace shell', () => {
    expect(billingPortalReturnPathForAudience('candidate')).toBe('/workspace/billing');
    expect(billingPortalReturnPathForAudience('business')).toBe('/portal?billing=return');
    expect(billingPortalReturnPathForAudience(undefined)).toBe('/workspace/billing');
  });
});
