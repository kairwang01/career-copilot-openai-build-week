import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

const requiredKeys = [
  'mi_speech_auto',
  'mi_speech_traditional_chinese',
  'mi_speech_korean',
  'mi_speech_spanish',
  'mi_speech_error_permission',
  'mi_speech_error_no_speech',
  'mi_speech_error_network',
  'mi_speech_error_unavailable',
  'mi_room_label',
  'mi_history_default_title',
  'mi_mode_label',
  'mi_level_label',
  'mi_real_pacing_title',
  'mi_real_pacing_desc',
  'mi_question_category_default',
  'mi_timer_prep_short',
  'mi_timer_answer_short',
  'mi_timer_label',
  'mi_prep_coaching_tip',
  'mi_answer_focus_title',
  'mi_answer_focus_context',
  'mi_answer_focus_action',
  'mi_answer_focus_result',
  'mi_answer_focus_learning',
  'mi_resume_ready',
  'mi_prep_duration_badge',
  'mi_answer_duration_badge',
  'mi_setup_step',
  'mi_setup_heading',
  'mi_role_brief_label',
  'mi_preview_step',
  'mi_preview_default_title',
  'mi_preview_pacing_note',
  'mi_voice_or_typed',
  'mi_preview_sample_question',
  'mi_preview_sample_desc',
  'mi_mic_typing_supported',
  'mi_history_question_count',
  'mi_report_preview_heading',
  'mi_report_dimension_structure',
  'mi_report_dimension_star',
  'mi_report_dimension_evidence',
  'mi_report_dimension_specificity',
  'mi_report_dimension_delivery',
  'mi_report_dimension_clarity',
  'mi_coaching_title',
  'mi_coaching_star',
  'mi_coaching_metric',
  'mi_coaching_role_fit',
  'mi_coaching_followup',
  'mi_overall_score',
  'mi_question_short',
  'mi_report_feedback',
  'mi_error_evaluate_failed',
  'mi_error_unlock_failed',
  'mi_export_popup_blocked',
  'mi_history_load_error',
  'mi_history_save_failed',
  'mi_progress_label',
  'mi_sample_title',
  'mi_sample_description',
  'mi_sample_responsibilities',
  'mi_sample_requirements',
] as const;

describe('Interview Simulator accessibility and localization contracts', () => {
  it.each(['en', 'fr', 'de', 'ar', 'ja', 'vi', 'zh'])(
    'defines and mirrors every new customer-facing key in %s',
    (locale) => {
      const canonical = JSON.parse(read(`localization/${locale}.json`)) as Record<string, string>;
      const publicMirror = JSON.parse(read(`public/localization/${locale}.json`)) as Record<string, string>;

      for (const key of requiredKeys) {
        expect(canonical[key], `${locale}:${key}`).toBeTypeOf('string');
        expect(canonical[key]?.trim(), `${locale}:${key}`).not.toBe('');
        expect(publicMirror[key], `public/${locale}:${key}`).toBe(canonical[key]);
      }
    },
  );

  it('does not render the known English-only anchors or English download headings', () => {
    const source = read('components/InterviewSimulator.tsx');

    for (const anchor of [
      '>Practice room<',
      '>Real pacing<',
      '>Answer focus<',
      '>Mock interview<',
      '>Resume ready<',
      '>Company context<',
      '>What you get<',
      '>Concise coaching<',
      '# Interview Report',
      'Overall score:',
      'Your answer:',
      'Feedback:',
    ]) {
      expect(source).not.toContain(anchor);
    }
  });

  it('keeps form controls, selection groups, progress, errors, and the disclaimer named', () => {
    const source = read('components/InterviewSimulator.tsx');

    for (const contract of [
      'label htmlFor="mi-answer"',
      'id="mi-answer"',
      'label htmlFor="mi-company-name"',
      'id="mi-company-name"',
      'label htmlFor="mi-company-type"',
      'id="mi-company-type"',
      'label htmlFor="mi-company-industry"',
      'id="mi-company-industry"',
      '<fieldset>',
      'role="progressbar"',
      'role="timer"',
      'role="alert"',
      'labelledBy="mi-disclaimer-title"',
      'describedBy="mi-disclaimer-description"',
      'aria-controls="mi-company-context"',
      'aria-controls="mi-history-content"',
    ]) {
      expect(source).toContain(contract);
    }
  });
});
