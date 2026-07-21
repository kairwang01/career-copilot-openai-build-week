import type { DataResult } from './data/DataClient';
import type { UserProfile } from '../types';

export interface ProfileSnapshotState {
  ownerId: string | null;
  profile: UserProfile | null;
  error: string | null;
}

export const applyProfileSnapshotResult = (
  previous: ProfileSnapshotState,
  ownerId: string,
  result: DataResult<UserProfile>,
): ProfileSnapshotState => {
  if (result.error) {
    return {
      ownerId,
      profile: previous.ownerId === ownerId ? previous.profile : null,
      error: result.error.message,
    };
  }
  return { ownerId, profile: result.data, error: null };
};
