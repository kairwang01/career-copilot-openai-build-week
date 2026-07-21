import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAdditionalUserInfo,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  type User,
} from 'firebase/auth';
import {
  Timestamp,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
  type DocumentData,
} from 'firebase/firestore';
import { firebaseAuth, firestoreDb } from '../firebaseClient';
import type { UserProfile } from '../../types';
import { verificationActionUrl } from '../auth/sendVerificationEmail';
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
import { resolveHydratedValue } from '../sessionHydration';

const toError = (error: unknown): DataError => ({
  message: error instanceof Error ? error.message : 'Unexpected Firebase error.',
});

const authErrorCode = (error: unknown): string => (
  error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : ''
);

const toTimestamp = (value: unknown): Timestamp | null => {
  if (!value) return null;
  if (value instanceof Timestamp) return value;
  if (value instanceof Date) return Timestamp.fromDate(value);
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date);
  }
  return null;
};

const toIsoString = (value: unknown): string | null => {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
};

const toAppUser = (user: User): AppUser => {
  const appUser = user as AppUser;
  appUser.id = user.uid;
  appUser.user_metadata = {
    full_name: user.displayName ?? undefined,
    avatar_url: user.photoURL ?? undefined,
  };
  return appUser;
};

const toSession = (user: User | null): AppSession | null => (
  user ? { user: toAppUser(user) } : null
);

const USER_DOCUMENT_FIELDS = new Set([
  'role',
  'full_name',
  'birth_date',
  'avatar_url',
  'subscription_status',
  'resume_text',
  'resume_file_url',
  'resume_file_name',
  'resume_file_path',
  'resume_file_size',
  'resume_file_uploaded_at',
  'job_preferences',
  'company_name',
  'company_description',
  'company_logo_url',
  'company_website',
  'company_size',
  'industry',
  'founded_year',
  'english_pro_streak',
  'english_pro_last_practice',
  'wallet_address',
  'credits',
  'created_at',
  'updated_at',
  'preferred_language',
  'nft_minted',
  'nft_staked',
  'nft_earnings',
  'nft_token_id',
]);

const sanitizeProfileForFirestore = (
  profile: Partial<UserProfile> & { id?: string; created_at?: string },
): DocumentData => {
  const { id: _id, ...rest } = profile;
  const data: DocumentData = {};

  Object.entries(rest).forEach(([key, value]) => {
    if (!USER_DOCUMENT_FIELDS.has(key)) return;
    if (value === undefined) return;
    if (
      value === '' &&
      ['avatar_url', 'company_logo_url', 'company_website', 'company_size', 'industry', 'founded_year'].includes(key)
    ) {
      data[key] = null;
      return;
    }
    if (key === 'created_at' || key === 'updated_at' || key === 'english_pro_last_practice') {
      const timestamp = toTimestamp(value);
      if (timestamp) data[key] = timestamp;
      return;
    }
    data[key] = value;
  });

  return data;
};

const mapProfile = (id: string, data: DocumentData): UserProfile => ({
  id,
  updated_at: toIsoString(data.updated_at) ?? '',
  full_name: data.full_name ?? null,
  birth_date: data.birth_date ?? null,
  avatar_url: data.avatar_url ?? null,
  subscription_status: data.subscription_status ?? 'free',
  role: data.role ?? 'candidate',
  company_name: data.company_name ?? null,
  company_website: data.company_website ?? null,
  company_description: data.company_description ?? null,
  company_logo_url: data.company_logo_url ?? null,
  company_size: data.company_size ?? undefined,
  industry: data.industry ?? undefined,
  founded_year: data.founded_year ?? undefined,
  resume_text: data.resume_text ?? null,
  resume_file_url: data.resume_file_url ?? null,
  resume_file_name: data.resume_file_name ?? null,
  resume_file_path: data.resume_file_path ?? null,
  resume_file_size: data.resume_file_size ?? null,
  resume_file_uploaded_at: data.resume_file_uploaded_at ?? null,
  job_preferences: data.job_preferences ?? null,
  preferred_language: data.preferred_language ?? null,
  wallet_address: data.wallet_address ?? null,
  nft_minted: data.nft_minted ?? null,
  nft_staked: data.nft_staked ?? null,
  nft_earnings: data.nft_earnings ?? null,
  nft_token_id: data.nft_token_id ?? null,
  english_pro_streak: data.english_pro_streak ?? null,
  english_pro_last_practice: toIsoString(data.english_pro_last_practice),
  credits: data.credits ?? null,
});

