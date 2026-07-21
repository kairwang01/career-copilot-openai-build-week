/**
 * Interview-scheduling callable integration tests — real Firestore emulator +
 * Admin SDK. Proves: only the job-owning employer schedules / reschedules /
 * cancels; only the candidate confirms; reschedule resets confirmation; format
 * is validated; non-owners are denied.
 *
 * Run via `npm run test:callables` (emulators:exec sets the env).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as admin from '../functions/node_modules/firebase-admin';
import {
  scheduleInterviewImpl,
  updateInterviewImpl,
  confirmInterviewImpl,
} from '../functions/src/handlers/interviews';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-careercopilot';
const db = admin.firestore();

async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
}

async function seedApp(appId = 'app1') {
  await db.collection('users').doc('emp').set({ role: 'employer', company_name: 'Acme' });
  await db.collection('users').doc('cand').set({ role: 'candidate' });
  await db.collection('job_postings').doc('job1').set({ employer_id: 'emp', title: 'Engineer', is_active: true });
  await db.collection('job_applications').doc(appId).set({ job_id: 'job1', candidate_id: 'cand', status: 'First Interview' });
}

const schedule = (over: Record<string, unknown> = {}) => ({
  applicationId: 'app1', stage: 'First Interview', scheduledAt: '2026-07-01T14:00',
  timezone: 'America/Toronto', format: 'video', locationOrLink: 'https://meet.example/x',
  interviewer: 'Dana', notes: 'Bring portfolio', ...over,
});

beforeEach(clearFirestore);

describe('scheduleInterview', () => {
  it('the job-owning employer can schedule; the record is candidate-linked', async () => {
    await seedApp();
    const { interviewId } = await scheduleInterviewImpl('emp', schedule());
    const doc = (await db.collection('application_interviews').doc(interviewId).get()).data()!;
    expect(doc.employer_id).toBe('emp');
    expect(doc.candidate_id).toBe('cand');
    expect(doc.format).toBe('video');
    expect(doc.interview_status).toBe('scheduled');
    expect(doc.candidate_confirmed).toBe(false);
  });

  it('a non-owner employer cannot schedule', async () => {
    await seedApp();
    await expect(scheduleInterviewImpl('intruder', schedule())).rejects.toThrow(/own the job/i);
  });

  it('rejects an invalid format and a missing time', async () => {
    await seedApp();
    await expect(scheduleInterviewImpl('emp', schedule({ format: 'carrier-pigeon' }))).rejects.toThrow(/format/i);
    await expect(scheduleInterviewImpl('emp', schedule({ scheduledAt: '' }))).rejects.toThrow(/time/i);
  });
});

describe('confirm / update', () => {
  it('the candidate can confirm; a stranger cannot', async () => {
    await seedApp();
    const { interviewId } = await scheduleInterviewImpl('emp', schedule());
    await expect(confirmInterviewImpl('someone', { interviewId })).rejects.toThrow(/your own/i);
    await confirmInterviewImpl('cand', { interviewId });
    expect((await db.collection('application_interviews').doc(interviewId).get()).data()!.candidate_confirmed).toBe(true);
  });

  it('rescheduling resets the candidate confirmation', async () => {
    await seedApp();
    const { interviewId } = await scheduleInterviewImpl('emp', schedule());
    await confirmInterviewImpl('cand', { interviewId });
    await updateInterviewImpl('emp', { interviewId, scheduledAt: '2026-07-05T09:00' });
    const doc = (await db.collection('application_interviews').doc(interviewId).get()).data()!;
    expect(doc.scheduled_at).toBe('2026-07-05T09:00');
    expect(doc.candidate_confirmed).toBe(false);
  });

  it('a cancelled interview cannot be confirmed', async () => {
    await seedApp();
    const { interviewId } = await scheduleInterviewImpl('emp', schedule());
    await updateInterviewImpl('emp', { interviewId, interviewStatus: 'cancelled' });
    await expect(confirmInterviewImpl('cand', { interviewId })).rejects.toThrow(/cancelled/i);
  });

  it('a non-owner employer cannot update an interview', async () => {
    await seedApp();
    const { interviewId } = await scheduleInterviewImpl('emp', schedule());
    await expect(updateInterviewImpl('intruder', { interviewId, interviewStatus: 'completed' })).rejects.toThrow(/your own/i);
  });
});
