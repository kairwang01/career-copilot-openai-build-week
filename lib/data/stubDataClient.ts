import type {
  AppAuthEvent,
  AppSession,
  AppUser,
  ApiKey,
  DataClient,
  DataError,
  DataResult,
  Subscription,
} from './DataClient';
import type { UserProfile } from '../../types';

const CONFIG_ERROR: DataError = {
  message:
    'Firebase is not configured. Copy .env.example to .env.local and fill in your Firebase Web App config.',
};

const unconfigured = <T>(): Promise<DataResult<T>> =>
  Promise.resolve({ data: null, error: CONFIG_ERROR });

/**
 * No-op data layer used when VITE_FIREBASE_* env vars are missing so the public
 * marketing shell can still render (logged-out) without crashing module load.
 */
export const stubDataClient: DataClient = {
  auth: {
    getSession: async (): Promise<AppSession | null> => null,
    onAuthStateChange(handler: (event: AppAuthEvent, session: AppSession | null) => void): Subscription {
      queueMicrotask(() => handler('INITIAL_SESSION', null));
      return { unsubscribe: () => {} };
    },
    signInWithPassword: () => unconfigured<AppSession>(),
    signUp: () => unconfigured<AppUser>(),
    signInWithGoogle: () => unconfigured<{ isNewUser: boolean }>(),
    signOut: () => unconfigured<void>(),
    resetPassword: () => unconfigured<void>(),
    updatePassword: () => unconfigured<AppUser>(),
  },
  profiles: {
    get: () => unconfigured<UserProfile>(),
    onChange(_userId, handler): Subscription {
      queueMicrotask(() => handler({ data: null, error: CONFIG_ERROR }));
      return { unsubscribe: () => {} };
    },
    upsert: () => unconfigured<void>(),
    update: () => unconfigured<void>(),
  },
  apiKeys: {
    list: async (): Promise<DataResult<ApiKey[]>> => ({ data: [], error: null }),
    create: () => unconfigured<string>(),
    remove: () => unconfigured<void>(),
  },
};
