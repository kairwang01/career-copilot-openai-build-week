/**
 * Auth routing smoke test for the SessionProvider migration.
 *
 * Runs only against Firebase emulators. The package script starts auth,
 * firestore, and functions emulators, then this script:
 *   1. seeds candidate / employer / admin-candidate accounts,
 *   2. starts Vite with emulator env vars,
 *   3. signs in through the real UI,
 *   4. asserts the product shell selected by CareerApp.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { configureFirebaseScript } from './lib/firebase-script-safety.mjs';
import { isNonBlockingSmokeConsoleError } from './lib/smoke-console-filters.mjs';

const firebaseTarget = configureFirebaseScript({ scriptName: 'auth-routing-smoke' });

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = process.env.AUTH_SMOKE_BASE_URL || 'http://127.0.0.1:4174';
const PASSWORD = 'QaSeed!2026';
const ARTIFACT_DIR = `${ROOT}/output/playwright`;

const viteEnv = {
  ...process.env,
  VITE_FIREBASE_API_KEY: process.env.VITE_FIREBASE_API_KEY || 'demo-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: process.env.VITE_FIREBASE_AUTH_DOMAIN || 'demo-careercopilot.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: firebaseTarget.projectId,
  VITE_FIREBASE_STORAGE_BUCKET: process.env.VITE_FIREBASE_STORAGE_BUCKET || 'demo-careercopilot.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '000000000000',
  VITE_FIREBASE_APP_ID: process.env.VITE_FIREBASE_APP_ID || '1:000000000000:web:demo',
  VITE_FIREBASE_FUNCTIONS_REGION: process.env.VITE_FIREBASE_FUNCTIONS_REGION || 'us-central1',
  VITE_FIREBASE_USE_EMULATOR: 'true',
  VITE_FIREBASE_AUTH_EMULATOR_URL: process.env.VITE_FIREBASE_AUTH_EMULATOR_URL || 'http://127.0.0.1:9199',
  VITE_FIRESTORE_EMULATOR_HOST: process.env.VITE_FIRESTORE_EMULATOR_HOST || '127.0.0.1',
  VITE_FIRESTORE_EMULATOR_PORT: process.env.VITE_FIRESTORE_EMULATOR_PORT || '8080',
  VITE_FIREBASE_FUNCTIONS_EMULATOR_HOST: process.env.VITE_FIREBASE_FUNCTIONS_EMULATOR_HOST || '127.0.0.1',
  VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT: process.env.VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT || '5001',
};

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
      ...options,
    });
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} failed with ${code ?? signal}`));
    });
  });
}

async function waitForServer(url, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // keep polling
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function startVite() {
  const child = spawn(
    process.env.NODE_BINARY || process.execPath,
    [resolve(ROOT, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '4174', '--strictPort'],
    {
      cwd: ROOT,
      env: viteEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout.on('data', (chunk) => process.stdout.write(`[vite] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`));
  return child;
}

async function signInAndAssertShell(browser, scenario) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isNonBlockingSmokeConsoleError(msg.text())) consoleErrors.push(msg.text());
  });
  try {
    await page.goto(`${BASE_URL}/workspace?auth=signin`, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').waitFor({ timeout: 15_000 });
    await page.locator('input[type="email"]').fill(scenario.email);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();

    await page.locator('[data-qa-auth="signed-in"]').waitFor({ timeout: 25_000 });
    await page.locator(`[data-qa-shell="${scenario.loginShell}"]`).waitFor({ timeout: 25_000 });
    if (scenario.targetPath) {
      await page.goto(`${BASE_URL}${scenario.targetPath}`, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-qa-auth="signed-in"]').waitFor({ timeout: 25_000 });
      await page.locator(`[data-qa-shell="${scenario.expectedShell}"]`).waitFor({ timeout: 25_000 });
      if (scenario.mustNotEnterPricing) {
        const current = new URL(page.url());
        if (current.pathname === '/pricing') {
          throw new Error(`${scenario.name} unexpectedly redirected to pricing: ${page.url()}`);
        }
      }
    }

    if (consoleErrors.length) {
      throw new Error(`${scenario.name} console errors:\n${consoleErrors.join('\n')}`);
    }
    console.log(`  ✓ ${scenario.name.padEnd(18)} shell=${scenario.expectedShell}`);
  } catch (error) {
    await mkdir(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: `${ARTIFACT_DIR}/auth-routing-${scenario.name}.png`, fullPage: true });
    throw error;
  } finally {
    await context.close();
  }
}

async function main() {
  await run((process.env.NODE_BINARY || 'node'), ['scripts/seed-emulator.mjs']);

  const vite = startVite();
  try {
    await waitForServer(BASE_URL);
    const browser = await chromium.launch({ headless: true });
    try {
      await signInAndAssertShell(browser, {
        name: 'candidate',
        email: 'candidate@careercopilot.test',
        loginShell: 'candidate',
        expectedShell: 'candidate',
      });
      await signInAndAssertShell(browser, {
        name: 'candidate-business-auth',
        email: 'candidate@careercopilot.test',
        loginShell: 'candidate',
        targetPath: '/portal?auth=signin',
        expectedShell: 'embedded',
        mustNotEnterPricing: true,
      });
      await signInAndAssertShell(browser, {
        name: 'employer',
        email: 'employer@careercopilot.test',
        loginShell: 'embedded',
        targetPath: '/portal',
        expectedShell: 'employer',
      });
      await signInAndAssertShell(browser, {
        name: 'pending-business',
        email: 'pending-business@careercopilot.test',
        loginShell: 'candidate',
        targetPath: '/portal',
        expectedShell: 'embedded',
      });
      await signInAndAssertShell(browser, {
        name: 'admin-candidate',
        email: 'admin-candidate@careercopilot.test',
        loginShell: 'candidate',
        expectedShell: 'candidate',
      });
    } finally {
      await browser.close();
    }
  } finally {
    vite.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
