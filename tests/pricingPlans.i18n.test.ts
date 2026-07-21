import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  jobseekerPlans,
  employerPlans,
  planKey,
} from '../marketing/config/pricingPlans';

/**
 * Guards the class of bug fixed in 09946be: a plan's declared `featureCount`
 * must have a matching `site_plan_<id>_fN` i18n key for every N — otherwise the
 * pricing card renders a broken/blank feature row (marketing t() only falls back
 * to English at the file level, not per key). Also checks name/price/desc exist.
 * Runs against en.json (the authoritative key set; other locales fall back to it).
 */
const en = JSON.parse(
  readFileSync(new URL('../localization/en.json', import.meta.url), 'utf8'),
) as Record<string, string>;

const allPlans = [...jobseekerPlans, ...employerPlans];

describe('pricing plan i18n keys are complete', () => {
  for (const plan of allPlans) {
    it(`${plan.id}: name/price/desc + ${plan.featureCount} feature keys exist`, () => {
      for (const field of ['name', 'price', 'desc'] as const) {
        const key = planKey(plan.id, field);
        expect(en[key], `missing i18n key ${key}`).toBeTruthy();
      }
      for (let i = 1; i <= plan.featureCount; i++) {
        const key = planKey(plan.id, `f${i}` as `f${number}`);
        expect(
          en[key],
          `missing ${key} — featureCount=${plan.featureCount} but this feature key is absent (would render a blank/raw row)`,
        ).toBeTruthy();
      }
    });
  }
});
