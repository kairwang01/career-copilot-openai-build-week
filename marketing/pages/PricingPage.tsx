import React, { useState } from 'react';
import { Check, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { SiteLayout } from '../components/SiteLayout';
import { SiteButton } from '../components/SiteButton';
import { SiteCard } from '../components/SiteCard';
import { SITE_ROUTES } from '../../config/site';
import { useMarketingI18n } from '../hooks/useMarketingI18n';
import { useSiteSession } from '../hooks/useSiteSession';
import { employerPlans, jobseekerPlans, planKey, type PricingPlanConfig } from '../config/pricingPlans';
import { CREDIT_PACKS } from '../../config/credits';
import {
  pricingAudienceFromSearch,
  pricingIntentHref,
  pricingSearchForAudience,
  type PricingAudience,
} from '../lib/pricingAudience';

interface PlanGridProps {
  plans: PricingPlanConfig[];
  ctaHref: (plan: PricingPlanConfig) => string;
  t: (key: string) => string;
}

const PlanGrid: React.FC<PlanGridProps> = ({ plans, ctaHref, t }) => (
  <div
    className={`grid grid-cols-1 sm:grid-cols-2 gap-4 lg:gap-5 items-stretch ${
      plans.length > 2 ? 'lg:grid-cols-4' : ''
    }`}
  >
    {plans.map((plan) => (
      <SiteCard
        key={plan.id}
        className={`relative flex flex-col p-6 sm:p-7 transition-colors ${
          plan.recommended
            ? 'border-[var(--site-action)] bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] ring-1 ring-[var(--site-action)]'
            : 'hover:border-slate-300'
        }`}
      >
        {plan.recommended && (
          <p className="mb-4 w-fit rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold tracking-wide uppercase text-[var(--site-action)]">
            {t('site_pricing_recommended')}
          </p>
        )}
        <h3 className="font-bold text-xl tracking-tight text-[var(--site-text)]">{t(planKey(plan.id, 'name'))}</h3>
        <p className="text-4xl sm:text-5xl font-bold tracking-[-0.045em] mt-4 text-[var(--site-text)]">
          {t(planKey(plan.id, 'price'))}
          <span className="ms-1 text-sm font-medium text-[var(--site-text-muted)]">
            {t('site_pricing_currency')}
          </span>
          {!plan.isCustomPrice && (
            <span className="ms-1 text-sm font-medium text-[var(--site-text-muted)]">
              {t('site_pricing_per_month')}
            </span>
          )}
        </p>
        <p className="text-sm font-medium text-[var(--site-text-muted)] mt-2 mb-5">
          {t(planKey(plan.id, 'desc'))}
        </p>
        <div className="my-1 h-px bg-[var(--site-border)]" />
        <ul className="mt-5 text-sm space-y-3 flex-1 text-[var(--site-text-muted)]">
          {Array.from({ length: plan.featureCount }, (_, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--site-ready-bg)] text-[var(--site-ready)]">
                <Check className="h-3 w-3" aria-hidden="true" strokeWidth={2.5} />
              </span>
              <span>{t(planKey(plan.id, `f${i + 1}` as `f${number}`))}</span>
            </li>
          ))}
        </ul>
        <SiteButton variant={plan.recommended ? 'primary' : 'secondary'} href={ctaHref(plan)} className="mt-7 w-full py-3 font-semibold">
          {t('site_pricing_get_started')}
        </SiteButton>
      </SiteCard>
    ))}
  </div>
);

