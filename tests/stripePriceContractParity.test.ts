import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CREDIT_PACKS } from '../config/credits';
import { STRIPE_PRICE_EXPECTATIONS } from '../scripts/lib/stripe-release-config.mjs';

const en = JSON.parse(
  readFileSync(new URL('../localization/en.json', import.meta.url), 'utf8'),
) as Record<string, string>;

const publishedPlanPriceKeys: Record<string, string> = {
  STRIPE_PRICE_ESSENTIALS: 'site_plan_js_essentials_price',
  STRIPE_PRICE_ACCELERATOR: 'site_plan_js_accelerator_price',
  STRIPE_PRICE_EXECUTIVE: 'site_plan_js_executive_price',
  STRIPE_PRICE_STARTER: 'site_plan_emp_starter_price',
  STRIPE_PRICE_GROWTH: 'site_plan_emp_growth_price',
  STRIPE_PRICE_PRO: 'site_plan_emp_team_price',
};

const packByEnvironmentKey = {
  STRIPE_PRICE_PACK_100: 'pack_100',
  STRIPE_PRICE_PACK_500: 'pack_500',
  STRIPE_PRICE_PACK_1000: 'pack_1000',
} as const;

function publishedCents(value: string): number {
  const amount = Number(value.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(amount)) throw new Error(`Invalid published price: ${value}`);
  return Math.round(amount * 100);
}

describe('Stripe Price release contract parity', () => {
  it('matches every public monthly plan amount to the live preflight contract', () => {
    for (const [environmentKey, localizationKey] of Object.entries(
      publishedPlanPriceKeys,
    )) {
      const expectation = STRIPE_PRICE_EXPECTATIONS[environmentKey];
      expect(expectation.type, environmentKey).toBe('recurring');
      expect(expectation.unitAmount, environmentKey).toBe(
        publishedCents(en[localizationKey]),
      );
    }
  });

  it('matches every displayed credit-pack amount to the live preflight contract', () => {
    for (const [environmentKey, packKey] of Object.entries(
      packByEnvironmentKey,
    )) {
      const pack = CREDIT_PACKS.find((candidate) => candidate.key === packKey);
      expect(pack, environmentKey).toBeTruthy();
      const expectation = STRIPE_PRICE_EXPECTATIONS[environmentKey];
      expect(expectation.type, environmentKey).toBe('one_time');
      expect(expectation.unitAmount, environmentKey).toBe(
        publishedCents(pack!.price),
      );
    }
  });

  it('uses a unique stable lookup key for every supported checkout product', () => {
    const lookupKeys = Object.values(STRIPE_PRICE_EXPECTATIONS).map(
      (expectation) => expectation.lookupKey,
    );
    expect(new Set(lookupKeys).size).toBe(lookupKeys.length);
  });
});
