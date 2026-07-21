

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    ArrowLeft,
    ArrowRight,
    BookOpen,
    Briefcase,
    CheckCircle2,
    ChevronDown,
    Clock3,
    ClipboardCheck,
    Download,
    Eye,
    FileWarning,
    GraduationCap,
    Link as LinkIcon,
    MessageSquare,
    RotateCcw,
    Search,
    SlidersHorizontal,
    Sparkles,
    Star,
    Target,
    Users,
    X,
} from 'lucide-react';
import {
    listJobApplicants,
    getApplicantResumeFile,
    getApplicantResumeText,
    updateApplicationStatus,
    bulkUpdateApplicationStatus,
    type ApplicationStatusAction,
    type BulkApplicationStatusAction,
    type ApplicationStatusHistoryEvent,
    type JobApplicant,
} from '../services/aiClient';
import { normalizeApplicantsForFunnel, stringArray } from '../lib/applicantFunnelNormalize';
import { saveToShortlist } from '../lib/shortlistData';
import { listInterviewsForApplication, scheduleInterview, updateInterview, type ApplicationInterview, type InterviewFormat } from '../lib/interviewData';
import {
    SCORECARD_RATING_KEYS,
    listScorecardsForApplication,
    upsertScorecard,
    type ApplicationScorecard,
    type ScorecardRatingKey,
    type ScorecardRecommendation,
} from '../lib/scorecardData';
import { TALENT_PROFILE_SCHEMA, hasMeaningfulEntry, type Section, type TalentProfile } from '../lib/talentProfile';
import { useToast } from './Toast';
import ResumePreview from './ResumePreview';
import FunnelChart from './FunnelChart';
import ApplicationMessageThread from './ApplicationMessageThread';
import RecoverableSectionBoundary from './RecoverableSectionBoundary';
import { ViewportAwareDialog } from './ViewportAwareDialog';
import ConfirmActionDialog from './ConfirmActionDialog';
import { normalizeJobPostingForClient } from '../lib/jobPostingNormalize';
import {
    APPLICATION_PIPELINE_STAGES,
    getApplicationStatusIndex,
    getApplicationStatusLabelKey,
    getLaterApplicationPipelineStatuses,
    getNextApplicationPipelineStatus,
    getSkippedApplicationStatuses,
    isApplicationRejectedStatus,
    normalizeApplicationStatus,
    type ApplicationPipelineStatus,
    type ApplicationPipelineStageStatus,
} from '../lib/applicationPipeline';
import type { JobPosting } from '../lib/recruitingData';
import { collectCandidateSkills, matchSkills } from '../lib/skillMatch';
import { experienceLevelLabelKey } from '../constants/jobPostingFields';

interface ApplicantFunnelProps {
  job: JobPosting;
  employerUid: string;
  onBack: () => void;
  t: (key: string) => string;
}

// Server-computed safe shape: match analysis is flattened onto each applicant;
// resume_text never reaches the browser (see services/aiClient listJobApplicants).
type Applicant = JobApplicant;

type ScoreThreshold = 'all' | '50' | '70' | '85';
type SortKey = 'score' | 'newest' | 'name';
type RecencyFilter = 'all' | '7' | '30';
type AnalysisFilter = 'all' | 'analyzed' | 'needs_review';
type QuickFilterKey = 'all' | 'high_match' | 'recent' | 'needs_review';
type RecommendationTone = 'strong' | 'screen' | 'review';
type BulkActionMode = BulkApplicationStatusAction;

const SCORE_OPTIONS: ScoreThreshold[] = ['all', '50', '70', '85'];
const SORT_OPTIONS: SortKey[] = ['score', 'newest', 'name'];
const RECENCY_OPTIONS: RecencyFilter[] = ['all', '7', '30'];
const ANALYSIS_OPTIONS: AnalysisFilter[] = ['all', 'analyzed', 'needs_review'];
const SELECT_CLASS = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100';
const RECOMMENDATION_TONE_CLASS: Record<RecommendationTone, string> = {
    strong: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-100',
    screen: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/20 dark:text-blue-100',
    review: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100',
};

function formatTranslation(template: string, values: Record<string, string | number>): string {
    return Object.entries(values).reduce(
        (text, [key, value]) => text
            .replaceAll(`{{${key}}}`, String(value))
            .replaceAll(`{${key}}`, String(value)),
        template,
    );
}

function hasApplicantAnalysis(applicant: Applicant): boolean {
    if (applicant.analysis_status === 'complete') return true;
    return Boolean(
        applicant.summary ||
        applicant.strengths.length > 0 ||
        applicant.potentialGaps.length > 0 ||
        applicant.suggestedQuestions.length > 0 ||
        (applicant.compatibility_score ?? 0) > 0,
    );
}

function formatTalentValue(value: unknown): string {
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).join(', ');
    return typeof value === 'string' ? value.trim() : '';
}

function isTalentRecord(value: unknown): value is Record<string, string | string[]> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function talentRecordList(value: unknown): Record<string, string | string[]>[] {
    return Array.isArray(value) ? value.filter(isTalentRecord) : [];
}

function talentStringList(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
        : [];
}

function talentEntries(record: unknown): Array<[string, string]> {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return [];
    return Object.entries(record as Record<string, unknown>)
        .map(([key, value]) => [key, formatTalentValue(value)] as [string, string])
        .filter(([, value]) => value.length > 0);
}

function talentProfileHasData(profile: TalentProfile | null | undefined): boolean {
    if (!profile) return false;
    const data = profile as unknown as Record<string, unknown>;
    return TALENT_PROFILE_SCHEMA.some((section) => {
        const sectionData = data[section.id];
        if (section.kind === 'skills') {
            return collectCandidateSkills(profile).length > 0;
        }
        if (section.kind === 'list') {
            return talentRecordList(sectionData).some(hasMeaningfulEntry);
        }
        return talentEntries(sectionData).length > 0;
    });
}

function talentProfileSearchTokens(profile: TalentProfile | null | undefined): string[] {
    if (!profile) return [];
    const tokens: string[] = [];
    const data = profile as unknown as Record<string, unknown>;
    for (const section of TALENT_PROFILE_SCHEMA) {
        const sectionData = data[section.id];
        if (section.kind === 'skills') {
            tokens.push(...collectCandidateSkills(profile));
        } else if (section.kind === 'list' && Array.isArray(sectionData)) {
            talentRecordList(sectionData).forEach((entry) => talentEntries(entry).forEach(([, value]) => tokens.push(value)));
        } else {
            talentEntries(sectionData).forEach(([, value]) => tokens.push(value));
        }
    }
    return tokens;
}

function collectTalentSkills(profile: TalentProfile | null | undefined): string[] {
    return collectCandidateSkills(profile).slice(0, 10);
}

function getTalentCurrentRole(profile: TalentProfile | null | undefined): string | undefined {
    const targetRole = typeof profile?.intention?.targetRole === 'string' ? profile.intention.targetRole.trim() : '';
    // Experience entries are stored in the order the candidate added them (not
    // date-sorted), so experience[0] is NOT necessarily the current role. Prefer
    // an ongoing role (no end date), else the most recent by end/start date.
    const rawExperience = Array.isArray(profile?.experience) ? profile.experience : [];
    const exp = rawExperience.filter((e) => typeof e?.role === 'string' && e.role.trim());
    const dateKey = (e: Record<string, string | string[]>) => String(e?.endDate || e?.startDate || '');
    const ongoing = exp.find((e) => !String(e?.endDate ?? '').trim());
    const byDate = [...exp].sort((a, b) => dateKey(b).localeCompare(dateKey(a)));
    const latestRole = String(ongoing?.role || byDate[0]?.role || '').trim();
    return targetRole || latestRole || undefined;
}

const TALENT_SECTION_ICONS: Record<string, React.ElementType> = {
    basic: Users,
    intention: Target,
    education: GraduationCap,
    experience: Briefcase,
    projects: Sparkles,
    skills: BookOpen,
    awards: Star,
    portfolio: LinkIcon,
    references: MessageSquare,
    additional: FileWarning,
};

