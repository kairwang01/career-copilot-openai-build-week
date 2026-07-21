import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  pricingIntentFromSearch,
  pricingIntentHref,
  pricingSearchForAudience,
} from '../marketing/lib/pricingAudience';

const root = resolve(import.meta.dirname, '..');
const locales = ['en', 'fr', 'de', 'ar', 'ja', 'vi', 'zh'] as const;
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

function sourceFiles(path: string): string[] {
  return readdirSync(resolve(root, path)).flatMap((entry) => {
    const relative = `${path}/${entry}`;
    return statSync(resolve(root, relative)).isDirectory()
      ? sourceFiles(relative)
      : /\.(?:ts|tsx|css|mjs|html)$/.test(entry)
        ? [relative]
        : [];
  });
}

describe('marketing launch trust and self-hosted asset safety', () => {
  it('does not depend on remote Unsplash assets', () => {
    const marketingSource = [
      ...sourceFiles('marketing'),
      ...sourceFiles('public'),
    ].map(read).join('\n');

    expect(marketingSource).not.toMatch(/images\.unsplash\.com|unsplash\.com/i);
    expect(read('marketing/pages/JobseekerHomePage.tsx')).not.toContain('url(\'http');
  });

  it('renders scenarios instead of fabricated people or testimonial quotes', () => {
    const stories = read('marketing/mock/successStories.ts');
    const voices = read('marketing/components/UserVoices.tsx');
    const featureShowcase = read('marketing/components/FeatureShowcase.tsx');

    for (const fabricatedName of ['Ana Silva', 'Ben Carter', 'Chloe Davis', 'David Chen']) {
      expect(stories).not.toContain(fabricatedName);
    }
    expect(stories).not.toContain('imageSrc');
    expect(voices).toContain("t('audience_disclaimer')");
    expect(voices).not.toContain('<blockquote');
    expect(voices).not.toContain('<img');
    expect(read('marketing/components/CaseSnapshots.tsx')).toContain("t('site_cases_disclaimer')");
    expect(featureShowcase).toContain("t('site_preview_jobs_review_label')");
    expect(featureShowcase).toContain('UserRound');
    expect(featureShowcase).not.toContain('/interviewer.jpg');
    expect(featureShowcase).not.toContain('Verified employee');
    expect(featureShowcase).not.toContain('Great mentorship culture');
    expect(featureShowcase).not.toMatch(/[🇨🇦🇺🇸🇬🇧🇩🇪🇫🇷🇯🇵🇻🇳🇸🇬🇦🇺🎉]/u);
  });

  it.each(locales)('keeps transparent scenario copy and its public mirror in %s', (locale) => {
    const dictionary = JSON.parse(read(`localization/${locale}.json`)) as Record<string, string>;
    const publicDictionary = JSON.parse(read(`public/localization/${locale}.json`)) as Record<string, string>;

    expect(publicDictionary).toEqual(dictionary);
    for (const key of [
      'audience_disclaimer',
      'site_cases_disclaimer',
      'site_pricing_currency',
      'site_pricing_model_note_jobseeker',
      'site_fs2_desc',
      'site_fs2_b3',
      'site_preview_jobs_review_label',
      'site_preview_jobs_review',
      'site_preview_jobs_rating',
      'site_preview_jobs_salary',
    ]) {
      expect(dictionary[key]?.trim(), `${locale}:${key}`).not.toBe('');
    }
    expect(dictionary.site_pricing_currency).toBe('CAD');
    expect(dictionary.footer_beta_notice).toBeUndefined();
    expect(dictionary.footer_academic_credit).toBeUndefined();
    if (locale === 'en') {
      expect(dictionary.site_preview_jobs_review_label).toBe('Demo review');
      expect(dictionary.site_preview_jobs_review).toMatch(/fictional sample/i);
      expect(dictionary.site_preview_jobs_rating).toMatch(/demo/i);
      expect(dictionary.site_preview_jobs_salary).toMatch(/illustrative/i);
    }
  });

  it('removes the beta and university-credit lines from every public footer render', () => {
    const marketingSource = sourceFiles('marketing').map(read).join('\n');

    expect(marketingSource).not.toContain("t('footer_beta_notice')");
    expect(marketingSource).not.toContain("t('footer_academic_credit')");
    expect(read('marketing/components/SiteFooter.tsx')).not.toContain('ELG 5902');
  });

  it('keeps each pricing selection in an allowlisted, round-trippable URL intent', () => {
    const planHref = pricingIntentHref('/workspace?source=pricing', 'plan:js_accelerator');
    const packHref = pricingIntentHref('/workspace', 'pack:pack_500');

    expect(pricingIntentFromSearch(new URL(planHref, 'https://example.test').search)).toBe('plan:js_accelerator');
    expect(pricingIntentFromSearch(new URL(packHref, 'https://example.test').search)).toBe('pack:pack_500');
    expect(new URL(planHref, 'https://example.test').searchParams.get('source')).toBe('pricing');
    expect(pricingIntentHref('/workspace', 'plan:admin')).toBe('/workspace');
    expect(pricingIntentFromSearch('?pricing_intent=plan%3Aadmin')).toBeNull();
    expect(pricingSearchForAudience('?pricing_intent=plan%3Aemp_growth', 'jobseeker')).not.toContain('pricing_intent');
    expect(pricingSearchForAudience('?pricing_intent=pack%3Apack_500', 'jobseeker')).toContain('pricing_intent');
  });

  it('wires plan and pack CTAs to distinct intents and labels every price as CAD', () => {
    const source = read('marketing/pages/PricingPage.tsx');
    const pricingConfig = read('marketing/config/pricingPlans.ts');

    expect(source).toContain('`plan:${plan.id}`');
    expect(source).toContain('`pack:${pack.key}`');
    expect(source.match(/site_pricing_currency/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).not.toContain('employerAddOnPlans');
    expect(source).not.toContain('site_pricing_job_posts_title');
    expect(pricingConfig).not.toContain('emp_single_post');
    expect(pricingConfig).not.toContain('emp_job_pack');
  });

  it('does not advertise unverified premium-model, analytics, or branding promises', () => {
    const english = JSON.parse(read('localization/en.json')) as Record<string, string>;

    expect(english.site_pricing_model_note_jobseeker).not.toMatch(/unlock premium|remove.*daily/i);
    expect(english.site_plan_emp_growth_f4).not.toMatch(/analytics|branding/i);
    expect(english.site_plan_emp_job_pack_f3).not.toMatch(/branding/i);
    expect(english.portal_plan_growth_f4).not.toMatch(/analytics|branding/i);
    expect(english.plan_job_pack_feature_3).not.toMatch(/branding/i);
    expect(english.site_fs2_b3).toMatch(/interview or later/i);
  });
});
