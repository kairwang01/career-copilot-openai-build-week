import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => ({
  doc: vi.fn(() => ({ path: 'talent_profiles/candidate-1' })),
  setDoc: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: firestoreMocks.doc,
  getDoc: vi.fn(),
  setDoc: firestoreMocks.setDoc,
}));

vi.mock('../lib/firebaseClient', () => ({
  firestoreDb: { name: 'test-db' },
}));

import { withdrawTalentDiscoveryConsent } from '../services/talentProfile';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('talent discovery consent withdrawal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T12:00:00.000Z'));
    firestoreMocks.setDoc.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('persists only an immediate field-level opt-out with merge semantics', async () => {
    await withdrawTalentDiscoveryConsent('candidate-1');

    expect(firestoreMocks.doc).toHaveBeenCalledWith(
      { name: 'test-db' },
      'talent_profiles',
      'candidate-1',
    );
    expect(firestoreMocks.setDoc).toHaveBeenCalledWith(
      { path: 'talent_profiles/candidate-1' },
      {
        discoverable: false,
        updated_at: '2026-07-13T12:00:00.000Z',
      },
      { merge: true },
    );
  });

  it('keeps opt-out independent from full-profile validation in the UI', () => {
    const source = readFileSync(`${ROOT}/components/TalentProfileForm.tsx`, 'utf8');
    const start = source.indexOf('const updateDiscoverability = async');
    const end = source.indexOf('const toggle =', start);
    const withdrawalFlow = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(withdrawalFlow).toContain('await withdrawTalentDiscoveryConsent(uid)');
    expect(withdrawalFlow).not.toContain('hasBlockingValidation');
    expect(source).toContain('void updateDiscoverability(event.target.checked)');
    expect(source).toContain('(!ready && profile.discoverable !== true)');
  });
});
