export type PricingAudience = 'jobseeker' | 'employer';

const ALLOWED_PRICING_INTENTS = new Set([
  'plan:js_free',
  'plan:js_essentials',
  'plan:js_accelerator',
  'plan:js_executive',
  'plan:emp_free',
  'plan:emp_starter',
  'plan:emp_growth',
  'plan:emp_team',
  'plan:emp_single_post',
  'plan:emp_job_pack',
  'pack:pack_100',
  'pack:pack_500',
  'pack:pack_1000',
]);

export function pricingIntentFromSearch(search: string): string | null {
  const intent = new URLSearchParams(search).get('pricing_intent');
  return intent && ALLOWED_PRICING_INTENTS.has(intent) ? intent : null;
}

export function pricingIntentHref(basePath: string, requestedIntent: string): string {
  if (!ALLOWED_PRICING_INTENTS.has(requestedIntent)) return basePath;
  const [pathname, existingSearch = ''] = basePath.split('?', 2);
  const params = new URLSearchParams(existingSearch);
  params.set('pricing_intent', requestedIntent);
  return `${pathname}?${params.toString()}`;
}

export function pricingAudienceFromSearch(
  search: string,
  isBusinessAccount: boolean,
): PricingAudience {
  const params = new URLSearchParams(search);
  const explicit = params.get('audience');
  if (explicit === 'employer') return 'employer';
  if (explicit === 'jobseeker') return 'jobseeker';
  if (params.get('from') === 'business-upsell' || isBusinessAccount) return 'employer';
  return 'jobseeker';
}

export function pricingSearchForAudience(
  search: string,
  audience: PricingAudience,
): string {
  const params = new URLSearchParams(search);
  params.set('audience', audience);
  const intent = pricingIntentFromSearch(search);
  const matchesAudience = intent
    ? audience === 'jobseeker'
      ? intent.startsWith('plan:js_') || intent.startsWith('pack:')
      : intent.startsWith('plan:emp_')
    : false;
  if (!matchesAudience) params.delete('pricing_intent');
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}
