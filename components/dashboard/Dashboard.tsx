import React, { useState, useEffect, useCallback } from 'react';
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  type Timestamp,
} from 'firebase/firestore';
import {
  AlertTriangle,
  ArrowRight,
  Briefcase,
  CheckCircle2,
  ClipboardList,
  FileText,
  Lightbulb,
  ListChecks,
  MessageSquare,
  Sparkles,
  Target,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import type { UserProfile } from '../../types';
import Chart from './Chart';
import SourcingConsentInbox from '../SourcingConsentInbox';
import { firestoreDb } from '../../lib/firebaseClient';
import type { AppSession as Session } from '../../lib/data';
import { generateWeeklySummary } from '../../services/aiClient';
import { useRecentApplications } from '../../hooks/useRecentApplications';
import {
  getApplicationStatusLabelKey,
  isApplicationClosedStatus,
  isApplicationInterviewStatus,
} from '../../lib/applicationPipeline';

type DashboardDestination = 'resume' | 'jobs' | 'applications' | 'interview' | 'plan';

interface DashboardProps {
  session: Session | null;
  profile: UserProfile | null;
  t: (key: string) => string;
  hasResume?: boolean;
  onNavigate?: (view: DashboardDestination) => void;
}

interface ChartDataPoint {
  label: string;
  value: number;
}

interface ActivityItem {
  id: string;
  type: string;
  details: string;
}

type WeeklySummarySectionKey = 'win' | 'gap' | 'next';

interface WeeklySummarySection {
  key: WeeklySummarySectionKey;
  label: string;
  body: string;
}

/**
 * The latest weekly AI insight rendered on the dashboard (SCRUM-31).
 * Generated server-side by the generateWeeklyInsights scheduled function.
 */
interface WeeklyInsightCard {
  weekLabel: string;
  summaryText: string;
  actionableTip: string;
}

const toolMetadataMap: { [key: string]: { nameKey: string } } = {
  'cover-letter': { nameKey: 'tool_cover_letter_title' },
  'mock-interview': { nameKey: 'tool_mock_interview_title' },
  'resume-analysis': { nameKey: 'analysis_results_title' },
  'opportunity-finder': { nameKey: 'tool_opportunity_finder_title' },
  'career-path': { nameKey: 'tool_career_path_title' },
  default: { nameKey: 'dashboard_tool_usage' },
};

const formatCopy = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((copy, [key, value]) => copy.replaceAll(`{${key}}`, String(value)), template);

const normalizeSummaryText = (value: string) =>
  value
    .replace(/\r/g, '')
    .replace(/\*\*/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const clampSummaryText = (value: string, maxLength = 170) => {
  const copy = normalizeSummaryText(value).replace(/\n+/g, ' ');
  if (copy.length <= maxLength) return copy;

  const draft = copy.slice(0, maxLength);
  const boundary = Math.max(draft.lastIndexOf('. '), draft.lastIndexOf('; '), draft.lastIndexOf(', '), draft.lastIndexOf(' '));
  const clipped = boundary > 90 ? draft.slice(0, boundary) : draft;
  return `${clipped.trim()}...`;
};

const getWeeklySummaryKey = (label: string): WeeklySummarySectionKey => {
  const normalized = label.toLowerCase();
  if (normalized.includes('gap') || normalized.includes('risk')) return 'gap';
  if (normalized.includes('next') || normalized.includes('action')) return 'next';
  return 'win';
};

const parseWeeklySummarySections = (summary: string): WeeklySummarySection[] => {
  const source = normalizeSummaryText(summary);
  const labelRegex = /\b(Win|Wins|Gap|Gaps|Risk|Risks|Next Week|Next|Action|Actions):\s*/gi;
  const markers: Array<{ key: WeeklySummarySectionKey; label: string; start: number; end: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = labelRegex.exec(source)) !== null) {
    const label = match[1];
    markers.push({
      key: getWeeklySummaryKey(label),
      label: label.toLowerCase().includes('next') || label.toLowerCase().includes('action') ? 'Next' : getWeeklySummaryKey(label) === 'gap' ? 'Gap' : 'Win',
      start: match.index,
      end: labelRegex.lastIndex,
    });
  }

  if (markers.length === 0) return [];

  const sections = new Map<WeeklySummarySectionKey, WeeklySummarySection>();
  markers.forEach((marker, index) => {
    const nextMarker = markers[index + 1];
    const body = source.slice(marker.end, nextMarker?.start ?? source.length).trim();
    if (!body) return;

    const existing = sections.get(marker.key);
    sections.set(marker.key, {
      key: marker.key,
      label: marker.label,
      body: existing ? `${existing.body} ${body}` : body,
    });
  });

  return (['win', 'gap', 'next'] as WeeklySummarySectionKey[])
    .map((key) => sections.get(key))
    .filter((section): section is WeeklySummarySection => Boolean(section));
};

const toDate = (value: unknown): Date => {
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as Timestamp).toDate();
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
};

