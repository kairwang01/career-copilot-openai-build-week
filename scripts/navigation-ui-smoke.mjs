/**
 * Navigation UI smoke test.
 *
 * Runs against Firebase emulators. It locks the cross-shell navigation class:
 * candidate workspace sidebar/drawer, employer portal sidebar/drawer, and the
 * admin console sidebar/mobile select all remain clickable and route to the
 * expected in-app view without horizontal overflow or console errors.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { configureFirebaseScript } from './lib/firebase-script-safety.mjs';
import { isNonBlockingSmokeConsoleError } from './lib/smoke-console-filters.mjs';

const firebaseTarget = configureFirebaseScript({ scriptName: 'navigation-ui-smoke' });

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = process.env.NAVIGATION_SMOKE_BASE_URL || 'http://127.0.0.1:4181';
const PASSWORD = 'QaSeed!2026';
const CANDIDATE_EMAIL = 'candidate@careercopilot.test';
const EMPLOYER_EMAIL = 'employer@careercopilot.test';
const ADMIN_EMAIL = 'admin-candidate@careercopilot.test';
const ARTIFACT_DIR = `${ROOT}/output/playwright`;
const TOOL_KEYS = [
  'opportunity-finder',
  'cover-letter',
  'interview-prep',
  'mock-interview',
  'resume-formatter',
  'career-path',
  'website-builder',
  'skill-learning-plan',
  'performance-review-prep',
  'salary-negotiation',
  'linkedin-optimizer',
  'networking-assistant',
  'industry-event-scout',
  'email-crafter',
  'english-pro',
  'agile-coach',
];

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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
    [resolve(ROOT, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '4181', '--strictPort'],
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

async function screenshot(page, name) {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  await page.screenshot({ path: `${ARTIFACT_DIR}/${name}.png`, fullPage: true });
}

async function assertNoOverflow(page, label) {
  const overflowX = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
  assert(overflowX === 0, `${label}: horizontal overflow ${overflowX}px`);
}

function attachConsoleCollector(page) {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isNonBlockingSmokeConsoleError(msg.text())) errors.push(msg.text());
  });
  return errors;
}

async function signIn(page, email, path = '/workspace?auth=signin') {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').waitFor({ timeout: 20_000 });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
}

async function assertToolkitLibrary(page, label = 'candidate toolkit') {
  await page.locator('[data-qa="toolkit-card-website-builder"]').waitFor({ timeout: 20_000 });
  const visibleToolCards = await page.locator('[data-qa^="toolkit-card-"]').count();
  assert(visibleToolCards >= TOOL_KEYS.length, `${label}: expected at least ${TOOL_KEYS.length} tool cards, got ${visibleToolCards}`);
}

async function assertToolkitToolLaunches(page) {
  for (const toolKey of TOOL_KEYS) {
    await page.locator(`[data-qa="toolkit-card-${toolKey}"]`).click();
    await page.locator(`[data-qa="toolkit-active-tool"][data-qa-tool="${toolKey}"]`).waitFor({ timeout: 20_000 });

    if (toolKey === 'mock-interview') {
      await page.locator('[data-qa="interview-simulator"]').waitFor({ timeout: 20_000 });
    } else {
      await page.locator(`[data-qa="tool-runner"][data-qa-tool="${toolKey}"]`).waitFor({ timeout: 20_000 });
      await page.locator('[data-qa="tool-loading-state"]').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
      const unavailable = await page.locator('[data-qa="tool-runner-unavailable"]').count();
      assert(unavailable === 0, `candidate toolkit ${toolKey}: rendered unavailable fallback`);
    }

    const recoverableErrors = await page.locator('[data-qa="recoverable-section-error"]').count();
    assert(recoverableErrors === 0, `candidate toolkit ${toolKey}: rendered recoverable error boundary`);
    await assertNoOverflow(page, `candidate toolkit ${toolKey}`);
    await page.locator('[data-qa="toolkit-back-to-library"]').click();
    await assertToolkitLibrary(page, `candidate toolkit return from ${toolKey}`);
  }
}

async function assertCandidateDesktop(browser) {
  const context = await browser.newContext({ viewport: { width: 1365, height: 820 } });
  const page = await context.newPage();
  const errors = attachConsoleCollector(page);
  try {
    await signIn(page, CANDIDATE_EMAIL);
    await page.locator('[data-qa-auth="signed-in"]').waitFor({ timeout: 30_000 });
    await page.locator('[data-qa-shell="candidate"]').waitFor({ timeout: 30_000 });
    await page.locator('[data-qa="candidate-sidebar"]').waitFor({ timeout: 20_000 });

    const views = [
      ['resume', '/workspace/resume'],
      ['talent_profile', '/workspace/talent-profile'],
      ['jobs', '/workspace/jobs'],
      ['applications', '/workspace/applications'],
      ['interview', '/workspace/interview'],
      ['plan', '/workspace/career-plan'],
      ['portfolio', '/workspace/portfolio'],
      ['billing', '/workspace/billing'],
      ['toolkit', '/workspace/tools'],
      ['account', '/workspace/account'],
    ];

    for (const [view, path] of views) {
      await page.locator(`[data-qa="candidate-sidebar"] [data-qa="candidate-nav-${view}"]`).click();
      await page.locator(`[data-qa-workspace-view="${view}"]`).waitFor({ timeout: 20_000 });
      assert(page.url().includes(path), `candidate ${view}: expected URL to include ${path}, got ${page.url()}`);
      if (view === 'toolkit') {
        await assertToolkitLibrary(page);
        await assertToolkitToolLaunches(page);
      }
      await assertNoOverflow(page, `candidate desktop ${view}`);
    }

    assert(errors.length === 0, `candidate desktop console errors:\n${errors.join('\n')}`);
    console.log('  ✓ candidate desktop sidebar navigation');
  } catch (error) {
    await screenshot(page, 'navigation-candidate-desktop');
    throw error;
  } finally {
    await context.close();
  }
}

async function assertCandidateMobile(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await context.newPage();
  const errors = attachConsoleCollector(page);
  try {
    await signIn(page, CANDIDATE_EMAIL);
    await page.locator('[data-qa-auth="signed-in"]').waitFor({ timeout: 30_000 });
    await page.locator('[data-qa-shell="candidate"]').waitFor({ timeout: 30_000 });
    await page.locator('[data-qa="candidate-mobile-nav-open"]').click();
    await page.locator('[data-qa="candidate-mobile-nav-drawer"]').waitFor({ timeout: 10_000 });
    await page.locator('[data-qa="candidate-mobile-sidebar"] [data-qa="candidate-nav-applications"]').click();
    await page.locator('[data-qa-workspace-view="applications"]').waitFor({ timeout: 20_000 });
    await page.locator('[data-qa="candidate-mobile-nav-drawer"]').waitFor({ state: 'detached', timeout: 10_000 });
    await assertNoOverflow(page, 'candidate mobile applications');

    assert(errors.length === 0, `candidate mobile console errors:\n${errors.join('\n')}`);
    console.log('  ✓ candidate mobile drawer navigation');
  } catch (error) {
    await screenshot(page, 'navigation-candidate-mobile');
    throw error;
  } finally {
    await context.close();
  }
}

async function signInEmployer(page) {
  await signIn(page, EMPLOYER_EMAIL);
  await page.locator('[data-qa-auth="signed-in"]').waitFor({ timeout: 30_000 });
  await page.goto(`${BASE_URL}/portal`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-qa-shell="employer"]').waitFor({ timeout: 30_000 });
}

async function assertEmployerDesktop(browser) {
  const context = await browser.newContext({ viewport: { width: 1365, height: 820 } });
  const page = await context.newPage();
  const errors = attachConsoleCollector(page);
  try {
    await signInEmployer(page);
    await page.locator('[data-qa="employer-sidebar"]').waitFor({ timeout: 20_000 });

    const pages = ['post-job', 'job-listings', 'talent-pool', 'shortlist', 'agency-hub', 'company-profile', 'billing', 'account-settings'];
    for (const portalPage of pages) {
      const selector = portalPage === 'account-settings'
        ? '[data-qa="employer-nav-account-settings"]'
        : `[data-qa="employer-nav-${portalPage}"]`;
      await page.locator(`[data-qa="employer-sidebar"] ${selector}`).click();
      await page.locator(`[data-qa-employer-page="${portalPage}"]`).waitFor({ timeout: 25_000 });
      await assertNoOverflow(page, `employer desktop ${portalPage}`);
    }

    assert(errors.length === 0, `employer desktop console errors:\n${errors.join('\n')}`);
    console.log('  ✓ employer desktop sidebar navigation');
  } catch (error) {
    await screenshot(page, 'navigation-employer-desktop');
    throw error;
  } finally {
    await context.close();
  }
}

async function assertEmployerMobile(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await context.newPage();
  const errors = attachConsoleCollector(page);
  try {
    await signInEmployer(page);
    await page.locator('[data-qa="employer-mobile-nav-open"]').click();
    await page.locator('[data-qa="employer-mobile-nav-drawer"]').waitFor({ timeout: 10_000 });
    await page.locator('[data-qa="employer-mobile-sidebar"] [data-qa="employer-nav-job-listings"]').click();
    await page.locator('[data-qa-employer-page="job-listings"]').waitFor({ timeout: 25_000 });
    await page.locator('[data-qa="employer-mobile-nav-drawer"]').waitFor({ state: 'detached', timeout: 10_000 });
    await assertNoOverflow(page, 'employer mobile job listings');

    assert(errors.length === 0, `employer mobile console errors:\n${errors.join('\n')}`);
    console.log('  ✓ employer mobile drawer navigation');
  } catch (error) {
    await screenshot(page, 'navigation-employer-mobile');
    throw error;
  } finally {
    await context.close();
  }
}

async function assertAdminDesktop(browser) {
  const context = await browser.newContext({ viewport: { width: 1365, height: 820 } });
  const page = await context.newPage();
  const errors = attachConsoleCollector(page);
  try {
    await signIn(page, ADMIN_EMAIL, '/admin');
    await page.locator('[data-qa-shell="admin"]').waitFor({ timeout: 30_000 });
    await page.locator('[data-qa-admin-tab="dashboard"]').waitFor({ timeout: 30_000 });

    for (const tab of ['users', 'quotas', 'prompts', 'audit', 'dashboard']) {
      await page.locator(`[data-qa="admin-nav-${tab}"]`).click();
      await page.locator(`[data-qa-admin-tab="${tab}"]`).waitFor({ timeout: 25_000 });
      await assertNoOverflow(page, `admin desktop ${tab}`);
    }

    assert(errors.length === 0, `admin desktop console errors:\n${errors.join('\n')}`);
    console.log('  ✓ admin desktop tab navigation');
  } catch (error) {
    await screenshot(page, 'navigation-admin-desktop');
    throw error;
  } finally {
    await context.close();
  }
}

async function assertAdminMobile(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await context.newPage();
  const errors = attachConsoleCollector(page);
  try {
    await signIn(page, ADMIN_EMAIL, '/admin');
    await page.locator('[data-qa-shell="admin"]').waitFor({ timeout: 30_000 });
    await page.locator('[data-qa="admin-mobile-section-select"]').selectOption('users');
    await page.locator('[data-qa-admin-tab="users"]').waitFor({ timeout: 25_000 });
    await page.locator('[data-qa="admin-mobile-section-select"]').selectOption('audit');
    await page.locator('[data-qa-admin-tab="audit"]').waitFor({ timeout: 25_000 });
    await assertNoOverflow(page, 'admin mobile select');

    assert(errors.length === 0, `admin mobile console errors:\n${errors.join('\n')}`);
    console.log('  ✓ admin mobile select navigation');
  } catch (error) {
    await screenshot(page, 'navigation-admin-mobile');
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
      await assertCandidateDesktop(browser);
      await assertCandidateMobile(browser);
      await assertEmployerDesktop(browser);
      await assertEmployerMobile(browser);
      await assertAdminDesktop(browser);
      await assertAdminMobile(browser);
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
