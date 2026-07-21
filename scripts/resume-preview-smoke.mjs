/**
 * Resume preview smoke test.
 *
 * Runs against Firebase emulators. It locks the localized resume-preview class:
 * saved Resume Formatter outputs restore their target market, render the correct
 * regional style, avoid horizontal overflow on desktop/mobile, and keep CJK/Japan
 * cleanups from regressing into a giant one-line blob with photo/table fields.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { configureFirebaseScript } from './lib/firebase-script-safety.mjs';
import { isNonBlockingSmokeConsoleError } from './lib/smoke-console-filters.mjs';

const firebaseTarget = configureFirebaseScript({ scriptName: 'resume-preview-smoke' });

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = process.env.RESUME_PREVIEW_SMOKE_BASE_URL || 'http://127.0.0.1:4182';
const PROJECT_ID = firebaseTarget.projectId;
const PASSWORD = 'QaSeed!2026';
const CANDIDATE_EMAIL = 'candidate@careercopilot.test';
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

const CASES = [
  {
    market: 'Canada',
    expectedRegion: 'north-america',
    expectedPageSize: 'letter',
    expectedSections: ['SUMMARY', 'EXPERIENCE', 'EDUCATION'],
    formattedText:
      'Kai Wang\nOttawa, ON | +1 (302) 254-7015 | jackson@example.com | https://kairwang.cloud\n\nSUMMARY\nProject management candidate with engineering and product collaboration experience.\n\nEXPERIENCE\nCareer CoPilot — Product Operations Lead\n• Led a 6-person team to ship resume analysis, interview practice, and job matching modules.\n• Reduced manual review effort by standardizing Jira workflows and acceptance criteria.\n\nEDUCATION\nUniversity of Ottawa — M.Eng., Electrical and Computer Engineering | GPA: 4.0/4.0',
  },
  {
    market: 'Japan',
    expectedRegion: 'japan',
    expectedPageSize: 'a4',
    expectedSections: ['志望動機', '学歴'],
    forbiddenText: ['写真', '証明写真', '年月', '学校名', '専攻', '成績', '----'],
    formattedText:
      '氏名：王铂凯（おうはくがい） 電話番号：130-2254-7015 メールアドレス：jackson@example.com 所在地：カナダ、オタワ ウェブサイト：https://kairwang.cloud 写真：[ここに証明写真を貼付] ■ 志望動機 プロジェクトマネジメントおよびプロダクト開発支援を専門とする候補者として、ソフトウェア開発、アジャイルプロセス、ユーザー調査、データ分析、およびチーム間協働の実務経験を有しています。 ■ 学歴 | 年月 | 学校名 | 専攻 | 成績 | 2025年09月〜2027年06月（予定） | オタワ大学 | 電気・コンピュータ工学 | GPA 4.0/4.0',
  },
  {
    market: 'Germany',
    expectedRegion: 'europe',
    expectedPageSize: 'a4',
    expectedSections: ['Profil', 'Berufserfahrung', 'Ausbildung'],
    formattedText:
      'Kai Wang\nOttawa, Kanada | jackson@example.com | https://kairwang.cloud\n\nProfil\nProjektmanagement-Kandidat mit interdisziplinärem Hintergrund in Elektrotechnik, Computer Engineering und Produktkoordination.\n\nBerufserfahrung\nCareer CoPilot — Projektkoordination\n• Koordinierte Sprint-Planung, Risikoerfassung und Abnahmekriterien für ein AI-Karriereprodukt.\n\nAusbildung\nUniversity of Ottawa — M.Eng. Electrical and Computer Engineering',
  },
  {
    market: 'Singapore',
    expectedRegion: 'apac',
    expectedPageSize: 'a4',
    expectedSections: ['SUMMARY', 'PROJECTS', 'SKILLS'],
    formattedText:
      'Kai Wang\nOttawa, Canada | jackson@example.com | https://kairwang.cloud\n\nSUMMARY\nProduct operations candidate with software delivery, stakeholder coordination, and analytics experience.\n\nPROJECTS\nCareer CoPilot\n• Built workflow tracking and candidate application tooling for a career platform.\n\nSKILLS\nProject Management • Jira • Data Analysis • Python • SQL',
  },
];

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
    [resolve(ROOT, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '4182', '--strictPort'],
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

async function seedSavedFormatterResult(testCase) {
  adminApp();
  const user = await admin.auth().getUserByEmail(CANDIDATE_EMAIL);
  const db = admin.firestore();

  await db.collection('users').doc(user.uid).set(
    {
      role: 'candidate',
      subscription_status: 'essentials',
      credits: 1000,
      resume_text: testCase.formattedText,
      updated_at: new Date().toISOString(),
    },
    { merge: true },
  );

  await db.collection('users').doc(user.uid).collection('tool_results').doc('resume-formatter').set({
    tool_key: 'resume-formatter',
    version: 1,
    result: {
      formattedText: testCase.formattedText,
      targetMarket: testCase.market,
    },
    saved_at: admin.firestore.FieldValue.serverTimestamp(),
  });
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

async function collectPreviewMetrics(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const shell = document.querySelector('[data-qa="resume-preview-shell"]');
    const documentNode = document.querySelector('[data-qa="resume-preview-document"]');
    const readiness = document.querySelector('[data-qa="resume-formatter-readiness"]');
    const bodyTextNodes = [...document.querySelectorAll('[data-qa="resume-preview-document"] p, [data-qa="resume-preview-document"] li')];
    const sectionTitles = [...document.querySelectorAll('[data-qa="resume-preview-section-title"]')]
      .map((node) => node.textContent?.trim() || '')
      .filter(Boolean);
    const readinessItems = [...document.querySelectorAll('[data-qa="resume-formatter-readiness-item"]')]
      .map((node) => ({
        id: node.getAttribute('data-qa-readiness-item') || '',
        severity: node.getAttribute('data-qa-readiness-severity') || '',
      }));
    const paragraphFontSizes = bodyTextNodes
      .map((node) => Number.parseFloat(getComputedStyle(node).fontSize))
      .filter(Number.isFinite);

    return {
      formatterMarket: document.querySelector('[data-qa="resume-formatter"]')?.getAttribute('data-qa-resume-formatter-market') || '',
      region: shell?.getAttribute('data-qa-resume-region') || '',
      pageSize: shell?.getAttribute('data-qa-resume-page-size') || '',
      generatedMarket: document.querySelector('[data-qa="resume-formatter"]')?.getAttribute('data-qa-resume-formatter-generated-market') || '',
      readinessState: readiness?.getAttribute('data-qa-readiness-state') || '',
      readinessItems,
      shellOverflowX: shell ? Math.max(0, shell.scrollWidth - shell.clientWidth) : null,
      documentOverflowX: documentNode ? Math.max(0, documentNode.scrollWidth - documentNode.clientWidth) : null,
      pageOverflowX: Math.max(0, root.scrollWidth - root.clientWidth),
      documentText: documentNode?.textContent || '',
      sectionTitles,
      maxBodyFontSize: paragraphFontSizes.length ? Math.max(...paragraphFontSizes) : 0,
    };
  });
}

async function assertPreviewCase(browser, testCase, viewport) {
  await seedSavedFormatterResult(testCase);

  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isNonBlockingSmokeConsoleError(msg.text())) consoleErrors.push(msg.text());
  });

  const label = `${testCase.market} ${viewport.width}x${viewport.height}`;
  try {
    await signInCandidate(page);
    await page.goto(`${BASE_URL}/workspace/tools?tool=resume-formatter`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-qa="resume-formatter"][data-qa-resume-formatter-state="result"]').waitFor({ timeout: 30_000 });
    await page.locator('[data-qa="resume-preview-document"]').waitFor({ timeout: 20_000 });

    const metrics = await collectPreviewMetrics(page);
    assert(metrics.formatterMarket === testCase.market, `${label}: formatter market ${metrics.formatterMarket}, expected ${testCase.market}`);
    assert(metrics.generatedMarket === testCase.market, `${label}: generated market ${metrics.generatedMarket}, expected ${testCase.market}`);
    assert(metrics.region === testCase.expectedRegion, `${label}: region ${metrics.region}, expected ${testCase.expectedRegion}`);
    assert(metrics.pageSize === testCase.expectedPageSize, `${label}: page size ${metrics.pageSize}, expected ${testCase.expectedPageSize}`);
    assert(metrics.readinessState === 'ready', `${label}: readiness state ${metrics.readinessState}, expected ready`);
    assert(metrics.readinessItems.length >= 4, `${label}: expected readiness checklist items`);
    assert(metrics.pageOverflowX === 0, `${label}: page horizontal overflow ${metrics.pageOverflowX}px`);
    assert(metrics.shellOverflowX === 0, `${label}: preview shell horizontal overflow ${metrics.shellOverflowX}px`);
    assert(metrics.documentOverflowX === 0, `${label}: preview document horizontal overflow ${metrics.documentOverflowX}px`);
    assert(metrics.maxBodyFontSize > 0 && metrics.maxBodyFontSize <= 14.5, `${label}: body text too large (${metrics.maxBodyFontSize}px)`);

    for (const title of testCase.expectedSections) {
      assert(metrics.sectionTitles.includes(title), `${label}: missing section ${title}; got ${metrics.sectionTitles.join(', ')}`);
    }
    for (const forbidden of testCase.forbiddenText || []) {
      assert(!metrics.documentText.includes(forbidden), `${label}: forbidden text survived in preview: ${forbidden}`);
    }

    if (testCase.market === 'Japan' && viewport.width >= 1000) {
      await page.locator('[data-qa="resume-formatter-result-market-select"]').selectOption('Canada');
      const changedMetrics = await collectPreviewMetrics(page);
      assert(changedMetrics.formatterMarket === 'Canada', `${label}: target market did not update after select`);
      assert(changedMetrics.generatedMarket === 'Japan', `${label}: generated market changed before regeneration`);
      assert(changedMetrics.region === 'japan', `${label}: preview style changed before regeneration`);
      assert(changedMetrics.readinessState === 'review', `${label}: readiness should require review after selecting another target`);
      const targetItem = changedMetrics.readinessItems.find((item) => item.id === 'target-market');
      assert(targetItem?.severity === 'review', `${label}: target-market readiness should be review after selecting another target`);
      await expectButtonEnabled(page, '[data-qa="resume-formatter-regenerate-market"]', label);
    }
    assert(consoleErrors.length === 0, `${label}: console errors:\n${consoleErrors.join('\n')}`);
    console.log(`  ✓ ${label} region=${metrics.region} page=${metrics.pageSize} sections=${metrics.sectionTitles.length}`);
  } catch (error) {
    await screenshot(page, `resume-preview-${testCase.market.toLowerCase().replace(/\s+/g, '-')}-${viewport.width}`);
    throw error;
  } finally {
    await context.close();
  }
}

async function expectButtonEnabled(page, selector, label) {
  const disabled = await page.locator(selector).evaluate((button) => button.disabled);
  assert(!disabled, `${label}: regenerate button should enable after selecting a different target market`);
}

async function main() {
  await run((process.env.NODE_BINARY || 'node'), ['scripts/seed-emulator.mjs']);

  const vite = startVite();
  try {
    await waitForServer(BASE_URL);
    const browser = await chromium.launch({ headless: true });
    try {
      for (const testCase of CASES) {
        await assertPreviewCase(browser, testCase, { width: 1365, height: 820 });
      }
      await assertPreviewCase(browser, CASES.find((item) => item.market === 'Japan'), { width: 390, height: 800 });
      await assertPreviewCase(browser, CASES.find((item) => item.market === 'Canada'), { width: 320, height: 720 });
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
