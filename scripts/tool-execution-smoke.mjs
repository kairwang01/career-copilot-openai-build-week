/**
 * Tool execution smoke test.
 *
 * Runs against Firebase emulators with E2E_LLM_STUB=true. It drives real browser
 * flows from toolkit card -> input form -> callable -> result surface for a small
 * representative set of candidate tools, without touching a live LLM provider.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { configureFirebaseScript } from './lib/firebase-script-safety.mjs';
import { isNonBlockingSmokeConsoleError } from './lib/smoke-console-filters.mjs';

const firebaseTarget = configureFirebaseScript({ scriptName: 'tool-execution-smoke' });

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ID = firebaseTarget.projectId;
const BASE_URL = process.env.TOOL_EXECUTION_SMOKE_BASE_URL || 'http://127.0.0.1:4183';
const PASSWORD = 'QaSeed!2026';
const CANDIDATE_EMAIL = 'candidate@careercopilot.test';
const CANDIDATE_SEED_CREDITS = 5000;
const ARTIFACT_DIR = `${ROOT}/output/playwright`;
const AUTH_EMULATOR_URL = process.env.VITE_FIREBASE_AUTH_EMULATOR_URL || 'http://127.0.0.1:9199';
const SMOKED_TOOL_KEYS = [
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
const ONLY_TOOL = (process.env.TOOL_SMOKE_ONLY || '').trim();

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
  VITE_FIREBASE_AUTH_EMULATOR_URL: AUTH_EMULATOR_URL,
  VITE_FIRESTORE_EMULATOR_HOST: process.env.VITE_FIRESTORE_EMULATOR_HOST || '127.0.0.1',
  VITE_FIRESTORE_EMULATOR_PORT: process.env.VITE_FIRESTORE_EMULATOR_PORT || '8080',
  VITE_FIREBASE_FUNCTIONS_EMULATOR_HOST: process.env.VITE_FIREBASE_FUNCTIONS_EMULATOR_HOST || '127.0.0.1',
  VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT: process.env.VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT || '5001',
  VITE_FIREBASE_STORAGE_EMULATOR_HOST: process.env.VITE_FIREBASE_STORAGE_EMULATOR_HOST,
  VITE_FIREBASE_STORAGE_EMULATOR_PORT: process.env.VITE_FIREBASE_STORAGE_EMULATOR_PORT,
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectedToolKeysFromConfig() {
  const source = readFileSync(`${ROOT}/constants/tools.tsx`, 'utf8');
  const keys = [...source.matchAll(/key:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
  assert(keys.length > 0, 'tool inventory: no tool keys found in constants/tools.tsx');
  assert(new Set(keys).size === keys.length, 'tool inventory: duplicate tool keys found in constants/tools.tsx');
  return keys;
}

function assertToolSmokeCoverage() {
  const expected = expectedToolKeysFromConfig();
  const smoked = new Set(SMOKED_TOOL_KEYS);
  const missing = expected.filter((key) => !smoked.has(key));
  const stale = SMOKED_TOOL_KEYS.filter((key) => !expected.includes(key));
  assert(missing.length === 0, `tool inventory: missing smoke coverage for ${missing.join(', ')}`);
  assert(stale.length === 0, `tool inventory: smoke covers removed tool keys ${stale.join(', ')}`);
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
  const url = new URL(BASE_URL);
  const child = spawn(
    process.env.NODE_BINARY || process.execPath,
    [resolve(ROOT, 'node_modules/vite/bin/vite.js'), '--host', url.hostname, '--port', url.port || '4183', '--strictPort'],
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

function adminApp() {
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
  return admin.app();
}

async function seedCandidate() {
  await run((process.env.NODE_BINARY || 'node'), ['scripts/seed-emulator.mjs']);
  adminApp();
  const user = await admin.auth().getUserByEmail(CANDIDATE_EMAIL);
  const toolResults = await admin.firestore().collection('users').doc(user.uid).collection('tool_results').get();
  await Promise.all(toolResults.docs.map((doc) => doc.ref.delete()));
  const portfolios = await admin.firestore().collection('users').doc(user.uid).collection('portfolios').get();
  await Promise.all(portfolios.docs.map((doc) => doc.ref.delete()));
  const jobOpportunities = await admin.firestore().collection('users').doc(user.uid).collection('job_opportunities').get();
  await Promise.all(jobOpportunities.docs.map((doc) => doc.ref.delete()));
  await admin.firestore().collection('portfolio_drafts').doc(user.uid).delete().catch(() => {});
  await admin.firestore().collection('users').doc(user.uid).set(
    {
      credits: CANDIDATE_SEED_CREDITS,
      subscription_status: 'essentials',
      resume_text:
        'Casey Candidate - Frontend Engineer\n\nEXPERIENCE\nFrontend Engineer: React, TypeScript, accessibility, product collaboration, API integration.\n\nPROJECTS\nCareer CoPilot: built candidate workspace tools and application tracking.',
      updated_at: new Date().toISOString(),
    },
    { merge: true },
  );
  await admin.firestore().collection('users').doc(user.uid).update({
    job_preferences: admin.firestore.FieldValue.delete(),
  }).catch(() => {});
}

async function candidateUid() {
  const user = await admin.auth().getUserByEmail(CANDIDATE_EMAIL);
  return user.uid;
}

async function signInCandidate(page) {
  await page.goto(`${BASE_URL}/workspace?auth=signin`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').waitFor({ timeout: 20_000 });
  await page.locator('input[type="email"]').fill(CANDIDATE_EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.locator('[data-qa-auth="signed-in"]').waitFor({ timeout: 30_000 });
  await page.locator('[data-qa-shell="candidate"]').waitFor({ timeout: 30_000 });
  await page.waitForFunction((minimumCredits) => {
    const credits = document.querySelector('[data-tour="credits"]')?.textContent || '';
    const numericCredits = Number((credits.match(/[\d,]+/)?.[0] || '').replace(/,/g, ''));
    return numericCredits >= minimumCredits;
  }, CANDIDATE_SEED_CREDITS, { timeout: 30_000 });
}

async function assertNoOverflow(page, label) {
  const overflowX = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
  assert(overflowX === 0, `${label}: horizontal overflow ${overflowX}px`);
}

async function assertNoToolCrash(page, label) {
  const errors = await page.locator('[data-qa="recoverable-section-error"], [data-qa="tool-runner-unavailable"]').count();
  assert(errors === 0, `${label}: tool crash/unavailable fallback rendered`);
}

async function openTool(page, toolKey) {
  await page.goto(`${BASE_URL}/workspace/tools`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-qa-workspace-view="toolkit"]').waitFor({ timeout: 30_000 });
  await page.locator(`[data-qa="toolkit-card-${toolKey}"]`).click();
  await page.locator(`[data-qa="toolkit-active-tool"][data-qa-tool="${toolKey}"]`).waitFor({ timeout: 20_000 });
  if (toolKey === 'mock-interview') {
    await page.locator('[data-qa="interview-simulator"]').waitFor({ timeout: 20_000 });
  } else {
    await page.locator(`[data-qa="tool-runner"][data-qa-tool="${toolKey}"]`).waitFor({ timeout: 20_000 });
  }
  await assertNoToolCrash(page, toolKey);
}

async function assertToolkitInventory(page) {
  const expected = expectedToolKeysFromConfig();
  await page.goto(`${BASE_URL}/workspace/tools`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-qa-workspace-view="toolkit"]').waitFor({ timeout: 30_000 });

  for (const toolKey of expected) {
    await page.locator(`[data-qa="toolkit-card-${toolKey}"]`).waitFor({ timeout: 10_000 });
  }

  const rendered = await page.locator('[data-qa^="toolkit-card-"]').evaluateAll((nodes) =>
    nodes
      .map((node) => node.getAttribute('data-qa')?.replace(/^toolkit-card-/, ''))
      .filter(Boolean),
  );
  const missing = expected.filter((toolKey) => !rendered.includes(toolKey));
  const unexpected = rendered.filter((toolKey) => !expected.includes(toolKey));
  assert(missing.length === 0, `tool inventory: configured tools missing from toolkit UI: ${missing.join(', ')}`);
  assert(unexpected.length === 0, `tool inventory: toolkit UI rendered unknown tools: ${unexpected.join(', ')}`);
  assert(rendered.length === expected.length, `tool inventory: expected ${expected.length} cards, found ${rendered.length}`);
  console.log(`  ✓ toolkit renders all ${expected.length} configured tool cards`);
}

async function openFirstOpportunityCard(page, options = {}) {
  const { runSearch = false } = options;
  await openTool(page, 'opportunity-finder');
  await page.locator('[data-qa="opportunity-finder-tool"]').waitFor({ timeout: 30_000 });
  if (runSearch) {
    const searchButton = page.locator('[data-qa="opportunity-finder-start-search"], [data-qa="opportunity-finder-ai-search"]').first();
    await searchButton.waitFor({ timeout: 20_000 });
    await searchButton.click();
  } else {
    const resultState = page.locator('[data-qa="opportunity-finder-tool"][data-qa-tool-state="result"]');
    try {
      await resultState.waitFor({ timeout: 15_000 });
    } catch {
      const searchButton = page.locator('[data-qa="opportunity-finder-start-search"], [data-qa="opportunity-finder-ai-search"]').first();
      await searchButton.waitFor({ timeout: 20_000 });
      await searchButton.click();
    }
  }
  await page.locator('[data-qa="opportunity-finder-tool"][data-qa-tool-state="result"]').waitFor({ timeout: 60_000 });
  await page.locator('[data-qa="opportunity-result-card"]').first().waitFor({ timeout: 20_000 });
  const firstCard = page.locator('[data-qa="opportunity-result-card"]').first();
  const expanded = await firstCard.locator('button[aria-expanded="true"]').count();
  if (!expanded) await firstCard.locator('button[aria-expanded]').click();
  const title = (await firstCard.locator('[data-qa="opportunity-card-title"]').innerText({ timeout: 5_000 })).trim();
  const company = (await firstCard.locator('[data-qa="opportunity-card-company"]').innerText({ timeout: 5_000 })).trim();
  return { firstCard, title, company };
}

async function returnToLibrary(page) {
  await page.locator('[data-qa="toolkit-back-to-library"]').click();
  await page.locator('[data-qa="toolkit-card-cover-letter"]').waitFor({ timeout: 20_000 });
}

async function assertTextareaHasValue(page, selector, label) {
  const value = await page.locator(selector).inputValue({ timeout: 5_000 });
  assert(value.trim().length > 0, `${label}: expected generated textarea content`);
}

async function expectInputValue(page, selector, expected) {
  const value = await page.locator(selector).inputValue({ timeout: 5_000 });
  assert(value === expected, `${selector}: expected "${expected}", found "${value}"`);
}

async function assertResultHasSampleText(page, selector, label) {
  const text = await page.locator(selector).textContent({ timeout: 5_000 });
  assert((text || '').includes('Sample'), `${label}: expected stubbed result content`);
}

async function interviewSessionCount() {
  const user = await admin.auth().getUserByEmail(CANDIDATE_EMAIL);
  const snap = await admin
    .firestore()
    .collection('users')
    .doc(user.uid)
    .collection('interview_sessions')
    .get();
  return snap.size;
}

async function waitForInterviewSessionWrite(previousCount, timeoutMs = 15_000) {
  const started = Date.now();
  const user = await admin.auth().getUserByEmail(CANDIDATE_EMAIL);
  const ref = admin
    .firestore()
    .collection('users')
    .doc(user.uid)
    .collection('interview_sessions');

  while (Date.now() - started < timeoutMs) {
    const snap = await ref.get();
    if (snap.size > previousCount) {
      const docs = snap.docs.map((doc) => doc.data());
      const latest = docs.find((doc) => Array.isArray(doc.exchanges) && doc.exchanges.length > 0);
      assert(latest, 'mock interview: expected saved session exchanges');
      assert(String(latest.overall_summary || '').includes('Sample'), 'mock interview: expected saved stub summary');
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error('mock interview: timed out waiting for saved interview session history');
}

async function waitForToolResultWrite(toolKey, label, timeoutMs = 15_000) {
  const started = Date.now();
  const uid = await candidateUid();
  const ref = admin.firestore().collection('users').doc(uid).collection('tool_results').doc(toolKey);

  while (Date.now() - started < timeoutMs) {
    const snap = await ref.get();
    if (snap.exists) {
      const data = snap.data() || {};
      assert(data.tool_key === toolKey, `${label}: saved result tool_key mismatch`);
      assert(data.result !== undefined && data.result !== null, `${label}: saved result payload missing`);
      assert(data.saved_at !== undefined && data.saved_at !== null, `${label}: saved result timestamp missing`);
      return data;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error(`${label}: timed out waiting for saved tool_results/${toolKey}`);
}

async function waitForToolResultClear(toolKey, label, timeoutMs = 15_000) {
  const started = Date.now();
  const uid = await candidateUid();
  const ref = admin.firestore().collection('users').doc(uid).collection('tool_results').doc(toolKey);

  while (Date.now() - started < timeoutMs) {
    const snap = await ref.get();
    if (!snap.exists) return;
    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error(`${label}: timed out waiting for cleared tool_results/${toolKey}`);
}

/**
 * The saved badge lags the Firestore write behind the client subscription, so
 * a single immediate read races "Saving..." / stale text. Poll until the badge
 * text matches. /Saved/ is case-sensitive on purpose: it must not accept
 * "Not saved", and /Not saved/ must not accept "Saved just now".
 */
