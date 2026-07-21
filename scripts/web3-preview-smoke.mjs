/**
 * Web3 preview credential smoke.
 *
 * Locks the candidate-facing runtime path:
 *   1. Web3 disabled -> Account page does not expose the credential surface.
 *   2. Web3 enabled in preview mode -> candidate can issue a credential.
 *   3. Preview stake toggle persists nft_staked without a real wallet tx.
 *
 * Runs only against Firebase emulators.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { configureFirebaseScript } from './lib/firebase-script-safety.mjs';
import { isNonBlockingSmokeConsoleError } from './lib/smoke-console-filters.mjs';
import { buildWeb3EligibleAnalysis } from './lib/resume-analysis-fixtures.mjs';

const firebaseTarget = configureFirebaseScript({ scriptName: 'web3-preview-smoke' });

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = process.env.WEB3_PREVIEW_SMOKE_BASE_URL || 'http://127.0.0.1:4186';
const PASSWORD = 'QaSeed!2026';
const CANDIDATE_EMAIL = 'candidate@careercopilot.test';
const PROJECT_ID = firebaseTarget.projectId;
const ARTIFACT_DIR = `${ROOT}/output/playwright`;
const WALLET_ADDRESS = '0x1111111111111111111111111111111111111111';
const CONTRACT_ADDRESS = '0x2A3b1A43842238321a22542a035921A362358189';

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
    [resolve(ROOT, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '4186', '--strictPort'],
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

async function waitForUserDoc(db, uid, predicate, label, timeoutMs = 15_000) {
  const started = Date.now();
  let lastData = null;
  while (Date.now() - started < timeoutMs) {
    const snap = await db.collection('users').doc(uid).get();
    lastData = snap.data() ?? null;
    if (predicate(snap)) return snap;
    await new Promise((resolvePoll) => setTimeout(resolvePoll, 250));
  }
  throw new Error(`${label} did not persist within ${timeoutMs}ms. Last user doc: ${JSON.stringify(lastData)}`);
}

function isNonBlockingConsoleError(message, serverErrors) {
  const aiProxyWarmup503 = serverErrors.some((entry) => /^503 .*\/us-central1\/aiProxy\b/.test(entry));
  return aiProxyWarmup503 && message === 'Failed to load resource: the server responded with a status of 503 (Service Unavailable)';
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

async function openAccount(page) {
  await page.locator('[data-qa="candidate-nav-account"]').click();
  await page.getByRole('heading', { name: /^settings$/i }).waitFor({ timeout: 20_000 });
}

async function setWeb3Config(db, update) {
  await db.collection('platform_config').doc('web3').set(
    {
      network: 'sepolia',
      chain_id: 11155111,
      contract_address: CONTRACT_ADDRESS,
      updated_at: new Date().toISOString(),
      updated_by: 'web3-preview-smoke',
      ...update,
    },
    { merge: true },
  );
}

async function seedWeb3Candidate(db, uid) {
  const now = new Date().toISOString();
  await db.collection('users').doc(uid).set(
    {
      role: 'candidate',
      wallet_address: WALLET_ADDRESS,
      resume_text:
        'QA seed resume text for Web3 preview eligibility. Project leadership, measurable delivery, and strong technical evidence.',
      nft_minted: false,
      nft_staked: false,
      nft_earnings: 0,
      nft_token_id: null,
      updated_at: now,
    },
    { merge: true },
  );
  await db.collection('users').doc(uid).collection('resume_analyses').doc('qa-web3-eligible').set(
    buildWeb3EligibleAnalysis({
      createdAt: admin.firestore.Timestamp.now(),
      summary: 'QA seed — high score to unlock the Proof-of-Talent credential.',
    }),
  );
}

function installWalletMock(context) {
  return context.addInitScript((walletAddress) => {
    const normalized = String(walletAddress);
    window.ethereum = {
      request: async ({ method }) => {
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [normalized];
        if (method === 'eth_chainId') return '0xaa36a7';
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
        throw new Error(`Unsupported wallet mock method: ${method}`);
      },
    };
  }, WALLET_ADDRESS);
}

async function assertWeb3PreviewFlow(browser, db, uid) {
  const context = await browser.newContext();
  await installWalletMock(context);
  const page = await context.newPage();
  const consoleErrors = [];
  const serverErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isNonBlockingSmokeConsoleError(msg.text())) consoleErrors.push(msg.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 500) {
      serverErrors.push(`${response.status()} ${response.url()}`);
    }
  });

  try {
    await signInCandidate(page);
    await openAccount(page);

    await setWeb3Config(db, { enabled: false, preview_mode: true });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /^settings$/i }).waitFor({ timeout: 20_000 });
    await page.locator('[data-qa="web3-preview-notice"]').waitFor({ state: 'detached', timeout: 20_000 });
    console.log('  ✓ disabled config hides candidate Web3 surface');

    await setWeb3Config(db, { enabled: true, preview_mode: true });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page
      .locator('[data-qa="web3-preview-notice"]')
      .filter({ hasText: /Sepolia preview/i })
      .waitFor({ timeout: 20_000 });
    await page.locator('[data-qa="web3-credential-offer"][data-state="eligible"]').waitFor({ timeout: 20_000 });
    await page.getByRole('button', { name: /Issue credential/i }).click();
    await page.getByRole('button', { name: /^Continue$/i }).click();
    await page
      .locator('[data-qa="account-web3-notice"]')
      .filter({ hasText: /Proof-of-Talent credential #\d+ is active\./i })
      .waitFor({ timeout: 20_000 });

    const profile = await waitForUserDoc(
      db,
      uid,
      (snap) => snap.get('nft_minted') === true && typeof snap.get('nft_token_id') === 'number',
      'preview mint',
    );
    console.log(`  ✓ preview mint persisted token #${profile.get('nft_token_id')}`);

    await page.getByRole('button', { name: /Activate in Talent Vault/i }).click();
    await page.getByRole('button', { name: /^Continue$/i }).click();
    await page.getByText(/Credential activated in Talent Vault/i).waitFor({ timeout: 20_000 });
    await waitForUserDoc(db, uid, (snap) => snap.get('nft_staked') === true, 'preview stake');
    console.log('  ✓ preview stake persisted nft_staked=true');

    const blockingConsoleErrors = consoleErrors.filter((message) => !isNonBlockingConsoleError(message, serverErrors));
    const blockingServerErrors = serverErrors.filter((entry) => !/^503 .*\/us-central1\/aiProxy\b/.test(entry));
    if (blockingConsoleErrors.length || blockingServerErrors.length) {
      const responseDetails = serverErrors.length ? `\nServer responses:\n${serverErrors.join('\n')}` : '';
      const consoleDetails = blockingConsoleErrors.length ? `Console errors during Web3 preview smoke:\n${blockingConsoleErrors.join('\n')}` : 'Server errors during Web3 preview smoke.';
      throw new Error(`${consoleDetails}${responseDetails}`);
    }
  } catch (error) {
    console.error('Web3 smoke URL:', page.url());
    if (consoleErrors.length) console.error(`Console errors:\n${consoleErrors.join('\n')}`);
    if (serverErrors.length) console.error(`Server responses:\n${serverErrors.join('\n')}`);
    await screenshot(page, 'web3-preview-smoke');
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
  await seedWeb3Candidate(db, candidate.uid);
  await setWeb3Config(db, { enabled: false, preview_mode: true });

  const vite = startVite();
  try {
    await waitForServer(BASE_URL);
    const browser = await chromium.launch({ headless: true });
    try {
      await assertWeb3PreviewFlow(browser, db, candidate.uid);
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
