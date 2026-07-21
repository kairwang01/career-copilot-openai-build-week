import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  BookOpen,
  Briefcase,
  CheckCircle2,
  Clock3,
  Code2,
  Compass,
  Flag,
  Info,
  Layers3,
  Lightbulb,
  Loader2,
  Network,
  Target,
} from 'lucide-react';
import { generateCareerPath, generateSkillBridgeProject } from '../../services/aiClient';
import type { CareerPathResult, RoadmapActionableStep, SkillBridgeProject } from '../../types';
import StagedLoader from '../StagedLoader';
import { useCancellableLoading } from '../../hooks/useCancellableLoading';
import { DownloadButtons, SavedResultBar, ToolError } from './ToolUtils';
import { useToolResults } from '../../contexts/ToolResultsContext';
import type { AppSession as Session } from '../../lib/data';
import { deriveSmartSuggestions, SmartSuggestChips } from '../SmartSuggest';
import { buildLearningPlanContextFromSkillGap } from '../../lib/toolPrefill';
import {
  listCareerPathAnalyses,
  saveCareerPathAnalysis,
  deleteCareerPathAnalysis,
  type SavedCareerPathAnalysis,
} from '../../lib/careerPathAnalyses';
import { normalizeCareerPathResult } from '../../lib/aiResultGuards';
import { useLocalization } from '../../hooks/useLocalization';
import { LanguageSyncBanner } from '../LanguageSyncBanner';
import { TOOL_CREDIT_COSTS } from '../../config/credits';

interface CareerPathPlannerProps {
  resumeText: string;
  market: string;
  t: (key: string) => string;
  openTool: (tool: string, input?: string) => void;
  session: Session | null;
}

type SavedCareerPathResult = CareerPathResult & {
  targetRole?: string;
  resultLanguage?: string;
};

const SAMPLE_ROLE = 'Senior Product Manager';

const actionIconMap: Record<RoadmapActionableStep['type'], React.ElementType> = {
  course: BookOpen,
  certification: CheckCircle2,
  project: Code2,
  networking: Network,
  'self-study': Layers3,
};

const actionLabelKeyMap: Record<RoadmapActionableStep['type'], string> = {
  course: 'tool_career_path_step_type_course',
  certification: 'tool_career_path_step_type_certification',
  project: 'tool_career_path_step_type_project',
  networking: 'tool_career_path_step_type_networking',
  'self-study': 'tool_career_path_step_type_self_study',
};