const MetricCard: React.FC<{
  label: string;
  value: string;
  helper: string;
  icon: LucideIcon;
  tone?: 'blue' | 'green' | 'amber' | 'slate';
}> = ({ label, value, helper, icon: Icon, tone = 'blue' }) => {
  const tones = {
    blue: 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800/50',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800/50',
    amber: 'bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800/50',
    slate: 'bg-slate-50 text-slate-700 dark:text-slate-300 border-slate-200 dark:bg-slate-800/60 dark:border-slate-700',
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">{value}</p>
        </div>
        <div className={`rounded-lg border p-2.5 ${tones[tone]}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{helper}</p>
    </div>
  );
};

const DashboardEmptyPanel: React.FC<{
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel: string;
  onAction?: () => void;
}> = ({ icon: Icon, title, description, actionLabel, onAction }) => (
  <div className="flex min-h-64 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-6 text-center dark:border-slate-700 dark:bg-slate-800/40 animate-panel-expand">
    <div className="max-w-sm">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-blue-700 dark:border-blue-800/50 dark:bg-blue-900/30 dark:text-blue-300">
        <Icon className="h-5 w-5" />
      </div>
      <h4 className="mt-4 text-base font-semibold text-slate-950 dark:text-slate-100">{title}</h4>
      <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{description}</p>
      {onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-5 inline-flex min-h-[38px] items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800"
        >
          {actionLabel}
          <ArrowRight className="h-4 w-4" />
        </button>
      )}
    </div>
  </div>
);

const PriorityItem: React.FC<{
  title: string;
  detail: string;
  status: 'High' | 'Medium' | 'Ready';
  statusLabel: string;
  onClick?: () => void;
}> = ({ title, detail, status, statusLabel, onClick }) => {
  const tone =
    status === 'High'
      ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800/50 dark:bg-red-900/30 dark:text-red-300'
      : status === 'Medium'
        ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/50 dark:bg-amber-900/30 dark:text-amber-300'
        : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-900/30 dark:text-emerald-300';

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-4 text-left transition hover:border-blue-200 hover:bg-blue-50/30 dark:hover:border-blue-800 dark:hover:bg-blue-900/20"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-slate-950 dark:text-slate-100">{title}</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{detail}</p>
        </div>
        <span className={`shrink-0 rounded border px-2 py-1 text-[11px] font-semibold ${tone}`}>{statusLabel}</span>
      </div>
    </button>
  );
};

const WeeklyCoachingSummary: React.FC<{ summary: string; t: DashboardProps['t'] }> = ({ summary, t }) => {
  const [expanded, setExpanded] = useState(false);
  const sections = parseWeeklySummarySections(summary);
  const normalizedSummary = normalizeSummaryText(summary);
  const shouldShowFullText = normalizedSummary.length > 360;
  const sectionTone: Record<WeeklySummarySectionKey, string> = {
    win: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800/50 dark:bg-emerald-900/20 dark:text-emerald-100',
    gap: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-100',
    next: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800/50 dark:bg-blue-900/20 dark:text-blue-100',
  };

  return (
    <div className="mt-4">
      {sections.length >= 2 ? (
        <div className="grid gap-3 lg:grid-cols-3">
          {sections.map((section) => (
            <article key={section.key} className={`rounded-lg border p-3 ${sectionTone[section.key]}`}>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-80">{section.label}</p>
              <p className="mt-2 text-sm leading-6">{clampSummaryText(section.body, 180)}</p>
            </article>
          ))}
        </div>
      ) : (
        <p
          className={`rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300 ${
            expanded && shouldShowFullText ? 'max-h-52 overflow-y-auto whitespace-pre-wrap' : ''
          }`}
        >
          {expanded ? normalizedSummary : clampSummaryText(normalizedSummary, 360)}
        </p>
      )}

      {shouldShowFullText && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex min-h-[34px] items-center rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-blue-200 hover:text-blue-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-blue-700 dark:hover:text-blue-300"
            aria-expanded={expanded}
          >
            {expanded ? t('agency_summary_show_less') : t('agency_summary_show_more')}
          </button>
          {expanded && sections.length >= 2 && (
            <p className="mt-3 max-h-52 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
              {normalizedSummary}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

const Dashboard: React.FC<DashboardProps> = ({ session, profile, t, hasResume = false, onNavigate }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scoreData, setScoreData] = useState<ChartDataPoint[]>([]);
  const [weeklySummary, setWeeklySummary] = useState<string>('');
  const [weeklyInsight, setWeeklyInsight] = useState<WeeklyInsightCard | null>(null);
  const [topSkills, setTopSkills] = useState<string[]>([]);
  const [priorityFixCount, setPriorityFixCount] = useState<number | null>(null);
  const [activityFeed, setActivityFeed] = useState<ActivityItem[]>([]);
  const {
    applications,
    loading: applicationsLoading,
    error: applicationsError,
    retry: retryApplications,
  } = useRecentApplications(session);

  const fetchDashboardData = useCallback(async () => {
    if (!session?.user) {
      setLoading(false);
      setScoreData([]);
      setTopSkills([]);
      setPriorityFixCount(null);
      setActivityFeed([]);
      setWeeklySummary(t('dashboard_welcome_summary'));
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const userId = session.user.id;

      const [analysesResult, activitiesResult, insightResult] = await Promise.allSettled([
        getDocs(query(
          collection(firestoreDb, 'users', userId, 'resume_analyses'),
          orderBy('created_at', 'asc'),
          limit(10),
        )),
        getDocs(query(
          collection(firestoreDb, 'users', userId, 'tool_events'),
          orderBy('created_at', 'desc'),
          limit(4),
        )),
        // Latest weekly AI insight, written server-side by the
        // generateWeeklyInsights scheduled function (SCRUM-31).
        getDocs(query(
          collection(firestoreDb, 'users', userId, 'weekly_insights'),
          orderBy('week_start_date', 'desc'),
          limit(1),
        )),
      ]);

      const unavailableHistorySections: string[] = [];
      let analyses: Record<string, unknown>[] = [];
      let activities: (Record<string, unknown> & { id: string })[] = [];

      if (analysesResult.status === 'fulfilled') {
        analyses = analysesResult.value.docs.map((doc) => doc.data());
      } else {
        unavailableHistorySections.push(t('dashboard_section_readiness_history'));
        setScoreData([]);
        setTopSkills([]);
        setPriorityFixCount(null);
      }

      const chartData = analyses.map((a) => ({
        label: toDate(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        value: Number(a.score) || 0,
      }));
      setScoreData(chartData);

      if (analyses.length > 0) {
        const latestAnalysis = analyses[analyses.length - 1];
        if (Array.isArray(latestAnalysis.keywords)) {
          setTopSkills(latestAnalysis.keywords.slice(0, 5));
        } else {
          setTopSkills([]);
        }
        setPriorityFixCount(
          Array.isArray(latestAnalysis.improvements) ? latestAnalysis.improvements.length : null,
        );
      } else {
        setTopSkills([]);
        setPriorityFixCount(null);
      }

      if (activitiesResult.status === 'fulfilled') {
        activities = activitiesResult.value.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
      } else {
        unavailableHistorySections.push(t('dashboard_section_recent_activity'));
        setActivityFeed([]);
      }

      const feedData = activities.map((act, index) => {
        const toolKey = typeof act.tool_key === 'string' ? act.tool_key : 'default';
        const toolInfo = toolMetadataMap[toolKey] || toolMetadataMap.default;
        const toolName = t(toolInfo.nameKey);
        let details = t('dashboard_activity_used').replace('{tool}', toolName);
        if (act.metadata && typeof act.metadata === 'object') {
          const meta = act.metadata as { [key: string]: unknown };
          if (Array.isArray(meta.scoreChange)) {
            details = t('dashboard_activity_score_changed')
              .replace('{from}', String(meta.scoreChange[0]))
              .replace('{to}', String(meta.scoreChange[1]));
          }
          if (typeof meta.jobTitle === 'string') {
            details = t('dashboard_activity_for_job').replace('{job}', meta.jobTitle);
          }
        }
        return {
          id: act.id || `${toolKey}-${toDate(act.created_at).getTime()}-${index}`,
          type: toolName,
          details,
        };
      });
      setActivityFeed(feedData);

      const insight = insightResult.status === 'fulfilled'
        ? insightResult.value.docs[0]?.data()
        : null;
      if (insightResult.status === 'rejected') {
        unavailableHistorySections.push(t('dashboard_section_weekly_history'));
      }

      // Latest weekly AI insight card — written server-side by the scheduled
      // generateWeeklyInsights function (SCRUM-31). Read-only here; the
      // weekly_insights collection is server-write-only per firestore.rules.
      if (insight && typeof insight.summary_text === 'string' && insight.summary_text.trim().length > 0) {
        const weekDate = toDate(insight.week_start_date);
        setWeeklyInsight({
          weekLabel: formatCopy(t('dashboard_weekly_insight_week'), {
            week: weekDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          }),
          summaryText: insight.summary_text.trim(),
          actionableTip: typeof insight.actionable_tip === 'string' ? insight.actionable_tip.trim() : '',
        });
        // Also feed dev's legacy weekly-coaching card from the same stored text.
        setWeeklySummary(insight.summary_text.trim());
      } else {
        setWeeklyInsight(null);
        // Legacy coaching-summary copy (no client persistence — writes are
        // server-only). Generate an on-the-fly blurb when there is activity.
        if (analyses.length > 0 || activities.length > 0) {
          try {
            const { summary } = await generateWeeklySummary({
              scores: chartData,
              activities: activities.map((a) => a.tool_key),
            });
            setWeeklySummary(
              typeof summary === 'string' && summary.trim().length > 0
                ? summary
                : t('dashboard_welcome_summary'),
            );
          } catch {
            setWeeklySummary(t('dashboard_generated_summary_fallback'));
          }
        } else {
          setWeeklySummary(t('dashboard_welcome_summary'));
        }
      }

      setError(
        unavailableHistorySections.length > 0
          ? t('dashboard_partial_data_error').replace('{sections}', unavailableHistorySections.join(', '))
          : null,
      );
    } catch (err: unknown) {
      setError(t('dashboard_history_load_error'));
      setWeeklySummary(t('dashboard_generated_summary_fallback'));
    } finally {
      setLoading(false);
    }
    // Depend on the user id PRIMITIVE, not the session object: Firebase auth
    // events (token refresh / tab refocus) recreate the session object without
    // changing the user, and the object identity would re-fire the auto-fetch
    // (incl. the weekly-summary AI call) on every such event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, t]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const hasReadinessHistory = scoreData.length > 0;
  const latestScore = hasReadinessHistory ? scoreData[scoreData.length - 1]?.value ?? null : null;
  const hasSkillSignals = topSkills.length > 0;
  const firstName = profile?.full_name?.split(' ')[0] || t('dashboard_user_fallback');
  const nextCtaLabel = hasReadinessHistory
    ? t('dashboard_review_priority_fixes')
    : hasResume ? t('dashboard_readiness_empty_cta') : t('ws_upload_resume');
  const applicationPulse = applications.reduce(
    (counts, app) => {
      const isClosed = isApplicationClosedStatus(app.status);
      const isInterviewing = isApplicationInterviewStatus(app.status);
      return {
        total: counts.total + 1,
        active: counts.active + (isClosed ? 0 : 1),
        interviewing: counts.interviewing + (isInterviewing ? 1 : 0),
        closed: counts.closed + (isClosed ? 1 : 0),
      };
    },
    { total: 0, active: 0, interviewing: 0, closed: 0 },
  );
  const latestApplication = applications[0];
  const applicationStageHelper = applicationsLoading
    ? t('dashboard_app_stage_loading')
    : applicationsError
      ? t('applications_error_desc')
    : applicationPulse.total > 0
      ? formatCopy(t('dashboard_app_stage_counts'), {
          active: applicationPulse.active,
          interviewing: applicationPulse.interviewing,
        })
      : t('dashboard_app_stage_track');

  const priorities = hasResume
    ? [
        {
          title: t('dashboard_priority_rewrite_title'),
          detail: t('dashboard_priority_rewrite_detail'),
          status: 'High' as const,
          view: 'resume' as const,
        },
        {
          title: t('dashboard_priority_matches_title'),
          detail: t('dashboard_priority_matches_detail'),
          status: 'Medium' as const,
          view: 'jobs' as const,
        },
        {
          title: t('dashboard_priority_interview_title'),
          detail: t('dashboard_priority_interview_detail'),
          status: 'Medium' as const,
          view: 'interview' as const,
        },
      ]
    : [
        {
          title: t('dashboard_priority_upload_title'),
          detail: t('dashboard_priority_upload_detail'),
          status: 'High' as const,
          view: 'resume' as const,
        },
        {
          title: t('dashboard_priority_plan_title'),
          detail: t('dashboard_priority_plan_detail'),
          status: 'Medium' as const,
          view: 'plan' as const,
        },
      ];

  const searchStages = [
    {
      label: t('dashboard_stage_resume_label'),
      helper: hasResume ? t('dashboard_stage_resume_ready') : t('dashboard_stage_resume_upload'),
      icon: FileText,
      view: 'resume' as const,
      tone: hasResume ? 'ready' : 'gap',
    },
    {
      label: t('dashboard_stage_roles_label'),
      helper: hasResume ? t('dashboard_stage_roles_ready') : t('dashboard_stage_roles_need_resume'),
      icon: Briefcase,
      view: 'jobs' as const,
      tone: hasResume ? 'ready' : 'gap',
    },
    {
      label: t('dashboard_stage_pipeline_label'),
      helper: applicationStageHelper,
      icon: ClipboardList,
      view: 'applications' as const,
      tone: applicationPulse.total > 0 ? 'ready' : hasResume ? 'neutral' : 'gap',
    },
    {
      label: t('dashboard_stage_interview_label'),
      helper: hasResume ? t('dashboard_stage_interview_ready') : t('dashboard_stage_interview_later'),
      icon: MessageSquare,
      view: 'interview' as const,
      tone: 'neutral',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-blue-700 dark:text-blue-400">{t('dashboard_workbench_kicker')}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100 sm:text-3xl">
              {formatCopy(t('dashboard_workbench_welcome'), { name: firstName })}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              {t('dashboard_workbench_desc')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate?.('resume')}
            className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800"
          >
            {nextCtaLabel}
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
        {error && (
          <div className="mt-4 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{formatCopy(t('dashboard_live_history_unavailable'), { error })}</span>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {searchStages.map((stage) => {
          const Icon = stage.icon;
          return (
            <button
              key={stage.label}
              type="button"
              onClick={() => onNavigate?.(stage.view)}
              className="rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-200 hover:bg-blue-50/30 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-blue-800 dark:hover:bg-blue-900/20"
            >
              <div className="flex items-center gap-2">
                <div className={`rounded-lg border p-2 ${
                  stage.tone === 'ready'
                    ? 'border-emerald-100 bg-emerald-50 text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-900/30 dark:text-emerald-300'
                    : stage.tone === 'gap'
                      ? 'border-amber-100 bg-amber-50 text-amber-700 dark:border-amber-800/50 dark:bg-amber-900/30 dark:text-amber-300'
                      : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                }`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-950 dark:text-slate-100">{stage.label}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-500">{stage.helper}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {session?.user?.id && (
        <SourcingConsentInbox uid={session.user.id} t={t} />
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label={t('dashboard_metric_resume_readiness')}
          value={latestScore !== null ? `${latestScore}` : '--'}
          helper={
            latestScore !== null
              ? t('dashboard_metric_resume_readiness_ready')
              : hasResume ? t('dashboard_metric_resume_readiness_pending') : t('dashboard_metric_resume_readiness_empty')
          }
          icon={FileText}
          tone="blue"
        />
        <MetricCard
          label={t('dashboard_metric_priority_fixes')}
          value={priorityFixCount !== null ? `${priorityFixCount}` : '--'}
          helper={
            priorityFixCount !== null
              ? t('dashboard_metric_priority_fixes_ready')
              : hasResume ? t('dashboard_metric_priority_fixes_pending') : t('dashboard_metric_priority_fixes_empty')
          }
          icon={ListChecks}
          tone="amber"
        />
        <MetricCard
          label={t('dashboard_metric_matched_roles')}
          value={hasSkillSignals ? t('dashboard_metric_roles_ready_value') : '--'}
          helper={
            hasSkillSignals
              ? t('dashboard_metric_matched_roles_ready')
              : hasResume ? t('dashboard_metric_matched_roles_pending') : t('dashboard_metric_matched_roles_empty')
          }
          icon={Briefcase}
          tone="green"
        />
        <MetricCard
          label={t('dashboard_metric_application_status')}
          value={applicationsLoading ? '...' : applicationsError ? '--' : hasResume ? `${applicationPulse.active}` : '--'}
          helper={
            applicationsLoading
              ? t('dashboard_metric_application_status_loading')
              : applicationsError
                ? t('applications_error_desc')
              : applicationPulse.total > 0
                ? formatCopy(t('dashboard_metric_application_status_counts'), {
                    interviewing: applicationPulse.interviewing,
                    closed: applicationPulse.closed,
                  })
                : hasResume ? t('dashboard_metric_application_status_ready') : t('dashboard_metric_application_status_empty')
          }
          icon={ClipboardList}
          tone="slate"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-5 shadow-sm">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{t('dashboard_readiness_trend_title')}</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">{t('dashboard_readiness_trend_desc')}</p>
            </div>
            {loading && <span className="text-xs font-medium text-slate-500 dark:text-slate-500">{t('dashboard_loading_history')}</span>}
          </div>
          {hasReadinessHistory ? (
            <div className="h-64 min-w-0 overflow-hidden">
              <Chart data={scoreData} width={620} height={250} t={t} />
            </div>
          ) : (
            <DashboardEmptyPanel
              icon={FileText}
              title={t('dashboard_readiness_empty_title')}
              description={hasResume ? t('dashboard_readiness_empty_desc_with_resume') : t('dashboard_readiness_empty_desc')}
              actionLabel={hasResume ? t('dashboard_readiness_empty_cta') : t('ws_upload_resume')}
              onAction={() => onNavigate?.('resume')}
            />
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{t('dashboard_current_skill_title')}</h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t('dashboard_current_skill_desc')}</p>
          {hasSkillSignals ? (
            // Plain chips from real resume keywords — no proficiency %: we have no
            // per-skill measurement, so attaching a number would be fabricated data.
            <div className="mt-5 flex flex-wrap gap-2">
              {topSkills.slice(0, 4).map((skill) => (
                <span
                  key={skill}
                  className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 px-3 py-1 text-xs font-medium text-slate-800 dark:text-slate-200"
                >
                  {skill}
                </span>
              ))}
            </div>
          ) : (
            <div className="mt-5">
              <DashboardEmptyPanel
                icon={Target}
                title={t('dashboard_skill_empty_title')}
                description={hasResume ? t('dashboard_skill_empty_desc_with_resume') : t('dashboard_skill_empty_desc')}
                actionLabel={hasResume ? t('dashboard_skill_empty_cta') : t('ws_upload_resume')}
                onAction={() => onNavigate?.('resume')}
              />
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{t('dashboard_priority_queue_title')}</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">{t('dashboard_priority_queue_desc')}</p>
            </div>
            <Target className="h-5 w-5 text-blue-700 dark:text-blue-400" />
          </div>
          <div className="space-y-3">
            {priorities.map((item) => (
              <PriorityItem
                key={item.title}
                title={item.title}
                detail={item.detail}
                status={item.status}
                statusLabel={t(`dashboard_priority_status_${item.status.toLowerCase()}`)}
                onClick={() => onNavigate?.(item.view)}
              />
            ))}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-1">
          <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{t('dashboard_application_progress_title')}</h3>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  {applicationsLoading
                    ? t('dashboard_application_progress_loading')
                    : applicationsError
                      ? t('applications_error_title')
                    : latestApplication
                      ? formatCopy(t('dashboard_application_progress_latest'), {
                          role: latestApplication.job_title || t('dashboard_recent_role_fallback'),
                          status: t(getApplicationStatusLabelKey(latestApplication.status)) || t('dashboard_tracked_status_fallback'),
                        })
                      : t('dashboard_application_progress_empty')}
                </p>
              </div>
              <span className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-sm font-semibold text-blue-700 dark:border-blue-800/50 dark:bg-blue-900/30 dark:text-blue-300">
                {applicationsLoading
                  ? '...'
                  : applicationsError
                    ? '--'
                  : formatCopy(t('dashboard_application_tracked_count'), { count: applicationPulse.total })}
              </span>
            </div>
            {applicationsError && !applicationsLoading && (
              <div
                className="mt-4 flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200 sm:flex-row sm:items-center sm:justify-between"
                role="alert"
              >
                <span>{t('applications_error_desc')}</span>
                <button
                  type="button"
                  onClick={retryApplications}
                  className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-red-300 bg-white px-3 font-semibold text-red-700 transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-900/50"
                >
                  {t('action_retry')}
                </button>
              </div>
            )}
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {[
                [t('dashboard_pipeline_active'), applicationPulse.active],
                [t('dashboard_pipeline_interviewing'), applicationPulse.interviewing],
                [t('dashboard_pipeline_closed'), applicationPulse.closed],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-500">{label}</p>
                  <p className="mt-1 text-xl font-semibold text-slate-950 dark:text-slate-100">
                    {applicationsLoading ? '...' : applicationsError ? '--' : value}
                  </p>
                </div>
              ))}
            </div>
            {!applicationsError && (
              <button
                type="button"
                onClick={() => onNavigate?.(applicationPulse.total > 0 ? 'applications' : 'jobs')}
                className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
              >
                {applicationPulse.total > 0 ? t('dashboard_open_application_pipeline') : t('dashboard_find_roles_to_apply')}
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-2 text-blue-700 dark:border-blue-800/50 dark:bg-blue-900/30 dark:text-blue-300">
                <MessageSquare className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{t('dashboard_next_interview_title')}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  {t('dashboard_next_interview_desc')}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate?.('interview')}
              className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
            >
              {t('dashboard_open_practice_room')}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-blue-700 dark:text-blue-400" />
          <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{t('dashboard_weekly_insight_title')}</h3>
          {weeklyInsight && (
            <span className="ml-auto rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
              {weeklyInsight.weekLabel}
            </span>
          )}
        </div>
        {weeklyInsight ? (
          <div className="mt-3">
            <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{weeklyInsight.summaryText}</p>
            {weeklyInsight.actionableTip && (
              <div className="mt-4 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800/50 dark:bg-blue-900/20">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-blue-700 dark:text-blue-300" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">{t('dashboard_weekly_insight_tip_label')}</p>
                  <p className="mt-1 text-sm leading-relaxed text-blue-900 dark:text-blue-100">{weeklyInsight.actionableTip}</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4">
            <DashboardEmptyPanel
              icon={Sparkles}
              title={t('dashboard_weekly_insight_empty_title')}
              description={t('dashboard_weekly_insight_empty_desc')}
              actionLabel={hasResume ? t('dashboard_skill_empty_cta') : t('ws_upload_resume')}
              onAction={() => onNavigate?.(hasResume ? 'jobs' : 'resume')}
            />
          </div>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-blue-700 dark:text-blue-400" />
            <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{t('dashboard_weekly_coaching_title')}</h3>
          </div>
          <WeeklyCoachingSummary summary={weeklySummary} t={t} />
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {[t('dashboard_weekly_chip_resume'), t('dashboard_weekly_chip_applications'), t('dashboard_weekly_chip_interview')].map((label, index) => (
              <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                  <CheckCircle2 className={`h-4 w-4 ${index === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-600'}`} />
                  {label}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{t('dashboard_recent_activity_title')}</h3>
          <div className="mt-4">
            {activityFeed.length > 0 ? (
              <div className="space-y-3">
                {activityFeed.map((item) => (
                  <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60 p-3">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{item.type}</p>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{item.details}</p>
                  </div>
                ))}
              </div>
            ) : (
              <DashboardEmptyPanel
                icon={ClipboardList}
                title={t('dashboard_activity_empty_title')}
                description={hasResume ? t('dashboard_activity_empty_desc_with_resume') : t('dashboard_activity_empty_desc')}
                actionLabel={hasResume ? t('dashboard_activity_empty_cta') : t('ws_upload_resume')}
                onAction={() => onNavigate?.(hasResume ? 'jobs' : 'resume')}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
