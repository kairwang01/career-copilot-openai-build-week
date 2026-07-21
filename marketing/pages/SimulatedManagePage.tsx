import React, { useState } from 'react';
import { ArrowLeft, CheckCircle2, Loader2, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { useSession } from '../../contexts/SessionContext';
import { cancelSubscriptionSimulated } from '../../services/subscriptionClient';

/**
 * Sandbox billing management.
 *
 * createBillingPortalSession redirects here when BILLING_SIMULATION is enabled.
 * Cancel runs the same downgrade path as the subscription.deleted webhook, then
 * returns to the right billing surface. Production still returns a Stripe portal URL.
 */
const PLAN_LABELS: Record<string, string> = {
  essentials: 'Basic',
  accelerator: 'Pro',
  executive: 'Premium',
  starter: 'Starter',
  growth: 'Growth',
  pro: 'Pro',
  single_post: 'Single Post',
  job_pack: 'Job Pack',
};

const SimulatedManagePage: React.FC = () => {
  const { session, ready, profile } = useSession();
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = profile?.subscription_status ?? 'free';
  const planLabel = PLAN_LABELS[plan] ?? plan;
  const isBusiness = profile?.role === 'employer' || profile?.role === 'agency';
  const billingPath = isBusiness ? '/portal?billing=return' : '/workspace/billing';

  const handleCancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    setError(null);
    try {
      await cancelSubscriptionSimulated();
      window.location.assign(`${billingPath}${billingPath.includes('?') ? '&' : '?'}cancelled=success`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We could not update this subscription. Please try again.');
      setCancelling(false);
    }
  };

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <Loader2 className="mx-auto h-9 w-9 animate-spin text-blue-600" aria-hidden="true" />
          <p className="mt-4 text-base font-semibold text-slate-900 dark:text-slate-50">Loading billing settings...</p>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">We are checking your account before showing subscription controls.</p>
        </div>
      </div>
    );
  }

  if (ready && !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <SlidersHorizontal className="mx-auto h-9 w-9 text-blue-600" aria-hidden="true" />
          <p className="mt-4 text-base font-semibold text-slate-900 dark:text-slate-50">Sign in to manage billing.</p>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Subscription changes need to be tied to your account.</p>
          <a className="mt-5 inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700" href="/workspace?auth=signin">
            Sign in
          </a>
        </div>
      </div>
    );
  }

  if (ready && plan === 'free') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" aria-hidden="true" />
          <p className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-50">No active subscription.</p>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Your account is currently on the free plan.</p>
          <a className="mt-5 inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700" href={billingPath}>
            Back to billing
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="mx-auto w-full max-w-3xl">
        <button
          type="button"
          onClick={() => window.location.assign(billingPath)}
          disabled={cancelling}
          className="mb-5 inline-flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-medium text-slate-600 transition hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-300 dark:hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to billing
        </button>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-100 px-6 py-5 dark:border-slate-800">
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Sandbox billing
            </div>
            <p className="mt-5 text-sm font-medium text-slate-500 dark:text-slate-400">Current plan</p>
            <p className="mt-1 text-2xl font-bold text-slate-950 dark:text-slate-50">{planLabel}</p>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Changes here update the same account fields used by live billing so plan access, credits, and role-specific surfaces can be tested together.
            </p>
          </div>
          <div className="space-y-4 px-6 py-6">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-300">
              <p className="font-semibold text-slate-900 dark:text-slate-100">Cancel this plan</p>
              <p className="mt-1">
                Your account will move back to the free plan. Existing history stays available, while paid credits and paid access stop following the same downgrade path as production billing.
              </p>
            </div>
            {error && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                {error}
              </div>
            )}
            <button
              type="button"
              onClick={handleCancel}
              disabled={cancelling}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-wait disabled:opacity-70"
            >
              {cancelling && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {cancelling ? 'Updating subscription...' : 'Cancel subscription'}
            </button>
            <button
              type="button"
              onClick={() => window.location.assign(billingPath)}
              disabled={cancelling}
              className="w-full rounded-lg px-4 py-2 text-sm font-medium text-slate-500 transition hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:text-slate-300"
            >
              Keep current plan
            </button>
            <p className="pt-1 text-center text-xs leading-5 text-slate-500 dark:text-slate-400">
              Secure production billing is handled by Stripe when live billing keys are configured.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SimulatedManagePage;
