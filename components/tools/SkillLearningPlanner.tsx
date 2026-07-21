import React, { useState, useMemo, useEffect, useRef } from 'react';
import { BookOpen, CheckCircle2, Clock3, Flag, GraduationCap, Lightbulb, Target } from 'lucide-react';
import { generateLearningPlan } from '../../services/aiClient';
import type { LearningPlanResult } from '../../types';
import StagedLoader from '../StagedLoader';
import { useCancellableLoading } from '../../hooks/useCancellableLoading';
import { DownloadButtons, SavedResultBar, ToolError } from './ToolUtils';
import { deriveSmartSuggestions, SmartSuggestChips } from '../SmartSuggest';
import { useToolResults } from '../../contexts/ToolResultsContext';
import { parseToolLearningContext, type ToolLearningContext } from '../../lib/toolPrefill';

interface SkillLearningPlannerProps {
  resumeText: string;
  market: string;
  initialInput?: string;
  t: (key: string) => string;
}

const SAMPLE_SKILL = 'Python for Data Analysis';
const MAX_SKILL_LENGTH = 200;
const MAX_RESULT_TEXT_LENGTH = 8_000;

const boundedText = (value: unknown, maxLength = MAX_RESULT_TEXT_LENGTH) =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const boundedTextArray = (value: unknown, maxItems = 24) =>
  Array.isArray(value)
    ? value.slice(0, maxItems).map((item) => boundedText(item)).filter(Boolean)
    : [];

const normalizeLearningPlanResult = (value: unknown): LearningPlanResult | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const learningPhases = Array.isArray(raw.learningPhases)
    ? raw.learningPhases
      .slice(0, 12)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const phase = item as Record<string, unknown>;
        const normalized = {
          phaseTitle: boundedText(phase.phaseTitle, 500),
          duration: boundedText(phase.duration, 200),
          keyActivities: boundedTextArray(phase.keyActivities),
          milestone: boundedText(phase.milestone),
        };
        return normalized.phaseTitle || normalized.keyActivities.length || normalized.milestone
          ? normalized
          : null;
      })
      .filter((item): item is LearningPlanResult['learningPhases'][number] => item !== null)
    : [];
  const result: LearningPlanResult = {
    skill: boundedText(raw.skill, MAX_SKILL_LENGTH),
    summary: boundedText(raw.summary),
    learningPhases,
    suggestedProjects: boundedTextArray(raw.suggestedProjects),
  };
  return result.skill
    && result.summary
    && (result.learningPhases.length || result.suggestedProjects.length)
    ? result
    : null;
};

