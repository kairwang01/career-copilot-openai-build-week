
import React, { useState, useEffect, useRef } from 'react';
import { updateProfile } from 'firebase/auth';
import { sendAccountVerificationEmail } from '@/lib/auth/sendVerificationEmail';
import { data } from '@/lib/data';
import { firebaseAuth } from '@/lib/firebaseClient';
import { BUSINESS_PLANS } from '@/config';
import type { Plan } from '@/types';
import { Check, X, Eye, EyeOff, LogIn } from 'lucide-react';
import { BrandMark } from './BrandLogo';
import { ViewportAwareDialog } from './ViewportAwareDialog';
import CheckoutRedirectNotice from './billing/CheckoutRedirectNotice';

// Unified input styling (was inconsistent — sign-in inputs lacked dark mode).
const INPUT_CLASS =
  'w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2.5 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 transition focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30';
import { markOnboardingPending } from '../lib/onboarding';
import { setUserSubscription } from '../services/subscriptionClient';
import { useSubscriptionCheckout } from '../contexts/SubscriptionCheckoutContext';
import { useToast } from './Toast';
import { shouldRedirectBusinessPlanToCheckout } from '../lib/access/businessEntryDecisions';

/**
 * Password input with a show/hide toggle — a standard auth affordance that lets
 * users catch typos before submitting (especially on the confirm-password field
 * and on mobile). Each field keeps its own visibility state. The toggle stays
 * keyboard-reachable with an aria-pressed label; the eye glyphs are decorative.
 */
