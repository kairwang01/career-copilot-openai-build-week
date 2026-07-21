import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  pricingAudienceFromSearch,
  pricingSearchForAudience,
} from '../marketing/lib/pricingAudience';

describe('pricing audience state', () => {
  it('honours an explicit audience before the signed-in account default', () => {
    expect(pricingAudienceFromSearch('?audience=employer', false)).toBe('employer');
    expect(pricingAudienceFromSearch('?audience=jobseeker', true)).toBe('jobseeker');
  });

  it('opens the employer plans for a business upsell or business account', () => {
    expect(pricingAudienceFromSearch('?from=business-upsell', false)).toBe('employer');
    expect(pricingAudienceFromSearch('', true)).toBe('employer');
    expect(pricingAudienceFromSearch('', false)).toBe('jobseeker');
  });

  it('persists a visitor toggle in the URL without discarding checkout context', () => {
    const next = new URLSearchParams(
      pricingSearchForAudience('?checkout=cancel&from=business-upsell', 'jobseeker'),
    );

    expect(next.get('audience')).toBe('jobseeker');
    expect(next.get('checkout')).toBe('cancel');
    expect(next.get('from')).toBe('business-upsell');
  });

  it('exposes the two-option control as a pressed-state group', () => {
    const source = readFileSync(
      new URL('../marketing/pages/PricingPage.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('role="group"');
    expect(source).toContain('aria-pressed={audience === option}');
  });
});
