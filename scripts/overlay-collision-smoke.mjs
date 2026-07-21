/**
 * Overlay collision smoke test.
 *
 * Runs against Firebase emulators. It locks the fixed-layer UI class where
 * cookie consent, Career Coach, and sticky workspace actions can hide primary
 * buttons on long candidate workspace pages.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { configureFirebaseScript } from './lib/firebase-script-safety.mjs';
import { isNonBlockingSmokeConsoleError } from './lib/smoke-console-filters.mjs';

const firebaseTarget = configureFirebaseScript({ scriptName: 'overlay-collision-smoke' });

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = process.env.OVERLAY_SMOKE_BASE_URL || 'http://127.0.0.1:4180';
const PASSWORD = 'QaSeed!2026';
const CANDIDATE_EMAIL = 'candidate@careercopilot.test';
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
    [resolve(ROOT, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '4180', '--strictPort'],
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

function roundRect(rect) {
  if (!rect) return null;
  return Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, Math.round(Number(value))]));
}

function overlapArea(a, b) {
  if (!a || !b) return 0;
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return Math.round(width * height);
}

async function collectMetrics(page) {
  return page.evaluate(() => {
    const toRect = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return {
        top: value.top,
        bottom: value.bottom,
        left: value.left,
        right: value.right,
        width: value.width,
        height: value.height,
      };
    };
    const rect = (selector) => toRect(document.querySelector(selector));
    const saveBar = document.querySelector('[data-qa="talent-profile-save-bar"]');
    const saveButton = saveBar
      ? [...saveBar.querySelectorAll('button')].find((button) => /save/i.test(button.textContent || ''))
      : null;
    const root = document.documentElement;
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      cookie: rect('[data-qa="cookie-consent-banner"]'),
      coach: rect('[data-qa="career-coach-launcher"]'),
      coachPanel: rect('[data-qa="career-coach-panel"]'),
      saveBar: rect('[data-qa="talent-profile-save-bar"]'),
      saveButton: toRect(saveButton),
      overflowX: Math.max(0, root.scrollWidth - root.clientWidth),
    };
  });
}

function assertInsideViewport(rect, viewport, label) {
  assert(rect, `${label}: missing`);
  assert(rect.top >= -1, `${label}: top outside viewport ${JSON.stringify(roundRect(rect))}`);
  assert(rect.left >= -1, `${label}: left outside viewport ${JSON.stringify(roundRect(rect))}`);
  assert(rect.right <= viewport.width + 1, `${label}: right outside viewport ${JSON.stringify(roundRect(rect))}`);
  assert(rect.bottom <= viewport.height + 1, `${label}: bottom outside viewport ${JSON.stringify(roundRect(rect))}`);
}

function assertNoOverlap(a, b, label, tolerance = 0) {
  const area = overlapArea(a, b);
  assert(area <= tolerance, `${label}: overlap area ${area}px (${JSON.stringify({ a: roundRect(a), b: roundRect(b) })})`);
}

function assertOverlayState(metrics, label) {
  assert(metrics.overflowX === 0, `${label}: horizontal overflow ${metrics.overflowX}px`);
  assertInsideViewport(metrics.cookie, metrics.viewport, `${label} cookie`);
  assertInsideViewport(metrics.coach, metrics.viewport, `${label} coach`);
  assertInsideViewport(metrics.saveBar, metrics.viewport, `${label} save bar`);
  assertInsideViewport(metrics.saveButton, metrics.viewport, `${label} save button`);
  if (metrics.viewport.width >= 640) {
    assert(metrics.cookie.height <= 96, `${label}: workspace cookie banner too tall ${JSON.stringify(roundRect(metrics.cookie))}`);
    assert(metrics.cookie.top <= 128, `${label}: workspace cookie banner should stay near the top edge ${JSON.stringify(roundRect(metrics.cookie))}`);
  }
  assertNoOverlap(metrics.cookie, metrics.coach, `${label} cookie/coach`);
  assertNoOverlap(metrics.cookie, metrics.saveBar, `${label} cookie/save bar`);
  assertNoOverlap(metrics.cookie, metrics.saveButton, `${label} cookie/save button`);
  assertNoOverlap(metrics.coach, metrics.saveBar, `${label} coach/save bar`);
  assertNoOverlap(metrics.coach, metrics.saveButton, `${label} coach/save button`);
}

function assertCoachPanelState(metrics, label) {
  assert(metrics.overflowX === 0, `${label}: horizontal overflow ${metrics.overflowX}px`);
  assert(!metrics.cookie, `${label}: cookie banner should be hidden while coach panel is open`);
  assertInsideViewport(metrics.coachPanel, metrics.viewport, `${label} coach panel`);
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

async function assertCandidateOverlays(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isNonBlockingSmokeConsoleError(msg.text())) consoleErrors.push(msg.text());
  });
  try {
    await signInCandidate(page);
    for (const size of [
      { width: 1440, height: 800 },
      { width: 1180, height: 800 },
      { width: 820, height: 800 },
      { width: 390, height: 800 },
      { width: 320, height: 640 },
    ]) {
      await page.setViewportSize(size);
      await page.goto(`${BASE_URL}/workspace/talent-profile`, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-qa-auth="signed-in"]').waitFor({ timeout: 30_000 });
      await page.locator('[data-qa="talent-profile-save-bar"]').waitFor({ timeout: 20_000 });
      await page.locator('[data-qa="cookie-consent-banner"]').waitFor({ timeout: 20_000 });
      await page.locator('[data-qa="career-coach-launcher"]').waitFor({ timeout: 20_000 });
      await page.waitForTimeout(200);
      const metrics = await collectMetrics(page);
      assertOverlayState(metrics, `candidate overlays ${size.width}x${size.height}`);
      console.log(`  ✓ candidate overlays ${size.width}x${size.height}`);

      await page.locator('[data-qa="career-coach-launcher"]').click();
      await page.locator('[data-qa="career-coach-panel"]').waitFor({ timeout: 20_000 });
      await page.waitForTimeout(200);
      const openMetrics = await collectMetrics(page);
      assertCoachPanelState(openMetrics, `candidate coach open ${size.width}x${size.height}`);
      console.log(`  ✓ candidate coach open ${size.width}x${size.height}`);
      await page.locator('[data-qa="career-coach-panel"] button').first().click();
      await page.locator('[data-qa="career-coach-panel"]').waitFor({ state: 'detached', timeout: 20_000 });
    }
    if (consoleErrors.length) {
      throw new Error(`Console errors during overlay smoke:\n${consoleErrors.join('\n')}`);
    }
  } catch (error) {
    await screenshot(page, 'overlay-collision-candidate');
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
      await assertCandidateOverlays(browser);
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
