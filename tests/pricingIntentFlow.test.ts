import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  resolvePricingIntent,
  searchWithoutParams,
} from '../lib/pricingIntent';

const candidatePlans = {
  'plan:js_free': 'free',
  'plan:js_essentials': 'essentials',
  'plan:js_accelerator': 'accelerator',
  'plan:js_executive': 'executive',
} as const;

const employerPlans = {
  'plan:emp_free': 'free',
  'plan:emp_starter': 'starter',
  'plan:emp_growth': 'growth',
  'plan:emp_team': 'pro',
  'plan:emp_single_post': 'single_post',
  'plan:emp_job_pack': 'job_pack',
} as const;

describe('pricing intent product mapping', () => {
  it.each(Object.entries(candidatePlans))('maps candidate intent %s to %s', (source, planKey) => {
    expect(resolvePricingIntent(`?pricing_intent=${encodeURIComponent(source)}`)).toMatchObject({
      state: 'valid',
      selection: { audience: 'candidate', kind: 'plan', planKey },
    });
  });

  it.each(Object.entries(employerPlans))('maps employer intent %s to %s', (source, planKey) => {
    expect(resolvePricingIntent(`?pricing_intent=${encodeURIComponent(source)}`)).toMatchObject({
      state: 'valid',
      selection: {
        audience: 'employer',
        kind: 'plan',
        planKey,
        billingMode: planKey === 'single_post' || planKey === 'job_pack' ? 'unavailable_one_time' : 'subscription',
      },
    });
  });

  it.each(['pack_100', 'pack_500', 'pack_1000'] as const)('maps credit pack %s exactly', (packKey) => {
    expect(resolvePricingIntent(`?pricing_intent=pack%3A${packKey}`)).toMatchObject({
      state: 'valid',
      selection: { audience: 'candidate', kind: 'credit_pack', packKey },
    });
  });

  it('fails closed for absent, malformed and unrecognized values', () => {
    expect(resolvePricingIntent('?utm_source=launch')).toEqual({ state: 'none' });
    expect(resolvePricingIntent('?pricing_intent=')).toEqual({ state: 'invalid', source: '' });
    expect(resolvePricingIntent('?pricing_intent=plan%3Ajs_unknown')).toEqual({
      state: 'invalid',
      source: 'plan:js_unknown',
    });
    expect(resolvePricingIntent('?pricing_intent=javascript%3Aalert(1)')).toEqual({
      state: 'invalid',
      source: 'javascript:alert(1)',
    });
  });

  it('removes only consumed keys and preserves unrelated parameters', () => {
    expect(
      searchWithoutParams(
        '?utm_source=launch&pricing_intent=plan%3Ajs_accelerator&auth=signup&next=reports',
        ['pricing_intent', 'auth'],
      ),
    ).toBe('?utm_source=launch&next=reports');
  });
});

describe('pricing intent wiring', () => {
  const careerApp = readFileSync(new URL('../CareerApp.tsx', import.meta.url), 'utf8');
  const candidateBilling = readFileSync(
    new URL('../components/dashboard/CandidateWorkspacePages.tsx', import.meta.url),
    'utf8',
  );
  const businessPage = readFileSync(new URL('../components/BusinessPage.tsx', import.meta.url), 'utf8');
  const businessSignup = readFileSync(
    new URL('../components/business/BusinessSignUpModal.tsx', import.meta.url),
    'utf8',
  );

  it('keeps candidate choices URL-backed and passes them to billing', () => {
    expect(careerApp).toContain("search: searchWithoutParams(location.search, ['auth'])");
    expect(careerApp).toContain('initialPricingIntent={pendingCandidatePricingIntent}');
    expect(careerApp).toContain('onPricingIntentHandled={handleCandidatePricingIntentHandled}');
    expect(careerApp).toContain('const showEmployerPortalShell = showEmployerShell && !shouldResolvePortalPricingIntent');
  });

  it('opens a confirmation before either a plan mutation or credit checkout', () => {
    expect(candidateBilling).toContain('setPlanToConfirm(initialPricingIntent.planKey)');
    expect(candidateBilling).toContain('setPackToConfirm(initialPricingIntent.packKey)');
    expect(candidateBilling).toContain('onClick={() => handleSelectPack');
    expect(candidateBilling).toContain('onConfirm={handleConfirmPackPurchase}');
    expect(candidateBilling).not.toContain('onClick={() => handleBuyPack(pack.key)}');
  });

  it('blocks unsupported employer add-ons without opening checkout', () => {
    expect(businessPage).toContain('setSignupPlan(selection.planKey)');
    expect(businessPage).toContain("setModal('confirm_plan')");
    expect(businessPage).toContain("selection.billingMode === 'unavailable_one_time'");
    expect(businessPage).toContain("setModal('pricing_unavailable')");
    expect(businessPage).toContain("t('account_billing_portal_unavailable')");
    expect(businessSignup).not.toContain('single_post');
    expect(businessSignup).not.toContain('job_pack');
    expect(businessSignup).toContain('`pending_biz_${selectedPlan}`');
    const urlIntentEffect = businessPage.slice(
      businessPage.indexOf('const pricingResolution = resolvePricingIntent'),
      businessPage.indexOf('\n  return (', businessPage.indexOf('const pricingResolution = resolvePricingIntent')),
    );
    expect(urlIntentEffect).not.toContain('startSubscriptionCheckout');
    expect(urlIntentEffect).not.toContain('onSelectBusinessPlan(');
  });

  it('locks a successful business registration behind a continue state', () => {
    expect(businessSignup).toContain('setCompleted(true)');
    expect(businessSignup).toContain('completed ? (');
    expect(businessSignup).toContain("t('site_portal_continue')");
    expect(businessSignup).toContain('setCompleted(false)');
  });
});
