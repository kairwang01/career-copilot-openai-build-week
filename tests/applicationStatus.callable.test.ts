/**
 * Application-status callable integration tests — exercise the REAL
 * updateApplicationStatusImpl against the Firestore emulator. Proves the hiring
 * pipeline trust contract: only the owning employer may mutate status; skip,
 * reject, and reopen actions require an audit reason; skip records the stages it
 * bypassed; internal reasons stay out of the candidate-readable application doc.
 *
 * Run: firebase emulators:exec --only firestore --project demo-careercopilot \
 *        "npx vitest run tests/applicationStatus.callable.test.ts"
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as admin from '../functions/node_modules/firebase-admin';
import { updateApplicationStatusImpl } from '../functions/src/handlers/updateApplicationStatus';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-careercopilot';
const db = admin.firestore();

async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
}

async function seedApplication(status = 'Applied') {
  await db.collection('job_postings').doc('job1').set({
    employer_id: 'emp1',
    title: 'Product Engineer',
    company_name: 'Acme',
    is_active: true,
  });
  await db.collection('job_postings').doc('job2').set({
    employer_id: 'emp2',
    title: 'Data Engineer',
    company_name: 'OtherCo',
    is_active: true,
  });
  await db.collection('job_applications').doc('app1').set({
    job_id: 'job1',
    candidate_id: 'cand1',
    employer_id: 'emp1',
    candidate_name: 'Candidate One',
    job_title: 'Product Engineer',
    status,
    application_date: admin.firestore.Timestamp.fromDate(new Date('2026-01-01T00:00:00Z')),
  });
}

beforeEach(clearFirestore);

describe('updateApplicationStatus callable', () => {
  it('advances one pipeline step and writes an audited event', async () => {
    await seedApplication();

    const result = await updateApplicationStatusImpl('emp1', {
      applicationId: 'app1',
      action: 'advance',
      candidateNote: 'We are moving you to the next step.',
    });

    expect(result.status).toBe('Group Interview');
    expect(result.action).toBe('advance');
    expect(result.skippedStatuses).toEqual([]);

    const app = (await db.collection('job_applications').doc('app1').get()).data()!;
    expect(app.status).toBe('Group Interview');
    expect(app.last_status_note).toBe('We are moving you to the next step.');
    expect(app.last_status_action).toBe('advance');

    const events = await db.collection('application_status_events').where('application_id', '==', 'app1').get();
    expect(events.size).toBe(1);
    expect(events.docs[0].data().action).toBe('advance');
  });

  it('requires a reason when skipping stages and records skipped stages', async () => {
    await seedApplication();

    await expect(updateApplicationStatusImpl('emp1', {
      applicationId: 'app1',
      action: 'skip',
      status: 'Second Interview',
    })).rejects.toThrow(/reason/i);

    const result = await updateApplicationStatusImpl('emp1', {
      applicationId: 'app1',
      action: 'skip',
      status: 'Second Interview',
      reason: 'Phone screen already covered the group and first interview signal.',
    });

    expect(result.status).toBe('Second Interview');
    expect(result.action).toBe('skip');
    expect(result.skippedStatuses).toEqual(['Group Interview', 'First Interview']);

    const app = (await db.collection('job_applications').doc('app1').get()).data()!;
    expect(app.status).toBe('Second Interview');
    expect(app.skipped_statuses).toEqual(['Group Interview', 'First Interview']);

    const event = (await db.collection('application_status_events').where('application_id', '==', 'app1').get()).docs[0].data();
    expect(event.action).toBe('skip');
    expect(event.skipped_statuses).toEqual(['Group Interview', 'First Interview']);
    expect(event.reason).toMatch(/Phone screen/);
  });

  it('preserves skipped stages after later ordinary advances', async () => {
    await seedApplication();

    await updateApplicationStatusImpl('emp1', {
      applicationId: 'app1',
      action: 'skip',
      status: 'Second Interview',
      reason: 'Recruiter screen already covered the earlier interview signal.',
    });
    const result = await updateApplicationStatusImpl('emp1', {
      applicationId: 'app1',
      action: 'advance',
      candidateNote: 'You are moving to the decision-maker interview.',
    });

    expect(result.status).toBe('Decision Maker Interview');
    expect(result.action).toBe('advance');
    expect(result.skippedStatuses).toEqual([]);

    const app = (await db.collection('job_applications').doc('app1').get()).data()!;
    expect(app.status).toBe('Decision Maker Interview');
    expect(app.skipped_statuses).toEqual(['Group Interview', 'First Interview']);
    expect(app.last_status_note).toBe('You are moving to the decision-maker interview.');

    const events = await db
      .collection('application_status_events')
      .where('application_id', '==', 'app1')
      .get();
    expect(events.size).toBe(2);
    expect(events.docs.map((doc) => doc.data().action).sort()).toEqual(['advance', 'skip']);
  });

  it('requires a reason when rejecting and keeps the internal reason out of the application doc', async () => {
    await seedApplication('First Interview');

    await expect(updateApplicationStatusImpl('emp1', {
      applicationId: 'app1',
      action: 'reject',
    })).rejects.toThrow(/reason/i);

    await updateApplicationStatusImpl('emp1', {
      applicationId: 'app1',
      action: 'reject',
      reason: 'Required platform experience was not demonstrated.',
      candidateNote: 'We will not move forward for this role.',
    });

    const app = (await db.collection('job_applications').doc('app1').get()).data()!;
    expect(app.status).toBe('Rejected');
    expect(app.last_status_note).toBe('We will not move forward for this role.');
    expect(app.reason).toBeUndefined();

    const event = (await db.collection('application_status_events').where('application_id', '==', 'app1').get()).docs[0].data();
    expect(event.action).toBe('reject');
    expect(event.reason).toBe('Required platform experience was not demonstrated.');
  });

  it('requires a reason when reopening a rejected application', async () => {
    await seedApplication('Rejected');
    await db.collection('job_applications').doc('app1').update({
      skipped_statuses: ['Group Interview', 'First Interview'],
    });

    await expect(updateApplicationStatusImpl('emp1', {
      applicationId: 'app1',
      action: 'reopen',
    })).rejects.toThrow(/reason/i);

    const result = await updateApplicationStatusImpl('emp1', {
      applicationId: 'app1',
      action: 'reopen',
      reason: 'Hiring manager requested a second review.',
    });

    expect(result.status).toBe('Applied');
    expect(result.action).toBe('reopen');
    const app = (await db.collection('job_applications').doc('app1').get()).data()!;
    expect(app.status).toBe('Applied');
    expect(app.skipped_statuses).toEqual([]);
  });

  it('does not allow a signed application to be rejected through the normal reject action', async () => {
    await seedApplication('Signed');
    await expect(updateApplicationStatusImpl('emp1', {
      applicationId: 'app1',
      action: 'reject',
      reason: 'Changed plans.',
    })).rejects.toThrow(/final tracked stage/i);
  });

  it('denies status changes by a non-owning employer', async () => {
    await seedApplication();
    await expect(updateApplicationStatusImpl('emp2', {
      applicationId: 'app1',
      action: 'advance',
    })).rejects.toThrow(/own the job/i);
  });
});
