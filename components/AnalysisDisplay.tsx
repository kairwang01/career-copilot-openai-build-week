
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, Coins, FileText, Home, Loader2, Megaphone, Search, ShieldCheck, Sparkles, Tag, ThumbsUp, Wrench, X } from 'lucide-react';
import type { AnalysisResult, UserProfile } from '../types';
import ToolRunner from './ToolRunner';
import InterviewSimulator from './InterviewSimulator';
import type { AppSession as Session } from '../lib/data';
import { applyResumeImprovements } from '../services/aiClient';
import { renderFormattedText } from './tools/ToolUtils';
import ResumePreview from './ResumePreview';
import { ViewportAwareDialog } from './ViewportAwareDialog';
import RecoverableSectionBoundary from './RecoverableSectionBoundary';
import { ALL_TOOLS_CONFIG } from '../constants/tools';
import { TOOL_CREDIT_COSTS } from '../config/credits';

interface AnalysisDisplayProps {
  result: AnalysisResult | null;
  onReset: () => void;
  resumeText: string;
  userPlan: string;
  market: string;
  navigateToPricing: () => void;
  session: Session | null;
  profile: UserProfile | null;
  refreshProfile: () => void;
  t: (key: string) => string;
  onApplyImprovements: (newText: string) => void;
  activeTool: string | null;
  setActiveTool: (tool: string | null) => void;
  /** Leaves the report view and opens the toolkit gallery (result view only). */
  onContinueToToolkit?: () => void;
  hideToolBackButton?: boolean;
}

const ScoreCircle: React.FC<{ score: number, t: (key: string) => string }> = ({ score, t }) => {
    const getRingColor = () => {
        if (score < 50) return '#ef4444';
        if (score < 75) return '#f59e0b';
        return '#10b981';
    };
    const scoreColor = score < 50 ? 'text-red-600 dark:text-red-500' : score < 75 ? 'text-yellow-600 dark:text-yellow-500' : 'text-green-600 dark:text-green-500';
    const clampedScore = Math.min(Math.max(Number.isFinite(score) ? score : 0, 0), 100);

    return (
        <div
            className="relative mx-auto flex h-48 w-48 items-center justify-center rounded-full p-3 text-gray-200 dark:text-slate-700"
            role="img"
            aria-label={`${clampedScore} ${t('analysis_score_subtitle')}`}
            style={{ background: `conic-gradient(${getRingColor()} ${clampedScore * 3.6}deg, currentColor 0deg)` }}
        >
            <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-white dark:bg-slate-800">
                <span className={`text-5xl font-bold ${scoreColor}`}>{score}</span>
                <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{t('analysis_score_subtitle')}</span>
            </div>
        </div>
    );
};

const ResumeReferenceModal: React.FC<{ isOpen: boolean; onClose: () => void; resumeText: string; market: string; t: (key: string) => string; }> = ({ isOpen, onClose, resumeText, market, t }) => {
  if (!isOpen) return null;

  return (
    <ViewportAwareDialog open={isOpen} onClose={onClose} closeOnBackdrop labelledBy="resume-reference-title" maxWidth={768} zIndex={50}>
      <div className="flex h-full min-h-[360px] flex-col rounded-xl bg-white shadow-2xl dark:bg-slate-800">
        <div className="flex-shrink-0 flex items-center justify-between p-4 border-b border-gray-200 dark:border-slate-700">
          <h3 id="resume-reference-title" className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('analysis_reference_title')}</h3>
          <button type="button"
            onClick={onClose} 
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-full p-1 transition-colors hover:bg-gray-100 dark:hover:bg-slate-700"
            aria-label={t('analysis_reference_close')}
          >
            <X className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>
        
        <div className="flex-grow overflow-hidden p-2">
           <ResumePreview resumeText={resumeText} market={market} t={t} />
        </div>
      </div>
    </ViewportAwareDialog>
  );
};

type ToolGroupId = 'recommended' | 'all' | 'resume' | 'jobs' | 'practice' | 'growth';

