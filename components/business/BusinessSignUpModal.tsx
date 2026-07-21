
import React, { useEffect, useRef, useState } from 'react';
import { sendAccountVerificationEmail } from '@/lib/auth/sendVerificationEmail';
import { data } from '@/lib/data';
import { setUserSubscription } from '@/services/subscriptionClient';
import { useSubscriptionCheckout } from '@/contexts/SubscriptionCheckoutContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { PasswordInput } from '../ui/PasswordInput';
import { Button } from '../ui/button';
import { Check } from 'lucide-react';
import CheckoutRedirectNotice from '../billing/CheckoutRedirectNotice';
import { useToast } from '../Toast';
import { businessPlanDefs, type BusinessPlanId } from './businessPlans';
import { shouldRedirectBusinessPlanToCheckout } from '../../lib/access/businessEntryDecisions';

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitchToSignIn: () => void;
  onSignedUp?: () => Promise<void> | void;
  initialPlan?: BusinessPlanId;
  /** Called only after a valid, explicit form submit accepts the URL-backed selection. */
  onPricingIntentHandled?: () => void;
  /** Restores the URL-backed selection when account creation fails. */
  onPricingIntentRestore?: () => void;
  t: (key: string) => string;
}

function mapBusinessSignUpError(message: string, t: Props['t']): string {
  if (message.includes('weak-password')) return t('auth_error_weak_password');
  if (message.includes('invalid-email')) return t('auth_error_invalid_email');
  if (message.includes('too-many-requests')) return t('auth_error_too_many_requests');
  if (message.includes('network-request-failed')) return t('auth_error_network');
  return t('auth_error_generic');
}

