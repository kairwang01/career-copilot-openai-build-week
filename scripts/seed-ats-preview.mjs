// One-off QA seed (emulator only): give the employer an active job posting with
// a couple of applicants (+ frozen snapshots) so the employer job-listing and
// ApplicantFunnel can be QA'd. Run AFTER seed-emulator.mjs against the emulators.
import { createRequire } from 'module';
import { configureFirebaseScript } from './lib/firebase-script-safety.mjs';

const firebaseTarget = configureFirebaseScript({ scriptName: 'seed-ats-preview' });
const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');
const { FieldValue } = require('../functions/node_modules/firebase-admin/lib/firestore');

admin.initializeApp({ projectId: firebaseTarget.projectId });
const auth = admin.auth();
const db = admin.firestore();

const employer = await auth.getUserByEmail('employer@careercopilot.test');
const candidate = await auth.getUserByEmail('candidate@careercopilot.test');
const now = FieldValue.serverTimestamp();

const jobId = 'qa-job-frontend';
await db.collection('job_postings').doc(jobId).set({
  employer_id: employer.uid,
  title: 'Frontend Engineer',
  company_name: 'Seed Test Co',
  company_size: '11-50',
  industry: 'Software',
  founded_year: '2024',
  location: 'Toronto, ON',
  work_mode: 'hybrid',
  employment_type: 'full_time',
  experience_level: 'mid',
  department: 'Product Engineering',
  description: 'Build delightful UI with React + TypeScript. Strong accessibility and product sense.',
  salary_range: '$95,000 - $120,000',
  responsibilities: 'Own accessible React interfaces, collaborate with design, and improve product workflows.',
  required_qualifications: '3+ years frontend experience with React, TypeScript, and CSS.',
  nice_to_have_qualifications: 'Experience with Firebase, design systems, and recruiting workflow products.',
  required_skills: ['React', 'TypeScript', 'CSS'],
  preferred_skills: ['Firebase', 'Accessibility', 'Design Systems'],
  application_deadline: '2026-08-31',
  headcount: 2,
  visa_sponsorship: false,
  relocation: false,
  language_requirement: 'English',
  interview_process: 'Initial screen, technical interview, hiring manager interview.',
  campus_new_grad: false,
  screener_questions: [
    {
      id: 'sq-react',
      prompt: 'Have you shipped a React production feature in the last 12 months?',
      type: 'yes_no',
      required: true,
      expected: 'yes',
    },
    {
      id: 'sq-accessibility',
      prompt: 'Share one accessibility improvement you have made.',
      type: 'short_text',
      required: false,
      expected: null,
    },
  ],
  is_active: true,
  created_at: now,
  updated_at: now,
});

const applicants = [
  {
    id: 'qa-app-1',
    name: 'Casey Candidate',
    cid: candidate.uid,
    status: 'Applied',
    score: 82,
    screenerAnswers: [
      { question_id: 'sq-react', prompt: 'Have you shipped a React production feature in the last 12 months?', answer: 'yes' },
      { question_id: 'sq-accessibility', prompt: 'Share one accessibility improvement you have made.', answer: 'Improved keyboard navigation and focus states.' },
    ],
    talentProfile: {
      basic: { name: 'Casey Candidate', email: 'candidate@careercopilot.test', location: 'Ottawa, ON' },
      goals: { targetRoles: ['Frontend Engineer'], preferredLocations: ['Toronto', 'Remote Canada'] },
      skills: { technical: ['React', 'TypeScript', 'CSS', 'Accessibility'], tools: ['Firebase', 'Playwright'] },
      experience: [
        {
          company: 'Student Product Lab',
          title: 'Frontend Engineer',
          startDate: '2024-01',
          endDate: '2026-05',
          highlights: ['Built React workflows with accessible forms and responsive layouts.'],
        },
      ],
    },
    resume: 'Casey Candidate — Frontend Engineer with React, TypeScript, CSS, accessibility, Firebase, and Playwright experience.',
  },
  {
    id: 'qa-app-2',
    name: 'Jordan Lee',
    cid: 'qa-fake-candidate-2',
    status: 'First Interview',
    score: 74,
    screenerAnswers: [
      { question_id: 'sq-react', prompt: 'Have you shipped a React production feature in the last 12 months?', answer: 'yes' },
    ],
    talentProfile: {
      basic: { name: 'Jordan Lee', email: 'jordan.qa@example.test', location: 'Toronto, ON' },
      goals: { targetRoles: ['UI Engineer'], preferredLocations: ['Toronto'] },
      skills: { technical: ['React', 'JavaScript', 'CSS'], tools: ['Figma'] },
      projects: [
        {
          name: 'Design System Audit',
          role: 'Frontend Contributor',
          highlights: ['Documented component states and fixed layout regressions.'],
        },
      ],
    },
    resume: 'Jordan Lee — UI Engineer with React, JavaScript, CSS, Figma, and design-system QA experience.',
  },
];

