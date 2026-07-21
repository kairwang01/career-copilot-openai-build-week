/**
 * createJobApplication screener-answer tests — real Firestore emulator + Admin SDK.
 * Proves: required questions must be answered, valid answers are frozen onto the
 * application doc + snapshot, unknown question ids are ignored, and a "wrong"
 * (expected-mismatch) answer STILL creates the application — knockout is a screening
 * signal, never an auto-reject.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as admin from '../functions/node_modules/firebase-admin';
import { createJobApplicationImpl } from '../functions/src/handlers/jobApplications';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-careercopilot';
const db = admin.firestore();

async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
}

async function seed() {
  await db.collection('job_postings').doc('job1').set({
    employer_id: 'emp',
    title: 'Engineer',
    is_active: true,
    description: 'Build things',
    screener_questions: [
      { id: 'q1', prompt: 'Are you authorized to work in Canada?', type: 'yes_no', required: true, expected: 'yes' },
      { id: 'q2', prompt: 'Years of React experience?', type: 'short_text', required: false, expected: null },
    ],
  });
  await db.collection('talent_profiles').doc('cand').set({
    basic: { name: 'Casey Candidate' },
    intention: { targetRole: 'Engineer' },
    experience: [{ company: 'Acme', title: 'Engineer' }],
  });
  await db.collection('users').doc('cand').set({ resume_text: 'Casey — Engineer with React experience.' });
}

beforeEach(clearFirestore);

describe('createJobApplication screener answers', () => {
  it('rejects when a required question is unanswered', async () => {
    await seed();
    await expect(
      createJobApplicationImpl('cand', { jobId: 'job1', screenerAnswers: [{ questionId: 'q2', answer: '3' }] }),
    ).rejects.toThrow(/screening question/i);
  });

  it('freezes valid answers (with prompt) onto the application doc AND the snapshot', async () => {
    await seed();
    const { applicationId } = await createJobApplicationImpl('cand', {
      jobId: 'job1',
      screenerAnswers: [
        { questionId: 'q1', answer: 'Yes' },
        { questionId: 'q2', answer: '3 years' },
        { questionId: 'q9', answer: 'should be ignored' }, // unknown id
      ],
    });
    const app = (await db.collection('job_applications').doc(applicationId).get()).data()!;
    expect(app.screener_answers).toHaveLength(2); // q9 dropped
    expect(app.screener_answers[0]).toMatchObject({ question_id: 'q1', prompt: 'Are you authorized to work in Canada?', answer: 'Yes' });
    expect(app.screener_answers[1]).toMatchObject({ question_id: 'q2', answer: '3 years' });

    const snap = (await db.collection('application_snapshots').doc(applicationId).get()).data()!;
    expect(snap.screener_answers_snapshot).toHaveLength(2);
  });

  it('a "wrong" answer to a knockout question STILL creates the application (no auto-reject)', async () => {
    await seed();
    const { applicationId } = await createJobApplicationImpl('cand', {
      jobId: 'job1',
      screenerAnswers: [{ questionId: 'q1', answer: 'No' }], // expected 'yes' — mismatch
    });
    const app = await db.collection('job_applications').doc(applicationId).get();
    expect(app.exists).toBe(true);
    expect(app.data()!.screener_answers[0]).toMatchObject({ question_id: 'q1', answer: 'No' });
  });

  it('a job with no screener questions still applies cleanly', async () => {
    await seed();
    await db.collection('job_postings').doc('job1').update({ screener_questions: [] });
    const { applicationId } = await createJobApplicationImpl('cand', { jobId: 'job1' });
    const app = (await db.collection('job_applications').doc(applicationId).get()).data()!;
    expect(app.screener_answers).toEqual([]);
  });
});
