
import React, { useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { AppSession as Session } from '../lib/data';
import type { UserProfile } from '../types';
import { hasBusinessPortalAccess } from '../lib/access/businessAccess';
import {
  DEFAULT_BUSINESS_ENTRY_PLAN,
  decideBusinessPortalAction,
  requiresBusinessPlanPaymentConfirmation,
} from '../lib/access/businessEntryDecisions';
import BusinessSignInModal from './business/BusinessSignInModal';
import BusinessSignUpModal from './business/BusinessSignUpModal';
import BusinessForgotPasswordModal from './business/BusinessForgotPasswordModal';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import PlanChangeConfirmDialog from './billing/PlanChangeConfirmDialog';
import type { PortalPage } from './employer/EmployerPortal';
import { businessPlanDefs, type BusinessPlanId } from './business/businessPlans';
import {
  employerAddOnLocalizationKeys,
  isEmployerAddOnPlan,
  resolvePricingIntent,
  searchWithoutParams,
  type EmployerPricingPlanKey,
  type EmployerPricingSelection,
} from '../lib/pricingIntent';
import { ArrowRight, BookmarkCheck, BriefcaseBusiness, CheckCircle2, Globe2, PlusCircle, SlidersHorizontal, Users } from 'lucide-react';

interface BusinessPageProps {
  session: Session | null;
  profile: UserProfile | null;
  onSelectBusinessPlan: (planKey: string) => void;
  t: (key: string) => string;
  onBack: () => void;
  // Optional: enter the hiring portal at a specific page
  onEnterPortal?: (page: PortalPage) => void;
  refreshProfile?: () => Promise<void>;
  // When true, Firebase has restored the persisted session (or confirmed no session).
  // When false, the session is still being restored — auth-modal params must wait.
  // When undefined (prop not wired), hydration guard is skipped (legacy behaviour).
  authHydrated?: boolean;
}

type ModalState = 'none' | 'signin' | 'signup' | 'forgot' | 'business_access' | 'confirm_plan' | 'pricing_unavailable';

const BusinessPage: React.FC<BusinessPageProps> = ({
  session,
  profile,
  onSelectBusinessPlan,
  t,
  onBack,
  onEnterPortal,
  refreshProfile,
  authHydrated,
}) => {
  const pricingRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [modal, setModal] = React.useState<ModalState>('none');
  const [signupPlan, setSignupPlan] = React.useState<BusinessPlanId>('starter');
  const [accessPromptPlan, setAccessPromptPlan] = React.useState<BusinessPlanId | null>(null);
  const [activePricingIntent, setActivePricingIntent] = React.useState<EmployerPricingSelection | null>(null);
  const pricingIntentHandledRef = React.useRef<string | null>(null);
  const canEnterBusinessPortal = hasBusinessPortalAccess(profile?.role, profile?.subscription_status);
  const selectedPricingPlanKey: EmployerPricingPlanKey = activePricingIntent?.planKey ?? signupPlan;
  const selectedBusinessPlan = businessPlanDefs.find((plan) => plan.id === selectedPricingPlanKey) ?? null;
  const selectedAddOnKeys = isEmployerAddOnPlan(selectedPricingPlanKey)
    ? employerAddOnLocalizationKeys(selectedPricingPlanKey)
    : null;
  const selectedPlanLabel = selectedBusinessPlan
    ? t(selectedBusinessPlan.nameKey)
    : selectedAddOnKeys
      ? t(selectedAddOnKeys.nameKey)
      : selectedPricingPlanKey;
  const selectedPlanPriceLabel = selectedBusinessPlan
    ? `$${selectedBusinessPlan.price}${t('site_pricing_per_month')}`
    : selectedAddOnKeys
      ? `${t(selectedAddOnKeys.priceKey)} ${t('site_pricing_currency')} · ${t(selectedAddOnKeys.descriptionKey)}`
      : selectedPricingPlanKey;

  const handlePortalAction = React.useCallback((page: PortalPage) => {
    const decision = decideBusinessPortalAction({
      hasSession: Boolean(session),
      canEnterBusinessPortal,
      hasPortalHandler: Boolean(onEnterPortal),
    });

    switch (decision) {
      case 'enter_portal':
        onEnterPortal?.(page);
        break;
      case 'go_back':
        onBack();
        break;
      case 'open_signup':
        setSignupPlan(DEFAULT_BUSINESS_ENTRY_PLAN);
        setAccessPromptPlan(null);
        setModal('signup');
        break;
      case 'open_business_access_prompt':
        setSignupPlan(DEFAULT_BUSINESS_ENTRY_PLAN);
        setAccessPromptPlan(null);
        setModal('business_access');
        break;
    }
  }, [canEnterBusinessPortal, onBack, onEnterPortal, session]);

  const handlePostJob = () => handlePortalAction('post-job');

  const handleDiscoverTalent = () => handlePortalAction('talent-pool');

  const handleViewPricing = () => {
    pricingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handlePlanCta = (planId: BusinessPlanId) => {
    if (!session) {
      setSignupPlan(planId);
      setModal('signup');
      return;
    }

    if (canEnterBusinessPortal && onEnterPortal) {
      onEnterPortal('billing');
      return;
    }

    setSignupPlan(planId);
    setAccessPromptPlan(planId);
    setModal('business_access');
  };

  const featureCards = [
    {
      titleKey: 'business_page_feature_ai_title',
      descKey: 'business_page_feature_ai_desc',
      Icon: CheckCircle2,
    },
    {
      titleKey: 'business_page_feature_engaged_title',
      descKey: 'business_page_feature_engaged_desc',
      Icon: Users,
    },
    {
      titleKey: 'business_page_feature_simple_title',
      descKey: 'business_page_feature_simple_desc',
      Icon: PlusCircle,
    },
    {
      titleKey: 'business_page_feature_diverse_title',
      descKey: 'business_page_feature_diverse_desc',
      Icon: Globe2,
    },
  ] as const;

  const workflowCards = [
    {
      titleKey: 'business_page_workflow_post_title',
      descKey: 'business_page_workflow_post_desc',
      actionKey: 'business_page_workflow_post_action',
      Icon: BriefcaseBusiness,
      onClick: handlePostJob,
    },
    {
      titleKey: 'business_page_workflow_screen_title',
      descKey: 'business_page_workflow_screen_desc',
      actionKey: 'business_page_workflow_screen_action',
      Icon: SlidersHorizontal,
      onClick: handleDiscoverTalent,
    },
    {
      titleKey: 'business_page_workflow_shortlist_title',
      descKey: 'business_page_workflow_shortlist_desc',
      actionKey: 'business_page_workflow_shortlist_action',
      Icon: BookmarkCheck,
      onClick: handleDiscoverTalent,
    },
  ] as const;

  const consumePricingIntent = React.useCallback(() => {
    setActivePricingIntent(null);
    pricingIntentHandledRef.current = null;
    navigate(
      {
        pathname: location.pathname,
        search: searchWithoutParams(location.search, ['pricing_intent', 'auth']),
        hash: location.hash,
      },
      { replace: true },
    );
  }, [location.pathname, location.search, location.hash, navigate]);

  const restorePricingIntent = React.useCallback(() => {
    if (!activePricingIntent) return;
    const params = new URLSearchParams(location.search);
    params.set('pricing_intent', activePricingIntent.source);
    navigate(
      {
        pathname: location.pathname,
        search: `?${params.toString()}`,
        hash: location.hash,
      },
      { replace: true },
    );
  }, [activePricingIntent, location.pathname, location.search, location.hash, navigate]);

  // Honour ?auth=signin|signup, ?start=post-job and public pricing selections.
  // Reads react-router's reactive
  // location.search and depends on it, so clicking the header "Sign In" link AGAIN
  // while already mounted on /portal re-opens the modal. (Previously a one-shot ref
  // + non-reactive window.location.search meant the second click did nothing —
  // the same bug we fixed for /workspace?auth=signin in CareerApp.)
  //
  // Hydration guard: if authHydrated is explicitly false (CareerApp has wired the
  // prop but Firebase has not yet restored the persisted session), bail out WITHOUT
  // stripping the query. The effect will re-run once authHydrated flips to true, at
  // which point the session state is accurate and the params are still present.
  // If authHydrated is undefined (prop not wired), the guard is skipped to preserve
  // legacy behaviour for any consumer that does not pass the prop.
  React.useEffect(() => {
    if (authHydrated === false) return;

    const params = new URLSearchParams(location.search);
    const auth = params.get('auth');
    const start = params.get('start');
    const pricingResolution = resolvePricingIntent(location.search);

    if (
      pricingResolution.state === 'invalid'
      || (pricingResolution.state === 'valid' && pricingResolution.selection.audience !== 'employer')
    ) {
      const fingerprint = `rejected:${pricingResolution.source}`;
      if (pricingIntentHandledRef.current === fingerprint) return;
      pricingIntentHandledRef.current = fingerprint;
      setActivePricingIntent(null);
      navigate(
        {
          pathname: location.pathname,
          search: searchWithoutParams(location.search, ['pricing_intent']),
          hash: location.hash,
        },
        { replace: true },
      );
      return;
    }

    if (pricingResolution.state === 'valid') {
      const selection = pricingResolution.selection;
      // The audience check above narrows this at runtime; keep the branch
      // explicit so a future pricing kind fails closed instead of guessing.
      if (selection.audience !== 'employer') return;
      const fingerprint = `${session?.user?.id ?? 'signed-out'}:${profile?.role ?? 'profile-loading'}:${selection.source}`;
      if (pricingIntentHandledRef.current === fingerprint) return;

      if (session && !profile) return;
      if (session && profile?.role !== 'employer') {
        pricingIntentHandledRef.current = fingerprint;
        setActivePricingIntent(null);
        navigate(
          {
            pathname: location.pathname,
            search: searchWithoutParams(location.search, ['pricing_intent', 'auth']),
            hash: location.hash,
          },
          { replace: true },
        );
        return;
      }

      pricingIntentHandledRef.current = fingerprint;
      setActivePricingIntent(selection);
      if (selection.billingMode === 'unavailable_one_time') {
        setModal('pricing_unavailable');
        return;
      }
      setSignupPlan(selection.planKey);
      if (!session) {
        setModal(auth === 'signin' ? 'signin' : auth === 'forgot' ? 'forgot' : 'signup');
      } else {
        setModal('confirm_plan');
      }
      // Keep the token in the URL until the user submits, confirms or dismisses.
      return;
    }

    pricingIntentHandledRef.current = null;
    if (!auth && !start) return;

    // Only open auth modals when the user is NOT already signed in; a signed-in
    // user deep-linking with ?auth=signin (e.g. from a stale email link) should
    // not be interrupted with a redundant modal.
    if (!session) {
      if (auth === 'signin') setModal('signin');
      if (auth === 'signup') setModal('signup');
    }

    if (start === 'post-job') {
      handlePortalAction('post-job');
    }

    // Remove only the parameters handled above; unrelated campaign/deep-link
    // state must survive the modal or portal action.
    navigate(
      {
        pathname: location.pathname,
        search: searchWithoutParams(location.search, ['auth', 'start']),
        hash: location.hash,
      },
      { replace: true },
    );
  }, [
    location.search,
    location.pathname,
    location.hash,
    navigate,
    authHydrated,
    handlePortalAction,
    session,
    profile,
  ]);

  return (
    <div className="min-h-screen overflow-hidden bg-gray-50 dark:bg-gray-950">
      {/* Hero */}
      <main className="mx-auto max-w-[1088px] px-4 py-14 sm:px-6 sm:py-16 md:py-24">
        <h1 className="max-w-5xl break-words text-3xl font-bold leading-tight text-gray-900 dark:text-gray-100 sm:text-4xl md:text-6xl">
          {t('business_page_hero_title_part1')}{' '}
          <span className="text-[#1D4ED8]">{t('business_page_hero_title_part2')}</span>{t('business_page_hero_title_part3')}
        </h1>
        <p className="mt-6 max-w-3xl text-base leading-7 text-gray-600 dark:text-gray-300 sm:text-lg">
          {t('business_page_hero_subtitle')}
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            onClick={handlePostJob}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[#1D4ED8] px-6 py-3 text-center font-semibold text-white shadow-sm transition hover:bg-[#1e40af] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/40 sm:w-auto"
          >
            {t('employer_dashboard_post_job_button')}
          </button>
          <button
            type="button"
            onClick={handleDiscoverTalent}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-gray-300 bg-white px-6 py-3 text-center font-semibold text-gray-700 transition hover:border-gray-400 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/30 dark:border-slate-600 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-slate-500 dark:hover:bg-slate-800 sm:w-auto"
          >
            {t('employer_dashboard_tab_discover')}
          </button>
          <button
            type="button"
            onClick={handleViewPricing}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-transparent px-6 py-3 text-center font-semibold text-[#1D4ED8] transition hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/30 dark:text-blue-300 dark:hover:bg-blue-950/30 sm:w-auto"
          >
            {t('business_hero_view_pricing_button')}
          </button>
        </div>
      </main>

      <section className="border-y border-gray-200 bg-white py-12 dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto max-w-[1088px] px-4 sm:px-6">
          <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-wide text-[#1D4ED8] dark:text-blue-300">
                {t('business_page_workflow_eyebrow')}
              </p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 sm:text-3xl">
                {t('business_page_workflow_title')}
              </h2>
              <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-gray-300">
                {t('business_page_workflow_subtitle')}
              </p>
            </div>
            <p className="max-w-sm rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-medium leading-5 text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200">
              {t('business_page_workflow_note')}
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {workflowCards.map(({ titleKey, descKey, actionKey, Icon, onClick }, index) => (
              <button
                key={titleKey}
                type="button"
                onClick={onClick}
                className="group flex min-h-[164px] flex-col rounded-xl border border-gray-200 bg-gray-50 p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-200 hover:bg-white hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/30 dark:border-slate-700 dark:bg-slate-800/80 dark:hover:border-blue-800 dark:hover:bg-slate-800"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-[#1D4ED8] shadow-sm dark:bg-slate-900 dark:text-blue-300">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs font-semibold text-gray-500 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-400">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                </div>
                <h3 className="mt-4 text-base font-bold leading-tight text-gray-900 dark:text-gray-100">
                  {t(titleKey)}
                </h3>
                <p className="mt-2 flex-1 text-sm leading-6 text-gray-600 dark:text-gray-400">
                  {t(descKey)}
                </p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#1D4ED8] dark:text-blue-300">
                  {t(actionKey)}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Features — "Why Post With Us?" */}
      <section className="py-16">
        <div className="max-w-[1088px] mx-auto px-6">
          <h2 className="text-center text-3xl font-bold mb-4 text-gray-900 dark:text-gray-100">
            {t('business_page_features_title')}
          </h2>
          <p className="text-center mb-12 max-w-2xl mx-auto text-gray-600 dark:text-gray-300">
            {t('business_page_features_subtitle')}
          </p>

          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {featureCards.map(({ titleKey, descKey, Icon }) => (
              <div key={titleKey} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200/80 transition hover:-translate-y-0.5 hover:shadow-md dark:bg-slate-800 dark:ring-slate-700 sm:p-6">
                <div className="w-12 h-12 rounded-md flex items-center justify-center mb-4 bg-blue-100 dark:bg-blue-900/40">
                  <Icon className="h-6 w-6 text-[#1D4ED8]" aria-hidden="true" />
                </div>
                <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-gray-100">{t(titleKey)}</h3>
                <p className="text-sm leading-6 text-gray-600 dark:text-gray-400">{t(descKey)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section
        id="pricing"
        ref={pricingRef}
        className="py-20 bg-gray-50 dark:bg-gray-950"
      >
        <div className="max-w-[1088px] mx-auto px-6">
          <h2 className="text-center text-4xl font-bold mb-4 text-gray-900 dark:text-gray-100">
            {t('business_page_pricing_title')}
          </h2>
          <p className="text-center mb-14 max-w-2xl mx-auto text-gray-500 dark:text-gray-400">
            {t('business_page_pricing_subtitle')}
          </p>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch">
            {businessPlanDefs.map((plan) => (
              <div
                key={plan.id}
                className={`relative rounded-2xl p-7 flex flex-col ${
                  plan.featured
                    ? 'bg-[#0F172A] text-white shadow-2xl ring-2 ring-[#1D4ED8]'
                    : 'bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 shadow-sm dark:border dark:border-slate-700'
                }`}
              >
                {plan.highlight && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <span className="bg-[#1D4ED8] text-white text-xs font-bold px-4 py-1.5 rounded-full uppercase tracking-wide whitespace-nowrap">
                      {t('business_page_pricing_badge_popular')}
                    </span>
                  </div>
                )}

                <p className={`font-semibold mb-3 ${plan.featured ? 'text-gray-300' : 'text-gray-700 dark:text-gray-300'}`}>
                  {t(plan.nameKey)}
                </p>

                <div className="flex items-end gap-1 mb-1">
                  <span className={`text-5xl font-bold leading-none ${plan.featured ? 'text-white' : 'text-gray-900 dark:text-gray-100'}`}>
                    ${plan.price}
                  </span>
                  <span className={`mb-1 ${plan.featured ? 'text-gray-400' : 'text-gray-500 dark:text-gray-400'}`}>
                    {t('site_pricing_per_month')}
                  </span>
                </div>

                <div className={`h-px my-5 ${plan.featured ? 'bg-gray-700' : 'bg-gray-100 dark:bg-slate-700'}`} />

                <ul className="flex flex-col gap-3 flex-1 mb-8">
                  {plan.featureKeys.map((featureKey) => (
                    <li key={featureKey} className="flex items-start gap-2.5">
                      <CheckCircle2
                        className={`w-5 h-5 mt-0.5 flex-shrink-0 ${plan.featured ? 'text-[#60A5FA]' : 'text-[#1D4ED8]'}`}
                        strokeWidth={2.5}
                        aria-hidden="true"
                      />
                      <span className={`text-sm ${plan.featured ? 'text-gray-300' : 'text-gray-600 dark:text-gray-300'}`}>
                        {t(featureKey)}
                      </span>
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  onClick={() => handlePlanCta(plan.id)}
                  className={`min-h-11 w-full rounded-lg py-2.5 font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/40 ${
                    plan.featured
                      ? 'bg-[#1D4ED8] text-white hover:bg-[#1e40af]'
                      : 'border border-[#1D4ED8] text-[#1D4ED8] hover:bg-[#1D4ED8] hover:text-white dark:hover:text-white'
                  }`}
                >
                  {t('business_page_plan_cta')}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Auth modals — wired to real Firebase auth via lib/data */}
      <BusinessSignInModal
        isOpen={modal === 'signin'}
        onOpenChange={(open) => {
          setModal(open ? 'signin' : 'none');
          if (!open && activePricingIntent) consumePricingIntent();
        }}
        onSwitchToSignUp={() => setModal('signup')}
        onSwitchToForgotPassword={() => setModal('forgot')}
        t={t}
      />
      <BusinessSignUpModal
        isOpen={modal === 'signup'}
        onOpenChange={(open) => {
          setModal(open ? 'signup' : 'none');
          if (!open && activePricingIntent) consumePricingIntent();
        }}
        onSwitchToSignIn={() => setModal('signin')}
        onSignedUp={refreshProfile}
        initialPlan={signupPlan}
        onPricingIntentHandled={activePricingIntent ? consumePricingIntent : undefined}
        onPricingIntentRestore={activePricingIntent ? restorePricingIntent : undefined}
        t={t}
      />
      <BusinessForgotPasswordModal
        isOpen={modal === 'forgot'}
        onOpenChange={(open) => {
          setModal(open ? 'forgot' : 'none');
          if (!open && activePricingIntent) consumePricingIntent();
        }}
        onSwitchToSignIn={() => setModal('signin')}
        t={t}
      />
      <Dialog
        open={modal === 'business_access'}
        onOpenChange={(open) => {
          setModal(open ? 'business_access' : 'none');
          if (!open) setAccessPromptPlan(null);
        }}
      >
        <DialogContent maxWidth="sm" className="p-6 sm:p-7">
          <DialogHeader className="text-left">
            <DialogTitle>{t('site_cta_enter_portal')}</DialogTitle>
            <DialogDescription className="not-sr-only pt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
              {t('site_pricing_business_upsell_banner')}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => {
                setAccessPromptPlan(null);
                setModal('none');
              }}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/40 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {t('dashboard_cancel_update')}
            </button>
            <button
              type="button"
              onClick={() => {
                if (accessPromptPlan) {
                  if (!requiresBusinessPlanPaymentConfirmation(accessPromptPlan)) {
                    setSignupPlan(DEFAULT_BUSINESS_ENTRY_PLAN);
                    setAccessPromptPlan(null);
                    setModal('none');
                    onSelectBusinessPlan(accessPromptPlan);
                    return;
                  }
                  setSignupPlan(accessPromptPlan);
                  setAccessPromptPlan(null);
                  setModal('confirm_plan');
                  return;
                }
                setModal('none');
                onSelectBusinessPlan(DEFAULT_BUSINESS_ENTRY_PLAN);
              }}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#1D4ED8] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1e40af] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/40"
            >
              {t('business_page_plan_cta')}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={modal === 'pricing_unavailable'}
        onOpenChange={(open) => {
          setModal(open ? 'pricing_unavailable' : 'none');
          if (!open) consumePricingIntent();
        }}
      >
        <DialogContent maxWidth="sm" className="p-6 sm:p-7">
          <DialogHeader className="text-left">
            <DialogTitle>{selectedPlanLabel}</DialogTitle>
            <DialogDescription className="pt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
              {t('tool_runner_unavailable_title')}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900 dark:border-amber-800/50 dark:bg-amber-900/30 dark:text-amber-100">
            <p className="font-semibold">{selectedPlanPriceLabel}</p>
            <p className="mt-1">{t('account_billing_portal_unavailable')}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setModal('none');
              consumePricingIntent();
            }}
            className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/40 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {t('tool_agile_coach_close_button')}
          </button>
        </DialogContent>
      </Dialog>
      <PlanChangeConfirmDialog
        open={modal === 'confirm_plan'}
        onOpenChange={(open) => {
          setModal(open ? 'confirm_plan' : 'none');
          if (!open && activePricingIntent) consumePricingIntent();
        }}
        title={t('business_page_pricing_title')}
        planLabel={`${selectedPlanLabel} · ${selectedPlanPriceLabel}`}
        description={t('site_pricing_business_upsell_banner')}
        cancelLabel={t('dashboard_cancel_update')}
        confirmLabel={t('business_page_plan_cta')}
        loadingLabel={t('portal_billing_updating')}
        onCancel={() => {
          setModal('none');
          if (activePricingIntent) consumePricingIntent();
        }}
        onConfirm={() => {
          const planId = signupPlan;
          setModal('none');
          if (activePricingIntent) consumePricingIntent();
          onSelectBusinessPlan(planId);
        }}
      />
    </div>
  );
};

export default BusinessPage;
