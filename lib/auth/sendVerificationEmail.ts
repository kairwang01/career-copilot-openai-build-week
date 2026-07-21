import { sendEmailVerification, type User } from 'firebase/auth';
import { SITE_ORIGIN, SITE_ROUTES } from '../../config/site';

const DISPATCHED_KEY_PREFIX = 'cc_verify_email_dispatched_at';
const PENDING_LEASE_KEY_PREFIX = 'cc_verify_email_pending_lease';
const VERIFICATION_LOCK_PREFIX = 'cc:verification-email';
const FALLBACK_LEASE_CONFIRM_MS = 25;
const FALLBACK_LEASE_POLL_MS = 50;
export const VERIFICATION_RESEND_COOLDOWN_MS = 60_000;
export const VERIFICATION_AUTO_SEND_FRESHNESS_MS = 180_000;
export const VERIFICATION_PENDING_LEASE_MS = 15_000;

export type VerificationEmailRequestResult =
  | { status: 'requested'; acceptedAt: number }
  | { status: 'recent'; retryAfterMs: number };

const inFlightByUserId = new Map<string, Promise<VerificationEmailRequestResult>>();
const coordinatorOwnerId = createCoordinatorOwnerId();

function dispatchedKey(userId: string): string {
  return `${DISPATCHED_KEY_PREFIX}:${encodeURIComponent(userId)}`;
}

function pendingLeaseKey(userId: string): string {
  return `${PENDING_LEASE_KEY_PREFIX}:${encodeURIComponent(userId)}`;
}

function verificationLockName(userId: string): string {
  return `${VERIFICATION_LOCK_PREFIX}:${encodeURIComponent(userId)}`;
}

function createCoordinatorOwnerId(): string {
  try {
    const randomId = globalThis.crypto?.randomUUID?.();
    if (randomId) return randomId;
  } catch {
    // A random owner is only used to distinguish cooperative browser realms.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function readStorageValue(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorageValue(key: string, value: string): boolean {
  try {
    globalThis.localStorage?.setItem(key, value);
    return Boolean(globalThis.localStorage);
  } catch {
    return false;
  }
}

function removeStorageValue(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // Storage can be blocked by the browser; the lease has a finite expiry.
  }
}

