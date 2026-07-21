import { pricingIntentFromSearch } from '../marketing/lib/pricingAudience';

export type CandidatePricingPlanKey = 'free' | 'essentials' | 'accelerator' | 'executive';
export type CandidateCreditPackKey = 'pack_100' | 'pack_500' | 'pack_1000';
export type EmployerSubscriptionPlanKey = 'free' | 'starter' | 'growth' | 'pro';
export type EmployerAddOnPlanKey = 'single_post' | 'job_pack';
export type EmployerPricingPlanKey = EmployerSubscriptionPlanKey | EmployerAddOnPlanKey;

export type CandidatePricingSelection =
  | {
      audience: 'candidate';
      kind: 'plan';
      planKey: CandidatePricingPlanKey;
      source: string;
    }
  | {
      audience: 'candidate';
      kind: 'credit_pack';
      packKey: CandidateCreditPackKey;
      source: string;
    };

export type EmployerPricingSelection =
  | {
      audience: 'employer';
      kind: 'plan';
      planKey: EmployerSubscriptionPlanKey;
      billingMode: 'subscription';
      source: string;
    }
  | {
      audience: 'employer';
      kind: 'plan';
      planKey: EmployerAddOnPlanKey;
      /** Public add-ons are blocked until duration and consumption ledgers exist. */
      billingMode: 'unavailable_one_time';
      source: string;
    };

export type PricingSelection = CandidatePricingSelection | EmployerPricingSelection;

export type PricingIntentResolution =
  | { state: 'none' }
  | { state: 'invalid'; source: string }
  | { state: 'valid'; source: string; selection: PricingSelection };

const candidatePlanByIntent: Record<string, CandidatePricingPlanKey> = {
  'plan:js_free': 'free',
  'plan:js_essentials': 'essentials',
  'plan:js_accelerator': 'accelerator',
  'plan:js_executive': 'executive',
};

const candidatePackByIntent: Record<string, CandidateCreditPackKey> = {
  'pack:pack_100': 'pack_100',
  'pack:pack_500': 'pack_500',
  'pack:pack_1000': 'pack_1000',
};

const employerPlanByIntent: Record<string, EmployerPricingPlanKey> = {
  'plan:emp_free': 'free',
  'plan:emp_starter': 'starter',
  'plan:emp_growth': 'growth',
  'plan:emp_team': 'pro',
  'plan:emp_single_post': 'single_post',
  'plan:emp_job_pack': 'job_pack',
};

/**
 * Resolves the public pricing allowlist into the backend plan keys used by the
 * product. The marketing helper remains the authority for active tokens. The
 * two withdrawn one-time add-ons stay recognizable only so old/shared links
 * can show an explicit unavailable notice instead of silently rerouting.
 */
export function resolvePricingIntent(search: string): PricingIntentResolution {
  const source = new URLSearchParams(search).get('pricing_intent');
  if (source === null) return { state: 'none' };
  if (!source) return { state: 'invalid', source };

  const withdrawnAddOn = employerPlanByIntent[source];
  if (withdrawnAddOn && isEmployerAddOnPlan(withdrawnAddOn)) {
    return {
      state: 'valid',
      source,
      selection: {
        audience: 'employer',
        kind: 'plan',
        planKey: withdrawnAddOn,
        billingMode: 'unavailable_one_time',
        source,
      },
    };
  }

  const allowedSource = pricingIntentFromSearch(search);
  if (!allowedSource) return { state: 'invalid', source };

  const candidatePlan = candidatePlanByIntent[allowedSource];
  if (candidatePlan) {
    return {
      state: 'valid',
      source: allowedSource,
      selection: { audience: 'candidate', kind: 'plan', planKey: candidatePlan, source: allowedSource },
    };
  }

  const candidatePack = candidatePackByIntent[allowedSource];
  if (candidatePack) {
    return {
      state: 'valid',
      source: allowedSource,
      selection: { audience: 'candidate', kind: 'credit_pack', packKey: candidatePack, source: allowedSource },
    };
  }

  const employerPlan = employerPlanByIntent[allowedSource];
  if (employerPlan) {
    if (isEmployerAddOnPlan(employerPlan)) {
      return {
        state: 'valid',
        source: allowedSource,
        selection: {
          audience: 'employer',
          kind: 'plan',
          planKey: employerPlan,
          billingMode: 'unavailable_one_time',
          source: allowedSource,
        },
      };
    }
    return {
      state: 'valid',
      source: allowedSource,
      selection: {
        audience: 'employer',
        kind: 'plan',
        planKey: employerPlan,
        billingMode: 'subscription',
        source: allowedSource,
      },
    };
  }

  // Fail closed if marketing adds an allowlisted token without adding the
  // corresponding product mapping here.
  return { state: 'invalid', source };
}

export function searchWithoutParams(search: string, names: readonly string[]): string {
  const params = new URLSearchParams(search);
  names.forEach((name) => params.delete(name));
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

export function isEmployerAddOnPlan(
  planKey: EmployerPricingPlanKey,
): planKey is 'single_post' | 'job_pack' {
  return planKey === 'single_post' || planKey === 'job_pack';
}

export function employerAddOnLocalizationKeys(planKey: 'single_post' | 'job_pack') {
  return {
    nameKey: `site_plan_emp_${planKey}_name`,
    priceKey: `site_plan_emp_${planKey}_price`,
    descriptionKey: `site_plan_emp_${planKey}_desc`,
  } as const;
}
