import { afterEach, describe, expect, it, vi } from 'vitest';
import { SITE_ORIGIN, SITE_ROUTES } from '../config/site';
import { verificationActionUrl } from '../lib/auth/sendVerificationEmail';

describe('verification email action URL', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the canonical public origin outside a browser', () => {
    vi.stubGlobal('window', undefined);
    expect(verificationActionUrl()).toBe(`${SITE_ORIGIN}${SITE_ROUTES.authAction}`);
  });

  it('uses the active browser origin for local and preview environments', () => {
    vi.stubGlobal('window', { location: { origin: 'http://127.0.0.1:4173' } });
    expect(verificationActionUrl()).toBe(`http://127.0.0.1:4173${SITE_ROUTES.authAction}`);
  });

  it('does not trust an arbitrary browser origin for production email actions', () => {
    vi.stubGlobal('window', { location: { origin: 'https://lookalike.example' } });
    expect(verificationActionUrl()).toBe(`${SITE_ORIGIN}${SITE_ROUTES.authAction}`);
  });

  it('falls back to the canonical HTTPS origin when the runtime origin is malformed', () => {
    vi.stubGlobal('window', { location: { origin: 'not a valid origin' } });
    expect(verificationActionUrl()).toBe(`${SITE_ORIGIN}${SITE_ROUTES.authAction}`);
  });
});
