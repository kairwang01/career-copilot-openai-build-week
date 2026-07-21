/**
 * bulk application action callable tests — real Firestore emulator + Admin SDK.
 * Proves batch pipeline actions still use the same ownership/status/message
 * contracts as single-applicant operations.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as admin from '../functions/node_modules/firebase-admin';
import { bulkUpdateApplicationStatusImpl } from '../functions/src/handlers/bulkApplicationActions';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-careercopilot';
const db = admin.firestore();

async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
}

async function seed() {
  await db.collection('job_postings').doc('job1').set({
    employer_id: 'emp1',
    title: 'Product Engineer',
    is_active: true,
  });
  await db.collection('job_postings').doc('job2').set({
    employer_id: 'emp2',
    title: 'Data Engineer',
    is_active: true,
  });
  await db.collection('job_applications').doc('app1').set({
    job_id: 'job1',
    candidate_id: 'cand1',
    status: 'Applied',
    application_date: admin.firestore.Timestamp.fromDate(new Date('2026-01-01T00:00:00Z')),
  });
  await db.collection('job_applications').doc('app2').set({
    job_id: 'job1',
    candidate_id: 'cand2',
    status: 'First Interview',
    application_date: admin.firestore.Timestamp.fromDate(new Date('2026-01-02T00:00:00Z')),
  });
  await db.collection('job_applications').doc('appOther').set({
    job_id: 'job2',
    candidate_id: 'cand3',
    status: 'Applied',
    application_date: admin.firestore.Timestamp.fromDate(new Date('2026-01-03T00:00:00Z')),
  });
}

beforeEach(clearFirestore);

describe('bulkUpdateApplicationStatus', () => {
  it('advances multiple applications and writes one audit event per changed application', async () => {
    await seed();
    const result = await bulkUpdateApplicationStatusImpl('emp1', {
      applicationIds: ['app1', 'app2'],
      action: 'advance',
      candidateNote: 'We are moving you to the next step.',
    });

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.results.map((item) => item.status)).toEqual(['Group Interview', 'Second Interview']);

    const app1 = (await db.collection('job_applications').doc('app1').get()).data()!;
    const app2 = (await db.collection('job_applications').doc('app2').get()).data()!;
    expect(app1.status).toBe('Group Interview');
    expect(app2.status).toBe('Second Interview');

    const events = await db.collection('application_status_events').get();
    expect(events.size).toBe(2);
    expect(events.docs.map((doc) => doc.data().action).sort()).toEqual(['advance', 'advance']);
  });

  it('requires an internal reason for bulk rejection before changing any application', async () => {
    await seed();
    await expect(
      bulkUpdateApplicationStatusImpl('emp1', {
        applicationIds: ['app1', 'app2'],
        action: 'reject',
      }),
    ).rejects.toThrow(/reason/i);

    const app1 = (await db.collection('job_applications').doc('app1').get()).data()!;
    expect(app1.status).toBe('Applied');
  });

  it('returns partial failure when a batch includes an application outside the employer account', async () => {
    await seed();
    const result = await bulkUpdateApplicationStatusImpl('emp1', {
      applicationIds: ['app1', 'appOther'],
      action: 'advance',
    });

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results.find((item) => item.applicationId === 'app1')?.ok).toBe(true);
    const failed = result.results.find((item) => item.applicationId === 'appOther')!;
    expect(failed.ok).toBe(false);
    expect(failed.errorMessage).toMatch(/own the job/i);

    const other = (await db.collection('job_applications').doc('appOther').get()).data()!;
    expect(other.status).toBe('Applied');
  });

  it('can send an automatic candidate notification for each successful status update', async () => {
    await seed();
    const result = await bulkUpdateApplicationStatusImpl('emp1', {
      applicationIds: ['app1', 'app2'],
      action: 'reject',
      reason: 'Role scope changed after final headcount review.',
      candidateNote: 'We will not move forward for this role.',
      notify: true,
      templateKey: 'rejection',
      messageBody: 'Thank you for your time. We will not move forward for this role.',
    });

    expect(result.succeeded).toBe(2);
    expect(result.results.every((item) => Boolean(item.messageId))).toBe(true);

    const messages = await db.collection('application_messages').get();
    expect(messages.size).toBe(2);
    expect(messages.docs.map((doc) => doc.data().template_key)).toEqual(['rejection', 'rejection']);
    expect(messages.docs.map((doc) => doc.data().sender_role)).toEqual(['employer', 'employer']);
  });
});
