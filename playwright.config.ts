import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * SCRUM-42 — happy-path E2E (login → tool run → My Applications).
 *
 * Runs against the Firebase emulator suite with the LLM stub (E2E_LLM_STUB=true),
 * so a tool run is deterministic and free. The emulator + seed are started by the
 * `test:e2e` npm script (firebase emulators:exec); this config only owns the Vite
 * dev server, pointed at the emulator via env (existing process.env VITE_* vars take
 * priority over .env.local in Vite, so this overrides the prod Firebase config).
 */
const PORT = Number(process.env.E2E_WEB_PORT || 5176);
const evidenceDir = process.env.RELEASE_GATE_RESULTS;

const EMULATOR_ENV: Record<string, string> = {
  VITE_FIREBASE_USE_EMULATOR: 'true',
  VITE_FIREBASE_API_KEY: 'demo-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo-careercopilot.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo-careercopilot',
  VITE_FIREBASE_STORAGE_BUCKET: 'demo-careercopilot.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
  VITE_FIREBASE_APP_ID: '1:000000000000:web:demoe2e',
  VITE_FIREBASE_AUTH_EMULATOR_URL:
    process.env.VITE_FIREBASE_AUTH_EMULATOR_URL || 'http://127.0.0.1:9199',
  VITE_FIRESTORE_EMULATOR_HOST:
    process.env.VITE_FIRESTORE_EMULATOR_HOST || '127.0.0.1',
  VITE_FIRESTORE_EMULATOR_PORT:
    process.env.VITE_FIRESTORE_EMULATOR_PORT || '8080',
  VITE_FIREBASE_FUNCTIONS_EMULATOR_HOST:
    process.env.VITE_FIREBASE_FUNCTIONS_EMULATOR_HOST || '127.0.0.1',
  VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT:
    process.env.VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT || '5001',
};

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['release/**'],
  timeout: 90_000,
  expect: { timeout: 20_000 },
  forbidOnly: true,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: evidenceDir
    ? [
        ['list'],
        ['junit', { outputFile: join(evidenceDir, 'emulator-playwright.xml') }],
      ]
    : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    timeout: 120_000,
    reuseExistingServer: process.env.PW_REUSE_EXISTING_SERVER === '1',
    env: EMULATOR_ENV,
  },
});
