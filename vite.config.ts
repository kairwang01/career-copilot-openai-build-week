import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {
  defineConfig,
  loadEnv,
  type ConfigEnv,
  type UserConfig,
} from 'vite';

export const REQUIRED_PRODUCTION_ENV_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_FUNCTIONS_REGION',
] as const;

const EMULATOR_ENV_KEYS = [
  'VITE_FIREBASE_USE_EMULATOR',
  'VITE_FIREBASE_AUTH_EMULATOR_URL',
  'VITE_FIRESTORE_EMULATOR_HOST',
  'VITE_FIRESTORE_EMULATOR_PORT',
  'VITE_FIREBASE_FUNCTIONS_EMULATOR_HOST',
  'VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT',
  'VITE_FIREBASE_STORAGE_EMULATOR_HOST',
  'VITE_FIREBASE_STORAGE_EMULATOR_PORT',
] as const;

const SERVER_SECRET_ENV_NAME =
  /(?:SECRET|PRIVATE(?:_KEY)?|PASSWORD|SERVICE_ACCOUNT|GEMINI|OPENAI|ANTHROPIC)/i;
const SERVER_SECRET_VALUE =
  /(?:^|[^a-z0-9])(?:sk|rk)_(?:live|test|prod)_[a-z0-9_-]+|-----BEGIN [A-Z ]*PRIVATE KEY-----/i;
const PLACEHOLDER_VALUE =
  /(?:^|[-_.])demo(?:$|[-_.])|your[-_]|replace(?:[-_]with)?|change[-_]?me|placeholder|example\.(?:com|net|org)|<[^>]+>|\.\.\./i;

type PublicBuildEnv = Record<string, string | undefined>;

