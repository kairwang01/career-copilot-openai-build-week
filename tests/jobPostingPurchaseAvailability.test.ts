import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  JOB_POSTING_PURCHASE_UNAVAILABLE_MESSAGE,
  isLegacyJobPostingPurchasePlan,
} from '../functions/src/billing/jobPostingPurchases';
import { DEFAULT_PLAN_QUOTAS } from '../functions/src/admin/quotaDefaults';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('legacy one-time job-posting products', () => {
  it('identifies the incomplete one-time SKUs without closing recurring plans', () => {
    expect(isLegacyJobPostingPurchasePlan('single_post')).toBe(true);
    expect(isLegacyJobPostingPurchasePlan(' job_pack ')).toBe(true);
    expect(isLegacyJobPostingPurchasePlan('starter')).toBe(false);
    expect(JOB_POSTING_PURCHASE_UNAVAILABLE_MESSAGE).toMatch(/unavailable/i);
  });

  it('blocks new checkout, self-service selection, and admin assignment server-side', () => {
    for (const handler of [
      '../functions/src/handlers/stripeBilling.ts',
      '../functions/src/handlers/setSubscriptionStatus.ts',
      '../functions/src/handlers/adminPortal.ts',
    ]) {
      expect(source(handler)).toContain('isLegacyJobPostingPurchasePlan');
      expect(source(handler)).toContain('JOB_POSTING_PURCHASE_UNAVAILABLE_MESSAGE');
    }
  });

  it('keeps the legacy job-pack support cap aligned with its original five-post label', () => {
    expect(DEFAULT_PLAN_QUOTAS.job_pack.active_job_limit).toBe(5);
    expect(source('../components/admin/AdminPortal.tsx')).toContain('job_pack: { daily_run_limit: 0, daily_credit_limit: 0, monthly_credit_grant: 0, active_job_limit: 5 }');
  });

  it('does not ask production operators to configure the disabled SKUs', () => {
    for (const path of [
      '../functions/.env.example',
      '../docs/deployment/README.md',
    ]) {
      const text = source(path);
      expect(text).not.toMatch(/^STRIPE_PRICE_(?:SINGLE_POST|JOB_PACK)=/m);
      expect(text).toMatch(/do not configure or sell/i);
    }
  });
});
