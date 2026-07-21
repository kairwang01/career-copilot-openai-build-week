/**
 * AI request-claim integration tests.
 *
 * Run under the Firestore emulator. Provider adapters are replaced with a
 * counting fake so a requestId replay proves that no model work starts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from '../functions/node_modules/firebase-admin';

const { defaultProviderResult, generateMock, resolveProviderMock } = vi.hoisted(() => {
  const defaultResult = {
    text: 'ok',
    raw: {
      score: 80,
      summary: 'Summary',
      strengths: ['one', 'two', 'three', 'four'],
      improvements: [
        { area: 'one', suggestion: 'one' },
        { area: 'two', suggestion: 'two' },
        { area: 'three', suggestion: 'three' },
        { area: 'four', suggestion: 'four' },
      ],
      keywords: ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'],
    },
    model: 'fake-model',
    provider: 'fake-provider',
  };
  const generate = vi.fn().mockResolvedValue(defaultResult);
  return {
    defaultProviderResult: defaultResult,
    generateMock: generate,
    resolveProviderMock: vi.fn().mockResolvedValue({ name: 'fake-provider', generate }),
  };
});

vi.mock('../functions/src/llm/models', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../functions/src/llm/models')>()),
  resolveProvider: resolveProviderMock,
}));

import { analyzeResumeFunction } from '../functions/src/handlers/analyzeResume';
import { careerCoachFunction } from '../functions/src/handlers/careerCoach';
import { getUserTodayUsage } from '../functions/src/admin/usageLog';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-careercopilot';
const db = admin.firestore();

async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, {
    method: 'DELETE',
  });
}

function usageEventId(uid: string, requestId: string): string {
  return `req_${Buffer.from(uid).toString('base64url')}_${Buffer.from(requestId).toString('base64url')}`;
}

async function seedClaim(uid: string, requestId: string, data: Record<string, unknown>) {
  await db.collection('usage_events').doc(usageEventId(uid, requestId)).set({
    uid,
    request_id: requestId,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    ...data,
  });
}

async function seedUser(uid: string, credits = 100) {
  await db.collection('users').doc(uid).set({
    role: 'candidate',
    subscription_status: 'free',
    credits,
    created_at: '2026-01-01',
  });
}

beforeEach(async () => {
  await clearFirestore();
  generateMock.mockReset().mockResolvedValue(defaultProviderResult);
  resolveProviderMock.mockReset().mockResolvedValue({ name: 'fake-provider', generate: generateMock });
});

describe('AI requestId replay', () => {
  it('rejects a replayed paid request before resolving or calling a model', async () => {
    const uid = 'duplicate-paid';
    const requestId = 'req_duplicate_paid';
    await seedClaim(uid, requestId, {
      tool: 'resume-analysis',
      credit_cost: 10,
      status: 'deducted',
      balance_after: 90,
    });

    await expect(analyzeResumeFunction.run({
      auth: { uid, token: { email_verified: true } },
      data: { resumeText: 'Valid resume text', marketName: 'Canada', requestId },
    } as never)).rejects.toMatchObject({ code: 'already-exists' });

    expect(resolveProviderMock).not.toHaveBeenCalled();
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('rejects a replayed free request before resolving or calling a model', async () => {
    const uid = 'duplicate-free';
    const requestId = 'req_duplicate_free';
    await seedClaim(uid, requestId, {
      tool: 'career-coach',
      credit_cost: 0,
      status: 'free',
      balance_after: null,
    });

    await expect(careerCoachFunction.run({
      auth: { uid, token: { email_verified: true } },
      data: { messages: [{ role: 'user', content: 'Help me plan my career.' }], requestId },
    } as never)).rejects.toMatchObject({ code: 'already-exists' });

    expect(resolveProviderMock).not.toHaveBeenCalled();
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('calls a failing model once and never refunds the uncharged replay', async () => {
    const uid = 'failure-replay';
    const requestId = 'req_failure_replay';
    await seedUser(uid);
    generateMock
      .mockRejectedValueOnce(new Error('provider failed'))
      .mockRejectedValueOnce(new Error('provider failed again'));

    const request = {
      auth: { uid, token: { email_verified: true } },
      data: { resumeText: 'Valid resume text', marketName: 'Canada', requestId },
    } as never;
    await expect(analyzeResumeFunction.run(request)).rejects.toMatchObject({ code: 'internal' });
    await expect(analyzeResumeFunction.run(request)).rejects.toMatchObject({ code: 'already-exists' });

    expect(generateMock).toHaveBeenCalledTimes(1);
    expect((await db.collection('users').doc(uid).get()).get('credits')).toBe(100);
    const events = await db.collection('usage_events').where('uid', '==', uid).get();
    expect(events.docs.filter((doc) => doc.get('status') === 'refunded')).toHaveLength(1);
    const ledger = await db.collection('credit_ledger').where('uid', '==', uid).get();
    expect(ledger.docs.filter((doc) => doc.get('reason') === 'tool_refund')).toHaveLength(1);
    await expect(getUserTodayUsage(uid)).resolves.toEqual({ runs: 1, credits: 0 });
  });

  it('refunds a schema-invalid provider result without releasing its abuse-control attempt', async () => {
    const uid = 'invalid-structured-result';
    const requestId = 'req_invalid_structured_result';
    await seedUser(uid);
    generateMock.mockResolvedValueOnce({
      ...defaultProviderResult,
      raw: {
        score: 80,
        summary: 'Incomplete result',
        strengths: ['one'],
        improvements: [{ area: 'one', suggestion: 'one' }],
        keywords: ['one'],
      },
    });

    await expect(analyzeResumeFunction.run({
      auth: { uid, token: { email_verified: true } },
      data: { resumeText: 'Valid resume text', marketName: 'Canada', requestId },
    } as never)).rejects.toMatchObject({ code: 'internal' });

    expect((await db.collection('users').doc(uid).get()).get('credits')).toBe(100);
    await expect(getUserTodayUsage(uid)).resolves.toEqual({ runs: 1, credits: 0 });
  });
});