export function releaseManualChunk(moduleId: string): string | undefined {
  const id = moduleId.replaceAll('\\', '/');
  if (!id.includes('/node_modules/')) return undefined;

  if (/\/node_modules\/(?:react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) {
    return 'react';
  }
  if (
    /\/node_modules\/(?:recharts|victory-vendor|react-redux|@reduxjs\/toolkit|redux|reselect|immer|decimal\.js-light|es-toolkit|eventemitter3|tiny-invariant|use-sync-external-store)\//.test(id)
  ) {
    return 'charts';
  }
  if (/\/node_modules\/(?:firebase|@firebase)\//.test(id)) return 'firebase';
  if (id.includes('/node_modules/pdfjs-dist/')) return 'pdf';
  if (id.includes('/node_modules/docx/')) return 'docx';
  if (id.includes('/node_modules/mammoth/')) return 'mammoth';
  return undefined;
}

function hasValue(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isHostname(value: string): boolean {
  return (
    value.length <= 253 &&
    !value.includes('://') &&
    value.split('.').every((label) =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
    )
  );
}

function isDeployableHostname(value: string): boolean {
  return (
    isHostname(value) &&
    value.includes('.') &&
    value.toLowerCase() !== 'localhost' &&
    !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)
  );
}

/**
 * Rejects client builds that would silently ship an unusable, demo-routed, or
 * secret-bearing production bundle. Error messages list variable names only.
 */
export function validateProductionBuildEnv(env: PublicBuildEnv): void {
  const errors: string[] = [];
  const missing = REQUIRED_PRODUCTION_ENV_KEYS.filter((key) => !hasValue(env[key]));

  if (missing.length > 0) {
    errors.push(`missing required variables: ${missing.join(', ')}`);
  }

  const placeholderKeys = REQUIRED_PRODUCTION_ENV_KEYS.filter((key) => {
    const value = env[key]?.trim();
    return Boolean(value && PLACEHOLDER_VALUE.test(value));
  });
  if (placeholderKeys.length > 0) {
    errors.push(`demo or placeholder values: ${placeholderKeys.join(', ')}`);
  }

  const emulatorKeys = EMULATOR_ENV_KEYS.filter((key) => {
    const value = env[key]?.trim();
    if (!value) return false;
    return key !== 'VITE_FIREBASE_USE_EMULATOR' || value.toLowerCase() !== 'false';
  });
  if (emulatorKeys.length > 0) {
    errors.push(`emulator routing is forbidden: ${emulatorKeys.join(', ')}`);
  }

  const publicSecretKeys = Object.entries(env)
    .filter(([key, value]) =>
      key.startsWith('VITE_') &&
      key !== 'VITE_FIREBASE_API_KEY' &&
      hasValue(value) &&
      (SERVER_SECRET_ENV_NAME.test(key) || SERVER_SECRET_VALUE.test(value)),
    )
    .map(([key]) => key)
    .sort();
  if (publicSecretKeys.length > 0) {
    errors.push(
      `server secrets must not use the VITE_ prefix: ${publicSecretKeys.join(', ')}`,
    );
  }

  const firebaseApiKey = env.VITE_FIREBASE_API_KEY?.trim();
  if (firebaseApiKey && !/^AIza[a-z0-9_-]{20,}$/i.test(firebaseApiKey)) {
    errors.push('VITE_FIREBASE_API_KEY is not a valid Firebase web API key');
  }

  const authDomain = env.VITE_FIREBASE_AUTH_DOMAIN?.trim();
  if (authDomain && !isDeployableHostname(authDomain)) {
    errors.push(
      'VITE_FIREBASE_AUTH_DOMAIN must be a deployable hostname without a URL scheme',
    );
  }

  const projectId = env.VITE_FIREBASE_PROJECT_ID?.trim();
  if (projectId && !/^[a-z][a-z0-9-]{5,29}$/.test(projectId)) {
    errors.push('VITE_FIREBASE_PROJECT_ID is not a valid Firebase project id');
  }

  const storageBucket = env.VITE_FIREBASE_STORAGE_BUCKET?.trim();
  if (storageBucket && !isDeployableHostname(storageBucket)) {
    errors.push('VITE_FIREBASE_STORAGE_BUCKET must be a deployable bucket hostname');
  }

  const senderId = env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim();
  if (senderId && !/^\d{6,20}$/.test(senderId)) {
    errors.push('VITE_FIREBASE_MESSAGING_SENDER_ID must contain digits only');
  }

  const appId = env.VITE_FIREBASE_APP_ID?.trim();
  if (appId && !/^1:\d+:web:[a-z0-9]+$/i.test(appId)) {
    errors.push('VITE_FIREBASE_APP_ID is not a valid Firebase web app id');
  }

  const functionsRegion = env.VITE_FIREBASE_FUNCTIONS_REGION?.trim();
  if (functionsRegion && !/^[a-z]+(?:-[a-z0-9]+)+$/.test(functionsRegion)) {
    errors.push('VITE_FIREBASE_FUNCTIONS_REGION is not a valid region name');
  }

  const stripeKey = env.VITE_STRIPE_PUBLISHABLE_KEY?.trim();
  if (
    stripeKey &&
    (!/^pk_(?:test|live)_[a-z0-9_]+$/i.test(stripeKey) ||
      PLACEHOLDER_VALUE.test(stripeKey))
  ) {
    errors.push(
      'VITE_STRIPE_PUBLISHABLE_KEY must be a non-placeholder pk_test_* or pk_live_* key',
    );
  }

  const sentryDsn = env.VITE_SENTRY_DSN?.trim();
  if (sentryDsn) {
    try {
      const parsed = new URL(sentryDsn);
      if (
        parsed.protocol !== 'https:' ||
        !parsed.hostname ||
        PLACEHOLDER_VALUE.test(sentryDsn)
      ) {
        throw new Error('invalid Sentry DSN');
      }
    } catch {
      errors.push('VITE_SENTRY_DSN must be a non-placeholder HTTPS URL');
    }
  }

  const tracesRate = env.VITE_SENTRY_TRACES_RATE?.trim();
  if (tracesRate) {
    const value = Number(tracesRate);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      errors.push('VITE_SENTRY_TRACES_RATE must be a number from 0 to 1');
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `[release-config] Refusing client build:\n- ${errors.join('\n- ')}`,
    );
  }
}

export function createViteConfig(
  configEnv: ConfigEnv,
  env: PublicBuildEnv,
): UserConfig {
  if (configEnv.command === 'build') {
    validateProductionBuildEnv(env);
  }

  return {
    appType: 'spa',
    base: '/',
    envPrefix: 'VITE_',
    server: {
      port: 3000,
      strictPort: true,
      host: '127.0.0.1',
      open: false,
      cors: false,
    },
    preview: {
      port: 4173,
      strictPort: true,
      host: '127.0.0.1',
      open: false,
      cors: false,
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      // Keep production sources and module graphs out of the public artifact.
      sourcemap: false,
      manifest: false,
      ssrManifest: false,
      minify: 'esbuild',
      // The candidate workspace and its tools are code-split (React.lazy), so the
      // only chunk over the default 500 kB is the isolated Firebase SDK chunk.
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          // Keep React in the entry dependency graph and route-only libraries in
          // their own chunks. Object-form chunks pulled React into Recharts and
          // forced a 390 kB charts preload on every public landing-page visit.
          // Rollup 4 must still merge transitive helpers to avoid circular chunks;
          // the function explicitly assigns React before route-only vendors.
          onlyExplicitManualChunks: false,
          manualChunks: releaseManualChunk,
        },
      },
    },
  };
}

export default defineConfig((configEnv) => {
  const env = loadEnv(configEnv.mode, __dirname, 'VITE_');
  return createViteConfig(configEnv, env);
});