function readDispatchedAt(userId: string): number {
  const value = Number(readStorageValue(dispatchedKey(userId)) ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

interface VerificationPendingLease {
  ownerId: string;
  expiresAt: number;
}

function readPendingLease(userId: string): VerificationPendingLease | null {
  const rawValue = readStorageValue(pendingLeaseKey(userId));
  if (!rawValue) return null;
  try {
    const value = JSON.parse(rawValue) as Partial<VerificationPendingLease>;
    if (
      typeof value.ownerId !== 'string' ||
      value.ownerId.length === 0 ||
      !Number.isFinite(value.expiresAt) ||
      Number(value.expiresAt) <= 0
    ) {
      return null;
    }
    return { ownerId: value.ownerId, expiresAt: Number(value.expiresAt) };
  } catch {
    return null;
  }
}

type PendingLeaseClaim = 'owned' | 'contended' | 'unavailable';

function writePendingLease(userId: string, now = Date.now()): PendingLeaseClaim {
  const lease = { ownerId: coordinatorOwnerId, expiresAt: now + VERIFICATION_PENDING_LEASE_MS };
  if (!writeStorageValue(pendingLeaseKey(userId), JSON.stringify(lease))) return 'unavailable';
  const storedLease = readPendingLease(userId);
  if (storedLease?.ownerId === lease.ownerId && storedLease.expiresAt === lease.expiresAt) return 'owned';
  return storedLease ? 'contended' : 'unavailable';
}

function releasePendingLease(userId: string): void {
  if (readPendingLease(userId)?.ownerId === coordinatorOwnerId) {
    removeStorageValue(pendingLeaseKey(userId));
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function getLockManager(): LockManager | null {
  try {
    const locks = globalThis.navigator?.locks;
    return locks && typeof locks.request === 'function' ? locks : null;
  } catch {
    return null;
  }
}

/** Landing route used as the Firebase continue URL for all email actions. */
export function verificationActionUrl(): string {
  const canonicalUrl = new URL(SITE_ROUTES.authAction, SITE_ORIGIN);
  const runtimeOrigin = typeof window !== 'undefined' ? window.location.origin : SITE_ORIGIN;
  try {
    const url = new URL(SITE_ROUTES.authAction, runtimeOrigin);
    const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (url.origin === canonicalUrl.origin || (url.protocol === 'http:' && isLoopback)) {
      return url.toString();
    }
    return canonicalUrl.toString();
  } catch {
    return canonicalUrl.toString();
  }
}

export function markVerificationEmailDispatched(userId: string, acceptedAt = Date.now()): void {
  writeStorageValue(dispatchedKey(userId), String(acceptedAt));
}

export function verificationEmailCooldownRemainingMs(
  userId: string,
  withinMs = VERIFICATION_RESEND_COOLDOWN_MS,
  now = Date.now(),
): number {
  const dispatchedAt = readDispatchedAt(userId);
  if (!dispatchedAt) return 0;
  const elapsed = Math.max(0, now - dispatchedAt);
  return Math.max(0, withinMs - elapsed);
}

export function wasVerificationEmailDispatchedRecently(
  userId: string,
  withinMs = VERIFICATION_AUTO_SEND_FRESHNESS_MS,
  now = Date.now(),
): boolean {
  return verificationEmailCooldownRemainingMs(userId, withinMs, now) > 0;
}

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

function recentResult(userId: string): VerificationEmailRequestResult | null {
  const retryAfterMs = verificationEmailCooldownRemainingMs(userId);
  return retryAfterMs > 0 ? { status: 'recent', retryAfterMs } : null;
}

/**
 * Wait for a cooperative realm to finish, but never beyond one crash-expiring
 * lease window. localStorage has no compare-and-swap, so this is a best-effort
 * fallback for browsers without Web Locks, not a strict distributed mutex.
 */
async function waitForForeignLease(
  userId: string,
  waitDeadline: number,
): Promise<VerificationEmailRequestResult | null> {
  while (true) {
    const recent = recentResult(userId);
    if (recent) return recent;

    const lease = readPendingLease(userId);
    const now = Date.now();
    if (!lease || lease.ownerId === coordinatorOwnerId || lease.expiresAt <= now) {
      return null;
    }

    const waitRemainingMs = Math.min(lease.expiresAt, waitDeadline) - now;
    if (waitRemainingMs <= 0) return null;
    await delay(Math.max(1, Math.min(FALLBACK_LEASE_POLL_MS, waitRemainingMs)));
  }
}

async function requestInsideCoordination(
  user: User,
  confirmFallbackLease: boolean,
): Promise<VerificationEmailRequestResult> {
  const fallbackWaitDeadline = Date.now() + VERIFICATION_PENDING_LEASE_MS;
  while (true) {
    const recent = recentResult(user.uid);
    if (recent) return recent;

    const waitingResult = await waitForForeignLease(user.uid, fallbackWaitDeadline);
    if (waitingResult) return waitingResult;

    const acceptedWhileWaiting = recentResult(user.uid);
    if (acceptedWhileWaiting) return acceptedWhileWaiting;

    const leaseClaim = writePendingLease(user.uid);
    const leaseStored = leaseClaim === 'owned';
    if (leaseClaim === 'contended' && Date.now() < fallbackWaitDeadline) {
      await delay(FALLBACK_LEASE_CONFIRM_MS);
      continue;
    }
    if (leaseStored && confirmFallbackLease) {
      await delay(FALLBACK_LEASE_CONFIRM_MS);
      const acceptedDuringClaim = recentResult(user.uid);
      if (acceptedDuringClaim) {
        releasePendingLease(user.uid);
        return acceptedDuringClaim;
      }
      if (readPendingLease(user.uid)?.ownerId !== coordinatorOwnerId && Date.now() < fallbackWaitDeadline) {
        continue;
      }
    }

    const acceptedBeforeSend = recentResult(user.uid);
    if (acceptedBeforeSend) {
      if (leaseStored) releasePendingLease(user.uid);
      return acceptedBeforeSend;
    }

    try {
      await sendEmailVerification(user, {
        url: verificationActionUrl(),
        handleCodeInApp: true,
      });
      const acceptedAt = Date.now();
      markVerificationEmailDispatched(user.uid, acceptedAt);
      return { status: 'requested', acceptedAt };
    } finally {
      if (leaseStored) releasePendingLease(user.uid);
    }
  }
}

function coordinateVerificationRequest(user: User): Promise<VerificationEmailRequestResult> {
  const locks = getLockManager();
  if (locks) {
    return locks.request(
      verificationLockName(user.uid),
      { mode: 'exclusive' },
      () => requestInsideCoordination(user, false),
    );
  }
  return requestInsideCoordination(user, true);
}

/**
 * Request one verification email per account and cooldown window.
 * Concurrent signup/gate calls share the same Firebase request.
 */
export function sendAccountVerificationEmail(user: User): Promise<VerificationEmailRequestResult> {
  const recent = recentResult(user.uid);
  if (recent) return Promise.resolve(recent);

  const inFlight = inFlightByUserId.get(user.uid);
  if (inFlight) return inFlight;

  const pending = coordinateVerificationRequest(user);

  inFlightByUserId.set(user.uid, pending);
  void pending.finally(() => {
    if (inFlightByUserId.get(user.uid) === pending) inFlightByUserId.delete(user.uid);
  }).catch(() => {
    // The caller owns the original rejection; this branch only handles finally().
  });
  return pending;
}

export function verificationEmailErrorKey(message: string, code = ''): string {
  const normalized = code || getAuthErrorCode(new Error(message)) || message;
  if (normalized.includes('too-many-requests')) return 'auth_error_too_many_requests';
  if (normalized.includes('network-request-failed')) return 'auth_error_network';
  return 'verify_gate_send_failed';
}