async function expectSaveStatus(statusLocator, pattern, message) {
  try {
    await statusLocator.filter({ hasText: pattern }).first().waitFor({ timeout: 10_000 });
  } catch {
    const actual = await statusLocator.first().innerText({ timeout: 1_000 }).catch(() => '(missing)');
    throw new Error(`${message} (save status: "${actual}")`);
  }
}

async function assertSavedToolResultRestore(page, toolKey, label, resultSelector) {
  await waitForToolResultWrite(toolKey, label);
  const resultRoot = page.locator(resultSelector);
  await expectSaveStatus(resultRoot.locator('[data-qa="tool-save-status"]'), /Saved/, `${label}: expected saved status after generation`);

  await returnToLibrary(page);
  await openTool(page, toolKey);
  await page.locator(resultSelector).waitFor({ timeout: 20_000 });
  await expectSaveStatus(page.locator(resultSelector).locator('[data-qa="tool-save-status"]'), /Saved/, `${label}: expected saved result to restore on reopen`);
  await page.locator(resultSelector).locator('[data-qa="tool-remove-saved"]').click();
  await waitForToolResultClear(toolKey, label);
  await expectSaveStatus(page.locator(resultSelector).locator('[data-qa="tool-save-status"]'), /Not saved/, `${label}: expected cleared save status`);
}

