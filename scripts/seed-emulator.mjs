/**
 * seed-emulator.mjs — provision the QA accounts the auth/routing acceptance
 * criteria need, against the LOCAL Firebase emulators (never prod).
 *
 *   candidate         → role 'candidate'              → must land on /workspace (candidate shell)
 *   employer          → role 'employer' + biz plan    → must land on /portal (employer shell)
 *   pending-business  → role 'candidate' + pending biz plan → must land on /portal, NOT auto checkout
 *   admin-candidate   → role 'candidate' + admin auth → must land on /workspace, NOT /admin
 *
 * The last account is the regression guard for "admin authority must not hijack a
 * candidate's product surface" (decideWorkspaceShell / navigationDecisions).
 *
 * Run (starts the auth+firestore emulators, seeds, exits):
 *   npm run seed:emulator
 * Or against already-running emulators:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9199 \
 *     node scripts/seed-emulator.mjs
 *
 * Idempotent per email. Accounts use a fixed emulator-only fixture credential.
 */
import { createRequire } from 'module';
import { configureFirebaseScript } from './lib/firebase-script-safety.mjs';
import { buildWeb3EligibleAnalysis } from './lib/resume-analysis-fixtures.mjs';

const firebaseTarget = configureFirebaseScript({ scriptName: 'seed-emulator' });
const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');

const PROJECT_ID = firebaseTarget.projectId;
const PASSWORD = 'QaSeed!2026';

admin.initializeApp({ projectId: PROJECT_ID });
const auth = admin.auth();
const db = admin.firestore();

const now = new Date().toISOString();

async function ensureUser(email, displayName) {
  try {
    return await auth.getUserByEmail(email);
  } catch {
    return await auth.createUser({ email, password: PASSWORD, emailVerified: true, displayName });
  }
}

async function writeProfile(uid, data) {
  await db.collection('users').doc(uid).set(
    { credits: 100, created_at: now, updated_at: now, ...data },
    { merge: true },
  );
}

async function grantAdmin(uid) {
  const ref = db.collection('platform_config').doc('access');
  const snap = await ref.get();
  const admin_uids = snap.exists ? [...(snap.data().admin_uids || [])] : [];
  if (!admin_uids.includes(uid)) admin_uids.push(uid);
  await ref.set({ admin_uids, updated_at: now }, { merge: true });
  await auth.setCustomUserClaims(uid, { admin: true });
}

/**
 * ATS fixture: one active job owned by the employer plus two applicants, so the
 * employer-side path (job listings → review candidates → applicant funnel →
 * bulk selection) can be exercised end-to-end. Doc shapes mirror what
 * createJobPosting / createJobApplication write (Admin SDK here bypasses rules,
 * the same way the production callables do). Fixed ids keep it idempotent.
 */