// label / helper hold i18n KEYS, resolved with t() at render.
const TOOL_GROUPS: { id: ToolGroupId; label: string; helper: string; keys: string[] }[] = [
  {
    id: 'recommended',
    label: 'studio_group_recommended_label',
    helper: 'studio_group_recommended_helper',
    keys: ['resume-formatter', 'opportunity-finder', 'cover-letter', 'mock-interview'],
  },
  {
    id: 'all',
    label: 'studio_all_tools_included',
    helper: 'studio_toolkit_subtitle',
    keys: ALL_TOOLS_CONFIG.map((tool) => tool.key),
  },
  {
    id: 'resume',
    label: 'studio_group_resume_label',
    helper: 'studio_group_resume_helper',
    keys: ['resume-formatter', 'linkedin-optimizer'],
  },
  {
    id: 'jobs',
    label: 'studio_group_jobs_label',
    helper: 'studio_group_jobs_helper',
    keys: ['opportunity-finder', 'cover-letter', 'email-crafter', 'networking-assistant', 'industry-event-scout'],
  },
  {
    id: 'practice',
    label: 'studio_group_practice_label',
    helper: 'studio_group_practice_helper',
    keys: ['interview-prep', 'mock-interview', 'english-pro', 'salary-negotiation'],
  },
  {
    id: 'growth',
    label: 'studio_group_growth_label',
    helper: 'studio_group_growth_helper',
    keys: ['career-path', 'website-builder', 'skill-learning-plan', 'performance-review-prep', 'agile-coach'],
  },
];

// Values are i18n keys, resolved with t() at render.
const TOOL_PHASE_LABELS: Record<string, string> = {
  'resume-formatter': 'studio_phase_resume',
  'linkedin-optimizer': 'studio_phase_profile',
  'opportunity-finder': 'studio_phase_matching',
  'cover-letter': 'studio_phase_application',
  'email-crafter': 'studio_phase_outreach',
  'networking-assistant': 'studio_phase_outreach',
  'industry-event-scout': 'studio_phase_networking',
  'interview-prep': 'studio_phase_interview',
  'mock-interview': 'studio_phase_interview',
  'english-pro': 'studio_phase_interview',
  'salary-negotiation': 'studio_phase_offer',
  'career-path': 'studio_phase_planning',
  'website-builder': 'studio_phase_profile',
  'skill-learning-plan': 'studio_phase_learning',
  'performance-review-prep': 'studio_phase_growth',
  'agile-coach': 'studio_phase_growth',
};

const toolCreditCost = (toolKey: string): number | null => {
  const value = TOOL_CREDIT_COSTS[toolKey as keyof typeof TOOL_CREDIT_COSTS];
  return typeof value === 'number' ? value : null;
};

type ToolTransferInput = {
  tool: string;
  input: string;
};

