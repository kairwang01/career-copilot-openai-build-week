import React, { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, CreditCard, Loader2, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useSession } from '../../contexts/SessionContext';
import { confirmSimulatedCheckout } from '../../services/subscriptionClient';
import { createSecureRandomId } from '../../lib/secureRandomId';

/**
 * Sandbox billing checkout.
 *
 * createCheckoutSession redirects here when BILLING_SIMULATION is enabled. Confirming
 * the plan calls the same server entitlement path as the Stripe webhook, then redirects
 * to the same success URL. Production checkout still returns a Stripe-hosted URL.
 */

// Display-only amounts; production billing uses Stripe Price configuration.
const PLAN_LABELS: Record<string, { name: string; amount: string; cadence: string }> = {
  essentials: { name: 'Basic', amount: '$19.00 CAD', cadence: 'per month' },
  accelerator: { name: 'Pro', amount: '$39.00 CAD', cadence: 'per month' },
  executive: { name: 'Premium', amount: '$79.00 CAD', cadence: 'per month' },
  starter: { name: 'Business Starter', amount: '$79.00 CAD', cadence: 'per month' },
  growth: { name: 'Business Growth', amount: '$199.00 CAD', cadence: 'per month' },
  pro: { name: 'Business Pro', amount: '$499.00 CAD', cadence: 'per month' },
};

const SimulatedCheckoutPage: React.FC = () => {
  const [params] = useSearchParams();
  const { session, ready, profile } = useSession();
  const plan = params.get('plan') ?? '';
  const audience = params.get('audience') === 'business' ? 'business' : 'candidate';
  const info = PLAN_LABELS[plan];

  const [card, setCard] = useState('4242 4242 4242 4242');
  const [exp, setExp] = useState('12 / 34');
  const [cvc, setCvc] = useState('123');
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const successUrl = audience === 'business' ? '/portal?checkout=success' : '/workspace/billing?checkout=success';
  const cancelUrl = audience === 'business' ? '/pricing?audience=employer&checkout=cancel' : '/pricing?checkout=cancel';
  const workspaceUrl = audience === 'business' ? '/portal' : '/workspace';

  // Stable per-visit session id: the server dedupes credit-pack confirms on it,
  // so a failed-then-retried Pay click cannot grant the same pack twice.
  const sessionIdRef = useRef(createSecureRandomId('sim_page'));

  const handlePay = async () => {
    if (paying) return;
    setPaying(true);
    setError(null);
    try {
      await confirmSimulatedCheckout(plan, sessionIdRef.current);
      window.location.assign(successUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We could not confirm this plan. Please try again.');
      setPaying(false);
    }
  };

  if (!plan || !info) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-base font-semibold text-slate-900 dark:text-slate-50">We could not find that plan.</p>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Return to pricing and choose a plan again.</p>
          <a className="mt-5 inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700" href="/pricing">
            Back to pricing
          </a>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <Loader2 className="mx-auto h-9 w-9 animate-spin text-blue-600" aria-hidden="true" />
          <p className="mt-4 text-base font-semibold text-slate-900 dark:text-slate-50">Preparing checkout...</p>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">We are checking your account before showing the plan confirmation.</p>
        </div>
      </div>
    );
  }

  if (ready && !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <LockKeyhole className="mx-auto h-9 w-9 text-blue-600" aria-hidden="true" />
          <p className="mt-4 text-base font-semibold text-slate-900 dark:text-slate-50">Sign in to continue checkout.</p>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Your selected plan will be connected to your account.</p>
          <a className="mt-5 inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700" href="/workspace?auth=signin">
            Sign in
          </a>
        </div>
      </div>
    );
  }

  // Guard the back-button-after-pay path: if this plan is already active, don't show a
  // live Pay button that would re-run confirmSimulatedCheckout.
  if (ready && session && profile?.subscription_status === plan) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" aria-hidden="true" />
          <p className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-50">You're already on {info.name}.</p>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Your workspace already has this plan active.</p>
          <a className="mt-5 inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700" href={workspaceUrl}>
            Go to workspace
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="mx-auto w-full max-w-5xl">
        <a
          href={cancelUrl}
          className="mb-5 inline-flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-medium text-slate-600 transition hover:text-slate-950 dark:text-slate-300 dark:hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to pricing
        </a>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Sandbox billing
            </div>
            <h1 className="mt-5 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
              Review your {info.name} plan
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              This local checkout confirms the same account entitlement used by the live billing flow, without charging a card.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                ['Plan', info.name],
                ['Amount', `${info.amount} ${info.cadence}`],
                ['Account', audience === 'business' ? 'Employer workspace' : 'Candidate workspace'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/70">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{value}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
              <p className="font-semibold">No card is charged in this environment.</p>
              <p className="mt-1 text-emerald-800 dark:text-emerald-300">
                Confirming updates credits and plan access so the rest of the product can be tested end to end.
              </p>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-100 px-6 py-5 dark:border-slate-800">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Due now</p>
              <p className="mt-1 text-3xl font-bold text-slate-950 dark:text-slate-50">
                {info.amount} <span className="text-base font-normal text-slate-500">{info.cadence}</span>
              </p>
            </div>

            <div className="space-y-4 px-6 py-6">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/70">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  <CreditCard className="h-4 w-4 text-blue-600" aria-hidden="true" />
                  Sandbox payment method
                </div>
                <label className="mt-4 block">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Card number</span>
                  <input
                    value={card}
                    onChange={(e) => setCard(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    inputMode="numeric"
                    autoComplete="cc-number"
                  />
                </label>
                <div className="mt-3 flex gap-3">
                  <label className="flex-1">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Expiry</span>
                    <input
                      value={exp}
                      onChange={(e) => setExp(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      autoComplete="cc-exp"
                    />
                  </label>
                  <label className="flex-1">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400">CVC</span>
                    <input
                      value={cvc}
                      onChange={(e) => setCvc(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      autoComplete="cc-csc"
                    />
                  </label>
                </div>
              </div>

              {error && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={handlePay}
                disabled={paying}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-wait disabled:opacity-70"
              >
                {paying && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {paying ? 'Confirming plan...' : `Confirm ${info.name}`}
              </button>
              <button
                type="button"
                onClick={() => window.location.assign(cancelUrl)}
                disabled={paying}
                className="w-full rounded-lg px-4 py-2 text-sm font-medium text-slate-500 transition hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:text-slate-300"
              >
                Cancel
              </button>
              <p className="pt-1 text-center text-xs leading-5 text-slate-500 dark:text-slate-400">
                Secure production billing is handled by Stripe when live billing keys are configured.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default SimulatedCheckoutPage;