const CardShell: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <section className={`rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}>
    {children}
  </section>
);

const MetricTile: React.FC<{ label: string; value: string | number; icon: React.ElementType }> = ({ label, value, icon: Icon }) => (
  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
    <div className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400">
      <Icon className="h-4 w-4 text-violet-700 dark:text-violet-300" />
      {label}
    </div>
    <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">{value}</p>
  </div>
);

const SkillLearningPlanner: React.FC<SkillLearningPlannerProps> = ({ resumeText, market, initialInput = '', t }) => {
  const { loading, begin, end, cancel } = useCancellableLoading();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LearningPlanResult | null>(null);
  const { canSave, saved, saveState, persist, clear } = useToolResults<LearningPlanResult>();
  const [fromSaved, setFromSaved] = useState(false);
  const [skill, setSkill] = useState('');
  const [prefillContext, setPrefillContext] = useState<ToolLearningContext | null>(null);
  const consumedInitialInputRef = useRef('');

  const suggestions = useMemo(() => deriveSmartSuggestions(resumeText), [resumeText]);

  useEffect(() => {
    const value = initialInput.trim().slice(0, 20_000);
    if (!value || consumedInitialInputRef.current === value) return;
    const context = parseToolLearningContext(value);
    if (!context.skill) return;

    consumedInitialInputRef.current = value;
    const nextContext: ToolLearningContext = {
      skill: context.skill.slice(0, MAX_SKILL_LENGTH),
      targetRole: boundedText(context.targetRole, 500),
      reason: boundedText(context.reason, 2_000),
    };
    setSkill(nextContext.skill || '');
    setPrefillContext(nextContext);
    setResult(null);
    setFromSaved(false);
    setError(null);
  }, [initialInput]);

  useEffect(() => {
    if (initialInput.trim()) return;
    const normalized = saved && !result ? normalizeLearningPlanResult(saved.result) : null;
    if (normalized) {
      setResult(normalized);
      setFromSaved(true);
    }
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetResult = () => {
    setResult(null);
    setFromSaved(false);
    setError(null);
    setPrefillContext(null);
  };

  const runTool = async (skillInput = skill) => {
    const nextSkill = skillInput.trim().slice(0, MAX_SKILL_LENGTH);
    if (!nextSkill) {
      setError(t('tool_skill_planner_error_required'));
      return;
    }
    if (!resumeText.trim()) {
      setError(t('tool_resume_required_error'));
      return;
    }
    setSkill(nextSkill);
    const alive = begin();
    setError(null);
    setResult(null);
    try {
      const apiResult = normalizeLearningPlanResult(
        await generateLearningPlan(resumeText, nextSkill, market),
      );
      if (!alive()) return;
      if (!apiResult) throw new Error(t('ai_error_empty_response'));
      setResult(apiResult);
      setFromSaved(false);
      persist(apiResult);
    } catch (err) {
      if (alive()) setError(err instanceof Error ? err.message : t('unexpected_error'));
    } finally {
      if (alive()) end();
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void runTool();
  };

  const formatForDownload = (res: LearningPlanResult): string => {
    let content = `# ${t('tool_skill_planner_results_title').replace('{skill}', res.skill)}\n\n`;
    content += `${res.summary}\n\n`;
    content += `## ${t('tool_skill_planner_key_activities')}\n`;
    res.learningPhases.forEach((phase, i) => {
      content += `### ${i + 1}. ${phase.phaseTitle} (${phase.duration})\n`;
      phase.keyActivities.forEach((activity) => { content += `* ${activity}\n`; });
      content += `\n**${t('tool_skill_planner_milestone')}:** ${phase.milestone}\n\n`;
    });
    content += `## ${t('tool_skill_planner_suggested_projects')}\n`;
    res.suggestedProjects.forEach((project) => { content += `* ${project}\n`; });
    return content;
  };

  const renderInput = () => (
    <div data-qa="skill-learning-plan-tool" data-qa-tool-state="input" className="mx-auto max-w-6xl space-y-5">
      <CardShell className="overflow-hidden">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_380px]">
          <form onSubmit={handleSubmit} className="min-w-0 p-5 sm:p-6 lg:p-8">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-violet-700 dark:text-violet-300">
              <GraduationCap className="h-4 w-4" />
              {t('tool_skill_learning_plan_title')}
            </div>
            <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100 sm:text-3xl">
              {t('tool_skill_planner_intro_line1')}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              {t('tool_skill_planner_intro_line2')}
            </p>

            <div className="mt-7 space-y-4">
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label htmlFor="skill-to-learn" className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {t('tool_skill_planner_skill_label')}
                  </label>
                  <button
                    type="button"
                    onClick={() => { setSkill(SAMPLE_SKILL); setPrefillContext(null); }}
                    data-qa="skill-learning-plan-try-example"
                    className="min-h-11 px-2 text-sm font-semibold text-violet-700 transition hover:text-violet-800 dark:text-violet-300 dark:hover:text-violet-200"
                  >
                    {t('try_example')}
                  </button>
                </div>
                <input
                  type="text"
                  id="skill-to-learn"
                  data-qa="skill-learning-plan-skill"
                  value={skill}
                  onChange={(event) => { setSkill(event.target.value); setPrefillContext(null); }}
                  maxLength={MAX_SKILL_LENGTH}
                  required
                  className="block min-h-[48px] w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-950 shadow-sm transition placeholder:text-slate-400 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                  placeholder={t('tool_skill_planner_skill_placeholder')}
                />
              </div>

              {prefillContext && (
                <div
                  data-qa="skill-learning-plan-prefill-note"
                  className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-950 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-100"
                >
                  <p className="font-semibold">{t('tool_skill_planner_prefill_label')}</p>
                  {prefillContext.targetRole && (
                    <p className="mt-1 text-xs leading-5 text-violet-800 dark:text-violet-200">
                      {t('tool_skill_planner_prefill_target').replace('{role}', prefillContext.targetRole)}
                    </p>
                  )}
                  {prefillContext.reason && (
                    <p className="mt-1 text-xs leading-5 text-violet-800 dark:text-violet-200">{prefillContext.reason}</p>
                  )}
                </div>
              )}

              {resumeText && (
                <SmartSuggestChips
                  items={suggestions.skills}
                   onPick={(value) => { setSkill(value.slice(0, MAX_SKILL_LENGTH)); setPrefillContext(null); }}
                  label={t('smart_suggest_skills')}
                />
              )}

              {error && (
                <ToolError
                  message={error}
                  onRetry={() => void runTool()}
                  retryLabel={t('try_again')}
                  retryDisabled={loading}
                />
              )}

              <button
                type="submit"
                data-qa="skill-learning-plan-generate"
                disabled={loading}
                className="inline-flex min-h-[48px] w-full items-center justify-center rounded-lg bg-violet-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-violet-400"
              >
                {loading ? t('tool_skill_planner_generating_button') : t('tool_skill_planner_generate_button')}
              </button>
            </div>
          </form>

          <aside className="border-t border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950/40 sm:p-6 lg:border-l lg:border-t-0">
            <div className="rounded-lg border border-violet-100 bg-violet-50 p-4 text-violet-950 dark:border-violet-900/50 dark:bg-violet-950/30 dark:text-violet-100">
              <div className="flex items-start gap-3">
                <Target className="mt-0.5 h-5 w-5 shrink-0" />
                <p className="text-sm font-semibold leading-relaxed">{t('tool_skill_planner_setup_desc')}</p>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {([
                { label: t('tool_skill_planner_key_activities'), Icon: BookOpen },
                { label: t('tool_skill_planner_milestone'), Icon: Flag },
                { label: t('tool_skill_planner_suggested_projects'), Icon: Lightbulb },
              ] satisfies Array<{ label: string; Icon: React.ElementType }>).map(({ label, Icon }, index) => (
                <div key={label} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {index + 1}
                  </span>
                  <Icon className="h-4 w-4 shrink-0 text-violet-700 dark:text-violet-300" />
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{label}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </CardShell>
    </div>
  );

  const renderResult = () => {
    if (!result) return null;

    const learningPhases = result.learningPhases ?? [];
    const suggestedProjects = result.suggestedProjects ?? [];
    const downloadSkill = result.skill.replace(/\s/g, '_');

    return (
      <div data-qa="skill-learning-plan-tool" data-qa-tool-state="result" className="mx-auto max-w-7xl space-y-5 break-words animate-fade-in">
        <SavedResultBar
          t={t}
          canSave={canSave}
          isSaved={fromSaved}
          savedAt={saved?.savedAt ?? null}
          saveState={saveState}
          onTryNext={resetResult}
          onClearSaved={() => { clear(); setFromSaved(false); }}
        />

        <CardShell className="overflow-hidden">
          <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 p-5 sm:p-6">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-violet-700 dark:text-violet-300">
                <GraduationCap className="h-4 w-4" />
                {t('tool_skill_learning_plan_title')}
              </div>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100 sm:text-3xl">
                {result.skill}
              </h2>
              <p className="mt-4 max-w-4xl break-words text-base leading-relaxed text-slate-700 [overflow-wrap:anywhere] dark:text-slate-300">{result.summary}</p>
            </div>
            <div className="border-t border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950/40 sm:p-6 xl:border-l xl:border-t-0">
              <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                <MetricTile label={t('tool_skill_planner_key_activities')} value={learningPhases.reduce((sum, phase) => sum + (phase.keyActivities?.length ?? 0), 0)} icon={BookOpen} />
                <MetricTile label={t('tool_skill_planner_milestone')} value={learningPhases.length} icon={CheckCircle2} />
                <MetricTile label={t('tool_skill_planner_suggested_projects')} value={suggestedProjects.length} icon={Lightbulb} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <DownloadButtons textContent={formatForDownload(result)} baseFilename={`learning_plan_${downloadSkill}`} />
                <button
                  type="button"
                  onClick={resetResult}
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {t('tool_start_over')}
                </button>
              </div>
            </div>
          </div>
        </CardShell>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <CardShell className="p-5">
            <div className="mb-5">
              <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{t('tool_skill_planner_results_title').replace('{skill}', result.skill)}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{t('tool_skill_planner_intro_line2')}</p>
            </div>
            <div className="grid gap-4 2xl:grid-cols-2">
              {learningPhases.map((phase, index) => (
                <article key={`${phase.phaseTitle}-${index}`} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-700 text-xs font-semibold text-white">{index + 1}</span>
                        <h4 className="break-words text-base font-semibold text-slate-950 [overflow-wrap:anywhere] dark:text-slate-100">{phase.phaseTitle}</h4>
                      </div>
                    </div>
                    <span className="inline-flex w-fit items-center gap-1 rounded-lg bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700 dark:bg-violet-900/30 dark:text-violet-200">
                      <Clock3 className="h-3.5 w-3.5" />
                      {phase.duration}
                    </span>
                  </div>

                  <div className="mt-4 space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('tool_skill_planner_key_activities')}</p>
                    {(phase.keyActivities ?? []).map((activity, activityIndex) => (
                      <div key={activityIndex} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                        <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-violet-700 dark:text-violet-300" />
                        <span className="min-w-0 break-words [overflow-wrap:anywhere]">{activity}</span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" />
                      <p className="text-sm leading-relaxed text-emerald-900 dark:text-emerald-200">
                        <strong>{t('tool_skill_planner_milestone')}:</strong> {phase.milestone}
                      </p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </CardShell>

          <CardShell className="p-5">
            <div className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-violet-700 dark:text-violet-300" />
              <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{t('tool_skill_planner_suggested_projects')}</h3>
            </div>
            <div className="mt-4 space-y-3">
              {suggestedProjects.map((project, index) => (
                <div key={index} className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
                  <div className="flex items-start gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-xs font-semibold text-violet-700 ring-1 ring-slate-200 dark:bg-slate-950 dark:text-violet-300 dark:ring-slate-700">
                      {index + 1}
                    </span>
                    <p className="min-w-0 break-words text-sm leading-relaxed text-slate-700 [overflow-wrap:anywhere] dark:text-slate-300">{project}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardShell>
        </div>

        <button
          type="button"
          onClick={resetResult}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {t('tool_skill_planner_plan_another')}
        </button>
      </div>
    );
  };

  if (loading) {
    return (
      <StagedLoader
        title={t('tool_skill_planner_loader_title')}
        icon={<GraduationCap />}
        accent="violet"
        steps={[
          t('tool_skill_planner_step1'),
          t('tool_skill_planner_step2'),
          t('tool_skill_planner_step3'),
        ]}
        onCancel={cancel}
        cancelLabel={t('tool_loader_hide_button')}
        cancelHint={t('tool_loader_hide_hint')}
      />
    );
  }

  return result ? renderResult() : renderInput();
};

export default SkillLearningPlanner;
