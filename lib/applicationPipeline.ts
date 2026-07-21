export type ApplicationStatusGroup = 'applied' | 'interview' | 'offer' | 'hired' | 'rejected';

export interface ApplicationPipelineStage {
  status: string;
  labelKey: string;
  group: Exclude<ApplicationStatusGroup, 'rejected'>;
  optional?: boolean;
}

export const APPLICATION_PIPELINE_STAGES = [
  {
    status: 'Applied',
    labelKey: 'applications_status_applied',
    group: 'applied',
  },
  {
    status: 'Group Interview',
    labelKey: 'applications_status_group_interview',
    group: 'interview',
  },
  {
    status: 'First Interview',
    labelKey: 'applications_status_first_interview',
    group: 'interview',
  },
  {
    status: 'Second Interview',
    labelKey: 'applications_status_second_interview',
    group: 'interview',
  },
  {
    status: 'Decision Maker Interview',
    labelKey: 'applications_status_decision_maker_interview',
    group: 'interview',
  },
  {
    status: 'HR Interview',
    labelKey: 'applications_status_hr_interview',
    group: 'interview',
  },
  {
    status: 'Offer',
    labelKey: 'applications_status_offer',
    group: 'offer',
  },
  {
    status: 'Hiring Evaluation',
    labelKey: 'applications_status_hiring_evaluation',
    group: 'offer',
  },
  {
    status: 'Intent Letter',
    labelKey: 'applications_status_intent_letter',
    group: 'offer',
    optional: true,
  },
  {
    status: 'Offer Confirmed',
    labelKey: 'applications_status_offer_confirmed',
    group: 'offer',
  },
  {
    status: 'Tripartite Agreement',
    labelKey: 'applications_status_tripartite_agreement',
    group: 'offer',
  },
  {
    status: 'Signed',
    labelKey: 'applications_status_signed',
    group: 'hired',
  },
] as const satisfies readonly ApplicationPipelineStage[];

export type ApplicationPipelineStatus =
  | ApplicationPipelineStageStatus
  | 'Rejected';

export type ApplicationPipelineStageStatus = (typeof APPLICATION_PIPELINE_STAGES)[number]['status'];
export type ApplicationTimelineStageState = 'done' | 'current' | 'pending' | 'closed' | 'skipped';

export type ApplicationProgressGroupId = 'applied' | 'interview' | 'offer' | 'signing';

export interface ApplicationProgressGroup {
  id: ApplicationProgressGroupId;
  labelKey: string;
  statuses: readonly ApplicationPipelineStageStatus[];
  noteKey?: string;
}

export const APPLICATION_PROGRESS_GROUPS = [
  {
    id: 'applied',
    labelKey: 'applications_progress_group_applied',
    statuses: ['Applied'],
  },
  {
    id: 'interview',
    labelKey: 'applications_progress_group_interview',
    statuses: [
      'Group Interview',
      'First Interview',
      'Second Interview',
      'Decision Maker Interview',
      'HR Interview',
    ],
  },
  {
    id: 'offer',
    labelKey: 'applications_progress_group_offer',
    statuses: [
      'Offer',
      'Hiring Evaluation',
      'Intent Letter',
      'Offer Confirmed',
    ],
    noteKey: 'applications_progress_offer_note',
  },
  {
    id: 'signing',
    labelKey: 'applications_progress_group_signing',
    statuses: ['Tripartite Agreement', 'Signed'],
  },
] as const satisfies readonly ApplicationProgressGroup[];

// Bar anchors to the 4 stable macro phases, not the 12 fine-grained stages.
// Real hiring loops often skip interview rounds and campus-only paperwork, so a
// fixed "of 12" denominator would misrepresent progress. The intra-phase nudge
// keeps the bar moving on each real status change without implying the next
// macro milestone has already been reached.
const APPLICATION_PHASE_BASE_PERCENT = [10, 35, 60, 85] as const;
const APPLICATION_PHASE_CEIL_PERCENT = 100;

export type ApplicationFilterGroup = 'All' | ApplicationStatusGroup;

export const APPLICATION_FILTER_GROUPS: ApplicationFilterGroup[] = [
  'All',
  'applied',
  'interview',
  'offer',
  'hired',
  'rejected',
];