async function seedAtsFixture({ employerUid, caseyUid }) {
  const ts = admin.firestore.Timestamp.now();
  const JOB_ID = 'seed-job-frontend';

  await db.collection('job_postings').doc(JOB_ID).set({
    title: 'Frontend Engineer',
    location: 'Toronto, ON',
    work_mode: 'hybrid',
    employment_type: 'full_time',
    experience_level: 'mid',
    department: 'Engineering',
    description:
      'Build accessible, fast React interfaces for our hiring platform. You will own UI features end to end and partner closely with design and product.',
    responsibilities:
      'Ship candidate- and employer-facing UI; uphold accessibility and performance; collaborate across design and backend.',
    required_qualifications:
      '3+ years building production React/TypeScript apps; strong CSS and accessibility fundamentals.',
    required_skills: ['React', 'TypeScript', 'Accessibility'],
    preferred_skills: ['GraphQL', 'Testing'],
    application_deadline: '2026-12-31',
    headcount: 1,
    salary_range: '$110k–140k CAD',
    visa_sponsorship: false,
    relocation: false,
    screener_questions: [],
    // Company identity snapshotted from the employer profile (as the callable does).
    company_name: 'Seed Test Co',
    company_size: '11-50',
    industry: null,
    founded_year: null,
    company_logo_url: null,
    company_website: null,
    employer_id: employerUid,
    is_active: true,
    created_at: ts,
    updated_at: ts,
  }, { merge: true });

  // A second applicant (distinct candidate) so the funnel shows "2 of 2".
  const jordan = await ensureUser('jordan@careercopilot.test', 'Jordan Lee');
  await writeProfile(jordan.uid, {
    role: 'candidate',
    full_name: 'Jordan Lee',
    subscription_status: 'free',
    resume_text:
      'Jordan Lee — Frontend Engineer\n\nEXPERIENCE\nFrontend Engineer (2020–present): React, TypeScript, GraphQL, design systems.',
  });

  const applicants = [
    { appId: 'seed-app-casey', uid: caseyUid, name: 'Casey Candidate', score: 82, resume: 'Casey Candidate — Frontend Engineer (React, TypeScript, accessibility).' },
    { appId: 'seed-app-jordan', uid: jordan.uid, name: 'Jordan Lee', score: 74, resume: 'Jordan Lee — Frontend Engineer (React, TypeScript, GraphQL).' },
  ];
  for (const a of applicants) {
    await db.collection('job_applications').doc(a.appId).set({
      job_id: JOB_ID,
      candidate_id: a.uid,
      employer_id: employerUid,
      job_title: 'Frontend Engineer',
      candidate_name: a.name,
      status: 'Applied',
      compatibility_score: a.score,
      screener_answers: [],
      notes: null,
      application_date: ts,
    }, { merge: true });
    await db.collection('application_snapshots').doc(a.appId).set({
      application_id: a.appId,
      candidate_id: a.uid,
      employer_id: employerUid,
      resume_text_snapshot: a.resume,
      talent_profile_snapshot: null,
      screener_answers_snapshot: [],
      resume_file_snapshot_path: null,
      resume_file_snapshot_name: null,
      submitted_at: ts,
    }, { merge: true });
  }

  await db.collection('application_interviews').doc('seed-iv-malformed-casey').set({
    application_id: 'seed-app-casey',
    job_id: JOB_ID,
    employer_id: employerUid,
    candidate_id: caseyUid,
    stage: { label: 'Malformed stage object' },
    scheduled_at: { toDate: 'not a timestamp method' },
    timezone: 'America/Toronto',
    format: 'carrier-pigeon',
    location_or_link: ['https://meet.example.test/casey'],
    interviewer: null,
    notes: { body: 'This old payload shape should not render directly.' },
    candidate_confirmed: 'yes',
    interview_status: 'mystery',
    created_at: ts,
    updated_at: ts,
  }, { merge: true });

  await db.collection('application_scorecards').doc('seed-scorecard-malformed-casey').set({
    application_id: 'seed-app-casey',
    interview_id: 'seed-iv-malformed-casey',
    job_id: JOB_ID,
    employer_id: employerUid,
    candidate_id: caseyUid,
    stage: {},
    recommendation: 'maybe',
    overall_score: 9,
    ratings: {
      role_fit: -1,
      technical_skill: Number.NaN,
      problem_solving: 4.6,
      communication: '5',
      evidence_depth: 2,
    },
    evidence: { text: 'Malformed evidence object' },
    concerns: ['array value'],
    next_steps: 'Follow up with panel.',
    private_notes: { note: 'private malformed object' },
    created_at: ts,
    updated_at: ts,
  }, { merge: true });

  await db.collection('application_messages').doc('seed-msg-malformed-casey').set({
    application_id: 'seed-app-casey',
    job_id: JOB_ID,
    employer_id: employerUid,
    candidate_id: caseyUid,
    sender_uid: employerUid,
    sender_role: 'employer',
    body: { text: 'Malformed message body object' },
    template_key: 'unknown',
    created_at: ts,
  }, { merge: true });

  return { jobId: JOB_ID, applicantCount: applicants.length, jordanUid: jordan.uid };
}

/**
 * Web3 fixture: turns on the experimental credential module platform-wide and
 * gives Casey a qualifying resume analysis, so the wallet → mint → stake
 * "testnet preview" credential loop can be exercised end to end. The contract is
 * a placeholder, so the app runs the labelled preview path (no on-chain calls).
 */
async function seedWeb3Fixture() {
  const ts = admin.firestore.Timestamp.now();
  await db.collection('platform_config').doc('web3').set({
    enabled: true,
    network: 'sepolia',
    chain_id: 11155111,
    contract_address: '0x2A3b1A43842238321a22542a035921A362358189',
    updated_at: now,
    updated_by: 'seed',
  }, { merge: true });

  // Dedicated mint-eligible candidate, kept SEPARATE from Casey so the happy-path's
  // "no prior resume analysis" assumption is not disturbed by this fixture.
  const web3User = await ensureUser('web3@careercopilot.test', 'Wren Web3');
  await writeProfile(web3User.uid, {
    role: 'candidate',
    full_name: 'Wren Web3',
    subscription_status: 'free',
    resume_text:
      'Wren Web3 — Frontend Engineer\n\nEXPERIENCE\nFrontend Engineer (2019–present): React, TypeScript, Solidity, design systems.',
  });
  // Account gates minting on the latest resume_analyses.score >= 85.
  await db
    .collection('users').doc(web3User.uid)
    .collection('resume_analyses').doc('seed-analysis')
    .set(buildWeb3EligibleAnalysis({ createdAt: ts }), { merge: true });
  return { web3Uid: web3User.uid };
}

/**
 * A SUPER admin (via the RBAC admins map), so the super-only surfaces — Models &
 * Keys / provider credentials — can be exercised. The legacy grantAdmin() path
 * only yields role 'admin', which can't see those tabs.
 */
