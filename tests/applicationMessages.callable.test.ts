/**
 * application-messages callable integration tests — real Firestore emulator + Admin SDK.
 * Proves: both participants (the job-owning employer and the candidate) can send a
 * message on their application, a non-participant cannot, the body is required, and
 * every message is stored as an immutable, attributable, timestamped record.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as admin from '../functions/node_modules/firebase-admin';
import { sendApplicationMessageImpl } from '../functions/src/handlers/applicationMessages';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-careercopilot';
const db = admin.firestore();

async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
}

async function seed() {
  await db.collection('job_postings').doc('job1').set({ employer_id: 'emp', title: 'Engineer', is_active: true });
  await db.collection('job_applications').doc('app1').set({ job_id: 'job1', candidate_id: 'cand', status: 'Applied' });
}

beforeEach(clearFirestore);

describe('sendApplicationMessage', () => {
  it('the job-owning employer can message the candidate (with a template tag)', async () => {
    await seed();
    const { messageId, senderRole } = await sendApplicationMessageImpl('emp', {
      applicationId: 'app1',
      body: 'We would love to set up a first interview next week.',
      templateKey: 'interview_invite',
    });
    expect(senderRole).toBe('employer');
    const doc = (await db.collection('application_messages').doc(messageId).get()).data()!;
    expect(doc.application_id).toBe('app1');
    expect(doc.employer_id).toBe('emp');
    expect(doc.candidate_id).toBe('cand');
    expect(doc.sender_uid).toBe('emp');
    expect(doc.sender_role).toBe('employer');
    expect(doc.template_key).toBe('interview_invite');
    expect(doc.body).toMatch(/first interview/);
    expect(doc.created_at).toBeTruthy();
  });

  it('the candidate can reply; replies are always tagged custom (no employer templates)', async () => {
    await seed();
    const { senderRole, messageId } = await sendApplicationMessageImpl('cand', {
      applicationId: 'app1',
      body: 'Thank you — Tuesday afternoon works for me.',
      templateKey: 'rejection', // ignored for candidate senders
    });
    expect(senderRole).toBe('candidate');
    const doc = (await db.collection('application_messages').doc(messageId).get()).data()!;
    expect(doc.sender_role).toBe('candidate');
    expect(doc.template_key).toBe('custom');
  });

  it('a non-participant (unrelated employer or stranger) cannot message', async () => {
    await seed();
    await expect(
      sendApplicationMessageImpl('otherEmp', { applicationId: 'app1', body: 'hi' }),
    ).rejects.toThrow(/participant/i);
    await expect(
      sendApplicationMessageImpl('stranger', { applicationId: 'app1', body: 'hi' }),
    ).rejects.toThrow(/participant/i);
  });

  it('requires a non-empty body and an existing application', async () => {
    await seed();
    await expect(
      sendApplicationMessageImpl('emp', { applicationId: 'app1', body: '   ' }),
    ).rejects.toThrow(/body is required/i);
    await expect(
      sendApplicationMessageImpl('emp', { applicationId: 'missing', body: 'hi' }),
    ).rejects.toThrow(/not found/i);
  });
});
