import { describe, expect, it } from 'vitest';
import {
  hasBusinessPortalAccess,
  isPendingBusinessSubscriptionStatus,
  normalizeBusinessSubscriptionStatus,
} from '../lib/access/businessAccess';

describe('business portal access', () => {
  it('allows employer-role accounts', () => {
    expect(hasBusinessPortalAccess('employer', 'free')).toBe(true);
  });

  it('does not allow candidate-role accounts with a stale business subscription', () => {
    expect(hasBusinessPortalAccess('candidate', 'starter')).toBe(false);
    expect(hasBusinessPortalAccess('candidate', 'growth')).toBe(false);
  });

  it('does not treat an ordinary free candidate as a business account', () => {
    expect(hasBusinessPortalAccess('candidate', 'free')).toBe(false);
  });

  it('does not treat an unpaid pending business plan as portal access', () => {
    expect(hasBusinessPortalAccess('candidate', 'pending_biz_growth')).toBe(false);
    expect(isPendingBusinessSubscriptionStatus('pending_biz_growth')).toBe(true);
  });

  it('normalizes pending business status prefixes', () => {
    expect(normalizeBusinessSubscriptionStatus('pending_biz_pro')).toBe('pro');
  });
});
