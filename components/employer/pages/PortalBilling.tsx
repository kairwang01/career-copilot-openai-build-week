import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  Briefcase,
  Check,
  CreditCard,
  FileText,
  Loader2,
  Zap,
} from 'lucide-react';
import type { UserProfile } from '../../../types';
import { createBillingPortalSession } from '../../../services/subscriptionClient';
import { PortalTopBar } from '../PortalTopBar';
import PlanChangeConfirmDialog from '../../billing/PlanChangeConfirmDialog';

interface PortalBillingProps {
  profile: UserProfile;
  darkMode: boolean;
  activeJobs: number;
  onSelectPlan: (planKey: string) => void;
  planSaving?: boolean;
  t: (key: string) => string;
}

type PlanKey = 'free' | 'starter' | 'growth' | 'pro';
type KnownPlanKey = PlanKey | 'single_post' | 'job_pack';

interface PlanDisplay {
  key: KnownPlanKey;
  price: string;
  period: string;
  jobLimit: number;
  rank: number;
  nameKey: string;
}

const AVAILABLE_PLANS: PlanDisplay[] = [
  { key: 'free', price: '$0', period: '/month', jobLimit: 3, rank: 0, nameKey: 'portal_plan_free_name' },
  { key: 'starter', price: '$79', period: '/month', jobLimit: 8, rank: 2, nameKey: 'portal_plan_starter_name' },
  { key: 'growth', price: '$199', period: '/month', jobLimit: 20, rank: 3, nameKey: 'portal_plan_growth_name' },
  { key: 'pro', price: '$499', period: '/month', jobLimit: 100, rank: 4, nameKey: 'portal_plan_pro_name' },
];

const LEGACY_PLAN_DISPLAY: Record<'single_post' | 'job_pack', PlanDisplay> = {
  single_post: {
    key: 'single_post',
    price: '$299',
    period: '',
    jobLimit: 1,
    rank: 1,
    nameKey: 'plan_single_post_name',
  },
  job_pack: {
    key: 'job_pack',
    price: '$999',
    period: '',
    jobLimit: 5,
    rank: 2,
    nameKey: 'plan_job_pack_name',
  },
};

const PLAN_FEATURE_SLOTS = [1, 2, 3, 4] as const;

function formatTranslation(
  template: string,
  values: Record<string, string | number>,
): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

function stripPendingPrefix(status: string): string {
  if (status.startsWith('pending_biz_')) return status.replace('pending_biz_', '');
  if (status.startsWith('pending_')) return status.replace('pending_', '');
  return status;
}

function resolvePlanDisplay(rawStatus: string): PlanDisplay {
  const planKey = stripPendingPrefix(rawStatus);
  const availablePlan = AVAILABLE_PLANS.find((plan) => plan.key === planKey);
  if (availablePlan) return availablePlan;
  if (planKey === 'single_post' || planKey === 'job_pack') {
    return LEGACY_PLAN_DISPLAY[planKey];
  }
  return AVAILABLE_PLANS[0];
}

function getUsageTone(activeJobs: number, planLimit: number, darkMode: boolean): string {
  const usagePct = planLimit > 0 ? activeJobs / planLimit : 0;
  if (usagePct > 1) return darkMode ? 'text-red-300' : 'text-red-700';
  if (usagePct >= 0.8) return darkMode ? 'text-amber-300' : 'text-amber-700';
  return darkMode ? 'text-emerald-300' : 'text-emerald-700';
}

function getUsageBarClass(activeJobs: number, planLimit: number): string {
  const usagePct = planLimit > 0 ? activeJobs / planLimit : 0;
  if (usagePct > 1) return 'bg-red-500';
  if (usagePct >= 0.8) return 'bg-amber-500';
  return 'bg-[#1d4ed8]';
}

