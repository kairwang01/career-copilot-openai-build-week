/**
 * Stripe entitlement tests.
 *
 * The webhook itself is signature-verified HTTP, but the critical product
 * contract is this: a Stripe-confirmed entitlement writes billing.active and
 * then activates the same server-only subscription path used by the app.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from '../functions/node_modules/firebase-admin';
import {
  activateStripeEntitlement,
  createCheckoutSessionImpl,
  deactivateStripeEntitlement,
  handleCheckoutCompleted,
  handleCheckoutCompletedWithRecovery,
  recordInvoicePaymentFailed,
  recordInvoicePaymentSucceeded,
  STRIPE_CHECKOUT_FALLBACK_MIN_AGE_MS,
  STRIPE_CHECKOUT_FALLBACK_MIN_ATTEMPTS,
} from '../functions/src/handlers/stripeBilling';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-careercopilot';
const db = admin.firestore();

async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
}

async function seedUser(uid: string, data: Record<string, unknown> = {}) {
  await db.collection('users').doc(uid).set({
    role: 'candidate',
    subscription_status: 'free',
    credits: 100,
    created_at: '2026-01-01',
    ...data,
  });
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function paidCheckoutSession(
  overrides: Record<string, unknown> = {},
): Parameters<typeof handleCheckoutCompleted>[0] {
  return {
    id: 'cs_fulfillment_review',
    object: 'checkout.session',
    livemode: false,
    payment_status: 'paid',
    mode: 'subscription',
    amount_total: 2900,
    currency: 'cad',
    metadata: null,
    client_reference_id: null,
    customer: 'cus_fulfillment_review',
    payment_intent: 'pi_fulfillment_review',
    subscription: 'sub_fulfillment_review',
    ...overrides,
  } as unknown as Parameters<typeof handleCheckoutCompleted>[0];
}

beforeEach(clearFirestore);
afterEach(() => vi.restoreAllMocks());

describe('Stripe entitlements activate billing-gated plans', () => {
  it('activates a paid candidate plan through billing.active and grants paid credits', async () => {
    await seedUser('cand-stripe');

    const res = await activateStripeEntitlement({
      uid: 'cand-stripe',
      plan: 'accelerator',
      audience: 'candidate',
      stripeCustomerId: 'cus_candidate',
      stripeSubscriptionId: 'sub_candidate',
      checkoutSessionId: 'cs_candidate',
      checkoutMode: 'subscription',
    });

    expect(res.status).toBe('active');
    expect(res.subscription_status).toBe('accelerator');
    expect(res.grant_source).toBe('paid');

    const user = (await db.collection('users').doc('cand-stripe').get()).data()!;
    expect(user.role).toBe('candidate');
    expect(user.subscription_status).toBe('accelerator');
    // 100 seeded + accelerator monthly grant (1000 after the 2026-06 pricing revamp; was 750).
    expect(user.credits).toBe(1100);

    const billing = (await db.collection('billing').doc('cand-stripe').get()).data()!;
    expect(billing).toMatchObject({
      active: true,
      status: 'active',
      plan: 'accelerator',
      audience: 'candidate',
      mode: 'subscription',
      provider: 'stripe',
      stripe_customer_id: 'cus_candidate',
      stripe_subscription_id: 'sub_candidate',
    });
  });

  it('activates a business plan for an employer account', async () => {
    await seedUser('emp-stripe', { role: 'employer' });

    const res = await activateStripeEntitlement({
      uid: 'emp-stripe',
      plan: 'pro',
      audience: 'business',
      stripeCustomerId: 'cus_employer',
      stripeSubscriptionId: 'sub_employer',
      checkoutSessionId: 'cs_employer',
      checkoutMode: 'subscription',
    });

    expect(res.status).toBe('active');
    expect(res.role).toBe('employer');
    expect(res.subscription_status).toBe('pro');

    const user = (await db.collection('users').doc('emp-stripe').get()).data()!;
    expect(user.role).toBe('employer');
    expect(user.subscription_status).toBe('pro');
    expect(user.credits).toBe(20100);

    const billing = (await db.collection('billing').doc('emp-stripe').get()).data()!;
    expect(billing).toMatchObject({
      active: true,
      status: 'active',
      plan: 'pro',
      audience: 'business',
      mode: 'subscription',
    });
  });

  it('activates an exact one-off employer purchase without subscription credits', async () => {
    await seedUser('emp-single-post-stripe', { role: 'employer' });

    const res = await activateStripeEntitlement({
      uid: 'emp-single-post-stripe',
      plan: 'single_post',
      audience: 'business',
      stripeCustomerId: 'cus_single_post',
      stripeSubscriptionId: null,
      checkoutSessionId: 'cs_single_post',
      checkoutMode: 'payment',
    });

    expect(res.status).toBe('active');
    expect(res.subscription_status).toBe('single_post');
    expect(res.credits).toBe(100);
    const billing = (await db.collection('billing').doc('emp-single-post-stripe').get()).data()!;
    expect(billing).toMatchObject({
      active: true,
      status: 'active',
      plan: 'single_post',
      audience: 'business',
      mode: 'payment',
    });
  });

  it('rejects checkout mode that conflicts with the canonical plan contract', async () => {
    await seedUser('emp-mode-mismatch', { role: 'employer' });

    await expect(activateStripeEntitlement({
      uid: 'emp-mode-mismatch',
      plan: 'pro',
      audience: 'business',
      checkoutSessionId: 'cs_wrong_mode',
      checkoutMode: 'payment',
    })).rejects.toThrow(/invalid stripe entitlement payload/i);

    expect((await db.collection('billing').doc('emp-mode-mismatch').get()).exists).toBe(false);
  });

  it('rejects business plan activation for candidate accounts', async () => {
    await seedUser('cand-business-stripe');

    await expect(activateStripeEntitlement({
      uid: 'cand-business-stripe',
      plan: 'pro',
      audience: 'business',
      stripeCustomerId: 'cus_employer',
      stripeSubscriptionId: 'sub_employer',
      checkoutSessionId: 'cs_employer',
      checkoutMode: 'subscription',
    })).rejects.toThrow(/candidate accounts cannot buy employer plans/i);

    const user = (await db.collection('users').doc('cand-business-stripe').get()).data()!;
    expect(user.role).toBe('candidate');
    expect(user.subscription_status).toBe('free');
  });

  it('deactivates a canceled subscription without demoting an employer out of the portal role', async () => {
    await seedUser('cancel-stripe', { role: 'employer' });
    await activateStripeEntitlement({
      uid: 'cancel-stripe',
      plan: 'starter',
      audience: 'business',
      stripeCustomerId: 'cus_cancel',
      stripeSubscriptionId: 'sub_cancel',
      checkoutSessionId: 'cs_cancel',
      checkoutMode: 'subscription',
    });

    await deactivateStripeEntitlement({
      uid: 'cancel-stripe',
      audience: 'business',
      stripeSubscriptionId: 'sub_cancel',
      reason: 'cancelled',
    });

    const user = (await db.collection('users').doc('cancel-stripe').get()).data()!;
    expect(user.role).toBe('employer');
    expect(user.subscription_status).toBe('free');

    const billing = (await db.collection('billing').doc('cancel-stripe').get()).data()!;
    expect(billing.active).toBe(false);
    expect(billing.status).toBe('cancelled');
  });

  it('ignores deletion of an old subscription after a newer subscription became active', async () => {
    await seedUser('stale-delete', { subscription_status: 'accelerator' });
    await db.collection('billing').doc('stale-delete').set({
      active: true,
      status: 'active',
      mode: 'subscription',
      audience: 'candidate',
      plan: 'accelerator',
      stripe_customer_id: 'cus_stale',
      stripe_subscription_id: 'sub_new',
    });

    const result = await deactivateStripeEntitlement({
      uid: 'stale-delete',
      audience: 'candidate',
      stripeSubscriptionId: 'sub_old',
      reason: 'cancelled',
    });

    expect(result).toEqual({ deactivated: false });
    expect((await db.collection('billing').doc('stale-delete').get()).data()).toMatchObject({
      active: true,
      status: 'active',
      stripe_subscription_id: 'sub_new',
    });
    expect((await db.collection('users').doc('stale-delete').get()).data()).toMatchObject({
      subscription_status: 'accelerator',
      role: 'candidate',
    });
  });

  it('records payment failure only for the matching active subscription and retains access', async () => {
    await seedUser('invoice-failure', { subscription_status: 'accelerator' });
    await db.collection('billing').doc('invoice-failure').set({
      active: true,
      status: 'active',
      payment_status: 'current',
      mode: 'subscription',
      audience: 'candidate',
      plan: 'accelerator',
      stripe_subscription_id: 'sub_current',
    });
    const invoice = (subscription: string, id: string) => ({
      id,
      attempt_count: 2,
      next_payment_attempt: 1_800_000_000,
      parent: { subscription_details: { subscription } },
    } as unknown as Parameters<typeof recordInvoicePaymentFailed>[0]);

    await expect(recordInvoicePaymentFailed(invoice('sub_old', 'in_old'))).resolves.toEqual({ recorded: false });
    expect((await db.collection('billing').doc('invoice-failure').get()).data()).toMatchObject({
      active: true,
      status: 'active',
      payment_status: 'current',
    });

    await expect(recordInvoicePaymentFailed(invoice('sub_current', 'in_current'))).resolves.toEqual({ recorded: true });
    expect((await db.collection('billing').doc('invoice-failure').get()).data()).toMatchObject({
      active: true,
      status: 'active',
      payment_status: 'payment_failed',
      payment_failure: {
        invoice_id: 'in_current',
        attempt_count: 2,
        next_payment_attempt_unix: 1_800_000_000,
        grace_policy: 'retain_entitlement_during_stripe_retries',
        entitlement_action: 'deactivate_only_on_matching_subscription_deleted',
      },
    });

    await expect(recordInvoicePaymentSucceeded(invoice('sub_current', 'in_recovered'))).resolves.toEqual({ recorded: true });
    const recovered = (await db.collection('billing').doc('invoice-failure').get()).data()!;
    expect(recovered).toMatchObject({
      active: true,
      status: 'active',
      payment_status: 'current',
      payment_recovered_invoice_id: 'in_recovered',
    });
    expect(recovered.payment_failure).toBeUndefined();
  });

  it('persists paid checkout metadata failures for operator review and counts webhook replays', async () => {
    const session = paidCheckoutSession();

    await handleCheckoutCompleted(session, {
      eventId: 'evt_fulfillment_first',
      eventType: 'checkout.session.completed',
    });
    const first = (await db.collection('billing_fulfillment_reviews').doc(session.id).get()).data()!;
    expect(first).toMatchObject({
      status: 'pending',
      operator_action_required: true,
      operator_action: 'refund_or_cancel_review',
      recommended_action: 'refund_or_cancel_review',
      attempts: 1,
      checkout_session_id: session.id,
      stripe_event_id: 'evt_fulfillment_first',
      event_type: 'checkout.session.completed',
      first_reason_code: 'checkout_invalid_entitlement_metadata',
      reason_code: 'checkout_invalid_entitlement_metadata',
      latest_reason_code: 'checkout_invalid_entitlement_metadata',
      payment_status: 'paid',
      amount_total: 2900,
      currency: 'cad',
      stripe_customer_id: 'cus_fulfillment_review',
      stripe_payment_intent_id: 'pi_fulfillment_review',
      stripe_subscription_id: 'sub_fulfillment_review',
    });

    await handleCheckoutCompleted(session, {
      eventId: 'evt_fulfillment_replay',
      eventType: 'checkout.session.async_payment_succeeded',
    });
    expect((await db.collection('billing_fulfillment_reviews').doc(session.id).get()).data()).toMatchObject({
      status: 'pending',
      operator_action_required: true,
      attempts: 2,
      stripe_event_id: 'evt_fulfillment_replay',
      event_type: 'checkout.session.async_payment_succeeded',
    });
  });

  it('never reopens an operator-resolved fulfillment review on replay', async () => {
    const session = paidCheckoutSession({ id: 'cs_fulfillment_resolved' });
    await handleCheckoutCompleted(session, {
      eventId: 'evt_fulfillment_before_resolution',
      eventType: 'checkout.session.completed',
    });
    await db.collection('billing_fulfillment_reviews').doc(session.id).set({
      status: 'resolved',
      operator_action_required: false,
      resolution: 'refunded',
    }, { merge: true });

    await handleCheckoutCompleted(session, {
      eventId: 'evt_fulfillment_after_resolution',
      eventType: 'checkout.session.completed',
    });
    expect((await db.collection('billing_fulfillment_reviews').doc(session.id).get()).data()).toMatchObject({
      status: 'resolved',
      operator_action_required: false,
      resolution: 'refunded',
      attempts: 2,
      stripe_event_id: 'evt_fulfillment_after_resolution',
    });
  });

  it('queues a paid checkout blocked by an account-deletion tombstone', async () => {
    await seedUser('deleted-paid-checkout');
    await db.collection('account_deletion_requests').doc('deleted-paid-checkout').set({
      status: 'completed',
    });
    const session = paidCheckoutSession({
      id: 'cs_deleted_paid_checkout',
      client_reference_id: 'deleted-paid-checkout',
      metadata: {
        uid: 'deleted-paid-checkout',
        plan_key: 'accelerator',
        audience: 'candidate',
      },
    });

    await handleCheckoutCompleted(session, {
      eventId: 'evt_deleted_paid_checkout',
      eventType: 'checkout.session.completed',
    });

    expect((await db.collection('billing_fulfillment_reviews').doc(session.id).get()).data()).toMatchObject({
      status: 'pending',
      operator_action_required: true,
      uid: 'deleted-paid-checkout',
      plan_key: 'accelerator',
      audience: 'candidate',
      latest_reason_code: 'permanent_entitlement_failure',
      latest_entitlement_error_code: 'failed-precondition',
    });
    expect((await db.collection('billing').doc('deleted-paid-checkout').get()).exists).toBe(false);
  });

  it('retries ordinary checkout failures before durable escalation thresholds', async () => {
    const session = paidCheckoutSession({ id: 'cs_transient_before_threshold' });
    const event = {
      eventId: 'evt_transient_before_threshold',
      eventType: 'checkout.session.completed',
    };
    const firstSeenAtMs = 2_000_000_000_000;
    const failure = new Error('simulated transient Firestore outage');

    await expect(handleCheckoutCompletedWithRecovery(
      session,
      event,
      {
        deliveryAttempt: STRIPE_CHECKOUT_FALLBACK_MIN_ATTEMPTS - 1,
        firstSeenAtMs,
        nowMs: firstSeenAtMs + STRIPE_CHECKOUT_FALLBACK_MIN_AGE_MS + 1,
      },
      async () => { throw failure; },
    )).rejects.toBe(failure);

    await expect(handleCheckoutCompletedWithRecovery(
      session,
      event,
      {
        deliveryAttempt: STRIPE_CHECKOUT_FALLBACK_MIN_ATTEMPTS,
        firstSeenAtMs,
        nowMs: firstSeenAtMs + STRIPE_CHECKOUT_FALLBACK_MIN_AGE_MS - 1,
      },
      async () => { throw failure; },
    )).rejects.toBe(failure);

    expect((await db.collection('billing_fulfillment_reviews').doc(session.id).get()).exists).toBe(false);
  });

  it('parks a paid checkout in durable review only after retries and minimum age', async () => {
    const session = paidCheckoutSession({ id: 'cs_transient_retry_exhausted' });
    const firstSeenAtMs = 2_100_000_000_000;
    const nowMs = firstSeenAtMs + STRIPE_CHECKOUT_FALLBACK_MIN_AGE_MS;

    await expect(handleCheckoutCompletedWithRecovery(
      session,
      {
        eventId: 'evt_transient_retry_exhausted',
        eventType: 'checkout.session.completed',
      },
      {
        deliveryAttempt: STRIPE_CHECKOUT_FALLBACK_MIN_ATTEMPTS,
        firstSeenAtMs,
        nowMs,
      },
      async () => { throw new Error('persistent ordinary fulfillment failure'); },
    )).resolves.toEqual({ status: 'review_queued' });

    const review = (await db.collection('billing_fulfillment_reviews').doc(session.id).get()).data()!;
    expect(review).toMatchObject({
      status: 'pending',
      operator_action_required: true,
      latest_reason_code: 'transient_entitlement_failure_retry_exhausted',
      latest_entitlement_error_code: 'internal',
      webhook_delivery_attempt: STRIPE_CHECKOUT_FALLBACK_MIN_ATTEMPTS,
    });
    expect(review.webhook_first_seen_at.toMillis()).toBe(firstSeenAtMs);
    expect(review.webhook_escalated_at.toMillis()).toBe(nowMs);
  });

  it('keeps a retry-exhausted webhook retryable when the durable review write fails', async () => {
    const session = paidCheckoutSession({ id: 'cs_transient_queue_failure' });
    const firstSeenAtMs = 2_200_000_000_000;
    const queueFailure = new Error('simulated fulfillment review queue outage');
    vi.spyOn(db, 'runTransaction').mockRejectedValueOnce(queueFailure);

    await expect(handleCheckoutCompletedWithRecovery(
      session,
      {
        eventId: 'evt_transient_queue_failure',
        eventType: 'checkout.session.completed',
      },
      {
        deliveryAttempt: STRIPE_CHECKOUT_FALLBACK_MIN_ATTEMPTS,
        firstSeenAtMs,
        nowMs: firstSeenAtMs + STRIPE_CHECKOUT_FALLBACK_MIN_AGE_MS,
      },
      async () => { throw new Error('persistent ordinary fulfillment failure'); },
    )).rejects.toBe(queueFailure);
  });

  it('shares one Stripe subscription Checkout session across concurrent retries', async () => {
    await seedUser('checkout-race');
    const oldSimulation = process.env.BILLING_SIMULATION;
    const oldPrice = process.env.STRIPE_PRICE_ACCELERATOR;
    const oldBaseUrl = process.env.APP_BASE_URL;
    process.env.BILLING_SIMULATION = 'false';
    process.env.STRIPE_PRICE_ACCELERATOR = 'price_accelerator';
    process.env.APP_BASE_URL = 'https://copilot.example.com';
    let createCalls = 0;
    let firstStarted!: () => void;
    let releaseStripe!: (session: { id: string; url: string; client_secret: null }) => void;
    const started = new Promise<void>((resolve) => { firstStarted = resolve; });
    const stripeResult = new Promise<{ id: string; url: string; client_secret: null }>((resolve) => {
      releaseStripe = resolve;
    });
    const requestOptions: Array<{ idempotencyKey?: string }> = [];

    try {
      const input = {
        uid: 'checkout-race',
        data: {
          planKey: 'accelerator',
          uiMode: 'hosted',
          operationId: 'checkout_123e4567-e89b-12d3-a456-426614174000',
        },
        email: 'candidate@example.com',
        createStripeSession: async (_params: unknown, options: { idempotencyKey?: string }) => {
          createCalls += 1;
          requestOptions.push(options);
          firstStarted();
          return stripeResult;
        },
      };
      const first = createCheckoutSessionImpl(input);
      await started;
      const second = createCheckoutSessionImpl(input);
      const expected = { id: 'cs_shared', url: 'https://checkout.stripe.test/cs_shared', client_secret: null as null };
      releaseStripe(expected);

      await expect(Promise.all([first, second])).resolves.toEqual([
        { mode: 'hosted', id: expected.id, url: expected.url },
        { mode: 'hosted', id: expected.id, url: expected.url },
      ]);
      expect(createCalls).toBe(1);
      expect(requestOptions[0]?.idempotencyKey).toMatch(/^checkout_[A-Za-z0-9_-]{43}$/);
      const intents = await db.collection('billing_checkout_intents').where('uid', '==', 'checkout-race').get();
      expect(intents.size).toBe(1);
      expect(intents.docs[0].data()).toMatchObject({ status: 'completed', item_key: 'accelerator' });
    } finally {
      restoreEnv('BILLING_SIMULATION', oldSimulation);
      restoreEnv('STRIPE_PRICE_ACCELERATOR', oldPrice);
      restoreEnv('APP_BASE_URL', oldBaseUrl);
    }
  });

  it('reuses the same operation result for credit packs and simulated checkout', async () => {
    await seedUser('checkout-reuse');
    const oldSimulation = process.env.BILLING_SIMULATION;
    const oldPackPrice = process.env.STRIPE_PRICE_PACK_100;
    const oldBaseUrl = process.env.APP_BASE_URL;
    process.env.BILLING_SIMULATION = 'false';
    process.env.STRIPE_PRICE_PACK_100 = 'price_pack_100';
    process.env.APP_BASE_URL = 'https://copilot.example.com';
    let packCreates = 0;

    try {
      const packInput = {
        uid: 'checkout-reuse',
        data: {
          planKey: 'pack_100',
          uiMode: 'hosted',
          operationId: 'checkout_pack_123e4567-e89b-12d3-a456-426614174000',
        },
        createStripeSession: async () => {
          packCreates += 1;
          return { id: 'cs_pack', url: 'https://checkout.stripe.test/cs_pack', client_secret: null };
        },
      };
      const firstPack = await createCheckoutSessionImpl(packInput);
      const retriedPack = await createCheckoutSessionImpl(packInput);
      expect(retriedPack).toEqual(firstPack);
      expect(packCreates).toBe(1);

      process.env.BILLING_SIMULATION = 'true';
      const simInput = {
        uid: 'checkout-reuse',
        data: {
          planKey: 'accelerator',
          uiMode: 'hosted',
          operationId: 'checkout_sim_123e4567-e89b-12d3-a456-426614174000',
        },
      };
      const firstSim = await createCheckoutSessionImpl(simInput);
      const retriedSim = await createCheckoutSessionImpl(simInput);
      expect(retriedSim).toEqual(firstSim);
      expect(firstSim).toMatchObject({ mode: 'hosted', simulated: true });
    } finally {
      restoreEnv('BILLING_SIMULATION', oldSimulation);
      restoreEnv('STRIPE_PRICE_PACK_100', oldPackPrice);
      restoreEnv('APP_BASE_URL', oldBaseUrl);
    }
  });
});
