/**
 * Hiring-loop callable runtime smoke test.
 *
 * Runs only against Firebase emulators. It locks the high-traffic write path:
 *   1. employer creates a structured job through the real callable,
 *   2. candidate applies through the real callable,
 *   3. duplicate apply and candidate status mutation are rejected,
 *   4. employer advances the application and an audit event is written,
 *   5. employer closes the smoke job.
 *
 * This intentionally avoids LLM-backed listJobApplicants so runtime-callable
 * write regressions are isolated from model/provider availability.
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { configureFirebaseScript } from './lib/firebase-script-safety.mjs';

const firebaseTarget = configureFirebaseScript({ scriptName: 'hiring-loop-smoke' });

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PROJECT_ID = firebaseTarget.projectId;
const PASSWORD = 'QaSeed!2026';
const EMPLOYER_EMAIL = 'employer@careercopilot.test';
const CANDIDATE_EMAIL = 'candidate@careercopilot.test';
const SMOKE_JOB_TITLE = 'Runtime Smoke Product Engineer';

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || 'demo-api-key',
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || 'demo-careercopilot.firebaseapp.com',
  projectId: PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || 'demo-careercopilot.appspot.com',
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '000000000000',
  appId: process.env.VITE_FIREBASE_APP_ID || '1:000000000000:web:demo',
};

const functionsRegion = process.env.VITE_FIREBASE_FUNCTIONS_REGION || 'us-central1';
const authEmulatorUrl = process.env.VITE_FIREBASE_AUTH_EMULATOR_URL || 'http://127.0.0.1:9199';
const functionsEmulatorHost = process.env.VITE_FIREBASE_FUNCTIONS_EMULATOR_HOST || '127.0.0.1';
const functionsEmulatorPort = Number(process.env.VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT || '5001');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}
const db = admin.firestore();
const adminAuth = admin.auth();

function initClientApp(name) {
  const app = initializeApp(firebaseConfig, name);
  const auth = getAuth(app);
  const functions = getFunctions(app, functionsRegion);
  connectAuthEmulator(auth, authEmulatorUrl, { disableWarnings: true });
  connectFunctionsEmulator(functions, functionsEmulatorHost, functionsEmulatorPort);
  return { app, auth, functions };
}

async function signInClient(email, appName) {
  const client = initClientApp(appName);
  await signInWithEmailAndPassword(client.auth, email, PASSWORD);
  return client;
}

async function runSeedScript() {
  await new Promise((resolve, reject) => {
    const child = spawn((process.env.NODE_BINARY || 'node'), ['scripts/seed-emulator.mjs'], {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
    });
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`seed-emulator failed with ${code ?? signal}`));
    });
  });
}

async function deleteQuery(query) {
  const snap = await query.get();
  await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
}

async function cleanupPriorSmokeData(employerUid, candidateUid) {
  const jobs = await db
    .collection('job_postings')
    .where('employer_id', '==', employerUid)
    .where('title', '==', SMOKE_JOB_TITLE)
    .get();

  for (const job of jobs.docs) {
    const apps = await db.collection('job_applications').where('job_id', '==', job.id).get();
    for (const app of apps.docs) {
      await Promise.all([
        db.collection('application_snapshots').doc(app.id).delete().catch(() => undefined),
        deleteQuery(db.collection('application_status_events').where('application_id', '==', app.id)),
        app.ref.delete(),
      ]);
    }
    await Promise.all([
      deleteQuery(db.collection('job_posting_events').where('job_id', '==', job.id)),
      job.ref.delete(),
    ]);
  }

  // Belt-and-suspenders cleanup for a run interrupted between application create
  // and job cleanup.
  const candidateApps = await db
    .collection('job_applications')
    .where('candidate_id', '==', candidateUid)
    .get();
  for (const app of candidateApps.docs) {
    const data = app.data();
    if (data.job_title !== SMOKE_JOB_TITLE || data.employer_id !== employerUid) continue;
    await Promise.all([
      db.collection('application_snapshots').doc(app.id).delete().catch(() => undefined),
      deleteQuery(db.collection('application_status_events').where('application_id', '==', app.id)),
      app.ref.delete(),
    ]);
  }
}

async function seedHiringFixture() {
  await runSeedScript();

  const [candidate, employer] = await Promise.all([
    adminAuth.getUserByEmail(CANDIDATE_EMAIL),
    adminAuth.getUserByEmail(EMPLOYER_EMAIL),
  ]);
  const now = new Date().toISOString();

  await cleanupPriorSmokeData(employer.uid, candidate.uid);

  await Promise.all([
    db.collection('users').doc(employer.uid).set(
      {
        role: 'employer',
        full_name: 'Erin Employer',
        subscription_status: 'pro',
        company_name: 'Seed Test Co',
        company_size: '11-50',
        industry: 'Software',
        company_website: 'https://example.test',
        updated_at: now,
      },
      { merge: true },
    ),
    db.collection('users').doc(candidate.uid).set(
      {
        role: 'candidate',
        full_name: 'Casey Candidate',
        email: CANDIDATE_EMAIL,
        resume_text:
          'Casey Candidate — Product engineer with React, TypeScript, accessibility, hiring workflow, and cross-functional delivery experience.',
        updated_at: now,
      },
      { merge: true },
    ),
    db.collection('talent_profiles').doc(candidate.uid).set(
      {
        basic: { name: 'Casey Candidate' },
        intention: { targetRole: 'Product Engineer' },
        education: [
          {
            school: 'University of Ottawa',
            degree: 'M.Eng.',
            field: 'Electrical and Computer Engineering',
          },
        ],
        experience: [
          {
            company: 'Campus Product Lab',
            title: 'Frontend Engineer',
            highlights: ['Built accessible React workflows and TypeScript UI components.'],
          },
        ],
        skills: { technical: ['React', 'TypeScript', 'Accessibility'] },
        updated_at: now,
      },
      { merge: true },
    ),
  ]);

  return { candidateUid: candidate.uid, employerUid: employer.uid };
}

function smokeJobPosting() {
  return {
    title: SMOKE_JOB_TITLE,
    location: 'Ottawa, ON',
    work_mode: 'hybrid',
    employment_type: 'full_time',
    experience_level: 'entry',
    department: 'Product Engineering',
    description:
      'Build accessible hiring workflows, improve candidate-facing application quality, and partner with recruiting teams.',
    responsibilities:
      'Own TypeScript UI fixes, improve candidate apply flows, and maintain runtime-tested Firebase callable contracts.',
    required_qualifications: 'Experience building React and TypeScript features with strong product quality instincts.',
    required_skills: ['React', 'TypeScript', 'Accessibility'],
    application_deadline: '2026-12-31',
    headcount: 1,
    preferred_skills: ['Firebase', 'Product thinking'],
    salary_range: 'Market aligned',
    screener_questions: [
      {
        prompt: 'Are you authorized to work in Canada?',
        type: 'yes_no',
        required: true,
        expected: 'yes',
      },
    ],
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectCallableRejected(factory, pattern, label) {
  try {
    await factory();
  } catch (error) {
    const text = `${error?.code || ''} ${error?.message || error}`;
    if (pattern.test(text)) {
      console.log(`  ✓ ${label}`);
      return;
    }
    throw error;
  }
  throw new Error(`Expected rejection: ${label}`);
}

async function main() {
  const { candidateUid, employerUid } = await seedHiringFixture();

  const employerClient = await signInClient(EMPLOYER_EMAIL, 'hiring-loop-employer');
  const candidateClient = await signInClient(CANDIDATE_EMAIL, 'hiring-loop-candidate');

  try {
    const createJobPosting = httpsCallable(employerClient.functions, 'createJobPosting');
    const createJobApplication = httpsCallable(candidateClient.functions, 'createJobApplication');
    const candidateUpdateStatus = httpsCallable(candidateClient.functions, 'updateApplicationStatus');
    const employerUpdateStatus = httpsCallable(employerClient.functions, 'updateApplicationStatus');
    const setJobPostingActive = httpsCallable(employerClient.functions, 'setJobPostingActive');

    const createdJob = await createJobPosting({ posting: smokeJobPosting() });
    const jobId = createdJob.data.jobId;
    assert(typeof jobId === 'string' && jobId.length > 0, `Unexpected createJobPosting result: ${JSON.stringify(createdJob.data)}`);

    const jobSnap = await db.collection('job_postings').doc(jobId).get();
    const job = jobSnap.data();
    assert(jobSnap.exists, 'Created job posting was not written.');
    assert(job.employer_id === employerUid, `Job employer mismatch: ${job.employer_id}`);
    assert(job.company_name === 'Seed Test Co', `Job company was not snapshotted from server profile: ${job.company_name}`);
    assert(job.is_active === true, 'Created job is not active.');
    console.log(`  ✓ employer created structured job posting ${jobId}`);

    const createdApplication = await createJobApplication({
      jobId,
      compatibilityScore: 88,
      screenerAnswers: [{ questionId: 'q1', answer: 'Yes' }],
    });
    const applicationId = createdApplication.data.applicationId;
    assert(
      typeof applicationId === 'string' && applicationId === `${candidateUid}_${jobId}`,
      `Unexpected application id: ${JSON.stringify(createdApplication.data)}`,
    );

    const [appSnap, snapshotSnap] = await Promise.all([
      db.collection('job_applications').doc(applicationId).get(),
      db.collection('application_snapshots').doc(applicationId).get(),
    ]);
    const app = appSnap.data();
    const snapshot = snapshotSnap.data();
    assert(appSnap.exists, 'Application document missing.');
    assert(snapshotSnap.exists, 'Application snapshot document missing.');
    assert(app.status === 'Applied', `Unexpected initial application status: ${app.status}`);
    assert(app.candidate_id === candidateUid, `Application candidate mismatch: ${app.candidate_id}`);
    assert(app.employer_id === employerUid, `Application employer mismatch: ${app.employer_id}`);
    assert(app.screener_answers?.[0]?.answer === 'Yes', 'Screener answer was not frozen on application.');
    assert(snapshot.resume_text_snapshot?.includes('TypeScript'), 'Resume snapshot missing expected text.');
    console.log('  ✓ candidate applied with frozen application snapshot');

    await expectCallableRejected(
      () => createJobApplication({ jobId, screenerAnswers: [{ questionId: 'q1', answer: 'Yes' }] }),
      /already-exists|already applied/i,
      'duplicate application rejected',
    );

    await expectCallableRejected(
      () => candidateUpdateStatus({ applicationId, action: 'advance' }),
      /permission-denied|own the job/i,
      'candidate status update rejected',
    );

    const advanced = await employerUpdateStatus({
      applicationId,
      action: 'advance',
      candidateNote: 'Moving you to the next stage.',
    });
    assert(advanced.data.previousStatus === 'Applied', `Unexpected previous status: ${JSON.stringify(advanced.data)}`);
    assert(advanced.data.status === 'Group Interview', `Unexpected advanced status: ${JSON.stringify(advanced.data)}`);
    assert(advanced.data.changed === true, `Expected changed=true: ${JSON.stringify(advanced.data)}`);

    const advancedApp = (await db.collection('job_applications').doc(applicationId).get()).data();
    assert(advancedApp.status === 'Group Interview', `Application was not advanced: ${advancedApp.status}`);
    assert(advancedApp.last_status_action === 'advance', `last_status_action mismatch: ${advancedApp.last_status_action}`);
    console.log('  ✓ employer advanced application to Group Interview');

    const statusEvents = await db
      .collection('application_status_events')
      .where('application_id', '==', applicationId)
      .get();
    assert(statusEvents.size === 1, `Expected one status event, got ${statusEvents.size}`);
    const event = statusEvents.docs[0].data();
    assert(event.actor_id === employerUid, `Status event actor mismatch: ${event.actor_id}`);
    assert(event.to_status === 'Group Interview', `Status event target mismatch: ${event.to_status}`);
    console.log('  ✓ status audit event written');

    const closed = await setJobPostingActive({ jobId, isActive: false, reason: 'Smoke complete' });
    assert(closed.data.isActive === false, `Unexpected close result: ${JSON.stringify(closed.data)}`);
    const closedJob = (await db.collection('job_postings').doc(jobId).get()).data();
    assert(closedJob.is_active === false, 'Smoke job did not close.');
    console.log('  ✓ employer closed smoke job');
  } finally {
    await Promise.allSettled([deleteApp(employerClient.app), deleteApp(candidateClient.app)]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
