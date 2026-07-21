/**
 * Dialog positioning smoke test.
 *
 * Runs against Firebase emulators. It locks the ViewportAwareDialog bug class:
 *   1. centered auth dialogs stay inside the viewport on small screens,
 *   2. anchored Talent Profile dialogs stay attached to the trigger when space allows,
 *   3. anchored dialogs fall back to center when the usable viewport is too small,
 *   4. no checked viewport creates horizontal overflow.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { configureFirebaseScript } from './lib/firebase-script-safety.mjs';
import { isNonBlockingSmokeConsoleError } from './lib/smoke-console-filters.mjs';

const firebaseTarget = configureFirebaseScript({ scriptName: 'dialog-positioning-smoke' });

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = process.env.DIALOG_SMOKE_BASE_URL || 'http://127.0.0.1:4179';
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
    [resolve(ROOT, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '4179', '--strictPort'],
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

function roundedRect(rect) {
  return Object.fromEntries(
    Object.entries(rect).map(([key, value]) => [key, Math.round(Number(value))]),
  );
}

async function dialogMetrics(page, anchorLocator = null) {
  const anchor = anchorLocator ? await anchorLocator.elementHandle() : null;
  return page.evaluate((anchorElement) => {
    const panel = document.querySelector('[data-qa="viewport-aware-dialog"]');
    const root = document.documentElement;
    const toRect = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
      };
    };
    const panelRect = toRect(panel);
    const anchorRect = toRect(anchorElement);
    const placement = panel?.getAttribute('data-placement') || null;
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      panel: panelRect,
      anchor: anchorRect,
      placement,
      maxHeight: panel ? Number.parseFloat(getComputedStyle(panel).maxHeight) : null,
      overflowX: Math.max(0, root.scrollWidth - root.clientWidth),
    };
  }, anchor);
}

function assertPanelInViewport(metrics, label) {
  assert(metrics.panel, `${label}: dialog panel was not rendered`);
  const { viewport, panel } = metrics;
  assert(panel.top >= 15, `${label}: panel top escaped viewport (${JSON.stringify(roundedRect(panel))})`);
  assert(panel.left >= 15, `${label}: panel left escaped viewport (${JSON.stringify(roundedRect(panel))})`);
  assert(panel.right <= viewport.width - 15, `${label}: panel right escaped viewport (${JSON.stringify(roundedRect(panel))})`);
  assert(panel.bottom <= viewport.height - 15, `${label}: panel bottom escaped viewport (${JSON.stringify(roundedRect(panel))})`);
  assert(metrics.overflowX === 0, `${label}: page has horizontal overflow ${metrics.overflowX}px`);
}

function assertAnchorPlacement(metrics, label) {
  assert(metrics.anchor, `${label}: anchor rect missing`);
  if (metrics.placement === 'below') {
    assert(
      metrics.panel.top >= metrics.anchor.bottom + 10,
      `${label}: below dialog overlaps its trigger (${JSON.stringify({ panel: roundedRect(metrics.panel), anchor: roundedRect(metrics.anchor) })})`,
    );
  } else if (metrics.placement === 'above') {
    assert(
      metrics.panel.bottom <= metrics.anchor.top - 10,
      `${label}: above dialog overlaps its trigger (${JSON.stringify({ panel: roundedRect(metrics.panel), anchor: roundedRect(metrics.anchor) })})`,
    );
  } else {
    assert(metrics.placement === 'center', `${label}: unexpected placement ${metrics.placement}`);
  }
}

async function screenshot(page, name) {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  await page.screenshot({ path: `${ARTIFACT_DIR}/${name}.png`, fullPage: true });
}

async function assertAuthDialog(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    for (const size of [
      { width: 390, height: 560 },
      { width: 320, height: 560 },
      { width: 1440, height: 800 },
    ]) {
      await page.setViewportSize(size);
      await page.goto(`${BASE_URL}/workspace?auth=signin`, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-qa="viewport-aware-dialog"]').waitFor({ timeout: 20_000 });
      await page.waitForTimeout(150);
      const metrics = await dialogMetrics(page);
      assertPanelInViewport(metrics, `auth ${size.width}x${size.height}`);
      assert(metrics.placement === 'center', `auth ${size.width}x${size.height}: expected center placement`);
      console.log(`  ✓ auth dialog ${size.width}x${size.height} placement=${metrics.placement}`);
    }
  } catch (error) {
    await screenshot(page, 'dialog-positioning-auth');
    throw error;
  } finally {
    await context.close();
  }
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

async function assertTalentProfilePrefill(browser) {
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
      { width: 820, height: 800 },
      { width: 390, height: 800 },
      { width: 320, height: 800 },
      { width: 390, height: 560 },
      { width: 320, height: 560 },
      { width: 820, height: 560 },
    ]) {
      await page.setViewportSize(size);
      await page.goto(`${BASE_URL}/workspace/talent-profile`, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-qa-auth="signed-in"]').waitFor({ timeout: 30_000 });
      const trigger = page.getByRole('button', { name: /Prefill from my resume/i });
      await trigger.waitFor({ timeout: 20_000 });
      await trigger.evaluate((element) => element.scrollIntoView({ block: 'end', inline: 'nearest' }));
      await page.waitForTimeout(100);
      await trigger.click();
      await page.locator('[data-qa="viewport-aware-dialog"]').waitFor({ timeout: 10_000 });
      await page.waitForTimeout(200);

      const metrics = await dialogMetrics(page, trigger);
      assertPanelInViewport(metrics, `talent profile prefill ${size.width}x${size.height}`);
      assertAnchorPlacement(metrics, `talent profile prefill ${size.width}x${size.height}`);
      console.log(`  ✓ prefill dialog ${size.width}x${size.height} placement=${metrics.placement}`);

      await page.keyboard.press('Escape');
      await page.locator('[data-qa="viewport-aware-dialog"]').waitFor({ state: 'detached', timeout: 5_000 });
    }

    if (consoleErrors.length) {
      throw new Error(`Console errors during dialog smoke:\n${consoleErrors.join('\n')}`);
    }
  } catch (error) {
    await screenshot(page, 'dialog-positioning-talent-profile');
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
      await assertAuthDialog(browser);
      await assertTalentProfilePrefill(browser);
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
