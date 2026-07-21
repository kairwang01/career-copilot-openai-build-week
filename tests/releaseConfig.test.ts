import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createViteConfig,
  releaseManualChunk,
  REQUIRED_PRODUCTION_ENV_KEYS,
  validateProductionBuildEnv,
} from '../vite.config';

const validEnv = {
  VITE_FIREBASE_API_KEY: 'AIzaSyD7ZPFakeButStructurallyPublicWebKey',
  VITE_FIREBASE_AUTH_DOMAIN: 'career-copilot-a3168.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'career-copilot-a3168',
  VITE_FIREBASE_STORAGE_BUCKET: 'career-copilot-a3168.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '123456789012',
  VITE_FIREBASE_APP_ID: '1:123456789012:web:abcdef0123456789',
  VITE_FIREBASE_FUNCTIONS_REGION: 'us-central1',
};

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { scripts: Record<string, string> };

describe('release build environment validation', () => {
  it('fails once with every missing required production variable and no values', () => {
    expect(() => validateProductionBuildEnv({})).toThrowError(
      new RegExp(REQUIRED_PRODUCTION_ENV_KEYS.join('.*')),
    );
  });

  it('accepts complete Firebase config and supported optional public integrations', () => {
    expect(() => validateProductionBuildEnv({
      ...validEnv,
      VITE_STRIPE_PUBLISHABLE_KEY: 'pk_live_51SafePublicBrowserKey',
      VITE_SENTRY_DSN: 'https://public-key@errors.careercopilot.example.ca/42',
      VITE_SENTRY_TRACES_RATE: '0.1',
    })).not.toThrow();
  });

  it('accepts an explicitly disabled emulator switch', () => {
    expect(() => validateProductionBuildEnv({
      ...validEnv,
      VITE_FIREBASE_USE_EMULATOR: 'false',
    })).not.toThrow();
  });

  it.each([
    [
      'demo Firebase project',
      { VITE_FIREBASE_PROJECT_ID: 'demo-careercopilot' },
      /demo or placeholder/i,
    ],
    [
      'placeholder API key',
      { VITE_FIREBASE_API_KEY: 'your_firebase_api_key_here' },
      /demo or placeholder/i,
    ],
    [
      'malformed Firebase API key',
      { VITE_FIREBASE_API_KEY: 'not-a-firebase-key' },
      /VITE_FIREBASE_API_KEY/i,
    ],
    [
      'loopback auth domain',
      { VITE_FIREBASE_AUTH_DOMAIN: '127.0.0.1' },
      /VITE_FIREBASE_AUTH_DOMAIN/i,
    ],
    [
      'emulator routing',
      { VITE_FIREBASE_USE_EMULATOR: 'true' },
      /emulator routing is forbidden/i,
    ],
    [
      'emulator endpoint even when the switch is absent',
      { VITE_FIRESTORE_EMULATOR_HOST: '127.0.0.1' },
      /emulator routing is forbidden/i,
    ],
    [
      'browser-prefixed Stripe secret',
      { VITE_STRIPE_SECRET_KEY: 'sk_live_never_ship_this' },
      /server secrets must not use the VITE_ prefix/i,
    ],
    [
      'browser-prefixed Gemini key',
      { VITE_GEMINI_API_KEY: 'server-only-key' },
      /server secrets must not use the VITE_ prefix/i,
    ],
    [
      'malformed Stripe public key',
      { VITE_STRIPE_PUBLISHABLE_KEY: 'sk_test_wrong_key_type' },
      /VITE_STRIPE_PUBLISHABLE_KEY/i,
    ],
    [
      'insecure Sentry endpoint',
      { VITE_SENTRY_DSN: 'http://public@example.invalid/1' },
      /VITE_SENTRY_DSN/i,
    ],
    [
      'invalid Sentry sampling rate',
      { VITE_SENTRY_TRACES_RATE: '1.5' },
      /VITE_SENTRY_TRACES_RATE/i,
    ],
  ])('rejects %s', (_label, override, expected) => {
    expect(() => validateProductionBuildEnv({ ...validEnv, ...override })).toThrowError(expected);
  });
});

describe('Vite release configuration', () => {
  it('keeps the React runtime separate from route-only chart code', () => {
    expect(releaseManualChunk('/repo/node_modules/react/index.js')).toBe('react');
    expect(releaseManualChunk('C:\\repo\\node_modules\\react-dom\\client.js')).toBe('react');
    expect(releaseManualChunk('/repo/node_modules/recharts/es6/index.js')).toBe('charts');
    expect(releaseManualChunk('/repo/node_modules/victory-vendor/es/d3-array.js')).toBe('charts');
    expect(releaseManualChunk('/repo/components/Dashboard.tsx')).toBeUndefined();
  });

  it('runs generated-content build gates without a nested package-manager dependency', () => {
    expect(packageJson.scripts.prebuild).toBe(
      'node scripts/sync-localization.mjs --check && node scripts/sync-api-docs.mjs --check',
    );
  });

  it('validates every build mode, including custom staging modes', () => {
    expect(() => createViteConfig({ command: 'build', mode: 'staging' }, {})).toThrowError(
      /missing required variables/i,
    );
  });

  it('keeps local serve usable without production credentials', () => {
    expect(() => createViteConfig({ command: 'serve', mode: 'development' }, {})).not.toThrow();
  });

  it('binds development and preview to loopback and emits no source maps', () => {
    const config = createViteConfig({ command: 'build', mode: 'production' }, validEnv);

    expect(config.base).toBe('/');
    expect(config.server).toMatchObject({
      host: '127.0.0.1',
      strictPort: true,
      cors: false,
      open: false,
    });
    expect(config.preview).toMatchObject({
      host: '127.0.0.1',
      strictPort: true,
      cors: false,
      open: false,
    });
    expect(config.build).toMatchObject({
      sourcemap: false,
      manifest: false,
      ssrManifest: false,
      minify: 'esbuild',
    });
  });
});
