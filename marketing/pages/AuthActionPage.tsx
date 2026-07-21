import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { firebaseAuth } from '@/lib/firebaseClient';
import {
  completeAuthActionOnce,
  completePasswordReset,
  type AuthActionOutcome,
  type PasswordResetOutcome,
} from '@/lib/auth/completeAuthAction';
import { SITE_ROUTES } from '../../config/site';
import { useMarketingI18n } from '../hooks/useMarketingI18n';

type Translate = (key: string) => string;

type ViewState =
  | { phase: 'loading'; search: string }
  | { phase: 'done'; search: string; outcome: AuthActionOutcome };

function clearSensitiveActionQuery(): void {
  try {
    window.history.replaceState(window.history.state, '', SITE_ROUTES.authAction);
  } catch {
    // A consumed code is already invalid; URL cleanup is best effort.
  }
}

function resetErrorKey(outcome: PasswordResetOutcome): string | null {
  if (outcome.status === 'success') return null;
  switch (outcome.reason) {
    case 'expired_or_invalid':
      return 'auth_action_error_expired';
    case 'weak_password':
      return 'auth_error_weak_password';
    case 'too_many_requests':
      return 'auth_error_too_many_requests';
    case 'network':
      return 'auth_error_network';
    default:
      return 'auth_action_error_generic';
  }
}

const ResetPasswordForm: React.FC<{ oobCode: string; t: Translate }> = ({ oobCode, t }) => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (inFlightRef.current || completed) return;
    if (newPassword !== confirmPassword) {
      setErrorKey('auth_error_password_mismatch');
      return;
    }
    if (newPassword.length < 6) {
      setErrorKey('auth_error_weak_password');
      return;
    }

    inFlightRef.current = true;
    setSubmitting(true);
    setErrorKey(null);
    const outcome = await completePasswordReset(firebaseAuth, oobCode, newPassword);
    if (mountedRef.current) {
      const errorKey = resetErrorKey(outcome);
      if (errorKey) {
        setErrorKey(errorKey);
      } else {
        setCompleted(true);
        setNewPassword('');
        setConfirmPassword('');
        clearSensitiveActionQuery();
      }
      setSubmitting(false);
    }
    inFlightRef.current = false;
  };

  if (completed) {
    return (
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm sm:p-8" role="status" aria-live="polite">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" aria-hidden="true" />
        <h1 className="mt-4 text-xl font-bold text-slate-900">{t('account_password_updated_success')}</h1>
        <Link
          to={SITE_ROUTES.portal}
          className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
        >
          {t('auth_action_back_signin')}
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
      <h1 className="text-center text-xl font-bold text-slate-900">{t('auth_reset_password_title')}</h1>
      {errorKey && (
        <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800" role="alert">
          {t(errorKey)}
        </div>
      )}
      <form className="mt-5 space-y-4" onSubmit={handleSubmit} aria-busy={submitting}>
        <div>
          <label htmlFor="auth-action-new-password" className="mb-1.5 block text-sm font-semibold text-slate-700">
            {t('account_new_password_label')}
          </label>
          <input
            id="auth-action-new-password"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
            minLength={6}
            required
            autoFocus
            className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-600/30"
          />
        </div>
        <div>
          <label htmlFor="auth-action-confirm-password" className="mb-1.5 block text-sm font-semibold text-slate-700">
            {t('account_confirm_password_label')}
          </label>
          <input
            id="auth-action-confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            minLength={6}
            required
            className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-600/30"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
        >
          {submitting ? t('account_processing_button') : t('account_update_password_button')}
        </button>
      </form>
      <Link
        to={SITE_ROUTES.portal}
        className="mx-auto mt-5 block w-fit rounded px-2 py-1 text-sm font-semibold text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
      >
        {t('auth_action_back_signin')}
      </Link>
    </div>
  );
};

export const AuthActionPage: React.FC = () => {
  const { t } = useMarketingI18n();
  const [searchParams] = useSearchParams();
  const search = searchParams.toString();
  const mode = searchParams.get('mode');
  const [view, setView] = useState<ViewState>({ phase: 'loading', search });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setView({ phase: 'loading', search });
    const run = async () => {
      // StrictMode and same-tab revisits share one action-code operation.
      const outcome = await completeAuthActionOnce(firebaseAuth, search);
      if (!active) return;
      setView({ phase: 'done', search, outcome });
      if (outcome.status === 'success') clearSensitiveActionQuery();
    };
    void run();
    return () => { active = false; };
  }, [attempt, search]);

  if (view.phase === 'loading' || view.search !== search) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-slate-50 px-4 py-10 text-slate-600" aria-busy="true">
        <Loader2 className="h-8 w-8 text-blue-700 motion-safe:animate-spin" aria-hidden="true" />
        <p className="text-center text-sm font-medium" role="status" aria-live="polite">
          {mode === 'resetPassword' ? t('auth_reset_password_title') : t('auth_action_verifying')}
        </p>
      </main>
    );
  }

  const { outcome } = view;

  if (outcome.status === 'success' && outcome.mode === 'verifyEmail') {
    return (
      <main className="flex min-h-dvh items-start justify-center overflow-y-auto bg-slate-50 px-3 py-5 sm:items-center sm:px-6 sm:py-10">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm sm:p-8">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" aria-hidden="true" />
          <h1 className="mt-4 text-xl font-bold text-slate-900">{t('auth_action_verify_success_title')}</h1>
          <p className="mt-2 text-sm text-slate-600">{t('auth_action_verify_success_body')}</p>
          <Link
            to={SITE_ROUTES.portal}
            className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
          >
            {t('auth_action_verify_success_cta')}
          </Link>
        </div>
      </main>
    );
  }

  if (outcome.status === 'ready' && outcome.mode === 'resetPassword') {
    return (
      <main className="flex min-h-dvh items-start justify-center overflow-y-auto bg-slate-50 px-3 py-5 sm:items-center sm:px-6 sm:py-10">
        <ResetPasswordForm key={outcome.oobCode} oobCode={outcome.oobCode} t={t} />
      </main>
    );
  }

  const errorKey = outcome.status === 'error' && outcome.reason === 'expired_or_invalid'
    ? 'auth_action_error_expired'
    : 'auth_action_error_generic';
  const canRetry = outcome.status === 'error' && outcome.reason === 'apply_failed';

  return (
    <main className="flex min-h-dvh items-start justify-center overflow-y-auto bg-slate-50 px-3 py-5 sm:items-center sm:px-6 sm:py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm sm:p-8">
        <XCircle className="mx-auto h-12 w-12 text-amber-600" aria-hidden="true" />
        <h1 className="mt-4 text-xl font-bold text-slate-900">{t('auth_action_error_title')}</h1>
        <p className="mt-2 text-sm text-slate-600">{t(errorKey)}</p>
        {canRetry && (
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
          >
            {t('action_retry')}
          </button>
        )}
        <Link
          to={SITE_ROUTES.portal}
          className={`${canRetry ? 'mt-3' : 'mt-6'} inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2`}
        >
          {t('auth_action_back_signin')}
        </Link>
      </div>
    </main>
  );
};
