import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const locales = ['en', 'fr', 'de', 'ar', 'ja', 'vi', 'zh'] as const;

const dictionary = (locale: (typeof locales)[number], published = false) =>
  JSON.parse(
    readFileSync(
      resolve(root, published ? `public/localization/${locale}.json` : `localization/${locale}.json`),
      'utf8',
    ),
  ) as Record<string, string>;

const durationClaimKeys = [
  'site_plan_emp_free_f2',
  'site_plan_emp_starter_f2',
  'site_plan_emp_growth_f2',
  'site_plan_emp_team_f2',
  'business_page_plan_free_feature_2',
  'business_page_plan_starter_feature_2',
  'business_page_plan_growth_feature_2',
  'business_page_plan_pro_feature_2',
  'portal_plan_free_f2',
  'portal_plan_starter_f2',
  'portal_plan_growth_f2',
  'portal_plan_pro_f2',
] as const;

describe('public claim truth and localization mirrors', () => {
  it.each(locales)('keeps the canonical and published %s dictionaries identical', (locale) => {
    expect(dictionary(locale, true)).toEqual(dictionary(locale));
  });

  it('describes external job results as conditional and requiring source verification', () => {
    const english = dictionary('en');

    expect(english.faq_5_a).toMatch(/depend.*configured search|may be incomplete or stale/i);
    expect(english.faq_5_a).toMatch(/verify.*original site/i);
    expect(english.faq_5_a).not.toMatch(/no dead links|no ghost jobs|real, active.*major job boards/i);
    expect(english.tool_opportunity_finder_loading_step2).toMatch(/platform roles.*configured external sources/i);
  });

  it('describes AI coaching as reviewable guidance rather than a speed or outcome promise', () => {
    const english = dictionary('en');

    expect(english.faq_2_a).toMatch(/not a recruiter decision or an outcome guarantee/i);
    expect(english.faq_2_a).not.toMatch(/takes seconds/i);
    expect(english.faq_3_a).toMatch(/does not predict/i);
    expect(english.faq_3_a).not.toMatch(/by the third/i);
    expect(english.faq_6_a).toMatch(/does not guarantee ATS parsing, interviews, or recruiter acceptance/i);
    expect(english.features_subtitle).toMatch(/review generated output/i);
  });

  it('discloses service-provider processing without an absolute privacy guarantee', () => {
    const english = dictionary('en');

    expect(english.faq_7_a).toMatch(/configured AI and infrastructure providers/i);
    expect(english.faq_7_a).toMatch(/no internet service can guarantee absolute security/i);
    expect(english.ob_ai_notice).toMatch(/sent to the configured AI provider/i);
    expect(english.site_emp_trust_line).toMatch(/service providers.*Privacy Policy/i);
    expect(english.faq_7_a).not.toMatch(/do(?:n't| not) sell, rent, or share|all data transmission is encrypted/i);
  });

  it('labels generated sites, credentials, and previews with their real limits', () => {
    const english = dictionary('en');

    expect(english.faq_9_a).toMatch(/does not automatically create a public URL/i);
    expect(english.faq_10_a).toMatch(/not independent verification/i);
    expect(english.site_vt_title).toMatch(/not a hiring guarantee/i);
    expect(english.site_vt_emp_benefit3_desc).toMatch(/does not reduce or quantify hiring risk/i);
    expect(english.site_hero_score_context).toMatch(/illustrative output/i);
    expect(english.site_talent_pool_subtitle).toMatch(/not real users or hiring results/i);
  });

  it.each(locales)('does not promise unimplemented listing durations in %s', (locale) => {
    const values = dictionary(locale);

    for (const key of durationClaimKeys) {
      expect(values[key]?.trim(), `${locale}:${key}`).not.toBe('');
    }
    expect(values.plan_single_post_price_desc).not.toMatch(/30/);
    expect(values.site_plan_emp_single_post_price).not.toMatch(/^\$/);
    expect(values.site_plan_emp_job_pack_price).not.toMatch(/^\$/);
  });

  it('removes absolute job/review timing language and unsupported popularity claims', () => {
    const english = dictionary('en');

    expect(english.site_fs2_b2).not.toMatch(/every job card/i);
    expect(english.site_fs4_b2).not.toMatch(/instant/i);
    expect(english.site_pricing_recommended).toBe('Recommended');
    expect(english.business_page_pricing_badge_popular).toBe('Recommended');
  });

  it('keeps market and employer-assistant copy aligned with implemented workflows', () => {
    const english = dictionary('en');

    expect(english.site_fs3_b1).toMatch(/China.*UAE/i);
    expect(english.site_fs3_title).not.toMatch(/nine countries/i);
    expect(english.site_emp_assistant_salary).not.toMatch(/benchmark/i);
    expect(english.site_emp_assistant_market).not.toMatch(/market fit preview/i);
    expect(english.site_emp_assistant_clarity).not.toMatch(/clarity score/i);
    expect(english.business_page_feature_ai_desc).toMatch(/human review/i);
  });

  it.each(locales)('keeps the removed beta and course-team footer copy absent in %s', (locale) => {
    const values = dictionary(locale);
    const serialized = JSON.stringify(values);

    expect(values.footer_beta_notice).toBeUndefined();
    expect(values.footer_academic_credit).toBeUndefined();
    expect(serialized).not.toMatch(/Beta 预览版|功能和数据可能会在正式发布前调整|渥太华大学 · ELG 5902|王凯尔/);
    expect(values.business_page_hero_title_part1.trim()).not.toBe('');
  });
});
