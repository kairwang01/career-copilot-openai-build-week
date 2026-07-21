import { useCallback, useEffect, useState } from 'react';
import {
  listRecentApplications,
  type RecentApplication,
} from '../services/recentApplicationsClient';

export type { RecentApplication } from '../services/recentApplicationsClient';

interface RecentApplicationState {
  ownerId: string | null;
  applications: RecentApplication[];
  loading: boolean;
  error: Error | null;
}

export function useRecentApplications(
  session: { user?: { id?: string } } | null,
): {
  applications: RecentApplication[];
  loading: boolean;
  error: Error | null;
  retry: () => void;
} {
  const uid = session?.user?.id ?? null;
  const [retryVersion, setRetryVersion] = useState(0);
  const [state, setState] = useState<RecentApplicationState>({
    ownerId: null,
    applications: [],
    loading: false,
    error: null,
  });

  const retry = useCallback(() => {
    setRetryVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (!uid) {
      setState({ ownerId: null, applications: [], loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState((previous) => ({
      ownerId: uid,
      applications: previous.ownerId === uid ? previous.applications : [],
      loading: true,
      error: null,
    }));

    void listRecentApplications()
      .then((applications) => {
        if (!cancelled) {
          setState({ ownerId: uid, applications, loading: false, error: null });
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        const error = cause instanceof Error ? cause : new Error('Unable to load recent applications.');
        setState((previous) => ({
          ownerId: uid,
          applications: previous.ownerId === uid ? previous.applications : [],
          loading: false,
          error,
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [retryVersion, uid]);

  const ownsVisibleState = Boolean(uid && state.ownerId === uid);
  return {
    applications: ownsVisibleState ? state.applications : [],
    loading: Boolean(uid && (!ownsVisibleState || state.loading)),
    error: ownsVisibleState ? state.error : null,
    retry,
  };
}
