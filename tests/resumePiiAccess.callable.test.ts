/**
 * Resume-PII access-control tests (SCRUM-82) — real Firestore emulator + Admin SDK.
 *
 * Candidate resume text is owner-only in Firestore rules; employers reach it ONLY
 * through server-side callables. These tests prove the two authorization gates in
 * front of that PII hold under cross-account access:
 *
 *  A. assertEmployerOwnsApplication — the shared gate for getApplicantResumeFile /
 *     getApplicantResumeText: only the employer who owns the applied-to job passes.
 *  B. getSourcingCandidatePacketImpl — the consent gate for passive sourcing:
 *     the packet (resume + profile + contact) is released only to the REQUESTING
 *     employer and only AFTER the candidate accepts.
 *
 * Run via: npm run test:callables (Firestore emulator required).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as admin from '../functions/node_modules/firebase-admin';
import { assertEmployerOwnsApplication } from '../functions/src/handlers/applicantAccess';
import { getSourcingCandidatePacketImpl } from '../functions/src/handlers/sourcingOutreach';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-careercopilot';
const db = admin.firestore();

async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
}

const RESUME_SECRET = 'CASEY-RESUME-PII-8842 — Engineer with React experience.';

async function seedApplicationWorld() {
  // owner-emp owns job1; rival-emp owns job2; cand applied to job1 only.
  await db.collection('job_postings').doc('job1').set({ employer_id: 'owner-emp', title: 'Engineer', is_active: true });
  await db.collection('job_postings').doc('job2').set({ employer_id: 'rival-emp', title: 'Analyst', is_active: true });
  await db.collection('job_applications').doc('app1').set({
    candidate_id: 'cand',
    job_id: 'job1',
    employer_id: 'owner-emp',
    status: 'applied',
  });
  await db.collection('users').doc('cand').set({ resume_text: RESUME_SECRET });
}

beforeEach(clearFirestore);

describe('A · assertEmployerOwnsApplication — the applicant resume gate', () => {
  it('grants the employer who owns the applied-to job', async () => {
    await seedApplicationWorld();
    const { candidateId, jobId } = await assertEmployerOwnsApplication(db, 'owner-emp', 'app1');
    expect(candidateId).toBe('cand');
    expect(jobId).toBe('job1');
  });

  it('rejects a DIFFERENT employer (cross-account) even though they own their own job', async () => {
    await seedApplicationWorld();
    await expect(assertEmployerOwnsApplication(db, 'rival-emp', 'app1'))
      .rejects.toThrow(/do not own the job/i);
  });

  it('rejects the candidate themselves (this gate is employer-facing only)', async () => {
    await seedApplicationWorld();
    await expect(assertEmployerOwnsApplication(db, 'cand', 'app1'))
      .rejects.toThrow(/do not own the job/i);
  });

  it('rejects an application id that does not exist', async () => {
    await seedApplicationWorld();
    await expect(assertEmployerOwnsApplication(db, 'owner-emp', 'no-such-app'))
      .rejects.toThrow(/not found/i);
  });

  it('rejects when the referenced job was deleted (no orphan access)', async () => {
    await seedApplicationWorld();
    await db.collection('job_postings').doc('job1').delete();
    await expect(assertEmployerOwnsApplication(db, 'owner-emp', 'app1'))
      .rejects.toThrow(/do not own the job/i);
  });
});

async function seedOutreachWorld(status: 'requested' | 'accepted' | 'declined' | 'revoked') {
  const expiresAtMs = Date.now() + 30 * 24 * 60 * 60 * 1000;
  await db.collection('sourcing_outreach').doc('out1').set({
    employer_id: 'owner-emp',
    candidate_id: 'cand',
    status,
    message: 'We would like to connect.',
    packet_expires_at_ms: status === 'accepted' ? expiresAtMs : 0,
  });
  await db.collection('users').doc('cand').set({ resume_text: RESUME_SECRET, full_name: 'Casey Candidate' });
  await db.collection('talent_profiles').doc('cand').set({ basic: { name: 'Casey Candidate' } });
  if (status === 'accepted') {
    await db.collection('sourcing_candidate_packets').doc('out1').set({
      outreach_id: 'out1',
      employer_id: 'owner-emp',
      candidate_id: 'cand',
      expires_at_ms: expiresAtMs,
      candidate: {
        id: 'cand',
        full_name: 'Casey Candidate',
        resume_text: RESUME_SECRET,
        talent_profile: { basic: { name: 'Casey Candidate' } },
      },
    });
  }
}

describe('B · getSourcingCandidatePacketImpl — the sourcing consent gate', () => {
  it('BLOCKS the packet while the request is only "requested" (no consent yet)', async () => {
    await seedOutreachWorld('requested');
    await expect(getSourcingCandidatePacketImpl('owner-emp', { outreachId: 'out1' }))
      .rejects.toThrow(/not active|expired/i);
  });

  it('BLOCKS the packet after the candidate declined', async () => {
    await seedOutreachWorld('declined');
    await expect(getSourcingCandidatePacketImpl('owner-emp', { outreachId: 'out1' }))
      .rejects.toThrow(/not active|expired/i);
  });

  it('BLOCKS the packet after the candidate revoked access', async () => {
    await seedOutreachWorld('revoked');
    await expect(getSourcingCandidatePacketImpl('owner-emp', { outreachId: 'out1' }))
      .rejects.toThrow(/not active|expired/i);
  });

  it('rejects a THIRD-PARTY employer even after acceptance (packet is requester-only)', async () => {
    await seedOutreachWorld('accepted');
    await expect(getSourcingCandidatePacketImpl('rival-emp', { outreachId: 'out1' }))
      .rejects.toThrow(/only the requesting employer/i);
  });

  it('rejects the candidate calling the employer-facing unlock themselves', async () => {
    await seedOutreachWorld('accepted');
    await expect(getSourcingCandidatePacketImpl('cand', { outreachId: 'out1' }))
      .rejects.toThrow(/only the requesting employer/i);
  });

  it('releases the packet ONLY to the requesting employer after acceptance', async () => {
    await seedOutreachWorld('accepted');
    const packet = await getSourcingCandidatePacketImpl('owner-emp', { outreachId: 'out1' });
    expect(packet.outreachId).toBe('out1');
    expect(packet.status).toBe('accepted');
    // Consent flips the switch: the resume text is now genuinely included.
    expect(JSON.stringify(packet)).toContain('CASEY-RESUME-PII-8842');
  });
});
