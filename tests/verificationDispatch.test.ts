import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  sendEmailVerification: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  sendEmailVerification: authMocks.sendEmailVerification,
}));

import {
  markVerificationEmailDispatched,
  sendAccountVerificationEmail,
  verificationEmailCooldownRemainingMs,
  wasVerificationEmailDispatchedRecently,
} from '../lib/auth/sendVerificationEmail';

const storedValues = new Map<string, string>();

class SharedLockManager {
  private readonly tails = new Map<string, Promise<void>>();

  request<T>(name: string, _options: { mode: 'exclusive' }, callback: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(name) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.tails.set(name, tail);

    return previous
      .then(callback)
      .finally(() => {
        release();
        if (this.tails.get(name) === tail) this.tails.delete(name);
      });
  }
}

function user(uid: string) {
  return { uid, emailVerified: false } as never;
}

describe('verification email request coordination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storedValues.clear();
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storedValues.get(key) ?? null,
      setItem: (key: string, value: string) => { storedValues.set(key, value); },
      removeItem: (key: string) => { storedValues.delete(key); },
    });
    authMocks.sendEmailVerification.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the in-app handler settings declared by the installed Firebase SDK', async () => {
    await sendAccountVerificationEmail(user('settings-user'));
    expect(authMocks.sendEmailVerification).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'settings-user' }),
      expect.objectContaining({
        url: expect.stringMatching(/\/auth\/action$/),
        handleCodeInApp: true,
      }),
    );
  });

  it('coalesces concurrent signup and gate requests for the same account', async () => {
    let resolveRequest!: () => void;
    authMocks.sendEmailVerification.mockReturnValueOnce(
      new Promise<void>((resolve) => { resolveRequest = resolve; }),
    );

    const first = sendAccountVerificationEmail(user('concurrent-user'));
    const second = sendAccountVerificationEmail(user('concurrent-user'));
    expect(second).toBe(first);
    await vi.waitFor(() => expect(authMocks.sendEmailVerification).toHaveBeenCalledOnce());

    resolveRequest();
    await expect(first).resolves.toMatchObject({ status: 'requested' });
    await expect(second).resolves.toMatchObject({ status: 'requested' });
  });

  it('serializes the first request across independent browser realms and rechecks accepted state inside the lock', async () => {
    const locks = new SharedLockManager();
    vi.stubGlobal('navigator', { locks });
    let resolveRequest!: () => void;
    authMocks.sendEmailVerification.mockReturnValueOnce(
      new Promise<void>((resolve) => { resolveRequest = resolve; }),
    );

    vi.resetModules();
    const firstRealm = await import('../lib/auth/sendVerificationEmail');
    vi.resetModules();
    const secondRealm = await import('../lib/auth/sendVerificationEmail');

    const first = firstRealm.sendAccountVerificationEmail(user('cross-realm-user'));
    const second = secondRealm.sendAccountVerificationEmail(user('cross-realm-user'));
    await vi.waitFor(() => expect(authMocks.sendEmailVerification).toHaveBeenCalledOnce());

    resolveRequest();
    await expect(first).resolves.toMatchObject({ status: 'requested' });
    await expect(second).resolves.toMatchObject({ status: 'recent' });
    expect(authMocks.sendEmailVerification).toHaveBeenCalledOnce();
  });

  it('uses separate Web Locks and pending state for different Firebase UIDs', async () => {
    const locks = new SharedLockManager();
    vi.stubGlobal('navigator', { locks });
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    authMocks.sendEmailVerification
      .mockReturnValueOnce(new Promise<void>((resolve) => { resolveFirst = resolve; }))
      .mockReturnValueOnce(new Promise<void>((resolve) => { resolveSecond = resolve; }));

    const first = sendAccountVerificationEmail(user('uid-one'));
    const second = sendAccountVerificationEmail(user('uid-two'));
    await vi.waitFor(() => expect(authMocks.sendEmailVerification).toHaveBeenCalledTimes(2));

    resolveFirst();
    resolveSecond();
    await expect(first).resolves.toMatchObject({ status: 'requested' });
    await expect(second).resolves.toMatchObject({ status: 'requested' });
  });

  it('uses an expiring storage lease when Web Locks are unavailable', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    storedValues.set(
      `cc_verify_email_pending_lease:${encodeURIComponent('crashed-realm-user')}`,
      JSON.stringify({ ownerId: 'crashed-realm', expiresAt: 10_100 }),
    );

    const pending = sendAccountVerificationEmail(user('crashed-realm-user'));
    expect(authMocks.sendEmailVerification).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(150);
    await expect(pending).resolves.toMatchObject({ status: 'requested' });
    expect(authMocks.sendEmailVerification).toHaveBeenCalledOnce();
  });

  it('releases a fallback lease after Firebase rejects so a retry can proceed', async () => {
    authMocks.sendEmailVerification.mockRejectedValueOnce(
      Object.assign(new Error('auth/network-request-failed'), { code: 'auth/network-request-failed' }),
    );

    await expect(sendAccountVerificationEmail(user('lease-failure-user'))).rejects.toMatchObject({
      code: 'auth/network-request-failed',
    });
    expect([...storedValues.keys()].filter((key) => key.includes('pending_lease'))).toEqual([]);

    await expect(sendAccountVerificationEmail(user('lease-failure-user'))).resolves.toMatchObject({
      status: 'requested',
    });
    expect(authMocks.sendEmailVerification).toHaveBeenCalledTimes(2);
  });

  it('persists a user-scoped cooldown only after Firebase accepts the request', async () => {
    await sendAccountVerificationEmail(user('first-user'));
    expect(verificationEmailCooldownRemainingMs('first-user')).toBeGreaterThan(0);
    expect(wasVerificationEmailDispatchedRecently('first-user')).toBe(true);
    expect(verificationEmailCooldownRemainingMs('second-user')).toBe(0);

    await expect(sendAccountVerificationEmail(user('first-user'))).resolves.toMatchObject({
      status: 'recent',
    });
    expect(authMocks.sendEmailVerification).toHaveBeenCalledOnce();
  });

  it('does not start a cooldown when Firebase rejects the request', async () => {
    authMocks.sendEmailVerification.mockRejectedValueOnce(
      Object.assign(new Error('auth/network-request-failed'), { code: 'auth/network-request-failed' }),
    );

    await expect(sendAccountVerificationEmail(user('failed-user'))).rejects.toMatchObject({
      code: 'auth/network-request-failed',
    });
    expect(verificationEmailCooldownRemainingMs('failed-user')).toBe(0);
  });

  it('does not silently retry without ActionCodeSettings after a continue URI error', async () => {
    authMocks.sendEmailVerification.mockRejectedValueOnce(
      Object.assign(new Error('auth/unauthorized-continue-uri'), { code: 'auth/unauthorized-continue-uri' }),
    );

    await expect(sendAccountVerificationEmail(user('misconfigured-user'))).rejects.toMatchObject({
      code: 'auth/unauthorized-continue-uri',
    });
    expect(authMocks.sendEmailVerification).toHaveBeenCalledOnce();
  });

  it('caps a future or tampered timestamp to one cooldown window', () => {
    markVerificationEmailDispatched('clock-user', 200_000);
    expect(verificationEmailCooldownRemainingMs('clock-user', 60_000, 100_000)).toBe(60_000);
  });
});
