import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveAppBaseUrl } from '../functions/src/handlers/stripeBilling';
import { refreshPlatformCaches } from '../functions/src/admin/platformConfig';
import * as adminApp from '../functions/node_modules/firebase-admin';

if (!adminApp.apps.length) {
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  adminApp.initializeApp({ projectId: 'demo-careercopilot' });
}
const fsdb = adminApp.firestore();

/**
 * Guards the fix for the reported bug: Stripe checkout/portal links returned the
 * user to a fixed env domain (career-copilot-a3168.web.app) instead of the site
 * they started from. resolveAppBaseUrl prefers the request origin when it's an
 * allow-listed host (canonical, project Firebase domains, configured customs, or
 * localhost), and falls back to canonical otherwise — never an open redirect.
 */
const ENV_KEYS = [
  'APP_BASE_URL', 'PUBLIC_APP_URL', 'WEB_APP_URL',
  'GCLOUD_PROJECT', 'GCP_PROJECT', 'ALLOWED_REDIRECT_ORIGINS',
];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.APP_BASE_URL = 'https://career-copilot-a3168.web.app';
  process.env.GCLOUD_PROJECT = 'career-copilot-a3168';
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const req = (origin?: string, referer?: string) => ({
  headers: { ...(origin ? { origin } : {}), ...(referer ? { referer } : {}) },
});

describe('resolveAppBaseUrl — checkout/return base URL', () => {
  it('returns the origin when it is the canonical host', () => {
    expect(resolveAppBaseUrl(req('https://career-copilot-a3168.web.app')))
      .toBe('https://career-copilot-a3168.web.app');
  });

  it('returns the origin for the project firebaseapp.com domain (the reported case)', () => {
    expect(resolveAppBaseUrl(req('https://career-copilot-a3168.firebaseapp.com')))
      .toBe('https://career-copilot-a3168.firebaseapp.com');
  });

  it('returns an allow-listed custom domain from ALLOWED_REDIRECT_ORIGINS', () => {
    process.env.ALLOWED_REDIRECT_ORIGINS = 'https://app.careercopilot.com, https://careers.example.com';
    expect(resolveAppBaseUrl(req('https://careers.example.com')))
      .toBe('https://careers.example.com');
  });

  it('allows localhost in dev', () => {
    expect(resolveAppBaseUrl(req('http://localhost:5174'))).toBe('http://localhost:5174');
  });

  it('falls back to canonical for a non-allow-listed origin (no open redirect)', () => {
    expect(resolveAppBaseUrl(req('https://evil.example.com')))
      .toBe('https://career-copilot-a3168.web.app');
  });

  it('derives the origin from Referer when the Origin header is absent', () => {
    expect(resolveAppBaseUrl(req(undefined, 'https://career-copilot-a3168.firebaseapp.com/pricing?x=1')))
      .toBe('https://career-copilot-a3168.firebaseapp.com');
  });

  it('falls back to canonical when there is no origin or referer', () => {
    expect(resolveAppBaseUrl(req())).toBe('https://career-copilot-a3168.web.app');
  });
});

describe('resolveAppBaseUrl — Firestore canonical (platform_config/app)', () => {
  afterEach(async () => {
    await fsdb.collection('platform_config').doc('app').delete().catch(() => {});
    await refreshPlatformCaches();
  });

  it('allow-lists the Firestore canonical host so a request from it returns to it', async () => {
    delete process.env.APP_BASE_URL;
    process.env.GCLOUD_PROJECT = 'career-copilot-a3168';
    await fsdb.collection('platform_config').doc('app').set({ app_base_url: 'https://copilot.kairwang.cloud' });
    await refreshPlatformCaches();
    expect(resolveAppBaseUrl(req('https://copilot.kairwang.cloud'))).toBe('https://copilot.kairwang.cloud');
  });

  it('falls back to the Firestore canonical for a non-allow-listed origin', async () => {
    delete process.env.APP_BASE_URL;
    await fsdb.collection('platform_config').doc('app').set({ app_base_url: 'https://copilot.kairwang.cloud' });
    await refreshPlatformCaches();
    expect(resolveAppBaseUrl(req('https://evil.example.com'))).toBe('https://copilot.kairwang.cloud');
  });
});