export const APPLICATION_FILTER_LABEL_KEYS: Record<ApplicationFilterGroup, string> = {
  All: 'applications_filter_all',
  applied: 'applications_filter_applied',
  interview: 'applications_filter_interview',
  offer: 'applications_filter_offer',
  hired: 'applications_filter_hired',
  rejected: 'applications_filter_rejected',
};

const STAGE_BY_STATUS = new Map<string, ApplicationPipelineStage>(
  APPLICATION_PIPELINE_STAGES.map((stage) => [stage.status, stage]),
);

const STATUS_ALIASES: Record<string, ApplicationPipelineStatus> = {
  applied: 'Applied',
  apply: 'Applied',
  submitted: 'Applied',
  'resume submitted': 'Applied',
  '投递简历': 'Applied',
  '已投递': 'Applied',
  interviewing: 'First Interview',
  interview: 'First Interview',
  'interview-stage': 'First Interview',
  'interview stage': 'First Interview',
  '面试中': 'First Interview',
  'group interview': 'Group Interview',
  '集体面试': 'Group Interview',
  'first interview': 'First Interview',
  '初试': 'First Interview',
  'second interview': 'Second Interview',
  '复试': 'Second Interview',
  'decision maker interview': 'Decision Maker Interview',
  'hiring manager interview': 'Decision Maker Interview',
  '用人决策者面试': 'Decision Maker Interview',
  'hr interview': 'HR Interview',
  'hr面试': 'HR Interview',
  offer: 'Offer',
  '录用评估中': 'Hiring Evaluation',
  'hiring evaluation': 'Hiring Evaluation',
  'intent letter': 'Intent Letter',
  '确认意向书': 'Intent Letter',
  'offer confirmed': 'Offer Confirmed',
  accepted: 'Offer Confirmed',
  '确认offer': 'Offer Confirmed',
  '确认OFFER': 'Offer Confirmed',
  'tripartite agreement': 'Tripartite Agreement',
  '三方协议': 'Tripartite Agreement',
  signed: 'Signed',
  hired: 'Signed',
  '签约': 'Signed',
  '已录用': 'Signed',
  rejected: 'Rejected',
  closed: 'Rejected',
  declined: 'Rejected',
  '未通过': 'Rejected',
};

export function normalizeApplicationStatus(status: unknown): ApplicationPipelineStatus {
  const value = String(status ?? '').trim();
  if (!value) return 'Applied';

  const direct = APPLICATION_PIPELINE_STAGES.find((stage) => stage.status === value);
  if (direct) return direct.status;
  if (value === 'Rejected') return 'Rejected';

  const normalized = value.toLowerCase();
  return STATUS_ALIASES[normalized] ?? 'Applied';
}

function normalizeKnownApplicationStageStatus(status: unknown): ApplicationPipelineStageStatus | null {
  const value = typeof status === 'string' ? status.trim() : '';
  if (!value) return null;

  const direct = APPLICATION_PIPELINE_STAGES.find((stage) => stage.status === value);
  if (direct) return direct.status;

  const alias = STATUS_ALIASES[value.toLowerCase()];
  if (!alias || alias === 'Rejected') return null;
  return STAGE_BY_STATUS.has(alias) ? alias : null;
}

export function normalizeSkippedApplicationStatuses(value: unknown): ApplicationPipelineStageStatus[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<ApplicationPipelineStageStatus>();
  value.forEach((item) => {
    const normalized = normalizeKnownApplicationStageStatus(item);
    if (normalized) seen.add(normalized);
  });
  return APPLICATION_PIPELINE_STAGES
    .map((stage) => stage.status)
    .filter((status): status is ApplicationPipelineStageStatus => seen.has(status));
}

export function getApplicationStatusGroup(status: unknown): ApplicationStatusGroup {
  const normalized = normalizeApplicationStatus(status);
  if (normalized === 'Rejected') return 'rejected';
  return STAGE_BY_STATUS.get(normalized)?.group ?? 'applied';
}

export function getApplicationStatusIndex(status: unknown): number {
  const normalized = normalizeApplicationStatus(status);
  return APPLICATION_PIPELINE_STAGES.findIndex((stage) => stage.status === normalized);
}