const CardShell: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <section className={`rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}>
    {children}
  </section>
);

const MetricTile: React.FC<{ label: string; value: string | number; icon: React.ElementType }> = ({ label, value, icon: Icon }) => (
  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
    <div className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400">
      <Icon className="h-4 w-4 text-blue-700 dark:text-blue-400" />
      {label}
    </div>
    <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">{value}</p>
  </div>
);

const EmptyResultBlock: React.FC<{ title: string; description: string; icon: React.ElementType }> = ({ title, description, icon: Icon }) => (
  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-center dark:border-slate-700 dark:bg-slate-800/40">
    <Icon className="mx-auto h-5 w-5 text-slate-400 dark:text-slate-500" />
    <p className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-200">{title}</p>
    <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>
  </div>
);

const CareerPathPlanner: React.FC<CareerPathPlannerProps> = ({ resumeText, market, t, openTool, session }) => {
  const { loading, begin, end, cancel } = useCancellableLoading();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SavedCareerPathResult | null>(null);
  const { canSave, saved, saveState, persist, clear } = useToolResults<SavedCareerPathResult>();
  const [fromSaved, setFromSaved] = useState(false);
  const [desiredRole, setDesiredRole] = useState('');
  const { currentLang } = useLocalization();
  const [langSyncDismissed, setLangSyncDismissed] = useState<string | null>(null);

  const [generatingProjectForSkill, setGeneratingProjectForSkill] = useState<string | null>(null);
  const [generatedProject, setGeneratedProject] = useState<SkillBridgeProject | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [lastProjectSkill, setLastProjectSkill] = useState<string | null>(null);
  const projectRunRef = useRef(0);

  useEffect(() => () => {
    projectRunRef.current += 1;
  }, []);

  // SCRUM-30: "My Roadmaps" — persist each generated roadmap and let the
  // candidate revisit past analyses for free (owner-scoped Firestore subcollection).
  const uid = session?.user?.id ?? null;
  const [showSaved, setShowSaved] = useState(false);
  const [savedRoadmaps, setSavedRoadmaps] = useState<SavedCareerPathAnalysis[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);

  const refreshSavedRoadmaps = async () => {
    if (!uid) return;
    setSavedLoading(true);
    const rows = await listCareerPathAnalyses(uid);
    setSavedRoadmaps(rows);
    setSavedLoading(false);
  };

  const openSavedRoadmaps = () => {
    setShowSaved(true);
    refreshSavedRoadmaps();
  };

  const handleOpenSavedRoadmap = (entry: SavedCareerPathAnalysis) => {
    setDesiredRole(entry.desired_role);
    setResult({ ...entry.result, targetRole: entry.desired_role });
    setFromSaved(true);
    setError(null);
    setShowSaved(false);
  };

  const handleDeleteSavedRoadmap = async (id: string) => {
    if (!uid) return;
    setSavedRoadmaps((rows) => rows.filter((r) => r.id !== id));
    await deleteCareerPathAnalysis(uid, id);
  };

  // SmartSuggest: derive role chips from resume (pure, no AI)
  const suggestions = useMemo(() => deriveSmartSuggestions(resumeText), [resumeText]);

  useEffect(() => {
    if (saved && !result) {
      setResult({
        ...normalizeCareerPathResult(saved.result),
        targetRole: typeof saved.result.targetRole === 'string' ? saved.result.targetRole : undefined,
        resultLanguage: typeof saved.result.resultLanguage === 'string' ? saved.result.resultLanguage : currentLang,
      });
      setFromSaved(true);
    }
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetResult = () => {
    setResult(null);
    setFromSaved(false);
    setError(null);
    setGeneratedProject(null);
    setProjectError(null);
    setLastProjectSkill(null);
    setLangSyncDismissed(null);
  };

  const handleGenerateProject = async (skill: string) => {
    const runId = projectRunRef.current + 1;
    projectRunRef.current = runId;
    setLastProjectSkill(skill);
    setGeneratingProjectForSkill(skill);
    setGeneratedProject(null);
    setProjectError(null);
    try {
      const project = await generateSkillBridgeProject(resumeText, desiredRole, skill);
      if (projectRunRef.current !== runId) return;
      setGeneratedProject(project);
    } catch (err) {
      if (projectRunRef.current === runId) {
        setProjectError(err instanceof Error ? err.message : t('tool_career_path_project_failed'));
      }
    } finally {
      if (projectRunRef.current === runId) setGeneratingProjectForSkill(null);
    }
  };

  const openLearningPlanForGap = (gap: CareerPathResult['overallSkillGaps'][number], targetRole?: string) => {
    openTool('skill-learning-plan', buildLearningPlanContextFromSkillGap(gap, targetRole));
  };

  const runTool = async (input: string) => {
    const targetRole = input.trim();
    if (!targetRole) {
      setError(t('tool_career_path_error_required'));
      return;
    }
    if (!session) {
      setError(t('error_login_required'));
      return;
    }
    setDesiredRole(targetRole);
    const alive = begin();
    setError(null);
    setResult(null);
    try {
      const apiResult = await generateCareerPath(resumeText, targetRole, market, session, currentLang);
      if (!alive()) return;
      const nextResult: SavedCareerPathResult = {
        ...normalizeCareerPathResult(apiResult),
        targetRole,
        resultLanguage: currentLang,
      };
      setResult(nextResult);
      setFromSaved(false);
      persist(nextResult);
      // SCRUM-30: persist this roadmap to "My Roadmaps" so it can be revisited
      // later. Best-effort and non-throwing — a failed save must not break the run.
      if (uid) {
        void saveCareerPathAnalysis(uid, targetRole, apiResult).then((id) => {
          if (id) setSavedRoadmaps((rows) => [
            { id, desired_role: targetRole, created_at: Date.now(), result: apiResult },
            ...rows.filter((r) => r.id !== id),
          ]);
        });
      }
    } catch (err) {
      if (alive()) setError(err instanceof Error ? err.message : t('unexpected_error'));
    } finally {
      if (alive()) end();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runTool(desiredRole);
  };

  const getStepTypeLabel = (type: RoadmapActionableStep['type']) => t(actionLabelKeyMap[type]);

  const formatForDownload = (res: SavedCareerPathResult): string => {
    const {
      overallSkillGaps = [],
      roadmap = [],
      bridgeRoles = [],
    } = res;
    const targetRole = res.targetRole || desiredRole || t('tool_career_path_target_role_fallback');
    let content = `# ${t('tool_career_path_download_title').replace('{role}', targetRole)}\n\n`;
    content += `## ${t('tool_career_path_summary')}\n${res.summary}\n\n`;
    content += `## ${t('tool_career_path_skill_gaps')}\n`;
    overallSkillGaps.forEach((gap) => {
      content += `* **${gap.skill}:** ${gap.reason}\n`;
    });
    content += `\n## ${t('tool_career_path_roadmap_title')}\n`;
    roadmap.forEach((phase) => {
      content += `### ${phase.phaseTitle} (${phase.estimatedDuration})\n`;
      content += `**${t('tool_career_path_goal')}:** ${phase.goal}\n\n`;
      content += `**${t('tool_career_path_actionable_steps')}:**\n`;
      (phase.actionableSteps ?? []).forEach((step) => {
        content += `* **${getStepTypeLabel(step.type)}:** ${step.description}\n`;
        if (step.resources && step.resources.length > 0) {
          content += `  * ${t('tool_career_path_resources')}: ${step.resources.join(', ')}\n`;
        }
      });
      content += `\n**${t('tool_career_path_milestones')}:**\n`;
      (phase.milestones ?? []).forEach((milestone) => {
        content += `* ${milestone}\n`;
      });
      content += `\n`;
    });
    content += `## ${t('tool_career_path_bridge_roles')}\n`;
    bridgeRoles.forEach((role) => {
      content += `* **${role.title}:** ${role.reason}\n`;
    });
    return content;
  };

  const renderInput = () => (
    <div data-qa="career-path-tool" data-qa-tool-state="input" className="mx-auto max-w-6xl space-y-5">
      <CardShell className="overflow-hidden">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_380px]">
          <form onSubmit={handleSubmit} className="min-w-0 p-5 sm:p-6 lg:p-8">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-blue-700 dark:text-blue-400">
              <Compass className="h-4 w-4" />
              {t('tool_career_path_title')}
            </div>
            <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100 sm:text-3xl">
              {t('tool_career_path_intro_line1')}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              {t('tool_career_path_intro_line2')}
            </p>

            <div className="mt-7 space-y-4">
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label htmlFor="career-path-target-role" className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {t('ws_plan_target_path')}
                  </label>
                  <div className="flex items-center gap-4">
                    {uid && (
                      <button
                        type="button"
                        onClick={openSavedRoadmaps}
                        data-qa="career-path-my-roadmaps"
                        className="text-sm font-semibold text-slate-600 transition hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                      >
                        {t('tool_career_path_saved_button')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setDesiredRole(SAMPLE_ROLE)}
                      data-qa="career-path-try-example"
                      className="text-sm font-semibold text-blue-700 transition hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      {t('try_example')}
                    </button>
                  </div>
                </div>
                <input
                  id="career-path-target-role"
                  data-qa="career-path-target-role"
                  type="text"
                  className="block min-h-[48px] w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-950 shadow-sm transition placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                  placeholder={t('tool_career_path_placeholder')}
                  value={desiredRole}
                  onChange={(e) => setDesiredRole(e.target.value)}
                  required
                />
              </div>

              {resumeText && (
                <SmartSuggestChips
                  items={suggestions.roles}
                  onPick={(v) => setDesiredRole(v)}
                  label={t('smart_suggest_target_roles')}
                />
              )}

              {error && (
                <ToolError
                  message={error}
                  onRetry={() => void runTool(desiredRole)}
                  retryLabel={t('try_again')}
                  retryDisabled={loading}
                />
              )}

              <button
                type="submit"
                data-qa="career-path-generate"
                disabled={loading}
                className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-blue-400"
              >
                {loading ? t('tool_career_path_analyzing_button') : t('tool_career_path_generate_button')}
              </button>
            </div>
          </form>

          <aside className="border-t border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950/40 sm:p-6 lg:border-l lg:border-t-0">
            <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200">
              <div className="flex items-start gap-3">
                <Target className="mt-0.5 h-5 w-5 shrink-0" />
                <p className="text-sm font-semibold leading-relaxed">{t('tool_career_path_setup_desc')}</p>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {([
                { label: t('tool_career_path_skill_gaps'), Icon: Lightbulb },
                { label: t('tool_career_path_bridge_roles'), Icon: Briefcase },
                { label: t('tool_career_path_roadmap_title'), Icon: Flag },
              ] satisfies Array<{ label: string; Icon: React.ElementType }>).map(({ label, Icon }, index) => {
                return (
                  <div key={String(label)} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      {index + 1}
                    </span>
                    <Icon className="h-4 w-4 shrink-0 text-blue-700 dark:text-blue-400" />
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{label}</span>
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      </CardShell>
    </div>
  );

  const renderProjectPanel = () => {
    if (!generatedProject && !projectError) return null;

    return (
      <CardShell className="p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
            <Code2 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{t('tool_career_path_project_title')}</h3>
            {projectError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-300">
                <p className="text-sm leading-relaxed">{projectError}</p>
                {lastProjectSkill && (
                  <button
                    type="button"
                    onClick={() => handleGenerateProject(lastProjectSkill)}
                    className="mt-3 rounded-lg bg-red-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-red-800"
                  >
                    {t('try_again')}
                  </button>
                )}
              </div>
            )}
            {generatedProject && (
              <div className="mt-4 space-y-4">
                <div>
                  <h4 data-qa="career-path-generated-project-title" className="font-semibold text-slate-950 dark:text-slate-100">{generatedProject.projectTitle}</h4>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{generatedProject.objective}</p>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('tool_career_path_project_features')}</p>
                    <ul className="mt-2 space-y-1 text-sm text-slate-700 dark:text-slate-300">
                      {(generatedProject.keyFeatures ?? []).map((feature, index) => <li key={index}>{feature}</li>)}
                    </ul>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('tool_career_path_project_tools')}</p>
                    <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">{(generatedProject.suggestedTechStack ?? []).join(', ')}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('tool_career_path_project_showcase')}</p>
                    <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">{generatedProject.showcaseChallenge}</p>
                  </div>
                </div>
                <button
                  type="button"
                  data-qa="career-path-add-project-to-portfolio"
                  onClick={() => openTool('website-builder', JSON.stringify(generatedProject))}
                  className="inline-flex min-h-10 items-center justify-center rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800"
                >
                  {t('tool_career_path_add_to_portfolio')}
                </button>
              </div>
            )}
          </div>
        </div>
      </CardShell>
    );
  };

  // SCRUM-30: "My Roadmaps" — list of saved roadmaps with reopen/delete.
  const renderSaved = () => (
    <div data-qa="career-path-tool" data-qa-tool-state="saved" className="mx-auto max-w-6xl space-y-5">
      <CardShell className="p-5 sm:p-6 lg:p-8">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-blue-700 dark:text-blue-400">
              <Compass className="h-4 w-4" />
              {t('tool_career_path_saved_title')}
            </div>
            {savedRoadmaps.length > 0 && (
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                {t('tool_career_path_saved_count').replace('{count}', String(savedRoadmaps.length))}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowSaved(false)}
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {t('tool_career_path_new_button')}
          </button>
        </div>

        <div className="mt-6">
          {savedLoading ? (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">{t('tool_career_path_saved_loading')}</p>
          ) : savedRoadmaps.length === 0 ? (
            <EmptyResultBlock
              title={t('tool_career_path_saved_title')}
              description={t('tool_career_path_saved_empty')}
              icon={Compass}
            />
          ) : (
            <ul className="space-y-3">
              {savedRoadmaps.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-950 dark:text-slate-100">{entry.desired_role}</p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {new Date(entry.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenSavedRoadmap(entry)}
                      className="inline-flex min-h-9 items-center justify-center rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-800"
                    >
                      {t('tool_career_path_saved_open')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteSavedRoadmap(entry.id)}
                      className="inline-flex min-h-9 items-center justify-center rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      {t('tool_career_path_saved_delete')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardShell>
    </div>
  );

  const renderResult = () => {
    if (!result) return null;

    const {
      summary = '',
      overallSkillGaps = [],
      roadmap = [],
      bridgeRoles = [],
    } = result;

    const targetRole = result.targetRole || desiredRole;
    const downloadRole = (targetRole || 'target_role').replace(/\s/g, '_');
    const primaryGap = overallSkillGaps[0] ?? null;
    const firstRoadmapPhase = roadmap[0] ?? null;

    return (
      <div data-qa="career-path-tool" data-qa-tool-state="result" className="mx-auto max-w-7xl space-y-5 animate-fade-in">
        {result.resultLanguage && result.resultLanguage !== currentLang && langSyncDismissed !== currentLang && (
          <LanguageSyncBanner
            contentLang={result.resultLanguage}
            uiLang={currentLang}
            availableLangs={[result.resultLanguage]}
            creditCost={TOOL_CREDIT_COSTS['career-path']}
            canPersist={canSave}
            busy={loading}
            t={t}
            onSwitch={() => {}}
            onRegenerate={() => { void runTool(targetRole); }}
            onDismiss={() => setLangSyncDismissed(currentLang)}
          />
        )}
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
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-blue-700 dark:text-blue-400">
                <Compass className="h-4 w-4" />
                {t('tool_career_path_results_title')}
              </div>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100 sm:text-3xl">
                {targetRole || t('tool_career_path_title')}
              </h2>
              <p className="mt-4 max-w-4xl text-base leading-relaxed text-slate-700 dark:text-slate-300">{summary}</p>
            </div>
            <div className="border-t border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950/40 sm:p-6 xl:border-l xl:border-t-0">
              <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                <MetricTile label={t('tool_career_path_skill_gaps')} value={overallSkillGaps.length} icon={Lightbulb} />
                <MetricTile label={t('tool_career_path_bridge_roles')} value={bridgeRoles.length} icon={Briefcase} />
                <MetricTile label={t('tool_career_path_roadmap_title')} value={roadmap.length} icon={Flag} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <DownloadButtons textContent={formatForDownload(result)} baseFilename={`career_roadmap_for_${downloadRole}`} />
                {uid && (
                  <button
                    type="button"
                    onClick={openSavedRoadmaps}
                    className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    {t('tool_career_path_saved_button')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={resetResult}
                  className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {t('tool_start_over')}
                </button>
              </div>
            </div>
          </div>
        </CardShell>

        {(primaryGap || firstRoadmapPhase) && (
          <CardShell className="p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400">
                  <Target className="h-4 w-4" />
                  {t('tool_career_path_actionable_steps')}
                </div>
                <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
                  {primaryGap ? primaryGap.skill : firstRoadmapPhase?.phaseTitle}
                </h3>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                  {primaryGap
                    ? primaryGap.reason
                    : firstRoadmapPhase?.goal}
                </p>
              </div>
              {primaryGap && (
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openLearningPlanForGap(primaryGap, targetRole)}
                    data-qa="career-path-build-learning-plan"
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800"
                  >
                    <BookOpen className="h-4 w-4" aria-hidden="true" />
                    {t('tool_career_path_learning_plan_button')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleGenerateProject(primaryGap.skill)}
                    disabled={generatingProjectForSkill === primaryGap.skill}
                    data-qa="career-path-generate-project"
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-wait disabled:bg-emerald-400"
                  >
                    {generatingProjectForSkill === primaryGap.skill ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        <span>{t('tool_career_path_project_generating_button')}</span>
                      </>
                    ) : t('tool_career_path_project_button')}
                  </button>
                </div>
              )}
            </div>
          </CardShell>
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <CardShell className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{t('tool_career_path_skill_gaps')}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{t('tool_career_path_skill_gaps_desc')}</p>
              </div>
            </div>
            {overallSkillGaps.length > 0 ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {overallSkillGaps.map((gap, index) => (
                  <div
                    key={`${gap.skill}-${index}`}
                    data-qa="career-path-gap-card"
                    className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20"
                  >
                    <div className="min-w-0">
                      <p
                        data-qa="career-path-gap-skill"
                        className="break-words font-semibold text-amber-950 [overflow-wrap:anywhere] dark:text-amber-100"
                      >
                        {gap.skill}
                      </p>
                      <p
                        data-qa="career-path-gap-reason"
                        className="mt-2 whitespace-pre-line break-words text-sm leading-relaxed text-amber-900 [overflow-wrap:anywhere] dark:text-amber-200"
                      >
                        {gap.reason}
                      </p>
                      <div data-qa="career-path-gap-actions" className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openLearningPlanForGap(gap, targetRole)}
                          data-qa="career-path-build-learning-plan"
                          className="inline-flex min-h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-center text-xs font-semibold leading-snug text-violet-800 transition hover:bg-violet-50 dark:border-violet-800 dark:bg-slate-950 dark:text-violet-200 dark:hover:bg-violet-950/30"
                        >
                          <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                          {t('tool_career_path_learning_plan_button')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleGenerateProject(gap.skill)}
                          disabled={generatingProjectForSkill === gap.skill}
                          data-qa="career-path-generate-project"
                          className="inline-flex min-h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-center text-xs font-semibold leading-snug text-amber-800 transition hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60 dark:border-amber-800 dark:bg-slate-950 dark:text-amber-200 dark:hover:bg-amber-950/30"
                        >
                          {generatingProjectForSkill === gap.skill ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                              <span>{t('tool_career_path_project_generating_button')}</span>
                            </>
                          ) : t('tool_career_path_project_button')}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4">
                <EmptyResultBlock
                  icon={CheckCircle2}
                  title={t('tool_career_path_skill_gaps')}
                  description={t('tool_career_path_skill_gaps_empty_desc')}
                />
              </div>
            )}
          </CardShell>

          <CardShell className="p-5">
            <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{t('tool_career_path_bridge_roles')}</h3>
            {bridgeRoles.length > 0 ? (
              <div className="mt-4 space-y-3">
                {bridgeRoles.map((role) => (
                  <div key={role.title} className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
                    <div className="flex items-center gap-2">
                      <Briefcase className="h-4 w-4 shrink-0 text-blue-700 dark:text-blue-400" />
                      <p className="font-semibold text-slate-950 dark:text-slate-100">{role.title}</p>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{role.reason}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4">
                <EmptyResultBlock
                  icon={Briefcase}
                  title={t('tool_career_path_bridge_roles')}
                  description={t('tool_career_path_bridge_roles_empty_desc')}
                />
              </div>
            )}
          </CardShell>
        </div>

        {renderProjectPanel()}

        <CardShell className="p-5">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{t('tool_career_path_roadmap_title')}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{t('ws_plan_four_week_desc')}</p>
            </div>
          </div>
          {roadmap.length > 0 ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {roadmap.map((phase, index) => (
                <article key={`${phase.phaseTitle}-${index}`} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-700 text-xs font-semibold text-white">{index + 1}</span>
                      <h4 className="text-base font-semibold text-slate-950 dark:text-slate-100">{phase.phaseTitle}</h4>
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{phase.goal}</p>
                  </div>
                  <span className="inline-flex w-fit items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                    <Clock3 className="h-3.5 w-3.5" />
                    {phase.estimatedDuration}
                  </span>
                </div>

                <div className="mt-4 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('tool_career_path_actionable_steps')}</p>
                  {(phase.actionableSteps ?? []).map((step, stepIndex) => {
                    const StepIcon = actionIconMap[step.type] ?? CheckCircle2;
                    return (
                      <div key={stepIndex} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
                          <StepIcon className="h-4 w-4 shrink-0 text-blue-700 dark:text-blue-400" />
                          <span>{getStepTypeLabel(step.type)}</span>
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{step.description}</p>
                        {step.resources && step.resources.length > 0 && (
                          <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                            <strong>{t('tool_career_path_resources')}:</strong> {step.resources.join(', ')}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('tool_career_path_milestones')}</p>
                  <ul className="mt-2 space-y-2">
                    {(phase.milestones ?? []).map((milestone, milestoneIndex) => (
                      <li key={milestoneIndex} className="flex items-start gap-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        <span>{milestone}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyResultBlock
              icon={Info}
              title={t('tool_career_path_roadmap_title')}
              description={t('tool_career_path_empty_roadmap_desc')}
            />
          )}
        </CardShell>
      </div>
    );
  };

  if (loading) {
    return (
      <StagedLoader
        icon={<Compass />}
        accent="teal"
        title={t('tool_career_path_loader_title')}
        steps={[
          t('tool_career_path_loader_step1'),
          t('tool_career_path_loader_step2'),
          t('tool_career_path_loader_step3'),
        ]}
        onCancel={cancel}
        cancelLabel={t('tool_loader_hide_button')}
        cancelHint={t('tool_loader_hide_hint')}
      />
    );
  }

  if (showSaved) return renderSaved();
  return result ? renderResult() : renderInput();
};

export default CareerPathPlanner;
