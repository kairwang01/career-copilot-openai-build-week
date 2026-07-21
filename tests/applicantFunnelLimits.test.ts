import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const rootUrl = new URL('../', import.meta.url);
const handlerSource = readFileSync(new URL('functions/src/handlers/listJobApplicants.ts', rootUrl), 'utf8');
const componentSource = readFileSync(new URL('components/ApplicantFunnel.tsx', rootUrl), 'utf8');
const locales = ['ar', 'de', 'en', 'fr', 'ja', 'vi', 'zh'];
const keys = [
  'applicant_funnel_review_limit_title',
  'applicant_funnel_results_truncated',
  'applicant_funnel_history_truncated',
  'applicant_funnel_analysis_partial_error',
];

describe('bounded applicant review disclosure', () => {
  it('queries one extra record and reports both truncation boundaries', () => {
    expect(handlerSource).toContain('.limit(APPLICANTS_READ_CAP + 1)');
    expect(handlerSource).toContain('.limit(STATUS_HISTORY_READ_CAP + 1)');
    expect(handlerSource).toContain('applicants_truncated: applicantsTruncated');
    expect(handlerSource).toContain('status_history_truncated: statusHistoryTruncated');
  });

  it('surfaces partial data and recoverable analysis failures in the employer UI', () => {
    expect(componentSource).toContain("t('applicant_funnel_results_truncated')");
    expect(componentSource).toContain("t('applicant_funnel_history_truncated')");
    expect(componentSource).toContain("t('applicant_funnel_analysis_partial_error')");
    expect(componentSource).toContain('onClick={fetchApplicants}');
  });

  it.each(locales)('keeps %s warning copy translated and mirrored', (locale) => {
    const canonical = JSON.parse(readFileSync(new URL(`localization/${locale}.json`, rootUrl), 'utf8'));
    const mirrored = JSON.parse(readFileSync(new URL(`public/localization/${locale}.json`, rootUrl), 'utf8'));
    for (const key of keys) {
      expect(canonical[key]).toBeTruthy();
      expect(mirrored[key]).toBe(canonical[key]);
    }
  });
});
