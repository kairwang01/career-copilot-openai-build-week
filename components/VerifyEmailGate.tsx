import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LogOut, MailCheck, RefreshCw } from 'lucide-react';
import { signOut } from 'firebase/auth';
import { firebaseAuth } from '@/lib/firebaseClient';
import {
  sendAccountVerificationEmail,
  verificationEmailCooldownRemainingMs,
  verificationEmailErrorKey,
  wasVerificationEmailDispatchedRecently,
} from '@/lib/auth/sendVerificationEmail';

interface VerifyEmailGateProps {
  email: string | null;
  t: (key: string) => string;
}

function secondsRemaining(milliseconds: number): number {
  return Math.max(0, Math.ceil(milliseconds / 1000));
}

/** Full-screen ownership gate for signed-in password users. */
export const VerifyEmailGate: React.FC<VerifyEmailGateProps> = ({ email, t }) => {
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [noticeVisible, setNoticeVisible] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const sendInFlightRef = useRef(false);
  const checkInFlightRef = useRef(false);
  const sendOperationRef = useRef(0);
  const checkOperationRef = useRef(0);
  const initialSendForUserRef = useRef<string | null>(null);

  const clearTimer = useCallback(() => {
    if (!timerRef.current) return;
    clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const startCooldown = useCallback((userId: string) => {
    clearTimer();
    const tick = () => {
      if (!mountedRef.current || firebaseAuth.currentUser?.uid !== userId) {
        clearTimer();
        return;
      }
      const next = secondsRemaining(verificationEmailCooldownRemainingMs(userId));
      setCooldown(next);
      if (next === 0) clearTimer();
    };
    tick();
    if (verificationEmailCooldownRemainingMs(userId) > 0) {
      timerRef.current = setInterval(tick, 1_000);
    }
  }, [clearTimer]);

  const sendVerification = useCallback(async () => {
    const user = firebaseAuth.currentUser;
    if (!user || user.emailVerified || sendInFlightRef.current) return false;

    const remaining = verificationEmailCooldownRemainingMs(user.uid);
    if (remaining > 0) {
      setNoticeVisible(true);
      setErrorKey(null);
      startCooldown(user.uid);
      return true;
    }

    sendInFlightRef.current = true;
    const operationId = ++sendOperationRef.current;
    setSending(true);
    setErrorKey(null);
    setNoticeVisible(false);
    try {
      await sendAccountVerificationEmail(user);
      if (
        mountedRef.current &&
        operationId === sendOperationRef.current &&
        firebaseAuth.currentUser?.uid === user.uid
      ) {
        setNoticeVisible(true);
        startCooldown(user.uid);
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      const code = err && typeof err === 'object' && 'code' in err
        ? String((err as { code: string }).code)
        : '';
      if (import.meta.env.DEV) console.warn('VerifyEmailGate request failed:', code || message, err);
      if (
        mountedRef.current &&
        operationId === sendOperationRef.current &&
        firebaseAuth.currentUser?.uid === user.uid
      ) {
        setErrorKey(verificationEmailErrorKey(message, code));
      }
      return false;
    } finally {
      if (operationId === sendOperationRef.current) {
        sendInFlightRef.current = false;
        if (mountedRef.current) setSending(false);
      }
    }
  }, [startCooldown]);

  useEffect(() => {
    const user = firebaseAuth.currentUser;
    const previousUserId = initialSendForUserRef.current;
    if (!user) {
      if (previousUserId) {
        sendOperationRef.current += 1;
        checkOperationRef.current += 1;
        sendInFlightRef.current = false;
        checkInFlightRef.current = false;
        initialSendForUserRef.current = null;
        clearTimer();
        setCooldown(0);
      }
      return;
    }
    if (previousUserId && previousUserId !== user.uid) {
      sendOperationRef.current += 1;
      checkOperationRef.current += 1;
      sendInFlightRef.current = false;
      checkInFlightRef.current = false;
      clearTimer();
      setCooldown(0);
      setNoticeVisible(false);
      setErrorKey(null);
    }
    if (user.emailVerified || previousUserId === user.uid) return;
    initialSendForUserRef.current = user.uid;
    if (wasVerificationEmailDispatchedRecently(user.uid)) {
      setNoticeVisible(true);
      startCooldown(user.uid);
      return;
    }
    void sendVerification();
  }, [clearTimer, email, sendVerification, startCooldown]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer();
    };
  }, [clearTimer]);

  const handleResend = useCallback(() => {
    const user = firebaseAuth.currentUser;
    if (!user) return;
    const remaining = verificationEmailCooldownRemainingMs(user.uid);
    if (remaining > 0) {
      startCooldown(user.uid);
      return;
    }
    void sendVerification();
  }, [sendVerification, startCooldown]);

  const handleCheck = useCallback(async () => {
    const user = firebaseAuth.currentUser;
    if (!user || checkInFlightRef.current) return;
    checkInFlightRef.current = true;
    const operationId = ++checkOperationRef.current;
    setErrorKey(null);
    setNoticeVisible(false);
    setChecking(true);
    try {
      await user.reload();
      if (
        !mountedRef.current ||
        operationId !== checkOperationRef.current ||
        firebaseAuth.currentUser?.uid !== user.uid
      ) return;
      if (user.emailVerified || firebaseAuth.currentUser.emailVerified) {
        window.location.reload();
        return;
      }
      setErrorKey('verify_gate_still_unverified');
    } catch (err) {
      if (!mountedRef.current || operationId !== checkOperationRef.current) return;
      const message = err instanceof Error ? err.message : '';
      setErrorKey(message.includes('network-request-failed') ? 'auth_error_network' : 'verify_gate_still_unverified');
    } finally {
      if (operationId === checkOperationRef.current) {
        checkInFlightRef.current = false;
        if (mountedRef.current) setChecking(false);
      }
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    if (signingOut) return;
    setSigningOut(true);
    sendOperationRef.current += 1;
    checkOperationRef.current += 1;
    sendInFlightRef.current = false;
    checkInFlightRef.current = false;
    try {
      await signOut(firebaseAuth);
    } finally {
      window.location.assign('/');
    }
  }, [signingOut]);

  return (
    <main className="beta-root flex min-h-dvh w-full items-start justify-center overflow-y-auto bg-gradient-to-b from-slate-50 to-slate-100 px-3 py-5 sm:items-center sm:px-4 sm:py-10">
      <section
        aria-labelledby="verify-email-title"
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8"
      >
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-blue-50">
          <MailCheck className="h-7 w-7 text-blue-700" aria-hidden="true" />
        </div>
        <h1 id="verify-email-title" className="text-center text-xl font-bold text-slate-900">
          {t('verify_gate_title')}
        </h1>
        <p className="mt-3 break-words text-center text-sm leading-relaxed text-slate-600 [overflow-wrap:anywhere]">
          {t('verify_gate_body').replace('{email}', email || t('verify_gate_your_email'))}
        </p>
        <p className="mt-2 text-center text-xs font-medium text-slate-500">
          {t('verify_gate_spam_hint')}
        </p>

        {noticeVisible && (
          <div className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-center text-sm text-emerald-800" role="status" aria-live="polite">
            {t('verify_gate_resent')}
          </div>
        )}
        {errorKey && (
          <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-center text-sm text-amber-800" role="alert">
            {t(errorKey)}
          </div>
        )}

        <div className="mt-6 space-y-3">
          <button
            type="button"
            onClick={() => { void handleCheck(); }}
            disabled={checking || signingOut}
            aria-busy={checking}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${checking ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />
            {checking ? t('verify_gate_checking') : t('verify_gate_check')}
          </button>
          <button
            type="button"
            onClick={handleResend}
            disabled={sending || cooldown > 0 || signingOut}
            aria-busy={sending}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cooldown > 0
              ? t('verify_gate_resend_cooldown').replace('{seconds}', String(cooldown))
              : t('verify_gate_resend')}
          </button>
        </div>

        <p className="mt-6 text-center text-xs leading-relaxed text-slate-500">{t('verify_gate_typo_hint')}</p>
        <button
          type="button"
          onClick={() => { void handleSignOut(); }}
          disabled={signingOut}
          aria-busy={signingOut}
          className="mx-auto mt-3 flex min-h-11 items-center justify-center gap-1.5 px-3 text-xs font-semibold text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 disabled:opacity-60"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          {t('verify_gate_signout')}
        </button>
      </section>
    </main>
  );
};
