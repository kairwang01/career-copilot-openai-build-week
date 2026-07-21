import { describe, expect, it } from 'vitest';

import {
  checkoutIntentDocumentId,
  checkoutIntentFingerprint,
  checkoutStripeIdempotencyKey,
  decideCheckoutIntent,
  executeCheckoutIntent,
  normalizeCheckoutOperationId,
  type CheckoutIntentClaim,
  type CheckoutIntentRecord,
  type CheckoutIntentStore,
} from '../functions/src/billing/checkoutIntent';

const operationId = 'checkout_123e4567-e89b-12d3-a456-426614174000';
const fingerprint = checkoutIntentFingerprint({
  uid: 'candidate-1',
  itemKey: 'accelerator',
  uiMode: 'embedded',
});

describe('checkout operation identity', () => {
  it('strictly validates client-generated operation ids', () => {
    expect(normalizeCheckoutOperationId(operationId)).toBe(operationId);
    expect(normalizeCheckoutOperationId(undefined)).toBeNull();
    expect(normalizeCheckoutOperationId('short')).toBeNull();
    expect(normalizeCheckoutOperationId(` ${operationId}`)).toBeNull();
    expect(normalizeCheckoutOperationId(`${operationId}/other`)).toBeNull();
    expect(normalizeCheckoutOperationId('x'.repeat(129))).toBeNull();
  });

  it('derives stable opaque Firestore and Stripe keys without exposing the uid', () => {
    const documentId = checkoutIntentDocumentId('candidate-1', operationId);
    const stripeKey = checkoutStripeIdempotencyKey('candidate-1', operationId);

    expect(checkoutIntentDocumentId('candidate-1', operationId)).toBe(documentId);
    expect(checkoutStripeIdempotencyKey('candidate-1', operationId)).toBe(stripeKey);
    expect(checkoutIntentDocumentId('candidate-1', `${operationId}a`)).not.toBe(documentId);
    expect(checkoutStripeIdempotencyKey('candidate-2', operationId)).not.toBe(stripeKey);
    expect(documentId).not.toContain('candidate-1');
    expect(stripeKey).toMatch(/^checkout_[A-Za-z0-9_-]{43}$/);
    expect(stripeKey.length).toBeLessThan(255);
  });
});

describe('checkout intent state decision', () => {
  it('claims a missing or expired intent, but waits for a live owner', () => {
    expect(decideCheckoutIntent(undefined, fingerprint, 1_000)).toEqual({ action: 'claim' });
    expect(decideCheckoutIntent({
      status: 'creating',
      fingerprint,
      lease_expires_at_ms: 1_001,
    }, fingerprint, 1_000)).toEqual({ action: 'wait' });
    expect(decideCheckoutIntent({
      status: 'creating',
      fingerprint,
      lease_expires_at_ms: 999,
    }, fingerprint, 1_000)).toEqual({ action: 'claim' });
  });

  it('reuses a completed result and rejects operation-id parameter drift', () => {
    const result = { mode: 'hosted' as const, url: 'https://checkout.stripe.test/session', id: 'cs_1' };
    expect(decideCheckoutIntent({ status: 'completed', fingerprint, result }, fingerprint, 1_000)).toEqual({
      action: 'reuse',
      result,
    });
    expect(decideCheckoutIntent({ status: 'completed', fingerprint: 'different', result }, fingerprint, 1_000)).toEqual({
      action: 'conflict',
    });
  });

  it('lets concurrent callers share one creation result', async () => {
    type Result = { mode: 'hosted'; url: string; id: string };
    let current: (CheckoutIntentRecord<Result> & { owner_token?: string }) | undefined;
    let completeWaiters: Array<() => void> = [];
    const store: CheckoutIntentStore<Result> = {
      async claim(claim: CheckoutIntentClaim) {
        const decision = decideCheckoutIntent(current, claim.fingerprint, claim.nowMs);
        if (decision.action === 'claim') {
          current = {
            status: 'creating',
            fingerprint: claim.fingerprint,
            owner_token: claim.ownerToken,
            lease_expires_at_ms: claim.leaseExpiresAtMs,
          };
        }
        return decision;
      },
      async complete(ownerToken, result) {
        if (current?.owner_token !== ownerToken) return false;
        current = { ...current, status: 'completed', result };
        completeWaiters.splice(0).forEach((resolve) => resolve());
        return true;
      },
      async release(ownerToken) {
        if (current?.owner_token === ownerToken) {
          current = { ...current, status: 'retryable', lease_expires_at_ms: 0 };
        }
      },
    };
    let releaseCreation!: (result: Result) => void;
    let notifyFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { notifyFirstStarted = resolve; });
    const creation = new Promise<Result>((resolve) => { releaseCreation = resolve; });
    let createCalls = 0;
    const expected = { mode: 'hosted' as const, url: 'https://checkout.stripe.test/shared', id: 'cs_shared' };
    const waitForCompletion = () => new Promise<void>((resolve) => completeWaiters.push(resolve));

    const first = executeCheckoutIntent({
      store,
      fingerprint,
      ownerToken: 'owner-a',
      create: async () => {
        createCalls += 1;
        notifyFirstStarted();
        return creation;
      },
    });
    await firstStarted;
    const second = executeCheckoutIntent({
      store,
      fingerprint,
      ownerToken: 'owner-b',
      create: async () => {
        createCalls += 1;
        return { ...expected, id: 'cs_duplicate' };
      },
      wait: waitForCompletion,
    });
    releaseCreation(expected);

    await expect(Promise.all([first, second])).resolves.toEqual([expected, expected]);
    expect(createCalls).toBe(1);
  });
});