async function seedSuperAdmin() {
  const superUser = await ensureUser('super@careercopilot.test', 'Sasha Super');
  await writeProfile(superUser.uid, { role: 'candidate', full_name: 'Sasha Super', subscription_status: 'free' });
  const ref = db.collection('platform_config').doc('access');
  const snap = await ref.get();
  const admins = snap.exists ? { ...(snap.data().admins || {}) } : {};
  admins[superUser.uid] = {
    role: 'super',
    status: 'active',
    email: 'super@careercopilot.test',
    invited_by: 'seed',
    invited_at: now,
  };
  await ref.set({ admins, updated_at: now }, { merge: true });
  return { superUid: superUser.uid };
}

async function main() {
  // 1. Plain candidate
  const candidate = await ensureUser('candidate@careercopilot.test', 'Casey Candidate');
  await writeProfile(candidate.uid, {
    role: 'candidate',
    full_name: 'Casey Candidate',
    subscription_status: 'free',
    resume_text:
      'Casey Candidate — Frontend Engineer\n\nEXPERIENCE\nFrontend Engineer (2021–present): React, TypeScript, accessibility.',
  });

  // 2. Employer / business
  const employer = await ensureUser('employer@careercopilot.test', 'Erin Employer');
  await writeProfile(employer.uid, {
    role: 'employer',
    full_name: 'Erin Employer',
    subscription_status: 'job_pack',
    company_name: 'Seed Test Co',
    company_size: '11-50',
  });

  // 3. Candidate-role account with a pending business plan — must reach /portal
  // without the app auto-opening checkout just because the profile is pending.
  const pendingBusiness = await ensureUser('pending-business@careercopilot.test', 'Parker Pending');
  await writeProfile(pendingBusiness.uid, {
    role: 'candidate',
    full_name: 'Parker Pending',
    subscription_status: 'pending_biz_starter',
    company_name: 'Pending Seed Co',
    company_size: '1-10',
  });

  // 4. Admin who is ALSO a product candidate — must reach /workspace, never auto /admin.
  const adminCandidate = await ensureUser('admin-candidate@careercopilot.test', 'Avery Admin');
  await writeProfile(adminCandidate.uid, {
    role: 'candidate',
    full_name: 'Avery Admin',
    subscription_status: 'free',
    resume_text: 'Avery Admin — Product Manager who also operates the platform.',
  });
  await grantAdmin(adminCandidate.uid);

  // 5. ATS fixture: an active job + two applicants under the employer, so the
  // employer applicant-funnel path can be exercised end-to-end.
  const ats = await seedAtsFixture({ employerUid: employer.uid, caseyUid: candidate.uid });

  // 6. Web3 fixture: enable the module + a dedicated mint-eligible candidate.
  await seedWeb3Fixture();

  // 7. A super admin so super-only surfaces (Models & Keys) are reachable in QA.
  const superAdmin = await seedSuperAdmin();
  console.log(`  ✓ super-admin       ${superAdmin.superUid}  (super@careercopilot.test, role=super via admins map)`);

  // Verify the seed (no browser needed).
  const checks = [
    ['candidate', candidate.uid, 'candidate'],
    ['employer', employer.uid, 'employer'],
    ['pending-business', pendingBusiness.uid, 'candidate'],
    ['admin-candidate', adminCandidate.uid, 'candidate'],
  ];
  for (const [label, uid, expectedRole] of checks) {
    const doc = await db.collection('users').doc(uid).get();
    const role = doc.get('role');
    if (role !== expectedRole) {
      throw new Error(`Seed check failed: ${label} role=${role}, expected ${expectedRole}`);
    }
    console.log(`  ✓ ${label.padEnd(16)} ${uid}  role=${role}`);
  }
  const access = await db.collection('platform_config').doc('access').get();
  if (!(access.get('admin_uids') || []).includes(adminCandidate.uid)) {
    throw new Error('Seed check failed: admin-candidate not in platform_config/access.admin_uids');
  }
  console.log(`  ✓ admin-candidate is in admin_uids (admin authority granted, role stays candidate)`);

  // ATS fixture checks: job is active + owned by the employer, with 2 applications.
  const jobDoc = await db.collection('job_postings').doc(ats.jobId).get();
  if (!jobDoc.exists || jobDoc.get('employer_id') !== employer.uid || jobDoc.get('is_active') !== true) {
    throw new Error('Seed check failed: ATS job missing / not owned by employer / not active');
  }
  const appsSnap = await db.collection('job_applications').where('employer_id', '==', employer.uid).get();
  if (appsSnap.size < ats.applicantCount) {
    throw new Error(`Seed check failed: expected >= ${ats.applicantCount} applications, found ${appsSnap.size}`);
  }
  console.log(`  ✓ ATS fixture: job "${jobDoc.get('title')}" active with ${appsSnap.size} applicant(s) (Casey + Jordan)`);

  console.log(`\nSeeded ${checks.length} QA accounts + ATS fixture against ${PROJECT_ID} emulators.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Seed failed:', e?.message || e);
    process.exit(1);
  });
