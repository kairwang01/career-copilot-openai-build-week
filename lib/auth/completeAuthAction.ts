import {
  ActionCodeOperation,
  applyActionCode,
  checkActionCode,
  confirmPasswordReset,
  type Auth,
} from 'firebase/auth';

export type AuthActionMode = 'verifyEmail' | 'resetPassword' | 'recoverEmail' | string;

export type AuthActionOutcome =
  | { status: 'success'; mode: 'verifyEmail' }
  | { status: 'ready'; mode: 'resetPassword'; oobCode: string }
  | { status: 'error'; reason: 'missing_params' | 'expired_or_invalid' | 'unsupported_mode' | 'apply_failed' };

export type PasswordResetOutcome =
  | { status: 'success' }
  | { status: 'error'; reason: 'expired_or_invalid' | 'weak_password' | 'too_many_requests' | 'network' | 'apply_failed' };

function getAuthErrorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    return String((err as { code: string }).code);
  }
  if (err instanceof Error) {
    const match = err.message.match(/auth\/[a-z0-9-]+/i);
    return match?.[0] ?? '';
  }
  return '';
}

function isExpiredOrInvalidCode(err: unknown): boolean {
  const code = getAuthErrorCode(err);
  return (
    code === 'auth/invalid-action-code' ||
    code === 'auth/expired-action-code' ||
    code === 'auth/user-disabled' ||
    code === 'auth/user-not-found'
  );
}

function normalizeEmail(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

/**
 * Memoized wrapper - one concurrent apply per link in this tab.
 *
 * applyActionCode consumes the oobCode server-side, so it must run exactly
 * once per link even when the caller's effect fires twice (React StrictMode
 * dev double-invoke) or the user revisits the same URL in this tab: the
 * second call would get auth/invalid-action-code and the page would show
 * "link expired" for a verification that actually succeeded. Transient
 * failures are evicted after both StrictMode callers receive the same result,
 * so an explicit Retry can make a new request.
 */
const inflightBySearch = new Map<string, Promise<AuthActionOutcome>>();
const MAX_CACHED_ACTIONS = 32;

function actionCacheKey(search: string): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return `${params.get('mode') ?? ''}:${params.get('oobCode') ?? ''}`;
}

export function completeAuthActionOnce(auth: Auth, search: string): Promise<AuthActionOutcome> {
  const key = actionCacheKey(search);
  let pending = inflightBySearch.get(key);
  if (!pending) {
    if (inflightBySearch.size >= MAX_CACHED_ACTIONS) {
      const oldestKey = inflightBySearch.keys().next().value;
      if (oldestKey !== undefined) inflightBySearch.delete(oldestKey);
    }
    pending = completeAuthActionFromSearch(auth, search);
    inflightBySearch.set(key, pending);
    void pending.then(
      (outcome) => {
        if (
          outcome.status === 'error' &&
          outcome.reason === 'apply_failed' &&
          inflightBySearch.get(key) === pending
        ) {
          inflightBySearch.delete(key);
        }
      },
      () => {
        if (inflightBySearch.get(key) === pending) inflightBySearch.delete(key);
      },
    );
  }
  return pending;
}

/** Complete a Firebase email action from the query string on /auth/action. */
export async function completeAuthActionFromSearch(
  auth: Auth,
  search: string,
): Promise<AuthActionOutcome> {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const mode = params.get('mode');
  const oobCode = params.get('oobCode');
  if (!mode || !oobCode) {
    return { status: 'error', reason: 'missing_params' };
  }

  // Reject unknown modes before asking Firebase about the code. This avoids
  // turning the public action page into a validity oracle for unrelated codes.
  if (mode !== 'verifyEmail' && mode !== 'resetPassword') {
    return { status: 'error', reason: 'unsupported_mode' };
  }

  let actionInfo: Awaited<ReturnType<typeof checkActionCode>>;
  try {
    actionInfo = await checkActionCode(auth, oobCode);
  } catch (err) {
    if (isExpiredOrInvalidCode(err)) {
      return { status: 'error', reason: 'expired_or_invalid' };
    }
    return { status: 'error', reason: 'apply_failed' };
  }

  const expectedOperation = mode === 'verifyEmail'
    ? ActionCodeOperation.VERIFY_EMAIL
    : ActionCodeOperation.PASSWORD_RESET;
  if (actionInfo.operation !== expectedOperation) {
    // Do not reveal that a valid code was paired with the wrong public mode.
    return { status: 'error', reason: 'expired_or_invalid' };
  }

  if (mode === 'verifyEmail') {
    try {
      await applyActionCode(auth, oobCode);
      const actionEmail = normalizeEmail(actionInfo.data.email);
      const currentEmail = normalizeEmail(auth.currentUser?.email);
      if (auth.currentUser && actionEmail && currentEmail === actionEmail) {
        await auth.currentUser.reload();
      }
      return { status: 'success', mode: 'verifyEmail' };
    } catch (err) {
      if (isExpiredOrInvalidCode(err)) {
        return { status: 'error', reason: 'expired_or_invalid' };
      }
      return { status: 'error', reason: 'apply_failed' };
    }
  }

  if (mode === 'resetPassword') {
    return { status: 'ready', mode: 'resetPassword', oobCode };
  }

  return { status: 'error', reason: 'unsupported_mode' };
}

/** Consume a previously validated password-reset code without exposing account data. */
export async function completePasswordReset(
  auth: Auth,
  oobCode: string,
  newPassword: string,
): Promise<PasswordResetOutcome> {
  try {
    await confirmPasswordReset(auth, oobCode, newPassword);
    return { status: 'success' };
  } catch (err) {
    const code = getAuthErrorCode(err);
    if (isExpiredOrInvalidCode(err)) {
      return { status: 'error', reason: 'expired_or_invalid' };
    }
    if (code === 'auth/weak-password' || code === 'auth/password-does-not-meet-requirements') {
      return { status: 'error', reason: 'weak_password' };
    }
    if (code === 'auth/too-many-requests') {
      return { status: 'error', reason: 'too_many_requests' };
    }
    if (code === 'auth/network-request-failed') {
      return { status: 'error', reason: 'network' };
    }
    return { status: 'error', reason: 'apply_failed' };
  }
}