const TalentProfileSummary: React.FC<{ profile: TalentProfile | null | undefined; t: (key: string) => string }> = ({ profile, t }) => {
    // Render nothing when there is no structured profile — absence of the section
    // (and of the "Talent Profile" chip) already signals it. Avoids stacking a
    // dashed empty box above the separate "no analysis" placeholder.
    if (!talentProfileHasData(profile)) return null;

    const safeProfile = profile as TalentProfile;
    const data = safeProfile as unknown as Record<string, unknown>;
    const topSignals = [
        { label: t('applicant_funnel_talent_profile_target'), value: formatTalentValue(safeProfile.intention?.targetRole) },
        { label: t('applicant_funnel_talent_profile_location'), value: [safeProfile.basic?.city, safeProfile.basic?.country].map(formatTalentValue).filter(Boolean).join(', ') },
        {
            label: t('applicant_funnel_talent_profile_history'),
            value: String((Array.isArray(safeProfile.education) ? safeProfile.education.length : 0) + (Array.isArray(safeProfile.experience) ? safeProfile.experience.length : 0)),
        },
        { label: t('applicant_funnel_talent_profile_skills'), value: String(collectTalentSkills(safeProfile).length) },
    ].filter((signal) => signal.value && signal.value !== '0');

    const renderSection = (section: Section) => {
        const Icon = TALENT_SECTION_ICONS[section.id] ?? FileWarning;
        if (section.kind === 'skills') {
            const groups = section.groups
                .map((group) => ({ ...group, values: talentStringList(safeProfile.skills?.[group.key]) }))
                .filter((group) => group.values.length > 0);
            if (groups.length === 0) return null;
            return (
                <div key={section.id} className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                    <h5 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                        <Icon className="h-4 w-4 text-blue-600 dark:text-blue-300" />
                        {section.title}
                    </h5>
                    <div className="mt-3 space-y-3">
                        {groups.map((group) => (
                            <div key={group.key}>
                                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{group.label}</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {group.values.map((value) => (
                                        <span key={`${group.key}-${value}`} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                                            {value}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            );
        }

        if (section.kind === 'list') {
            const items = talentRecordList(data[section.id]);
            const meaningful = items.filter(hasMeaningfulEntry);
            if (meaningful.length === 0) return null;
            return (
                <div key={section.id} className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                    <h5 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                        <Icon className="h-4 w-4 text-blue-600 dark:text-blue-300" />
                        {section.title}
                    </h5>
                    <div className="mt-3 space-y-3">
                        {meaningful.map((item, index) => {
                            const title = formatTalentValue(item[section.itemTitleKey]) || `${section.itemLabel} ${index + 1}`;
                            const rows = section.fields
                                .map((field) => [field.label, formatTalentValue(item[field.key])] as [string, string])
                                .filter(([, value]) => value.length > 0);
                            return (
                                <div key={`${section.id}-${index}`} className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900/70">
                                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{title}</p>
                                    <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                                        {rows.map(([label, value]) => (
                                            <div key={`${label}-${value}`} className="min-w-0">
                                                <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">{label}</dt>
                                                <dd className="break-words text-sm leading-5 text-gray-700 dark:text-gray-300">{value}</dd>
                                            </div>
                                        ))}
                                    </dl>
                                </div>
                            );
                        })}
                    </div>
                </div>
            );
        }

        const rows = section.fields
            .map((field) => [field.label, formatTalentValue((data[section.id] as Record<string, unknown> | undefined)?.[field.key])] as [string, string])
            .filter(([, value]) => value.length > 0);
        if (rows.length === 0) return null;
        return (
            <div key={section.id} className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                <h5 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                    <Icon className="h-4 w-4 text-blue-600 dark:text-blue-300" />
                    {section.title}
                </h5>
                <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                    {rows.map(([label, value]) => (
                        <div key={`${section.id}-${label}`} className="min-w-0">
                            <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">{label}</dt>
                            <dd className="break-words text-sm leading-5 text-gray-700 dark:text-gray-300">{value}</dd>
                        </div>
                    ))}
                </dl>
            </div>
        );
    };

    return (
        <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4 dark:border-blue-900/60 dark:bg-blue-950/10">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h4 className="text-base font-bold text-gray-900 dark:text-gray-100">{t('applicant_funnel_talent_profile_title')}</h4>
                    <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-400">{t('applicant_funnel_talent_profile_desc')}</p>
                </div>
                <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${
                    safeProfile.status === 'complete'
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                        : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                }`}>
                    {safeProfile.status === 'complete' ? t('applicant_funnel_talent_profile_complete') : t('applicant_funnel_talent_profile_draft')}
                </span>
            </div>

            {topSignals.length > 0 && (
                <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    {topSignals.map((signal) => (
                        <div key={signal.label} className="rounded-lg bg-white px-3 py-2 dark:bg-gray-900/70">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">{signal.label}</p>
                            <p className="mt-1 truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{signal.value}</p>
                        </div>
                    ))}
                </div>
            )}

            <div className="mt-4 grid gap-3">
                {TALENT_PROFILE_SCHEMA.map(renderSection)}
            </div>
        </div>
    );
};

function isWithinDays(dateValue: string | null, days: number): boolean {
    if (!dateValue) return false;
    const timestamp = new Date(dateValue).getTime();
    if (Number.isNaN(timestamp)) return false;
    return Date.now() - timestamp <= days * 24 * 60 * 60 * 1000;
}

function toApplicationTime(dateValue: string | null): number {
    if (!dateValue) return 0;
    const timestamp = new Date(dateValue).getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
}

/**
 * Job-fit checklist — deterministic (no-AI) must-have evidence the recruiter can
 * defend: each of the job's required skills marked met/missing against the
 * candidate's Talent-Profile skills (the SAME signal the candidate saw at apply
 * time), plus the role's experience level + required qualifications for context.
 */
const JobFitChecklist: React.FC<{ job: JobPosting; profile: TalentProfile | null | undefined; t: (key: string) => string }> = ({ job, profile, t }) => {
    const required = Array.isArray(job.required_skills) ? job.required_skills : [];
    const hasContext = required.length > 0 || !!job.required_qualifications || !!job.experience_level;
    if (!hasContext) return null;
    const fit = matchSkills(collectCandidateSkills(profile), required);
    return (
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center justify-between gap-2">
                <h4 className="font-semibold text-gray-900 dark:text-gray-100">{t('applicant_funnel_checklist_title')}</h4>
                {fit.requiredCount > 0 && (
                    <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                        {t('applicant_funnel_checklist_count').replace('{matched}', String(fit.matchedCount)).replace('{total}', String(fit.requiredCount))}
                    </span>
                )}
            </div>
            <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{t('applicant_funnel_checklist_desc')}</p>
            {fit.requiredCount > 0 && (
                <ul className="mt-3 space-y-1.5">
                    {fit.matched.map((s) => (
                        <li key={`m-${s}`} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                            <span className="min-w-0">{s}</span>
                        </li>
                    ))}
                    {fit.missing.map((s) => (
                        <li key={`x-${s}`} className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                            <X className="h-4 w-4 shrink-0 text-amber-500" />
                            <span className="min-w-0">{s}</span>
                            <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">{t('applicant_funnel_checklist_missing')}</span>
                        </li>
                    ))}
                </ul>
            )}
            {(job.experience_level || job.required_qualifications) && (
                <div className="mt-3 space-y-2 border-t border-gray-100 pt-3 dark:border-gray-700/60">
                    {job.experience_level && (
                        <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('job_field_experience_level')}</span>
                            <span className="font-medium text-gray-700 dark:text-gray-200">{t(experienceLevelLabelKey(job.experience_level))}</span>
                        </div>
                    )}
                    {job.required_qualifications && (
                        <div>
                            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('job_field_required_qualifications')}</p>
                            <p className="mt-0.5 whitespace-pre-line text-sm leading-6 text-gray-700 dark:text-gray-300">{job.required_qualifications}</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const INTERVIEW_FORMAT_OPTIONS: InterviewFormat[] = ['phone', 'video', 'onsite'];
const SCORECARD_RECOMMENDATIONS: ScorecardRecommendation[] = ['strong_hire', 'hire', 'hold', 'no_hire'];
const SCORE_VALUES = [1, 2, 3, 4, 5];
const defaultScorecardRatings = (): Record<ScorecardRatingKey, number> => (
    SCORECARD_RATING_KEYS.reduce((acc, key) => {
        acc[key] = 3;
        return acc;
    }, {} as Record<ScorecardRatingKey, number>)
);

/**
 * Employer-side interview management for the selected applicant. Self-contained:
 * owns its own load/form/submit state keyed off the applicationId so the parent
 * never has to thread interview state through. Schedule / reschedule / cancel /
 * mark-completed all round-trip through lib/interviewData and reload the list.
 */
const InterviewsSection: React.FC<{ applicationId: string; employerUid: string; defaultStage: string; t: (key: string) => string }> = ({ applicationId, employerUid, defaultStage, t }) => {
    const [interviews, setInterviews] = useState<ApplicationInterview[]>([]);
    const [scorecards, setScorecards] = useState<ApplicationScorecard[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    // Inline form. editingId === null means scheduling a new interview; a non-null
    // id means we're rescheduling that existing interview via updateInterview.
    const [formOpen, setFormOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [stage, setStage] = useState(defaultStage);
    const [scheduledAt, setScheduledAt] = useState('');
    const [timezone, setTimezone] = useState('');
    const [format, setFormat] = useState<InterviewFormat | ''>('');
    const [locationOrLink, setLocationOrLink] = useState('');
    const [interviewer, setInterviewer] = useState('');
    const [notes, setNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    // Ref latches: the saving state lags a render, so a synchronous double-click could
    // schedule a duplicate interview / write a duplicate scorecard (the callables have no dedup).
    const submittingRef = useRef(false);
    const scorecardSavingRef = useRef(false);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    // Per-card busy flag so cancel / complete buttons disable only their own card.
    const [actionId, setActionId] = useState<string | null>(null);

    // Structured scorecard form; one open card at a time.
    const [scorecardOpenFor, setScorecardOpenFor] = useState<string | null>(null);
    const [scorecardId, setScorecardId] = useState<string | undefined>(undefined);
    const [scoreRecommendation, setScoreRecommendation] = useState<ScorecardRecommendation>('hold');
    const [overallScore, setOverallScore] = useState(3);
    const [ratings, setRatings] = useState<Record<ScorecardRatingKey, number>>(defaultScorecardRatings);
    const [evidence, setEvidence] = useState('');
    const [concerns, setConcerns] = useState('');
    const [nextSteps, setNextSteps] = useState('');
    const [privateNotes, setPrivateNotes] = useState('');
    const [scorecardSaving, setScorecardSaving] = useState(false);
    const [scorecardError, setScorecardError] = useState<string | null>(null);

    const loadInterviews = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const [interviewResult, scorecardResult] = await Promise.all([
                listInterviewsForApplication(applicationId, employerUid),
                listScorecardsForApplication(applicationId, employerUid),
            ]);
            if (!mountedRef.current) return;
            setInterviews(interviewResult);
            setScorecards(scorecardResult);
        } catch (err) {
            if (mountedRef.current) setLoadError(err instanceof Error ? err.message : t('interview_error'));
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, [applicationId, employerUid, t]);

    useEffect(() => {
        void loadInterviews();
    }, [loadInterviews]);

    const resetForm = useCallback(() => {
        setEditingId(null);
        setStage(defaultStage);
        setScheduledAt('');
        setTimezone('');
        setFormat('');
        setLocationOrLink('');
        setInterviewer('');
        setNotes('');
        setFormError(null);
    }, [defaultStage]);

    const closeForm = useCallback(() => {
        setFormOpen(false);
        resetForm();
    }, [resetForm]);

    const openScheduleForm = () => {
        resetForm();
        setFormOpen(true);
    };

    const openRescheduleForm = (interview: ApplicationInterview) => {
        setEditingId(interview.id);
        setStage(interview.stage || defaultStage);
        setScheduledAt(interview.scheduled_at || '');
        setTimezone(interview.timezone || '');
        setFormat(INTERVIEW_FORMAT_OPTIONS.includes(interview.format as InterviewFormat) ? (interview.format as InterviewFormat) : '');
        setLocationOrLink(interview.location_or_link || '');
        setInterviewer(interview.interviewer || '');
        setNotes(interview.notes || '');
        setFormError(null);
        setFormOpen(true);
    };

    const handleSubmit = async () => {
        if (submitting || submittingRef.current) return;
        submittingRef.current = true;
        setSubmitting(true);
        setFormError(null);
        try {
            if (editingId) {
                await updateInterview({
                    interviewId: editingId,
                    interviewStatus: 'rescheduled',
                    stage,
                    scheduledAt,
                    timezone,
                    format: format || undefined,
                    locationOrLink,
                    interviewer,
                    notes,
                });
            } else {
                await scheduleInterview({
                    applicationId,
                    stage,
                    scheduledAt,
                    timezone,
                    format: format as InterviewFormat,
                    locationOrLink,
                    interviewer,
                    notes,
                });
            }
            if (!mountedRef.current) return;
            closeForm();
            await loadInterviews();
        } catch (err) {
            if (mountedRef.current) setFormError(err instanceof Error ? err.message : t('interview_error'));
        } finally {
            submittingRef.current = false;
            if (mountedRef.current) setSubmitting(false);
        }
    };

    const runAction = async (interviewId: string, patch: Parameters<typeof updateInterview>[0]) => {
        if (actionId) return;
        setActionId(interviewId);
        try {
            await updateInterview(patch);
            if (!mountedRef.current) return;
            await loadInterviews();
        } catch (err) {
            if (mountedRef.current) setLoadError(err instanceof Error ? err.message : t('interview_error'));
        } finally {
            if (mountedRef.current) setActionId(null);
        }
    };

    const scorecardByInterview = useMemo(() => {
        const map = new Map<string, ApplicationScorecard>();
        scorecards.forEach((card) => map.set(card.interview_id, card));
        return map;
    }, [scorecards]);

    const closeScorecardForm = () => {
        setScorecardOpenFor(null);
        setScorecardId(undefined);
        setScoreRecommendation('hold');
        setOverallScore(3);
        setRatings(defaultScorecardRatings());
        setEvidence('');
        setConcerns('');
        setNextSteps('');
        setPrivateNotes('');
        setScorecardError(null);
    };

    const openScorecardForm = (interview: ApplicationInterview, existing?: ApplicationScorecard) => {
        setScorecardOpenFor(interview.id);
        setScorecardId(existing?.id);
        setScoreRecommendation(existing?.recommendation ?? 'hold');
        setOverallScore(existing?.overall_score || 3);
        setRatings(existing?.ratings ?? defaultScorecardRatings());
        setEvidence(existing?.evidence ?? '');
        setConcerns(existing?.concerns ?? '');
        setNextSteps(existing?.next_steps ?? '');
        setPrivateNotes(existing?.private_notes ?? '');
        setScorecardError(null);
    };

    const handleScorecardSave = async (interview: ApplicationInterview) => {
        if (scorecardSaving || scorecardSavingRef.current) return;
        scorecardSavingRef.current = true;
        setScorecardSaving(true);
        setScorecardError(null);
        try {
            await upsertScorecard({
                scorecardId,
                interviewId: interview.id,
                stage: interview.stage || defaultStage,
                recommendation: scoreRecommendation,
                overallScore,
                ratings,
                evidence,
                concerns,
                nextSteps,
                privateNotes,
            });
            if (!mountedRef.current) return;
            closeScorecardForm();
            await loadInterviews();
        } catch (err) {
            if (mountedRef.current) setScorecardError(err instanceof Error ? err.message : t('scorecard_error'));
        } finally {
            scorecardSavingRef.current = false;
            if (mountedRef.current) setScorecardSaving(false);
        }
    };

    const formatScheduledAt = (value: string): string => {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
        });
    };

    const statusBadgeClass = (status: ApplicationInterview['interview_status']): string => {
        switch (status) {
            case 'completed': return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300';
            case 'cancelled': return 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300';
            case 'rescheduled': return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300';
            default: return 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300';
        }
    };

    const recommendationClass = (recommendation: ScorecardRecommendation): string => {
        switch (recommendation) {
            case 'strong_hire': return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300';
            case 'hire': return 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300';
            case 'no_hire': return 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300';
            default: return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300';
        }
    };

    return (
        <div data-qa="applicant-interviews-section" className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h4 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100">
                        <Clock3 className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-300" />
                        {t('interview_section_title')}
                    </h4>
                    <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{t('interview_section_desc')}</p>
                </div>
                {!formOpen && (
                    <button
                        type="button"
                        onClick={openScheduleForm}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
                    >
                        <ArrowRight className="h-4 w-4" />
                        {t('interview_schedule_btn')}
                    </button>
                )}
            </div>

            {formOpen && (
                <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/60 p-3 dark:border-blue-900/60 dark:bg-blue-950/20">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300">
                            <span>{t('interview_field_stage')}</span>
                            <input
                                type="text"
                                value={stage}
                                onChange={(event) => setStage(event.target.value)}
                                disabled={submitting}
                                className={SELECT_CLASS}
                            />
                        </label>
                        <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300">
                            <span>{t('interview_field_datetime')}</span>
                            <input
                                type="datetime-local"
                                value={scheduledAt}
                                onChange={(event) => setScheduledAt(event.target.value)}
                                disabled={submitting}
                                className={SELECT_CLASS}
                            />
                        </label>
                        <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300">
                            <span>{t('interview_field_timezone')}</span>
                            <input
                                type="text"
                                value={timezone}
                                onChange={(event) => setTimezone(event.target.value)}
                                disabled={submitting}
                                className={SELECT_CLASS}
                            />
                        </label>
                        <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300">
                            <span>{t('interview_field_format')}</span>
                            <select
                                value={format}
                                onChange={(event) => setFormat(event.target.value as InterviewFormat | '')}
                                disabled={submitting}
                                className={SELECT_CLASS}
                            >
                                <option value="">{t('interview_format_select')}</option>
                                {INTERVIEW_FORMAT_OPTIONS.map((value) => (
                                    <option key={value} value={value}>{t('interview_format_' + value)}</option>
                                ))}
                            </select>
                        </label>
                        <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300">
                            <span>{t('interview_field_link')}</span>
                            <input
                                type="text"
                                value={locationOrLink}
                                onChange={(event) => setLocationOrLink(event.target.value)}
                                disabled={submitting}
                                className={SELECT_CLASS}
                            />
                        </label>
                        <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300">
                            <span>{t('interview_field_interviewer')}</span>
                            <input
                                type="text"
                                value={interviewer}
                                onChange={(event) => setInterviewer(event.target.value)}
                                disabled={submitting}
                                className={SELECT_CLASS}
                            />
                        </label>
                        <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300 sm:col-span-2">
                            <span>{t('interview_field_notes')}</span>
                            <textarea
                                value={notes}
                                onChange={(event) => setNotes(event.target.value)}
                                disabled={submitting}
                                rows={2}
                                className={`${SELECT_CLASS} resize-y`}
                            />
                        </label>
                    </div>
                    {formError && (
                        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
                            {formError}
                        </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => void handleSubmit()}
                            disabled={submitting}
                            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <CheckCircle2 className="h-4 w-4" />
                            {submitting ? t('interview_saving') : t('interview_save')}
                        </button>
                        <button
                            type="button"
                            onClick={closeForm}
                            disabled={submitting}
                            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                        >
                            <X className="h-4 w-4" />
                            {t('interview_cancel_form')}
                        </button>
                    </div>
                </div>
            )}

            <div className="mt-4">
                {loading ? (
                    <div className="flex items-center justify-center py-6">
                        <div className="h-6 w-6 animate-spin rounded-full border-4 border-blue-200 border-t-blue-700" />
                    </div>
                ) : loadError ? (
                    <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
                        {loadError}
                    </p>
                ) : interviews.length === 0 ? (
                    <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500 dark:bg-gray-900/70 dark:text-gray-400">
                        {t('interview_none_employer')}
                    </p>
                ) : (
                    <ul className="space-y-3">
                        {interviews.map((interview) => {
                            const isCancelled = interview.interview_status === 'cancelled';
                            const isBusy = actionId === interview.id;
                            const scheduledLabel = [formatScheduledAt(interview.scheduled_at), interview.timezone].filter(Boolean).join(' · ');
                            const linkIsUrl = /^https?:\/\//i.test(interview.location_or_link ?? '');
                            const scorecard = scorecardByInterview.get(interview.id);
                            return (
                                <li key={interview.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/70">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-700 ring-1 ring-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-700">
                                            {interview.stage}
                                        </span>
                                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusBadgeClass(interview.interview_status)}`}>
                                            {t('interview_status_' + interview.interview_status)}
                                        </span>
                                    </div>
                                    <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                                        {scheduledLabel && (
                                            <div className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-200">
                                                <Clock3 className="h-4 w-4 shrink-0 text-gray-400" />
                                                <span className="min-w-0">{scheduledLabel}</span>
                                            </div>
                                        )}
                                        <div className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-200">
                                            <MessageSquare className="h-4 w-4 shrink-0 text-gray-400" />
                                            <span className="min-w-0">{t('interview_format_' + interview.format)}</span>
                                        </div>
                                        {interview.location_or_link && (
                                            <div className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-200">
                                                <LinkIcon className="h-4 w-4 shrink-0 text-gray-400" />
                                                {linkIsUrl ? (
                                                    <a
                                                        href={interview.location_or_link}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="min-w-0 truncate text-blue-600 underline hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                                                    >
                                                        {interview.location_or_link}
                                                    </a>
                                                ) : (
                                                    <span className="min-w-0 truncate">{interview.location_or_link}</span>
                                                )}
                                            </div>
                                        )}
                                        {interview.interviewer && (
                                            <div className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-200">
                                                <Users className="h-4 w-4 shrink-0 text-gray-400" />
                                                <span className="min-w-0">{formatTranslation(t('interview_with'), { interviewer: interview.interviewer })}</span>
                                            </div>
                                        )}
                                    </dl>
                                    {interview.notes && (
                                        <p className="mt-2 whitespace-pre-line text-xs leading-5 text-gray-600 dark:text-gray-300">{interview.notes}</p>
                                    )}
                                    {scorecard && (
                                        <div data-qa="scorecard-summary" className="mt-3 rounded-lg border border-indigo-100 bg-white p-3 dark:border-indigo-900/50 dark:bg-gray-800">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-800 dark:text-gray-100">
                                                    <ClipboardCheck className="h-3.5 w-3.5 text-indigo-500" />
                                                    {t('scorecard_saved_title')}
                                                </p>
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${recommendationClass(scorecard.recommendation)}`}>
                                                        {t('scorecard_recommendation_' + scorecard.recommendation)}
                                                    </span>
                                                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                                                        {formatTranslation(t('scorecard_overall_chip'), { score: scorecard.overall_score })}
                                                    </span>
                                                </div>
                                            </div>
                                            <p className="mt-2 line-clamp-2 text-xs leading-5 text-gray-600 dark:text-gray-300">{scorecard.evidence}</p>
                                            {scorecard.next_steps && (
                                                <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                                                    <span className="font-semibold">{t('scorecard_next_steps_short')} </span>{scorecard.next_steps}
                                                </p>
                                            )}
                                        </div>
                                    )}
                                    <div className="mt-3 flex flex-wrap items-center gap-2">
                                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                            interview.candidate_confirmed
                                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                                                : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                                        }`}>
                                            {interview.candidate_confirmed ? (
                                                <CheckCircle2 className="h-3.5 w-3.5" />
                                            ) : (
                                                <Clock3 className="h-3.5 w-3.5" />
                                            )}
                                            {interview.candidate_confirmed ? t('interview_candidate_confirmed') : t('interview_awaiting_candidate')}
                                        </span>
                                    </div>
                                    {!isCancelled && (
                                        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 dark:border-gray-700/60">
                                            <button
                                                type="button"
                                                onClick={() => openScorecardForm(interview, scorecard)}
                                                disabled={isBusy}
                                                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-50 disabled:opacity-60 dark:border-indigo-900/60 dark:bg-gray-800 dark:text-indigo-300 dark:hover:bg-indigo-950/20"
                                            >
                                                <ClipboardCheck className="h-3.5 w-3.5" />
                                                {scorecard ? t('scorecard_edit_btn') : t('scorecard_create_btn')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => openRescheduleForm(interview)}
                                                disabled={isBusy}
                                                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                                            >
                                                <RotateCcw className="h-3.5 w-3.5" />
                                                {t('interview_action_reschedule')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => void runAction(interview.id, { interviewId: interview.id, interviewStatus: 'completed' })}
                                                disabled={isBusy}
                                                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-900/60 dark:bg-gray-800 dark:text-emerald-300 dark:hover:bg-emerald-950/20"
                                            >
                                                <CheckCircle2 className="h-3.5 w-3.5" />
                                                {t('interview_action_complete')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => void runAction(interview.id, { interviewId: interview.id, interviewStatus: 'cancelled' })}
                                                disabled={isBusy}
                                                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-60 dark:border-rose-900/60 dark:bg-gray-800 dark:text-rose-300 dark:hover:bg-rose-950/20"
                                            >
                                                <X className="h-3.5 w-3.5" />
                                                {t('interview_action_cancel')}
                                            </button>
                                        </div>
                                    )}
                                    {scorecardOpenFor === interview.id && (
                                        <div className="mt-3 rounded-lg border border-indigo-100 bg-white p-3 dark:border-indigo-900/50 dark:bg-gray-800">
                                            <div className="grid gap-3 sm:grid-cols-2">
                                                <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300">
                                                    <span>{t('scorecard_field_recommendation')}</span>
                                                    <select
                                                        value={scoreRecommendation}
                                                        onChange={(event) => setScoreRecommendation(event.target.value as ScorecardRecommendation)}
                                                        disabled={scorecardSaving}
                                                        className={SELECT_CLASS}
                                                    >
                                                        {SCORECARD_RECOMMENDATIONS.map((value) => (
                                                            <option key={value} value={value}>{t('scorecard_recommendation_' + value)}</option>
                                                        ))}
                                                    </select>
                                                </label>
                                                <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300">
                                                    <span>{t('scorecard_field_overall')}</span>
                                                    <select
                                                        value={String(overallScore)}
                                                        onChange={(event) => setOverallScore(Number(event.target.value))}
                                                        disabled={scorecardSaving}
                                                        className={SELECT_CLASS}
                                                    >
                                                        {SCORE_VALUES.map((value) => (
                                                            <option key={value} value={value}>{formatTranslation(t('scorecard_score_option'), { score: value })}</option>
                                                        ))}
                                                    </select>
                                                </label>
                                                {SCORECARD_RATING_KEYS.map((key) => (
                                                    <label key={key} className="space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300">
                                                        <span>{t('scorecard_rating_' + key)}</span>
                                                        <select
                                                            value={String(ratings[key])}
                                                            onChange={(event) => setRatings((current) => ({ ...current, [key]: Number(event.target.value) }))}
                                                            disabled={scorecardSaving}
                                                            className={SELECT_CLASS}
                                                        >
                                                            {SCORE_VALUES.map((value) => (
                                                                <option key={value} value={value}>{formatTranslation(t('scorecard_score_option'), { score: value })}</option>
                                                            ))}
                                                        </select>
                                                    </label>
                                                ))}
                                                <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300 sm:col-span-2">
                                                    <span>{t('scorecard_field_evidence')}</span>
                                                    <textarea
                                                        value={evidence}
                                                        onChange={(event) => setEvidence(event.target.value)}
                                                        disabled={scorecardSaving}
                                                        rows={3}
                                                        className={`${SELECT_CLASS} resize-y`}
                                                    />
                                                </label>
                                                <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300 sm:col-span-2">
                                                    <span>{t('scorecard_field_concerns')}</span>
                                                    <textarea
                                                        value={concerns}
                                                        onChange={(event) => setConcerns(event.target.value)}
                                                        disabled={scorecardSaving}
                                                        rows={2}
                                                        className={`${SELECT_CLASS} resize-y`}
                                                    />
                                                </label>
                                                <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300 sm:col-span-2">
                                                    <span>{t('scorecard_field_next_steps')}</span>
                                                    <textarea
                                                        value={nextSteps}
                                                        onChange={(event) => setNextSteps(event.target.value)}
                                                        disabled={scorecardSaving}
                                                        rows={2}
                                                        className={`${SELECT_CLASS} resize-y`}
                                                    />
                                                </label>
                                                <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300 sm:col-span-2">
                                                    <span>{t('scorecard_field_private_notes')}</span>
                                                    <textarea
                                                        value={privateNotes}
                                                        onChange={(event) => setPrivateNotes(event.target.value)}
                                                        disabled={scorecardSaving}
                                                        rows={2}
                                                        className={`${SELECT_CLASS} resize-y`}
                                                    />
                                                </label>
                                            </div>
                                            {scorecardError && (
                                                <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
                                                    {scorecardError}
                                                </p>
                                            )}
                                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => void handleScorecardSave(interview)}
                                                    disabled={scorecardSaving}
                                                    className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                                                >
                                                    <ClipboardCheck className="h-4 w-4" />
                                                    {scorecardSaving ? t('scorecard_saving') : t('scorecard_save_btn')}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={closeScorecardForm}
                                                    disabled={scorecardSaving}
                                                    className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                                                >
                                                    <X className="h-4 w-4" />
                                                    {t('scorecard_cancel_btn')}
                                                </button>
                                            </div>
                                            <p className="mt-2 text-xs leading-5 text-gray-500 dark:text-gray-400">{t('scorecard_private_hint')}</p>
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
};

interface SelectFieldProps<T extends string> {
    id: string;
    label: string;
    value: T;
    onChange: (value: T) => void;
    children: React.ReactNode;
    className?: string;
    disabled?: boolean;
}

function SelectField<T extends string>({
    id,
    label,
    value,
    onChange,
    children,
    className = '',
    disabled = false,
}: SelectFieldProps<T>) {
    return (
        <label className={`space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300 ${className}`}>
            <span>{label}</span>
            <select
                id={id}
                value={value}
                onChange={(event) => onChange(event.target.value as T)}
                disabled={disabled}
                className={SELECT_CLASS}
            >
                {children}
            </select>
        </label>
    );
}

interface StageControlProps {
    applicant: Applicant;
    statusSavingId: string | null;
    getStatusLabel: (status: string) => string;
    onStatusChange: (
        applicant: Applicant,
        nextStatusValue: string,
        meta?: { action?: ApplicationStatusAction; reason?: string; candidateNote?: string },
    ) => Promise<boolean>;
    t: (key: string) => string;
}

const StageControl: React.FC<StageControlProps> = ({
    applicant,
    statusSavingId,
    getStatusLabel,
    onStatusChange,
    t,
}) => {
    const [reason, setReason] = useState('');
    const [candidateNote, setCandidateNote] = useState('');
    const [skipTarget, setSkipTarget] = useState<ApplicationPipelineStageStatus | ''>('');
    const currentStatus = normalizeApplicationStatus(applicant.status);
    const nextStatus = getNextApplicationPipelineStatus(currentStatus);
    const skipOptions = getLaterApplicationPipelineStatuses(currentStatus);
    const skippedStatuses = skipTarget ? getSkippedApplicationStatuses(currentStatus, skipTarget) : [];
    const isSaving = statusSavingId === applicant.id;
    const isRejected = currentStatus === 'Rejected';
    const isFinalSigned = currentStatus === 'Signed';
    const canAdvance = Boolean(nextStatus) && !isSaving && !isRejected;
    const reasonTrimmed = reason.trim();
    const canSkip = Boolean(skipTarget) && !isSaving && !isRejected && reasonTrimmed.length > 0;
    const canReject = !isSaving && !isRejected && !isFinalSigned && reasonTrimmed.length > 0;
    const canReopen = !isSaving && isRejected && reasonTrimmed.length > 0;

    const submitStatusChange = async (targetStatus: string, action: ApplicationStatusAction) => {
        if (targetStatus === currentStatus || isSaving) return;
        const ok = await onStatusChange(applicant, targetStatus, {
            action,
            reason,
            candidateNote,
        });
        if (ok) {
            setReason('');
            setCandidateNote('');
            setSkipTarget('');
        }
    };

    const handleAdvance = () => {
        if (!nextStatus || isSaving) return;
        void submitStatusChange(nextStatus, 'advance');
    };

    return (
        <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/70 p-3 dark:border-blue-900/60 dark:bg-blue-950/20">
            <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    onClick={handleAdvance}
                    disabled={!canAdvance}
                    className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
                >
                    <ArrowRight className="h-4 w-4" />
                    {nextStatus
                        ? formatTranslation(t('applicant_funnel_advance_to'), { status: getStatusLabel(nextStatus) })
                        : t('applicant_funnel_stage_final')}
                </button>
                    {!isRejected ? (
                        <button
                            type="button"
                            onClick={() => void submitStatusChange('Rejected', 'reject')}
                            disabled={!canReject}
                            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 dark:border-rose-900/60 dark:bg-gray-900 dark:text-rose-300 dark:hover:bg-rose-950/20 dark:disabled:border-slate-800 dark:disabled:bg-slate-900 dark:disabled:text-slate-500"
                        >
                            <X className="h-4 w-4" />
                            {t('applicant_funnel_reject_action')}
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={() => void submitStatusChange('Applied', 'reopen')}
                            disabled={!canReopen}
                            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 dark:border-emerald-900/60 dark:bg-gray-900 dark:text-emerald-300 dark:hover:bg-emerald-950/20 dark:disabled:border-slate-800 dark:disabled:bg-slate-900 dark:disabled:text-slate-500"
                        >
                            <RotateCcw className="h-4 w-4" />
                            {t('applicant_funnel_reopen_action')}
                        </button>
                    )}
                </div>
                {!isRejected && skipOptions.length > 0 && (
                    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                        <SelectField<ApplicationPipelineStageStatus | ''>
                            id={`applicant-skip-${applicant.id}`}
                            label={t('applicant_funnel_skip_target_label')}
                            value={skipTarget}
                            onChange={setSkipTarget}
                            disabled={isSaving}
                        >
                            <option value="">{t('applicant_funnel_skip_target_placeholder')}</option>
                            {skipOptions.map(status => (
                                <option key={status} value={status}>{getStatusLabel(status)}</option>
                            ))}
                        </SelectField>
                        <button
                            type="button"
                            onClick={() => skipTarget && void submitStatusChange(skipTarget, 'skip')}
                            disabled={!canSkip}
                            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 dark:border-blue-900/60 dark:bg-gray-900 dark:text-blue-300 dark:hover:bg-blue-950/20 dark:disabled:border-slate-800 dark:disabled:bg-slate-900 dark:disabled:text-slate-500"
                        >
                            <ArrowRight className="h-4 w-4" />
                            {skipTarget
                                ? formatTranslation(t('applicant_funnel_skip_to'), { status: getStatusLabel(skipTarget) })
                                : t('applicant_funnel_skip_action')}
                        </button>
                        {skippedStatuses.length > 0 && (
                            <p className="text-xs leading-5 text-blue-800/80 dark:text-blue-200/80 md:col-span-2">
                                {formatTranslation(t('applicant_funnel_skip_preview'), {
                                    stages: skippedStatuses.map(getStatusLabel).join(', '),
                                })}
                            </p>
                        )}
                    </div>
                )}
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-xs font-medium text-blue-900 dark:text-blue-100">
                    <span>{t('applicant_funnel_status_reason_label')}</span>
                    <input
                        type="text"
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        disabled={isSaving}
                        maxLength={500}
                        placeholder={isRejected ? t('applicant_funnel_reopen_reason_placeholder') : t('applicant_funnel_status_reason_placeholder')}
                        className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-gray-800 transition-colors placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-blue-900/60 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:bg-slate-900"
                    />
                </label>
                <label className="space-y-1 text-xs font-medium text-blue-900 dark:text-blue-100">
                    <span>{t('applicant_funnel_candidate_note_label')}</span>
                    <textarea
                        value={candidateNote}
                        onChange={(event) => setCandidateNote(event.target.value)}
                        disabled={isSaving}
                        maxLength={1000}
                        rows={2}
                        placeholder={t('applicant_funnel_candidate_note_placeholder')}
                        className="w-full resize-y rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-gray-800 transition-colors placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-blue-900/60 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:bg-slate-900"
                    />
                </label>
            </div>
            <p className="mt-2 text-xs leading-5 text-blue-800/80 dark:text-blue-200/80">
                {isSaving
                    ? t('applicant_funnel_status_updating')
                    : isRejected
                        ? t('applicant_funnel_reopen_helper')
                        : nextStatus
                            ? t('applicant_funnel_stage_control_helper')
                            : t('applicant_funnel_stage_final_helper')}
            </p>
        </div>
    );
};

const StatusHistory: React.FC<{
    history: ApplicationStatusHistoryEvent[] | undefined;
    getStatusLabel: (status: string) => string;
    t: (key: string) => string;
}> = ({ history, getStatusLabel, t }) => {
    const rows = history ?? [];
    const actionLabel = (action: string | null): string => {
        switch (action) {
            case 'advance': return t('applicant_funnel_history_action_advance');
            case 'skip': return t('applicant_funnel_history_action_skip');
            case 'reject': return t('applicant_funnel_history_action_reject');
            case 'reopen': return t('applicant_funnel_history_action_reopen');
            default: return t('applicant_funnel_history_action_update');
        }
    };
    const formatEventDate = (value: string | null): string => {
        if (!value) return t('applicant_funnel_history_pending_time');
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return t('applicant_funnel_history_pending_time');
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    };

    return (
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h4 className="font-semibold text-gray-900 dark:text-gray-100">{t('applicant_funnel_history_title')}</h4>
                    <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{t('applicant_funnel_history_desc')}</p>
                </div>
                <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
            </div>
            {rows.length === 0 ? (
                <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500 dark:bg-gray-900/70 dark:text-gray-400">
                    {t('applicant_funnel_history_empty')}
                </p>
            ) : (
                <ol className="mt-3 space-y-3">
                    {rows.map((event, index) => (
                        <li key={event.id ?? `${event.from_status}-${event.to_status}-${index}`} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5 dark:border-gray-700/70 dark:bg-gray-900/70">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-700 ring-1 ring-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-700">
                                    {actionLabel(event.action)}
                                </span>
                                <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500">{formatEventDate(event.created_at)}</span>
                            </div>
                            <p className="mt-2 text-sm font-medium text-gray-800 dark:text-gray-100">
                                {formatTranslation(t('applicant_funnel_history_from_to'), {
                                    from: getStatusLabel(event.from_status),
                                    to: getStatusLabel(event.to_status),
                                })}
                            </p>
                            {event.skipped_statuses.length > 0 && (
                                <p className="mt-1 text-xs leading-5 text-blue-700 dark:text-blue-300">
                                    {formatTranslation(t('applicant_funnel_history_skipped'), {
                                        stages: event.skipped_statuses.map(getStatusLabel).join(', '),
                                    })}
                                </p>
                            )}
                            {event.reason && (
                                <p className="mt-1 text-xs leading-5 text-gray-600 dark:text-gray-300">
                                    <span className="font-semibold">{t('applicant_funnel_history_reason_label')} </span>{event.reason}
                                </p>
                            )}
                            {event.candidate_note && (
                                <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                                    <span className="font-semibold">{t('applicant_funnel_history_candidate_note_label')} </span>{event.candidate_note}
                                </p>
                            )}
                        </li>
                    ))}
                </ol>
            )}
        </div>
    );
};

const ApplicantFunnel: React.FC<ApplicantFunnelProps> = ({ job: rawJob, employerUid, onBack, t }) => {
    const job = useMemo(() => normalizeJobPostingForClient(rawJob), [rawJob]);
    const { addToast } = useToast();
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState(t('applicant_funnel_loading_initial'));
    const [analysisLoading, setAnalysisLoading] = useState(false);
    const [analysisError, setAnalysisError] = useState<string | null>(null);
    const [refreshError, setRefreshError] = useState<string | null>(null);
    const [applicantsTruncated, setApplicantsTruncated] = useState(false);
    const [statusHistoryTruncated, setStatusHistoryTruncated] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [statusUpdateError, setStatusUpdateError] = useState<string | null>(null);
    const [statusSavingId, setStatusSavingId] = useState<string | null>(null);
    const [applicants, setApplicants] = useState<Applicant[]>([]);
    const [selectedApplicant, setSelectedApplicant] = useState<Applicant | null>(null);
    const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
    const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
    const [downloadingResumeId, setDownloadingResumeId] = useState<string | null>(null);
    const [viewingApplicant, setViewingApplicant] = useState<Applicant | null>(null);
    const [resumeViewText, setResumeViewText] = useState<string | null>(null);
    const [resumeViewLoading, setResumeViewLoading] = useState(false);
    const [resumeViewError, setResumeViewError] = useState<string | null>(null);
    const [selectedApplicantIds, setSelectedApplicantIds] = useState<Set<string>>(new Set());
    const [bulkAction, setBulkAction] = useState<BulkActionMode>('advance');
    const [bulkReason, setBulkReason] = useState('');
    const [bulkCandidateNote, setBulkCandidateNote] = useState('');
    const [bulkNotify, setBulkNotify] = useState(false);
    const [bulkMessageBody, setBulkMessageBody] = useState('');
    const [bulkSaving, setBulkSaving] = useState(false);
    const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
    const detailRef = useRef<HTMLElement | null>(null);
    // Run token for the resume-view fetch: opening another applicant's resume (or closing)
    // supersedes an in-flight load so applicant A's resume can't paint under applicant B.
    const resumeViewRunRef = useRef(0);
    const fetchRunRef = useRef(0);
    const loadedJobIdRef = useRef<string | null>(null);
    const mountedRef = useRef(true);
    const downloadingResumeRef = useRef<string | null>(null);
    const savingApplicantIdsRef = useRef(new Set<string>());
    const bulkSavingRef = useRef(false);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            resumeViewRunRef.current += 1;
            fetchRunRef.current += 1;
            downloadingResumeRef.current = null;
            savingApplicantIdsRef.current.clear();
            bulkSavingRef.current = false;
        };
    }, []);

    // View an applicant's resume TEXT inline (server verifies the caller owns the
    // job the candidate applied to — same gate as the file download).
    const handleViewResume = async (applicant: Applicant) => {
        const myRun = ++resumeViewRunRef.current;
        setViewingApplicant(applicant);
        setResumeViewText(null);
        setResumeViewError(null);
        setResumeViewLoading(true);
        try {
            const res = await getApplicantResumeText(applicant.id);
            if (myRun !== resumeViewRunRef.current) return; // another applicant's resume opened / closed first
            setResumeViewText(res.resumeText ?? '');
        } catch (err) {
            if (myRun !== resumeViewRunRef.current) return;
            setResumeViewError(err instanceof Error ? err.message : t('applicant_funnel_resume_view_error'));
        } finally {
            if (myRun === resumeViewRunRef.current) setResumeViewLoading(false);
        }
    };
    const closeResumeView = useCallback(() => {
        resumeViewRunRef.current++; // supersede any in-flight load so it can't paint after close
        setViewingApplicant(null);
        setResumeViewText(null);
        setResumeViewError(null);
    }, []);
    // Download the original resume FILE of an applicant (server verifies the
    // caller owns the job the candidate applied to). Applicants who only pasted
    // text — and pre-feature applicants — return { available:false } gracefully.
    const handleDownloadResume = async (applicant: Applicant) => {
        if (downloadingResumeId || downloadingResumeRef.current) return;
        downloadingResumeRef.current = applicant.id;
        setDownloadingResumeId(applicant.id);
        try {
            const res = await getApplicantResumeFile(applicant.id);
            if (!mountedRef.current) return;
            if (!res.available) {
                addToast(t('applicant_funnel_no_resume_file'), 'info');
                return;
            }
            // Preferred path: a short-lived signed URL (any file size). The server's
            // Content-Disposition forces the download with the original filename.
            if (res.url) {
                const a = document.createElement('a');
                a.href = res.url;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                document.body.appendChild(a);
                a.click();
                a.remove();
                return;
            }
            // Fallback: inline base64 (small files / no URL signing available).
            if (res.base64) {
                const byteChars = atob(res.base64);
                const bytes = new Uint8Array(byteChars.length);
                for (let i = 0; i < byteChars.length; i += 1) bytes[i] = byteChars.charCodeAt(i);
                const blob = new Blob([bytes], { type: res.contentType || 'application/octet-stream' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = res.fileName || 'resume';
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
                return;
            }
            addToast(t('applicant_funnel_no_resume_file'), 'info');
        } catch (err) {
            if (mountedRef.current) addToast(err instanceof Error ? err.message : t('applicant_funnel_resume_download_error'), 'error');
        } finally {
            if (downloadingResumeRef.current === applicant.id) downloadingResumeRef.current = null;
            if (mountedRef.current) setDownloadingResumeId(null);
        }
    };

    // Save an applicant to the recruiter's shortlist (Biz12) — bookmark candidates
    // of interest from the review page so they appear in the Shortlist section.
    const handleSaveCandidate = async (applicant: Applicant) => {
        if (savedIds.has(applicant.id) || savingIds.has(applicant.id) || savingApplicantIdsRef.current.has(applicant.id)) return;
        savingApplicantIdsRef.current.add(applicant.id);
        setSavingIds((prev) => new Set(prev).add(applicant.id));
        try {
            await saveToShortlist(employerUid, {
                candidate_name: applicant.candidate_name || t('applicant_funnel_unnamed_candidate'),
                candidate_snapshot: {
                    summary: typeof applicant.talent_profile?.additional?.overallStrengths === 'string'
                        ? applicant.talent_profile.additional.overallStrengths
                        : applicant.summary,
                    skills: collectTalentSkills(applicant.talent_profile).length > 0
                        ? collectTalentSkills(applicant.talent_profile)
                        : (applicant.strengths ?? []).slice(0, 10),
                    current_role: getTalentCurrentRole(applicant.talent_profile),
                },
                job_id: job.id,
                job_title: job.title,
                match_score: applicant.compatibility_score ?? 0,
                match_reasons: (applicant.strengths ?? []).slice(0, 10),
                missing_requirements: (applicant.potentialGaps ?? []).slice(0, 10),
                notes: '',
                status: 'saved',
                saved_by: employerUid,
            });
            if (!mountedRef.current) return;
            setSavedIds((prev) => new Set(prev).add(applicant.id));
            addToast(t('shortlist_saved_toast'), 'success');
        } catch (err) {
            if (mountedRef.current) addToast(err instanceof Error ? err.message : t('shortlist_save_error'), 'error');
        } finally {
            savingApplicantIdsRef.current.delete(applicant.id);
            if (mountedRef.current) {
                setSavingIds((prev) => { const n = new Set(prev); n.delete(applicant.id); return n; });
            }
        }
    };

    // ── Filter state ────────────────────────────────────────────────────────────
    const [keyword, setKeyword]         = useState('');
    const [minScore, setMinScore]       = useState<ScoreThreshold>('all');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [recencyFilter, setRecencyFilter] = useState<RecencyFilter>('all');
    const [analysisFilter, setAnalysisFilter] = useState<AnalysisFilter>('all');
    // Default to chronological, NOT AI match score: ranking applicants by an AI
    // score by default reads as automated screening (EEOC/FTC/Ontario AI-hiring
    // scrutiny). The score stays available as an opt-in, advisory sort.
    const [sortKey, setSortKey]         = useState<SortKey>('newest');
    // Secondary refinements (status / recency / analysis) live behind a single
    // "Filters" disclosure to keep the rail card-first; tiles + search + sort stay visible.
    const [filtersOpen, setFiltersOpen] = useState(false);

    const applyApplicantResult = useCallback((result: JobApplicant[], resetSelection: boolean) => {
        const next = normalizeApplicantsForFunnel(result);
        setApplicants(next);
        if (resetSelection) {
            setSelectedApplicantIds(new Set());
            setSelectedApplicant(null);
            return;
        }
        setSelectedApplicant((current) => current ? next.find((applicant) => applicant.id === current.id) ?? null : null);
    }, []);

    const fetchApplicants = useCallback(async () => {
        const runId = ++fetchRunRef.current;
        const isInitialLoad = loadedJobIdRef.current !== job.id;
        let showedBasic = false;
        try {
            if (isInitialLoad) {
                setLoading(true);
            } else {
                setRefreshing(true);
            }
            setAnalysisLoading(false);
            setAnalysisError(null);
            setRefreshError(null);
            setApplicantsTruncated(false);
            setStatusHistoryTruncated(false);
            if (isInitialLoad) setError(null);
            setLoadingMessage(t('applicant_funnel_loading_initial'));

            // First paint: read applications, candidate names, Talent Profiles,
            // status history, and screener answers. Skip AI so the review UI opens fast.
            const basicResponse = await listJobApplicants(job.id, { includeAnalysis: false });
            const basicResult = basicResponse.applicants;

            if (!mountedRef.current || fetchRunRef.current !== runId) return;
            loadedJobIdRef.current = job.id;
            setError(null);
            setRefreshError(null);
            setApplicantsTruncated(basicResponse.applicants_truncated === true);
            setStatusHistoryTruncated(basicResponse.status_history_truncated === true);
            applyApplicantResult(basicResult, true);
            showedBasic = true;
            // Don't auto-spotlight the top AI-scored applicant (result is score-sorted) —
            // let the selection effect pick filteredApplicants[0], i.e. the chronologically
            // newest under the default 'newest' sort, consistent with the advisory-not-
            // automated-ranking compliance posture.
            setLoading(false);
            setRefreshing(false);
            setLoadingMessage('');

            if (basicResult.length === 0) return;

            setAnalysisLoading(true);
            const analyzedResponse = await listJobApplicants(job.id, { includeAnalysis: true });
            const analyzedResult = analyzedResponse.applicants;
            if (!mountedRef.current || fetchRunRef.current !== runId) return;
            setApplicantsTruncated((current) => current || analyzedResponse.applicants_truncated === true);
            setStatusHistoryTruncated((current) => current || analyzedResponse.status_history_truncated === true);
            applyApplicantResult(analyzedResult, false);
        } catch (err) {
            if (mountedRef.current && fetchRunRef.current === runId) {
                if (showedBasic) {
                    setAnalysisError(err instanceof Error ? err.message : t('applicant_funnel_analysis_partial_error'));
                } else if (!isInitialLoad) {
                    setRefreshError(err instanceof Error ? err.message : t('applicant_funnel_load_error'));
                } else {
                    setError(err instanceof Error ? err.message : t('applicant_funnel_load_error'));
                }
            }
        } finally {
            if (mountedRef.current && fetchRunRef.current === runId) {
                loadedJobIdRef.current = job.id;
                setLoading(false);
                setRefreshing(false);
                setAnalysisLoading(false);
                setLoadingMessage('');
            }
        }
    }, [applyApplicantResult, job.id, t]);

    useEffect(() => {
        fetchApplicants();
    }, [fetchApplicants]);

    // ── Real funnel stages derived from actual data ─────────────────────────────
    const funnelData = useMemo(() => APPLICATION_PIPELINE_STAGES.map((stage, index) => ({
        stage: `${t(stage.labelKey)}${'optional' in stage && stage.optional ? ` (${t('applications_stage_optional')})` : ''}`,
        count: applicants.filter((applicant) => {
            if (isApplicationRejectedStatus(applicant.status)) return false;
            const applicantIndex = getApplicationStatusIndex(applicant.status);
            return applicantIndex >= index;
        }).length,
    })), [applicants, t]);

    const statusOptions = useMemo<ApplicationPipelineStatus[]>(() => {
        return [...APPLICATION_PIPELINE_STAGES.map((stage) => stage.status), 'Rejected'];
    }, []);

    // ── Filtered + sorted list ──────────────────────────────────────────────────
    const filteredApplicants = useMemo(() => {
        let result = [...applicants];

        // Keyword filter across safe fields only. Resume text never reaches this component.
        const kw = keyword.trim().toLowerCase();
        if (kw) {
            result = result.filter((applicant) => {
                const haystack = [
                    applicant.candidate_name,
                    applicant.status,
                    applicant.summary,
                    ...applicant.strengths,
                    ...applicant.potentialGaps,
                    ...applicant.suggestedQuestions,
                    ...talentProfileSearchTokens(applicant.talent_profile),
                ].join(' ').toLowerCase();
                return haystack.includes(kw);
            });
        }

        if (minScore !== 'all') {
            const threshold = parseInt(minScore, 10);
            result = result.filter(a => (a.compatibility_score ?? 0) >= threshold);
        }

        if (statusFilter !== 'all') {
            result = result.filter((applicant) => normalizeApplicationStatus(applicant.status) === statusFilter);
        }

        if (recencyFilter !== 'all') {
            result = result.filter((applicant) => isWithinDays(applicant.application_date, parseInt(recencyFilter, 10)));
        }

        if (analysisFilter === 'analyzed') {
            result = result.filter(hasApplicantAnalysis);
        } else if (analysisFilter === 'needs_review') {
            result = result.filter((applicant) => !hasApplicantAnalysis(applicant));
        }

        if (sortKey === 'score') {
            result.sort((a, b) => (b.compatibility_score ?? 0) - (a.compatibility_score ?? 0));
        } else if (sortKey === 'newest') {
            result.sort((a, b) => toApplicationTime(b.application_date) - toApplicationTime(a.application_date));
        } else {
            result.sort((a, b) => (a.candidate_name ?? '').localeCompare(b.candidate_name ?? ''));
        }

        return result;
    }, [applicants, keyword, minScore, statusFilter, recencyFilter, analysisFilter, sortKey]);

    useEffect(() => {
        if (filteredApplicants.length === 0) {
            setSelectedApplicant(null);
            return;
        }
        if (!selectedApplicant || !filteredApplicants.some((applicant) => applicant.id === selectedApplicant.id)) {
            setSelectedApplicant(filteredApplicants[0]);
        }
    }, [filteredApplicants, selectedApplicant?.id]);

    useEffect(() => {
        const liveIds = new Set(applicants.map((applicant) => applicant.id));
        setSelectedApplicantIds((current) => {
            const next = new Set([...current].filter((id) => liveIds.has(id)));
            return next.size === current.size ? current : next;
        });
    }, [applicants]);

    const visibleApplicantIds = useMemo(
        () => filteredApplicants.map((applicant) => applicant.id),
        [filteredApplicants],
    );
    const selectedVisibleCount = useMemo(
        () => visibleApplicantIds.filter((id) => selectedApplicantIds.has(id)).length,
        [selectedApplicantIds, visibleApplicantIds],
    );
    const allVisibleSelected = visibleApplicantIds.length > 0 && selectedVisibleCount === visibleApplicantIds.length;

    useEffect(() => {
        const visibleIds = new Set(visibleApplicantIds);
        setSelectedApplicantIds((current) => {
            const next = new Set([...current].filter((id) => visibleIds.has(id)));
            return next.size === current.size ? current : next;
        });
    }, [visibleApplicantIds]);

    const highMatchCount = useMemo(
        () => applicants.filter((applicant) => (applicant.compatibility_score ?? 0) >= 85).length,
        [applicants],
    );
    const needsReviewCount = useMemo(
        () => applicants.filter((applicant) => !hasApplicantAnalysis(applicant)).length,
        [applicants],
    );
    const recentCount = useMemo(
        () => applicants.filter((applicant) => isWithinDays(applicant.application_date, 7)).length,
        [applicants],
    );

    // Active filter count (excludes sort as it's always set)
    const activeFilterCount = useMemo(() => {
        let count = 0;
        if (keyword.trim()) count++;
        if (minScore !== 'all') count++;
        if (statusFilter !== 'all') count++;
        if (recencyFilter !== 'all') count++;
        if (analysisFilter !== 'all') count++;
        return count;
    }, [keyword, minScore, statusFilter, recencyFilter, analysisFilter]);

    // Count of the refinements tucked behind the "Filters" disclosure, surfaced
    // as a badge so an active hidden filter is still discoverable when collapsed.
    const secondaryFilterCount = useMemo(() => {
        let count = 0;
        if (statusFilter !== 'all') count++;
        if (recencyFilter !== 'all') count++;
        if (analysisFilter !== 'all') count++;
        return count;
    }, [statusFilter, recencyFilter, analysisFilter]);

    const clearFilters = () => {
        setKeyword('');
        setMinScore('all');
        setStatusFilter('all');
        setRecencyFilter('all');
        setAnalysisFilter('all');
        setSortKey('newest');
    };

    const toggleApplicantSelection = (id: string) => {
        setSelectedApplicantIds((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleVisibleSelection = () => {
        setSelectedApplicantIds((current) => {
            const next = new Set(current);
            if (allVisibleSelected) {
                visibleApplicantIds.forEach((id) => next.delete(id));
            } else {
                visibleApplicantIds.forEach((id) => next.add(id));
            }
            return next;
        });
    };

    const defaultBulkMessage = useMemo(
        () => bulkAction === 'reject'
            ? t('applicant_funnel_bulk_default_rejection_message')
            : t('applicant_funnel_bulk_default_advance_message'),
        [bulkAction, t],
    );

    const getEligibleBulkApplicationIds = useCallback(() => {
        // Drop candidates the action can't apply to — advancing/rejecting a Rejected
        // or Signed applicant is a server no-op, which would otherwise inflate the
        // "advanced N" success count with untouched rows.
        const statusById = new Map(applicants.map((a) => [a.id, a.status]));
        return [...selectedApplicantIds].filter((id) => {
            const s = statusById.get(id);
            if (s === undefined) return false;
            if (bulkAction === 'advance') return !isApplicationRejectedStatus(s) && s !== 'Signed';
            if (bulkAction === 'reject') return !isApplicationRejectedStatus(s);
            return true;
        });
    }, [applicants, bulkAction, selectedApplicantIds]);
    const eligibleBulkCount = useMemo(
        () => getEligibleBulkApplicationIds().length,
        [getEligibleBulkApplicationIds],
    );

    const requestBulkSubmit = () => {
        if (bulkSaving || bulkSavingRef.current) return;
        const reason = bulkReason.trim();
        if (bulkAction === 'reject' && !reason) {
            setStatusUpdateError(t('applicant_funnel_bulk_reason_required'));
            return;
        }
        const applicationIds = getEligibleBulkApplicationIds();
        if (applicationIds.length === 0) {
            setStatusUpdateError(t('applicant_funnel_bulk_select_one'));
            return;
        }
        setStatusUpdateError(null);
        setBulkConfirmOpen(true);
    };

    const handleBulkSubmit = async () => {
        if (bulkSaving || bulkSavingRef.current) return;
        const reason = bulkReason.trim();
        if (bulkAction === 'reject' && !reason) {
            setStatusUpdateError(t('applicant_funnel_bulk_reason_required'));
            setBulkConfirmOpen(false);
            return;
        }
        const applicationIds = getEligibleBulkApplicationIds();
        if (applicationIds.length === 0) {
            setStatusUpdateError(t('applicant_funnel_bulk_select_one'));
            setBulkConfirmOpen(false);
            return;
        }

        bulkSavingRef.current = true;
        setBulkSaving(true);
        setStatusUpdateError(null);
        try {
            const result = await bulkUpdateApplicationStatus(applicationIds, bulkAction, {
                reason,
                candidateNote: bulkCandidateNote.trim(),
                notify: bulkNotify,
                messageBody: bulkNotify ? (bulkMessageBody.trim() || defaultBulkMessage) : '',
                templateKey: bulkAction === 'reject' ? 'rejection' : 'interview_invite',
            });
            await fetchApplicants();
            if (!mountedRef.current) return;
            setSelectedApplicantIds(new Set());
            setBulkConfirmOpen(false);
            if (result.failed > 0) {
                addToast(formatTranslation(t('applicant_funnel_bulk_partial_toast'), {
                    succeeded: result.succeeded,
                    failed: result.failed,
                }), 'info');
            } else {
                addToast(formatTranslation(t('applicant_funnel_bulk_success_toast'), { count: result.succeeded }), 'success');
            }
        } catch (err) {
            if (mountedRef.current) setStatusUpdateError(err instanceof Error ? err.message : t('applicant_funnel_bulk_error'));
        } finally {
            bulkSavingRef.current = false;
            if (mountedRef.current) setBulkSaving(false);
        }
    };

    const applyQuickFilter = (filter: QuickFilterKey) => {
        setKeyword('');
        setStatusFilter('all');

        if (filter === 'all') {
            clearFilters();
            return;
        }

        if (filter === 'high_match') {
            setMinScore('85');
            setRecencyFilter('all');
            setAnalysisFilter('all');
            setSortKey('newest');
            return;
        }

        if (filter === 'recent') {
            setMinScore('all');
            setRecencyFilter('7');
            setAnalysisFilter('all');
            setSortKey('newest');
            return;
        }

        setMinScore('all');
        setRecencyFilter('all');
        setAnalysisFilter('needs_review');
        setSortKey('newest');
    };

    const quickFilterIsActive = (filter: QuickFilterKey): boolean => {
        if (filter === 'all') return activeFilterCount === 0;
        if (keyword.trim() || statusFilter !== 'all') return false;
        if (filter === 'high_match') return minScore === '85' && recencyFilter === 'all' && analysisFilter === 'all';
        if (filter === 'recent') return minScore === 'all' && recencyFilter === '7' && analysisFilter === 'all';
        return minScore === 'all' && recencyFilter === 'all' && analysisFilter === 'needs_review';
    };

    const getStatusLabel = (status: string): string => t(getApplicationStatusLabelKey(status));

    const formatDate = (value: string | null): string => {
        if (!value) return t('applicant_funnel_date_unknown');
        const timestamp = new Date(value);
        return Number.isNaN(timestamp.getTime()) ? t('applicant_funnel_date_unknown') : timestamp.toLocaleDateString();
    };

    const getScoreTone = (score: number): string => {
        if (score >= 85) return 'text-green-600 dark:text-green-400';
        if (score >= 70) return 'text-blue-600 dark:text-blue-400';
        return 'text-yellow-600 dark:text-yellow-400';
    };

    const scoreOptionLabel = (value: ScoreThreshold): string => t(`applicant_funnel_score_${value}`);
    const sortOptionLabel = (value: SortKey): string => t(`applicant_funnel_sort_${value}`);
    const recencyOptionLabel = (value: RecencyFilter): string => t(`applicant_funnel_recency_${value}`);
    const analysisOptionLabel = (value: AnalysisFilter): string => t(`applicant_funnel_analysis_${value}`);
    const quickFilters: Array<{ key: QuickFilterKey; label: string; count: number; Icon: React.ElementType }> = [
        { key: 'all', label: t('applicant_funnel_analysis_all'), count: applicants.length, Icon: Users },
        { key: 'high_match', label: t('applicant_funnel_stat_high_match'), count: highMatchCount, Icon: Target },
        { key: 'recent', label: t('applicant_funnel_stat_recent'), count: recentCount, Icon: Clock3 },
        { key: 'needs_review', label: t('applicant_funnel_stat_needs_review'), count: needsReviewCount, Icon: FileWarning },
    ];
    const selectedRecommendation = useMemo(() => {
        if (!selectedApplicant) return null;

        if (!hasApplicantAnalysis(selectedApplicant)) {
            return {
                title: t('applicant_funnel_next_manual_title'),
                description: t('applicant_funnel_next_manual_desc'),
                tone: 'review' as RecommendationTone,
                Icon: FileWarning,
            };
        }

        const score = selectedApplicant.compatibility_score ?? 0;
        if (score >= 85) {
            return {
                title: t('applicant_funnel_next_contact_title'),
                description: t('applicant_funnel_next_contact_desc'),
                tone: 'strong' as RecommendationTone,
                Icon: MessageSquare,
            };
        }

        if (score >= 70) {
            return {
                title: t('applicant_funnel_next_screen_title'),
                description: t('applicant_funnel_next_screen_desc'),
                tone: 'screen' as RecommendationTone,
                Icon: Target,
            };
        }

        return {
            title: t('applicant_funnel_next_hold_title'),
            description: t('applicant_funnel_next_hold_desc'),
            tone: 'review' as RecommendationTone,
            Icon: FileWarning,
        };
    }, [selectedApplicant, t]);

    const handleSelectApplicant = useCallback((applicant: Applicant) => {
        setSelectedApplicant(applicant);
        if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
            window.requestAnimationFrame(() => {
                detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                detailRef.current?.focus({ preventScroll: true });
            });
        }
    }, []);

    const handleStatusChange = useCallback(async (
        applicant: Applicant,
        nextStatusValue: string,
        meta?: { action?: ApplicationStatusAction; reason?: string; candidateNote?: string },
    ): Promise<boolean> => {
        const nextStatus = normalizeApplicationStatus(nextStatusValue);
        if (normalizeApplicationStatus(applicant.status) === nextStatus) return true;
        const previousApplicants = applicants;
        const previousSelected = selectedApplicant;

        setStatusUpdateError(null);
        setStatusSavingId(applicant.id);
        setApplicants((current) =>
            current.map((entry) => entry.id === applicant.id ? { ...entry, status: nextStatus } : entry),
        );
        setSelectedApplicant((current) =>
            current?.id === applicant.id ? { ...current, status: nextStatus } : current,
        );

        try {
            const result = await updateApplicationStatus(
                applicant.id,
                nextStatus,
                meta?.reason ?? '',
                meta?.candidateNote ?? '',
                meta?.action,
            );
            if (result.changed) {
                const optimisticEvent: ApplicationStatusHistoryEvent = {
                    id: result.eventId,
                    action: result.action,
                    from_status: result.previousStatus,
                    to_status: result.status,
                    reason: meta?.reason?.trim() || null,
                    candidate_note: meta?.candidateNote?.trim() || null,
                    skipped_statuses: stringArray(result.skippedStatuses),
                    created_at: new Date().toISOString(),
                };
                const appendHistory = (entry: Applicant): Applicant => (
                    entry.id === applicant.id
                        ? { ...entry, status: result.status, status_history: [optimisticEvent, ...(entry.status_history ?? [])] }
                        : entry
                );
                setApplicants((current) => current.map(appendHistory));
                setSelectedApplicant((current) => current?.id === applicant.id ? appendHistory(current) : current);
            }
            return true;
        } catch {
            setApplicants(previousApplicants);
            setSelectedApplicant(previousSelected);
            setStatusUpdateError(t('applicant_funnel_status_update_error'));
            return false;
        } finally {
            setStatusSavingId(null);
        }
    }, [applicants, selectedApplicant, t]);

    const RecommendationIcon = selectedRecommendation?.Icon;

    if (loading) {
        return (
            <div role="status" aria-live="polite" className="flex min-h-[360px] flex-col items-center justify-center text-center">
                <div className="h-12 w-12 rounded-full border-4 border-blue-200 border-t-blue-700 animate-spin"></div>
                <p className="mt-4 text-base font-medium text-gray-700 dark:text-gray-300">{loadingMessage}</p>
                {/* Keep an exit available — scoring many applicants can take a minute. */}
                <button
                    type="button"
                    onClick={onBack}
                    className="mt-6 text-sm font-semibold text-gray-600 underline hover:text-gray-800 dark:text-gray-300 dark:hover:text-gray-100"
                >
                    {t('action_back')}
                </button>
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                <p className="font-semibold">{t('applicant_funnel_error_title')}</p>
                <p className="mt-2 text-sm">{error}</p>
                <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                    <button
                        type="button"
                        onClick={fetchApplicants}
                        disabled={refreshing}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-800 disabled:cursor-wait disabled:opacity-60"
                    >
                        <RotateCcw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                        {t('applicant_funnel_retry')}
                    </button>
                    <button
                        type="button"
                        onClick={onBack}
                        className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100 dark:hover:bg-red-900/40"
                    >
                        {t('applicant_funnel_back')}
                    </button>
                </div>
            </div>
        );
    }

    if (applicants.length === 0) {
        return (
            <div aria-busy={refreshing} className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <Users className="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600" />
                <h3 className="mt-4 text-xl font-semibold text-gray-800 dark:text-gray-100">{t('applicant_funnel_empty_title')}</h3>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-gray-500 dark:text-gray-400">{t('applicant_funnel_empty_desc')}</p>
                {refreshError && (
                    <div role="alert" className="mx-auto mt-4 max-w-xl rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-left text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                        {refreshError}
                    </div>
                )}
                <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
                    <button
                        type="button"
                        onClick={fetchApplicants}
                        disabled={refreshing}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-6 py-2 font-semibold text-white shadow-sm transition-all hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60"
                    >
                        <RotateCcw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                        {t('applicant_funnel_refresh')}
                    </button>
                    <button type="button" onClick={onBack} className="rounded-lg border border-gray-300 bg-gray-100 px-6 py-2 font-semibold text-gray-800 shadow-sm transition-all hover:bg-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600">
                        {t('applicant_funnel_back')}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div aria-busy={refreshing || analysisLoading} className="animate-view-fade space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                    type="button"
                    onClick={onBack}
                    className="inline-flex items-center gap-2 text-sm font-semibold text-blue-600 transition-colors hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400/40 dark:text-blue-400 dark:hover:text-blue-300"
                >
                    <ArrowLeft className="h-4 w-4" />
                    <span>{t('applicant_funnel_back')}</span>
                </button>
                <button
                    type="button"
                    onClick={fetchApplicants}
                    disabled={refreshing}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                    <RotateCcw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                    <span>{t('applicant_funnel_refresh')}</span>
                </button>
            </div>
            {refreshError && (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                    {refreshError}
                </div>
            )}
            {(applicantsTruncated || statusHistoryTruncated) && (
                <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
                    <p className="font-semibold">{t('applicant_funnel_review_limit_title')}</p>
                    {applicantsTruncated && (
                        <p className="mt-1 leading-5">
                            {formatTranslation(t('applicant_funnel_results_truncated'), { count: 500 })}
                        </p>
                    )}
                    {statusHistoryTruncated && (
                        <p className="mt-1 leading-5">{t('applicant_funnel_history_truncated')}</p>
                    )}
                </div>
            )}
            {analysisError && (
                <div role="alert" className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
                    <p>{analysisError}</p>
                    <button
                        type="button"
                        onClick={fetchApplicants}
                        className="shrink-0 self-start rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-semibold text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100 dark:hover:bg-amber-900 sm:self-auto"
                    >
                        {t('applicant_funnel_retry')}
                    </button>
                </div>
            )}
            {analysisLoading && (
                <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/20 dark:text-blue-200">
                    <RotateCcw className="h-4 w-4 animate-spin" />
                    <span>{t('applicant_funnel_loading_analyzing')}</span>
                </div>
            )}

            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-6">
                {statusUpdateError && (
                    <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                        {statusUpdateError}
                    </div>
                )}
                <div className="mb-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
                    <div className="min-w-0">
                        <h3 className="text-xl font-bold leading-tight text-gray-900 dark:text-gray-100">
                            {formatTranslation(t('applicant_funnel_title'), { title: job.title })}
                        </h3>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                                <Users className="h-3.5 w-3.5" />
                                {formatTranslation(t('applicant_funnel_total_count'), { count: applicants.length })}
                            </span>
                            {highMatchCount > 0 && (
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                                    <Target className="h-3.5 w-3.5" />
                                    {formatTranslation(t('applicant_funnel_high_match_count'), { count: highMatchCount })}
                                </span>
                            )}
                        </div>
                    </div>
                    <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300 lg:justify-self-end">
                        <SlidersHorizontal className="h-3.5 w-3.5" />
                        {formatTranslation(t('applicant_funnel_filter_result'), {
                            shown: filteredApplicants.length,
                            total: applicants.length,
                        })}
                    </span>
                </div>
                <RecoverableSectionBoundary
                    resetKey={`funnel-chart:${job.id}:${applicants.length}`}
                    title={t('applicant_funnel_error_title')}
                    description="Pipeline summary could not be shown. Applicant review is still available below."
                    retryLabel={t('applicant_funnel_retry')}
                    onRetry={fetchApplicants}
                >
                    <FunnelChart data={funnelData} t={t} />
                </RecoverableSectionBoundary>
            </div>

            {/* AI-hiring disclosure: AI output here is advisory decision-support,
                not automated screening (EEOC/FTC guidance; Ontario ESA disclosure). */}
            <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50/60 px-3.5 py-2.5 text-xs leading-5 text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/20 dark:text-blue-200">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-300" />
                <span>{t('applicant_funnel_ai_disclosure')}</span>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <aside className="flex h-auto min-h-[520px] flex-col rounded-xl border border-gray-200 bg-gray-50 p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900 lg:col-span-1 lg:min-h-[72vh]">
                    <div className="mb-4 flex items-start justify-between gap-3">
                        <div>
                            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('applicant_funnel_list_title')}</h3>
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                {formatTranslation(t('applicant_funnel_filter_result'), {
                                    shown: filteredApplicants.length,
                                    total: applicants.length,
                                })}
                            </p>
                        </div>
                        {activeFilterCount > 0 && (
                            <button
                                type="button"
                                onClick={clearFilters}
                                className="inline-flex items-center gap-1.5 rounded-full border border-blue-100 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-50 dark:border-blue-900/60 dark:bg-gray-800 dark:text-blue-300 dark:hover:bg-blue-950/40"
                            >
                                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold leading-none text-white dark:bg-blue-500">
                                    {activeFilterCount}
                                </span>
                                {t('applicant_funnel_clear_filters')}
                            </button>
                        )}
                    </div>

                    <div className="mb-4 flex-shrink-0 space-y-4 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                        <div className="grid grid-cols-2 gap-2" role="group" aria-label={t('applicant_funnel_analysis_label')}>
                            {quickFilters.map(({ key, label, count, Icon }) => {
                                const active = quickFilterIsActive(key);
                                return (
                                    <button
                                        key={key}
                                        type="button"
                                        onClick={() => applyQuickFilter(key)}
                                        aria-pressed={active}
                                        className={`min-h-[74px] rounded-lg border px-2.5 py-2 text-left transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-400/40 ${
                                            active
                                                ? 'border-blue-500 bg-blue-50 text-blue-800 shadow-sm dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-200'
                                                : 'border-gray-200 bg-gray-50 text-gray-700 hover:border-blue-200 hover:bg-blue-50/60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-blue-700 dark:hover:bg-blue-950/20'
                                        }`}
                                    >
                                        <span className="flex items-center justify-between gap-2">
                                            <Icon className={`h-4 w-4 ${active ? 'text-blue-700 dark:text-blue-300' : 'text-gray-400'}`} />
                                            <span className="text-base font-bold tabular-nums">{count}</span>
                                        </span>
                                        <span className="mt-1 block truncate text-[11px] font-semibold leading-4">{label}</span>
                                    </button>
                                );
                            })}
                        </div>

                        <div className="relative">
                            <label className="sr-only" htmlFor="applicant-search">
                                {t('applicant_funnel_search_label')}
                            </label>
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                            <input
                                id="applicant-search"
                                type="search"
                                placeholder={t('applicant_funnel_search_placeholder')}
                                value={keyword}
                                onChange={e => setKeyword(e.target.value)}
                                className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-800 transition-colors placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500"
                            />
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                            <SelectField
                                id="applicant-score-filter"
                                label={t('applicant_funnel_score_label')}
                                value={minScore}
                                onChange={(value) => setMinScore(value as ScoreThreshold)}
                            >
                                {SCORE_OPTIONS.map(option => (
                                    <option key={option} value={option}>{scoreOptionLabel(option)}</option>
                                ))}
                            </SelectField>

                            <SelectField
                                id="applicant-sort"
                                label={t('applicant_funnel_sort_label')}
                                value={sortKey}
                                onChange={(value) => setSortKey(value as SortKey)}
                            >
                                {SORT_OPTIONS.map(option => (
                                    <option key={option} value={option}>{sortOptionLabel(option)}</option>
                                ))}
                            </SelectField>
                        </div>

                        <div>
                            <button
                                type="button"
                                onClick={() => setFiltersOpen((open) => !open)}
                                aria-expanded={filtersOpen}
                                aria-controls="applicant-secondary-filters"
                                className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                            >
                                <span className="inline-flex items-center gap-2">
                                    <SlidersHorizontal className="h-4 w-4 text-gray-400" />
                                    {t('applicant_funnel_filters_disclosure')}
                                    {secondaryFilterCount > 0 && (
                                        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold leading-none text-white dark:bg-blue-500">
                                            {secondaryFilterCount}
                                        </span>
                                    )}
                                </span>
                                <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
                            </button>

                            {filtersOpen && (
                                <div id="applicant-secondary-filters" className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                                    <SelectField
                                        id="applicant-status-filter"
                                        label={t('applicant_funnel_status_label')}
                                        value={statusFilter}
                                        onChange={setStatusFilter}
                                    >
                                        <option value="all">{t('applicant_funnel_status_all')}</option>
                                        {statusOptions.map(status => (
                                            <option key={status} value={status}>{getStatusLabel(status)}</option>
                                        ))}
                                    </SelectField>

                                    <SelectField
                                        id="applicant-recency-filter"
                                        label={t('applicant_funnel_recency_label')}
                                        value={recencyFilter}
                                        onChange={(value) => setRecencyFilter(value as RecencyFilter)}
                                    >
                                        {RECENCY_OPTIONS.map(option => (
                                            <option key={option} value={option}>{recencyOptionLabel(option)}</option>
                                        ))}
                                    </SelectField>

                                    <SelectField
                                        id="applicant-analysis-filter"
                                        label={t('applicant_funnel_analysis_label')}
                                        value={analysisFilter}
                                        onChange={(value) => setAnalysisFilter(value as AnalysisFilter)}
                                        className="sm:col-span-2 lg:col-span-1 xl:col-span-2"
                                    >
                                        {ANALYSIS_OPTIONS.map(option => (
                                            <option key={option} value={option}>{analysisOptionLabel(option)}</option>
                                        ))}
                                    </SelectField>
                                </div>
                            )}
	                        </div>
	                    </div>

	                    <div className="order-3 mt-3 flex-shrink-0 rounded-xl border border-blue-100 bg-blue-50/70 p-3 dark:border-blue-900/50 dark:bg-blue-950/20">
	                        <div className="flex flex-wrap items-center justify-between gap-2">
	                            <label className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-blue-100 bg-white px-2.5 text-xs font-semibold text-blue-800 shadow-sm dark:border-blue-900/60 dark:bg-gray-900 dark:text-blue-200">
	                                <input
	                                    type="checkbox"
	                                    checked={allVisibleSelected}
	                                    disabled={filteredApplicants.length === 0 || bulkSaving}
	                                    onChange={toggleVisibleSelection}
	                                    className="h-4 w-4 rounded border-blue-300 text-blue-600 focus:ring-blue-500"
	                                />
	                                {allVisibleSelected ? t('applicant_funnel_bulk_clear_visible') : t('applicant_funnel_bulk_select_visible')}
	                            </label>
	                            <span className="text-xs font-semibold text-blue-900 dark:text-blue-200">
	                                {formatTranslation(t('applicant_funnel_bulk_selected'), { count: selectedApplicantIds.size })}
	                            </span>
	                        </div>

	                        {selectedApplicantIds.size > 0 && (
	                            <div className="mt-3 space-y-3 rounded-lg border border-blue-100 bg-white p-3 dark:border-blue-900/60 dark:bg-gray-900">
	                                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
	                                    <SelectField
	                                        id="applicant-bulk-action"
	                                        label={t('applicant_funnel_bulk_action_label')}
	                                        value={bulkAction}
	                                        onChange={(value) => {
	                                            setBulkAction(value as BulkActionMode);
	                                            setBulkMessageBody('');
	                                        }}
	                                    >
	                                        <option value="advance">{t('applicant_funnel_bulk_action_advance')}</option>
	                                        <option value="reject">{t('applicant_funnel_bulk_action_reject')}</option>
	                                    </SelectField>
	                                    <div>
	                                        <label htmlFor="applicant-bulk-note" className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
	                                            {t('applicant_funnel_bulk_candidate_note_label')}
	                                        </label>
	                                        <input
	                                            id="applicant-bulk-note"
	                                            type="text"
	                                            value={bulkCandidateNote}
	                                            onChange={(event) => setBulkCandidateNote(event.target.value)}
	                                            placeholder={t('applicant_funnel_bulk_candidate_note_placeholder')}
	                                            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-950 dark:text-gray-100 dark:placeholder-gray-500"
	                                        />
	                                    </div>
	                                </div>

	                                {bulkAction === 'reject' && (
	                                    <div>
	                                        <label htmlFor="applicant-bulk-reason" className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
	                                            {t('applicant_funnel_bulk_reason_label')}
	                                        </label>
	                                        <textarea
	                                            id="applicant-bulk-reason"
	                                            value={bulkReason}
	                                            onChange={(event) => setBulkReason(event.target.value)}
	                                            rows={2}
	                                            placeholder={t('applicant_funnel_bulk_reason_placeholder')}
	                                            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-950 dark:text-gray-100 dark:placeholder-gray-500"
	                                        />
	                                    </div>
	                                )}

	                                <label className="inline-flex items-start gap-2 text-xs font-semibold text-gray-700 dark:text-gray-200">
	                                    <input
	                                        type="checkbox"
	                                        checked={bulkNotify}
	                                        onChange={(event) => setBulkNotify(event.target.checked)}
	                                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
	                                    />
	                                    <span>{t('applicant_funnel_bulk_notify_label')}</span>
	                                </label>

	                                {bulkNotify && (
	                                    <div>
	                                        <label htmlFor="applicant-bulk-message" className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
	                                            {t('applicant_funnel_bulk_message_label')}
	                                        </label>
	                                        <textarea
	                                            id="applicant-bulk-message"
	                                            value={bulkMessageBody}
	                                            onChange={(event) => setBulkMessageBody(event.target.value)}
	                                            rows={3}
	                                            placeholder={defaultBulkMessage}
	                                            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-950 dark:text-gray-100 dark:placeholder-gray-500"
	                                        />
	                                    </div>
	                                )}

	                                <div className="flex flex-wrap items-center gap-2">
	                                    <button
	                                        type="button"
	                                        onClick={requestBulkSubmit}
	                                        disabled={bulkSaving}
	                                        className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
	                                    >
	                                        <ClipboardCheck className="h-4 w-4" />
	                                        {bulkSaving ? t('applicant_funnel_bulk_working') : t('applicant_funnel_bulk_apply')}
	                                    </button>
	                                    <button
	                                        type="button"
	                                        onClick={() => setSelectedApplicantIds(new Set())}
	                                        disabled={bulkSaving}
	                                        className="min-h-9 rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
	                                    >
	                                        {t('applicant_funnel_bulk_clear')}
	                                    </button>
	                                </div>
	                            </div>
	                        )}
	                    </div>

	                    <div className="order-2 max-h-[560px] space-y-2 overflow-y-auto pr-1">
                        {filteredApplicants.length === 0 ? (
                            <div className="flex h-full min-h-[260px] flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white px-4 py-8 text-center dark:border-gray-700 dark:bg-gray-800">
                                <Users className="mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" />
                                <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('applicant_funnel_no_filter_title')}</p>
                                <p className="mt-2 max-w-xs text-xs leading-5 text-gray-500 dark:text-gray-400">{t('applicant_funnel_no_filter_desc')}</p>
                                <button
                                    type="button"
                                    onClick={clearFilters}
                                    className="mt-4 rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-50 dark:border-blue-900/60 dark:text-blue-300 dark:hover:bg-blue-950/40"
                                >
                                    {t('applicant_funnel_clear_all_filters')}
                                </button>
                            </div>
                        ) : (
	                            filteredApplicants.map(applicant => {
	                                const score = applicant.compatibility_score ?? 0;
	                                const analyzed = hasApplicantAnalysis(applicant);
	                                const candidateName = applicant.candidate_name || t('applicant_funnel_unnamed_candidate');
	                                return (
	                                    <div
	                                        key={applicant.id}
	                                        className="flex items-start gap-2"
	                                    >
	                                        <label className="mt-3 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
	                                            <span className="sr-only">{formatTranslation(t('applicant_funnel_select_applicant'), { name: candidateName })}</span>
	                                            <input
	                                                type="checkbox"
	                                                checked={selectedApplicantIds.has(applicant.id)}
	                                                onChange={() => toggleApplicantSelection(applicant.id)}
	                                                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
	                                            />
	                                        </label>
	                                        <button
	                                            type="button"
	                                            data-qa="applicant-card"
	                                            data-qa-applicant-id={applicant.id}
	                                            onClick={() => handleSelectApplicant(applicant)}
	                                            aria-current={selectedApplicant?.id === applicant.id ? 'true' : undefined}
	                                            className={`min-w-0 flex-1 rounded-xl border p-3 text-left transition-all duration-200 ${
	                                                selectedApplicant?.id === applicant.id
	                                                    ? 'border-blue-500 bg-blue-50 shadow-sm ring-2 ring-blue-500/10 dark:border-blue-400 dark:bg-blue-950/30'
	                                                    : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/50 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-blue-500 dark:hover:bg-gray-800/80'
	                                            }`}
	                                        >
	                                            <div className="flex items-start justify-between gap-3">
	                                                <div className="min-w-0">
	                                                    <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{candidateName}</p>
	                                                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
	                                                        {formatTranslation(t('applicant_funnel_applied_on'), { date: formatDate(applicant.application_date) })}
	                                                    </p>
	                                                </div>
	                                                <div className={`shrink-0 text-lg font-bold tabular-nums ${analyzed ? getScoreTone(score) : 'text-gray-400'}`}>
	                                                    {analyzed ? `${score}%` : '—'}
	                                                </div>
	                                            </div>
	                                            <div className="mt-3 flex flex-wrap items-center gap-2">
	                                                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600 dark:bg-gray-700 dark:text-gray-300">
	                                                    {getStatusLabel(applicant.status)}
	                                                </span>
	                                                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
	                                                    {t('applicant_funnel_match_score')}: {analyzed ? `${score}%` : '—'}
	                                                </span>
	                                                {!analyzed && (
	                                                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
	                                                        {t('applicant_funnel_needs_review_chip')}
	                                                    </span>
	                                                )}
	                                                {talentProfileHasData(applicant.talent_profile) && (
	                                                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
	                                                        {t('applicant_funnel_talent_profile_chip')}
	                                                    </span>
	                                                )}
	                                            </div>
	                                        </button>
	                                    </div>
	                                );
	                            })
                        )}
                    </div>
                </aside>

                <section
                    ref={detailRef}
                    className="min-h-[520px] scroll-mt-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800 lg:col-span-2 lg:h-[72vh] lg:overflow-y-auto"
                    aria-label={selectedApplicant
                        ? `${selectedApplicant.candidate_name || t('applicant_funnel_unnamed_candidate')} application details`
                        : t('applicant_funnel_select_prompt')}
                    tabIndex={-1}
                >
                    <RecoverableSectionBoundary
                        resetKey={`${selectedApplicant?.id ?? 'none'}:${selectedApplicant?.status ?? ''}`}
                        title="Applicant details could not be shown"
                        description="One part of this applicant packet returned unexpected data. The rest of the portal is still usable."
                        retryLabel={t('applicant_funnel_retry')}
                        onRetry={fetchApplicants}
                        secondaryLabel={t('applicant_funnel_back')}
                        onSecondaryAction={onBack}
                    >
                    {!selectedApplicant ? (
                        <div className="flex h-full min-h-[360px] items-center justify-center rounded-xl border border-dashed border-gray-300 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                            {t('applicant_funnel_select_prompt')}
                        </div>
                    ) : hasApplicantAnalysis(selectedApplicant) ? (
                        <div key={selectedApplicant.id} className="animate-panel-expand space-y-5">
                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-700 dark:bg-gray-900">
                                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0">
                                        <h2 className="text-2xl font-bold leading-tight text-gray-900 dark:text-gray-100">
                                            {selectedApplicant.candidate_name || t('applicant_funnel_unnamed_candidate')}
                                        </h2>
                                        <div className="mt-3 flex flex-wrap items-center gap-2">
                                            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 ring-1 ring-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-700">
                                                {getStatusLabel(selectedApplicant.status)}
                                            </span>
                                            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-gray-600 ring-1 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700">
                                                {formatTranslation(t('applicant_funnel_applied_on'), { date: formatDate(selectedApplicant.application_date) })}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-stretch gap-2 sm:items-end">
                                        <div className="rounded-xl border border-blue-100 bg-white px-4 py-3 text-left shadow-sm dark:border-blue-900/60 dark:bg-gray-800 sm:text-right">
                                            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">{t('applicant_funnel_match_score')}</p>
                                            <p className={`mt-1 text-3xl font-bold tabular-nums ${hasApplicantAnalysis(selectedApplicant) ? getScoreTone(selectedApplicant.compatibility_score ?? 0) : 'text-gray-400'}`}>
                                                {hasApplicantAnalysis(selectedApplicant) ? `${selectedApplicant.compatibility_score ?? 0}%` : '—'}
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleSaveCandidate(selectedApplicant)}
                                            disabled={savedIds.has(selectedApplicant.id) || savingIds.has(selectedApplicant.id)}
                                            className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                                                savedIds.has(selectedApplicant.id)
                                                    ? 'cursor-default bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                                                    : 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60'
                                            }`}
                                        >
                                            <Star className={`h-4 w-4 ${savedIds.has(selectedApplicant.id) ? 'fill-current' : ''}`} />
                                            {savingIds.has(selectedApplicant.id)
                                                ? t('applicant_funnel_saving')
                                                : savedIds.has(selectedApplicant.id)
                                                    ? t('applicant_funnel_saved')
                                                    : t('applicant_funnel_save_candidate')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleViewResume(selectedApplicant)}
                                            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                                        >
                                            <Eye className="h-4 w-4" />
                                            {t('applicant_funnel_view_resume')}
                                        </button>
                                    </div>
                                </div>
                                <StageControl
                                    applicant={selectedApplicant}
                                    statusSavingId={statusSavingId}
                                    getStatusLabel={getStatusLabel}
                                    onStatusChange={handleStatusChange}
                                    t={t}
                                />
                                {selectedApplicant.summary && (
                                    <p className="mt-4 max-w-3xl text-sm leading-6 text-gray-600 dark:text-gray-400">{selectedApplicant.summary}</p>
                                )}
                            </div>

                            <RecoverableSectionBoundary
                                resetKey={`talent-profile:${selectedApplicant.id}`}
                                title={t('applicant_funnel_error_title')}
                                description="The structured talent profile could not be shown. You can still review the rest of this application."
                                retryLabel={t('applicant_funnel_retry')}
                                onRetry={fetchApplicants}
                            >
                                <TalentProfileSummary profile={selectedApplicant.talent_profile} t={t} />
                            </RecoverableSectionBoundary>

                            <RecoverableSectionBoundary
                                resetKey={`job-fit:${selectedApplicant.id}:${job.id}`}
                                title={t('applicant_funnel_error_title')}
                                description="The job-fit checklist could not be shown. You can still review the applicant packet."
                                retryLabel={t('applicant_funnel_retry')}
                                onRetry={fetchApplicants}
                            >
                                <JobFitChecklist job={job} profile={selectedApplicant.talent_profile} t={t} />
                            </RecoverableSectionBoundary>

                            <RecoverableSectionBoundary
                                resetKey={`interviews:${selectedApplicant.id}`}
                                title={t('applicant_funnel_error_title')}
                                description="Interview scheduling could not be shown. The candidate review panel remains available."
                                retryLabel={t('applicant_funnel_retry')}
                                onRetry={fetchApplicants}
                            >
                                <InterviewsSection
                                    // Remount per applicant so a half-typed scorecard/interview
                                    // draft for one candidate can't bleed into the next.
                                    key={selectedApplicant.id}
                                    applicationId={selectedApplicant.id}
                                    employerUid={employerUid}
                                    defaultStage={getStatusLabel(selectedApplicant.status)}
                                    t={t}
                                />
                            </RecoverableSectionBoundary>

                            <RecoverableSectionBoundary
                                resetKey={`status-history:${selectedApplicant.id}:${(selectedApplicant.status_history ?? []).length}`}
                                title={t('applicant_funnel_error_title')}
                                description="Status history could not be shown. The current application status is still visible above."
                                retryLabel={t('applicant_funnel_retry')}
                                onRetry={fetchApplicants}
                            >
                                <StatusHistory history={selectedApplicant.status_history ?? []} getStatusLabel={getStatusLabel} t={t} />
                            </RecoverableSectionBoundary>

                            {selectedRecommendation && RecommendationIcon && (
                                <div className={`rounded-xl border p-4 ${RECOMMENDATION_TONE_CLASS[selectedRecommendation.tone]}`}>
                                    <div className="flex items-start gap-3">
                                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/70 text-current shadow-sm dark:bg-gray-950/30">
                                            <RecommendationIcon className="h-4 w-4" />
                                        </div>
                                        <div className="min-w-0">
                                            <h4 className="text-sm font-semibold leading-5">{selectedRecommendation.title}</h4>
                                            <p className="mt-1 text-sm leading-6 opacity-90">{selectedRecommendation.description}</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {(selectedApplicant.strengths.length > 0 || selectedApplicant.potentialGaps.length > 0) && (
                                <div className="grid gap-4 xl:grid-cols-2">
                                    {selectedApplicant.strengths.length > 0 && (
                                        <div className="rounded-xl border border-green-200 bg-green-50 p-4 dark:border-green-900/60 dark:bg-green-950/20">
                                            <h4 className="font-semibold text-green-800 dark:text-green-200">{t('applicant_funnel_strengths')}</h4>
                                            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-green-900 dark:text-green-100">
                                                {selectedApplicant.strengths.map((strength, index) => <li key={`${strength}-${index}`}>{strength}</li>)}
                                            </ul>
                                        </div>
                                    )}
                                    {selectedApplicant.potentialGaps.length > 0 && (
                                        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900/60 dark:bg-yellow-950/20">
                                            <h4 className="font-semibold text-yellow-800 dark:text-yellow-200">{t('applicant_funnel_potential_gaps')}</h4>
                                            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-yellow-900 dark:text-yellow-100">
                                                {selectedApplicant.potentialGaps.map((gap, index) => <li key={`${gap}-${index}`}>{gap}</li>)}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            )}

                            {selectedApplicant.suggestedQuestions.length > 0 && (
                                <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900/60 dark:bg-indigo-950/20">
                                    <h4 className="font-semibold text-indigo-800 dark:text-indigo-200">{t('applicant_funnel_questions')}</h4>
                                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-indigo-900 dark:text-indigo-100">
                                        {selectedApplicant.suggestedQuestions.map((question, index) => <li key={`${question}-${index}`}>{question}</li>)}
                                    </ul>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div key={selectedApplicant.id} className="animate-panel-expand space-y-5">
                            <RecoverableSectionBoundary
                                resetKey={`talent-profile:${selectedApplicant.id}`}
                                title={t('applicant_funnel_error_title')}
                                description="The structured talent profile could not be shown. You can still review the rest of this application."
                                retryLabel={t('applicant_funnel_retry')}
                                onRetry={fetchApplicants}
                            >
                                <TalentProfileSummary profile={selectedApplicant.talent_profile} t={t} />
                            </RecoverableSectionBoundary>

                            <RecoverableSectionBoundary
                                resetKey={`job-fit:${selectedApplicant.id}:${job.id}`}
                                title={t('applicant_funnel_error_title')}
                                description="The job-fit checklist could not be shown. You can still review the applicant packet."
                                retryLabel={t('applicant_funnel_retry')}
                                onRetry={fetchApplicants}
                            >
                                <JobFitChecklist job={job} profile={selectedApplicant.talent_profile} t={t} />
                            </RecoverableSectionBoundary>
                            <RecoverableSectionBoundary
                                resetKey={`interviews:${selectedApplicant.id}`}
                                title={t('applicant_funnel_error_title')}
                                description="Interview scheduling could not be shown. The candidate review panel remains available."
                                retryLabel={t('applicant_funnel_retry')}
                                onRetry={fetchApplicants}
                            >
                                <InterviewsSection
                                    // Remount per applicant so a half-typed scorecard/interview
                                    // draft for one candidate can't bleed into the next.
                                    key={selectedApplicant.id}
                                    applicationId={selectedApplicant.id}
                                    employerUid={employerUid}
                                    defaultStage={getStatusLabel(selectedApplicant.status)}
                                    t={t}
                                />
                            </RecoverableSectionBoundary>
                            <RecoverableSectionBoundary
                                resetKey={`status-history:${selectedApplicant.id}:${(selectedApplicant.status_history ?? []).length}`}
                                title={t('applicant_funnel_error_title')}
                                description="Status history could not be shown. The current application status is still visible above."
                                retryLabel={t('applicant_funnel_retry')}
                                onRetry={fetchApplicants}
                            >
                                <StatusHistory history={selectedApplicant.status_history ?? []} getStatusLabel={getStatusLabel} t={t} />
                            </RecoverableSectionBoundary>
                            <div className="mx-auto max-w-sm rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
                                <FileWarning className="mx-auto h-10 w-10 text-amber-500" />
                                <p className="mt-3 font-semibold text-gray-700 dark:text-gray-200">
                                    {formatTranslation(t('applicant_funnel_no_analysis_title'), {
                                        name: selectedApplicant.candidate_name || t('applicant_funnel_unnamed_candidate'),
                                    })}
                                </p>
                                <p className="mx-auto mt-2 text-sm leading-6">{t('applicant_funnel_no_analysis_desc')}</p>
                                <button
                                    type="button"
                                    onClick={() => handleViewResume(selectedApplicant)}
                                    className="mx-auto mt-4 inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                                >
                                    <Eye className="h-4 w-4" />
                                    {t('applicant_funnel_view_resume')}
                                </button>
                                {selectedRecommendation && RecommendationIcon && (
                                    <div className={`mt-4 rounded-lg border p-3 text-left ${RECOMMENDATION_TONE_CLASS[selectedRecommendation.tone]}`}>
                                        <div className="flex items-start gap-2.5">
                                            <RecommendationIcon className="mt-0.5 h-4 w-4 shrink-0" />
                                            <div>
                                                <p className="text-sm font-semibold">{selectedRecommendation.title}</p>
                                                <p className="mt-1 text-xs leading-5 opacity-90">{selectedRecommendation.description}</p>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                <div className="text-left">
                                    <StageControl
                                        applicant={selectedApplicant}
                                        statusSavingId={statusSavingId}
                                        getStatusLabel={getStatusLabel}
                                        onStatusChange={handleStatusChange}
                                        t={t}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {selectedApplicant && selectedApplicant.screener_answers.length > 0 && (
                        <div className="mt-5 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                            <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t('applicant_funnel_screener_title')}</h4>
                            <dl className="mt-2 space-y-2.5">
                                {selectedApplicant.screener_answers.map((sa) => {
                                    const q = (job.screener_questions ?? []).find((x) => x.id === sa.question_id);
                                    // 'expected' is a SCREENING SIGNAL, never an auto-reject — flag a mismatch only.
                                    const isSignal = !!q?.expected && q.type === 'yes_no' && sa.answer.trim().toLowerCase() !== q.expected;
                                    return (
                                        <div key={sa.question_id}>
                                            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{sa.prompt}</dt>
                                            <dd className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-slate-800 dark:text-slate-100">
                                                <span>{sa.answer || t('applicant_funnel_screener_no_answer')}</span>
                                                {isSignal && (
                                                    <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                                                        {t('applicant_funnel_screener_signal')}
                                                    </span>
                                                )}
                                            </dd>
                                        </div>
                                    );
                                })}
                            </dl>
                        </div>
                    )}

                    {selectedApplicant && (
                        <div className="mt-5">
                            <RecoverableSectionBoundary
                                resetKey={`messages:${selectedApplicant.id}`}
                                title={t('applicant_funnel_error_title')}
                                description="Messages could not be shown. Application review is still available."
                                retryLabel={t('applicant_funnel_retry')}
                                onRetry={fetchApplicants}
                            >
                                <ApplicationMessageThread key={selectedApplicant.id} applicationId={selectedApplicant.id} viewerRole="employer" viewerUid={employerUid} t={t} />
                            </RecoverableSectionBoundary>
                        </div>
                    )}
                    </RecoverableSectionBoundary>
                </section>
            </div>

            <ConfirmActionDialog
                open={bulkConfirmOpen}
                title={bulkAction === 'reject'
                    ? t('applicant_funnel_bulk_action_reject')
                    : t('applicant_funnel_bulk_action_advance')}
                description={formatTranslation(t('applicant_funnel_bulk_selected'), { count: eligibleBulkCount })}
                detail={bulkNotify ? t('applicant_funnel_bulk_notify_label') : undefined}
                cancelLabel={t('dashboard_cancel_update')}
                confirmLabel={t('applicant_funnel_bulk_apply')}
                loadingLabel={t('applicant_funnel_bulk_working')}
                loading={bulkSaving}
                tone={bulkAction === 'reject' ? 'danger' : 'primary'}
                onOpenChange={(open) => {
                    if (!open && !bulkSaving) setBulkConfirmOpen(false);
                }}
                onCancel={() => {
                    if (!bulkSaving) setBulkConfirmOpen(false);
                }}
                onConfirm={handleBulkSubmit}
            />

            {viewingApplicant && (
                <ViewportAwareDialog open onClose={closeResumeView} closeOnBackdrop labelledBy="applicant-resume-view-title" maxWidth={672} zIndex={70}>
                    <div className="flex min-h-[420px] flex-col rounded-xl bg-white shadow-2xl dark:bg-gray-800">
                        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-3 dark:border-gray-700">
                            <h3 id="applicant-resume-view-title" className="min-w-0 truncate text-base font-semibold text-gray-900 dark:text-gray-100">
                                {formatTranslation(t('applicant_funnel_resume_modal_title'), {
                                    name: viewingApplicant.candidate_name || t('applicant_funnel_unnamed_candidate'),
                                })}
                            </h3>
                            <button
                                type="button"
                                onClick={closeResumeView}
                                aria-label={t('applicant_funnel_resume_close')}
                                className="shrink-0 rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto p-4">
                            {resumeViewLoading ? (
                                <div className="flex h-[320px] items-center justify-center">
                                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-700" />
                                </div>
                            ) : resumeViewError ? (
                                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                                    {resumeViewError}
                                </div>
                            ) : resumeViewText && resumeViewText.trim() ? (
                                <ResumePreview resumeText={resumeViewText} market="" t={t} />
                            ) : (
                                <div className="flex h-[320px] items-center justify-center px-4 text-center text-sm text-gray-500 dark:text-gray-400">
                                    {t('applicant_funnel_resume_empty')}
                                </div>
                            )}
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3 dark:border-gray-700">
                            <button
                                type="button"
                                onClick={() => handleDownloadResume(viewingApplicant)}
                                disabled={downloadingResumeId === viewingApplicant.id}
                                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                            >
                                <Download className="h-4 w-4" />
                                {downloadingResumeId === viewingApplicant.id
                                    ? t('applicant_funnel_downloading')
                                    : t('applicant_funnel_download_resume')}
                            </button>
                            <button
                                type="button"
                                onClick={closeResumeView}
                                className="inline-flex min-h-10 items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
                            >
                                {t('applicant_funnel_resume_close')}
                            </button>
                        </div>
                    </div>
                </ViewportAwareDialog>
            )}
        </div>
    );
};

export default ApplicantFunnel;