const AnalysisDisplay: React.FC<AnalysisDisplayProps> = ({ t, result, onReset, resumeText, market, navigateToPricing, session, profile, refreshProfile, onApplyImprovements, activeTool, setActiveTool, onContinueToToolkit, hideToolBackButton = false }) => {
  const [toolInput, setToolInput] = useState<ToolTransferInput | null>(null);
  const [isReferenceModalOpen, setIsReferenceModalOpen] = useState(false);
  const [toolGroup, setToolGroup] = useState<ToolGroupId>('all');
  const [toolQuery, setToolQuery] = useState('');

  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizationError, setOptimizationError] = useState<string | null>(null);
  const [confirmingApply, setConfirmingApply] = useState(false);
  const optimizingRef = useRef(false);
  const optimizeRunRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      optimizeRunRef.current += 1;
      optimizingRef.current = false;
    };
  }, []);

  const selectedToolGroup = TOOL_GROUPS.find((group) => group.id === toolGroup) ?? TOOL_GROUPS[0];
  const filteredTools = useMemo(() => {
    const query = toolQuery.trim().toLowerCase();
    return ALL_TOOLS_CONFIG.filter((tool) => {
      const isInGroup = selectedToolGroup.keys.includes(tool.key);
      if (!isInGroup) return false;
      if (!query) return true;

      const titleKey = `tool_${tool.key.replace(/-/g, '_')}_title`;
      const descKey = `tool_${tool.key.replace(/-/g, '_')}_desc`;
      const title = t(titleKey);
      const desc = t(descKey);
      return [tool.key, title, desc].some((value) => value.toLowerCase().includes(query));
    });
  }, [selectedToolGroup, toolQuery, t]);

  const openTool = (tool: string, input: string = '') => {
    setToolInput({ tool, input });
    setActiveTool(tool);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const activeToolInitialInput = activeTool && toolInput?.tool === activeTool ? toolInput.input : '';
  
  const handleApplySuggestions = async () => {
    if (!result || optimizingRef.current) return;
    const runId = ++optimizeRunRef.current;
    optimizingRef.current = true;
    setIsOptimizing(true);
    setOptimizationError(null);
    try {
      const { updatedResumeText } = await applyResumeImprovements(resumeText, result.improvements);
      if (!mountedRef.current || optimizeRunRef.current !== runId) return;
      // Close the confirm UI BEFORE onApplyImprovements — the parent resets the
      // analysis (result → null), which re-renders this view to the studio branch.
      setConfirmingApply(false);
      onApplyImprovements(updatedResumeText);
    } catch (err) {
      console.error('applyResumeImprovements failed:', err);
      if (mountedRef.current && optimizeRunRef.current === runId) setOptimizationError(t('ai_error_failed'));
    } finally {
      if (mountedRef.current && optimizeRunRef.current === runId) {
        optimizingRef.current = false;
        setIsOptimizing(false);
      }
    }
  };
  
  // -----------------------------------------------------------
  // CAREER STUDIO WORKSPACE LAYOUT (NO RESULT)
  // -----------------------------------------------------------
  if (!result) {
      const toolTitle = activeTool ? t(`tool_${activeTool.replace(/-/g, '_')}_title`) : t('studio_toolkit_kicker');

      return (
          <>
            <div className="workspace-card min-h-[75vh] flex flex-col overflow-hidden">
                {activeTool ? (
                    <>
                        {/* Top Bar for Tool */}
                        <div
                            data-qa="toolkit-active-tool"
                            data-qa-tool={activeTool}
                            className="min-h-16 bg-slate-50 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800 flex flex-col gap-3 px-4 py-3 shrink-0 z-20 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                        >
                            <div className="flex min-w-0 items-center gap-3">
                                {!hideToolBackButton && (
                                    <button type="button"
                                        onClick={() => setActiveTool(null)}
                                        data-qa="toolkit-back-to-library"
                                        className="workspace-button-ghost inline-flex h-9 w-9 shrink-0 items-center justify-center"
                                        aria-label={t('studio_back_to_library')}
                                    >
                                        <ArrowLeft className="h-5 w-5" />
                                    </button>
                                )}
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-500">
                                    {t('studio_assisted_tool')}
                                  </p>
                                  <h1 className="truncate text-lg font-semibold text-slate-900 dark:text-slate-100">{toolTitle}</h1>
                                </div>
                            </div>
                            <button type="button"
                                onClick={() => setIsReferenceModalOpen(true)} 
                                className="workspace-button-secondary inline-flex items-center justify-center gap-2 px-3 py-2"
                            >
                                <FileText className="h-4 w-4" />
                                {t('studio_review_resume')}
                            </button>
                        </div>
                        <div data-qa="toolkit-active-tool-body" className="flex-1 overflow-y-auto bg-slate-50/70 p-4 dark:bg-slate-950/40 sm:p-6 md:p-10">
                            <div className={`mx-auto ${activeTool === 'mock-interview' ? 'max-w-[1440px]' : 'max-w-7xl'}`}>
                                {/* A tool can crash on malformed AI output; contain it here so the
                                    user keeps their analysis instead of the whole app going down. */}
                                <RecoverableSectionBoundary
                                    resetKey={`tool:${activeTool ?? ''}`}
                                    title={t('tool_crash_title')}
                                    description={t('tool_crash_desc')}
                                    retryLabel={t('tool_crash_back')}
                                    onRetry={() => setActiveTool(null)}
                                >
                                {activeTool === 'mock-interview' ? (
                                        <InterviewSimulator
                                            resumeText={resumeText}
                                            market={market}
                                            initialInput={activeToolInitialInput}
                                            onClose={() => setActiveTool(null)}
                                            session={session}
                                            profile={profile}
                                            navigateToPricing={navigateToPricing}
                                            t={t}
                                        />
                                ) : (
                                        <ToolRunner
                                            tool={activeTool}
                                            resumeText={resumeText}
                                            initialInput={activeToolInitialInput}
                                            onClose={() => setActiveTool(null)}
                                            openTool={openTool}
                                            market={market}
                                            session={session}
                                            profile={profile}
                                            refreshProfile={refreshProfile}
                                            t={t}
                                        />
                                )}
                                </RecoverableSectionBoundary>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 overflow-y-auto bg-gradient-to-br from-slate-50 to-white p-4 dark:from-slate-950 dark:to-slate-900 sm:p-6 md:p-8">
                        <div className="mx-auto max-w-6xl">
                            <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_320px]">
                              <div className="workspace-card p-5 sm:p-6">
                                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 text-sm font-semibold text-blue-700 dark:text-blue-400">
                                      <Wrench className="h-4 w-4" />
                                      {t('studio_toolkit_kicker')}
                                    </div>
                                    <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100 sm:text-3xl">
                                      {t('studio_toolkit_title')}
                                    </h1>
                                    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                                      {t('studio_toolkit_subtitle')}
                                    </p>
                                  </div>
                                  <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
                                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                                    <span>{t('studio_all_tools_included')}</span>
                                    <span className="hidden text-emerald-600 dark:text-emerald-400 sm:inline">·</span>
                                    <span className="hidden sm:inline">{t('job_card_uses_credits')}</span>
                                  </div>
                                </div>

                                <div className="mt-5 grid gap-3 sm:grid-cols-4">
                                  {[
                                    [t('studio_phase_resume'), t('studio_stat_resume_helper')],
                                    [t('studio_stat_match_label'), t('studio_stat_match_helper')],
                                    [t('studio_phase_outreach'), t('studio_stat_outreach_helper')],
                                    [t('studio_phase_interview'), t('studio_stat_interview_helper')],
                                  ].map(([label, helper]) => (
                                    <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</p>
                                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{helper}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              <div className="workspace-card p-5">
                                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                                  <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                                  {t('studio_resume_context')}
                                </div>
                                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                                  {t('studio_resume_context_desc')}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => setIsReferenceModalOpen(true)}
                                  className="workspace-button-secondary mt-4 inline-flex w-full items-center justify-center gap-2 px-3 py-2"
                                >
                                  <FileText className="h-4 w-4" />
                                  {t('studio_review_resume')}
                                </button>
                              </div>
                            </div>

                            <div className="mb-5 grid gap-3 lg:grid-cols-[1fr_280px]">
                              <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 dark:border-slate-800 dark:bg-slate-900">
                                <div className="flex max-w-full gap-2 overflow-x-auto overscroll-x-contain pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                {TOOL_GROUPS.map((group) => (
                                  <button
                                    key={group.id}
                                    type="button"
                                    aria-pressed={toolGroup === group.id}
                                    onClick={() => setToolGroup(group.id)}
                                    className={`shrink-0 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                                      toolGroup === group.id
                                        ? 'bg-blue-700 text-white shadow-sm'
                                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                                    }`}
                                  >
                                    {t(group.label)}
                                  </button>
                                ))}
                                </div>
                              </div>
                              <label className="relative block">
                                <span className="sr-only">{t('studio_search_label')}</span>
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                <input
                                  type="search"
                                  value={toolQuery}
                                  onChange={(event) => setToolQuery(event.target.value)}
                                  placeholder={t('studio_search_ph')}
                                  className="h-full min-h-[46px] w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-blue-900/40"
                                />
                              </label>
                            </div>

                            <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                              <div>
                                <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{t(selectedToolGroup.label)}</h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400">{t(selectedToolGroup.helper)}</p>
                              </div>
                              <p className="text-xs font-medium text-slate-500 dark:text-slate-500">
                                {t('studio_tool_count')
                                  .replace('{shown}', String(filteredTools.length))
                                  .replace('{total}', String(selectedToolGroup.keys.length))}
                              </p>
                            </div>

                            {filteredTools.length === 0 ? (
                              <div className="workspace-card p-8 text-center">
                                <Search className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />
                                <h3 className="mt-3 text-base font-semibold text-slate-900 dark:text-slate-100">{t('studio_no_match_title')}</h3>
                                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('studio_no_match_desc')}</p>
                              </div>
                            ) : (
                              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                                {filteredTools.map((tool) => {
                                    const titleKey = `tool_${tool.key.replace(/-/g, '_')}_title`;
                                    const descKey = `tool_${tool.key.replace(/-/g, '_')}_desc`;
                                    const desc = t(descKey);
                                    const creditCost = toolCreditCost(tool.key);
                                    const isRecommended = TOOL_GROUPS[0].keys.includes(tool.key);
                                    return (
                                        <button
                                            key={tool.key}
                                            type="button"
                                            data-qa={`toolkit-card-${tool.key}`}
                                            onClick={() => openTool(tool.key)}
                                            className="group workspace-card flex min-h-[184px] flex-col p-5 text-left transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:hover:border-blue-800"
                                            aria-label={t('studio_open_tool_aria').replace('{tool}', t(titleKey))}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                              <div className="flex items-center gap-3">
                                                <div className="h-10 w-10 flex-shrink-0 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-600 dark:text-blue-400 transition-transform group-hover:scale-105">
                                                    {React.cloneElement(tool.icon, { className: 'h-5 w-5' })}
                                                </div>
                                                <div>
                                                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                                                    {t(TOOL_PHASE_LABELS[tool.key] ?? 'studio_phase_tool')}
                                                  </span>
                                                  <h3 className="mt-0.5 text-sm font-semibold leading-snug text-slate-900 dark:text-white">{t(titleKey)}</h3>
                                                </div>
                                              </div>
                                              {isRecommended && (
                                                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                                  <Sparkles className="h-3 w-3" />
                                                  {t('studio_card_next')}
                                                </span>
                                              )}
                                            </div>
                                            {desc && desc !== descKey && (
                                                <p className="mt-3 flex-1 text-sm leading-relaxed text-slate-500 line-clamp-3 dark:text-slate-400">{desc}</p>
                                            )}
                                            <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                                              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400">
                                                <Coins className="h-3.5 w-3.5 text-amber-500" />
                                                {creditCost === null
                                                  ? t('job_card_uses_credits')
                                                  : `${creditCost} ${t('ws_credits_label')}`}
                                              </span>
                                              <span className="text-sm font-semibold text-blue-700 transition group-hover:translate-x-0.5 dark:text-blue-400">
                                                {t('studio_card_open')}
                                              </span>
                                            </div>
                                        </button>
                                    );
                                })}
                              </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
            <ResumeReferenceModal 
                isOpen={isReferenceModalOpen}
                onClose={() => setIsReferenceModalOpen(false)}
                resumeText={resumeText}
                market={market}
                t={t}
            />
          </>
      );
  }

  // -----------------------------------------------------------
  // ANALYSIS RESULTS VIEW (HAS RESULT)
  // -----------------------------------------------------------
  return (
    <div className={`w-full animate-fade-in p-4 sm:p-6 bg-gray-50 dark:bg-slate-900 rounded-lg`}>
        
        {/* Breadcrumb Navigation for Better UX */}
        <div className="flex items-center gap-2 mb-6 text-sm text-gray-500 dark:text-gray-400">
            <button type="button"
                onClick={onReset} 
                className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline flex items-center gap-1 transition-colors"
            >
                <Home className="h-4 w-4" aria-hidden="true" />
                {t('analysis_breadcrumb_dashboard')}
            </button>
            <span>/</span>
            <span className="font-semibold text-gray-800 dark:text-gray-200">
                {t('analysis_breadcrumb_results')}
            </span>
        </div>

        <div className="text-center mb-10">
          <h2 className="text-3xl font-extrabold text-gray-900 dark:text-gray-100 tracking-tight">{t('analysis_results_title')}</h2>
          <p className="text-gray-600 dark:text-gray-300 mt-2 text-lg">{result.summary}</p>
        </div>

        <div className="mb-8 rounded-2xl border border-blue-200 bg-blue-700 p-5 text-white shadow-sm dark:border-blue-800 dark:bg-blue-950 sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <h3 className="text-xl font-semibold">{t('analysis_apply_title')}</h3>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-blue-100">
                  {t('analysis_apply_desc')}
                </p>
              </div>
              {!confirmingApply ? (
                <button
                  type="button"
                  onClick={() => setConfirmingApply(true)}
                  disabled={isOptimizing}
                  className="inline-flex min-h-[42px] items-center justify-center rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50 disabled:cursor-wait disabled:opacity-70"
                >
                  {t('analysis_apply_review')}
                </button>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={handleApplySuggestions}
                    disabled={isOptimizing}
                    className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50 disabled:cursor-wait disabled:opacity-70"
                  >
                    {isOptimizing && (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    )}
                    {isOptimizing ? t('analysis_applying') : t('analysis_apply_edits')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingApply(false)}
                    disabled={isOptimizing}
                    className="inline-flex min-h-[42px] items-center justify-center rounded-lg border border-white/30 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-70"
                  >
                    {t('action_cancel')}
                  </button>
                </div>
              )}
            </div>
            {confirmingApply && (
              <div className="mt-4 rounded-lg border border-white/20 bg-white/10 p-3 text-sm leading-relaxed text-blue-50 animate-panel-expand">
                {t('analysis_apply_safety_note')}
              </div>
            )}
            {optimizationError && (
              <div className="mt-3 flex flex-col gap-2 rounded-lg border border-red-300/40 bg-red-500/15 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-red-100">{optimizationError}</p>
                <button
                  type="button"
                  onClick={handleApplySuggestions}
                  disabled={isOptimizing}
                  className="self-start text-xs font-semibold text-white underline disabled:opacity-60 sm:self-auto"
                >
                  {t('action_retry')}
                </button>
              </div>
            )}
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-4 flex flex-col items-center space-y-6 bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-200 dark:border-slate-700 shadow-md">
            <h3 className="text-xl font-bold text-gray-800 dark:text-gray-200">{t('analysis_score_title')}</h3>
            <ScoreCircle score={Number.isFinite(result.score) ? result.score : 0} t={t} />
            <p className="text-center text-gray-600 dark:text-gray-400">{t('analysis_score_description').replace('{market}', market)}</p>
            </div>
            
            <div className="lg:col-span-8 space-y-6">
            {/* Strengths */}
                <div className="bg-white dark:bg-slate-800 border border-green-200 dark:border-green-700/50 p-6 rounded-xl shadow-sm">
                    <h3 className="font-bold text-lg text-green-800 dark:text-green-300 mb-3 flex items-center">
                        <ThumbsUp className="mr-2 h-6 w-6" aria-hidden="true" />
                        {t('analysis_strengths_title')}
                    </h3>
                    <ul className="list-disc list-inside space-y-2 text-green-900 dark:text-green-200">
                        {(result.strengths ?? []).map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                </div>

                {/* Improvements */}
                <div className="bg-white dark:bg-slate-800 border border-yellow-300 dark:border-yellow-600/50 p-6 rounded-xl shadow-sm">
                    <h3 className="font-bold text-lg text-yellow-800 dark:text-yellow-300 mb-3 flex items-center">
                        <Megaphone className="mr-2 h-6 w-6" aria-hidden="true" />
                        {t('analysis_improvements_title')}
                    </h3>
                    <ul className="space-y-3 text-yellow-900 dark:text-yellow-200">
                        {(result.improvements ?? []).map((item, i) => (
                            <li key={i}><strong className="font-semibold">{item.area}:</strong> {item.suggestion}</li>
                        ))}
                    </ul>
                </div>
            </div>
        </div>
      
        {/* Keywords */}
        <div className="mt-8 bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-600/50 p-6 rounded-xl shadow-sm">
                <h3 className="font-bold text-lg text-blue-800 dark:text-blue-300 mb-3 flex items-center">
                    <Tag className="mr-2 h-6 w-6" aria-hidden="true" />
                    {t('analysis_keywords_title')}
                </h3>
                <div className="flex flex-wrap gap-2">
                    {(result.keywords ?? []).map((item, i) => (
                        <span key={i} className="bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 text-sm font-medium px-3 py-1.5 rounded-full">{item}</span>
                    ))}
                </div>
            </div>

        <div className="mt-12 text-center">
            <button type="button"
              onClick={() => (onContinueToToolkit ? onContinueToToolkit() : onReset())}
              className="font-bold py-3 px-8 rounded-lg shadow-md bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-slate-600 transition-all"
            >
                {t('analysis_continue_toolkit')}
            </button>
        </div>
    </div>
  );
};

export default AnalysisDisplay;
