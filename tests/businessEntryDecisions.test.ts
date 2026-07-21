import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BUSINESS_ENTRY_PLAN,
  decideBusinessPortalAction,
  requiresBusinessPlanPaymentConfirmation,
  shouldRedirectBusinessPlanToCheckout,
} from '../lib/access/businessEntryDecisions';

describe('business entry decisions', () => {
  it('opens sign-up for logged-out users', () => {
    expect(decideBusinessPortalAction({
      hasSession: false,
      canEnterBusinessPortal: false,
      hasPortalHandler: true,
    })).toBe('open_signup');
  });

  it('does not send a signed-in candidate directly into portal or payment', () => {
    expect(decideBusinessPortalAction({
      hasSession: true,
      canEnterBusinessPortal: false,
      hasPortalHandler: true,
    })).toBe('open_business_access_prompt');
  });

  it('enters the portal only for accounts with business access', () => {
    expect(decideBusinessPortalAction({
      hasSession: true,
      canEnterBusinessPortal: true,
      hasPortalHandler: true,
    })).toBe('enter_portal');
  });

  it('falls back to the parent route for business accounts without a portal handler', () => {
    expect(decideBusinessPortalAction({
      hasSession: true,
      canEnterBusinessPortal: true,
      hasPortalHandler: false,
    })).toBe('go_back');
  });

  it('defaults business entry to the free plan instead of a paid checkout plan', () => {
    expect(DEFAULT_BUSINESS_ENTRY_PLAN).toBe('free');
  });

  it('does not require payment confirmation for the free business plan', () => {
    expect(requiresBusinessPlanPaymentConfirmation('free')).toBe(false);
    expect(requiresBusinessPlanPaymentConfirmation('starter')).toBe(true);
    expect(requiresBusinessPlanPaymentConfirmation('growth')).toBe(true);
  });

  it('never redirects the free business plan to checkout even if backend state is stale', () => {
    expect(shouldRedirectBusinessPlanToCheckout('free', 'pending_payment')).toBe(false);
    expect(shouldRedirectBusinessPlanToCheckout('starter', 'pending_payment')).toBe(true);
    expect(shouldRedirectBusinessPlanToCheckout('growth', 'active')).toBe(false);
    expect(shouldRedirectBusinessPlanToCheckout('pro', undefined)).toBe(false);
  });
});