export default function BusinessSignUpModal({
  isOpen,
  onOpenChange,
  onSwitchToSignIn,
  onSignedUp,
  initialPlan = 'starter',
  onPricingIntentHandled,
  onPricingIntentRestore,
  t,
}: Props) {
  const { startSubscriptionCheckout } = useSubscriptionCheckout();
  const { addToast } = useToast();
  const [selectedPlan, setSelectedPlan] = useState<BusinessPlanId>(initialPlan);
  const [orgName, setOrgName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const selectedBusinessPlan = businessPlanDefs.find((plan) => plan.id === selectedPlan) ?? businessPlanDefs[0];
  const selectedPlanName = t(selectedBusinessPlan.nameKey);
  // Ref latch (state lags a render → a double Enter could fire two signUp /
  // setUserSubscription calls). mountedRef drops tail setState if the modal unmounts.
  const submittingRef = useRef(false);
  const mountedRef = useRef(true);
  const wasOpenRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    // Reopening during an in-flight signup must keep the same locked operation;
    // otherwise a second account request can race the first one.
    if (isOpen && !wasOpenRef.current && !submittingRef.current) {
      setOrgName('');
      setContactName('');
      setEmail('');
      setPassword('');
      setConfirmPassword('');
      setError(null);
      setMessage(null);
      setCompleted(false);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && !completed) setSelectedPlan(initialPlan);
  }, [initialPlan, isOpen, completed]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedOrgName = orgName.trim();
    const trimmedContactName = contactName.trim();
    if (trimmedContactName.length < 2 || trimmedContactName.length > 80) {
      setError(t('auth_contact_name'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('auth_error_password_mismatch'));
      return;
    }
    if (submittingRef.current) return; // block synchronous double-submit
    submittingRef.current = true;
    // A URL intent is consumed only after the user explicitly submits a valid
    // form. Merely loading the URL never mutates billing state or opens checkout.
    onPricingIntentHandled?.();
    let shouldRestorePricingIntent = Boolean(onPricingIntentHandled);
    const restorePricingIntent = () => {
      if (!shouldRestorePricingIntent) return;
      shouldRestorePricingIntent = false;
      onPricingIntentRestore?.();
    };
    const acceptPricingIntent = () => {
      shouldRestorePricingIntent = false;
    };
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const { data: authData, error: authError } = await data.auth.signUp(email, password);

      if (authError) {
        restorePricingIntent();
        if (authError.message.includes('email-already-in-use') || authError.message.includes('already registered')) {
          // onSwitchToSignIn() unmounts this modal, so an inline setError would
          // never render. A toast lives in the global provider and survives the
          // modal swap, so the user learns why they were sent to sign-in.
          addToast(t('auth_error_user_exists'), 'error');
          if (mountedRef.current) onSwitchToSignIn();
        } else if (mountedRef.current) {
          setError(mapBusinessSignUpError(authError.message, t));
        }
        return;
      }

      if (authData) {
        // The Firebase account now exists. Replace the form immediately so a
        // profile or checkout failure cannot submit another create request.
        if (mountedRef.current) {
          setCompleted(true);
          setMessage(null);
        }

        const requestVerification = async (): Promise<boolean> => {
          if (authData.emailVerified) return true;
          try {
            await sendAccountVerificationEmail(authData);
            return true;
          } catch (err) {
            if (import.meta.env.DEV) console.warn('Business verification request failed:', err);
            addToast(t('verify_gate_send_failed'), 'error');
            return false;
          }
        };

        // Write the contact name + organization server-side at doc creation
        // (race-free). This callable is the only bootstrap authority; the client
        // does not mirror server-owned role/subscription/credit fields.
        const pendingPlanKey = `pending_biz_${selectedPlan}`;
        const subscriptionResult = await setUserSubscription(pendingPlanKey, {
          fullName: trimmedContactName,
          companyName: trimmedOrgName,
        });

        // Paid plan → Stripe checkout. The checkout host is mounted above route
        // switches, so auth routing can move the user to /portal while the embedded
        // checkout remains open.
        if (shouldRedirectBusinessPlanToCheckout(selectedPlan, subscriptionResult.status)) {
          // Send the verification email BEFORE redirecting to Stripe. Paid employer
          // signups return here, so the send below (free-plan path) is never reached
          // for them — without this, no paid employer ever receives a verification email.
          const verificationRequested = await requestVerification();
          if (verificationRequested) addToast(t('auth_signup_success_verify'), 'info');
          await startSubscriptionCheckout(pendingPlanKey);
          acceptPricingIntent();
          try {
            await onSignedUp?.();
          } catch {
            // Account creation and checkout handoff already succeeded.
          }
          if (mountedRef.current) {
            setMessage(t('auth_business_account_created'));
            setCompleted(true);
          }
          return;
        }
        acceptPricingIntent();
        // (pending_payment is handled above, before the mount guard.)
        // Request verification without rolling back the created account. The
        // workspace gate still blocks access until Firebase reports verified.
        // Deliberately NOT gated on mountedRef — the auth listener unmounts this
        // modal the instant the account is created, so gating this on mount state
        // was silently skipping every verification email.
        const verificationRequested = await requestVerification();
        // The account was successfully created. Swallow any transient error from
        // the post-signup callback (e.g. refreshProfile network failure) so the
        // form does not freeze — the success message is still shown to the user.
        try {
          await onSignedUp?.();
        } catch {
          // intentionally ignored — account creation succeeded
        }
        if (mountedRef.current) {
          setMessage(t('auth_business_account_created'));
          setCompleted(true);
        }
        if (verificationRequested) addToast(t('auth_signup_success_verify'), 'info');
      } else {
        restorePricingIntent();
        if (mountedRef.current) setError(t('auth_unexpected_error'));
      }
    } catch (err) {
      restorePricingIntent();
      if (mountedRef.current) {
        const message = err instanceof Error ? err.message : '';
        setError(mapBusinessSignUpError(message, t));
      }
    } finally {
      // Always release the loading state + latch, even if an unexpected error is thrown.
      submittingRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent maxWidth="lg" className="p-5 sm:p-8">
        <DialogHeader>
          <DialogTitle>{t('auth_create_employer_account')}</DialogTitle>
          <DialogDescription>{t('auth_business_signup_desc')}</DialogDescription>
        </DialogHeader>

        {error && (
          <div role="alert" className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-md text-sm mt-4 dark:bg-red-900/20 dark:border-red-800/50 dark:text-red-300">
            {error}
          </div>
        )}
        {message && !completed && (
          <div role="status" className="bg-green-50 border border-green-300 text-green-700 px-4 py-3 rounded-md text-sm mt-4 dark:bg-green-900/20 dark:border-green-800/50 dark:text-green-300">
            {message}
          </div>
        )}

        {completed ? (
          <div className="mt-5 rounded-lg border border-green-300 bg-green-50 p-5 text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-200">
            {(loading || message || !error) && (
              <p role="status" aria-live="polite" className="text-sm leading-6">
                {loading ? t('account_processing_button') : message ?? t('auth_business_account_created')}
              </p>
            )}
            <Button type="button" className="mt-5 w-full" onClick={() => onOpenChange(false)} disabled={loading}>
              {t('site_portal_continue')}
            </Button>
          </div>
        ) : (
          <>
          <form onSubmit={handleSubmit} className="space-y-5 mt-4">
          {/* Plan picker */}
          <div>
            <p className="text-center mb-3 text-gray-700 dark:text-gray-300 text-sm">{t('auth_choose_posting_plan')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {businessPlanDefs.map((plan) => (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => setSelectedPlan(plan.id)}
                  aria-pressed={selectedPlan === plan.id}
                  className={`relative text-left p-4 rounded-lg border-2 transition-all duration-150 ${
                    selectedPlan === plan.id
                      ? 'border-blue-600 bg-blue-50/80 dark:bg-blue-900/30 dark:border-blue-500'
                      : 'border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 hover:border-blue-400 dark:hover:border-blue-500'
                  }`}
                >
                  <h3 className="text-base text-gray-900 dark:text-gray-100 mb-2">{t(plan.nameKey)}</h3>
                  <div className="flex items-baseline gap-1 mb-3">
                    <span className="text-2xl font-semibold text-gray-900 dark:text-gray-100">${plan.price}</span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">{t('site_pricing_per_month')}</span>
                  </div>
                  <ul className="space-y-1.5">
                    {plan.featureKeys.map((featureKey) => (
                      <li key={featureKey} className="flex items-start gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                        <Check size={14} className="text-green-500 mt-0.5 flex-shrink-0" />
                        <span>{t(featureKey)}</span>
                      </li>
                    ))}
                  </ul>
                </button>
              ))}
            </div>
            {selectedPlan !== 'free' && (
              <CheckoutRedirectNotice className="mt-3">
                {selectedPlanName} · {t('portal_billing_available_desc')}
              </CheckoutRedirectNotice>
            )}
          </div>

          <Input
            type="text"
            placeholder={t('auth_placeholder_org_name')}
            aria-label={t('auth_placeholder_org_name')}
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            required
          />
          <Input
            type="text"
            placeholder={t('auth_contact_name_ph')}
            aria-label={t('auth_contact_name')}
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            required
            minLength={2}
            maxLength={80}
          />
          <Input
            type="email"
            placeholder={t('auth_placeholder_email_business')}
            aria-label={t('auth_placeholder_email_business')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <PasswordInput
            t={t}
            placeholder={t('auth_placeholder_password')}
            aria-label={t('auth_placeholder_password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={6}
            required
          />
          <PasswordInput
            t={t}
            placeholder={t('auth_placeholder_confirm_password')}
            aria-label={t('auth_placeholder_confirm_password')}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            required
          />

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? t('auth_creating_account') : t('auth_signup_for_jobs')}
          </Button>
          </form>

          <p className="text-center text-sm text-gray-600 dark:text-gray-400 mt-3">
            {t('auth_employer_exists')}{' '}
            <button
              type="button"
              onClick={onSwitchToSignIn}
              className="font-medium text-blue-600 hover:text-blue-700"
            >
              {t('auth_signin_link')}
            </button>
          </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