for (const a of applicants) {
  await db.collection('job_applications').doc(a.id).set({
    job_id: jobId,
    candidate_id: a.cid,
    employer_id: employer.uid,
    job_title: 'Frontend Engineer',
    candidate_name: a.name,
    status: a.status,
    compatibility_score: a.score,
    screener_answers: a.screenerAnswers,
    notes: null,
    skipped_statuses: [],
    application_date: now,
    created_at: now,
    updated_at: now,
  });
  await db.collection('application_snapshots').doc(a.id).set({
    application_id: a.id,
    candidate_id: a.cid,
    employer_id: employer.uid,
    resume_text_snapshot: a.resume,
    talent_profile_snapshot: a.talentProfile,
    screener_answers_snapshot: a.screenerAnswers,
    submitted_at: now,
  });
}

// Detail-surface hardening fixture: these records intentionally include a few
// malformed display fields. The UI should normalize them and keep the applicant
// detail panel usable instead of tripping the section/root error boundary.
await db.collection('application_interviews').doc('qa-iv-malformed-casey').set({
  application_id: 'qa-app-1',
  job_id: jobId,
  employer_id: employer.uid,
  candidate_id: candidate.uid,
  stage: { label: 'Malformed stage object' },
  scheduled_at: { toDate: 'not a timestamp method' },
  timezone: 'America/Toronto',
  format: 'carrier-pigeon',
  location_or_link: ['https://meet.example.test/casey'],
  interviewer: null,
  notes: { body: 'This old payload shape should not render directly.' },
  candidate_confirmed: 'yes',
  interview_status: 'mystery',
  created_at: now,
  updated_at: now,
});

await db.collection('application_scorecards').doc('qa-scorecard-malformed-casey').set({
  application_id: 'qa-app-1',
  interview_id: 'qa-iv-malformed-casey',
  job_id: jobId,
  employer_id: employer.uid,
  candidate_id: candidate.uid,
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
  created_at: now,
  updated_at: now,
});

await db.collection('application_messages').doc('qa-msg-malformed-casey').set({
  application_id: 'qa-app-1',
  job_id: jobId,
  employer_id: employer.uid,
  candidate_id: candidate.uid,
  sender_uid: employer.uid,
  sender_role: 'employer',
  body: { text: 'Malformed message body object' },
  template_key: 'unknown',
  created_at: now,
});

await db.collection('application_status_events').doc('qa-status-app-2-first-interview').set({
  application_id: 'qa-app-2',
  job_id: jobId,
  candidate_id: 'qa-fake-candidate-2',
  employer_id: employer.uid,
  from_status: 'Applied',
  to_status: 'First Interview',
  action: 'skip',
  skipped_statuses: ['Group Interview'],
  actor_id: employer.uid,
  actor_role: 'employer',
  reason: 'Seeded QA application is already in first interview.',
  candidate_note: 'We would like to continue with a first interview.',
  created_at: now,
});

console.log(`Seeded job ${jobId} for employer ${employer.uid} with ${applicants.length} applicants.`);
