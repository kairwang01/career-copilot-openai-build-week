import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ApplyReviewModal, { type ApplyReviewJob } from './ApplyReviewModal';
import {
  Briefcase,
  Building2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock3,
  Loader2,
  MapPin,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  RotateCcw,
  Star,
  Target,
  X,
} from 'lucide-react';
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import MarkdownLite, { stripMarkdownLite } from './MarkdownLite';
import { httpsCallable } from 'firebase/functions';
import { firestoreDb, firebaseFunctions } from '../lib/firebaseClient';
import { listAllActiveJobPostings } from '../lib/recruitingData';
import type { JobPosting } from '../lib/recruitingData';
import type { AppSession as Session } from '../lib/data';
import { useToast } from './Toast';
import {
  listCompanyReviewsPage,
  type CompanyReview,
} from '../lib/companyReviewsData';
import {
  prefsSummaryLine,
  useJobPreferences,
  type JobPreferences,
} from '../hooks/useJobPreferences';
import {
  workModeLabelKey,
  employmentTypeLabelKey,
  experienceLevelLabelKey,
} from '../constants/jobPostingFields';

function reviewTierBadge(
  tier: 'hired' | 'offer' | 'interviewed',
  t: (k: string) => string
): { label: string; className: string } {
  switch (tier) {
    case 'hired':
      return { label: t('review_tier_hired'), className: 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-100 dark:border-green-800/50' };
    case 'offer':
      return { label: t('review_tier_offer'), className: 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-800/50' };
    default:
      return { label: t('review_tier_interviewed'), className: 'text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-600' };
  }
}

interface BrowseJobsProps {
  session: Session | null;
  t: (key: string) => string;
  /** Jump to the Talent Profile editor (from the pre-submit review step). */
  onEditProfile?: () => void;
}

const QUICK_SEARCHES = [
  {
    labelKey: 'browse_jobs_quick_software',
    aliases: ['software', 'developer', 'engineer', 'frontend', 'backend', 'full stack'],
  },
  {
    labelKey: 'browse_jobs_quick_product',
    aliases: ['product', 'product manager', 'product owner'],
  },
  {
    labelKey: 'browse_jobs_quick_data',
    aliases: ['data', 'analytics', 'analyst', 'scientist'],
  },
  {
    labelKey: 'browse_jobs_quick_marketing',
    aliases: ['marketing', 'growth', 'content', 'social media'],
  },
  {
    labelKey: 'browse_jobs_quick_remote',
    aliases: ['remote', 'remotely', 'work from home', 'wfh'],
  },
] as const;

type WorkModeFilter = 'all' | 'remote' | 'hybrid' | 'onsite';
type DerivedWorkMode = Exclude<WorkModeFilter, 'all'>;
type ActiveFilterKey = 'keyword' | 'location' | 'workMode' | 'salary' | 'sort';

const COMPANY_REVIEW_PAGE_SIZE = 10;

type ReviewCacheEntry = {
  reviews: CompanyReview[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  nextPage: number | null;
  truncated: boolean;
  status: 'loading' | 'ready' | 'error';
  failedPage: number | null;
};

type ReviewCache = Record<string, ReviewCacheEntry>;

const WORK_MODE_OPTIONS: Array<{ value: WorkModeFilter; labelKey: string }> = [
  { value: 'all', labelKey: 'browse_jobs_work_mode_all' },
  { value: 'remote', labelKey: 'browse_jobs_work_mode_remote' },
  { value: 'hybrid', labelKey: 'browse_jobs_work_mode_hybrid' },
  { value: 'onsite', labelKey: 'browse_jobs_work_mode_onsite' },
];

const WORK_MODE_TOKENS: Record<DerivedWorkMode, string[]> = {
  remote: ['remote', 'remotely', 'work from home', 'wfh', 'teletravail', '远程', 'リモート', 'tu xa'],
  hybrid: ['hybrid', 'hybride', 'mixed', '混合', 'ハイブリッド', 'ket hop'],
  onsite: ['onsite', 'on-site', 'on site', 'office', 'in office', 'vor ort', 'sur site', '现场', '現場', '办公室', '辦公室', '出社', 'オフィス', 'tai van phong'],
};

const normalizeFilterText = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

const tokenizeSearch = (value: string) =>
  normalizeFilterText(value)
    .split(/[\s,;/|]+/)
    .map((token) => token.trim())
    .filter(Boolean);

const splitPreferenceList = (value: string) =>
  value
    .split(/[,;/\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);

const hasFilterablePreferences = (prefs: JobPreferences | null) =>
  !!prefs && [prefs.roles, prefs.locations, prefs.salaryMin].some((value) => value.trim().length > 0);

const buildGoalKeyword = (prefs: JobPreferences | null) => {
  if (!prefs) return '';
  return splitPreferenceList(prefs.roles).join(' ');
};

const findPreferredLocation = (prefs: JobPreferences | null, locations: string[]) => {
  if (!prefs?.locations.trim()) return 'all';
  const desiredLocations = splitPreferenceList(prefs.locations).map(normalizeFilterText);
  if (desiredLocations.length === 0) return 'all';

  return locations.find((location) => {
    const normalizedLocation = normalizeFilterText(location);
    return desiredLocations.some(
      (desired) => normalizedLocation.includes(desired) || desired.includes(normalizedLocation),
    );
  }) ?? 'all';
};

const detectWorkMode = (value: string): WorkModeFilter => {
  const normalized = normalizeFilterText(value);
  if (!normalized) return 'all';
  if (WORK_MODE_TOKENS.remote.some((token) => normalized.includes(token))) return 'remote';
  if (WORK_MODE_TOKENS.hybrid.some((token) => normalized.includes(token))) return 'hybrid';
  if (WORK_MODE_TOKENS.onsite.some((token) => normalized.includes(token))) return 'onsite';
  return 'all';
};

const deriveWorkMode = (job: JobPosting): DerivedWorkMode => {
  const explicitMode = detectWorkMode(`${job.location ?? ''} ${job.description ?? ''}`);
  if (explicitMode !== 'all') return explicitMode;
  return 'onsite';
};

const findPreferredWorkMode = (prefs: JobPreferences | null): WorkModeFilter =>
  prefs ? detectWorkMode(prefs.locations) : 'all';

const isPostedWithinDays = (iso: string, days: number) => {
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return false;
  return Date.now() - timestamp <= days * 86_400_000;
};

// ── skeleton card ──────────────────────────────────────────────────────────────
const SkeletonCard: React.FC = () => (
  <div className="animate-pulse rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
    <div className="mb-3 h-5 w-2/3 rounded bg-slate-200 dark:bg-slate-700" />
    <div className="mb-2 h-3 w-1/3 rounded bg-slate-200 dark:bg-slate-700" />
    <div className="mt-4 space-y-2">
      <div className="h-3 w-full rounded bg-slate-200 dark:bg-slate-700" />
      <div className="h-3 w-5/6 rounded bg-slate-200 dark:bg-slate-700" />
      <div className="h-3 w-4/6 rounded bg-slate-200 dark:bg-slate-700" />
    </div>
  </div>
);

// ── helper: relative posted date (i18n via t) ─────────────────────────────────
const postedLabel = (iso: string, t: (k: string) => string): string => {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return t('browse_jobs_posted_today');
  if (days === 1) return t('browse_jobs_posted_yesterday');
  if (days < 7) return t('browse_jobs_posted_days_ago').replace('{n}', String(days));
  if (days < 30) return t('browse_jobs_posted_weeks_ago').replace('{n}', String(Math.floor(days / 7)));
  return new Date(iso).toLocaleDateString();
};

// ── helper: employer responsiveness badge (anti-ghosting, coarse + honest) ────
// Returns { text, recent } or null when there isn't enough signal to claim anything.
const responsivenessBadge = (
  resp: { avgDays: number | null; lastActionMs: number | null } | null | undefined,
  t: (k: string) => string,
): { text: string; recent: boolean } | null => {
  if (!resp) return null;
  const recent = resp.lastActionMs !== null && Date.now() - resp.lastActionMs < 14 * 86_400_000;
  if (resp.avgDays !== null) {
    return { text: t('browse_jobs_responds_in').replace('{n}', String(Math.max(1, Math.round(resp.avgDays)))), recent };
  }
  if (recent) return { text: t('browse_jobs_active_recently'), recent: true };
  return null;
};

// ── main component ─────────────────────────────────────────────────────────────
const BrowseJobs: React.FC<BrowseJobsProps> = ({ session, t, onEditProfile }) => {
  const { addToast } = useToast();
  const { prefs } = useJobPreferences();

  // ── data state ────────────────────────────────────────────────────────────
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [appliedJobs, setAppliedJobs] = useState<Set<string>>(new Set());
  const [applyingId, setApplyingId] = useState<string | null>(null);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [rawKeyword, setRawKeyword] = useState('');
  const [keyword, setKeyword] = useState('');
  const [locationFilter, setLocationFilter] = useState('all');
  const [workModeFilter, setWorkModeFilter] = useState<WorkModeFilter>('all');
  const [hasSalaryFilter, setHasSalaryFilter] = useState(false);
  const [sortOrder, setSortOrder] = useState<'newest' | 'title_az'>('newest');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Review pages are keyed by employer_id, not job id, and retain the full
  // server pagination state so a failed next page can be retried exactly.
  const [reviewCache, setReviewCache] = useState<ReviewCache>({});
  const reviewCacheRef = useRef<ReviewCache>({});
  const [reviewsExpanded, setReviewsExpanded] = useState<Record<string, boolean>>({});
  const reviewsMountedRef = useRef(true);
  // One request per employer at a time prevents double-click duplicate pages.
  const fetchingReviews = useRef<Set<string>>(new Set());

  // Employer responsiveness badge (anti-ghosting): coarse, backward-looking
  // aggregate derived server-side. Keyed by employer_id, loaded eagerly for the
  // visible jobs so the badge shows on the collapsed card.
  type RespEntry = { avgDays: number | null; lastActionMs: number | null };
  const [respCache, setRespCache] = useState<Record<string, RespEntry>>({});
  const respCacheRef = useRef<Record<string, RespEntry>>({});
  const fetchingResp = useRef<Set<string>>(new Set());

  // Eager rating aggregate per employer, for the always-visible card chip.
  type RatingEntry = { avg: number; count: number };
  const [ratingCache, setRatingCache] = useState<Record<string, RatingEntry>>({});
  const ratingCacheRef = useRef<Record<string, RatingEntry>>({});
  const fetchingRatings = useRef<Set<string>>(new Set());

  // ── debounce keyword ──────────────────────────────────────────────────────
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleKeywordChange = (value: string) => {
    setRawKeyword(value);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => setKeyword(value.trim()), 250);
  };
  useEffect(() => () => { if (debounceTimer.current) clearTimeout(debounceTimer.current); }, []);

  useEffect(() => {
    reviewsMountedRef.current = true;
    return () => {
      reviewsMountedRef.current = false;
    };
  }, []);

  const commitKeyword = (value: string) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    setRawKeyword(value);
    setKeyword(value.trim());
  };

  const clearFilters = () => {
    commitKeyword('');
    setLocationFilter('all');
    setWorkModeFilter('all');
    setHasSalaryFilter(false);
    setSortOrder('newest');
    setExpandedId(null);
    setFiltersOpen(false);
  };

  // ── fetch jobs on mount (ONCE — no reactive deps; a translated generic
  //    message is rendered, so `t` stays out of the deps) ────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setFetchError(false);
      try {
        const data = await listAllActiveJobPostings();
        if (!cancelled) setJobs(data);
      } catch {
        if (!cancelled) setFetchError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── fetch already-applied jobs for current user ───────────────────────────
  const sessionUserId = session?.user?.id ?? null;
  useEffect(() => {
    if (!sessionUserId) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(firestoreDb, 'job_applications'), where('candidate_id', '==', sessionUserId)),
        );
        if (!cancelled) {
          setAppliedJobs(new Set(snap.docs.map((d) => d.data().job_id as string)));
        }
      } catch {
        // non-fatal
      }
    })();
    return () => { cancelled = true; };
  }, [sessionUserId]);

  const loadReviewPage = useCallback(async (eid: string, pageNumber: number) => {
    if (fetchingReviews.current.has(eid)) return;

    const current = reviewCacheRef.current[eid];
    if (pageNumber === 0 && current?.status === 'ready') return;
    if (
      pageNumber > 0
      && current?.nextPage !== pageNumber
      && current?.failedPage !== pageNumber
    ) return;

    fetchingReviews.current.add(eid);
    const loadingEntry: ReviewCacheEntry = current
      ? { ...current, status: 'loading', failedPage: null }
      : {
          reviews: [],
          page: -1,
          pageSize: COMPANY_REVIEW_PAGE_SIZE,
          hasMore: false,
          nextPage: 0,
          truncated: false,
          status: 'loading',
          failedPage: null,
        };
    reviewCacheRef.current = { ...reviewCacheRef.current, [eid]: loadingEntry };
    if (reviewsMountedRef.current) {
      setReviewCache((prev) => ({ ...prev, [eid]: loadingEntry }));
    }

    try {
      const page = await listCompanyReviewsPage(eid, {
        page: pageNumber,
        pageSize: COMPANY_REVIEW_PAGE_SIZE,
      });
      if (!reviewsMountedRef.current) return;

      const latest = reviewCacheRef.current[eid];
      const entry: ReviewCacheEntry = {
        reviews: pageNumber === 0
          ? page.reviews
          : [...(latest?.reviews ?? []), ...page.reviews],
        page: page.page,
        pageSize: page.pageSize,
        hasMore: page.hasMore,
        nextPage: page.nextPage,
        truncated: page.truncated,
        status: 'ready',
        failedPage: null,
      };
      reviewCacheRef.current = { ...reviewCacheRef.current, [eid]: entry };
      setReviewCache((prev) => ({ ...prev, [eid]: entry }));
    } catch {
      if (!reviewsMountedRef.current) return;

      const latest = reviewCacheRef.current[eid] ?? loadingEntry;
      const entry: ReviewCacheEntry = {
        ...latest,
        status: 'error',
        failedPage: pageNumber,
      };
      reviewCacheRef.current = { ...reviewCacheRef.current, [eid]: entry };
      setReviewCache((prev) => ({ ...prev, [eid]: entry }));
    } finally {
      fetchingReviews.current.delete(eid);
    }
  }, []);

  // Load the bounded first page when a job card opens. Requests may finish after
  // switching cards and safely populate the employer cache for the next visit.
  useEffect(() => {
    if (!expandedId) return;
    const job = jobs.find((candidate) => candidate.id === expandedId);
    const eid = job?.employer_id;
    if (!eid || reviewCacheRef.current[eid] !== undefined) return;
    void loadReviewPage(eid, 0);
  }, [expandedId, jobs, loadReviewPage]);

  // ── eager-load employer responsiveness for the visible jobs ─────────────────
  // Both aggregate docs are keyed by employer id, so chunked `documentId() in`
  // queries replace the per-employer getDoc fan-out: one read per ≤10 employers
  // instead of N round-trips every time the job list changes.
  useEffect(() => {
    let cancelled = false;
    const eids = Array.from(new Set(jobs.map((j) => j.employer_id).filter((e): e is string => !!e)))
      .filter((eid) => respCacheRef.current[eid] === undefined && !fetchingResp.current.has(eid));
    if (!eids.length) return;
    eids.forEach((eid) => fetchingResp.current.add(eid));
    (async () => {
      try {
        for (let i = 0; i < eids.length; i += 10) {
          const chunk = eids.slice(i, i + 10);
          const found: Record<string, RespEntry> = {};
          try {
            const snap = await getDocs(query(
              collection(firestoreDb, 'employer_responsiveness'),
              where(documentId(), 'in', chunk),
            ));
            snap.forEach((docSnap) => {
              const d = docSnap.data();
              const count = typeof d?.count === 'number' ? d.count : 0;
              const sum = typeof d?.sum_days === 'number' ? d.sum_days : 0;
              const lastMs = d?.last_action_at?.toMillis?.() ?? null;
              found[docSnap.id] = { avgDays: count >= 3 ? sum / count : null, lastActionMs: lastMs };
            });
          } catch {
            // non-fatal — every id in the chunk falls back to the empty entry below
          }
          if (cancelled) return;
          const entries: Record<string, RespEntry> = {};
          chunk.forEach((eid) => { entries[eid] = found[eid] ?? { avgDays: null, lastActionMs: null }; });
          respCacheRef.current = { ...respCacheRef.current, ...entries };
          setRespCache((prev) => ({ ...prev, ...entries }));
        }
      } finally {
        eids.forEach((eid) => fetchingResp.current.delete(eid));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobs]);

  // ── eager-load company rating aggregate for the visible jobs ────────────────
  // Same chunked `documentId() in` pattern as the responsiveness loader above
  // (mirrors lib getEmployerRating's normalization for each returned doc).
  useEffect(() => {
    let cancelled = false;
    const eids = Array.from(new Set(jobs.map((j) => j.employer_id).filter((e): e is string => !!e)))
      .filter((eid) => ratingCacheRef.current[eid] === undefined && !fetchingRatings.current.has(eid));
    if (!eids.length) return;
    eids.forEach((eid) => fetchingRatings.current.add(eid));
    (async () => {
      try {
        for (let i = 0; i < eids.length; i += 10) {
          const chunk = eids.slice(i, i + 10);
          const found: Record<string, { avg: number; count: number }> = {};
          try {
            const snap = await getDocs(query(
              collection(firestoreDb, 'employer_rating'),
              where(documentId(), 'in', chunk),
            ));
            snap.forEach((docSnap) => {
              const d = docSnap.data();
              found[docSnap.id] = {
                avg: typeof d?.avg === 'number' ? d.avg : 0,
                count: typeof d?.count === 'number' ? d.count : 0,
              };
            });
          } catch {
            // Do not present a failed aggregate read as an exact zero-review result.
            continue;
          }
          if (cancelled) return;
          const entries: Record<string, { avg: number; count: number }> = {};
          chunk.forEach((eid) => { entries[eid] = found[eid] ?? { avg: 0, count: 0 }; });
          ratingCacheRef.current = { ...ratingCacheRef.current, ...entries };
          setRatingCache((prev) => ({ ...prev, ...entries }));
        }
      } finally {
        eids.forEach((eid) => fetchingRatings.current.delete(eid));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobs]);

  // ── distinct locations ────────────────────────────────────────────────────
  const locations = useMemo(() => {
    const seen = new Set<string>();
    jobs.forEach((j) => { if (j.location) seen.add(j.location); });
    return Array.from(seen).sort();
  }, [jobs]);

  const quickSearchAliasMap = useMemo(() => {
    const aliases = new Map<string, readonly string[]>();
    QUICK_SEARCHES.forEach((search) => {
      const normalizedAliases = search.aliases.map(normalizeFilterText);
      aliases.set(normalizeFilterText(t(search.labelKey)), normalizedAliases);
      normalizedAliases.forEach((alias) => aliases.set(alias, normalizedAliases));
    });
    return aliases;
  }, [t]);

  // ── filtered + sorted results ─────────────────────────────────────────────
  const filtered = useMemo(() => {
    const normalizedKeyword = normalizeFilterText(keyword);
    const quickSearchAliases = quickSearchAliasMap.get(normalizedKeyword);
    const keywordTokens = quickSearchAliases ? [] : tokenizeSearch(keyword);
    return jobs
      .filter((j) => {
        const searchable = [
          j.title,
          j.company_name,
          j.location,
          j.salary_range,
          j.description,
        ].filter(Boolean).join(' ');
        const normalizedSearchable = normalizeFilterText(searchable);
        if (
          quickSearchAliases &&
          !quickSearchAliases.some((alias) => normalizedSearchable.includes(alias))
        ) {
          return false;
        }
        if (
          keywordTokens.length > 0 &&
          !keywordTokens.every((token) => normalizedSearchable.includes(token))
        ) {
          return false;
        }
        if (locationFilter !== 'all' && j.location !== locationFilter) return false;
        if (workModeFilter !== 'all' && deriveWorkMode(j) !== workModeFilter) return false;
        if (hasSalaryFilter && !j.salary_range) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortOrder === 'title_az') return a.title.localeCompare(b.title);
        // newest: already sorted by created_at desc from fetch; resort to be safe
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [jobs, keyword, quickSearchAliasMap, locationFilter, workModeFilter, hasSalaryFilter, sortOrder]);
  const hasActiveFilters = keyword !== '' || locationFilter !== 'all' || workModeFilter !== 'all' || hasSalaryFilter || sortOrder !== 'newest';
  const summaryMetrics = useMemo(() => {
    const withSalary = filtered.filter((job) => Boolean(job.salary_range)).length;
    const flexible = filtered.filter((job) => {
      const mode = deriveWorkMode(job);
      return mode === 'remote' || mode === 'hybrid';
    }).length;
    const recent = filtered.filter((job) => isPostedWithinDays(job.created_at, 7)).length;
    return [
      {
        label: t('browse_jobs_summary_matching'),
        value: filtered.length,
        detail: hasActiveFilters
          ? t('browse_jobs_summary_filtered')
          : t('browse_jobs_summary_all_open'),
      },
      {
        label: t('browse_jobs_summary_salary'),
        value: withSalary,
        detail: t('browse_jobs_summary_salary_desc'),
      },
      {
        label: t('browse_jobs_summary_flexible'),
        value: flexible,
        detail: t('browse_jobs_summary_flexible_desc'),
      },
      {
        label: t('browse_jobs_summary_recent'),
        value: recent,
        detail: t('browse_jobs_summary_recent_desc'),
      },
    ];
  }, [filtered, hasActiveFilters, t]);
  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: ActiveFilterKey; label: string }> = [];
    if (keyword) {
      chips.push({
        key: 'keyword',
        label: t('browse_jobs_filter_keyword').replace('{value}', keyword),
      });
    }
    if (locationFilter !== 'all') {
      chips.push({
        key: 'location',
        label: t('browse_jobs_filter_location').replace('{value}', locationFilter),
      });
    }
    if (workModeFilter !== 'all') {
      chips.push({
        key: 'workMode',
        label: t('browse_jobs_filter_work_mode').replace('{value}', t(`browse_jobs_work_mode_${workModeFilter}`)),
      });
    }
    if (hasSalaryFilter) {
      chips.push({
        key: 'salary',
        label: t('browse_jobs_filter_salary'),
      });
    }
    if (sortOrder !== 'newest') {
      chips.push({
        key: 'sort',
        label: t('browse_jobs_filter_sort').replace('{value}', t('browse_jobs_sort_az')),
      });
    }
    return chips;
  }, [hasSalaryFilter, keyword, locationFilter, sortOrder, t, workModeFilter]);
  const filterPanelId = 'browse-jobs-filter-panel';
  const hasSavedGoals = hasFilterablePreferences(prefs);
  const goalKeyword = buildGoalKeyword(prefs);
  const goalLocation = findPreferredLocation(prefs, locations);
  const goalWorkMode = findPreferredWorkMode(prefs);
  const goalSummary = prefs ? prefsSummaryLine(prefs) : '';
  const goalSalaryFilter = !!prefs?.salaryMin.trim();
  const goalsApplied =
    hasSavedGoals &&
    normalizeFilterText(keyword) === normalizeFilterText(goalKeyword) &&
    locationFilter === goalLocation &&
    workModeFilter === goalWorkMode &&
    hasSalaryFilter === goalSalaryFilter;

  const applySavedGoals = () => {
    if (!prefs) return;
    commitKeyword(goalKeyword);
    setLocationFilter(goalLocation);
    setWorkModeFilter(goalWorkMode);
    setHasSalaryFilter(goalSalaryFilter);
    setSortOrder('newest');
    setExpandedId(null);
    setFiltersOpen(false);
  };

  const removeFilter = (filter: ActiveFilterKey) => {
    if (filter === 'keyword') commitKeyword('');
    if (filter === 'location') setLocationFilter('all');
    if (filter === 'workMode') setWorkModeFilter('all');
    if (filter === 'salary') setHasSalaryFilter(false);
    if (filter === 'sort') setSortOrder('newest');
    setExpandedId(null);
  };

  // ── apply handler ─────────────────────────────────────────────────────────
  // Ref guard catches double-clicks that land before React re-renders with the
  // disabled state (state updates are async; the ref flips synchronously).
  const applyInFlight = useRef<string | null>(null);
  const [reviewJob, setReviewJob] = useState<ApplyReviewJob | null>(null);

  // Step 1 — open the pre-submit review. The candidate confirms exactly what the
  // employer will receive (name, resume, Talent Profile) before anything is sent.
  const openApplyReview = useCallback((job: JobPosting) => {
    if (!session?.user) {
      addToast(t('browse_jobs_sign_in_to_apply'), 'error');
      return;
    }
    if (appliedJobs.has(job.id)) return;
    setReviewJob({
      id: job.id,
      title: job.title,
      company: job.company_name ?? undefined,
      requiredSkills: job.required_skills,
      experienceLevel: job.experience_level,
      workMode: job.work_mode,
      screenerQuestions: job.screener_questions,
    });
  }, [session, appliedJobs, addToast, t]);

  // Step 2 — actually submit, only after the candidate confirms in the modal.
  // The server re-enforces the ready-Talent-Profile precondition (bypass-safe).
  const confirmApply = useCallback(async (answers: { questionId: string; answer: string }[]) => {
    if (!session?.user || !reviewJob) return;
    const jobId = reviewJob.id;
    if (appliedJobs.has(jobId) || applyInFlight.current === jobId) return;
    applyInFlight.current = jobId;
    setApplyingId(jobId);
    try {
      const createJobApplication = httpsCallable(firebaseFunctions, 'createJobApplication');
      await createJobApplication({ jobId, compatibilityScore: null, screenerAnswers: answers });
      setAppliedJobs((prev) => new Set(prev).add(jobId));
      addToast(t('browse_jobs_apply_success'), 'success');
      setReviewJob(null);
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      if (code === 'functions/already-exists') {
        setAppliedJobs((prev) => new Set(prev).add(jobId));
        addToast(t('browse_jobs_application_recorded'), 'info');
        setReviewJob(null);
      } else if (code === 'functions/failed-precondition') {
        // The modal pre-gates profile + resume, so the reachable precondition
        // here is the job having closed. Distinguish by the server message.
        const msg = (err as { message?: string })?.message ?? '';
        if (/profile|resume/i.test(msg)) {
          addToast(t('apply_complete_profile_first'), 'info'); // keep modal open to fix
        } else {
          addToast(t('apply_job_closed'), 'info');
          setReviewJob(null); // job closed — nothing to retry
        }
      } else {
        addToast(t('browse_jobs_apply_error'), 'error'); // keep modal open to retry
      }
    } finally {
      applyInFlight.current = null;
      setApplyingId(null);
    }
  }, [session, reviewJob, appliedJobs, addToast, t]);

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <section className="space-y-5">
      {/* section header */}
      <div className="flex items-center gap-2">
        <Briefcase className="h-5 w-5 text-blue-600 dark:text-blue-400" />
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {t('browse_jobs_title')}
        </h2>
      </div>

      {/* search + filters */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm space-y-4">
        {/* search bar */}
        <div className="relative">
          <label htmlFor="browse-jobs-search" className="sr-only">
            {t('browse_jobs_search_ph')}
          </label>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-slate-500 pointer-events-none" />
          <input
            id="browse-jobs-search"
            type="text"
            value={rawKeyword}
            onChange={(e) => handleKeywordChange(e.target.value)}
            placeholder={t('browse_jobs_search_ph')}
            disabled={loading}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 pl-9 pr-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:border-blue-400 dark:focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40 transition disabled:opacity-60 disabled:cursor-wait"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="basis-full text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 sm:basis-auto">
            {t('browse_jobs_popular_searches')}
          </span>
          {QUICK_SEARCHES.map(({ labelKey, aliases }) => {
            const label = t(labelKey);
            const normalizedKeyword = normalizeFilterText(keyword);
            const active =
              normalizedKeyword === normalizeFilterText(label) ||
              aliases.some((alias) => normalizedKeyword === normalizeFilterText(alias));
            return (
              <button
                key={labelKey}
                type="button"
                onClick={() => commitKeyword(label)}
                disabled={loading}
                aria-pressed={active}
                aria-label={t('browse_jobs_quick_search_aria').replace('{label}', label)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors disabled:cursor-wait disabled:opacity-60 ${
                  active
                    ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-900/30 dark:text-blue-300'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-blue-800 dark:hover:bg-blue-900/20 dark:hover:text-blue-300'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {hasSavedGoals && (
          <div className="animate-panel-expand rounded-lg border border-blue-100 bg-blue-50/80 p-3 dark:border-blue-900/50 dark:bg-blue-900/20">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-blue-900 dark:text-blue-200">
                  <Target className="h-4 w-4 shrink-0" />
                  {t('browse_jobs_goal_filter_title')}
                </div>
                <p className="mt-1 text-sm leading-relaxed text-blue-800 dark:text-blue-300">
                  {goalSummary
                    ? t('browse_jobs_goal_filter_summary').replace('{summary}', goalSummary)
                    : t('browse_jobs_goal_filter_desc')}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {goalsApplied && (
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-900/30 dark:text-emerald-300">
                    {t('browse_jobs_goal_filter_active')}
                  </span>
                )}
                <button
                  type="button"
                  onClick={applySavedGoals}
                  disabled={goalsApplied || loading}
                  className="inline-flex min-h-[34px] items-center justify-center rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-default disabled:bg-blue-300 disabled:text-white/90 dark:disabled:bg-blue-900/60"
                >
                  {t('browse_jobs_goal_filter_apply')}
                </button>
              </div>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
          aria-controls={filterPanelId}
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 text-left text-sm font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-blue-800 dark:hover:bg-blue-900/20 lg:hidden"
        >
          <span className="inline-flex min-w-0 items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
            <span className="truncate">{t('browse_jobs_filters_label')}</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-2">
            {activeFilterChips.length > 0 && (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700 dark:bg-blue-900/40 dark:text-blue-200">
                {activeFilterChips.length}
              </span>
            )}
            <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
          </span>
        </button>

        {/* filter row */}
        <div
          id={filterPanelId}
          className={`${filtersOpen ? 'flex' : 'hidden'} flex-col gap-3 rounded-lg border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-700/70 dark:bg-slate-900/50 lg:flex lg:flex-row lg:items-start lg:justify-between lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:dark:bg-transparent`}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
            <div className="hidden items-center gap-2 lg:flex">
              <SlidersHorizontal className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                {t('browse_jobs_filters_label')}
              </span>
            </div>

            {/* location */}
            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              aria-label={t('browse_jobs_all_locations')}
              disabled={loading}
              className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-wait disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:focus:border-blue-500 dark:focus:ring-blue-900/40 sm:min-w-[150px] lg:w-auto"
            >
              <option value="all">{t('browse_jobs_all_locations')}</option>
              {locations.map((loc) => (
                <option key={loc} value={loc}>{loc}</option>
              ))}
            </select>

            {/* has salary */}
            <label className="flex min-h-10 cursor-pointer select-none items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              <input
                type="checkbox"
                checked={hasSalaryFilter}
                onChange={(e) => setHasSalaryFilter(e.target.checked)}
                disabled={loading}
                className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-wait"
              />
              {t('browse_jobs_has_salary')}
            </label>

            {/* work mode */}
            <div
              className="sm:col-span-2 flex flex-wrap items-center gap-1.5"
              role="group"
              aria-label={t('browse_jobs_work_mode_label')}
            >
              <span className="w-full text-xs font-semibold text-slate-500 dark:text-slate-400 sm:w-auto">
                {t('browse_jobs_work_mode_label')}
              </span>
              {WORK_MODE_OPTIONS.map((option) => {
                const active = workModeFilter === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setWorkModeFilter(option.value)}
                    disabled={loading}
                    aria-pressed={active}
                    className={`inline-flex min-h-[32px] items-center justify-center rounded-full border px-3 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400/30 disabled:cursor-wait disabled:opacity-60 ${
                      active
                        ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-900/30 dark:text-blue-300'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-blue-800 dark:hover:bg-blue-900/20 dark:hover:text-blue-300'
                    }`}
                  >
                    {t(option.labelKey)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            {/* sort */}
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as 'newest' | 'title_az')}
              aria-label={t('browse_jobs_sort_label')}
              disabled={loading}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-wait disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:focus:border-blue-500 dark:focus:ring-blue-900/40"
            >
              <option value="newest">{t('browse_jobs_sort_newest')}</option>
              <option value="title_az">{t('browse_jobs_sort_az')}</option>
            </select>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-blue-800 dark:hover:bg-blue-900/20 dark:hover:text-blue-300"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t('browse_jobs_clear_filters')}
              </button>
            )}
          </div>
        </div>

        {activeFilterChips.length > 0 && (
          <div className="animate-panel-expand rounded-lg border border-blue-100 bg-blue-50/70 p-3 dark:border-blue-900/50 dark:bg-blue-950/20">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
                {t('browse_jobs_active_filters')}
              </p>
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex w-fit items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-900/40"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t('browse_jobs_clear_filters')}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {activeFilterChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => removeFilter(chip.key)}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-blue-100 bg-white px-2.5 py-1 text-xs font-semibold text-blue-900 transition-colors hover:border-blue-200 hover:bg-blue-50 dark:border-blue-900/60 dark:bg-slate-900 dark:text-blue-200 dark:hover:bg-blue-950/50"
                  aria-label={t('browse_jobs_remove_filter').replace('{label}', chip.label)}
                >
                  <span>{chip.label}</span>
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* result count */}
      {!loading && !fetchError && (
        <div aria-live="polite" className="animate-panel-expand rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {filtered.length === 0
                  ? t('browse_jobs_no_results')
                  : t('browse_jobs_result_count').replace('{n}', String(filtered.length))}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                {hasActiveFilters ? t('browse_jobs_summary_filtered_desc') : t('browse_jobs_summary_all_desc')}
              </p>
            </div>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-blue-800 dark:hover:bg-blue-900/20 dark:hover:text-blue-300 sm:w-auto"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t('browse_jobs_clear_filters')}
              </button>
            )}
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {summaryMetrics.map((metric) => (
              <div
                key={metric.label}
                className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/60"
              >
                <p className="text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                  {metric.value}
                </p>
                <p className="mt-0.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {metric.label}
                </p>
                <p className="mt-1 text-[11px] leading-4 text-slate-500 dark:text-slate-500">
                  {metric.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* signed-out hint */}
      {!session && !loading && jobs.length > 0 && (
        <div className="rounded-lg border border-blue-100 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-900/20 px-4 py-3 text-sm text-blue-800 dark:text-blue-300">
          {t('browse_jobs_signin_hint')}
        </div>
      )}

      {/* fetch error */}
      {fetchError && (
        <div className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {t('browse_jobs_fetch_error')}
        </div>
      )}

      {/* loading skeletons */}
      {loading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* empty state (no postings at all) */}
      {!loading && !fetchError && jobs.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 p-10 text-center">
          <Briefcase className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
          <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-slate-100">
            {t('browse_jobs_empty_title')}
          </h3>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {t('browse_jobs_empty_desc')}
          </p>
        </div>
      )}

      {/* empty state (has postings but no matches) */}
      {!loading && !fetchError && jobs.length > 0 && filtered.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 p-10 text-center">
          <Search className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
          <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-slate-100">
            {t('browse_jobs_no_match_title')}
          </h3>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {t('browse_jobs_no_match_desc')}
          </p>
          <button
            type="button"
            onClick={clearFilters}
            className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800"
          >
            <RotateCcw className="h-4 w-4" />
            {t('browse_jobs_clear_filters')}
          </button>
        </div>
      )}

      {/* job cards */}
      {!loading && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((job) => {
            const isExpanded = expandedId === job.id;
            const isApplied = appliedJobs.has(job.id);
            const isApplying = applyingId === job.id;
            const detailsId = `job-details-${job.id}`;
            const workMode = deriveWorkMode(job);

            const eid = job.employer_id;
            const reviewsId = eid ? `job-reviews-${job.id}` : undefined;
            const employerReviews = eid ? (reviewCache[eid] ?? null) : null;
            const employerRating = eid ? (ratingCache[eid] ?? null) : null;
            const respBadge = responsivenessBadge(eid ? respCache[eid] : null, t);
            const reviewsOpen = eid ? (reviewsExpanded[eid] ?? false) : false;
            const showReviewsSection = Boolean(
              employerReviews
              && (
                employerReviews.status === 'error'
                || employerReviews.reviews.length > 0
                || (employerRating?.count ?? 0) > 0
              ),
            );
            const nextReviewCount = employerReviews
              ? employerRating && employerRating.count > employerReviews.reviews.length
                ? Math.min(
                    employerReviews.pageSize,
                    employerRating.count - employerReviews.reviews.length,
                  )
                : employerReviews.pageSize
              : COMPANY_REVIEW_PAGE_SIZE;

            return (
              <article
                key={job.id}
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm transition duration-200 hover:shadow-md hover:border-blue-200 dark:hover:border-blue-800/60"
              >
                {/* card header — always visible */}
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : job.id)}
                  aria-expanded={isExpanded}
                  aria-controls={detailsId}
                  aria-label={t('browse_jobs_toggle_details_aria').replace('{title}', job.title)}
                  className="w-full text-left px-5 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                          {job.title}
                        </h3>
                        {/* Company name — muted, shown when snapshotted on the posting */}
                        {job.company_name && (
                          <span className="text-xs text-slate-500 dark:text-slate-400 font-normal">
                            {job.company_name}
                          </span>
                        )}
                        {job.organization_verification !== 'verified' && (
                          <span
                            title={t('browse_jobs_org_unverified')}
                            className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200"
                          >
                            <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                            {t('browse_jobs_org_unverified')}
                          </span>
                        )}
                        {/* Rating chip — always shown once the aggregate loads */}
                        {employerRating && (
                          employerRating.count > 0 ? (
                            <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700/50 rounded-full px-2 py-0.5 whitespace-nowrap">
                              <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                              {employerRating.avg.toFixed(1)}&nbsp;({employerRating.count})
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-slate-400 dark:text-slate-500 whitespace-nowrap">
                              <Star className="h-3 w-3" />
                              {t('browse_jobs_no_reviews')}
                            </span>
                          )
                        )}
                        {/* Responsiveness badge — coarse, honest, anti-ghosting */}
                        {respBadge && (
                          <span
                            title={t('browse_jobs_responsiveness_hint')}
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${
                              respBadge.recent
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700/50 dark:bg-emerald-900/20 dark:text-emerald-300'
                                : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            <Clock3 className="h-3 w-3" />
                            {respBadge.text}
                          </span>
                        )}
                        {isApplied && (
                          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                            {t('browse_jobs_applied')}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        {job.location && (
                          <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                            <MapPin className="h-3 w-3 shrink-0" />
                            {job.location}
                          </span>
                        )}
                        <span className="text-xs text-slate-400 dark:text-slate-500">
                          {postedLabel(job.created_at, t)}
                        </span>
                        <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                          {t(`browse_jobs_work_mode_${workMode}`)}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-900/20 dark:text-emerald-300">
                          <Clock3 className="h-3 w-3" />
                          {t('browse_jobs_status_active')}
                        </span>
                      </div>
                      {/* Company context — snapshot from the employer profile, shown
                          only for the fields the employer actually filled in. */}
                      {(job.industry || job.company_size || job.founded_year) && (
                        <div className="mt-1.5 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                          <Building2 className="h-3 w-3 shrink-0" />
                          <span className="min-w-0 truncate">
                            {[
                              job.industry,
                              job.company_size && t('browse_jobs_company_size').replace('{size}', job.company_size),
                              job.founded_year && t('browse_jobs_founded').replace('{year}', job.founded_year),
                            ].filter(Boolean).join(' · ')}
                          </span>
                        </div>
                      )}
                    </div>
                    {/* Salary sits top-right next to the chevron — the first thing a
                        candidate scans for on a job card. */}
                    <div className="flex items-center gap-3 shrink-0">
                      {job.salary_range && (
                        <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                          {job.salary_range}
                        </span>
                      )}
                      {isExpanded
                        ? <ChevronUp className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
                        : <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
                      }
                    </div>
                  </div>

                  {/* description preview (3-line clamp) — hidden when expanded.
                      Markdown syntax is stripped so the clamp shows prose, not "## Role Overview". */}
                  {!isExpanded && job.description && (
                    <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400 line-clamp-3">
                      {stripMarkdownLite(job.description)}
                    </p>
                  )}
                  {!isExpanded && (
                    <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 dark:text-blue-400">
                      {t('browse_jobs_view_details')}
                      <ChevronRight className="h-3.5 w-3.5" />
                    </span>
                  )}
                </button>

                {/* expanded content */}
                {isExpanded && (
                  <div id={detailsId} className="animate-panel-expand border-t border-slate-100 dark:border-slate-700 px-5 pb-5 pt-4">
                    {job.description && (
                      // AI-generated descriptions arrive as Markdown (## headings,
                      // **bold**, bullet lists) — render it instead of showing raw syntax.
                      <MarkdownLite text={job.description} />
                    )}

                    {/* ── Structured posting fields ── rendered only when the
                        employer filled them in (legacy postings skip every row). */}
                    {(() => {
                      const pills: React.ReactNode[] = [];
                      if (job.work_mode) {
                        pills.push(
                          <span key="work_mode" className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                            {t(workModeLabelKey(job.work_mode))}
                          </span>,
                        );
                      }
                      if (job.employment_type) {
                        pills.push(
                          <span key="employment_type" className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                            {t(employmentTypeLabelKey(job.employment_type))}
                          </span>,
                        );
                      }
                      if (job.experience_level) {
                        pills.push(
                          <span key="experience_level" className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                            {t(experienceLevelLabelKey(job.experience_level))}
                          </span>,
                        );
                      }
                      if (job.campus_new_grad) {
                        pills.push(
                          <span key="campus_new_grad" className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 dark:border-indigo-800/50 dark:bg-indigo-900/20 dark:text-indigo-300">
                            {t('job_field_campus_new_grad')}
                          </span>,
                        );
                      }

                      const facts: Array<{ key: string; label: string; value: string }> = [];
                      if (job.department) {
                        facts.push({ key: 'department', label: t('job_field_department'), value: job.department });
                      }
                      if (job.application_deadline) {
                        facts.push({ key: 'application_deadline', label: t('job_field_application_deadline'), value: job.application_deadline });
                      }
                      if (typeof job.headcount === 'number') {
                        facts.push({ key: 'headcount', label: t('job_field_headcount'), value: String(job.headcount) });
                      }
                      if (job.language_requirement) {
                        facts.push({ key: 'language_requirement', label: t('job_field_language_requirement'), value: job.language_requirement });
                      }

                      const blocks: Array<{ key: string; label: string; value: string }> = [];
                      if (job.responsibilities) {
                        blocks.push({ key: 'responsibilities', label: t('job_field_responsibilities'), value: job.responsibilities });
                      }
                      if (job.required_qualifications) {
                        blocks.push({ key: 'required_qualifications', label: t('job_field_required_qualifications'), value: job.required_qualifications });
                      }
                      if (job.nice_to_have_qualifications) {
                        blocks.push({ key: 'nice_to_have', label: t('job_field_nice_to_have'), value: job.nice_to_have_qualifications });
                      }
                      if (job.interview_process) {
                        blocks.push({ key: 'interview_process', label: t('job_field_interview_process'), value: job.interview_process });
                      }

                      const skillRows: Array<{ key: string; label: string; skills: string[] }> = [];
                      if (job.required_skills && job.required_skills.length > 0) {
                        skillRows.push({ key: 'required_skills', label: t('job_field_required_skills'), skills: job.required_skills });
                      }
                      if (job.preferred_skills && job.preferred_skills.length > 0) {
                        skillRows.push({ key: 'preferred_skills', label: t('job_field_preferred_skills'), skills: job.preferred_skills });
                      }

                      const notePills: React.ReactNode[] = [];
                      if (job.visa_sponsorship) {
                        notePills.push(
                          <span key="visa_sponsorship" className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-900/20 dark:text-emerald-300">
                            {t('job_field_visa_sponsorship')}
                          </span>,
                        );
                      }
                      if (job.relocation) {
                        notePills.push(
                          <span key="relocation" className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-900/20 dark:text-emerald-300">
                            {t('job_field_relocation')}
                          </span>,
                        );
                      }

                      const hasAnything =
                        pills.length > 0 ||
                        facts.length > 0 ||
                        blocks.length > 0 ||
                        skillRows.length > 0 ||
                        notePills.length > 0;
                      if (!hasAnything) return null;

                      return (
                        <div className="mt-4 space-y-4">
                          {(pills.length > 0 || notePills.length > 0) && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              {pills}
                              {notePills}
                            </div>
                          )}

                          {facts.length > 0 && (
                            <div className="grid gap-2 sm:grid-cols-2">
                              {facts.map((fact) => (
                                <div key={fact.key} className="text-xs">
                                  <span className="font-semibold text-slate-500 dark:text-slate-400">{fact.label}: </span>
                                  <span className="text-slate-700 dark:text-slate-300">{fact.value}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {skillRows.map((row) => (
                            <div key={row.key}>
                              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                {row.label}
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {row.skills.map((skill, idx) => (
                                  <span
                                    key={`${row.key}-${idx}`}
                                    className="inline-flex items-center rounded-full border border-blue-100 bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-300"
                                  >
                                    {skill}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}

                          {blocks.map((block) => (
                            <div key={block.key}>
                              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                {block.label}
                              </p>
                              <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-line">
                                {block.value}
                              </p>
                            </div>
                          ))}
                        </div>
                      );
                    })()}

                    <div className="mt-4 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/70 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {isApplied ? t('browse_jobs_application_recorded') : t('browse_jobs_direct_apply_title')}
                        </p>
                        <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                          {isApplied ? t('browse_jobs_track_in_applications') : t('browse_jobs_direct_apply_hint')}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={isApplied || isApplying}
                        onClick={() => openApplyReview(job)}
                        aria-busy={isApplying}
                        aria-label={
                          isApplied
                            ? t('browse_jobs_applied_aria').replace('{title}', job.title)
                            : t('browse_jobs_apply_aria').replace('{title}', job.title)
                        }
                        className={`inline-flex min-h-[38px] shrink-0 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition ${
                          isApplied
                            ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 cursor-default'
                            : isApplying
                              ? 'bg-blue-600 dark:bg-blue-700 text-white opacity-70 cursor-wait'
                              : 'bg-blue-700 dark:bg-blue-600 text-white hover:bg-blue-800 dark:hover:bg-blue-700'
                        }`}
                      >
                        {isApplying && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                        )}
                        {isApplied
                          ? t('browse_jobs_applied')
                          : isApplying
                            ? t('browse_jobs_applying')
                            : t('browse_jobs_apply')}
                      </button>
                    </div>

                    {/* Keep first-page loading distinct from a real empty result. */}
                    {eid && (
                      employerReviews === null
                      || (employerReviews.status === 'loading' && employerReviews.reviews.length === 0)
                    ) && (
                      <div className="mt-5 border-t border-slate-100 dark:border-slate-700 pt-4">
                        <div
                          role="status"
                          className="flex min-h-11 items-center gap-2 text-sm text-slate-500 dark:text-slate-400"
                        >
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          {t('app_loading')}
                        </div>
                      </div>
                    )}

                    {/* ── Reviews section ── */}
                    {showReviewsSection && employerReviews && (
                      <div className="mt-5 border-t border-slate-100 dark:border-slate-700 pt-4">
                        {/* Collapsible header */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!eid) return;
                            setReviewsExpanded((prev) => ({ ...prev, [eid]: !prev[eid] }));
                          }}
                          aria-expanded={reviewsOpen}
                          aria-controls={reviewsId}
                          className="flex min-h-11 w-full flex-wrap items-center gap-2 text-left text-sm font-semibold text-slate-700 transition-colors hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                        >
                          <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" aria-hidden="true" />
                          {t('browse_jobs_reviews_section')}
                          <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                            {employerRating
                              ? <>{employerRating.avg.toFixed(1)} / 5 &middot; {employerReviews.reviews.length} / {employerRating.count}</>
                              : t('app_loading')}
                          </span>
                          {reviewsOpen
                            ? <ChevronUp className="ms-auto h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                            : <ChevronRight className="ms-auto h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                          }
                        </button>

                        {reviewsOpen && (
                          <div id={reviewsId} className="mt-3 space-y-3">
                            {employerReviews.reviews.map((rv, idx) => (
                              <div
                                key={`${rv.created_at ?? 'pending'}-${idx}`}
                                className="rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 px-3 py-3"
                              >
                                {/* Stars row */}
                                <div className="mb-1.5 flex items-center gap-1">
                                  <span className="inline-flex items-center gap-1" aria-label={`${rv.rating} / 5`}>
                                    {[1, 2, 3, 4, 5].map((s) => (
                                      <Star
                                        key={s}
                                        aria-hidden="true"
                                        className={`h-3.5 w-3.5 ${
                                          s <= rv.rating
                                            ? 'fill-yellow-400 text-yellow-400'
                                            : 'fill-none text-slate-300 dark:text-slate-600'
                                        }`}
                                      />
                                    ))}
                                  </span>
                                  {(() => {
                                    const badge = reviewTierBadge(rv.verificationTier, t);
                                    return (
                                      <span className={`ml-2 text-[10px] font-semibold border rounded-full px-2 py-0.5 ${badge.className}`}>
                                        {badge.label}
                                      </span>
                                    );
                                  })()}
                                  {rv.created_at && (
                                    <span className="ml-auto text-[10px] text-slate-400 dark:text-slate-500">
                                      {new Date(rv.created_at).toLocaleDateString()}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                                  {rv.text}
                                </p>
                              </div>
                            ))}

                            {employerReviews.status === 'error' && eid && (
                              <div
                                role="alert"
                                className="flex min-h-11 flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 dark:border-red-900/60 dark:bg-red-950/30"
                              >
                                <span className="text-xs text-red-700 dark:text-red-300">
                                  {employerReviews.reviews.length}
                                  {employerRating ? ` / ${employerRating.count}` : ''}
                                </span>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void loadReviewPage(eid, employerReviews.failedPage ?? 0);
                                  }}
                                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2 dark:border-red-800 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950/50"
                                >
                                  {t('action_retry')}
                                </button>
                              </div>
                            )}

                            {employerReviews.hasMore && employerReviews.nextPage !== null && eid && employerReviews.status !== 'error' && (
                              <button
                                type="button"
                                disabled={employerReviews.status === 'loading'}
                                aria-busy={employerReviews.status === 'loading'}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (employerReviews.nextPage !== null) {
                                    void loadReviewPage(eid, employerReviews.nextPage);
                                  }
                                }}
                                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-70 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300 dark:hover:bg-blue-900/40"
                              >
                                {employerReviews.status === 'loading' ? (
                                  <>
                                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                    {t('app_loading')}
                                  </>
                                ) : (
                                  t('portal_listings_show_more').replace('{n}', String(nextReviewCount))
                                )}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {session?.user && (
        <ApplyReviewModal
          open={Boolean(reviewJob)}
          job={reviewJob}
          uid={session.user.id}
          t={t}
          onConfirm={confirmApply}
          onClose={() => setReviewJob(null)}
          onEditProfile={onEditProfile}
        />
      )}
    </section>
  );
};

export default BrowseJobs;
