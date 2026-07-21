/**
 * Account profile save smoke test.
 *
 * Locks the class where the Account UI shows a success state before the
 * profile write has actually persisted. Runs only against Firebase emulators.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { configureFirebaseScript } from './lib/firebase-script-safety.mjs';
import { isNonBlockingSmokeConsoleError } from './lib/smoke-console-filters.mjs';

const firebaseTarget = configureFirebaseScript({ scriptName: 'account-profile-smoke' });

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = process.env.ACCOUNT_PROFILE_SMOKE_BASE_URL || 'http://127.0.0.1:4184';
const PASSWORD = 'QaSeed!2026';
const CANDIDATE_EMAIL = 'candidate@careercopilot.test';
const PROJECT_ID = firebaseTarget.projectId;
const ARTIFACT_DIR = `${ROOT}/output/playwright`;

const viteEnv = {
  ...process.env,
  VITE_FIREBASE_API_KEY: process.env.VITE_FIREBASE_API_KEY || 'demo-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: process.env.VITE_FIREBASE_AUTH_DOMAIN || 'demo-careercopilot.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: process.env.VITE_FIREBASE_PROJECT_ID || PROJECT_ID,
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
    [resolve(ROOT, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '4184', '--strictPort'],
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function collectAccountState(page) {
  return page.evaluate(() => ({
    url: window.location.href,
    buttonText: [...document.querySelectorAll('button')].map((button) => button.textContent?.trim()).filter(Boolean),
    noticeText: document.querySelector('[data-qa="account-profile-notice"]')?.textContent?.trim() || null,
    activeElement: document.activeElement?.tagName || null,
  }));
}

async function screenshot(page, name) {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  await page.screenshot({ path: `${ARTIFACT_DIR}/${name}.png`, fullPage: true });
}

async function signInCandidate(page) {
  await page.goto(`${BASE_URL}/workspace?auth=signin`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').waitFor({ timeout: 20_000 });
  await page.locator('input[type="email"]').fill(CANDIDATE_EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.locator('[data-qa-auth="signed-in"]').waitFor({ timeout: 30_000 });
  await page.locator('[data-qa-shell="candidate"]').waitFor({ timeout: 30_000 });
}

async function assertAccountProfileSave(browser, db, uid) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isNonBlockingSmokeConsoleError(msg.text())) consoleErrors.push(msg.text());
  });

  const fullName = `Casey Runtime ${Date.now()}`;
  const birthDate = '1999-04-08';

  try {
    await signInCandidate(page);
    await page.locator('[data-qa="candidate-nav-account"]').click();
    await page.getByRole('heading', { name: /settings/i }).waitFor({ timeout: 20_000 });
    await page.locator('#fullName').fill(fullName);
    await page.locator('#birthDate').fill(birthDate);
    await page.getByRole('button', { name: /^save$/i }).click();
    await page.locator('[data-qa="account-profile-notice"]').filter({ hasText: /profile updated/i }).waitFor({ timeout: 20_000 });

    const profile = await db.collection('users').doc(uid).get();
    assert(profile.get('full_name') === fullName, `Firestore full_name did not persist: ${profile.get('full_name')}`);
    assert(profile.get('birth_date') === birthDate, `Firestore birth_date did not persist: ${profile.get('birth_date')}`);
    assert(Boolean(profile.get('updated_at')), 'Firestore updated_at missing after profile save');

    if (consoleErrors.length) {
      throw new Error(`Console errors during account profile smoke:\n${consoleErrors.join('\n')}`);
    }

    console.log('  ✓ account profile save persisted to Firestore');
  } catch (error) {
    console.error('Account smoke page state:', await collectAccountState(page));
    if (consoleErrors.length) {
      console.error(`Console errors during account profile smoke:\n${consoleErrors.join('\n')}`);
    }
    await screenshot(page, 'account-profile-save');
    throw error;
  } finally {
    await context.close();
  }
}

async function main() {
  await run((process.env.NODE_BINARY || 'node'), ['scripts/seed-emulator.mjs']);

  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
  const auth = admin.auth();
  const db = admin.firestore();
  const candidate = await auth.getUserByEmail(CANDIDATE_EMAIL);
  await db.collection('users').doc(candidate.uid).set(
    {
      role: 'candidate',
      full_name: 'Casey Candidate',
      birth_date: null,
      updated_at: new Date().toISOString(),
    },
    { merge: true },
  );

  const vite = startVite();
  try {
    await waitForServer(BASE_URL);
    const browser = await chromium.launch({ headless: true });
    try {
      await assertAccountProfileSave(browser, db, candidate.uid);
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
