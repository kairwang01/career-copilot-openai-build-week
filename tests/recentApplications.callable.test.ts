import { beforeEach, describe, expect, it } from 'vitest';
import * as admin from '../functions/node_modules/firebase-admin';
import {
  listRecentApplicationsImpl,
  RECENT_APPLICATION_LIMIT,
} from '../functions/src/handlers/listRecentApplications';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-careercopilot';
const db = admin.firestore();

async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, {
    method: 'DELETE',
  });
}

beforeEach(clearFirestore);

describe('listRecentApplications', () => {
  it('returns only the signed-in candidate, newest first, with a bounded batched enrichment', async () => {
    const batch = db.batch();
    for (let index = 0; index < RECENT_APPLICATION_LIMIT + 2; index += 1) {
      const jobId = `job-${index}`;
      batch.set(db.collection('job_postings').doc(jobId), {
        title: `Server title ${index}`,
        company_name: `Company ${index}`,
        location: 'Ottawa',
        description: `Description ${index}`,
        responsibilities: 'Build safely',
        required_qualifications: 'TypeScript',
        is_active: index !== RECENT_APPLICATION_LIMIT + 1,
      });
      batch.set(db.collection('job_applications').doc(`candidate-app-${index}`), {
        candidate_id: 'candidate',
        job_id: jobId,
        job_title: `Frozen title ${index}`,
        status: 'Applied',
        application_date: admin.firestore.Timestamp.fromMillis(index * 1_000),
      });
    }
    batch.set(db.collection('job_applications').doc('other-user-app'), {
      candidate_id: 'other-user',
      job_id: 'job-21',
      status: 'Applied',
      application_date: admin.firestore.Timestamp.fromMillis(999_999),
    });
    await batch.commit();

    const result = await listRecentApplicationsImpl('candidate');

    expect(result.applications).toHaveLength(RECENT_APPLICATION_LIMIT);
    expect(result.applications[0]).toMatchObject({
      id: `candidate-app-${RECENT_APPLICATION_LIMIT + 1}`,
      job_title: `Server title ${RECENT_APPLICATION_LIMIT + 1}`,
      company_name: `Company ${RECENT_APPLICATION_LIMIT + 1}`,
    });
    expect(result.applications[0].application_date).toBe(new Date((RECENT_APPLICATION_LIMIT + 1) * 1_000).toISOString());
    expect(result.applications.at(-1)?.id).toBe('candidate-app-2');
    expect(result.applications.some((application) => application.id === 'other-user-app')).toBe(false);
  });

  it('keeps a frozen title when the original posting no longer exists', async () => {
    await db.collection('job_applications').doc('legacy-app').set({
      candidate_id: 'candidate',
      job_id: 'deleted-job',
      job_title: 'Frozen legacy title',
      status: 'Applied',
      application_date: admin.firestore.Timestamp.now(),
    });

    const result = await listRecentApplicationsImpl('candidate');

    expect(result.applications).toEqual([
      expect.objectContaining({
        id: 'legacy-app',
        job_title: 'Frozen legacy title',
        company_name: '',
      }),
    ]);
  });
});