export function getApplicationTimelineStageState(
  applicationStatus: unknown,
  stageStatus: unknown,
  skippedStatuses: readonly ApplicationPipelineStageStatus[] = [],
): ApplicationTimelineStageState {
  const normalized = normalizeApplicationStatus(applicationStatus);
  if (normalized === 'Rejected') return 'closed';

  const current = getApplicationStatusIndex(normalized);
  const stageIndex = getApplicationStatusIndex(stageStatus);
  if (current < 0 || stageIndex < 0) return 'pending';

  const stage = normalizeApplicationStatus(stageStatus);
  if (stage !== 'Rejected' && skippedStatuses.includes(stage as ApplicationPipelineStageStatus)) return 'skipped';
  if (isApplicationHiredStatus(normalized) && stageIndex <= current) return 'done';
  if (stage === normalized) return 'current';
  if (stageIndex < current) return 'done';
  return 'pending';
}

export function getApplicationProgressGroupIndex(status: unknown): number {
  const normalized = normalizeApplicationStatus(status);
  if (normalized === 'Rejected') return -1;
  return APPLICATION_PROGRESS_GROUPS.findIndex((group) =>
    group.statuses.some((stageStatus) => stageStatus === normalized),
  );
}

export function getNextApplicationPipelineStatus(status: unknown): ApplicationPipelineStageStatus | null {
  const current = getApplicationStatusIndex(status);
  if (current < 0 || current >= APPLICATION_PIPELINE_STAGES.length - 1) return null;
  return APPLICATION_PIPELINE_STAGES[current + 1].status;
}

export function getLaterApplicationPipelineStatuses(status: unknown, options: { includeNext?: boolean } = {}): ApplicationPipelineStageStatus[] {
  const current = getApplicationStatusIndex(status);
  if (current < 0) return [];
  const start = current + (options.includeNext ? 1 : 2);
  return APPLICATION_PIPELINE_STAGES.slice(start).map((stage) => stage.status);
}

export function getSkippedApplicationStatuses(fromStatus: unknown, toStatus: unknown): ApplicationPipelineStageStatus[] {
  const from = getApplicationStatusIndex(fromStatus);
  const to = getApplicationStatusIndex(toStatus);
  if (from < 0 || to < 0 || to <= from + 1) return [];
  return APPLICATION_PIPELINE_STAGES.slice(from + 1, to).map((stage) => stage.status);
}

export function getApplicationStatusLabelKey(status: unknown): string {
  const normalized = normalizeApplicationStatus(status);
  if (normalized === 'Rejected') return 'applications_status_rejected';
  return STAGE_BY_STATUS.get(normalized)?.labelKey ?? 'applications_status_applied';
}

export function isApplicationRejectedStatus(status: unknown): boolean {
  return normalizeApplicationStatus(status) === 'Rejected';
}

export function isApplicationHiredStatus(status: unknown): boolean {
  return getApplicationStatusGroup(status) === 'hired';
}

export function isApplicationClosedStatus(status: unknown): boolean {
  const group = getApplicationStatusGroup(status);
  return group === 'hired' || group === 'rejected';
}

export function isApplicationInterviewStatus(status: unknown): boolean {
  return getApplicationStatusGroup(status) === 'interview';
}

/**
 * True when the candidate's relationship with the employer is deep enough to review
 * the company: reached the interview, offer, or hired group. Mirrors the server-side
 * write gate in functions/src/handlers/companyReviews.ts.
 */
export function isApplicationReviewEligible(status: unknown): boolean {
  const group = getApplicationStatusGroup(status);
  return group === 'interview' || group === 'offer' || group === 'hired';
}

export function applicationMatchesFilter(status: unknown, filter: ApplicationFilterGroup): boolean {
  if (filter === 'All') return true;
  return getApplicationStatusGroup(status) === filter;
}

export interface ApplicationPipelineStagePlan {
  stage: ApplicationPipelineStage;
  index: number;
  state: ApplicationTimelineStageState;
  skipped: boolean;
  current: boolean;
}

export interface ApplicationProgressGroupPlan {
  group: ApplicationProgressGroup;
  index: number;
  firstIndex: number;
  lastIndex: number;
  state: ApplicationTimelineStageState;
  stages: ApplicationPipelineStagePlan[];
  containsCurrent: boolean;
  fullySkipped: boolean;
  connectorDone: boolean;
}

