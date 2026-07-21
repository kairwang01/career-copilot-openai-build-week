/**
 * Product screenshot capture for the marketing site (SCRUM-33).
 *
 * Boots the real app against the Firebase emulators, seeds realistic (clearly
 * demo) candidate/employer data, and captures the four launch surfaces:
 *   1. Resume Readiness Report      (/workspace/resume)
 *   2. Career Path Planner result   (/workspace/tools?tool=career-path)
 *   3. Interview Practice feedback  (mock-interview session history detail)
 *   4. Employer Candidate Match     (/portal applicant funnel)
 *
 * Run inside `firebase emulators:exec` (see .github/workflows/product-screenshots.yml).
 * Output: output/product-screenshots/*.png at 2x device scale for crisp
 * marketing embeds. This is a capture tool, not a release gate.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { configureFirebaseScript } from './lib/firebase-script-safety.mjs';

const firebaseTarget = configureFirebaseScript({ scriptName: 'capture-product-screenshots' });

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = process.env.PRODUCT_SHOTS_BASE_URL || 'http://127.0.0.1:4189';
const PROJECT_ID = firebaseTarget.projectId;
const PASSWORD = 'QaSeed!2026';
const CANDIDATE_EMAIL = 'candidate@careercopilot.test';
const EMPLOYER_EMAIL = 'employer@careercopilot.test';
const OUT_DIR = `${ROOT}/output/product-screenshots`;

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

const RESUME_TEXT = [
  'Avery Chen - Frontend Engineer',
  'Toronto, ON | avery.chen@example.com',
  '',
  'SUMMARY',
  'Frontend engineer with four years of experience shipping React applications, design systems, and accessibility improvements for customer-facing products.',
  '',
  'EXPERIENCE',
  'Frontend Engineer, Northbridge Software (2023-present)',
  '- Led the rebuild of the onboarding flow in React and TypeScript, lifting activation by 18%.',
  '- Introduced component-level performance budgets and cut route-level bundle size by 32%.',
  'UI Developer, Lakeview Digital (2021-2023)',
  '- Delivered a WCAG 2.1 AA accessibility pass across the billing and account surfaces.',
  '',
  'EDUCATION',
  'B.Sc. Computer Science, University of Waterloo',
].join('\n');

const ANALYSIS_FIXTURE = {
  score: 82,
  market_name: 'Canada',
  summary:
    'A strong mid-level frontend resume with clear, quantified delivery. The experience section reads like an impact log rather than a duty list, which is exactly what Canadian tech screeners look for. The next gains come from tightening the summary around a target role and surfacing collaboration signals for cross-functional work.',
  strengths: [
    'Quantified outcomes in every role (activation lift, bundle-size reduction)',
    'Modern, in-demand stack: React, TypeScript, design systems',
    'Accessibility delivery experience is rare and valued',
    'Clean reverse-chronological structure that parses well in ATS scans',
  ],
  improvements: [
    {
      area: 'Target-role alignment',
      suggestion: 'Name the role you want in the summary line and mirror the language of senior frontend postings you are applying to.',
    },
    {
      area: 'Collaboration evidence',
      suggestion: 'Add one bullet showing how you worked with design and product to ship the onboarding rebuild.',
    },
    {
      area: 'Keyword coverage',
      suggestion: 'Postings in your market frequently list testing (Playwright, Vitest) and CI ownership - reflect the work you already do.',
    },
  ],
  keywords: ['React', 'TypeScript', 'Design systems', 'Accessibility', 'Performance', 'Vite', 'REST APIs', 'Agile delivery'],
};

const CAREER_PATH_FIXTURE = {
  tool_key: 'career-path',
  version: 1,
  result: {
    targetRole: 'Senior Frontend Engineer',
    resultLanguage: 'en',
    summary:
      'You are one strong delivery cycle away from a credible senior case. Your React and accessibility work already operates at senior scope; the gap is visible ownership of system-level decisions and mentoring. The plan below sequences that evidence over roughly nine months.',
    overallSkillGaps: [
      {
        skill: 'Frontend system design',
        reason: 'Senior loops probe caching, rendering strategy, and API-shape trade-offs - your resume shows outcomes but not the design decisions behind them.',
      },
      {
        skill: 'Technical mentorship',
        reason: 'Promotion cases at your target companies expect evidence of raising the bar for other engineers, not only personal delivery.',
      },
    ],
    roadmap: [
      {
        phaseTitle: 'Own a system-level decision',
        estimatedDuration: '0-3 months',
        goal: 'Turn an upcoming feature into a documented architecture decision you led.',
        actionableSteps: [
          {
            type: 'project',
            description: 'Write the rendering-strategy RFC for the next major surface (SSR vs. islands vs. client) and drive it to a decision.',
            resources: ['Your team RFC template', 'patterns.dev rendering guides'],
          },
          {
            type: 'self-study',
            description: 'Work through one frontend system-design case per week and record your trade-off reasoning.',
            resources: ['GreatFrontEnd system design track'],
          },
        ],
        milestones: ['One merged RFC with your name as decision owner', 'Design-review notes you can cite in interviews'],
      },
      {
        phaseTitle: 'Make the codebase faster than you found it',
        estimatedDuration: '3-6 months',
        goal: 'Ship a measurable performance program, not a one-off fix.',
        actionableSteps: [
          {
            type: 'project',
            description: 'Stand up a performance budget in CI and burn down the three worst routes.',
            resources: ['web.dev performance budgets guide'],
          },
          {
            type: 'course',
            description: 'Complete an advanced browser-performance course to formalize what you know empirically.',
            resources: ['Frontend Masters: Web Performance'],
          },
        ],
        milestones: ['CI performance gate live', 'Documented p75 improvement on core routes'],
      },
      {
        phaseTitle: 'Multiply through others',
        estimatedDuration: '6-9 months',
        goal: 'Build the mentorship record that separates senior from strong mid-level.',
        actionableSteps: [
          {
            type: 'networking',
            description: 'Take on one intern or junior engineer as a formal mentee through a full project cycle.',
            resources: [],
          },
          {
            type: 'project',
            description: 'Run a monthly frontend guild session; publish the notes internally.',
            resources: [],
          },
        ],
        milestones: ['Mentee ships independently', 'Three guild sessions delivered'],
      },
    ],
    bridgeRoles: [
      {
        title: 'Frontend Platform Engineer',
        reason: 'Puts you at the system-design table immediately and converts your performance work into platform-level scope.',
      },
      {
        title: 'Design System Engineer',
        reason: 'Leverages your accessibility record; design-system roles carry natural cross-team influence.',
      },
    ],
  },
};

const INTERVIEW_SESSION_FIXTURE = {
  job_description:
    'Senior Frontend Engineer at a product-led SaaS company. Owns the customer dashboard experience: React, TypeScript, GraphQL, strong emphasis on performance and mentoring mid-level engineers.',
  market_name: 'Canada',
  overall_summary:
    'Hire-leaning performance. Answers were strongest when anchored to the onboarding rebuild: clear situation, measured outcome, honest trade-offs. The main growth edge is pausing to state the decision framework before diving into implementation detail - twice the interviewer had to pull the "why" out of an otherwise excellent "how".',
  exchanges: [
    {
      question: 'Walk me through a frontend architecture decision you owned end to end.',
      answer:
        'On the onboarding rebuild I chose route-level code splitting with a shared shell over a full SPA refactor. I prototyped both, measured time-to-interactive on our p75 device profile, and the split approach won by 40% with a fraction of the migration risk. I wrote the RFC, got design and backend sign-off, and we shipped behind a flag over three sprints.',
      score: 85,
      feedback:
        'Excellent structure: options considered, measurement, risk framing, and a shipped outcome. To land this at senior loops, open with the one-sentence decision before the narrative - interviewers score the framework first.',
    },
    {
      question: 'A key dashboard route regressed from 1.2s to 4s after a release. How do you respond?',
      answer:
        'First I would confirm the regression is real from RUM data rather than a synthetic outlier, then bisect the release. My instinct is a new dependency or an accidental client-side fetch waterfall. I would flag-off the offending change, communicate impact to the team, and add a CI performance budget so this class of regression fails before merge.',
      score: 78,
      feedback:
        'Good operational instincts and the prevention step is a differentiator. You skipped stakeholder triage - state early who you inform and what the user-facing severity is, then go technical.',
    },
    {
      question: 'How would you grow a mid-level engineer who ships fast but skips tests?',
      answer:
        'I would pair on the next feature and write the first test together, framing tests as speed insurance rather than process. Then I would give them ownership of a flaky-test cleanup so they feel the cost of the gap firsthand, and recognize the behaviour change publicly in sprint review.',
      score: 72,
      feedback:
        'Empathetic and concrete. Strengthen it by adding the accountability half: what you do if coaching does not change the behaviour, and how you protect the codebase meanwhile.',
    },
  ],
};

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: ROOT, env: process.env, stdio: 'inherit', ...options });
    child.on('exit', (code, signal) => {
      if (code === 0) resolvePromise();
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
    [resolve(ROOT, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '4189', '--strictPort'],
    { cwd: ROOT, env: viteEnv, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout.on('data', (chunk) => process.stdout.write(`[vite] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`));
  return child;
}

function adminApp() {
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
  return admin.app();
}

async function seedCandidateShowcase() {
  adminApp();
  const db = admin.firestore();
  const user = await admin.auth().getUserByEmail(CANDIDATE_EMAIL);
  const uid = user.uid;

  await db.collection('users').doc(uid).set(
    {
      role: 'candidate',
      full_name: 'Avery Chen',
      subscription_status: 'essentials',
      credits: 1200,
      resume_text: RESUME_TEXT,
      updated_at: new Date().toISOString(),
    },
    { merge: true },
  );

  await db.collection('users').doc(uid).collection('resume_analyses').doc('showcase-analysis').set({
    ...ANALYSIS_FIXTURE,
    created_at: admin.firestore.Timestamp.now(),
  });

  await db.collection('users').doc(uid).collection('tool_results').doc('career-path').set({
    ...CAREER_PATH_FIXTURE,
    saved_at: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection('users').doc(uid).collection('interview_sessions').doc('showcase-session').set({
    ...INTERVIEW_SESSION_FIXTURE,
    started_at: admin.firestore.Timestamp.now(),
  });

  return uid;
}

async function dismissConsentBanner(page) {
  // The privacy-preserving choice; the banner must never appear in marketing shots.
  const decline = page.getByRole('button', { name: /decline optional monitoring/i }).first();
  try {
    await decline.waitFor({ timeout: 5_000 });
    await decline.click();
    await decline.waitFor({ state: 'detached', timeout: 5_000 });
  } catch {
    // Banner already dismissed for this context.
  }
}

async function signIn(page, email, entry) {
  await page.goto(`${BASE_URL}${entry}`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').first().waitFor({ timeout: 20_000 });
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('form button[type="submit"]').first().click();
  await page.locator('[data-qa-auth="signed-in"]').waitFor({ timeout: 30_000 });
  await dismissConsentBanner(page);
}

async function capture(page, name) {
  await mkdir(OUT_DIR, { recursive: true });
  // Let fonts, icons, and entry transitions settle before the frame is taken.
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT_DIR}/${name}.png` });
  console.log(`  captured ${name}.png`);
}

async function main() {
  await run(process.env.NODE_BINARY || 'node', ['scripts/seed-emulator.mjs']);
  await run(process.env.NODE_BINARY || 'node', ['scripts/seed-ats-preview.mjs']);
  await seedCandidateShowcase();

  const vite = startVite();
  try {
    await waitForServer(BASE_URL);
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();

      // 1. Resume Readiness Report
      await signIn(page, CANDIDATE_EMAIL, '/workspace?auth=signin');
      await page.locator('[data-qa-shell="candidate"]').waitFor({ timeout: 30_000 });
      await page.goto(`${BASE_URL}/workspace/resume`, { waitUntil: 'domcontentloaded' });
      await page.getByText('Quantified outcomes in every role', { exact: false }).first().waitFor({ timeout: 30_000 });
      await capture(page, 'resume-readiness-report');

      // 2. Career Path Planner result
      await page.goto(`${BASE_URL}/workspace/tools?tool=career-path`, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-qa="career-path-tool"][data-qa-tool-state="result"]').waitFor({ timeout: 30_000 });
      await page.getByText('Own a system-level decision', { exact: false }).first().waitFor({ timeout: 20_000 });
      await capture(page, 'career-path-planner');

      // 3. Interview Practice feedback (session history detail)
      await page.goto(`${BASE_URL}/workspace/tools?tool=mock-interview`, { waitUntil: 'domcontentloaded' });
      await dismissConsentBanner(page);
      const historyItem = page.locator('[data-qa="mock-interview-history-item"]').first();
      await historyItem.waitFor({ timeout: 30_000 });
      await historyItem.click();
      const historyDetail = page.locator('[data-qa="mock-interview-history-detail"]');
      await historyDetail.waitFor({ timeout: 20_000 });
      await page.getByText('Hire-leaning performance', { exact: false }).first().waitFor({ timeout: 20_000 });
      // Align the practice-history section headers to the top of the frame so
      // the report card and its sibling columns compose cleanly.
      await page.getByText('Recent practice', { exact: false }).first()
        .evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await capture(page, 'interview-practice-feedback');

      // 4. Employer Candidate Match (applicant funnel)
      const employerContext = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        reducedMotion: 'reduce',
      });
      const employerPage = await employerContext.newPage();
      await signIn(employerPage, EMPLOYER_EMAIL, '/portal?auth=signin');
      await employerPage.locator('[data-qa-employer-page="dashboard"]').waitFor({ timeout: 30_000 });
      await employerPage.locator('[data-qa="employer-nav-job-listings"]').click();
      await employerPage.locator('[data-qa-employer-page="job-listings"]').waitFor({ timeout: 20_000 });
      await employerPage.getByRole('button', { name: /review candidates/i }).first().click();
      await employerPage.locator('[data-qa-employer-page="applicant-funnel"]').waitFor({ timeout: 30_000 });
      // Casey's application is the one seeded with a scorecard — target it
      // exactly as e2e/employer-ats.spec.ts does instead of whichever card
      // the match ranking happens to put first.
      const applicantCard = employerPage
        .locator('[data-qa="applicant-card"][data-qa-applicant-id="qa-app-1"], [data-qa="applicant-card"][data-qa-applicant-id="seed-app-casey"]')
        .first();
      await applicantCard.waitFor({ timeout: 20_000 });
      await applicantCard.click();
      // The detail sections stream in from separate callables; wait for them in
      // the same order (and with the same patience) as e2e/employer-ats.spec.ts.
      await employerPage.locator('[data-qa="applicant-interviews-section"]').waitFor({ timeout: 30_000 });
      await employerPage.locator('[data-qa="application-message-thread"]').waitFor({ timeout: 30_000 });
      await employerPage.locator('[data-qa="scorecard-summary"]').waitFor({ timeout: 30_000 });
      // Pin the advisory note to the top of the frame so the applicant list
      // and match analysis fill it, instead of the stage funnel above.
      await employerPage.getByText('AI match scores and suggestions are advisory', { exact: false })
        .first()
        .evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await capture(employerPage, 'employer-candidate-match');

      await employerContext.close();
      await context.close();
    } finally {
      await browser.close();
    }
  } finally {
    vite.kill('SIGTERM');
  }
  console.log('All four product screenshots captured.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
