/**
 * Scorecard callable integration tests — real Firestore emulator + Admin SDK.
 * Proves: only the job-owning employer can write scorecards, scorecards are tied
 * to a real non-cancelled interview, structured ratings/evidence are required,
 * and repeated saves update the same interview scorecard instead of duplicating.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as admin from '../functions/node_modules/firebase-admin';
import { upsertScorecardImpl } from '../functions/src/handlers/scorecards';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-careercopilot';
const db = admin.firestore();

async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
}

async function seed(interviewStatus = 'completed') {
  await db.collection('job_postings').doc('job1').set({ employer_id: 'emp', title: 'Engineer', is_active: true });
  await db.collection('job_applications').doc('app1').set({ job_id: 'job1', candidate_id: 'cand', status: 'First Interview' });
  await db.collection('application_interviews').doc('iv1').set({
    application_id: 'app1',
    job_id: 'job1',
    employer_id: 'emp',
    candidate_id: 'cand',
    stage: 'First Interview',
    interview_status: interviewStatus,
  });
}

const ratings = {
  role_fit: 4,
  technical_skill: 5,
  problem_solving: 4,
  communication: 3,
  evidence_depth: 4,
};

const scorecard = (over: Record<string, unknown> = {}) => ({
  interviewId: 'iv1',
  recommendation: 'hire',
  overallScore: 4,
  ratings,
  evidence: 'Built a relevant project and explained tradeoffs clearly.',
  concerns: 'Needs deeper production incident examples.',
  nextSteps: 'Move to second interview.',
  privateNotes: 'Panel aligned.',
  ...over,
});

beforeEach(clearFirestore);

describe('upsertScorecard', () => {
  it('the job-owning employer can create a structured scorecard', async () => {
    await seed();
    const { scorecardId } = await upsertScorecardImpl('emp', scorecard());
    const doc = (await db.collection('application_scorecards').doc(scorecardId).get()).data()!;
    expect(doc.employer_id).toBe('emp');
    expect(doc.candidate_id).toBe('cand');
    expect(doc.application_id).toBe('app1');
    expect(doc.interview_id).toBe('iv1');
    expect(doc.recommendation).toBe('hire');
    expect(doc.overall_score).toBe(4);
    expect(doc.ratings.technical_skill).toBe(5);
  });

  it('re-saving the same interview updates one scorecard instead of duplicating', async () => {
    await seed();
    const first = await upsertScorecardImpl('emp', scorecard());
    const second = await upsertScorecardImpl('emp', scorecard({ recommendation: 'strong_hire', overallScore: 5 }));
    expect(second.scorecardId).toBe(first.scorecardId);
    const snap = await db.collection('application_scorecards').where('interview_id', '==', 'iv1').get();
    expect(snap.size).toBe(1);
    expect(snap.docs[0].data().recommendation).toBe('strong_hire');
  });

  it('denies non-owner employers and candidates', async () => {
    await seed();
    await expect(upsertScorecardImpl('otherEmp', scorecard())).rejects.toThrow(/own/i);
    await expect(upsertScorecardImpl('cand', scorecard())).rejects.toThrow(/own/i);
  });

  it('rejects cancelled interviews and invalid scorecard fields', async () => {
    await seed('cancelled');
    await expect(upsertScorecardImpl('emp', scorecard())).rejects.toThrow(/cancelled/i);

    await seed('completed');
    await expect(upsertScorecardImpl('emp', scorecard({ recommendation: 'maybe' }))).rejects.toThrow(/recommendation/i);
    await expect(upsertScorecardImpl('emp', scorecard({ overallScore: 7 }))).rejects.toThrow(/overallScore/i);
    await expect(upsertScorecardImpl('emp', scorecard({ evidence: '' }))).rejects.toThrow(/Evidence/i);
    await expect(upsertScorecardImpl('emp', scorecard({ ratings: { role_fit: 3 } }))).rejects.toThrow(/technical_skill/i);
  });
});
