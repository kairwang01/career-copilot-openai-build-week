import { beforeEach, describe, expect, it, vi } from 'vitest';

const { callableInvoke, httpsCallableMock } = vi.hoisted(() => {
  const invoke = vi.fn();
  return {
    callableInvoke: invoke,
    httpsCallableMock: vi.fn(() => invoke),
  };
});

vi.mock('firebase/functions', () => ({ httpsCallable: httpsCallableMock }));
vi.mock('../lib/firebaseClient', () => ({ firebaseFunctions: {} }));

import { discoverTalent } from '../services/aiClient';

const emptyResult = { data: { candidates: [], scanned: 0, eligible: 0, failures: 0 } };

beforeEach(() => {
  callableInvoke.mockReset().mockResolvedValue(emptyResult);
  httpsCallableMock.mockClear();
});

describe('discoverTalent client request wiring', () => {
  it('sends a canonical requestId with AI match requests', async () => {
    await discoverTalent('Hiring a React and TypeScript engineer.');

    expect(httpsCallableMock).toHaveBeenCalledWith({}, 'discoverTalent');
    expect(callableInvoke).toHaveBeenCalledWith(expect.objectContaining({
      jobDescription: 'Hiring a React and TypeScript engineer.',
      requestId: expect.stringMatching(/^discover_talent_[A-Za-z0-9._:-]{8,}$/),
    }));
  });

  it('shares one callable and requestId for concurrent identical searches', async () => {
    let resolveCall!: (value: typeof emptyResult) => void;
    callableInvoke.mockImplementation(() => new Promise((resolve) => { resolveCall = resolve; }));

    const first = discoverTalent('Same role description');
    const replay = discoverTalent('Same role description');

    expect(callableInvoke).toHaveBeenCalledTimes(1);
    resolveCall(emptyResult);
    await expect(Promise.all([first, replay])).resolves.toHaveLength(2);
  });

  it('keeps the non-AI verified rail payload backward compatible', async () => {
    await discoverTalent();

    expect(callableInvoke).toHaveBeenCalledWith({});
  });
});
