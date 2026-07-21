/**
 * sourcing-outreach callable integration tests — real Firestore emulator +
 * Admin SDK. Proves: only business accounts can request outreach, job ownership
 * is enforced, candidates own accept/decline/revoke, and a frozen candidate
 * packet is only available during the explicit 30-day consent window.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as admin from '../functions/node_modules/firebase-admin';
import {
  createSourcingOutreachImpl,
  respondSourcingOutreachImpl,
  cancelSourcingOutreachImpl,
  getSourcingCandidatePacketImpl,
  SOURCING_DAILY_REQUEST_LIMITS,
  SOURCING_REQUEST_COOLDOWN_MS,
} from '../functions/src/handlers/sourcingOutreach';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-careercopilot';
const db = admin.firestore();

async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
}

async function seed() {
  await db.collection('users').doc('emp').set({
    role: 'employer',
    company_name: 'Acme Robotics',
  });
  await db.collection('users').doc('agency').set({ role: 'agency', company_name: 'Agency Co' });
  await db.collection('users').doc('cand').set({
    role: 'candidate',
    full_name: 'Cand Idate',
    email: 'cand@example.com',
    phone: '+1 555 0100',
    resume_text: 'Senior product engineer with React, Python, and hiring-platform experience.',
  });
  await db.collection('users').doc('other').set({ role: 'employer', company_name: 'Other Co' });
  await db.collection('job_postings').doc('job1').set({
    employer_id: 'emp',
    title: 'Product Engineer',
    company_name: 'Acme Robotics',
    is_active: true,
  });
  await db.collection('job_postings').doc('job2').set({
    employer_id: 'other',
    title: 'Data Engineer',
    company_name: 'Other Co',
    is_active: true,
  });
  await db.collection('job_postings').doc('job3').set({
    employer_id: 'emp',
    title: 'Platform Engineer',
    company_name: 'Acme Robotics',
    is_active: true,
  });
  await db.collection('talent_profiles').doc('cand').set({
    status: 'complete',
    discoverable: true,
    summary: { headline: 'Product-minded engineer' },
    skills: { technical: ['React', 'Python'] },
    references: [{ identity: 'Manager', organization: 'Third Party Co' }],
  });
}

async function seedCandidate(id: string) {
  await db.collection('users').doc(id).set({
    role: 'candidate',
    full_name: `Candidate ${id}`,
    email: `${id}@example.com`,
  });
  await db.collection('talent_profiles').doc(id).set({
    status: 'complete',
    discoverable: true,
    references: [{ identity: 'Manager', organization: 'Third Party Co' }],
  });
}

async function expirePairCooldown(outreachId: string, candidateId = 'cand') {
  const oldMs = Date.now() - SOURCING_REQUEST_COOLDOWN_MS - 60_000;
  await Promise.all([
    db.collection('sourcing_outreach').doc(outreachId).update({
      cooldown_until_ms: oldMs,
      packet_expires_at_ms: oldMs - SOURCING_REQUEST_COOLDOWN_MS,
      updated_at: admin.firestore.Timestamp.fromMillis(oldMs - SOURCING_REQUEST_COOLDOWN_MS),
    }),
    db.collection('sourcing_outreach_pair_guards').doc(`emp__${candidateId}`).set({
      employer_id: 'emp',
      candidate_id: candidateId,
      outreach_id: outreachId,
      status: 'declined',
      active_until_ms: 0,
      cooldown_until_ms: oldMs,
      updated_at: admin.firestore.Timestamp.fromMillis(oldMs),
    }),
  ]);
}

const request = (over: Record<string, unknown> = {}) => ({
  candidateId: 'cand',
  jobId: 'job1',
  message: 'Your product engineering background looks aligned with our role.',
  ...over,
});

beforeEach(clearFirestore);

describe('createSourcingOutreach', () => {
  it('a job-owning employer can request consent; the candidate is not unlocked yet', async () => {
    await seed();
    const { outreachId, status, duplicate } = await createSourcingOutreachImpl('emp', request());
    expect(status).toBe('requested');
    expect(duplicate).toBe(false);
    const doc = (await db.collection('sourcing_outreach').doc(outreachId).get()).data()!;
    expect(doc.employer_id).toBe('emp');
    expect(doc.candidate_id).toBe('cand');
    expect(doc.job_id).toBe('job1');
    expect(doc.company_name).toBe('Acme Robotics');
    expect(doc.organization_verification).toBe('unverified_self_reported');
    await expect(getSourcingCandidatePacketImpl('emp', { outreachId })).rejects.toThrow(/not active|expired/i);
  });

  it('dedupes an active request instead of creating repeat spam', async () => {
    await seed();
    const first = await createSourcingOutreachImpl('emp', request());
    const second = await createSourcingOutreachImpl('emp', request({ message: 'Checking again.' }));
    expect(second.outreachId).toBe(first.outreachId);
    expect(second.duplicate).toBe(true);
    expect(second.status).toBe('requested');
  });

  it('serializes cross-job requests to one pending employer-candidate pair', async () => {
    await seed();
    const results = await Promise.all([
      createSourcingOutreachImpl('emp', request({ jobId: 'job1' })),
      createSourcingOutreachImpl('emp', request({ jobId: 'job3' })),
    ]);

    expect(results.filter((result) => result.duplicate)).toHaveLength(1);
    expect(new Set(results.map((result) => result.outreachId)).size).toBe(1);
    const pending = await db.collection('sourcing_outreach')
      .where('employer_id', '==', 'emp')
      .where('candidate_id', '==', 'cand')
      .where('status', '==', 'requested')
      .get();
    expect(pending.size).toBe(1);
  });

  it('rejects an owned job that is no longer active', async () => {
    await seed();
    await db.collection('job_postings').doc('job1').update({ is_active: false });

    await expect(createSourcingOutreachImpl('emp', request())).rejects.toThrow(/active job/i);
  });

  it('atomically enforces the conservative unverified UTC-day quota', async () => {
    await seed();
    const candidateIds = Array.from(
      { length: SOURCING_DAILY_REQUEST_LIMITS.unverified + 1 },
      (_, index) => `quota-cand-${index}`,
    );
    await Promise.all(candidateIds.map(seedCandidate));

    const results = await Promise.allSettled(candidateIds.map((candidateId) => (
      createSourcingOutreachImpl('emp', request({ candidateId, jobId: '' }))
    )));

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(
      SOURCING_DAILY_REQUEST_LIMITS.unverified,
    );
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const quotaSnap = await db.collection('sourcing_outreach_daily_quotas').get();
    expect(quotaSnap.docs[0]?.get('count')).toBe(SOURCING_DAILY_REQUEST_LIMITS.unverified);
  });

  it('grants verified organizations the documented higher daily tier', async () => {
    await seed();
    await db.collection('users').doc('emp').update({ organization_verified: true });
    const count = SOURCING_DAILY_REQUEST_LIMITS.unverified + 1;
    const candidateIds = Array.from({ length: count }, (_, index) => `verified-cand-${index}`);
    await Promise.all(candidateIds.map(seedCandidate));

    for (const candidateId of candidateIds) {
      await expect(createSourcingOutreachImpl('emp', request({ candidateId, jobId: '' }))).resolves.toMatchObject({
        status: 'requested',
      });
    }
    expect(SOURCING_DAILY_REQUEST_LIMITS.verified).toBeGreaterThan(count);
  });

  it('rejects candidate callers, non-candidate targets, and jobs not owned by the caller', async () => {
    await seed();
    await expect(createSourcingOutreachImpl('cand', request())).rejects.toThrow(/business/i);
    await expect(createSourcingOutreachImpl('emp', request({ candidateId: 'agency' }))).rejects.toThrow(/candidate/i);
    await expect(createSourcingOutreachImpl('emp', request({ jobId: 'job2' }))).rejects.toThrow(/own/i);
  });

  it('rejects outreach when the candidate has not opted into discovery', async () => {
    await seed();
    await db.collection('talent_profiles').doc('cand').update({ discoverable: false });

    await expect(createSourcingOutreachImpl('emp', request())).rejects.toThrow(/not currently open/i);
  });

  it('expires an unanswered request instead of leaving permanent pending consent', async () => {
    await seed();
    const { outreachId } = await createSourcingOutreachImpl('emp', request());
    const stored = await db.collection('sourcing_outreach').doc(outreachId).get();
    expect(stored.get('request_expires_at_ms')).toBeGreaterThan(Date.now());
    await stored.ref.update({ request_expires_at_ms: Date.now() - 1 });

    await expect(respondSourcingOutreachImpl('cand', { outreachId, action: 'accept' })).rejects.toThrow(/expired/i);
  });
});

describe('respond / cancel / unlock', () => {
  it('the requested candidate can accept and then the employer can fetch the consented packet', async () => {
    await seed();
    const { outreachId } = await createSourcingOutreachImpl('emp', request());
    await respondSourcingOutreachImpl('cand', { outreachId, action: 'accept', note: 'Happy to connect.' });
    const packet = await getSourcingCandidatePacketImpl('emp', { outreachId });
    expect(packet.status).toBe('accepted');
    expect(packet.candidate.full_name).toBe('Cand Idate');
    expect(packet.candidate.email).toBe('cand@example.com');
    expect(packet.candidate.resume_text).toMatch(/React/);
    expect(packet.candidate.talent_profile).toBeNull();
    expect(packet.expires_at_ms).toBeGreaterThan(Date.now());

    await db.collection('users').doc('cand').update({
      full_name: 'Changed After Consent',
      email: 'changed@example.com',
      resume_text: 'Changed resume after consent.',
    });
    await db.collection('talent_profiles').doc('cand').update({
      summary: { headline: 'Changed profile after consent' },
    });
    const frozenPacket = await getSourcingCandidatePacketImpl('emp', { outreachId });
    expect(frozenPacket.candidate.full_name).toBe('Cand Idate');
    expect(frozenPacket.candidate.email).toBe('cand@example.com');
    expect(frozenPacket.candidate.resume_text).toMatch(/Senior product engineer/);
    expect(frozenPacket.candidate.talent_profile).toBeNull();
  });

  it('a stranger cannot respond or fetch the packet', async () => {
    await seed();
    const { outreachId } = await createSourcingOutreachImpl('emp', request());
    await expect(respondSourcingOutreachImpl('other', { outreachId, action: 'accept' })).rejects.toThrow(/candidate/i);
    await respondSourcingOutreachImpl('cand', { outreachId, action: 'accept' });
    await expect(getSourcingCandidatePacketImpl('other', { outreachId })).rejects.toThrow(/requesting employer/i);
  });

  it('declined requests enter cooldown and cancelled requests cannot be unlocked', async () => {
    await seed();
    const declined = await createSourcingOutreachImpl('emp', request());
    await respondSourcingOutreachImpl('cand', { outreachId: declined.outreachId, action: 'decline' });
    await expect(getSourcingCandidatePacketImpl('emp', { outreachId: declined.outreachId })).rejects.toThrow(/not active|expired/i);
    await expect(createSourcingOutreachImpl('emp', request({
      jobId: 'job3',
      message: 'An immediate cross-job retry that must be blocked.',
    }))).rejects.toThrow(/cooldown/i);

    await expirePairCooldown(declined.outreachId);
    const recreated = await createSourcingOutreachImpl('emp', request({ message: 'One more tailored note.' }));
    await cancelSourcingOutreachImpl('emp', { outreachId: recreated.outreachId, note: 'Role closed.' });
    await expect(respondSourcingOutreachImpl('cand', { outreachId: recreated.outreachId, action: 'accept' })).rejects.toThrow(/no longer pending/i);
  });

  it('lets the candidate revoke an accepted packet immediately', async () => {
    await seed();
    const { outreachId } = await createSourcingOutreachImpl('emp', request());
    await respondSourcingOutreachImpl('cand', { outreachId, action: 'accept' });
    await expect(getSourcingCandidatePacketImpl('emp', { outreachId })).resolves.toMatchObject({ status: 'accepted' });

    await respondSourcingOutreachImpl('cand', { outreachId, action: 'revoke', note: 'No longer interested.' });

    expect((await db.collection('sourcing_outreach').doc(outreachId).get()).get('status')).toBe('revoked');
    await expect(getSourcingCandidatePacketImpl('emp', { outreachId })).rejects.toThrow(/not active|expired/i);
  });

  it('treats an expired accepted packet as terminal and applies cooldown before renewal', async () => {
    await seed();
    const { outreachId } = await createSourcingOutreachImpl('emp', request());
    await respondSourcingOutreachImpl('cand', { outreachId, action: 'accept' });
    await db.collection('sourcing_outreach').doc(outreachId).update({ packet_expires_at_ms: Date.now() - 1 });

    await expect(getSourcingCandidatePacketImpl('emp', { outreachId })).rejects.toThrow(/expired/i);
    await expect(createSourcingOutreachImpl('emp', request({
      jobId: 'job3',
      message: 'A request while the expired consent is still cooling down.',
    }))).rejects.toThrow(/cooldown/i);

    await expirePairCooldown(outreachId);
    const renewed = await createSourcingOutreachImpl('emp', request({
      jobId: 'job3',
      message: 'A new request after the prior access window and cooldown expired.',
    }));
    expect(renewed).toMatchObject({ status: 'requested', duplicate: false });
  });

  it('allows only one terminal consent action under concurrent candidate responses', async () => {
    await seed();
    const { outreachId } = await createSourcingOutreachImpl('emp', request());

    const results = await Promise.allSettled([
      respondSourcingOutreachImpl('cand', { outreachId, action: 'accept' }),
      respondSourcingOutreachImpl('cand', { outreachId, action: 'decline' }),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const doc = (await db.collection('sourcing_outreach').doc(outreachId).get()).data()!;
    expect(['accepted', 'declined']).toContain(doc.status);
    if (doc.status === 'accepted') {
      await expect(getSourcingCandidatePacketImpl('emp', { outreachId })).resolves.toMatchObject({ status: 'accepted' });
    } else {
      await expect(getSourcingCandidatePacketImpl('emp', { outreachId })).rejects.toThrow(/not active|expired/i);
    }
  });

  it('allows only one terminal action when candidate response and employer cancellation race', async () => {
    await seed();
    const { outreachId } = await createSourcingOutreachImpl('emp', request());

    const results = await Promise.allSettled([
      respondSourcingOutreachImpl('cand', { outreachId, action: 'accept' }),
      cancelSourcingOutreachImpl('emp', { outreachId, note: 'Role paused.' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const status = (await db.collection('sourcing_outreach').doc(outreachId).get()).get('status');
    expect(['accepted', 'cancelled']).toContain(status);
  });
});
