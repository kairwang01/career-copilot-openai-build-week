import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const privacy = readFileSync(new URL('../public/privacy.html', import.meta.url), 'utf8');

describe('customer-facing privacy disclosure', () => {
  it('discloses every optional or external production integration', () => {
    expect(privacy).toMatch(/configured AI provider/i);
    expect(privacy).toMatch(/Stripe/);
    expect(privacy).toMatch(/Sentry/);
    expect(privacy).toMatch(/only after you allow optional monitoring/i);
  });

  it('offers an equally accessible way to reset the optional-cookie choice', () => {
    expect(privacy).toContain('id="reset-consent"');
    expect(privacy).toContain('cookie_consent=;');
    expect(privacy).toMatch(/Reset optional-cookie choice/);
  });

  it('states the current retention and account-removal limits without implying full erasure', () => {
    expect(privacy).toMatch(/automatic retention schedule[^<]*not yet/i);
    expect(privacy).toMatch(/not full data erasure/i);
    expect(privacy).toMatch(/shared hiring records, financial and audit records, uploaded files, and Stripe records/i);
    expect(privacy).toMatch(/provide, correct, export, or delete account data/i);
  });

  it('discloses device-local drafts, private BYOA keys, and international processing', () => {
    expect(privacy).toMatch(/profile fields, job preferences, onboarding progress/i);
    expect(privacy).toMatch(/raw provider key is stored in a server-only credential record/i);
    expect(privacy).toMatch(/process information in\s+countries where they or their subprocessors operate/i);
    expect(privacy).toContain('<meta name="robots" content="index,follow" />');
  });
});