const PasswordField: React.FC<{
  id: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
  autoComplete: string;
  minLength?: number;
  t: (key: string) => string;
}> = ({ id, value, onChange, placeholder, autoComplete, minLength, t }) => {
  const [visible, setVisible] = useState(false);
  // aria-labels fall back to English when a locale hasn't translated the key,
  // so the toggle never surfaces a raw i18n key to screen readers.
  const label = (key: string, fallback: string) => {
    const v = t(key);
    return v === key ? fallback : v;
  };
  return (
    <>
      <label htmlFor={id} className="sr-only">{placeholder}</label>
      <div className="relative">
      <input
        id={id}
        className={`${INPUT_CLASS} pe-11`}
        type={visible ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        required
        autoComplete={autoComplete}
        minLength={minLength}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? label('auth_hide_password', 'Hide password') : label('auth_show_password', 'Show password')}
        aria-pressed={visible}
        className="absolute inset-y-0 end-0 flex items-center px-3 text-gray-400 transition-colors hover:text-gray-600 focus:outline-none focus-visible:text-blue-600 dark:hover:text-gray-200 dark:focus-visible:text-blue-400"
      >
        {visible ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
      </button>
      </div>
    </>
  );
};

interface AuthProps {
  onClose: () => void;
  initialView?: 'sign_in' | 'sign_up' | 'forgot_password';
  mode: 'candidate' | 'business';
  t: (key: string) => string;
}

const PlanSelectorCard: React.FC<{ plan: Plan & { key: string }; isSelected: boolean; onSelect: () => void; t: (key: string) => string; }> = ({ plan, isSelected, onSelect, t }) => {
    const periodKey = `plan_${plan.key}_period_desc`;
    const translatedPeriod = t(periodKey);
    const priceDescription = translatedPeriod === periodKey ? t(`plan_${plan.key}_price_desc`) : translatedPeriod;
    const featureLabel = (index: number, fallback: string) => {
        const key = `plan_${plan.key}_feature_${index + 1}`;
        const translated = t(key);
        return translated === key ? fallback : translated;
    };
    
    return (
        <button
            type="button"
            onClick={onSelect}
            className={`w-full p-4 border-2 rounded-lg text-left transition-all ${isSelected ? 'border-blue-600 bg-blue-50/80 shadow-sm' : 'border-gray-300 bg-white hover:border-blue-400'}`}
        >
            <h4 className="font-bold text-gray-900">{t(`plan_${plan.key}_name`)}</h4>
            <div className="flex items-baseline mt-1">
                <span className="text-2xl font-extrabold text-gray-900">{plan.price}</span>
                {plan.price !== '$0' && <span className="ml-1 text-sm font-medium text-gray-500">{priceDescription}</span>}
            </div>
            <ul className="mt-2 space-y-1 text-xs text-gray-600">
                {plan.features.slice(0, 3).map((feature, index) => (
                    <li key={index} className="flex items-start">
                        <Check className="h-4 w-4 mr-2 mt-0.5 text-green-500 flex-shrink-0" aria-hidden="true" strokeWidth={3} />
                        <span>{featureLabel(index, feature)}</span>
                    </li>
                ))}
            </ul>
        </button>
    );
};


const getAuthErrorMessage = (message: string, t: AuthProps['t']): string => {
  if (message.includes('invalid-credential') || message.includes('wrong-password') || message.includes('user-not-found')) {
    return t('auth_error_invalid_credentials');
  }
  if (message.includes('email-already-in-use') || message.includes('already registered')) {
    return t('auth_error_user_exists');
  }
  if (message.includes('weak-password')) {
    return t('auth_error_weak_password');
  }
  if (message.includes('invalid-email')) {
    return t('auth_error_invalid_email');
  }
  if (message.includes('too-many-requests')) {
    return t('auth_error_too_many_requests');
  }
  if (message.includes('network-request-failed')) {
    return t('auth_error_network');
  }
  return t('auth_error_generic');
};

const Auth: React.FC<AuthProps> = ({ onClose, initialView = 'sign_in', mode, t }) => {
  const { startSubscriptionCheckout } = useSubscriptionCheckout();
  const { addToast } = useToast();
  const [loading, setLoading] = useState(false);
  // Ref latch: the `loading` state lags a render, so a fast double Enter/click would fire
  // two auth calls (worst case: two account-creation attempts). mountedRef drops the tail
  // setState — on success the auth listener closes/unmounts this modal.
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [authView, setAuthView] = useState<'sign_in' | 'sign_up' | 'forgot_password'>(initialView);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signupComplete, setSignupComplete] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string>(mode === 'business' ? 'starter' : 'free');
  const selectedBusinessPlan = mode === 'business'
    ? (BUSINESS_PLANS[selectedPlan as keyof typeof BUSINESS_PLANS] ?? null)
    : null;
  useEffect(() => {
    setAuthView(initialView);
  }, [initialView]);
  
  useEffect(() => {
    setSelectedPlan(mode === 'business' ? 'starter' : 'free');
    setError(null);
    setMessage(null);
    setSignupComplete(false);
    // Also reset the in-flight flag: switching views (e.g. Forgot password →
    // back to Sign in) used to leave a stale loading=true behind, so the
    // submit button stayed stuck on "Signing in…" forever.
    setLoading(false);
    inFlightRef.current = false;
  }, [mode, authView]);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const { error } = await data.auth.signInWithPassword(email, password);
      if (!mountedRef.current) return;
      if (error) {
        setError(getAuthErrorMessage(error.message, t));
      } else {
        onClose();
      }
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  };
  
  const handleSignUp = async (event: React.FormEvent) => {
    event.preventDefault();
    if (signupComplete) return;

    // Validate full name before hitting the network.
    const trimmedName = fullName.trim();
    if (trimmedName.length < 2 || trimmedName.length > 80) {
      setError(t('auth_name_required'));
      return;
    }
    const trimmedCompanyName = companyName.trim();
    if (mode === 'business' && (trimmedCompanyName.length < 2 || trimmedCompanyName.length > 160)) {
      setError(t('auth_placeholder_org_name'));
      return;
    }

    // Catch typos before hitting the network.
    if (password !== confirmPassword) {
      setError(t('auth_error_password_mismatch'));
      return;
    }

    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    setMessage(null);

    const planKeyForServer = mode === 'business'
        ? `pending_biz_${selectedPlan}`
        : selectedPlan === 'free' ? 'free' : `pending_${selectedPlan}`;

    try {
      const { data: authData, error: authError } = await data.auth.signUp(email, password);
      if (!mountedRef.current) return;

      if (authError) {
        if (authError.message.includes('email-already-in-use') || authError.message.includes('already registered')) {
          // Switching to the sign-in view fires the [mode, authView] effect which
          // clears `error`, so an inline setError here would be wiped instantly.
          // Use a toast — it lives in the global provider and survives the switch.
          addToast(t('auth_error_user_exists'), 'error');
          setAuthView('sign_in');
        } else {
          setError(getAuthErrorMessage(authError.message, t));
        }
        return;
      }

      if (authData) {
        // The Auth account now exists. Replace the form immediately so a slow
        // profile/checkout handoff can never submit a second create request.
        setSignupComplete(true);
        // Mark the guided setup BEFORE the awaits below. The auth listener
        // navigates away (unmounting this modal) the instant the account is
        // created, so the `!mountedRef.current` guards further down can return
        // early and skip the original (late) markOnboardingPending — leaving
        // fresh candidates on the dashboard with no name step. This is a
        // localStorage write, safe to do regardless of mount state.
        if (mode !== 'business') markOnboardingPending(trimmedName);

        const requestVerification = async (): Promise<boolean> => {
          if (authData.emailVerified) return true;
          try {
            await sendAccountVerificationEmail(authData);
            return true;
          } catch (err) {
            if (import.meta.env.DEV) console.warn('Signup verification request failed:', err);
            addToast(t('verify_gate_send_failed'), 'error');
            return false;
          }
        };

        // The callable is the single profile bootstrap authority. It writes the
        // name and, for a fresh business signup, organization + employer role in
        // the same server transaction regardless of whether the Auth trigger won
        // the race. The client never mirrors role/subscription/credits.
        const subscriptionResult = await setUserSubscription(planKeyForServer, {
          fullName: trimmedName,
          ...(mode === 'business' ? { companyName: trimmedCompanyName } : {}),
        });

        // Paid plan → Stripe checkout. The checkout host is mounted above route
        // switches, so the auth listener can move the user to the workspace while
        // the embedded checkout stays open.
        if (
          subscriptionResult.status === 'pending_payment' &&
          (mode !== 'business' || shouldRedirectBusinessPlanToCheckout(selectedPlan, subscriptionResult.status))
        ) {
          // Send the verification email BEFORE redirecting to Stripe. Paid signups
          // return here, so the send below (free-plan path) is never reached for
          // them — without this, no paid user ever receives a verification email.
          const verificationRequested = await requestVerification();
          if (verificationRequested) addToast(t('auth_signup_success_verify'), 'info');
          await startSubscriptionCheckout(planKeyForServer);
          return;
        }
        // (pending_payment is handled above, before the mount guard.)
        // Best-effort: set Firebase Auth displayName (non-fatal if it fails).
        try {
          if (firebaseAuth.currentUser) {
            await updateProfile(firebaseAuth.currentUser, { displayName: trimmedName });
          }
        } catch {
          // non-fatal — the server-owned profile already has the name
        }
        // Request verification without rolling back the created account. The
        // workspace gate still blocks access until Firebase reports verified.
        // Deliberately NOT gated on mountedRef — the auth listener unmounts this
        // modal the instant the account is created (see note above), so gating
        // this on mount state was silently skipping every verification email.
        const verificationRequested = await requestVerification();
        // (markOnboardingPending now runs above, before the unmount-prone awaits.)
        // The auth listener navigates away (unmounting this modal) the instant
        // the account is created, so the inline message would never be seen —
        // show the verify-your-email notice as a global toast that persists.
        if (verificationRequested) {
          addToast(t('auth_signup_success_verify'), 'info');
          if (mountedRef.current) setMessage(t('auth_signup_success_verify'));
        }
      } else {
        setError(t('auth_account_create_failed'));
      }
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : t('auth_unexpected_error'));
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  };
  
  const handlePasswordReset = async (event: React.FormEvent) => {
    event.preventDefault();
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const { error } = await data.auth.resetPassword(email);
      if (!mountedRef.current) return;
      if (error) setError(getAuthErrorMessage(error.message, t));
      else setMessage(t('auth_message_reset_link_sent'));
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }
  
  const handleGoogleLogin = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    // Store plan selection for OAuth flow
    sessionStorage.setItem('pending_plan', selectedPlan);
    sessionStorage.setItem('pending_mode', mode);

    setLoading(true);
    setError(null);
    // signInWithGoogle is a POPUP flow (not a redirect — the old comment was a
    // Supabase-era leftover). If the user closes the popup, the promise resolves
    // with an error and, previously, loading was never reset — the button stayed
    // stuck on "Signing in…" until a full reload.
    try {
      const { data: googleResult, error } = await data.auth.signInWithGoogle();
      // First-time Google candidate: run the SAME guided onboarding as email
      // sign-up (the name step pre-fills from the Google display name). Set this
      // BEFORE the mount guard — the auth listener may already have unmounted us,
      // and it's a safe localStorage write. Without it the social-first Google
      // button skipped onboarding entirely.
      if (!error && googleResult?.isNewUser && mode !== 'business') {
        markOnboardingPending(firebaseAuth.currentUser?.displayName ?? undefined);
      }
      if (!mountedRef.current) return;
      if (error) {
        setError(getAuthErrorMessage(error.message, t));
      } else {
        setSignupComplete(true);
      }
    } finally {
      // On success the auth listener closes this modal; resetting is harmless.
      inFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }

  const renderContent = () => {
    const businessPlans = [BUSINESS_PLANS.starter, BUSINESS_PLANS.growth, BUSINESS_PLANS.pro];

    // Social-first, low-friction entry (BOSS instant-start + NA one-click norm).
    // Candidate only (business signup uses the email + plan path).
    const googleBlock = mode !== 'business' ? (
      <>
        <button type="button" onClick={handleGoogleLogin} disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 py-2.5 font-medium text-gray-700 dark:text-gray-200 transition hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-60">
          <LogIn className="h-5 w-5" aria-hidden="true" />
          {t('auth_continue_google')}
        </button>
        <div className="relative flex items-center py-1">
          <div className="flex-grow border-t border-gray-200 dark:border-slate-700"></div>
          <span className="mx-3 text-xs text-gray-400">{t('auth_or_separator')}</span>
          <div className="flex-grow border-t border-gray-200 dark:border-slate-700"></div>
        </div>
      </>
    ) : null;

    switch (authView) {
      case 'sign_up':
        if (signupComplete) {
          return (
            <div className="space-y-4 text-center" role="status" aria-live="polite">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                <Check className="h-6 w-6" aria-hidden="true" />
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="w-full rounded-lg bg-blue-700 py-2.5 font-semibold text-white transition hover:bg-blue-800 disabled:cursor-wait disabled:bg-blue-400"
              >
                {loading ? t('auth_creating_account') : t('ob_continue')}
              </button>
            </div>
          );
        }
        return (
          <>
            <h2 className="text-2xl font-bold text-center text-gray-800 dark:text-gray-100">{mode === 'business' ? t('auth_create_employer_account') : t('auth_create_candidate_account')}</h2>

            {/* Business signup is a purchase choice → keep the plan picker.
                Candidate signup is free — no picker; upgrade happens in-app. */}
            {mode === 'business' && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 text-center">{t('auth_choose_posting_plan')}</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  {businessPlans.map(plan => (
                    <PlanSelectorCard key={plan.key} plan={plan} isSelected={selectedPlan === plan.key} onSelect={() => setSelectedPlan(plan.key)} t={t} />
                  ))}
                </div>
                {selectedBusinessPlan && (
                  <CheckoutRedirectNotice>
                    {t(`plan_${selectedBusinessPlan.key}_name`)} · {t('portal_billing_available_desc')}
                  </CheckoutRedirectNotice>
                )}
              </div>
            )}

            {googleBlock}

            <form onSubmit={handleSignUp} className="space-y-3">
              <label htmlFor="auth-signup-name" className="sr-only">{t('auth_placeholder_full_name')}</label>
              <input id="auth-signup-name" className={INPUT_CLASS} type="text" placeholder={t('auth_placeholder_full_name')} value={fullName} onChange={(e) => setFullName(e.target.value)} required minLength={2} maxLength={80} autoComplete="name" />
              {mode === 'business' && (
                <>
                  <label htmlFor="auth-signup-company" className="sr-only">{t('auth_placeholder_org_name')}</label>
                  <input id="auth-signup-company" className={INPUT_CLASS} type="text" placeholder={t('auth_placeholder_org_name')} value={companyName} onChange={(e) => setCompanyName(e.target.value)} required minLength={2} maxLength={160} autoComplete="organization" />
                </>
              )}
              <label htmlFor="auth-signup-email" className="sr-only">{mode === 'business' ? t('auth_placeholder_email_business') : t('auth_placeholder_email')}</label>
              <input id="auth-signup-email" className={INPUT_CLASS} type="email" placeholder={mode === 'business' ? t('auth_placeholder_email_business') : t('auth_placeholder_email')} value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              <PasswordField id="auth-signup-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('auth_placeholder_password')} autoComplete="new-password" minLength={6} t={t} />
              <PasswordField id="auth-signup-confirm-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder={t('auth_placeholder_confirm_password')} autoComplete="new-password" minLength={6} t={t} />
              <button className="w-full rounded-lg bg-blue-700 py-2.5 font-semibold text-white transition hover:bg-blue-800 disabled:bg-blue-400" type="submit" disabled={loading}>
                {loading ? t('auth_creating_account') : (mode === 'business' ? t('auth_signup_for_jobs') : t('auth_signup'))}
              </button>
            </form>
            <p className="text-center text-sm text-gray-600 dark:text-gray-400">
              {mode === 'business' ? t('auth_employer_exists') : t('auth_candidate_exists')} <button type="button" onClick={() => setAuthView('sign_in')} className="text-blue-600 dark:text-blue-400 hover:underline">{t('auth_signin_link')}</button>
            </p>
          </>
        );
      case 'forgot_password':
        return (
          <>
            <h2 className="text-2xl font-bold text-center text-gray-800 dark:text-gray-100">{t('auth_reset_password_title')}</h2>
            <form onSubmit={handlePasswordReset} className="space-y-3">
              <label htmlFor="auth-reset-email" className="sr-only">{t('auth_placeholder_email')}</label>
              <input id="auth-reset-email" className={INPUT_CLASS} type="email" placeholder={t('auth_placeholder_email')} value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              <button className="w-full rounded-lg bg-blue-700 py-2.5 font-semibold text-white transition hover:bg-blue-800 disabled:bg-blue-400" type="submit" disabled={loading}>
                {loading ? t('auth_sending_link') : t('auth_send_reset_link')}
              </button>
            </form>
            <p className="text-center text-sm text-gray-600 dark:text-gray-400">
              {t('auth_remembered_password')} <button type="button" onClick={() => setAuthView('sign_in')} className="text-blue-600 dark:text-blue-400 hover:underline">{t('auth_signin_link')}</button>
            </p>
          </>
        );
      default: // sign_in
        return (
          <>
            <h2 className="text-2xl font-bold text-center text-gray-800 dark:text-gray-100">{mode === 'business' ? t('auth_employer_signin_title') : t('auth_welcome_back')}</h2>
            {googleBlock}
            <form onSubmit={handleLogin} className="space-y-3">
              <label htmlFor="auth-signin-email" className="sr-only">{t('auth_placeholder_email')}</label>
              <input id="auth-signin-email" className={INPUT_CLASS} type="email" placeholder={t('auth_placeholder_email')} value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              <PasswordField id="auth-signin-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('auth_placeholder_password_signin')} autoComplete="current-password" t={t} />
              <button className="w-full rounded-lg bg-blue-700 py-2.5 font-semibold text-white transition hover:bg-blue-800 disabled:bg-blue-400" type="submit" disabled={loading}>
                {loading ? t('auth_signing_in') : t('auth_sign_in')}
              </button>
            </form>
            <div className="text-right text-sm">
              <button type="button" onClick={() => setAuthView('forgot_password')} className="text-blue-600 dark:text-blue-400 hover:underline">{t('auth_forgot_password_link')}</button>
            </div>
            <p className="text-center text-sm text-gray-600 dark:text-gray-400">
              {mode === 'business' ? t('auth_no_employer_account') : t('auth_no_candidate_account')} <button type="button" onClick={() => setAuthView('sign_up')} className="text-blue-600 dark:text-blue-400 hover:underline">{t('auth_signup_link')}</button>
            </p>
          </>
        );
    }
  };

  return (
    <ViewportAwareDialog
      open
      onClose={onClose}
      closeOnBackdrop
      ariaLabel={mode === 'business' ? t('auth_business_signin_desc') : t('auth_welcome_back')}
      maxWidth={448}
      zIndex={100}
      avoidTopSelector='[data-qa="cookie-consent-banner"]'
    >
      <div className="relative space-y-4 rounded-2xl bg-white p-8 shadow-2xl dark:bg-slate-900">
        <button type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          aria-label={t('tool_agile_coach_close_button')}
        >
          <X size={24} />
        </button>
        <div className="flex justify-center"><BrandMark className="h-10 w-10" /></div>
        {message && <div role="status" aria-live="polite" className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-center text-sm text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">{message}</div>}
        {error && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-center text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">{error}</div>}
        {renderContent()}
      </div>
    </ViewportAwareDialog>
  );
};

export default Auth;