export function PortalBilling({
  profile,
  darkMode,
  activeJobs,
  onSelectPlan,
  planSaving = false,
  t,
}: PortalBillingProps) {
  const dm = darkMode;
  const [requestedPlanKey, setRequestedPlanKey] = useState<string | null>(null);
  const [planToConfirm, setPlanToConfirm] = useState<PlanDisplay | null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const plansRef = useRef<HTMLElement>(null);
  const currentStatus = profile.subscription_status || 'free';
  const currentPlanKey = stripPendingPrefix(currentStatus);
  const currentPlan = resolvePlanDisplay(currentStatus);
  const isPending = currentStatus.startsWith('pending');
  const isActive = currentStatus !== 'free' && !isPending;
  const openingPortalRef = useRef(false);
  const isKnownAvailablePlan = AVAILABLE_PLANS.some((plan) => plan.key === currentPlanKey);
  const planLimit = currentPlan.jobLimit;
  const displayUsedPct = planLimit > 0 ? Math.min(100, Math.round((activeJobs / planLimit) * 100)) : 0;
  const remainingPosts = Math.max(0, planLimit - activeJobs);
  const overLimitCount = Math.max(0, activeJobs - planLimit);
  const usageTone = getUsageTone(activeJobs, planLimit, dm);
  const usageBar = getUsageBarClass(activeJobs, planLimit);

  useEffect(() => {
    if (!planSaving) setRequestedPlanKey(null);
  }, [planSaving]);

  const handleSelectPlan = (plan: PlanDisplay) => {
    if (planSaving || plan.key === currentPlanKey) return;
    setPortalError(null);
    setPlanToConfirm(plan);
  };

  const handleConfirmPlanChange = () => {
    if (!planToConfirm || planSaving) return;
    const planKey = planToConfirm.key;
    setRequestedPlanKey(planKey);
    setPlanToConfirm(null);
    onSelectPlan(planKey);
  };

  const handleManageBilling = async () => {
    if (!isActive) {
      setPortalError(null);
      plansRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (openingPortal || openingPortalRef.current) return;
    openingPortalRef.current = true;
    setOpeningPortal(true);
    setPortalError(null);
    try {
      const { url } = await createBillingPortalSession();
      window.location.assign(url);
    } catch {
      openingPortalRef.current = false;
      setPortalError(t('portal_billing_portal_error'));
      setOpeningPortal(false);
    }
  };

  const card = `rounded-xl border ${dm ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'}`;
  const text = dm ? 'text-white' : 'text-gray-900';
  const muted = dm ? 'text-gray-400' : 'text-gray-500';
  const divider = dm ? 'border-gray-700' : 'border-gray-200';
  const sectionLabel = `text-sm font-semibold uppercase tracking-widest ${muted}`;
  const currentPlanName = t(currentPlan.nameKey);
  const usageMessage = overLimitCount > 0
    ? formatTranslation(t('portal_billing_usage_over'), { n: overLimitCount })
    : remainingPosts === 0
      ? t('portal_billing_usage_full')
      : formatTranslation(t('portal_billing_usage_ok'), { n: remainingPosts });

  return (
    <>
      <PortalTopBar title={t('portal_nav_billing')} darkMode={dm} />
      <div className="mx-auto max-w-[1088px] space-y-6 p-4 sm:p-6 lg:p-8 animate-view-fade">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className={`text-2xl font-bold ${text}`}>{t('portal_nav_billing')}</h1>
            <p className={`mt-2 max-w-2xl text-sm leading-6 ${muted}`}>
              {t('portal_billing_page_desc')}
            </p>
          </div>
          <button
            type="button"
            onClick={handleManageBilling}
            disabled={openingPortal}
            className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400/40 ${
              dm ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {openingPortal ? (
              <Loader2 size={15} className="animate-spin" aria-hidden="true" />
            ) : (
              <CreditCard size={15} />
            )}
            {openingPortal
              ? t('portal_billing_opening_portal')
              : isActive
                ? t('portal_billing_manage')
                : t('portal_billing_available_plans')}
            {!isActive && !openingPortal && <ArrowUpRight size={15} aria-hidden="true" />}
          </button>
        </div>

        <section className={`${card} overflow-hidden`}>
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="p-5 sm:p-6">
              <p className={sectionLabel}>{t('portal_billing_current_plan')}</p>
              <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-4">
                  <div className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${
                    dm ? 'bg-blue-950/40' : 'bg-blue-50'
                  }`}>
                    <Zap size={19} className="text-[#1d4ed8]" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className={`text-xl font-bold ${text}`}>
                        {formatTranslation(t('portal_billing_plan_title'), { name: currentPlanName })}
                      </h2>
                      {isActive && (
                        <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-[#1d4ed8] dark:bg-blue-950/50 dark:text-blue-300">
                          {t('portal_billing_active')}
                        </span>
                      )}
                      {isPending && (
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                          {t('portal_billing_pending')}
                        </span>
                      )}
                    </div>
                    <p className={`mt-1 text-sm ${muted}`}>
                      {currentPlan.price}
                      {currentPlan.period}
                      {isActive && (
                        <>
                          {' '}·{' '}
                          <span className={dm ? 'text-gray-300' : 'text-gray-700'}>
                            {t('portal_billing_billed_monthly')}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                </div>
              </div>

              {isPending && (
                <div className={`mt-5 animate-panel-expand rounded-lg border px-4 py-3 text-sm ${
                  dm
                    ? 'border-amber-800 bg-amber-950/20 text-amber-200'
                    : 'border-amber-200 bg-amber-50 text-amber-800'
                }`}>
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{t('portal_billing_pending_notice')}</span>
                  </div>
                </div>
              )}

              {portalError && (
                <div className={`mt-5 animate-panel-expand rounded-lg border px-4 py-3 text-sm ${
                  dm
                    ? 'border-red-800 bg-red-950/20 text-red-200'
                    : 'border-red-200 bg-red-50 text-red-700'
                }`}>
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{portalError}</span>
                  </div>
                </div>
              )}

              {!isKnownAvailablePlan && currentPlanKey !== 'single_post' && currentPlanKey !== 'job_pack' && (
                <div className={`mt-5 animate-panel-expand rounded-lg border px-4 py-3 text-sm ${
                  dm
                    ? 'border-gray-700 bg-gray-900/50 text-gray-300'
                    : 'border-gray-200 bg-gray-50 text-gray-700'
                }`}>
                  {formatTranslation(t('portal_billing_unrecognized_plan'), { status: currentStatus })}
                </div>
              )}
            </div>

            <div className={`border-t p-5 sm:p-6 lg:border-l lg:border-t-0 ${divider}`}>
              <div className="flex items-center justify-between gap-3">
                <span className={`text-sm font-semibold ${text}`}>{t('portal_billing_posts_used')}</span>
                <span className={`text-sm font-bold ${usageTone}`}>{activeJobs} / {planLimit}</span>
              </div>
              <div className={`mt-3 h-2.5 w-full overflow-hidden rounded-full ${dm ? 'bg-gray-700' : 'bg-gray-100'}`}>
                <div
                  className={`h-full rounded-full transition-all duration-500 ${usageBar}`}
                  style={{ width: `${displayUsedPct}%` }}
                />
              </div>
              <p className={`mt-3 text-sm leading-6 ${usageTone}`}>
                {usageMessage}
              </p>
              <p className={`mt-2 text-xs ${muted}`}>
                {formatTranslation(t('portal_billing_plan_jobs'), { n: planLimit })}
              </p>
            </div>
          </div>
        </section>

        <section ref={plansRef}>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className={sectionLabel}>{t('portal_billing_available_plans')}</p>
              <p className={`mt-1 text-sm ${muted}`}>{t('portal_billing_available_desc')}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {AVAILABLE_PLANS.map((plan) => {
              const isCurrent = plan.key === currentPlanKey;
              const isUpgrade = plan.rank > currentPlan.rank;
              const isRequested = requestedPlanKey === plan.key && planSaving;
              const actionLabel = isRequested
                ? t('portal_billing_updating')
                : isCurrent
                  ? t('portal_billing_current_plan')
                  : isUpgrade
                    ? t('portal_billing_upgrade')
                    : t('portal_billing_switch');

              return (
                <article
                  key={plan.key}
                  className={`flex min-h-[360px] flex-col rounded-xl border p-5 transition-all duration-200 ${
                    isCurrent
                      ? `border-[#1d4ed8] ring-2 ring-[#1d4ed8]/20 ${dm ? 'bg-gray-800' : 'bg-white'}`
                      : dm
                        ? 'border-gray-700 bg-gray-800 hover:border-gray-600 hover:bg-gray-800/80'
                        : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
                  }`}
                >
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <p className={`text-sm font-semibold ${isCurrent ? 'text-[#1d4ed8]' : muted}`}>{t(plan.nameKey)}</p>
                      <div className="mt-2 flex items-baseline gap-1">
                        <span className={`text-2xl font-bold ${text}`}>{plan.price}</span>
                        <span className={`text-sm ${muted}`}>{plan.period}</span>
                      </div>
                    </div>
                    {isCurrent && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-[#1d4ed8] dark:bg-blue-950/50 dark:text-blue-300">
                        {t('portal_billing_selected_plan')}
                      </span>
                    )}
                  </div>

                  <div className={`mb-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                    dm ? 'bg-gray-900/60 text-gray-300' : 'bg-gray-50 text-gray-700'
                  }`}>
                    <Briefcase className="h-4 w-4 text-[#1d4ed8]" aria-hidden="true" />
                    {formatTranslation(t('portal_billing_plan_jobs'), { n: plan.jobLimit })}
                  </div>

                  <ul className="mb-5 flex-1 space-y-2">
                    {PLAN_FEATURE_SLOTS.map((slot) => (
                      <li key={slot} className="flex items-start gap-2">
                        <Check size={13} className="mt-0.5 shrink-0 text-[#1d4ed8]" />
                        <span className={`text-sm leading-5 ${muted}`}>{t(`portal_plan_${plan.key}_f${slot}`)}</span>
                      </li>
                    ))}
                  </ul>

                  <button
                    type="button"
                    onClick={() => handleSelectPlan(plan)}
                    disabled={isCurrent || planSaving}
                    className={`inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400/40 disabled:cursor-not-allowed disabled:opacity-60 ${
                      isCurrent
                        ? 'bg-[#1d4ed8] text-white'
                        : isUpgrade
                          ? 'border border-[#1d4ed8] bg-blue-50 text-[#1d4ed8] hover:bg-blue-100 dark:bg-blue-950/30 dark:text-blue-300 dark:hover:bg-blue-950/50'
                          : dm
                            ? 'border border-gray-600 text-gray-300 hover:bg-gray-700'
                            : 'border border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {isRequested && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                    {actionLabel}
                  </button>
                </article>
              );
            })}
          </div>
        </section>

        <section className={`${card} p-5 sm:p-6`}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className={sectionLabel}>{t('portal_billing_history')}</p>
              <p className={`mt-3 max-w-2xl text-sm leading-6 ${muted}`}>
                {t('portal_billing_history_empty')}
              </p>
            </div>
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${
              dm ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-500'
            }`}>
              <FileText className="h-5 w-5" aria-hidden="true" />
            </div>
          </div>
        </section>
      </div>
      <PlanChangeConfirmDialog
        open={Boolean(planToConfirm)}
        onOpenChange={(open) => {
          if (!open && !planSaving) setPlanToConfirm(null);
        }}
        title={t('portal_billing_available_plans')}
        planLabel={
          planToConfirm
            ? `${t(planToConfirm.nameKey)} · ${planToConfirm.price}${planToConfirm.period}`
            : t('portal_billing_available_desc')
        }
        description={t('portal_billing_available_desc')}
        cancelLabel={t('dashboard_cancel_update')}
        confirmLabel={t('business_page_plan_cta')}
        loadingLabel={t('portal_billing_updating')}
        loading={planSaving}
        onCancel={() => setPlanToConfirm(null)}
        onConfirm={handleConfirmPlanChange}
      />
    </>
  );
}
