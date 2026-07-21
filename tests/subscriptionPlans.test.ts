import { describe, expect, it } from 'vitest';
import {
  assignableSubscriptionPlansForRole,
  subscriptionPlansForRole,
} from '../lib/access/subscriptionPlans';

describe('subscriptionPlansForRole', () => {
  it('returns candidate tiers for candidate accounts', () => {
    expect(subscriptionPlansForRole('candidate')).toEqual(['free', 'essentials', 'accelerator', 'executive']);
  });

  it('returns employer tiers for employer accounts', () => {
    expect(subscriptionPlansForRole('employer')).toEqual(['free', 'starter', 'growth', 'pro', 'single_post', 'job_pack']);
    expect(assignableSubscriptionPlansForRole('employer')).toEqual(['free', 'starter', 'growth', 'pro']);
  });

  it('keeps agency and unknown roles on free only', () => {
    expect(subscriptionPlansForRole('agency')).toEqual(['free']);
    expect(subscriptionPlansForRole(null)).toEqual(['free']);
  });
});
