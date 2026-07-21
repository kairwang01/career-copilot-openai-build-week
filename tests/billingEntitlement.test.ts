import { describe, expect, it } from 'vitest';
import {
  billingPlanContractFor,
  hasExactBillingEntitlement,
} from '../functions/src/billing/entitlement';

describe('billing entitlement matching', () => {
  it('exposes the canonical audience and mode contract used by billing writers', () => {
    expect(billingPlanContractFor('pro')).toEqual({ audience: 'business', mode: 'subscription' });
    expect(billingPlanContractFor('single_post')).toEqual({ audience: 'business', mode: 'payment' });
    expect(billingPlanContractFor('free')).toBeNull();
  });

  it('rejects an active lower-tier subscription for a different requested plan', () => {
    expect(hasExactBillingEntitlement({
      active: true,
      status: 'active',
      plan: 'starter',
      audience: 'business',
      mode: 'subscription',
    }, 'pro')).toBe(false);
  });

  it('rejects a plan whose billing audience does not match the plan contract', () => {
    expect(hasExactBillingEntitlement({
      active: true,
      status: 'active',
      plan: 'pro',
      audience: 'candidate',
      mode: 'subscription',
    }, 'pro')).toBe(false);
  });

  it('rejects payment mode for a recurring subscription plan', () => {
    expect(hasExactBillingEntitlement({
      active: true,
      status: 'active',
      plan: 'pro',
      audience: 'business',
      mode: 'payment',
    }, 'pro')).toBe(false);
  });

  it('rejects one-off payments when a caller requires a recurring subscription', () => {
    expect(hasExactBillingEntitlement({
      active: true,
      status: 'active',
      plan: 'single_post',
      audience: 'business',
      mode: 'payment',
    }, 'single_post', { subscriptionOnly: true })).toBe(false);
  });

  it('accepts an exact recurring subscription contract', () => {
    expect(hasExactBillingEntitlement({
      active: true,
      status: 'active',
      plan: 'executive',
      audience: 'candidate',
      mode: 'subscription',
    }, 'executive')).toBe(true);
  });

  it('accepts a one-off payment only for its own plan', () => {
    const payment = {
      active: true,
      status: 'active',
      plan: 'single_post',
      audience: 'business',
      mode: 'payment',
    };

    expect(hasExactBillingEntitlement(payment, 'single_post')).toBe(true);
    expect(hasExactBillingEntitlement(payment, 'pro')).toBe(false);
  });

  it.each([
    { label: 'active is false', override: { active: false, status: 'active' } },
    { label: 'status is not active', override: { active: true, status: 'past_due' } },
  ])('rejects an otherwise exact contract when $label', ({ override }) => {
    expect(hasExactBillingEntitlement({
      active: true,
      status: 'active',
      plan: 'pro',
      audience: 'business',
      mode: 'subscription',
      ...override,
    }, 'pro')).toBe(false);
  });

  it('rejects free and unknown plans because they have no paid contract', () => {
    const entitlement = {
      active: true,
      status: 'active',
      plan: 'free',
      audience: 'candidate',
      mode: 'subscription',
    };

    expect(hasExactBillingEntitlement(entitlement, 'free')).toBe(false);
    expect(hasExactBillingEntitlement(entitlement, 'unlisted')).toBe(false);
  });
});
