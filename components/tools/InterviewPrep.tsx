import React, { useEffect, useRef, useState } from 'react';
import {
  ClipboardCheck,
  Layers,
  Mic,
  ShieldQuestion,
  Sparkles,
  Target,
  TriangleAlert,
  GraduationCap,
  ListChecks,
  FileText,
} from 'lucide-react';
import { generateCandidatePrepKit } from '../../services/aiClient';
import type {
  CandidatePrepKit,
  PrepEvidenceLevel,
  PrepGapRisk,
  PrepRankedQuestion,
} from '../../types';
import StagedLoader from '../StagedLoader';
import { useCancellableLoading } from '../../hooks/useCancellableLoading';
import { DownloadButtons, SavedResultBar, ToolError } from './ToolUtils';
import { useToolResults } from '../../contexts/ToolResultsContext';
import {
  parseToolJobContext,
  buildInterviewSeedContext,
  buildLearningPlanContextFromSkillGap,
} from '../../lib/toolPrefill';

interface InterviewPrepProps {
  resumeText: string;
  market: string;
  initialInput?: string;
  openTool: (tool: string, input?: string) => void;
  t: (key: string) => string;
}

const SAMPLE_ROLE = 'Machine Learning Engineer';
const MAX_ROLE_LENGTH = 200;
const MAX_JOB_DESCRIPTION_LENGTH = 20_000;
const MAX_SOURCE_NOTES_LENGTH = 12_000;
const MAX_OUTPUT_TEXT_LENGTH = 8_000;

const boundedText = (value: unknown, maxLength = MAX_OUTPUT_TEXT_LENGTH) =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const boundedTextArray = (value: unknown, maxItems: number) => (
  Array.isArray(value)
    ? value.slice(0, maxItems).map((item) => boundedText(item)).filter(Boolean)
    : []
);

// ── Defensive normalizers ────────────────────────────────────────────────────
// The model is prompted to use these enum values, but we never trust LLM output
// blindly — anything unexpected collapses to a safe middle default so the UI
// never renders an unstyled / unknown badge.
const FREQ_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const normFrequency = (v?: string): 'high' | 'medium' | 'low' => {
  const s = (v ?? '').toLowerCase();
  return s === 'high' || s === 'low' ? s : 'medium';
};
const normRecency = (v?: string): 'recent' | 'evergreen' | 'older' => {
  const s = (v ?? '').toLowerCase();
  return s === 'recent' || s === 'older' ? s : 'evergreen';
};
const normEvidence = (v?: string): PrepEvidenceLevel => {
  const s = (v ?? '').toLowerCase();
  return s === 'source-backed' || s === 'weak' ? (s as PrepEvidenceLevel) : 'inferred';
};
const normSeverity = (v?: string): 'high' | 'medium' | 'low' => {
  const s = (v ?? '').toLowerCase();
  return s === 'high' || s === 'low' ? s : 'medium';
};

