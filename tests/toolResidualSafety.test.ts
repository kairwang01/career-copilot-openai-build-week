import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

const toolFiles = [
  'IndustryEventScout.tsx',
  'SalaryNegotiator.tsx',
  'LinkedInOptimizer.tsx',
  'NetworkingAssistant.tsx',
  'PerformanceReviewPrep.tsx',
  'SkillLearningPlanner.tsx',
  'EmailCrafter.tsx',
  'CoverLetterGenerator.tsx',
  'InterviewPrep.tsx',
] as const;

const toolSource = (file: (typeof toolFiles)[number]) => read(`components/tools/${file}`);

describe('residual career tool production-safety contracts', () => {
  it.each(toolFiles)('%s discards cancelled or superseded AI responses', (file) => {
    const source = toolSource(file);

    expect(source).toContain('useCancellableLoading');
    expect(source).toContain('const alive = begin()');
    expect(source).toContain('if (!alive()) return');
    expect(source).toContain('if (alive()) end()');
  });

  it('keeps event and salary grounding links on sanitized HTTP(S) URLs', () => {
    const eventSource = toolSource('IndustryEventScout.tsx');
    const salarySource = toolSource('SalaryNegotiator.tsx');

    for (const source of [eventSource, salarySource]) {
      expect(source).toContain("import { safeHttpUrl } from '../../lib/safeUrl'");
      expect(source).toContain('safeHttpUrl(boundedText');
      expect(source).not.toContain('href={safeUrl(');
    }
    expect(eventSource).toContain('normalizeEventScoutResult');
    expect(eventSource).toContain('MAX_EVENT_RESULTS');
    expect(eventSource).toContain('aria-pressed={activeFilter === filterKey}');
  });

  it('validates salary amounts, currencies, and resume evidence before starting a request', () => {
    const source = toolSource('SalaryNegotiator.tsx');
    const beginIndex = source.indexOf('const alive = begin()');

    expect(source).toContain('Number.isFinite(offerAmount)');
    expect(source).toContain('offerAmount > MAX_OFFER_AMOUNT');
    expect(source).toContain('!isSupportedCurrency(nextCurrency)');
    expect(source.indexOf("setError(t('tool_resume_required_error'))")).toBeGreaterThan(-1);
    expect(source.indexOf("setError(t('tool_resume_required_error'))")).toBeLessThan(beginIndex);
    expect(source).toContain('normalizeSalaryResult');
  });

  it('requires a safe HTTPS reference and normalizes LinkedIn output', () => {
    const source = toolSource('LinkedInOptimizer.tsx');

    expect(source).toContain('safeHttpUrl(rawReferenceUrl)');
    expect(source).toContain("!/^https:\\/\\//i.test(rawReferenceUrl)");
    expect(source).toContain('pattern="https://.+"');
    expect(source).toContain('normalizeLinkedInResult');
    expect(source).toContain('role="tabpanel"');
    expect(source).toContain('aria-selected={linkedinTab ===');
  });

  it('normalizes nested networking, review, and learning-plan payloads', () => {
    const networking = toolSource('NetworkingAssistant.tsx');
    const performance = toolSource('PerformanceReviewPrep.tsx');
    const learning = toolSource('SkillLearningPlanner.tsx');

    expect(networking).toContain('normalizeNetworkingResult');
    expect(networking).toContain('MAX_TARGET_INPUT_LENGTH');
    expect(networking).toContain("setError(t('tool_resume_required_error'))");
    expect(performance).toContain('normalizePerformanceReviewResult');
    expect(performance).toContain('MAX_ACCOMPLISHMENTS_LENGTH');
    expect(performance).toContain("setError(t('tool_resume_required_error'))");
    expect(learning).toContain('normalizeLearningPlanResult');
    expect(learning).toContain('MAX_SKILL_LENGTH');
    expect(learning).toContain("setError(t('tool_resume_required_error'))");
  });

  it('sends only visible email fields and validates before starting generation', () => {
    const source = toolSource('EmailCrafter.tsx');
    const visibleFieldsIndex = source.indexOf('Object.fromEntries(requiredDetails.map');
    const beginIndex = source.indexOf('const alive = begin()');

    expect(visibleFieldsIndex).toBeGreaterThan(-1);
    expect(visibleFieldsIndex).toBeLessThan(beginIndex);
    expect(source).toContain('EMAIL_SCENARIO_VALUES.has(emailContext.scenario)');
    expect(source).toContain('normalizeEmailResult');
    expect(source).toContain('MAX_REPLY_LENGTH');
    expect(source).toContain("setError(t('tool_resume_required_error'))");
    expect(source).toContain('role="tabpanel"');
    expect(source).not.toContain('detailsForApi = emailDetails');
  });

  it('never auto-runs a handed-off cover-letter request', () => {
    const source = toolSource('CoverLetterGenerator.tsx');

    expect(source).toContain('consumedInitialInputRef');
    expect(source).toContain('normalizeCoverLetterLibrary');
    expect(source).toContain('if (initialInput.trim() || !saved || result) return');
    expect(source).not.toContain('lastAutoRunKey');
    expect(source).not.toContain('autoRunTimerRef');
    expect(source).not.toContain('void runTool(initialInput)');
  });

  it('normalizes every interview-prep collection and requires resume evidence', () => {
    const source = toolSource('InterviewPrep.tsx');

    expect(source).toContain('normalizeCandidatePrepKit');
    for (const field of ['resumeAnchors', 'rankedQuestions', 'followUpChains', 'gapRisks', 'sourceRefs']) {
      expect(source).toContain(`Array.isArray(source.${field})`);
    }
    expect(source).toContain("setError(t('tool_resume_required_error'))");
    expect(source).toContain('MAX_SOURCE_NOTES_LENGTH');
  });

  it('uses localized export headings for the three rich text planners', () => {
    const performance = toolSource('PerformanceReviewPrep.tsx');
    const learning = toolSource('SkillLearningPlanner.tsx');
    const interview = toolSource('InterviewPrep.tsx');

    expect(performance).not.toContain('## Opening Statement');
    expect(performance).toContain("t('tool_perf_review_opening_label')");
    expect(learning).not.toContain('# Learning Plan:');
    expect(learning).toContain("t('tool_skill_planner_results_title')");
    expect(interview).not.toContain('# Interview Prep Brief');
    expect(interview).toContain("t('tool_interview_prep_block_topics_title')");
  });
});
