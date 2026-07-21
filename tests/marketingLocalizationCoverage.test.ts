import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

const requiredKeys = [
  'site_pack_pack_100_name',
  'site_pack_pack_500_name',
  'site_pack_pack_1000_name',
  'site_sample_generation_step_1',
  'site_sample_generation_step_2',
  'site_sample_generation_step_3',
  'site_sample_generation_step_4',
  'site_sample_generation_flow_desc',
  'site_sample_show_report',
  'site_sample_simulated_submission',
  'site_sample_candidate_label',
  'site_sample_target_role_label',
  'site_sample_status_label',
  'site_sample_analysis_complete',
  'site_sample_english_market_note',
  'site_sample_overall_score',
  'site_sample_fit_headline',
  'site_sample_cta_title',
  'site_sample_cta_desc',
  'site_sample_target_role',
  'site_sample_rewrite_example',
  'site_sample_issue_1_why',
  'site_sample_issue_1_fix',
  'site_sample_issue_2_why',
  'site_sample_issue_2_fix',
  'site_sample_issue_3_why',
  'site_sample_issue_3_fix',
  'site_report_severity_ready',
  'site_report_severity_gap',
  'site_report_severity_risk',
  'site_interview_sample_question',
  'site_interview_sample_answer',
  'site_interview_sample_situation',
  'site_interview_sample_task',
  'site_interview_sample_action',
  'site_interview_sample_result',
  'site_interview_sample_missing',
  'site_interview_sample_next',
] as const;

describe('marketing localization coverage', () => {
  it('does not render known English-only UI anchors from pricing or sample report source', () => {
    const source = [
      'marketing/pages/PricingPage.tsx',
      'marketing/pages/SampleReportPage.tsx',
      'marketing/components/ReportPreview.tsx',
      'marketing/components/InterviewFeedbackPreview.tsx',
    ].map(read).join('\n');

    for (const anchor of [
      'PLAN_LLM_COPY',
      '{pack.name}',
      'Simulated submission',
      'Show report',
      'Overall score',
      'Run this on your own resume',
      'Analysis complete',
    ]) {
      expect(source).not.toContain(anchor);
    }
  });

  it.each(['en', 'fr', 'de', 'ar', 'ja', 'vi', 'zh'])(
    'defines every pricing/sample UI key in %s',
    (locale) => {
      const dictionary = JSON.parse(read(`localization/${locale}.json`)) as Record<string, string>;
      for (const key of requiredKeys) {
        expect(dictionary[key], `${locale}:${key}`).toBeTypeOf('string');
        expect(dictionary[key]?.trim(), `${locale}:${key}`).not.toBe('');
      }
    },
  );
});