const normalizeCandidatePrepKit = (value: unknown): CandidatePrepKit | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const predictedQuestions = boundedTextArray(source.predictedQuestions, 20);

  const resumeAnchors = Array.isArray(source.resumeAnchors)
    ? source.resumeAnchors.slice(0, 12).flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const anchor = item as Record<string, unknown>;
        const label = boundedText(anchor.label);
        if (!label) return [];
        return [{
          label,
          evidence: boundedText(anchor.evidence),
          relevance: boundedText(anchor.relevance),
        }];
      })
    : [];

  const rankedQuestions: PrepRankedQuestion[] = Array.isArray(source.rankedQuestions)
    ? source.rankedQuestions.slice(0, 20).flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const question = item as Record<string, unknown>;
        const questionText = boundedText(question.question);
        if (!questionText) return [];
        const anchorLabel = boundedText(question.anchorLabel);
        return [{
          question: questionText,
          category: boundedText(question.category, 100) || 'General',
          rationale: boundedText(question.rationale),
          frequency: normFrequency(typeof question.frequency === 'string' ? question.frequency : undefined),
          recency: normRecency(typeof question.recency === 'string' ? question.recency : undefined),
          evidenceLevel: normEvidence(typeof question.evidenceLevel === 'string' ? question.evidenceLevel : undefined),
          ...(anchorLabel ? { anchorLabel } : {}),
        }];
      })
    : [];

  const followUpChains = Array.isArray(source.followUpChains)
    ? source.followUpChains.slice(0, 12).flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const chain = item as Record<string, unknown>;
        const anchor = boundedText(chain.anchor);
        const questions = boundedTextArray(chain.questions, 12);
        if (!anchor || questions.length === 0) return [];
        return [{ anchor, questions, watchFor: boundedText(chain.watchFor) }];
      })
    : [];

  const gapRisks: PrepGapRisk[] = Array.isArray(source.gapRisks)
    ? source.gapRisks.slice(0, 12).flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const gap = item as Record<string, unknown>;
        const area = boundedText(gap.area);
        const risk = boundedText(gap.risk);
        if (!area || !risk) return [];
        return [{
          area,
          risk,
          mitigation: boundedText(gap.mitigation),
          severity: normSeverity(typeof gap.severity === 'string' ? gap.severity : undefined),
        }];
      })
    : [];

  const allowedSourceKinds = new Set(['job-description', 'user-note', 'resume', 'inferred']);
  const sourceRefs = Array.isArray(source.sourceRefs)
    ? source.sourceRefs.slice(0, 12).flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const sourceRef = item as Record<string, unknown>;
        const label = boundedText(sourceRef.label);
        if (!label) return [];
        const rawKind = boundedText(sourceRef.kind, 40);
        const kind = (allowedSourceKinds.has(rawKind) ? rawKind : 'inferred') as NonNullable<CandidatePrepKit['sourceRefs']>[number]['kind'];
        const detail = boundedText(sourceRef.detail);
        return [{ label, kind, ...(detail ? { detail } : {}) }];
      })
    : [];

  if (rankedQuestions.length === 0 && predictedQuestions.length === 0) return null;
  const targetRole = boundedText(source.targetRole, MAX_ROLE_LENGTH);
  const targetCompany = boundedText(source.targetCompany, 500);
  const sourceCoverage = boundedText(source.sourceCoverage);
  return {
    weakSpots: boundedTextArray(source.weakSpots, 20),
    keyProjects: boundedTextArray(source.keyProjects, 20),
    predictedQuestions,
    ...(targetRole ? { targetRole } : {}),
    ...(targetCompany ? { targetCompany } : {}),
    ...(sourceCoverage ? { sourceCoverage } : {}),
    resumeAnchors,
    rankedQuestions,
    followUpChains,
    gapRisks,
    practicePlan: boundedTextArray(source.practicePlan, 20),
    sourceRefs,
  };
};

const CardShell: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <section className={`rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}>
    {children}
  </section>
);

const EvidenceBadge: React.FC<{ level: PrepEvidenceLevel; t: (key: string) => string }> = ({ level, t }) => {
  const meta: Record<PrepEvidenceLevel, { key: string; cls: string }> = {
    'source-backed': {
      key: 'tool_interview_prep_evidence_source',
      cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:ring-emerald-800',
    },
    inferred: {
      key: 'tool_interview_prep_evidence_inferred',
      cls: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
    },
    weak: {
      key: 'tool_interview_prep_evidence_weak',
      cls: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:ring-amber-800',
    },
  };
  const m = meta[level];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ${m.cls}`}>
      <ShieldQuestion className="h-3 w-3" aria-hidden="true" />
      {t(m.key)}
    </span>
  );
};

const SEVERITY_CLS: Record<'high' | 'medium' | 'low', string> = {
  high: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-200 dark:ring-rose-800',
  medium: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:ring-amber-800',
  low: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
};