async function waitForSavedOpportunity(url, timeoutMs = 15_000) {
  const started = Date.now();
  const uid = await candidateUid();
  const ref = admin.firestore().collection('users').doc(uid).collection('job_opportunities');

  while (Date.now() - started < timeoutMs) {
    const snap = await ref.get();
    const match = snap.docs.find((doc) => !url || doc.data().url === url);
    if (match) {
      const data = match.data();
      assert(data.is_saved === true, 'opportunity finder: saved opportunity is_saved mismatch');
      assert(typeof data.job_title === 'string' && data.job_title.length > 0, 'opportunity finder: saved job_title missing');
      assert(typeof data.company === 'string' && data.company.length > 0, 'opportunity finder: saved company missing');
      assert(typeof data.url === 'string' && data.url.length > 0, 'opportunity finder: saved url missing');
      assert(data.created_at !== undefined && data.created_at !== null, 'opportunity finder: saved created_at missing');
      if (data.compatibility_score !== undefined) {
        assert(Number.isFinite(data.compatibility_score), 'opportunity finder: saved compatibility_score invalid');
      }
      return { id: match.id, ...data };
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error('opportunity finder: timed out waiting for saved job opportunity');
}

async function waitForSavedOpportunityClear(url, timeoutMs = 15_000) {
  const started = Date.now();
  const uid = await candidateUid();
  const ref = admin.firestore().collection('users').doc(uid).collection('job_opportunities');

  while (Date.now() - started < timeoutMs) {
    const snap = await ref.get();
    const match = snap.docs.find((doc) => doc.data().url === url);
    if (!match) return;
    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error('opportunity finder: timed out waiting for removed job opportunity');
}

async function waitForJobPreferencesWrite(expectedRoles, timeoutMs = 15_000) {
  const started = Date.now();
  const uid = await candidateUid();
  const ref = admin.firestore().collection('users').doc(uid);

  while (Date.now() - started < timeoutMs) {
    const snap = await ref.get();
    const prefs = snap.data()?.job_preferences;
    if (prefs?.roles === expectedRoles) {
      assert(prefs.status === 'active', 'career goals: expected saved active status');
      assert(prefs.locations === 'Ottawa, Remote', 'career goals: expected saved locations');
      assert(prefs.salaryMin === '95000', 'career goals: expected saved salary');
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error('career goals: timed out waiting for saved job preferences');
}

async function waitForSavedPortfolio(name, timeoutMs = 20_000) {
  const started = Date.now();
  const uid = await candidateUid();
  const ref = admin.firestore().collection('users').doc(uid).collection('portfolios');

  while (Date.now() - started < timeoutMs) {
    const snap = await ref.get();
    const match = snap.docs.find((doc) => doc.data().name === name);
    if (match) {
      const data = match.data();
      assert(String(data.html_path || '').endsWith('/showcase.html'), 'portfolio builder: saved portfolio html_path missing');
      assert(data.theme === 'sapphire', 'portfolio builder: saved portfolio theme mismatch');
      return { id: match.id, ...data };
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error('portfolio builder: timed out waiting for saved portfolio metadata');
}

async function waitForSavedPortfolioClear(name, timeoutMs = 20_000) {
  const started = Date.now();
  const uid = await candidateUid();
  const ref = admin.firestore().collection('users').doc(uid).collection('portfolios');

  while (Date.now() - started < timeoutMs) {
    const snap = await ref.get();
    const match = snap.docs.find((doc) => doc.data().name === name);
    if (!match) return;
    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error('portfolio builder: timed out waiting for deleted portfolio metadata');
}

async function runCareerGoalsPersistence(page) {
  const roles = 'QA Frontend Engineer';
  await page.goto(`${BASE_URL}/workspace/jobs`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-qa-workspace-view="jobs"]').waitFor({ timeout: 30_000 });
  await page.locator('[data-qa="career-goals-panel"]').waitFor({ timeout: 20_000 });
  const rolesInput = page.locator('[data-qa="career-goals-roles"]');
  if (!(await rolesInput.isVisible().catch(() => false))) {
    await page.locator('[data-qa="career-goals-panel"] > button').click();
  }
  await rolesInput.fill(roles);
  await page.locator('[data-qa="career-goals-locations"]').fill('Ottawa, Remote');
  await page.locator('[data-qa="career-goals-salary"]').fill('95000');
  await page.locator('[data-qa="career-goals-availability"]').fill('2 weeks');
  await page.locator('[data-qa="career-goals-status-active"]').click();
  await page.locator('[data-qa="career-goals-save"]').click();
  await waitForJobPreferencesWrite(roles);
  await page.locator('[data-qa="career-goals-panel"]').getByText(roles).waitFor({ timeout: 20_000 });
  await assertNoToolCrash(page, 'career goals');
  await assertNoOverflow(page, 'career goals persistence');
  console.log('  ✓ career goals account persistence');
}

async function runCoverLetter(page) {
  await openTool(page, 'cover-letter');
  await page.locator('[data-qa="cover-letter-tool"][data-qa-tool-state="input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="cover-letter-try-example"]').click();
  await page.locator('[data-qa="cover-letter-job-description"]').evaluate((node) => {
    if (!(node instanceof HTMLTextAreaElement)) throw new Error('Expected textarea');
    if (!node.value.includes('Frontend Software Engineer')) throw new Error('Try example did not populate job description');
  });
  await page.locator('[data-qa="cover-letter-generate"]').click();
  await page.locator('[data-qa="cover-letter-tool"][data-qa-tool-state="result"]').waitFor({ timeout: 60_000 });
  await assertTextareaHasValue(page, '[data-qa="cover-letter-result"]', 'cover letter');
  await assertSavedToolResultRestore(page, 'cover-letter', 'cover letter', '[data-qa="cover-letter-tool"][data-qa-tool-state="result"]');
  await assertNoToolCrash(page, 'cover letter');
  await assertNoOverflow(page, 'cover letter result');
  console.log('  ✓ cover letter generation save and restore flow');
  await returnToLibrary(page);
}

async function runCoverLetterResumeFormatterHandoff(page) {
  await openTool(page, 'cover-letter');
  await page.locator('[data-qa="cover-letter-tool"][data-qa-tool-state="input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="cover-letter-try-example"]').click();
  await page.locator('[data-qa="cover-letter-generate"]').click();
  await page.locator('[data-qa="cover-letter-tool"][data-qa-tool-state="result"]').waitFor({ timeout: 60_000 });
  const coverLetterText = await page.locator('[data-qa="cover-letter-result"]').inputValue({ timeout: 5_000 });
  assert(coverLetterText.includes('Sample'), 'cover letter resume handoff: expected generated cover letter text');
  await waitForToolResultWrite('cover-letter', 'cover letter resume handoff source');
  await page.locator('[data-qa="cover-letter-tool"][data-qa-tool-state="result"]').locator('[data-qa="tool-remove-saved"]').click();
  await waitForToolResultClear('cover-letter', 'cover letter resume handoff source');

  await page.locator('[data-qa="cover-letter-open-resume-formatter"]').click();
  await page.locator('[data-qa="toolkit-active-tool"][data-qa-tool="resume-formatter"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="resume-formatter"][data-qa-resume-formatter-state="input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="resume-formatter-prefill-note"]').waitFor({ timeout: 10_000 });
  assert(await page.locator('#include-cover-letter').isChecked(), 'cover letter resume handoff: expected cover letter option to be checked');
  const importedCoverLetter = await page.locator('[data-qa="resume-formatter-cover-letter"]').inputValue({ timeout: 5_000 });
  assert(
    importedCoverLetter === coverLetterText,
    'cover letter resume handoff: expected Resume Formatter to receive the generated letter',
  );

  await page.locator('[data-qa="resume-formatter-generate"]').click();
  await page.locator('[data-qa="resume-formatter"][data-qa-resume-formatter-state="result"]').waitFor({ timeout: 60_000 });
  await assertResultHasSampleText(page, '[data-qa="resume-formatter"][data-qa-resume-formatter-state="result"]', 'cover letter resume handoff');
  // The readiness panel only exists while a result is displayed.
  await page.locator('[data-qa="resume-formatter-readiness"]').waitFor({ timeout: 10_000 });
  await waitForToolResultWrite('resume-formatter', 'cover letter resume handoff');
  await page.locator('[data-qa="resume-formatter"][data-qa-resume-formatter-state="result"]').locator('[data-qa="tool-remove-saved"]').click();
  await waitForToolResultClear('resume-formatter', 'cover letter resume handoff');
  // Removing the only saved version clears the in-memory result back to input.
  await page.locator('[data-qa="resume-formatter"][data-qa-resume-formatter-state="input"]').waitFor({ timeout: 10_000 });
  await assertNoToolCrash(page, 'cover letter resume handoff');
  await assertNoOverflow(page, 'cover letter resume handoff');
  console.log('  ✓ cover letter imports into resume formatter application packet');
  await returnToLibrary(page);
}

async function runEmailCrafter(page) {
  await openTool(page, 'email-crafter');
  await page.locator('[data-qa="email-crafter-tool"][data-qa-tool-state="input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="email-crafter-try-example"]').click();
  await page.locator('[data-qa="email-crafter-generate"]').click();
  await page.locator('[data-qa="email-crafter-tool"][data-qa-tool-state="result"]').waitFor({ timeout: 60_000 });
  await assertTextareaHasValue(page, '[data-qa="email-crafter-result-body"]', 'email draft');
  const subject = await page.locator('[data-qa="email-crafter-result-subject"]').inputValue();
  assert(subject.trim().length > 0, 'email draft: expected generated subject');
  await assertSavedToolResultRestore(page, 'email-crafter', 'email draft', '[data-qa="email-crafter-tool"][data-qa-tool-state="result"]');
  await assertNoToolCrash(page, 'email draft');
  await assertNoOverflow(page, 'email draft result');
  console.log('  ✓ email drafting save and restore flow');
  await returnToLibrary(page);
}

async function runRecentApplicationPrefill(page) {
  await openTool(page, 'cover-letter');
  await page.locator('[data-qa="cover-letter-tool"][data-qa-tool-state="input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="cover-letter-recent-apps"] option[value="seed-app-casey"]').waitFor({ state: 'attached', timeout: 20_000 });
  await page.locator('[data-qa="cover-letter-recent-apps"]').selectOption('seed-app-casey');
  const coverContext = await page.locator('[data-qa="cover-letter-job-description"]').inputValue();
  assert(coverContext.includes('Job Title: Frontend Engineer'), 'recent app prefill: cover letter missing job title');
  assert(coverContext.includes('Company: Seed Test Co'), 'recent app prefill: cover letter missing company');
  assert(coverContext.includes('Location: Toronto, ON'), 'recent app prefill: cover letter missing location');
  assert(coverContext.includes('Responsibilities:'), 'recent app prefill: cover letter missing responsibilities');
  assert(coverContext.includes('Required qualifications:'), 'recent app prefill: cover letter missing requirements');
  await assertNoToolCrash(page, 'cover letter recent app prefill');
  await assertNoOverflow(page, 'cover letter recent app prefill');
  await returnToLibrary(page);

  await openTool(page, 'email-crafter');
  await page.locator('[data-qa="email-crafter-tool"][data-qa-tool-state="input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="email-crafter-scenario-follow_up"]').click();
  await page.locator('[data-qa="email-crafter-recent-apps"] option[value="seed-app-casey"]').waitFor({ state: 'attached', timeout: 20_000 });
  await page.locator('[data-qa="email-crafter-recent-apps"]').selectOption('seed-app-casey');
  assert((await page.locator('[data-qa="email-detail-job_title"]').inputValue()) === 'Frontend Engineer', 'recent app prefill: email missing job title');
  assert((await page.locator('[data-qa="email-detail-company_name"]').inputValue()) === 'Seed Test Co', 'recent app prefill: email missing company');
  assert((await page.locator('[data-qa="email-detail-date_of_application"]').inputValue()).length > 0, 'recent app prefill: email missing application date');
  await assertNoToolCrash(page, 'email recent app prefill');
  await assertNoOverflow(page, 'email recent app prefill');
  await returnToLibrary(page);

  await openTool(page, 'mock-interview');
  await page.locator('[data-qa="interview-simulator"][data-qa-interview-stage="setup"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="mock-interview-job-source"] option[value="app:seed-app-casey"]').waitFor({ state: 'attached', timeout: 20_000 });
  await page.locator('[data-qa="mock-interview-job-source"]').selectOption('app:seed-app-casey');
  assert((await page.locator('[data-qa="mock-interview-job-title"]').inputValue()) === 'Frontend Engineer', 'recent app prefill: mock interview missing job title');
  assert((await page.locator('[data-qa="mock-interview-company-name"]').inputValue()) === 'Seed Test Co', 'recent app prefill: mock interview missing company');
  assert((await page.locator('[data-qa="mock-interview-job-description"]').inputValue()).includes('Build accessible'), 'recent app prefill: mock interview missing description');
  assert((await page.locator('[data-qa="mock-interview-job-responsibilities"]').inputValue()).includes('Ship candidate'), 'recent app prefill: mock interview missing responsibilities');
  assert((await page.locator('[data-qa="mock-interview-job-requirements"]').inputValue()).includes('production React'), 'recent app prefill: mock interview missing requirements');
  await assertNoToolCrash(page, 'mock interview recent app prefill');
  await assertNoOverflow(page, 'mock interview recent app prefill');
  console.log('  ✓ recent application prefill enriches cover letter, email, and mock interview');
  await returnToLibrary(page);
}

async function runCareerPath(page) {
  await openTool(page, 'career-path');
  await page.locator('[data-qa="career-path-tool"][data-qa-tool-state="input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="career-path-try-example"]').click();
  const targetRole = await page.locator('[data-qa="career-path-target-role"]').inputValue();
  assert(targetRole.trim().length > 0, 'career path: try example did not populate target role');
  await page.locator('[data-qa="career-path-generate"]').click();
  await page.locator('[data-qa="career-path-tool"][data-qa-tool-state="result"]').waitFor({ timeout: 60_000 });
  await assertResultHasSampleText(page, '[data-qa="career-path-tool"][data-qa-tool-state="result"]', 'career path');
  const gapCards = page.locator('[data-qa="career-path-gap-card"]');
  const gapCount = await gapCards.count();
  assert(gapCount > 0, 'career path: expected at least one skill gap card');
  for (let index = 0; index < gapCount; index += 1) {
    const cardBox = await gapCards.nth(index).boundingBox();
    const reasonBox = await gapCards.nth(index).locator('[data-qa="career-path-gap-reason"]').boundingBox();
    const actionsBox = await gapCards.nth(index).locator('[data-qa="career-path-gap-actions"]').boundingBox();
    assert(cardBox && reasonBox && actionsBox, `career path: skill gap ${index + 1} layout boxes are missing`);
    assert(reasonBox.width >= cardBox.width - 40, `career path: skill gap ${index + 1} text is compressed beside its actions`);
    assert(actionsBox.y >= reasonBox.y + reasonBox.height, `career path: skill gap ${index + 1} actions overlap its description`);
  }
  await assertSavedToolResultRestore(page, 'career-path', 'career path', '[data-qa="career-path-tool"][data-qa-tool-state="result"]');
  await assertNoToolCrash(page, 'career path');
  await assertNoOverflow(page, 'career path result');
  console.log('  ✓ career path generation save and restore flow');
  await returnToLibrary(page);
}

async function runCareerPathPortfolioHandoff(page) {
  await openTool(page, 'career-path');
  await page.locator('[data-qa="career-path-tool"][data-qa-tool-state="input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="career-path-try-example"]').click();
  await page.locator('[data-qa="career-path-generate"]').click();
  await page.locator('[data-qa="career-path-tool"][data-qa-tool-state="result"]').waitFor({ timeout: 60_000 });

  await page.locator('[data-qa="career-path-generate-project"]').first().click();
  const generatedProjectTitle = page.locator('[data-qa="career-path-generated-project-title"]');
  await generatedProjectTitle.waitFor({ timeout: 60_000 });
  const projectTitle = (await generatedProjectTitle.innerText()).trim();
  assert(projectTitle.length > 0, 'career path portfolio handoff: generated project title missing');

  await page.locator('[data-qa="career-path-add-project-to-portfolio"]').click();
  await page.locator('[data-qa="toolkit-active-tool"][data-qa-tool="website-builder"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="portfolio-builder-tool"][data-qa-tool-state="details"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="portfolio-builder-imported-project-notice"]').waitFor({ timeout: 10_000 });

  const importedProjectTitles = await page.locator('[data-qa^="portfolio-project-title-"]').evaluateAll((nodes) =>
    nodes
      .filter((node) => node instanceof HTMLInputElement)
      .map((node) => node.value.trim()),
  );
  assert(
    importedProjectTitles.some((title) => title === projectTitle),
    `career path portfolio handoff: expected imported project "${projectTitle}", found ${importedProjectTitles.join(', ')}`,
  );

  await assertNoToolCrash(page, 'career path portfolio handoff');
  await assertNoOverflow(page, 'career path portfolio handoff');
  console.log('  ✓ career path project imports into portfolio builder');
  await returnToLibrary(page);
}

async function openCareerPathResult(page) {
  await openTool(page, 'career-path');
  const resultState = page.locator('[data-qa="career-path-tool"][data-qa-tool-state="result"]');
  try {
    await resultState.waitFor({ timeout: 5_000 });
    return;
  } catch {
    await page.locator('[data-qa="career-path-tool"][data-qa-tool-state="input"]').waitFor({ timeout: 20_000 });
  }

  await page.locator('[data-qa="career-path-try-example"]').click();
  await page.locator('[data-qa="career-path-generate"]').click();
  await resultState.waitFor({ timeout: 60_000 });
}

async function runCareerPathLearningHandoff(page) {
  await openCareerPathResult(page);
  const firstGap = page.locator('[data-qa="career-path-gap-skill"]').first();
  await firstGap.waitFor({ timeout: 20_000 });
  const skill = (await firstGap.innerText()).trim();
  assert(skill.length > 0, 'career path learning handoff: expected first skill gap text');

  await page.locator('[data-qa="career-path-build-learning-plan"]').first().click();
  await page.locator('[data-qa="toolkit-active-tool"][data-qa-tool="skill-learning-plan"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="skill-learning-plan-tool"][data-qa-tool-state="input"]').waitFor({ timeout: 20_000 });
  await expectInputValue(page, '[data-qa="skill-learning-plan-skill"]', skill);
  await page.locator('[data-qa="skill-learning-plan-prefill-note"]').waitFor({ timeout: 10_000 });

  await page.locator('[data-qa="skill-learning-plan-generate"]').click();
  await page.locator('[data-qa="skill-learning-plan-tool"][data-qa-tool-state="result"]').waitFor({ timeout: 60_000 });
  const text = await page.locator('[data-qa="skill-learning-plan-tool"][data-qa-tool-state="result"]').textContent();
  assert((text || '').includes('Sample'), 'career path learning handoff: expected generated learning plan content');
  await waitForToolResultWrite('skill-learning-plan', 'career path learning handoff');
  await page.locator('[data-qa="skill-learning-plan-tool"][data-qa-tool-state="result"]').locator('[data-qa="tool-remove-saved"]').click();
  await waitForToolResultClear('skill-learning-plan', 'career path learning handoff');
  await assertNoToolCrash(page, 'career path learning handoff');
  await assertNoOverflow(page, 'career path learning handoff');
  console.log('  ✓ career path skill gap opens a learning plan with context');
  await returnToLibrary(page);
}

async function runResumeFormatter(page) {
  await openTool(page, 'resume-formatter');
  await page.locator('[data-qa="resume-formatter"][data-qa-resume-formatter-state="input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="resume-formatter-generate"]').click();
  await page.locator('[data-qa="resume-formatter"][data-qa-resume-formatter-state="result"]').waitFor({ timeout: 60_000 });
  await assertResultHasSampleText(page, '[data-qa="resume-formatter"][data-qa-resume-formatter-state="result"]', 'resume formatter');
  // Resume Formatter keeps a saved-version library: removing the last saved
  // version clears the in-memory result back to input, so the generic restore
  // helper's post-clear "Not saved" read (which expects the result to stay
  // mounted) does not apply to this tool.
  const formatterResult = page.locator('[data-qa="resume-formatter"][data-qa-resume-formatter-state="result"]');
  await waitForToolResultWrite('resume-formatter', 'resume formatter');
  await expectSaveStatus(formatterResult.locator('[data-qa="tool-save-status"]'), /Saved/, 'resume formatter: expected saved status after generation');
  await returnToLibrary(page);
  await openTool(page, 'resume-formatter');
  await formatterResult.waitFor({ timeout: 20_000 });
  await expectSaveStatus(formatterResult.locator('[data-qa="tool-save-status"]'), /Saved/, 'resume formatter: expected saved result to restore on reopen');
  await formatterResult.locator('[data-qa="tool-remove-saved"]').click();
  await waitForToolResultClear('resume-formatter', 'resume formatter');
  await page.locator('[data-qa="resume-formatter"][data-qa-resume-formatter-state="input"]').waitFor({ timeout: 10_000 });
  await assertNoToolCrash(page, 'resume formatter');
  await assertNoOverflow(page, 'resume formatter result');
  console.log('  ✓ resume formatter save and restore flow');
  await returnToLibrary(page);
}

async function runResumeFormatterLinkedInHandoff(page) {
  await openTool(page, 'resume-formatter');
  await page.locator('[data-qa="resume-formatter"][data-qa-resume-formatter-state="input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="resume-formatter-generate"]').click();
  await page.locator('[data-qa="resume-formatter"][data-qa-resume-formatter-state="result"]').waitFor({ timeout: 60_000 });
  await page.locator('[data-qa="resume-formatter-open-linkedin"]').click();

  await page.locator('[data-qa="toolkit-active-tool"][data-qa-tool="linkedin-optimizer"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="linkedin-optimizer-tool"][data-qa-tool-state="input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="linkedin-optimizer-prefill-note"]').waitFor({ timeout: 10_000 });
  await page.locator('[data-qa="linkedin-optimizer-generate-resume"]').click();
  await page.locator('[data-qa="linkedin-optimizer-tool"][data-qa-tool-state="result"]').waitFor({ timeout: 60_000 });
  await assertResultHasSampleText(page, '[data-qa="linkedin-optimizer-tool"][data-qa-tool-state="result"]', 'resume linkedin handoff');
  await waitForToolResultWrite('linkedin-optimizer', 'resume linkedin handoff');
  await page.locator('[data-qa="linkedin-optimizer-tool"][data-qa-tool-state="result"]').locator('[data-qa="tool-remove-saved"]').click();
  await waitForToolResultClear('linkedin-optimizer', 'resume linkedin handoff');
  await assertNoToolCrash(page, 'resume linkedin handoff');
  await assertNoOverflow(page, 'resume linkedin handoff');
  console.log('  ✓ formatted resume opens linkedin optimizer with resume context');
  await returnToLibrary(page);
}

async function runLinkedInOptimizer(page) {
  await openTool(page, 'linkedin-optimizer');
  await page.locator('[data-qa="linkedin-optimizer-tool"][data-qa-tool-state="input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="linkedin-optimizer-generate-resume"]').click();
  await page.locator('[data-qa="linkedin-optimizer-tool"][data-qa-tool-state="result"]').waitFor({ timeout: 60_000 });
  await assertResultHasSampleText(page, '[data-qa="linkedin-optimizer-tool"][data-qa-tool-state="result"]', 'linkedin optimizer');
  await assertSavedToolResultRestore(page, 'linkedin-optimizer', 'linkedin optimizer', '[data-qa="linkedin-optimizer-tool"][data-qa-tool-state="result"]');
  await assertNoToolCrash(page, 'linkedin optimizer');
  await assertNoOverflow(page, 'linkedin optimizer result');
  console.log('  ✓ linkedin optimizer save and restore flow');
  await returnToLibrary(page);
}

async function runMockInterviewSessionReport(page) {
  const previousSessions = await interviewSessionCount();
  await openTool(page, 'mock-interview');
  await page.locator('[data-qa="interview-simulator"][data-qa-interview-stage="setup"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="mock-interview-try-example"]').click();
  const jobTitle = await page.locator('[data-qa="mock-interview-job-title"]').inputValue();
  assert(jobTitle.trim().length > 0, 'mock interview: try example did not populate job title');
  const setupChips = await page
    .locator('[data-qa="interview-simulator"] [role="status"]')
    .allInnerTexts()
    .catch(() => []);
  console.log(`  mock interview setup status chips: ${JSON.stringify(setupChips)}`);
  await page.locator('[data-qa="mock-interview-start"]').click();
  await page.locator('[data-qa="mock-interview-disclaimer-checkbox"]').check();
  await page.locator('[data-qa="mock-interview-disclaimer-accept"]').click();
  try {
    await page.locator('[data-qa="interview-simulator"][data-qa-interview-stage="interviewing"]').waitFor({ timeout: 60_000 });
  } catch (stageError) {
    // Surface WHY generation never reached the interview: the handler's error
    // message is rendered as a role="alert" back on the setup stage.
    const stage = await page
      .locator('[data-qa="interview-simulator"]')
      .first()
      .getAttribute('data-qa-interview-stage')
      .catch(() => '(unknown)');
    const alerts = await page
      .locator('[data-qa="interview-simulator"] [role="alert"], [role="alert"]')
      .allInnerTexts()
      .catch(() => []);
    throw new Error(
      `mock interview: interviewing stage never appeared (stage=${stage}; alerts=${JSON.stringify(alerts)})`,
      { cause: stageError },
    );
  }
  await assertResultHasSampleText(page, '[data-qa="mock-interview-question"]', 'mock interview question');
  await page.locator('[data-qa="mock-interview-start-answering"]').click();
  await page.locator('[data-qa="mock-interview-answer"]').fill('I would clarify the service boundary, ship the smallest reliable slice, and use metrics from the candidate workflow to decide the next iteration.');
  await page.locator('[data-qa="mock-interview-submit-answer"]').click();
  // The schema-honoring stub generates the full 8-question interview, so reach
  // the report through the real early-exit control after answering question 1
  // (the button swaps in place for its confirm variant with the same label).
  await page.getByRole('button', { name: 'End interview early' }).click();
  await page.getByRole('button', { name: 'End interview early' }).click();
  await page.locator('[data-qa="interview-simulator"][data-qa-interview-stage="report"]').waitFor({ timeout: 60_000 });
  try {
    await assertResultHasSampleText(page, '[data-qa="mock-interview-report-summary"]', 'mock interview report');
  } catch (summaryError) {
    // Identify WHICH report variant actually rendered so the gate log names
    // the failure instead of a bare locator timeout.
    const alerts = await page.locator('[role="alert"]').allInnerTexts().catch(() => []);
    const unlockButtons = await page.getByRole('button', { name: /unlock/i }).count().catch(() => -1);
    const crashTitles = await page.locator('[data-qa="tool-crash"], [data-qa="section-crash"]').count().catch(() => -1);
    const reportText = await page
      .locator('[data-qa="interview-simulator"][data-qa-interview-stage="report"]')
      .first()
      .innerText()
      .catch(() => '(unreadable)');
    throw new Error(
      `mock interview: report summary missing (alerts=${JSON.stringify(alerts)}; unlockButtons=${unlockButtons}; crashMarkers=${crashTitles}; reportText="${reportText.slice(0, 400)}")`,
      { cause: summaryError },
    );
  }
  await waitForInterviewSessionWrite(previousSessions);
  await assertNoToolCrash(page, 'mock interview');
  await assertNoOverflow(page, 'mock interview report');
  await returnToLibrary(page);
  await openTool(page, 'mock-interview');
  const historyItem = page.locator('[data-qa="mock-interview-history-item"]').first();
  await historyItem.waitFor({ timeout: 20_000 });
  await historyItem.click();
  await page.locator('[data-qa="mock-interview-history-detail"]').waitFor({ timeout: 10_000 });
  const historySummary = await page.locator('[data-qa="mock-interview-history-summary"]').textContent({ timeout: 5_000 });
  assert((historySummary || '').includes('Sample'), 'mock interview: expected saved history summary to render');
  const exchangeCount = await page.locator('[data-qa="mock-interview-history-exchange"]').count();
  assert(exchangeCount > 0, 'mock interview: expected saved history exchanges to render');
  await assertNoToolCrash(page, 'mock interview history review');
  await assertNoOverflow(page, 'mock interview history review');
  console.log('  ✓ mock interview session report and history review flow');
  await returnToLibrary(page);
}

async function runInterviewPrep(page) {
  await openTool(page, 'interview-prep');
  await page.locator('[data-qa="interview-prep-tool"][data-qa-tool-state="input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="interview-prep-role"]').fill('Machine Learning Engineer');
  await page.locator('[data-qa="interview-prep-generate"]').click();
  await page.locator('[data-qa="interview-prep-tool"][data-qa-tool-state="result"]').waitFor({ timeout: 60_000 });
  const text = await page.locator('[data-qa="interview-prep-tool"][data-qa-tool-state="result"]').textContent();
  assert((text || '').includes('Sample'), 'interview prep: expected stubbed result content');
  await assertSavedToolResultRestore(page, 'interview-prep', 'interview prep', '[data-qa="interview-prep-tool"][data-qa-tool-state="result"]');
  await assertNoToolCrash(page, 'interview prep');
  await assertNoOverflow(page, 'interview prep result');

  // Seed handoff → Mock Interview. The prep brief carried only a target role (no
  // job description), so this exercises the seed-aware start guard: the brief's
  // ranked questions ARE the content, and the seeded start must not be blocked by
  // the from-scratch "context required" validation.
  await page.locator('[data-qa="interview-prep-start-mock"]').click();
  await page.locator('[data-qa="interview-simulator"][data-qa-interview-stage="setup"]').waitFor({ timeout: 20_000 });
  const seededTitle = await page.locator('[data-qa="mock-interview-job-title"]').inputValue();
  assert(seededTitle.trim().length > 0, 'interview prep handoff: expected seeded job title in mock interview setup');
  await page.locator('[data-qa="mock-interview-start"]').click();
  // The disclaimer appearing (rather than a context-required error) proves the
  // seeded interview can start despite the empty job description.
  await page.locator('[data-qa="mock-interview-disclaimer-checkbox"]').waitFor({ timeout: 10_000 });
  await assertNoToolCrash(page, 'interview prep mock-interview seed handoff');
  console.log('  ✓ interview prep generation, persistence, and mock interview seed handoff flow');
  await page.goto(`${BASE_URL}/workspace/tools`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-qa-workspace-view="toolkit"]').waitFor({ timeout: 30_000 });
}

async function runAgileCoach(page) {
  await openTool(page, 'agile-coach');
  await page.locator('[data-qa="agile-coach-tool"][data-qa-tool-state="setup"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="agile-coach-try-example"]').click();
  await page.locator('[data-qa="agile-coach-generate"]').click();
  await page.locator('[data-qa="agile-coach-tool"][data-qa-tool-state="in-progress"]').waitFor({ timeout: 60_000 });
  await assertResultHasSampleText(page, '[data-qa="agile-coach-tool"][data-qa-tool-state="in-progress"]', 'agile coach');
  await assertSavedToolResultRestore(page, 'agile-coach', 'agile coach', '[data-qa="agile-coach-tool"][data-qa-tool-state="in-progress"]');
  for (let index = 0; index < 20; index += 1) {
    await page.locator('[data-qa="agile-coach-option-0"]').click();
    const nextButton = page.locator('[data-qa="agile-coach-next"]');
    if (await nextButton.isVisible().catch(() => false)) {
      await nextButton.click();
      continue;
    }
    break;
  }
  await page.locator('[data-qa="agile-coach-submit"]').click();
  await page.locator('[data-qa="agile-coach-tool"][data-qa-tool-state="results"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="agile-coach-score"]').waitFor({ timeout: 10_000 });
  await assertNoToolCrash(page, 'agile coach');
  await assertNoOverflow(page, 'agile coach test');
  console.log('  ✓ agile coach practice save, restore, and scoring flow');
  await returnToLibrary(page);
}

async function runNetworkingAssistant(page) {
  await openTool(page, 'networking-assistant');
  await page.locator('[data-qa="networking-assistant-tool"][data-qa-tool-state="input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="networking-assistant-try-example"]').click();
  const company = await page.locator('[data-qa="networking-target-company"]').inputValue();
  const role = await page.locator('[data-qa="networking-target-role"]').inputValue();
  const location = await page.locator('[data-qa="networking-target-location"]').inputValue();
  assert(company && role && location, 'networking assistant: try example did not populate all fields');
  await page.locator('[data-qa="networking-assistant-generate"]').click();
  await page.locator('[data-qa="networking-assistant-tool"][data-qa-tool-state="result"]').waitFor({ timeout: 60_000 });
  await assertResultHasSampleText(page, '[data-qa="networking-assistant-tool"][data-qa-tool-state="result"]', 'networking assistant');
  await assertSavedToolResultRestore(page, 'networking-assistant', 'networking assistant', '[data-qa="networking-assistant-tool"][data-qa-tool-state="result"]');
  await assertNoToolCrash(page, 'networking assistant');
  await assertNoOverflow(page, 'networking assistant result');
  console.log('  ✓ networking assistant save and restore flow');
  await returnToLibrary(page);
}

async function runNetworkingEmailHandoff(page) {
  await openTool(page, 'networking-assistant');
  await page.locator('[data-qa="networking-assistant-tool"][data-qa-tool-state="input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="networking-assistant-try-example"]').click();
  const company = await page.locator('[data-qa="networking-target-company"]').inputValue();
  const role = await page.locator('[data-qa="networking-target-role"]').inputValue();
  const location = await page.locator('[data-qa="networking-target-location"]').inputValue();
  await page.locator('[data-qa="networking-assistant-generate"]').click();
  await page.locator('[data-qa="networking-assistant-tool"][data-qa-tool-state="result"]').waitFor({ timeout: 60_000 });
  const firstContact = page.locator('[data-qa="networking-contact-card"]').first();
  await firstContact.waitFor({ timeout: 10_000 });
  const contactType = ((await firstContact.locator('[data-qa="networking-contact-type"]').textContent({ timeout: 5_000 })) || '').trim();
  assert(contactType.length > 0, 'networking email handoff: expected generated contact type');

  await firstContact.locator('[data-qa="networking-open-email-0"]').click();
  await page.locator('[data-qa="toolkit-active-tool"][data-qa-tool="email-crafter"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="email-crafter-tool"][data-qa-tool-state="input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="email-crafter-prefill-note"]').waitFor({ timeout: 10_000 });
  await page.locator('[data-qa="email-crafter-scenario-networking"][aria-pressed="true"]').waitFor({ timeout: 10_000 });
  await expectInputValue(page, '[data-qa="email-detail-recipient_title"]', contactType);
  await expectInputValue(page, '[data-qa="email-detail-recipient_company"]', company);
  const messageContext = await page.locator('[data-qa="email-detail-message_context_optional"]').inputValue({ timeout: 5_000 });
  assert(messageContext.includes(role), 'networking email handoff: expected role in message context');
  assert(messageContext.includes(location), 'networking email handoff: expected location in message context');

  await page.locator('[data-qa="email-crafter-generate"]').click();
  await page.locator('[data-qa="email-crafter-tool"][data-qa-tool-state="result"]').waitFor({ timeout: 60_000 });
  await assertResultHasSampleText(page, '[data-qa="email-crafter-tool"][data-qa-tool-state="result"]', 'networking email handoff');
  await waitForToolResultWrite('email-crafter', 'networking email handoff');
  await page.locator('[data-qa="email-crafter-tool"][data-qa-tool-state="result"]').locator('[data-qa="tool-remove-saved"]').click();
  await waitForToolResultClear('email-crafter', 'networking email handoff');
  await assertNoToolCrash(page, 'networking email handoff');
  await assertNoOverflow(page, 'networking email handoff');
  console.log('  ✓ networking outreach opens email crafter with contact context');
  await returnToLibrary(page);
}

async function runIndustryEventScout(page) {
  await openTool(page, 'industry-event-scout');
  await page.locator('[data-qa="industry-event-scout-tool"][data-qa-tool-state="input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="industry-event-scout-try-example"]').click();
  const field = await page.locator('[data-qa="industry-event-scout-field"]').inputValue();
  const location = await page.locator('[data-qa="industry-event-scout-location"]').inputValue();
  assert(field && location, 'industry event scout: try example did not populate all fields');
  await page.locator('[data-qa="industry-event-scout-generate"]').click();
  await page.locator('[data-qa="industry-event-scout-tool"][data-qa-tool-state="result"]').waitFor({ timeout: 60_000 });
  await assertResultHasSampleText(page, '[data-qa="industry-event-scout-tool"][data-qa-tool-state="result"]', 'industry event scout');
  await assertSavedToolResultRestore(page, 'industry-event-scout', 'industry event scout', '[data-qa="industry-event-scout-tool"][data-qa-tool-state="result"]');
  await assertNoToolCrash(page, 'industry event scout');
  await assertNoOverflow(page, 'industry event scout result');
  console.log('  ✓ industry event scout save and restore flow');
  await returnToLibrary(page);
}

async function runIndustryEventEmailHandoff(page) {
  await openTool(page, 'industry-event-scout');
  await page.locator('[data-qa="industry-event-scout-tool"][data-qa-tool-state="input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="industry-event-scout-try-example"]').click();
  const field = await page.locator('[data-qa="industry-event-scout-field"]').inputValue();
  await page.locator('[data-qa="industry-event-scout-generate"]').click();
  await page.locator('[data-qa="industry-event-scout-tool"][data-qa-tool-state="result"]').waitFor({ timeout: 60_000 });

  const firstEvent = page.locator('[data-qa="industry-event-card"]').first();
  await firstEvent.waitFor({ timeout: 10_000 });
  const eventName = ((await firstEvent.locator('[data-qa="industry-event-name"]').textContent({ timeout: 5_000 })) || '').trim();
  assert(eventName.length > 0, 'event email handoff: expected generated event name');

  await firstEvent.locator('[data-qa="industry-event-draft-email"]').click();
  await page.locator('[data-qa="toolkit-active-tool"][data-qa-tool="email-crafter"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="email-crafter-tool"][data-qa-tool-state="input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="email-crafter-prefill-note"]').waitFor({ timeout: 10_000 });
  await page.locator('[data-qa="email-crafter-scenario-networking"][aria-pressed="true"]').waitFor({ timeout: 10_000 });
  await expectInputValue(page, '[data-qa="email-detail-recipient_title"]', 'Event organizer or relevant attendee');
  await expectInputValue(page, '[data-qa="email-detail-recipient_company"]', eventName);
  const messageContext = await page.locator('[data-qa="email-detail-message_context_optional"]').inputValue({ timeout: 5_000 });
  assert(messageContext.includes(field), 'event email handoff: expected field in message context');
  assert(messageContext.includes('Event page:'), 'event email handoff: expected event page in message context');

  await page.locator('[data-qa="email-crafter-generate"]').click();
  await page.locator('[data-qa="email-crafter-tool"][data-qa-tool-state="result"]').waitFor({ timeout: 60_000 });
  await assertResultHasSampleText(page, '[data-qa="email-crafter-tool"][data-qa-tool-state="result"]', 'event email handoff');
  await waitForToolResultWrite('email-crafter', 'event email handoff');
  await page.locator('[data-qa="email-crafter-tool"][data-qa-tool-state="result"]').locator('[data-qa="tool-remove-saved"]').click();
  await waitForToolResultClear('email-crafter', 'event email handoff');
  await assertNoToolCrash(page, 'event email handoff');
  await assertNoOverflow(page, 'event email handoff');
  console.log('  ✓ event scout opens email crafter with outreach context');
  await returnToLibrary(page);
}

async function runOpportunityFinder(page) {
  const { firstCard, title: handoffTitle, company: handoffCompany } = await openFirstOpportunityCard(page, { runSearch: true });
  const resultCards = await page.locator('[data-qa="opportunity-result-card"]').count();
  assert(resultCards > 0, 'opportunity finder: expected at least one result card');
  const saveButton = firstCard.locator('[data-qa="opportunity-save-toggle"]');
  await saveButton.waitFor({ timeout: 10_000 });
  await saveButton.click();
  const saved = await waitForSavedOpportunity();
  await page.locator('[data-qa="opportunity-saved-panel"]').waitFor({ timeout: 15_000 });
  await page.locator('[data-qa="opportunity-saved-item"]').filter({ hasText: saved.job_title }).waitFor({ timeout: 15_000 });
  await firstCard.locator('[data-qa="opportunity-save-toggle"][aria-pressed="true"]').waitFor({ timeout: 15_000 });
  await firstCard.locator('[data-qa="opportunity-save-toggle"]').click();
  await page.locator('[data-qa="opportunity-remove-saved-dialog"]').waitFor({ timeout: 10_000 });
  await page.locator('[data-qa="opportunity-remove-saved-dialog-confirm"]').click();
  await waitForSavedOpportunityClear(saved.url);
  await firstCard.locator('[data-qa="opportunity-save-toggle"][aria-pressed="false"]').waitFor({ timeout: 15_000 });
  await page.locator('[data-qa="opportunity-saved-panel"]').waitFor({ state: 'hidden', timeout: 15_000 });
  await assertResultHasSampleText(page, '[data-qa="opportunity-finder-tool"][data-qa-tool-state="result"]', 'opportunity finder');
  await assertNoToolCrash(page, 'opportunity finder');
  await assertNoOverflow(page, 'opportunity finder result');
  console.log('  ✓ opportunity finder search flow');
  console.log('  ✓ opportunity finder save/remove flow');

  await firstCard.locator('[data-qa="opportunity-generate-cover-letter"]').click();
  await page.locator('[data-qa="toolkit-active-tool"][data-qa-tool="cover-letter"]').waitFor({ timeout: 20_000 });
  // The handoff prefills the input for review; the user still starts generation.
  await page.locator('[data-qa="cover-letter-tool"][data-qa-tool-state="input"]').waitFor({ timeout: 20_000 });
  const handoffContext = await page.locator('[data-qa="cover-letter-job-description"]').inputValue({ timeout: 10_000 });
  assert(handoffContext.includes(`Job Title: ${handoffTitle}`), 'opportunity handoff: expected selected job title in cover-letter context');
  assert(!handoffCompany || handoffContext.includes(`Company: ${handoffCompany}`), 'opportunity handoff: expected selected company in cover-letter context');
  assert(handoffContext.includes('Posting summary:'), 'opportunity handoff: expected posting summary in cover-letter context');
  assert(!/\[[^\]]*(paste|job description|company name|job title)[^\]]*\]/i.test(handoffContext), 'opportunity handoff: bracket placeholder leaked into cover-letter context');
  await page.locator('[data-qa="cover-letter-generate"]').click();
  await page.locator('[data-qa="cover-letter-tool"][data-qa-tool-state="result"]').waitFor({ timeout: 60_000 });
  await waitForToolResultWrite('cover-letter', 'opportunity cover-letter handoff');
  await page.locator('[data-qa="cover-letter-tool"][data-qa-tool-state="result"]').locator('[data-qa="tool-remove-saved"]').click();
  await waitForToolResultClear('cover-letter', 'opportunity cover-letter handoff');
  await assertNoToolCrash(page, 'opportunity cover-letter handoff');
  console.log('  ✓ opportunity to cover letter handoff uses real job context');

  await returnToLibrary(page);
  const emailCard = await openFirstOpportunityCard(page);
  await emailCard.firstCard.locator('[data-qa="opportunity-draft-email"]').click();
  await page.locator('[data-qa="toolkit-active-tool"][data-qa-tool="email-crafter"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="email-crafter-tool"][data-qa-tool-state="input"]').waitFor({ timeout: 20_000 });
  await expectInputValue(page, '[data-qa="email-detail-job_title"]', emailCard.title);
  if (emailCard.company) await expectInputValue(page, '[data-qa="email-detail-company_name"]', emailCard.company);
  await assertNoToolCrash(page, 'opportunity email handoff');
  console.log('  ✓ opportunity to email crafter handoff prefills application draft');

  await returnToLibrary(page);
  const interviewCard = await openFirstOpportunityCard(page);
  await interviewCard.firstCard.locator('[data-qa="opportunity-start-mock-interview"]').click();
  await page.locator('[data-qa="toolkit-active-tool"][data-qa-tool="mock-interview"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="interview-simulator"][data-qa-interview-stage="setup"]').waitFor({ timeout: 20_000 });
  await expectInputValue(page, '[data-qa="mock-interview-job-title"]', interviewCard.title);
  if (interviewCard.company) await expectInputValue(page, '[data-qa="mock-interview-company-name"]', interviewCard.company);
  const jobDescription = await page.locator('[data-qa="mock-interview-job-description"]').inputValue();
  assert(jobDescription.trim().length > 0, 'opportunity mock interview handoff: expected posting summary in job description');
  await assertNoToolCrash(page, 'opportunity mock interview handoff');
  console.log('  ✓ opportunity to mock interview handoff prefills setup');

  await returnToLibrary(page);
  const networkingCard = await openFirstOpportunityCard(page);
  await networkingCard.firstCard.locator('[data-qa="opportunity-plan-networking"]').click();
  await page.locator('[data-qa="toolkit-active-tool"][data-qa-tool="networking-assistant"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="networking-assistant-tool"][data-qa-tool-state="input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="networking-assistant-prefill-note"]').waitFor({ timeout: 10_000 });
  await expectInputValue(page, '[data-qa="networking-target-role"]', networkingCard.title);
  if (networkingCard.company) await expectInputValue(page, '[data-qa="networking-target-company"]', networkingCard.company);
  const networkingLocation = await page.locator('[data-qa="networking-target-location"]').inputValue();
  assert(networkingLocation.trim().length > 0, 'opportunity networking handoff: expected selected opportunity location');
  await assertNoToolCrash(page, 'opportunity networking handoff');
  await assertNoOverflow(page, 'opportunity networking handoff');
  console.log('  ✓ opportunity to networking assistant handoff prefills outreach plan');
  await returnToLibrary(page);
}

async function runOpportunitySalaryHandoff(page) {
  const { firstCard, title, company } = await openFirstOpportunityCard(page, { runSearch: true });
  await firstCard.locator('[data-qa="opportunity-open-salary-negotiation"]').waitFor({ timeout: 10_000 });
  await firstCard.locator('[data-qa="opportunity-open-salary-negotiation"]').click();
  await page.locator('[data-qa="toolkit-active-tool"][data-qa-tool="salary-negotiation"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="salary-negotiator-tool"][data-qa-tool-state="input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="salary-negotiator-prefill-note"]').waitFor({ timeout: 10_000 });
  await expectInputValue(page, '[data-qa="salary-job-title"]', title);
  if (company) await expectInputValue(page, '[data-qa="salary-company"]', company);
  const offer = await page.locator('[data-qa="salary-offer"]').inputValue();
  const currency = await page.locator('[data-qa="salary-currency"]').inputValue();
  assert(Number(offer) > 0, 'opportunity salary handoff: expected parsed salary offer');
  assert(currency === 'CAD', `opportunity salary handoff: expected CAD currency, got ${currency}`);
  await page.locator('[data-qa="salary-negotiator-generate"]').click();
  await page.locator('[data-qa="salary-negotiator-tool"][data-qa-tool-state="result"]').waitFor({ timeout: 60_000 });
  await assertResultHasSampleText(page, '[data-qa="salary-negotiator-tool"][data-qa-tool-state="result"]', 'opportunity salary handoff');
  await waitForToolResultWrite('salary-negotiation', 'opportunity salary handoff');
  await page.locator('[data-qa="salary-negotiator-tool"][data-qa-tool-state="result"]').locator('[data-qa="tool-remove-saved"]').click();
  await waitForToolResultClear('salary-negotiation', 'opportunity salary handoff');
  await assertNoToolCrash(page, 'opportunity salary handoff');
  await assertNoOverflow(page, 'opportunity salary handoff');
  console.log('  ✓ opportunity to salary negotiator handoff prefills offer context');
  await returnToLibrary(page);
}

async function runPerformanceReview(page) {
  await openTool(page, 'performance-review-prep');
  await page.locator('[data-qa="performance-review-prep-tool"][data-qa-tool-state="input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="performance-review-prep-try-example"]').click();
  const jobTitle = await page.locator('[data-qa="performance-review-job-title"]').inputValue();
  const accomplishments = await page.locator('[data-qa="performance-review-accomplishments"]').inputValue();
  assert(jobTitle && accomplishments, 'performance review prep: try example did not populate all fields');
  await page.locator('[data-qa="performance-review-prep-generate"]').click();
  await page.locator('[data-qa="performance-review-prep-tool"][data-qa-tool-state="result"]').waitFor({ timeout: 60_000 });
  await assertResultHasSampleText(page, '[data-qa="performance-review-prep-tool"][data-qa-tool-state="result"]', 'performance review prep');
  await assertSavedToolResultRestore(page, 'performance-review-prep', 'performance review prep', '[data-qa="performance-review-prep-tool"][data-qa-tool-state="result"]');
  await assertNoToolCrash(page, 'performance review prep');
  await assertNoOverflow(page, 'performance review prep result');
  console.log('  ✓ performance review prep save and restore flow');
  await returnToLibrary(page);
}

async function runSalaryNegotiation(page) {
  await openTool(page, 'salary-negotiation');
  await page.locator('[data-qa="salary-negotiator-tool"][data-qa-tool-state="input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="salary-negotiator-try-example"]').click();
  const jobTitle = await page.locator('[data-qa="salary-job-title"]').inputValue();
  const company = await page.locator('[data-qa="salary-company"]').inputValue();
  const offer = await page.locator('[data-qa="salary-offer"]').inputValue();
  assert(jobTitle && company && offer, 'salary negotiation: try example did not populate all fields');
  await page.locator('[data-qa="salary-negotiator-generate"]').click();
  await page.locator('[data-qa="salary-negotiator-tool"][data-qa-tool-state="result"]').waitFor({ timeout: 60_000 });
  await assertResultHasSampleText(page, '[data-qa="salary-negotiator-tool"][data-qa-tool-state="result"]', 'salary negotiation');
  await assertSavedToolResultRestore(page, 'salary-negotiation', 'salary negotiation', '[data-qa="salary-negotiator-tool"][data-qa-tool-state="result"]');
  await assertNoToolCrash(page, 'salary negotiation');
  await assertNoOverflow(page, 'salary negotiation result');
  console.log('  ✓ salary negotiation save and restore flow');
  await returnToLibrary(page);
}

async function runSalaryEmailHandoff(page) {
  await openTool(page, 'salary-negotiation');
  await page.locator('[data-qa="salary-negotiator-tool"][data-qa-tool-state="input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="salary-negotiator-try-example"]').click();
  const jobTitle = await page.locator('[data-qa="salary-job-title"]').inputValue();
  const company = await page.locator('[data-qa="salary-company"]').inputValue();
  await page.locator('[data-qa="salary-negotiator-generate"]').click();
  await page.locator('[data-qa="salary-negotiator-tool"][data-qa-tool-state="result"]').waitFor({ timeout: 60_000 });
  await page.locator('[data-qa="salary-open-email-crafter"]').click();
  await page.locator('[data-qa="toolkit-active-tool"][data-qa-tool="email-crafter"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="email-crafter-tool"][data-qa-tool-state="input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="email-crafter-prefill-note"]').waitFor({ timeout: 10_000 });
  await page.locator('[data-qa="email-crafter-scenario-salary"][aria-pressed="true"]').waitFor({ timeout: 10_000 });
  await expectInputValue(page, '[data-qa="email-detail-company_name"]', company);
  await expectInputValue(page, '[data-qa="email-detail-job_title"]', jobTitle);
  const currentOffer = await page.locator('[data-qa="email-detail-current_offer"]').inputValue();
  const targetRange = await page.locator('[data-qa="email-detail-target_range"]').inputValue();
  const messageContext = await page.locator('[data-qa="email-detail-message_context_optional"]').inputValue();
  assert(currentOffer.trim().length > 0, 'salary email handoff: expected current offer context');
  assert(targetRange.trim().length > 0, 'salary email handoff: expected target range context');
  assert(messageContext.includes('Existing draft:'), 'salary email handoff: expected generated counter-offer draft in message context');
  await page.locator('[data-qa="email-crafter-generate"]').click();
  await page.locator('[data-qa="email-crafter-tool"][data-qa-tool-state="result"]').waitFor({ timeout: 60_000 });
  await assertResultHasSampleText(page, '[data-qa="email-crafter-tool"][data-qa-tool-state="result"]', 'salary email handoff');
  await waitForToolResultWrite('email-crafter', 'salary email handoff');
  await page.locator('[data-qa="email-crafter-tool"][data-qa-tool-state="result"]').locator('[data-qa="tool-remove-saved"]').click();
  await waitForToolResultClear('email-crafter', 'salary email handoff');
  await assertNoToolCrash(page, 'salary email handoff');
  await assertNoOverflow(page, 'salary email handoff');
  console.log('  ✓ salary negotiator opens editable email crafter draft');
  await returnToLibrary(page);
}

async function runPortfolioWebsiteBuilder(page) {
  const savedName = `Smoke Portfolio ${Date.now()}`;
  await openTool(page, 'website-builder');
  await page.locator('[data-qa="portfolio-builder-tool"][data-qa-tool-state="template"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="portfolio-template-sapphire"]').click();
  await page.locator('[data-qa="portfolio-builder-tool"][data-qa-tool-state="details"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="portfolio-tagline"]').fill('Frontend engineer focused on reliable candidate tools');
  await page.locator('[data-qa="portfolio-bio"]').fill('Casey builds React and TypeScript workflows for candidate-facing hiring products, with a focus on accessibility, clear user feedback, and dependable integrations.');
  await page.locator('[data-qa="portfolio-project-title-0"]').fill('Career CoPilot Toolkit');
  await page.locator('[data-qa="portfolio-project-category-0"]').fill('Web');
  await page.locator('[data-qa="portfolio-project-description-0"]').fill('A workspace of resume, interview, opportunity, and portfolio tools connected to Firebase callable services.');
  await page.locator('[data-qa="portfolio-generate"]').click();
  await page.locator('[data-qa="portfolio-builder-tool"][data-qa-tool-state="result"]').waitFor({ timeout: 60_000 });
  await page.locator('[data-qa="portfolio-builder-tool"][data-qa-tool-state="result"] iframe[title="Showcase Preview"]').waitFor({ timeout: 20_000 });
  const previewText = await page.frameLocator('[data-qa="portfolio-builder-tool"][data-qa-tool-state="result"] iframe[title="Showcase Preview"]').locator('body').textContent({ timeout: 10_000 });
  assert((previewText || '').includes('Sample') || (previewText || '').includes('Career CoPilot Toolkit'), 'portfolio builder: expected generated preview content');
  await page.locator('[data-qa="portfolio-save-name"]').fill(savedName);
  await page.locator('[data-qa="portfolio-save"]').click();
  await page.locator('[data-qa="portfolio-save-status"]').waitFor({ timeout: 30_000 });
  await waitForSavedPortfolio(savedName);

  await page.goto(`${BASE_URL}/workspace/portfolio`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-qa-workspace-view="portfolio"]').waitFor({ timeout: 30_000 });
  const savedCard = page.locator('[data-qa="showcase-saved-card"]').filter({ hasText: savedName }).first();
  await savedCard.waitFor({ timeout: 30_000 });
  await savedCard.click();
  await page.locator('iframe[title="Showcase Preview"]').waitFor({ timeout: 30_000 });
  const savedPreviewText = await page.frameLocator('iframe[title="Showcase Preview"]').locator('body').textContent({ timeout: 10_000 });
  assert((savedPreviewText || '').includes('Career CoPilot Toolkit'), 'portfolio builder: expected saved portfolio preview content');
  await page.locator('[data-qa="showcase-delete-button"]').click();
  await page.locator('[data-qa="showcase-delete-dialog"]').waitFor({ timeout: 10_000 });
  await page.locator('[data-qa="showcase-delete-confirm"]').click();
  await waitForSavedPortfolioClear(savedName);
  await page.locator('[data-qa="showcase-empty-state"]').waitFor({ timeout: 30_000 });
  const deletedCards = await page.locator('[data-qa="showcase-saved-card"]').filter({ hasText: savedName }).count();
  assert(deletedCards === 0, 'portfolio builder: deleted saved portfolio still rendered');

  await page.locator('[data-qa="showcase-tab-build"]').click();
  await page.locator('[data-qa="portfolio-builder-tool"][data-qa-tool-state="template"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="portfolio-template-sapphire"]').click();
  await page.locator('[data-qa="portfolio-builder-tool"][data-qa-tool-state="details"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="portfolio-tagline"]').fill('Candidate tools with clear save and review states');
  await page.locator('[data-qa="portfolio-bio"]').fill('Casey builds user-facing hiring tools with reliable state handling, accessible feedback, and dependable Firebase integration.');
  await page.locator('[data-qa="portfolio-project-title-0"]').fill('Showcase Unsaved Guard');
  await page.locator('[data-qa="portfolio-project-category-0"]').fill('Web');
  await page.locator('[data-qa="portfolio-project-description-0"]').fill('A portfolio workspace flow that protects unsaved generated previews before leaving the builder.');
  await page.locator('[data-qa="portfolio-generate"]').click();
  await page.locator('[data-qa="portfolio-builder-tool"][data-qa-tool-state="result"]').waitFor({ timeout: 60_000 });
  await page.locator('[data-qa="showcase-tab-mine"]').click();
  await page.locator('[data-qa="showcase-unsaved-leave-dialog"]').waitFor({ timeout: 10_000 });
  await page.locator('[data-qa="showcase-unsaved-leave-dialog-cancel"]').click();
  await page.locator('[data-qa="portfolio-builder-tool"][data-qa-tool-state="result"]').waitFor({ timeout: 10_000 });
  await page.locator('[data-qa="showcase-tab-mine"]').click();
  await page.locator('[data-qa="showcase-unsaved-leave-dialog-confirm"]').click();
  await page.locator('[data-qa="showcase-empty-state"]').waitFor({ timeout: 20_000 });
  const unsavedCards = await page.locator('[data-qa="showcase-saved-card"]').filter({ hasText: 'Showcase Unsaved Guard' }).count();
  assert(unsavedCards === 0, 'portfolio builder: unsaved generated portfolio should not appear in saved list');
  await assertNoToolCrash(page, 'portfolio builder');
  await assertNoOverflow(page, 'portfolio builder result');
  console.log('  ✓ portfolio website builder save, reopen, and delete flow');
  console.log('  ✓ showcase unsaved generated portfolio guard flow');
}

async function runEnglishProWritten(page) {
  await openTool(page, 'english-pro');
  await page.locator('[data-qa="english-pro-tool"][data-qa-english-mode="hub"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="english-pro-mode-written"]').click();
  await page.locator('[data-qa="english-pro-tool"][data-qa-english-mode="written"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="english-pro-written-topic-1"]').click();
  const writingPrompt = await page.locator('[data-qa="english-pro-written-input"]').inputValue();
  assert(writingPrompt.trim().length > 0, 'english pro: topic shortcut did not populate writing input');
  await page.locator('[data-qa="english-pro-written-analyze"]').click();
  await page.locator('[data-qa="english-pro-written-result"]').waitFor({ timeout: 60_000 });
  await assertResultHasSampleText(page, '[data-qa="english-pro-written-result"]', 'english pro written analysis');
  await waitForToolResultWrite('english-pro', 'english pro written analysis');
  await expectSaveStatus(page.locator('[data-qa="english-pro-written-result"] [data-qa="tool-save-status"]'), /Saved/, 'english pro: expected written result save status');
  await returnToLibrary(page);

  await openTool(page, 'english-pro');
  await page.locator('[data-qa="english-pro-tool"][data-qa-english-mode="written"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="english-pro-written-result"]').waitFor({ timeout: 20_000 });
  await expectSaveStatus(page.locator('[data-qa="english-pro-written-result"] [data-qa="tool-save-status"]'), /Saved/, 'english pro: expected saved written result to restore on reopen');
  await page.locator('[data-qa="english-pro-written-result"] [data-qa="tool-remove-saved"]').click();
  await waitForToolResultClear('english-pro', 'english pro written analysis');
  await expectSaveStatus(page.locator('[data-qa="english-pro-written-result"] [data-qa="tool-save-status"]'), /Not saved/, 'english pro: expected cleared save status');
  await assertNoToolCrash(page, 'english pro');
  await assertNoOverflow(page, 'english pro written result');
  console.log('  ✓ english pro written analysis save and restore flow');
  await returnToLibrary(page);
}

async function runEnglishProListening(page) {
  await openTool(page, 'english-pro');
  await page.locator('[data-qa="english-pro-tool"][data-qa-english-mode="hub"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="english-pro-mode-listening"]').click();
  await page.locator('[data-qa="english-pro-tool"][data-qa-english-mode="listening"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="english-pro-listening-transcription"]').fill("Good morning, this is Sarah from the marketing department. I'm calling to follow up on the proposal we sent over last week.");
  await page.locator('[data-qa="english-pro-listening-check"]').click();
  await page.locator('[data-qa="english-pro-listening-result"]').waitFor({ timeout: 60_000 });
  await assertResultHasSampleText(page, '[data-qa="english-pro-listening-result"]', 'english pro listening analysis');
  await waitForToolResultWrite('english-pro', 'english pro listening analysis');
  await expectSaveStatus(page.locator('[data-qa="english-pro-listening-result"] [data-qa="tool-save-status"]'), /Saved/, 'english pro: expected listening result save status');
  await returnToLibrary(page);

  await openTool(page, 'english-pro');
  await page.locator('[data-qa="english-pro-tool"][data-qa-english-mode="listening"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="english-pro-listening-result"]').waitFor({ timeout: 20_000 });
  await expectSaveStatus(page.locator('[data-qa="english-pro-listening-result"] [data-qa="tool-save-status"]'), /Saved/, 'english pro: expected saved listening result to restore on reopen');
  const restoredOriginal = await page.locator('[data-qa="english-pro-listening-original"]').textContent({ timeout: 5_000 });
  assert((restoredOriginal || '').includes('Sample'), 'english pro: expected restored listening answer key');
  await page.locator('[data-qa="english-pro-listening-result"] [data-qa="tool-remove-saved"]').click();
  await waitForToolResultClear('english-pro', 'english pro listening analysis');
  await expectSaveStatus(page.locator('[data-qa="english-pro-listening-result"] [data-qa="tool-save-status"]'), /Not saved/, 'english pro: expected cleared listening save status');
  await assertNoToolCrash(page, 'english pro listening');
  await assertNoOverflow(page, 'english pro listening result');
  console.log('  ✓ english pro listening analysis save and restore flow');
  await returnToLibrary(page);
}

async function runEnglishProReadingAnalysis(page) {
  await openTool(page, 'english-pro');
  await page.locator('[data-qa="english-pro-tool"][data-qa-english-mode="hub"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="english-pro-mode-reading"]').click();
  await page.locator('[data-qa="english-pro-tool"][data-qa-english-mode="reading"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="english-pro-reading-comprehension"]').click();
  await page.locator('[data-qa="english-pro-reading-input"]').fill('Career CoPilot helps candidates compare roles, practice interviews, and keep saved work available across tool sessions.');
  await page.locator('[data-qa="english-pro-reading-analyze"]').click();
  await page.locator('[data-qa="english-pro-reading-result"]').waitFor({ timeout: 60_000 });
  await assertResultHasSampleText(page, '[data-qa="english-pro-reading-result"]', 'english pro reading analysis');
  await waitForToolResultWrite('english-pro', 'english pro reading analysis');
  await expectSaveStatus(page.locator('[data-qa="english-pro-reading-result"] [data-qa="tool-save-status"]'), /Saved/, 'english pro: expected reading result save status');

  await page.locator('[data-qa="english-pro-reading-answer-1"]').fill('It helps candidates compare roles and keep saved work across tool sessions.');
  await page.locator('[data-qa="english-pro-reading-check"]').click();
  await page.locator('[data-qa="english-pro-reading-evaluation-1"]').waitFor({ timeout: 60_000 });
  const evaluationText = await page.locator('[data-qa="english-pro-reading-evaluation-1"]').textContent({ timeout: 5_000 });
  assert((evaluationText || '').includes('Sample'), 'english pro: expected reading evaluation feedback');
  await waitForToolResultWrite('english-pro', 'english pro reading evaluation');
  await returnToLibrary(page);

  await openTool(page, 'english-pro');
  await page.locator('[data-qa="english-pro-tool"][data-qa-english-mode="reading"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="english-pro-reading-result"]').waitFor({ timeout: 20_000 });
  await expectSaveStatus(page.locator('[data-qa="english-pro-reading-result"] [data-qa="tool-save-status"]'), /Saved/, 'english pro: expected saved reading result to restore on reopen');
  const restoredPassage = await page.locator('[data-qa="english-pro-reading-passage"]').textContent({ timeout: 5_000 });
  assert((restoredPassage || '').includes('Career CoPilot'), 'english pro: expected restored reading passage');
  await page.locator('[data-qa="english-pro-reading-evaluation-1"]').waitFor({ timeout: 10_000 });
  await page.locator('[data-qa="english-pro-reading-result"] [data-qa="tool-remove-saved"]').click();
  await waitForToolResultClear('english-pro', 'english pro reading analysis');
  await expectSaveStatus(page.locator('[data-qa="english-pro-reading-result"] [data-qa="tool-save-status"]'), /Not saved/, 'english pro: expected cleared reading save status');
  await assertNoToolCrash(page, 'english pro reading analysis');
  await assertNoOverflow(page, 'english pro reading result');
  console.log('  ✓ english pro reading analysis save, evaluation, and restore flow');
  await returnToLibrary(page);
}

async function runEnglishProReadingDiscardGuard(page) {
  await openTool(page, 'english-pro');
  await page.locator('[data-qa="english-pro-tool"][data-qa-english-mode="hub"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="english-pro-mode-reading"]').click();
  await page.locator('[data-qa="english-pro-tool"][data-qa-english-mode="reading"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="english-pro-reading-comprehension"]').click();
  await page.locator('[data-qa="english-pro-reading-input"]').fill('This candidate wants to practice concise workplace reading responses before interviews.');

  await page.locator('[data-qa="english-pro-reading-back-options"]').click();
  await page.locator('[data-qa="english-pro-discard-confirm"]').waitFor({ timeout: 10_000 });
  await page.locator('[data-qa="english-pro-discard-confirm-cancel"]').click();
  await page.locator('[data-qa="english-pro-discard-confirm"]').waitFor({ state: 'hidden', timeout: 10_000 });
  const preservedInput = await page.locator('[data-qa="english-pro-reading-input"]').inputValue();
  assert(preservedInput.includes('concise workplace reading'), 'english pro reading: cancel should preserve draft progress');

  await page.locator('[data-qa="english-pro-reading-back-options"]').click();
  await page.locator('[data-qa="english-pro-discard-confirm-confirm"]').click();
  await page.locator('[data-qa="english-pro-reading-comprehension"]').waitFor({ timeout: 10_000 });

  await page.locator('[data-qa="english-pro-reading-comprehension"]').click();
  await page.locator('[data-qa="english-pro-reading-input"]').fill('A second draft verifies the hub path also protects in-progress reading work.');
  await page.locator('[data-qa="english-pro-reading-back-hub"]').click();
  await page.locator('[data-qa="english-pro-discard-confirm"]').waitFor({ timeout: 10_000 });
  await page.locator('[data-qa="english-pro-discard-confirm-confirm"]').click();
  await page.locator('[data-qa="english-pro-tool"][data-qa-english-mode="hub"]').waitFor({ timeout: 10_000 });

  await assertNoToolCrash(page, 'english pro reading discard guard');
  await assertNoOverflow(page, 'english pro reading discard guard');
  console.log('  ✓ english pro reading discard guard flow');
  await returnToLibrary(page);
}

async function runLearningPlan(page) {
  await openTool(page, 'skill-learning-plan');
  await page.locator('[data-qa="skill-learning-plan-tool"][data-qa-tool-state="input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-qa="skill-learning-plan-skill"]').fill('Data storytelling');
  await page.locator('[data-qa="skill-learning-plan-generate"]').click();
  await page.locator('[data-qa="skill-learning-plan-tool"][data-qa-tool-state="result"]').waitFor({ timeout: 60_000 });
  const text = await page.locator('[data-qa="skill-learning-plan-tool"][data-qa-tool-state="result"]').textContent();
  assert((text || '').includes('Sample'), 'learning plan: expected stubbed result content');
  await assertSavedToolResultRestore(page, 'skill-learning-plan', 'learning plan', '[data-qa="skill-learning-plan-tool"][data-qa-tool-state="result"]');
  await assertNoToolCrash(page, 'learning plan');
  await assertNoOverflow(page, 'learning plan result');
  console.log('  ✓ learning plan generation save and restore flow');
  await returnToLibrary(page);
}

const toolSmokeRunners = {
  'career-goals': runCareerGoalsPersistence,
  'cover-letter': runCoverLetter,
  'cover-letter-resume': runCoverLetterResumeFormatterHandoff,
  'email-crafter': runEmailCrafter,
  'recent-app-prefill': runRecentApplicationPrefill,
  'career-path': runCareerPath,
  'career-path-portfolio': runCareerPathPortfolioHandoff,
  'career-path-learning': runCareerPathLearningHandoff,
  'resume-formatter': runResumeFormatter,
  'resume-linkedin': runResumeFormatterLinkedInHandoff,
  'linkedin-optimizer': runLinkedInOptimizer,
  'mock-interview': runMockInterviewSessionReport,
  'interview-prep': runInterviewPrep,
  'agile-coach': runAgileCoach,
  'networking-assistant': runNetworkingAssistant,
  'networking-email': runNetworkingEmailHandoff,
  'industry-event-scout': runIndustryEventScout,
  'event-email': runIndustryEventEmailHandoff,
  'opportunity-finder': runOpportunityFinder,
  'opportunity-salary': runOpportunitySalaryHandoff,
  'performance-review-prep': runPerformanceReview,
  'salary-negotiation': runSalaryNegotiation,
  'salary-email': runSalaryEmailHandoff,
  'website-builder': runPortfolioWebsiteBuilder,
  'english-pro-written': runEnglishProWritten,
  'english-pro-listening': runEnglishProListening,
  'english-pro-reading': runEnglishProReadingAnalysis,
  'english-pro-discard': runEnglishProReadingDiscardGuard,
  'skill-learning-plan': runLearningPlan,
};

async function main() {
  assert(process.env.E2E_LLM_STUB === 'true', 'E2E_LLM_STUB=true is required for smoke:tool-execution.');
  assertToolSmokeCoverage();
  await seedCandidate();

  const vite = startVite();
  try {
    await waitForServer(BASE_URL);
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1365, height: 820 } });
      const page = await context.newPage();
      const consoleErrors = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error' && !isNonBlockingSmokeConsoleError(msg.text())) consoleErrors.push(msg.text());
      });

      try {
        await signInCandidate(page);
        await assertToolkitInventory(page);
        if (ONLY_TOOL) {
          const runner = toolSmokeRunners[ONLY_TOOL];
          assert(runner, `Unknown TOOL_SMOKE_ONLY="${ONLY_TOOL}". Available: ${Object.keys(toolSmokeRunners).join(', ')}`);
          await runner(page);
        } else {
          await runCareerGoalsPersistence(page);
          await runCoverLetter(page);
          await runCoverLetterResumeFormatterHandoff(page);
          await runEmailCrafter(page);
          await runRecentApplicationPrefill(page);
          await runCareerPath(page);
          await runCareerPathPortfolioHandoff(page);
          await runCareerPathLearningHandoff(page);
          await runResumeFormatter(page);
          await runResumeFormatterLinkedInHandoff(page);
          await runLinkedInOptimizer(page);
          await runMockInterviewSessionReport(page);
          await runInterviewPrep(page);
          await runAgileCoach(page);
          await runNetworkingAssistant(page);
          await runNetworkingEmailHandoff(page);
          await runIndustryEventScout(page);
          await runIndustryEventEmailHandoff(page);
          await runOpportunityFinder(page);
          await runOpportunitySalaryHandoff(page);
          await runPerformanceReview(page);
          await runSalaryNegotiation(page);
          await runSalaryEmailHandoff(page);
          await runPortfolioWebsiteBuilder(page);
          await runEnglishProWritten(page);
          await runEnglishProListening(page);
          await runEnglishProReadingAnalysis(page);
          await runEnglishProReadingDiscardGuard(page);
          await runLearningPlan(page);
        }
        assert(consoleErrors.length === 0, `tool execution console errors:\n${consoleErrors.join('\n')}`);
      } catch (error) {
        await screenshot(page, 'tool-execution-smoke');
        throw error;
      } finally {
        await context.close();
      }
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
