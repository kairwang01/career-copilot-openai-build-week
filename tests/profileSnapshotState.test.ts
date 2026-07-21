import { describe, expect, it } from 'vitest';
import { applyProfileSnapshotResult } from '../lib/profileSnapshotState';
import type { UserProfile } from '../types';

const profile = { id: 'user-1', role: 'candidate', subscription_status: 'free' } as UserProfile;

describe('shared profile snapshot state', () => {
  it('distinguishes a missing profile from a failed read', () => {
    expect(applyProfileSnapshotResult(
      { ownerId: 'user-1', profile, error: null },
      'user-1',
      { data: null, error: null },
    )).toEqual({ ownerId: 'user-1', profile: null, error: null });
  });

  it('preserves the last good profile when a live read temporarily fails', () => {
    expect(applyProfileSnapshotResult(
      { ownerId: 'user-1', profile, error: null },
      'user-1',
      { data: null, error: { message: 'network unavailable' } },
    )).toEqual({ ownerId: 'user-1', profile, error: 'network unavailable' });
  });

  it('never carries one account profile into another account', () => {
    expect(applyProfileSnapshotResult(
      { ownerId: 'user-1', profile, error: null },
      'user-2',
      { data: null, error: { message: 'permission denied' } },
    )).toEqual({ ownerId: 'user-2', profile: null, error: 'permission denied' });
  });
});