export const firebaseDataClient: DataClient = {
  auth: {
    async getSession(): Promise<AppSession | null> {
      return resolveHydratedValue(
        () => firebaseAuth.authStateReady(),
        () => toSession(firebaseAuth.currentUser),
      );
    },
    onAuthStateChange(handler): Subscription {
      let isInitial = true;
      const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
        const event: AppAuthEvent = isInitial
          ? 'INITIAL_SESSION'
          : user ? 'SIGNED_IN' : 'SIGNED_OUT';
        isInitial = false;
        handler(event, toSession(user));
      });
      return { unsubscribe };
    },
    async signInWithPassword(email, password): Promise<DataResult<AppSession>> {
      try {
        const credential = await signInWithEmailAndPassword(firebaseAuth, email, password);
        return { data: toSession(credential.user), error: null };
      } catch (error) {
        return { data: null, error: toError(error) };
      }
    },
    async signUp(email, password): Promise<DataResult<AppUser>> {
      try {
        const credential = await createUserWithEmailAndPassword(firebaseAuth, email, password);
        return { data: toAppUser(credential.user), error: null };
      } catch (error) {
        return { data: null, error: toError(error) };
      }
    },
    async signInWithGoogle(): Promise<DataResult<{ isNewUser: boolean }>> {
      try {
        const provider = new GoogleAuthProvider();
        const credential = await signInWithPopup(firebaseAuth, provider);
        // isNewUser distinguishes a first-time Google sign-up (→ run onboarding)
        // from a returning sign-in (→ skip it).
        const isNewUser = getAdditionalUserInfo(credential)?.isNewUser ?? false;
        return { data: { isNewUser }, error: null };
      } catch (error) {
        return { data: null, error: toError(error) };
      }
    },
    async signOut(): Promise<DataResult<void>> {
      try {
        await signOut(firebaseAuth);
        return { data: null, error: null };
      } catch (error) {
        return { data: null, error: toError(error) };
      }
    },
    async resetPassword(email): Promise<DataResult<void>> {
      try {
        await sendPasswordResetEmail(firebaseAuth, email.trim(), {
          url: verificationActionUrl(),
          handleCodeInApp: true,
        });
        return { data: null, error: null };
      } catch (error) {
        // Do not reveal whether an account exists for the supplied address.
        if (authErrorCode(error) === 'auth/user-not-found') {
          return { data: null, error: null };
        }
        return { data: null, error: toError(error) };
      }
    },
    async updatePassword(password): Promise<DataResult<AppUser>> {
      try {
        const user = firebaseAuth.currentUser;
        if (!user) throw new Error('You must be signed in to update your password.');
        await updatePassword(user, password);
        return { data: toAppUser(user), error: null };
      } catch (error) {
        return { data: null, error: toError(error) };
      }
    },
  },

  profiles: {
    async get(userId): Promise<DataResult<UserProfile>> {
      try {
        const snap = await getDoc(doc(firestoreDb, 'users', userId));
        if (!snap.exists()) return { data: null, error: null };
        return { data: mapProfile(snap.id, snap.data()), error: null };
      } catch (error) {
        return { data: null, error: toError(error) };
      }
    },
    onChange(userId, handler): Subscription {
      const unsubscribe = onSnapshot(
        doc(firestoreDb, 'users', userId),
        (snapshot) => {
          handler(snapshot.exists()
            ? { data: mapProfile(snapshot.id, snapshot.data()), error: null }
            : { data: null, error: null });
        },
        (error) => handler({ data: null, error: toError(error) }),
      );
      return { unsubscribe };
    },
    async upsert(profile): Promise<DataResult<void>> {
      try {
        const profileWithTimestamp = {
          ...profile,
          updated_at: profile.updated_at ?? new Date().toISOString(),
        };
        await setDoc(
          doc(firestoreDb, 'users', profile.id),
          sanitizeProfileForFirestore(profileWithTimestamp),
          { merge: true },
        );
        return { data: null, error: null };
      } catch (error) {
        return { data: null, error: toError(error) };
      }
    },
    async update(userId, patch): Promise<DataResult<void>> {
      try {
        await updateDoc(
          doc(firestoreDb, 'users', userId),
          sanitizeProfileForFirestore({
            ...patch,
            updated_at: patch.updated_at ?? new Date().toISOString(),
          }),
        );
        return { data: null, error: null };
      } catch (error) {
        return { data: null, error: toError(error) };
      }
    },
  },

  apiKeys: {
    async list(): Promise<DataResult<ApiKey[]>> {
      return { data: [], error: null };
    },
    async create(): Promise<DataResult<string>> {
      return { data: null, error: { message: 'API keys not yet available.' } };
    },
    async remove(): Promise<DataResult<void>> {
      return { data: null, error: { message: 'API keys not yet available.' } };
    },
  },
};
