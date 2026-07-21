import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

const localeKeys = [
  'tool_english_pro_spoken_manual_title',
  'tool_english_pro_spoken_manual_desc',
  'tool_english_pro_spoken_manual_placeholder',
  'tool_english_pro_spoken_manual_pacing_note',
  'tool_english_pro_spoken_manual_analyze',
  'tool_career_path_download_title',
  'tool_career_path_target_role_fallback',
  'tool_career_path_goal',
  'tool_career_path_step_type_course',
  'tool_career_path_step_type_certification',
  'tool_career_path_step_type_project',
  'tool_career_path_step_type_networking',
  'tool_career_path_step_type_self_study',
] as const;

describe('legacy UX residual fixes', () => {
  it.each(['en', 'fr', 'de', 'ar', 'ja', 'vi', 'zh'])(
    'defines and mirrors the new localized contracts in %s',
    (locale) => {
      const canonical = JSON.parse(read(`localization/${locale}.json`)) as Record<string, string>;
      const publicMirror = JSON.parse(read(`public/localization/${locale}.json`)) as Record<string, string>;

      for (const key of localeKeys) {
        expect(canonical[key], `${locale}:${key}`).toBeTypeOf('string');
        expect(canonical[key]?.trim(), `${locale}:${key}`).not.toBe('');
        expect(publicMirror[key], `public/${locale}:${key}`).toBe(canonical[key]);
      }
    },
  );

  it('routes speech failures to a typed transcript that reuses spoken analysis', () => {
    const source = read('components/tools/EnglishPro.tsx');

    expect(source).toContain('data-qa="english-pro-spoken-manual"');
    expect(source).toContain('data-qa="english-pro-spoken-manual-analyze"');
    expect(source).toContain("setSpeechFallbackReason('no-speech')");
    expect(source).toContain("setSpeechFallbackReason('unsupported')");
    expect(source).toContain("? 'not-allowed'");
    expect(source).toContain('runSpokenAnalysis(normalizedTranscript, estimatedDuration)');
    expect(source).toContain('(wordCount / 130) * 60');
  });

  it('shows a loader that matches the active English Pro sub-mode', () => {
    const source = read('components/tools/EnglishPro.tsx');

    for (const action of [
      'written-analysis',
      'spoken-analysis',
      'reading-analysis',
      'reading-practice',
      'reading-evaluation',
      'flashcards',
      'listening-analysis',
    ]) {
      expect(source).toContain(`beginLoading('${action}')`);
    }
    expect(source).toContain('title={loadingPresentation.title}');
    expect(source).toContain('steps={loadingPresentation.steps}');
    expect(source).not.toContain('if (loading && flashcards.length === 0)');
    expect(source).not.toContain('children: loading &&');
  });

  it('keeps each job-post AI error beside its own retry action', () => {
    const source = read('components/JobPostForm.tsx');

    expect(source).toContain('Partial<Record<AiAction, string>>');
    for (const [action, handler] of [
      ['description', 'handleGenerateDescription'],
      ['format', 'handleFormatDescription'],
      ['inclusivity', 'handleCheckInclusivity'],
      ['salary', 'handleAnalyzeSalary'],
    ]) {
      expect(source).toContain(`renderAiError('${action}', ${handler})`);
      expect(source).toContain(`setAiActionError('${action}'`);
    }
    const startAction = source.slice(source.indexOf('const startAiAction'), source.indexOf('const finishAiAction'));
    expect(startAction).not.toContain('setError(');
  });

  it('localizes career-path export headings and roadmap step types from one map', () => {
    const source = read('components/tools/CareerPathPlanner.tsx');

    expect(source).toContain('const actionLabelKeyMap: Record<RoadmapActionableStep');
    expect(source).toContain('getStepTypeLabel(step.type)');
    expect(source).toContain("t('tool_career_path_download_title').replace('{role}', targetRole)");
    expect(source).not.toContain('# Your Career Path to:');
    expect(source).not.toContain('## Overall Skill Gaps');
    expect(source).not.toContain("step.type.replace('-', ' ')");
  });

  it('keeps applicant data visible while a manual refresh runs', () => {
    const source = read('components/ApplicantFunnel.tsx');

    expect(source).toContain('const [refreshing, setRefreshing] = useState(false)');
    expect(source).toContain('const isInitialLoad = loadedJobIdRef.current !== job.id');
    expect(source).toContain('setRefreshing(true)');
    expect(source).toContain('aria-busy={refreshing}');
    expect(source).toContain('disabled={refreshing}');
    expect(source).toContain('setRefreshError(err instanceof Error');
  });
});
