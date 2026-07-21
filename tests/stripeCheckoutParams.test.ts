import { describe, expect, it } from 'vitest';
import {
  buildCheckoutSessionParams,
  checkoutSessionHasCompletedPayment,
  createCheckoutSessionImpl,
  decideStripeWebhookEvent,
  invoicePaymentFailureState,
  shouldDeactivateStripeSubscription,
  stripeInvoiceSubscriptionId,
  type CheckoutPlan,
} from '../functions/src/handlers/stripeBilling';

const candidatePlan: CheckoutPlan = {
  plan: 'accelerator',
  audience: 'candidate',
  mode: 'subscription',
  priceEnv: 'STRIPE_PRICE_ACCELERATOR',
};

const businessPlan: CheckoutPlan = {
  plan: 'starter',
  audience: 'business',
  mode: 'subscription',
  priceEnv: 'STRIPE_PRICE_STARTER',
};

describe('buildCheckoutSessionParams', () => {
  it('rejects a missing, malformed, or mode-drifting checkout operation before touching Stripe', async () => {
    await expect(createCheckoutSessionImpl({
      uid: 'uid_123',
      data: { planKey: 'accelerator', uiMode: 'hosted' },
    })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(createCheckoutSessionImpl({
      uid: 'uid_123',
      data: { planKey: 'accelerator', uiMode: 'popup', operationId: 'checkout_123e4567-e89b-12d3-a456-426614174000' },
    })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('does not let an old subscription deletion deactivate a newer active subscription', () => {
    const currentBilling = {
      active: true,
      mode: 'subscription',
      stripe_subscription_id: 'sub_new',
    };

    expect(shouldDeactivateStripeSubscription(currentBilling, 'sub_old')).toBe(false);
    expect(shouldDeactivateStripeSubscription(currentBilling, 'sub_new')).toBe(true);
  });

  it('only deactivates a currently active subscription-mode entitlement', () => {
    expect(shouldDeactivateStripeSubscription({
      active: false,
      mode: 'subscription',
      stripe_subscription_id: 'sub_current',
    }, 'sub_current')).toBe(false);
    expect(shouldDeactivateStripeSubscription({
      active: true,
      mode: 'payment',
      stripe_subscription_id: 'sub_current',
    }, 'sub_current')).toBe(false);
  });

  it('extracts the v22 invoice subscription and records a non-destructive retry policy', () => {
    const invoice = {
      id: 'in_failed',
      attempt_count: 2,
      next_payment_attempt: 1_800_000_000,
      parent: { subscription_details: { subscription: 'sub_current' } },
    } as unknown as Parameters<typeof stripeInvoiceSubscriptionId>[0];

    expect(stripeInvoiceSubscriptionId(invoice)).toBe('sub_current');
    expect(invoicePaymentFailureState(invoice)).toEqual({
      payment_status: 'payment_failed',
      payment_failure: {
        invoice_id: 'in_failed',
        attempt_count: 2,
        next_payment_attempt_unix: 1_800_000_000,
        grace_policy: 'retain_entitlement_during_stripe_retries',
        entitlement_action: 'deactivate_only_on_matching_subscription_deleted',
      },
    });
  });

  it('deduplicates completed webhook events and leases in-flight processing', () => {
    expect(decideStripeWebhookEvent(undefined, 'checkout.session.completed', 1_000)).toEqual({ action: 'claim' });
    expect(decideStripeWebhookEvent({
      event_type: 'checkout.session.completed',
      status: 'completed',
    }, 'checkout.session.completed', 1_000)).toEqual({ action: 'duplicate' });
    expect(decideStripeWebhookEvent({
      event_type: 'checkout.session.completed',
      status: 'processing',
      lease_expires_at_ms: 1_001,
    }, 'checkout.session.completed', 1_000)).toEqual({ action: 'pending' });
    expect(decideStripeWebhookEvent({
      event_type: 'checkout.session.completed',
      status: 'processing',
      lease_expires_at_ms: 999,
    }, 'checkout.session.completed', 1_000)).toEqual({ action: 'claim' });
    expect(decideStripeWebhookEvent({
      event_type: 'invoice.payment_failed',
      status: 'completed',
    }, 'checkout.session.completed', 1_000)).toEqual({ action: 'conflict' });
  });

  it('activates checkout only after Stripe reports a completed payment', () => {
    expect(checkoutSessionHasCompletedPayment({ payment_status: 'paid' })).toBe(true);
    expect(checkoutSessionHasCompletedPayment({ payment_status: 'no_payment_required' })).toBe(true);
    expect(checkoutSessionHasCompletedPayment({ payment_status: 'unpaid' })).toBe(false);
  });

  it('keeps embedded checkout in-app for card payments and uses return URL only as fallback', () => {
    const params = buildCheckoutSessionParams({
      uid: 'uid_123',
      plan: candidatePlan,
      price: 'price_accelerator',
      baseUrl: 'https://career-copilot-a3168.web.app',
      email: 'candidate@example.com',
      useEmbeddedCheckout: true,
    }) as Record<string, unknown>;

    expect(params.ui_mode).toBe('embedded_page');
    expect(params.payment_method_types).toEqual(['card']);
    expect(params.redirect_on_completion).toBe('if_required');
    expect(params.return_url).toBe('https://career-copilot-a3168.web.app/workspace/billing?checkout=return&session_id={CHECKOUT_SESSION_ID}');
    expect(params.success_url).toBeUndefined();
    expect(params.cancel_url).toBeUndefined();
    expect(params.customer_email).toBe('candidate@example.com');
    expect(params.client_reference_id).toBe('uid_123');
  });

  it('keeps hosted checkout redirects only on the hosted path', () => {
    const params = buildCheckoutSessionParams({
      uid: 'emp_123',
      plan: businessPlan,
      price: 'price_starter',
      baseUrl: 'https://career-copilot-a3168.web.app',
      email: null,
      useEmbeddedCheckout: false,
    }) as Record<string, unknown>;

    expect(params.ui_mode).toBe('hosted_page');
    expect(params.redirect_on_completion).toBeUndefined();
    expect(params.return_url).toBeUndefined();
    expect(params.success_url).toBe('https://career-copilot-a3168.web.app/portal?checkout=success');
    expect(params.cancel_url).toBe('https://career-copilot-a3168.web.app/pricing?audience=employer&checkout=cancel');
    expect(params.customer_email).toBeUndefined();
  });

  it('reuses a known Stripe customer instead of creating another customer by email', () => {
    const params = buildCheckoutSessionParams({
      uid: 'uid_existing',
      plan: candidatePlan,
      price: 'price_accelerator',
      baseUrl: 'https://copilot.example.com',
      email: 'candidate@example.com',
      customerId: 'cus_existing',
      useEmbeddedCheckout: false,
    });

    expect(params.customer).toBe('cus_existing');
    expect(params.customer_email).toBeUndefined();
  });
});
