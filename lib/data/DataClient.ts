import type { User as FirebaseUser } from 'firebase/auth';
import type { UserProfile } from '../../types';

export type AppAuthEvent = 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED';

export type AppUser = FirebaseUser & {
  id: string;
  user_metadata: {
    full_name?: string;
    avatar_url?: string;
  };
};

export interface AppSession {
  user: AppUser;
}

export interface DataError {
  message: string;
}

export interface DataResult<T> {
  data: T | null;
  error: DataError | null;
}

export interface Subscription {
  unsubscribe: () => void;
}

export interface ApiKey {
  id: number;
  key_name: string;
  created_at: string;
  last_used_at: string | null;
  request_count: number;
}

export interface AuthApi {
  getSession(): Promise<AppSession | null>;
  onAuthStateChange(handler: (event: AppAuthEvent, session: AppSession | null) => void): Subscription;
  signInWithPassword(email: string, password: string): Promise<DataResult<AppSession>>;
  signUp(email: string, password: string): Promise<DataResult<AppUser>>;
  signInWithGoogle(): Promise<DataResult<{ isNewUser: boolean }>>;
  // Signs out this browser session. (A 'global' sign-out-everywhere scope was
  // declared here once but never implemented — Firebase client auth cannot
  // revoke other sessions; that needs a server-side callable. Removed rather
  // than left as a silent no-op.)
  signOut(): Promise<DataResult<void>>;
  resetPassword(email: string): Promise<DataResult<void>>;
  updatePassword(password: string): Promise<DataResult<AppUser>>;
}

export interface ProfilesApi {
  get(userId: string): Promise<DataResult<UserProfile>>;
  onChange(userId: string, handler: (result: DataResult<UserProfile>) => void): Subscription;
  upsert(profile: Partial<UserProfile> & { id: string; created_at?: string }): Promise<DataResult<void>>;
  update(userId: string, patch: Partial<UserProfile>): Promise<DataResult<void>>;
}

export interface ApiKeysApi {
  list(userId: string): Promise<DataResult<ApiKey[]>>;
  create(userId: string, keyName: string): Promise<DataResult<string>>;
  remove(keyId: number, userId: string): Promise<DataResult<void>>;
}

export interface DataClient {
  auth: AuthApi;
  profiles: ProfilesApi;
  apiKeys: ApiKeysApi;
}
