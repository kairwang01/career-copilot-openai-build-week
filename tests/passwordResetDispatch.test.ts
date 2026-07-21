import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SITE_ORIGIN, SITE_ROUTES } from '../config/site';

const authMocks = vi.hoisted(() => ({
  sendPasswordResetEmail: vi.fn(),
}));

const firebaseMocks = vi.hoisted(() => ({
  auth: { currentUser: null, authStateReady: vi.fn() },
}));

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class GoogleAuthProvider {},
  createUserWithEmailAndPassword: vi.fn(),
  getAdditionalUserInfo: vi.fn(),
  onAuthStateChanged: vi.fn(),
  sendEmailVerification: vi.fn(),
  sendPasswordResetEmail: authMocks.sendPasswordResetEmail,
  signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  updatePassword: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  Timestamp: class Timestamp {
    static fromDate(value: Date) { return value; }
  },
  doc: vi.fn(),
  getDoc: vi.fn(),
  onSnapshot: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
}));

vi.mock('../lib/firebaseClient', () => ({
  firebaseAuth: firebaseMocks.auth,
  firestoreDb: {},
}));

import { firebaseDataClient } from '../lib/data/firebaseDataClient';

describe('shared password-reset dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.sendPasswordResetEmail.mockResolvedValue(undefined);
  });

  it('trims the address and uses the canonical in-app action handler', async () => {
    await expect(
      firebaseDataClient.auth.resetPassword('  Person@example.test  '),
    ).resolves.toEqual({ data: null, error: null });

    expect(authMocks.sendPasswordResetEmail).toHaveBeenCalledWith(
      firebaseMocks.auth,
      'Person@example.test',
      {
        url: `${SITE_ORIGIN}${SITE_ROUTES.authAction}`,
        handleCodeInApp: true,
      },
    );
  });

  it('normalizes only user-not-found to a non-enumerating success', async () => {
    authMocks.sendPasswordResetEmail.mockRejectedValueOnce(
      Object.assign(new Error('No matching account.'), { code: 'auth/user-not-found' }),
    );

    await expect(firebaseDataClient.auth.resetPassword('missing@example.test'))
      .resolves.toEqual({ data: null, error: null });
  });

  it.each([
    'auth/invalid-email',
    'auth/network-request-failed',
    'auth/too-many-requests',
    'auth/unauthorized-continue-uri',
  ])('preserves actionable configuration or delivery error %s', async (code) => {
    authMocks.sendPasswordResetEmail.mockRejectedValueOnce(
      Object.assign(new Error(code), { code }),
    );

    const result = await firebaseDataClient.auth.resetPassword('person@example.test');
    expect(result.error?.message).toContain(code);
    expect(authMocks.sendPasswordResetEmail).toHaveBeenCalledOnce();
  });
});