export interface ApplicationPipelinePlan {
  status: ApplicationPipelineStatus;
  skippedStatuses: ApplicationPipelineStageStatus[];
  currentIndex: number;
  groupIndex: number;
  currentGroup: ApplicationProgressGroup;
  progressPercent: number;
  isRejected: boolean;
  isComplete: boolean;
  stages: ApplicationPipelineStagePlan[];
  groups: ApplicationProgressGroupPlan[];
}

function computeApplicationProgressPercent(status: ApplicationPipelineStatus, groupIndex: number): number {
  if (status === 'Rejected') return 0;
  if (isApplicationHiredStatus(status)) return 100;
  if (groupIndex < 0) return APPLICATION_PHASE_BASE_PERCENT[0];

  const base = APPLICATION_PHASE_BASE_PERCENT[groupIndex] ?? APPLICATION_PHASE_BASE_PERCENT[0];
  const nextBase = groupIndex < APPLICATION_PHASE_BASE_PERCENT.length - 1
    ? APPLICATION_PHASE_BASE_PERCENT[groupIndex + 1]
    : APPLICATION_PHASE_CEIL_PERCENT;
  const group = APPLICATION_PROGRESS_GROUPS[groupIndex];
  const stageInGroup = (group.statuses as readonly string[]).indexOf(status);
  const frac = group.statuses.length > 1 && stageInGroup > 0
    ? Math.min(stageInGroup / group.statuses.length, 0.8)
    : 0;

  return Math.round(base + frac * (nextBase - base));
}

export function buildApplicationPipelinePlan(
  status: unknown,
  skippedValue: unknown = [],
): ApplicationPipelinePlan {
  const normalizedStatus = normalizeApplicationStatus(status);
  const skippedStatuses = normalizeSkippedApplicationStatuses(skippedValue);
  const skippedSet = new Set<ApplicationPipelineStageStatus>(skippedStatuses);
  const currentIndex = getApplicationStatusIndex(normalizedStatus);
  const groupIndex = getApplicationProgressGroupIndex(normalizedStatus);
  const isRejected = normalizedStatus === 'Rejected';
  const isComplete = isApplicationHiredStatus(normalizedStatus);

  const stages = APPLICATION_PIPELINE_STAGES.map((stage, index): ApplicationPipelineStagePlan => {
    const state = getApplicationTimelineStageState(normalizedStatus, stage.status, skippedStatuses);
    return {
      stage,
      index,
      state,
      skipped: skippedSet.has(stage.status),
      current: state === 'current',
    };
  });

  const groups = APPLICATION_PROGRESS_GROUPS.map((group, index): ApplicationProgressGroupPlan => {
    const firstIndex = getApplicationStatusIndex(group.statuses[0]);
    const lastIndex = getApplicationStatusIndex(group.statuses[group.statuses.length - 1]);
    const groupStatusSet = new Set<ApplicationPipelineStageStatus>(group.statuses);
    const groupStages = stages.filter((stage) => groupStatusSet.has(stage.stage.status as ApplicationPipelineStageStatus));
    const containsCurrent = groupStages.some((stage) => stage.current);
    const fullySkipped =
      currentIndex > lastIndex &&
      lastIndex >= 0 &&
      firstIndex >= 0 &&
      groupStages.length > 0 &&
      groupStages.every((stage) => stage.skipped);
    const state: ApplicationTimelineStageState = isRejected
      ? 'closed'
      : fullySkipped
        ? 'skipped'
        : currentIndex > lastIndex || (isComplete && currentIndex >= lastIndex)
          ? 'done'
          : containsCurrent
            ? 'current'
            : 'pending';

    return {
      group,
      index,
      firstIndex,
      lastIndex,
      state,
      stages: groupStages,
      containsCurrent,
      fullySkipped,
      connectorDone: !isRejected && state === 'done' && currentIndex > lastIndex,
    };
  });

  return {
    status: normalizedStatus,
    skippedStatuses,
    currentIndex,
    groupIndex,
    currentGroup: groupIndex >= 0 ? APPLICATION_PROGRESS_GROUPS[groupIndex] : APPLICATION_PROGRESS_GROUPS[0],
    progressPercent: computeApplicationProgressPercent(normalizedStatus, groupIndex),
    isRejected,
    isComplete,
    stages,
    groups,
  };
}
