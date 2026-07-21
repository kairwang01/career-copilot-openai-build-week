import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  applyActionCode: vi.fn(),
  checkActionCode: vi.fn(),
  confirmPasswordReset: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  ActionCodeOperation: {
    VERIFY_EMAIL: 'VERIFY_EMAIL',
    PASSWORD_RESET: 'PASSWORD_RESET',
  },
  applyActionCode: authMocks.applyActionCode,
  checkActionCode: authMocks.checkActionCode,
  confirmPasswordReset: authMocks.confirmPasswordReset,
}));

import {
  completeAuthActionFromSearch,
  completeAuthActionOnce,
  completePasswordReset,
} from '../lib/auth/completeAuthAction';

function authWithUser(email: string | null = null) {
  return {
    currentUser: email
      ? { email, reload: vi.fn().mockResolvedValue(undefined) }
      : null,
  } as never;
}

describe('Firebase email action completion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.applyActionCode.mockResolvedValue(undefined);
    authMocks.confirmPasswordReset.mockResolvedValue(undefined);
  });

  it('rejects missing and unsupported modes before checking a code', async () => {
    await expect(completeAuthActionFromSearch(authWithUser(), 'oobCode=secret')).resolves.toEqual({
      status: 'error',
      reason: 'missing_params',
    });
    await expect(
      completeAuthActionFromSearch(authWithUser(), 'mode=recoverEmail&oobCode=secret'),
    ).resolves.toEqual({ status: 'error', reason: 'unsupported_mode' });
    expect(authMocks.checkActionCode).not.toHaveBeenCalled();
  });

  it('binds the public mode to the operation returned by Firebase', async () => {
    authMocks.checkActionCode.mockResolvedValue({
      operation: 'PASSWORD_RESET',
      data: { email: 'person@example.test' },
    });

    await expect(
      completeAuthActionFromSearch(authWithUser(), 'mode=verifyEmail&oobCode=reset-code'),
    ).resolves.toEqual({ status: 'error', reason: 'expired_or_invalid' });
    expect(authMocks.applyActionCode).not.toHaveBeenCalled();
  });

  it('ignores an untrusted continueUrl and applies only the checked verification code', async () => {
    const auth = authWithUser('Person@Example.test') as unknown as {
      currentUser: { reload: ReturnType<typeof vi.fn> };
    };
    authMocks.checkActionCode.mockResolvedValue({
      operation: 'VERIFY_EMAIL',
      data: { email: 'person@example.test' },
    });

    await expect(
      completeAuthActionFromSearch(
        auth as never,
        'mode=verifyEmail&oobCode=verify-code&continueUrl=https%3A%2F%2Fevil.example%2Fsteal',
      ),
    ).resolves.toEqual({ status: 'success', mode: 'verifyEmail' });
    expect(authMocks.checkActionCode).toHaveBeenCalledWith(auth, 'verify-code');
    expect(authMocks.applyActionCode).toHaveBeenCalledWith(auth, 'verify-code');
    expect(auth.currentUser.reload).toHaveBeenCalledOnce();
  });

  it('does not reload an unrelated signed-in account after verification', async () => {
    const auth = authWithUser('other@example.test') as unknown as {
      currentUser: { reload: ReturnType<typeof vi.fn> };
    };
    authMocks.checkActionCode.mockResolvedValue({
      operation: 'VERIFY_EMAIL',
      data: { email: 'target@example.test' },
    });

    await completeAuthActionFromSearch(auth as never, 'mode=verifyEmail&oobCode=other-code');
    expect(auth.currentUser.reload).not.toHaveBeenCalled();
  });

  it('returns a validated reset code without consuming it', async () => {
    authMocks.checkActionCode.mockResolvedValue({
      operation: 'PASSWORD_RESET',
      data: { email: 'person@example.test' },
    });

    await expect(
      completeAuthActionFromSearch(authWithUser(), 'mode=resetPassword&oobCode=reset-ready'),
    ).resolves.toEqual({ status: 'ready', mode: 'resetPassword', oobCode: 'reset-ready' });
    expect(authMocks.applyActionCode).not.toHaveBeenCalled();
    expect(authMocks.confirmPasswordReset).not.toHaveBeenCalled();
  });

  it('coalesces StrictMode verification effects into one code application', async () => {
    authMocks.checkActionCode.mockResolvedValue({
      operation: 'VERIFY_EMAIL',
      data: { email: 'person@example.test' },
    });
    const auth = authWithUser('person@example.test');
    const search = 'mode=verifyEmail&oobCode=strict-mode-code';

    const [first, second] = await Promise.all([
      completeAuthActionOnce(auth, search),
      completeAuthActionOnce(auth, search),
    ]);
    expect(first).toEqual({ status: 'success', mode: 'verifyEmail' });
    expect(second).toEqual(first);
    expect(authMocks.checkActionCode).toHaveBeenCalledOnce();
    expect(authMocks.applyActionCode).toHaveBeenCalledOnce();
  });

  it('evicts a transient failure so an explicit same-tab retry can run', async () => {
    authMocks.checkActionCode
      .mockRejectedValueOnce(
        Object.assign(new Error('auth/network-request-failed'), { code: 'auth/network-request-failed' }),
      )
      .mockResolvedValueOnce({
        operation: 'VERIFY_EMAIL',
        data: { email: 'person@example.test' },
      });
    const auth = authWithUser('person@example.test');
    const search = 'mode=verifyEmail&oobCode=transient-retry-code';

    await expect(completeAuthActionOnce(auth, search)).resolves.toEqual({
      status: 'error',
      reason: 'apply_failed',
    });
    await expect(completeAuthActionOnce(auth, search)).resolves.toEqual({
      status: 'success',
      mode: 'verifyEmail',
    });
    expect(authMocks.checkActionCode).toHaveBeenCalledTimes(2);
    expect(authMocks.applyActionCode).toHaveBeenCalledOnce();
  });

  it.each([
    ['auth/expired-action-code', 'expired_or_invalid'],
    ['auth/weak-password', 'weak_password'],
    ['auth/password-does-not-meet-requirements', 'weak_password'],
    ['auth/too-many-requests', 'too_many_requests'],
    ['auth/network-request-failed', 'network'],
    ['auth/internal-error', 'apply_failed'],
  ] as const)('maps password reset error %s without exposing account data', async (code, reason) => {
    authMocks.confirmPasswordReset.mockRejectedValueOnce(Object.assign(new Error(code), { code }));
    await expect(completePasswordReset(authWithUser(), 'reset-code', 'new-password')).resolves.toEqual({
      status: 'error',
      reason,
    });
  });

  it('consumes a valid reset code with the new password', async () => {
    await expect(
      completePasswordReset(authWithUser(), 'reset-code-success', 'a-new-password'),
    ).resolves.toEqual({ status: 'success' });
    expect(authMocks.confirmPasswordReset).toHaveBeenCalledWith(
      expect.anything(),
      'reset-code-success',
      'a-new-password',
    );
  });
});
