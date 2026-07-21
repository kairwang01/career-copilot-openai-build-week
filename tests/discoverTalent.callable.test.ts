import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from '../functions/node_modules/firebase-admin';

const { generateMock, resolveProviderMock } = vi.hoisted(() => {
  const generate = vi.fn().mockResolvedValue({
    text: 'ok',
    raw: {
      score: 80,
      summary: 'Strong match',
      strengths: ['React'],
      potentialGaps: [],
      suggestedQuestions: ['Tell me about React.'],
    },
    model: 'fake-model',
    provider: 'fake-provider',
  });
  return {
    generateMock: generate,
    resolveProviderMock: vi.fn().mockResolvedValue({ name: 'fake-provider', generate }),
  };
});

vi.mock('../functions/src/llm/models', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../functions/src/llm/models')>()),
  resolveProvider: resolveProviderMock,
}));

import { discoverTalentImpl } from '../functions/src/handlers/discoverTalent';
import { updateWeb3ConfigImpl } from '../functions/src/handlers/web3Config';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-careercopilot';
const db = admin.firestore();

async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
}

async function seedVerifiedRail() {
  await db.collection('users').doc('emp').set({ role: 'employer', company_name: 'Acme' });
  await db.collection('users').doc('cand-staked').set({
    role: 'candidate',
    full_name: 'Staked Candidate',
    nft_staked: true,
    resume_text: 'Product engineer with React, TypeScript, Python, distributed systems, platform delivery, and strong hiring marketplace experience across several production launches.',
  });
  await db.collection('users').doc('cand-plain').set({
    role: 'candidate',
    full_name: 'Plain Candidate',
    nft_staked: false,
    resume_text: 'Product engineer with React, TypeScript, Python, distributed systems, platform delivery, and strong hiring marketplace experience across several production launches.',
  });
  await db.collection('users').doc('cand-hidden').set({
    role: 'candidate',
    full_name: 'Hidden Candidate',
    nft_staked: true,
    resume_text: 'This resume must never make a candidate discoverable by itself.',
  });
  const discoverableProfile = {
    status: 'complete',
    discoverable: true,
    intention: { targetRole: 'Product Engineer', acceptRelocation: 'Yes' },
    experience: [{
      role: 'Product Engineer',
      workContent: 'Built production hiring workflows and resilient distributed systems with cross-functional teams.',
      tools: ['React', 'TypeScript', 'Python'],
      outcome: 'Improved the reliability and usability of candidate-facing product flows.',
    }],
    skills: { technical: ['React', 'TypeScript', 'Python', 'Distributed systems'] },
  };
  await Promise.all([
    db.collection('talent_profiles').doc('cand-staked').set(discoverableProfile),
    db.collection('talent_profiles').doc('cand-plain').set(discoverableProfile),
    db.collection('talent_profiles').doc('cand-hidden').set({
      ...discoverableProfile,
      discoverable: false,
    }),
  ]);
}

beforeEach(async () => {
  await clearFirestore();
  generateMock.mockClear();
  resolveProviderMock.mockClear();
});

describe('discoverTalent verified rail', () => {
  it('does not surface nft_staked candidates when the Web3 module is disabled', async () => {
    await seedVerifiedRail();

    const result = await discoverTalentImpl('emp', {});

    expect(result.eligible).toBe(2);
    expect(result.candidates).toEqual([]);
  });

  it('surfaces staked candidates only after the Web3 module is enabled', async () => {
    await seedVerifiedRail();
    await updateWeb3ConfigImpl('super-web3', { enabled: true });

    const result = await discoverTalentImpl('emp', {});

    expect(result.eligible).toBe(2);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      id: 'cand-staked',
      nft_staked: true,
    });
  });

  it('keeps talent discovery business-only', async () => {
    await seedVerifiedRail();
    await db.collection('users').doc('cand-caller').set({ role: 'candidate' });

    await expect(discoverTalentImpl('cand-caller', {})).rejects.toThrow(/business accounts/i);
  });

  it('rejects a repeated match request before starting another model fan-out', async () => {
    await seedVerifiedRail();
    const request = {
      jobDescription: 'Hiring a React and TypeScript product engineer.',
      requestId: 'req_discover_repeat',
    };

    await expect(discoverTalentImpl('emp', request)).resolves.toMatchObject({ scanned: 2 });
    await expect(discoverTalentImpl('emp', request)).rejects.toMatchObject({ code: 'already-exists' });

    expect(resolveProviderMock).toHaveBeenCalledTimes(1);
    expect(generateMock).toHaveBeenCalledTimes(2);
  });

  it('keeps match requests without requestId compatible with deployed clients', async () => {
    await seedVerifiedRail();

    await expect(discoverTalentImpl('emp', {
      jobDescription: 'Hiring a React and TypeScript product engineer.',
    })).resolves.toMatchObject({ scanned: 2 });

    expect(resolveProviderMock).toHaveBeenCalledTimes(1);
    expect(generateMock).toHaveBeenCalledTimes(2);
  });
});