const InterviewPrep: React.FC<InterviewPrepProps> = ({ resumeText, market, initialInput = '', openTool, t }) => {
  const { loading, begin, end, cancel } = useCancellableLoading();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CandidatePrepKit | null>(null);
  const { canSave, saved, saveState, persist, clear } = useToolResults<CandidatePrepKit>();
  const [fromSaved, setFromSaved] = useState(false);

  const [targetRole, setTargetRole] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [sourceNotes, setSourceNotes] = useState('');
  const [prefilledFromJob, setPrefilledFromJob] = useState(false);
  const consumedInitialInputRef = useRef('');

  // Prefill from an Opportunity Finder handoff (Job Title / summary / company).
  useEffect(() => {
    const value = initialInput.trim().slice(0, MAX_JOB_DESCRIPTION_LENGTH + MAX_ROLE_LENGTH);
    if (!value || consumedInitialInputRef.current === value) return;
    const context = parseToolJobContext(value);
    if (!context.jobTitle && !context.summary && !context.company) return;

    consumedInitialInputRef.current = value;
    if (context.jobTitle) setTargetRole(context.jobTitle.slice(0, MAX_ROLE_LENGTH));
    const jd = [context.summary, context.responsibilities, context.requiredQualifications]
      .filter(Boolean)
      .join('\n\n');
    if (jd) setJobDescription(jd.slice(0, MAX_JOB_DESCRIPTION_LENGTH));
    setPrefilledFromJob(true);
    setResult(null);
    setFromSaved(false);
    setError(null);
  }, [initialInput]);

  // Hydrate a previously saved brief (paid tiers) when not arriving from a handoff.
  useEffect(() => {
    if (initialInput.trim()) return;
    if (saved && !result) {
      const nextResult = normalizeCandidatePrepKit(saved.result);
      if (!nextResult) return;
      setResult(nextResult);
      setFromSaved(true);
      if (nextResult.targetRole) setTargetRole(nextResult.targetRole);
    }
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetResult = () => {
    setResult(null);
    setFromSaved(false);
    setError(null);
  };

  const runTool = async () => {
    const role = targetRole.trim().slice(0, MAX_ROLE_LENGTH);
    if (!role) {
      setError(t('tool_interview_prep_error_role_required'));
      return;
    }
    if (!resumeText.trim()) {
      setError(t('tool_resume_required_error'));
      return;
    }
    const nextJobDescription = jobDescription.trim().slice(0, MAX_JOB_DESCRIPTION_LENGTH);
    const nextSourceNotes = sourceNotes.trim().slice(0, MAX_SOURCE_NOTES_LENGTH);
    const alive = begin();
    setError(null);
    setResult(null);
    try {
      const apiResult = normalizeCandidatePrepKit(await generateCandidatePrepKit(resumeText, nextJobDescription, {
        targetRole: role,
        marketName: market,
        sourceNotes: nextSourceNotes || undefined,
      }));
      if (!alive()) return;
      if (!apiResult) throw new Error(t('ai_error_empty_response'));
      const nextResult: CandidatePrepKit = {
        ...apiResult,
        targetRole: apiResult.targetRole || role,
      };
      setResult(nextResult);
      setFromSaved(false);
      persist(nextResult);
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

  // ── Cross-tool handoffs ────────────────────────────────────────────────────
  const startMockInterview = () => {
    if (!result) return;
    const ranked = result.rankedQuestions ?? [];
    const questions = ranked.length
      ? ranked.map((q) => ({ question: q.question, category: q.category }))
      : (result.predictedQuestions ?? []).map((q) => ({ question: q, category: '' }));
    const context = buildInterviewSeedContext({
      targetRole: result.targetRole || targetRole,
      company: result.targetCompany,
      jobSummary: jobDescription.trim() || undefined,
      questions,
    });
    openTool('mock-interview', context);
  };

  const planForGap = (gap: PrepGapRisk) => {
    const context = buildLearningPlanContextFromSkillGap(
      { skill: gap.area, reason: gap.risk },
      result?.targetRole || targetRole,
    );
    openTool('skill-learning-plan', context);
  };

  const formatForDownload = (res: CandidatePrepKit): string => {
    const role = res.targetRole || targetRole || '';
    let content = `# ${t('tool_interview_prep_results_kicker')}${role ? `: ${role}` : ''}\n\n`;
    if (res.sourceCoverage) content += `> ${t('tool_interview_prep_coverage_label')}: ${res.sourceCoverage}\n\n`;

    const ranked = res.rankedQuestions ?? [];
    content += `## ${t('tool_interview_prep_block_topics_title')}\n`;
    if (ranked.length) {
      ranked.forEach((q, i) => {
        content += `${i + 1}. [${q.category}] ${q.question}\n`;
        if (q.rationale) content += `   - ${q.rationale}\n`;
        const evidenceKey = normEvidence(q.evidenceLevel) === 'source-backed'
          ? 'tool_interview_prep_evidence_source'
          : normEvidence(q.evidenceLevel) === 'weak'
            ? 'tool_interview_prep_evidence_weak'
            : 'tool_interview_prep_evidence_inferred';
        content += `   - ${t(`tool_interview_prep_freq_${normFrequency(q.frequency)}`)} · ${t(`tool_interview_prep_recency_${normRecency(q.recency)}`)} · ${t(evidenceKey)}\n`;
      });
    } else {
      (res.predictedQuestions ?? []).forEach((q, i) => { content += `${i + 1}. ${q}\n`; });
    }

    const anchors = res.resumeAnchors ?? [];
    if (anchors.length || (res.followUpChains ?? []).length) {
      content += `\n## ${t('tool_interview_prep_block_followups_title')}\n`;
      anchors.forEach((a) => { content += `- ${a.label}: ${a.relevance}\n`; });
      (res.followUpChains ?? []).forEach((chain) => {
        content += `\n### ${chain.anchor}\n`;
        (chain.questions ?? []).forEach((q) => { content += `- ${q}\n`; });
        if (chain.watchFor) content += `_${t('tool_interview_prep_watch_for_label')}: ${chain.watchFor}_\n`;
      });
    }

    const gaps = res.gapRisks ?? [];
    if (gaps.length || (res.weakSpots ?? []).length) {
      content += `\n## ${t('tool_interview_prep_block_gaps_title')}\n`;
      if (gaps.length) {
        gaps.forEach((g) => {
          content += `- (${t(`tool_interview_prep_severity_${normSeverity(g.severity)}`)}) ${g.area}: ${g.risk}\n  ${t('tool_interview_prep_gap_mitigation_label')}: ${g.mitigation}\n`;
        });
      } else {
        (res.weakSpots ?? []).forEach((w) => { content += `- ${w}\n`; });
      }
    }

    const plan = res.practicePlan ?? [];
    if (plan.length) {
      content += `\n## ${t('tool_interview_prep_practice_plan_title')}\n`;
      plan.forEach((p, i) => { content += `${i + 1}. ${p}\n`; });
    }
    return content;
  };

  // ── Input view ─────────────────────────────────────────────────────────────
  const renderInput = () => (
    <div data-qa="interview-prep-tool" data-qa-tool-state="input" className="mx-auto max-w-6xl space-y-5">
      <CardShell className="overflow-hidden">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
          <form onSubmit={handleSubmit} className="min-w-0 p-5 sm:p-6 lg:p-8">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-teal-700 dark:text-teal-300">
              <ClipboardCheck className="h-4 w-4" />
              {t('tool_interview_prep_title')}
            </div>
            <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100 sm:text-3xl">
              {t('tool_interview_prep_intro_line1')}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              {t('tool_interview_prep_intro_line2')}
            </p>

            <div className="mt-7 space-y-4">
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label htmlFor="interview-prep-role" className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {t('tool_interview_prep_role_label')}
                  </label>
                  <button
                    type="button"
                    onClick={() => { setTargetRole(SAMPLE_ROLE); setPrefilledFromJob(false); }}
                    data-qa="interview-prep-try-example"
                    className="min-h-11 px-2 text-sm font-semibold text-teal-700 transition hover:text-teal-800 dark:text-teal-300 dark:hover:text-teal-200"
                  >
                    {t('try_example')}
                  </button>
                </div>
                <input
                  type="text"
                  id="interview-prep-role"
                  data-qa="interview-prep-role"
                  value={targetRole}
                  onChange={(event) => setTargetRole(event.target.value.slice(0, MAX_ROLE_LENGTH))}
                  maxLength={MAX_ROLE_LENGTH}
                  required
                  className="block min-h-[48px] w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-950 shadow-sm transition placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                  placeholder={t('tool_interview_prep_role_placeholder')}
                />
              </div>

              <div>
                <label htmlFor="interview-prep-jd" className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {t('tool_interview_prep_jd_label')}
                </label>
                <textarea
                  id="interview-prep-jd"
                  data-qa="interview-prep-jd"
                  value={jobDescription}
                  onChange={(event) => setJobDescription(event.target.value.slice(0, MAX_JOB_DESCRIPTION_LENGTH))}
                  maxLength={MAX_JOB_DESCRIPTION_LENGTH}
                  rows={4}
                  className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 shadow-sm transition placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                  placeholder={t('tool_interview_prep_jd_placeholder')}
                />
                <p className="mt-1.5 text-xs leading-5 text-slate-500 dark:text-slate-400">{t('tool_interview_prep_jd_hint')}</p>
              </div>

              <div>
                <label htmlFor="interview-prep-sources" className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {t('tool_interview_prep_sources_label')}
                </label>
                <textarea
                  id="interview-prep-sources"
                  data-qa="interview-prep-sources"
                  value={sourceNotes}
                  onChange={(event) => setSourceNotes(event.target.value.slice(0, MAX_SOURCE_NOTES_LENGTH))}
                  maxLength={MAX_SOURCE_NOTES_LENGTH}
                  rows={4}
                  className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 shadow-sm transition placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                  placeholder={t('tool_interview_prep_sources_placeholder')}
                />
                <p className="mt-1.5 text-xs leading-5 text-slate-500 dark:text-slate-400">{t('tool_interview_prep_sources_hint')}</p>
              </div>

              {prefilledFromJob && (
                <div
                  data-qa="interview-prep-prefill-note"
                  className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-950 dark:border-teal-900/60 dark:bg-teal-950/30 dark:text-teal-100"
                >
                  <p className="font-semibold">{t('tool_interview_prep_prefill_note')}</p>
                </div>
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
                data-qa="interview-prep-generate"
                disabled={loading}
                className="inline-flex min-h-[48px] w-full items-center justify-center rounded-lg bg-teal-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-teal-400"
              >
                {loading ? t('tool_interview_prep_generating_button') : t('tool_interview_prep_generate_button')}
              </button>
            </div>
          </form>

          <aside className="border-t border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950/40 sm:p-6 lg:border-l lg:border-t-0">
            <div className="rounded-lg border border-teal-100 bg-teal-50 p-4 text-teal-950 dark:border-teal-900/50 dark:bg-teal-950/30 dark:text-teal-100">
              <div className="flex items-start gap-3">
                <Target className="mt-0.5 h-5 w-5 shrink-0" />
                <p className="text-sm font-semibold leading-relaxed">{t('tool_interview_prep_setup_desc')}</p>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {([
                { label: t('tool_interview_prep_setup_point1'), Icon: Layers },
                { label: t('tool_interview_prep_setup_point2'), Icon: ShieldQuestion },
                { label: t('tool_interview_prep_setup_point3'), Icon: Mic },
              ] satisfies Array<{ label: string; Icon: React.ElementType }>).map(({ label, Icon }, index) => (
                <div key={label} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {index + 1}
                  </span>
                  <Icon className="h-4 w-4 shrink-0 text-teal-700 dark:text-teal-300" />
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{label}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </CardShell>
    </div>
  );

  // ── Result view ────────────────────────────────────────────────────────────
  const renderResult = () => {
    if (!result) return null;

    const ranked: PrepRankedQuestion[] = (result.rankedQuestions ?? []).slice().sort((a, b) => {
      const ev = (normEvidence(a.evidenceLevel) === 'source-backed' ? 0 : 1) - (normEvidence(b.evidenceLevel) === 'source-backed' ? 0 : 1);
      if (ev !== 0) return ev;
      return FREQ_RANK[normFrequency(a.frequency)] - FREQ_RANK[normFrequency(b.frequency)];
    });
    const anchors = result.resumeAnchors ?? [];
    // Drop malformed chains (no questions) so a stub never renders an empty
    // article or throws on a missing nested array from raw LLM JSON.
    const chains = (result.followUpChains ?? []).filter((c) => (c.questions ?? []).length > 0);
    const gaps = result.gapRisks ?? [];
    const plan = result.practicePlan ?? [];
    const roleLabel = result.targetRole || targetRole;
    const downloadRole = (roleLabel || 'role').replace(/\s+/g, '_');

    return (
      <div data-qa="interview-prep-tool" data-qa-tool-state="result" className="mx-auto max-w-7xl space-y-5 break-words animate-fade-in">
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
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-teal-700 dark:text-teal-300">
                <ClipboardCheck className="h-4 w-4" />
                {t('tool_interview_prep_results_kicker')}
              </div>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100 sm:text-3xl">
                {roleLabel}{result.targetCompany ? ` · ${result.targetCompany}` : ''}
              </h2>
              {result.sourceCoverage && (
                <p className="mt-4 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
                  <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0 text-teal-700 dark:text-teal-300" />
                  <span><strong>{t('tool_interview_prep_coverage_label')}:</strong> {result.sourceCoverage}</span>
                </p>
              )}
            </div>
            <div className="border-t border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950/40 sm:p-6 xl:border-l xl:border-t-0">
              <button
                type="button"
                data-qa="interview-prep-start-mock"
                onClick={startMockInterview}
                className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-teal-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
              >
                <Mic className="h-4 w-4" aria-hidden="true" />
                {t('tool_interview_prep_start_interview_button')}
              </button>
              <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{t('tool_interview_prep_start_interview_desc')}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <DownloadButtons textContent={formatForDownload(result)} baseFilename={`interview_prep_${downloadRole}`} />
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

        {/* Block 1 — Likely Topics */}
        <CardShell className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-teal-700 dark:text-teal-300" />
            <div>
              <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{t('tool_interview_prep_block_topics_title')}</h3>
              <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">{t('tool_interview_prep_block_topics_desc')}</p>
            </div>
          </div>
          {ranked.length ? (
            <ol className="space-y-3">
              {ranked.map((q, index) => (
                <li key={index} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-teal-700 text-xs font-semibold text-white">{index + 1}</span>
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">{q.category}</span>
                    <EvidenceBadge level={normEvidence(q.evidenceLevel)} t={t} />
                    <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                      {t(`tool_interview_prep_freq_${normFrequency(q.frequency)}`)} · {t(`tool_interview_prep_recency_${normRecency(q.recency)}`)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-900 dark:text-slate-100">{q.question}</p>
                  {q.rationale && <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{q.rationale}</p>}
                </li>
              ))}
            </ol>
          ) : (
            <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700 dark:text-slate-300">
              {(result.predictedQuestions ?? []).map((q, i) => <li key={i}>{q}</li>)}
            </ol>
          )}
        </CardShell>

        {/* Block 2 — Project Follow-ups */}
        {(anchors.length > 0 || chains.length > 0) && (
          <CardShell className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <Layers className="h-5 w-5 text-teal-700 dark:text-teal-300" />
              <div>
                <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{t('tool_interview_prep_block_followups_title')}</h3>
                <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">{t('tool_interview_prep_block_followups_desc')}</p>
              </div>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              {chains.map((chain, index) => (
                <article key={index} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
                  <h4 className="text-base font-semibold text-slate-950 dark:text-slate-100">{chain.anchor}</h4>
                  <ol className="mt-3 space-y-2">
                    {(chain.questions ?? []).map((q, qi) => (
                      <li key={qi} className="flex items-start gap-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" aria-hidden="true" />
                        <span>{q}</span>
                      </li>
                    ))}
                  </ol>
                  {chain.watchFor && (
                    <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs leading-5 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                      <strong>{t('tool_interview_prep_watch_for_label')}:</strong> {chain.watchFor}
                    </p>
                  )}
                </article>
              ))}
            </div>
            {anchors.length > 0 && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {anchors.map((a, i) => (
                  <div key={i} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{a.label}</p>
                    {a.relevance && <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">{a.relevance}</p>}
                  </div>
                ))}
              </div>
            )}
          </CardShell>
        )}

        {/* Block 3 — Gaps to Fix */}
        {(gaps.length > 0 || (result.weakSpots ?? []).length > 0) && (
          <CardShell className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <TriangleAlert className="h-5 w-5 text-amber-600 dark:text-amber-300" />
              <div>
                <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{t('tool_interview_prep_block_gaps_title')}</h3>
                <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">{t('tool_interview_prep_block_gaps_desc')}</p>
              </div>
            </div>
            {gaps.length ? (
              <div className="space-y-3">
                {gaps.map((gap, index) => {
                  const sev = normSeverity(gap.severity);
                  return (
                    <article key={index} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ${SEVERITY_CLS[sev]}`}>
                            {t(`tool_interview_prep_severity_${sev}`)}
                          </span>
                          <h4 className="text-base font-semibold text-slate-950 dark:text-slate-100">{gap.area}</h4>
                        </div>
                        <button
                          type="button"
                          data-qa="interview-prep-plan-gap"
                          onClick={() => planForGap(gap)}
                          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 transition hover:bg-violet-100 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-200 dark:hover:bg-violet-900/40"
                        >
                          <GraduationCap className="h-4 w-4" aria-hidden="true" />
                          {t('tool_interview_prep_gap_plan_button')}
                        </button>
                      </div>
                      {gap.risk && <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">{gap.risk}</p>}
                      {gap.mitigation && (
                        <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-sm leading-relaxed text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-200">
                          <strong>{t('tool_interview_prep_gap_mitigation_label')}:</strong> {gap.mitigation}
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : (
              <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700 dark:text-slate-300">
                {(result.weakSpots ?? []).map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
          </CardShell>
        )}

        {/* Practice plan */}
        {plan.length > 0 && (
          <CardShell className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-teal-700 dark:text-teal-300" />
              <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{t('tool_interview_prep_practice_plan_title')}</h3>
            </div>
            <ol className="space-y-2">
              {plan.map((step, i) => (
                <li key={i} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white text-xs font-semibold text-teal-700 ring-1 ring-slate-200 dark:bg-slate-950 dark:text-teal-300 dark:ring-slate-700">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </CardShell>
        )}

        {/* Sources used */}
        {(result.sourceRefs ?? []).length > 0 && (
          <CardShell className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <FileText className="h-5 w-5 text-slate-500 dark:text-slate-400" />
              <h3 className="text-base font-semibold text-slate-950 dark:text-slate-100">{t('tool_interview_prep_sources_used_label')}</h3>
            </div>
            <ul className="flex flex-wrap gap-2">
              {(result.sourceRefs ?? []).map((ref, i) => (
                <li key={i} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-teal-500" aria-hidden="true" />
                  {ref.label}
                </li>
              ))}
            </ul>
          </CardShell>
        )}

        <button
          type="button"
          onClick={resetResult}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {t('tool_interview_prep_plan_another')}
        </button>
      </div>
    );
  };

  if (loading) {
    return (
      <StagedLoader
        title={t('tool_interview_prep_loader_title')}
        icon={<ClipboardCheck />}
        accent="teal"
        steps={[
          t('tool_interview_prep_step1'),
          t('tool_interview_prep_step2'),
          t('tool_interview_prep_step3'),
        ]}
        onCancel={cancel}
        cancelLabel={t('tool_loader_hide_button')}
        cancelHint={t('tool_loader_hide_hint')}
      />
    );
  }

  return result ? renderResult() : renderInput();
};

export default InterviewPrep;
