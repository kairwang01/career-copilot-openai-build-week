import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const STAGE = process.env.E2E_STAGE_DIR;
if (!STAGE || !isAbsolute(STAGE) || !existsSync(join(STAGE, 'index.html'))) {
  throw new Error(
    'E2E_STAGE_DIR must be an absolute path to a built release stage containing index.html.',
  );
}

const PORT = Number(process.env.E2E_ARTIFACT_PORT || 5180);
const evidenceDir = process.env.RELEASE_GATE_RESULTS;

export default defineConfig({
  testDir: './e2e/release',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  forbidOnly: true,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: evidenceDir
    ? [
        ['list'],
        ['junit', { outputFile: join(evidenceDir, 'artifact-playwright.xml') }],
      ]
    : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'tablet-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'narrow-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 800 } },
    },
  ],
  webServer: {
    command: 'node static-server.mjs',
    url: `http://127.0.0.1:${PORT}`,
    timeout: 60_000,
    reuseExistingServer: false,
    env: {
      HOST: '127.0.0.1',
      PORT: String(PORT),
      STATIC_ROOT: STAGE,
    },
  },
});