export const PricingPage: React.FC = () => {
  const { t } = useMarketingI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const { isBusiness } = useSiteSession();

  // Open on the plan set that matches where the visitor came from: an explicit
  // ?audience=, the business upsell banner, or a signed-in business account. A
  // business user must never land on job-seeker pricing by default.
  const params = new URLSearchParams(location.search);
  const fromBusinessUpsell = params.get('from') === 'business-upsell';
  const [audience, setAudience] = useState<PricingAudience>(
    () => pricingAudienceFromSearch(location.search, isBusiness),
  );

  // Re-resolve after session hydration or browser navigation; an explicit URL
  // audience always wins over the signed-in account default.
  React.useEffect(() => {
    setAudience(pricingAudienceFromSearch(location.search, isBusiness));
  }, [isBusiness, location.search]);

  const selectAudience = (nextAudience: PricingAudience) => {
    setAudience(nextAudience);
    navigate(
      {
        pathname: location.pathname,
        search: pricingSearchForAudience(location.search, nextAudience),
      },
      { replace: true },
    );
  };

  const [upsellDismissed, setUpsellDismissed] = useState(false);
  const plans = audience === 'jobseeker' ? jobseekerPlans : employerPlans;
  const ctaBasePath = audience === 'jobseeker' ? SITE_ROUTES.workspace : SITE_ROUTES.portal;
  const showBusinessUpsell = !upsellDismissed && fromBusinessUpsell;

  return (
    <SiteLayout pageId="pricing">
      {showBusinessUpsell && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 bg-amber-50 border-b border-amber-200 px-4 py-3 text-sm text-amber-900"
        >
          <span>{t('site_pricing_business_upsell_banner')}</span>
          <button
            type="button"
            onClick={() => setUpsellDismissed(true)}
            className="shrink-0 rounded p-1 hover:bg-amber-100 transition-colors"
            aria-label={t('tool_agile_coach_close_button')}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
      <section className="relative overflow-hidden bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_55%,#f8fafc_100%)] py-14 sm:py-20">
        <div className="pointer-events-none absolute left-1/2 top-0 h-72 w-[44rem] -translate-x-1/2 rounded-full bg-blue-100/55 blur-3xl" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--site-action)]">
              {t('site_nav_pricing')}
            </p>
            <h1 className="mt-4 text-[clamp(2.25rem,5vw,4.5rem)] font-bold leading-[1] tracking-[-0.055em] text-[var(--site-text)]">
              {t('site_pricing_title')}
            </h1>
            <p className="mt-5 text-base sm:text-lg leading-8 text-[var(--site-text-muted)]">
              {audience === 'jobseeker' ? t('site_pricing_js_desc') : t('site_pricing_emp_desc')}
            </p>
          </div>

          <div
            role="group"
            aria-label={t('site_pricing_title')}
            className="mx-auto mt-8 mb-10 sm:mb-12 flex w-full max-w-md rounded-full border border-[var(--site-border)] bg-white p-1 shadow-sm"
          >
            {(['jobseeker', 'employer'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={audience === option}
                onClick={() => selectAudience(option)}
                className={`min-h-[42px] flex-1 rounded-full px-4 text-sm font-semibold transition-colors ${
                  audience === option
                    ? 'bg-[var(--site-text)] text-white'
                    : 'text-[var(--site-text-muted)] hover:text-[var(--site-text)]'
                }`}
              >
                {option === 'jobseeker' ? t('site_pricing_jobseekers') : t('site_pricing_employers')}
              </button>
            ))}
          </div>

          <PlanGrid
            plans={plans}
            ctaHref={(plan) => pricingIntentHref(ctaBasePath, `plan:${plan.id}`)}
            t={t}
          />

          <p className="mt-5 text-center text-xs text-[var(--site-text-muted)]">
            {audience === 'jobseeker'
              ? t('site_pricing_model_note_jobseeker')
              : t('site_pricing_model_note_business')}
          </p>

          {audience === 'jobseeker' && (
            <section className="mt-16 rounded-[calc(var(--site-radius)*2)] border border-[var(--site-border)] bg-white p-6 sm:p-8">
              <div className="text-center mb-8">
                <h2 className="text-2xl sm:text-3xl font-bold tracking-[-0.035em]">{t('site_pricing_topup_title')}</h2>
                <p className="mt-2 text-sm sm:text-base text-[var(--site-text-muted)]">
                  {t('site_pricing_topup_desc')}
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-4xl mx-auto">
                {CREDIT_PACKS.map((pack) => (
                  <SiteCard key={pack.key} className="text-center bg-[var(--site-surface-muted)]">
                    <h3 className="font-semibold">{t(`site_pack_${pack.key}_name`)}</h3>
                    <p className="mt-3 text-4xl font-bold tracking-[-0.04em] text-[var(--site-text)]">{pack.credits.toLocaleString()}</p>
                    <p className="text-sm text-[var(--site-text-muted)]">{t('site_pricing_credits_label')}</p>
                    <p className="mt-5 text-lg font-semibold">
                      {pack.price} <span className="text-xs text-[var(--site-text-muted)]">{t('site_pricing_currency')}</span>
                    </p>
                    <p className="text-xs text-[var(--site-text-muted)]">{t(`site_pack_${pack.key}_desc`)}</p>
                    <SiteButton href={pricingIntentHref(SITE_ROUTES.workspace, `pack:${pack.key}`)} variant="secondary" className="mt-5 w-full">
                      {t('site_pricing_buy_credits')}
                    </SiteButton>
                  </SiteCard>
                ))}
              </div>
            </section>
          )}
        </div>
      </section>
    </SiteLayout>
  );
};
