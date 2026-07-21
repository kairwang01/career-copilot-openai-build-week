import { describe, expect, it } from 'vitest';

import {
  accountDeletionBillingBlocker,
  buildAccountDeletionPendingCleanup,
  completedAccountDeletionRequiresCredentialCleanup,
  decideAccountDeletionClaim,
} from '../functions/src/accountDeletion/plan';
import { accountDeletionRequestBlocksCheckout } from '../functions/src/accountDeletion/checkoutGuard';

describe('account deletion checkout tombstone', () => {
  it('fails closed for every persisted deletion state and allows only an absent document', () => {
    expect(accountDeletionRequestBlocksCheckout(undefined)).toBe(false);
    expect(accountDeletionRequestBlocksCheckout(null)).toBe(false);
    expect(accountDeletionRequestBlocksCheckout({ status: 'deleting' })).toBe(true);
    expect(accountDeletionRequestBlocksCheckout({ status: 'retryable' })).toBe(true);
    expect(accountDeletionRequestBlocksCheckout({ status: 'completed' })).toBe(true);
    expect(accountDeletionRequestBlocksCheckout({ status: 'unexpected-legacy-state' })).toBe(true);
  });
});

describe('account deletion billing guard', () => {
  it('blocks active, payment-failed, and ambiguous recurring billing', () => {
    expect(accountDeletionBillingBlocker({
      active: true,
      mode: 'subscription',
      provider: 'stripe',
      stripe_subscription_id: 'sub_active',
      payment_status: 'current',
    })).toMatchObject({ code: 'active_or_unresolved_recurring_billing', provider: 'stripe' });
    expect(accountDeletionBillingBlocker({
      active: true,
      mode: 'subscription',
      provider: 'stripe',
      stripe_subscription_id: 'sub_past_due',
      payment_status: 'payment_failed',
    })).not.toBeNull();
    expect(accountDeletionBillingBlocker({
      stripe_subscription_id: 'sub_legacy',
      status: 'active',
    })).not.toBeNull();
  });

  it('allows a closed recurring record or a completed one-off payment record', () => {
    expect(accountDeletionBillingBlocker({
      active: false,
      mode: 'subscription',
      status: 'cancelled',
      stripe_subscription_id: 'sub_closed',
    })).toBeNull();
    expect(accountDeletionBillingBlocker({
      active: true,
      mode: 'payment',
      provider: 'stripe',
      stripe_subscription_id: null,
    })).toBeNull();
  });
});

describe('account deletion recovery state', () => {
  it('reuses a completed result, waits for a live owner, and reclaims an expired lease', () => {
    const result = {
      uid: 'candidate-1',
      email: null,
      deleted_auth: true,
      deleted_profile: true,
      deleted_private_credentials: true,
      auth_absent: true,
      profile_absent: true,
      pending_cleanup: [],
    };
    expect(decideAccountDeletionClaim({ status: 'completed', result }, 1_000)).toEqual({
      action: 'completed',
      result,
    });
    expect(decideAccountDeletionClaim({
      status: 'deleting',
      lease_expires_at_ms: 1_001,
    }, 1_000)).toEqual({ action: 'pending' });
    expect(decideAccountDeletionClaim({
      status: 'deleting',
      lease_expires_at_ms: 999,
    }, 1_000)).toEqual({ action: 'claim' });
    expect(decideAccountDeletionClaim({ status: 'retryable' }, 1_000)).toEqual({ action: 'claim' });
  });

  it('reopens legacy completed tombstones until private credential cleanup is recorded', () => {
    expect(completedAccountDeletionRequiresCredentialCleanup({
      status: 'completed',
      result: {
        uid: 'candidate-1',
        email: null,
        deleted_auth: true,
        deleted_profile: true,
        auth_absent: true,
        profile_absent: true,
        pending_cleanup: [],
      },
    })).toBe(true);
    expect(completedAccountDeletionRequiresCredentialCleanup({
      status: 'completed',
      result: {
        uid: 'candidate-1',
        email: null,
        deleted_auth: true,
        deleted_profile: true,
        deleted_private_credentials: true,
        auth_absent: true,
        profile_absent: true,
        pending_cleanup: [],
      },
    })).toBe(false);
  });
});

describe('account deletion pending cleanup manifest', () => {
  it('lists user subcollections, shared records, financial records, Stripe, and Storage without deleting them', () => {
    const cleanup = buildAccountDeletionPendingCleanup({
      uid: 'candidate-1',
      userSubcollections: ['notifications', 'interview_sessions', 'notifications'],
    });

    expect(cleanup).toContainEqual(expect.objectContaining({
      category: 'firestore_user_subcollection',
      resource: 'users/candidate-1/interview_sessions',
      disposition: 'retain_pending_policy',
    }));
    expect(cleanup).toContainEqual(expect.objectContaining({
      category: 'firestore_shared_record',
      resource: 'job_applications',
      selector: 'candidate_id == candidate-1 OR employer_id == candidate-1',
    }));
    expect(cleanup).toContainEqual(expect.objectContaining({
      category: 'firestore_shared_record',
      resource: 'sourcing_candidate_packets',
      selector: 'candidate_id == candidate-1 OR employer_id == candidate-1',
    }));
    expect(cleanup).toContainEqual(expect.objectContaining({
      category: 'firestore_shared_record',
      resource: 'sourcing_outreach_pair_guards',
      selector: 'candidate_id == candidate-1 OR employer_id == candidate-1',
    }));
    expect(cleanup).toContainEqual(expect.objectContaining({
      category: 'firestore_shared_record',
      resource: 'sourcing_outreach_daily_quotas',
      selector: 'employer_id == candidate-1 (TTL also applies)',
    }));
    expect(cleanup).toContainEqual(expect.objectContaining({
      category: 'firestore_financial_record',
      resource: 'billing/candidate-1',
    }));
    expect(cleanup).toContainEqual(expect.objectContaining({
      category: 'firestore_financial_record',
      resource: 'billing_fulfillment_reviews',
      selector: 'uid == candidate-1',
    }));
    expect(cleanup).toContainEqual(expect.objectContaining({
      category: 'firestore_financial_record',
      resource: 'credit_refund_reviews',
      selector: 'uid == candidate-1',
    }));
    expect(cleanup).toContainEqual(expect.objectContaining({
      category: 'firestore_financial_record',
      resource: 'usage_counter_reconciliation_reviews',
      selector: 'uid == candidate-1',
    }));
    expect(cleanup).toContainEqual(expect.objectContaining({
      category: 'storage_prefix',
      resource: 'resumes/candidate-1/',
    }));
    expect(cleanup).toContainEqual(expect.objectContaining({
      category: 'stripe_record',
      resource: 'Stripe customer/subscriptions/invoices',
    }));
    expect(new Set(cleanup.map((item) => `${item.category}:${item.resource}:${item.selector}`)).size).toBe(cleanup.length);
    expect(new Set(cleanup.map((item) => item.disposition))).toEqual(new Set([
      'retain_pending_policy',
      'external_action_required',
    ]));
  });
});
