
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Bookmark, BookmarkCheck, Briefcase, ChevronDown, CircleDollarSign, ClipboardCheck, ExternalLink, FileText, Info, Loader2, Mail, Mic, Search, Users, X } from 'lucide-react';
import {
  type SavedOpportunity,
  removeOpportunity,
  saveOpportunity,
  subscribeSavedOpportunities,
} from '../../lib/savedOpportunities';
import { findOpportunities, calculateCompatibility, generateProfessionalEmail } from '../../services/aiClient';
import { safeHttpUrl, safeUrl } from '../../lib/safeUrl';
import ApplyReviewModal, { type ApplyReviewJob } from '../ApplyReviewModal';
import ConfirmActionDialog from '../ConfirmActionDialog';
import type { OpportunityResult, Opportunity, UserProfile } from '../../types';
import StagedLoader from '../StagedLoader';
import { useCancellableLoading } from '../../hooks/useCancellableLoading';
import type { AppSession as Session } from '../../lib/data';
import { useToast } from '../Toast';
import {
  collection,
  getDocs,
  getFirestore,
  limit,
  query,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { app as firebaseApp, firebaseFunctions } from '../../lib/firebaseClient';
import { CopyButton, renderFormattedText, ToolError } from './ToolUtils';
import {
  normalizeJobPreferences,
  preferencesToPromptBlock,
  prefsSummaryLine,
  useJobPreferences,
} from '../../hooks/useJobPreferences';
import { buildJobContextFromOpportunity, buildSalaryContextFromOpportunity } from '../../lib/toolPrefill';
import type { ScreenerQuestion } from '../../lib/recruitingData';
import { normalizeOpportunityResult } from '../../lib/aiResultGuards';
import { lexicalKeywordOverlapScore } from '../../lib/keywordOverlap';

interface OpportunityFinderProps {
  resumeText: string;
  market: string;
  openTool: (tool: string, input?: string) => void;
  session: Session | null;
  profile?: UserProfile | null;
  t: (key: string) => string;
}

const PLATFORM_JOB_LOAD_TIMEOUT_MS = 6500;

const defaultCurrencyForMarket = (market: string): string => {
  const normalized = market.toLowerCase();
  if (normalized.includes('canada')) return 'CAD';
  if (normalized.includes('kingdom') || normalized.includes('uk')) return 'GBP';
  if (normalized.includes('australia')) return 'AUD';
  if (normalized.includes('japan')) return 'JPY';
  if (normalized.includes('singapore')) return 'SGD';
  if (normalized.includes('emirates') || normalized.includes('dubai')) return 'AED';
  if (normalized.includes('euro') || normalized.includes('france') || normalized.includes('germany')) return 'EUR';
  return 'USD';
};

const OpportunityFinder: React.FC<OpportunityFinderProps> = ({ resumeText, market, openTool, session, profile, t }) => {
  const { loading, begin, end, cancel } = useCancellableLoading(false);
  const { addToast } = useToast();
  const [error, setError] = useState<string | null>(null);
  // FIX 1: derive a stable primitive so auth token-refresh (which creates a new
  // session object reference) does not cascade through useCallback deps and
  // refire the expensive AI search.
  const sessionUserId = session?.user?.id ?? null;
  const [result, setResult] = useState<OpportunityResult | null>(null);
  const [platformLoading, setPlatformLoading] = useState(false);
  const [expandedUrl, setExpandedUrl] = useState<string | null>(null);
  const [opportunityFilters, setOpportunityFilters] = useState<{ company: string, location: string }>({ company: 'all', location: 'all' });
  const [appliedJobs, setAppliedJobs] = useState<Set<string>>(new Set());
  // Saved opportunities — kept SEPARATE from `result` (a live subscription, never
  // auto-persisting search results) so it can't clobber the found list on mount.
  const [savedOpps, setSavedOpps] = useState<SavedOpportunity[]>([]);
  const [removeSavedTarget, setRemoveSavedTarget] = useState<{ url: string; title: string; company?: string } | null>(null);
  const [removingSavedUrl, setRemovingSavedUrl] = useState<string | null>(null);
  const [savingOpportunityUrls, setSavingOpportunityUrls] = useState<Set<string>>(new Set());
  const savingUrlsRef = useRef<Set<string>>(new Set());
  const accountJobPrefs = profile?.job_preferences ?? null;
  const { prefs: liveJobPrefs } = useJobPreferences({ accountPrefs: accountJobPrefs });
  const activeJobPrefs = useMemo(
    () => normalizeJobPreferences(accountJobPrefs) ?? liveJobPrefs,
    [accountJobPrefs, liveJobPrefs],
  );
  const activeJobPrefsKey = activeJobPrefs
    ? [activeJobPrefs.status, activeJobPrefs.roles, activeJobPrefs.locations, activeJobPrefs.salaryMin, activeJobPrefs.availability].join('\u001f')
    : '';

  // ---- salary chip: Map<internalJobId, { salary_range?: string, location?: string }> ----
  type InternalJobMeta = { salary_range?: string; location?: string; screener_questions?: ScreenerQuestion[] };
  const [internalJobData, setInternalJobData] = useState<Map<string, InternalJobMeta>>(new Map());

  // ---- per-card AI action state ----
  type WhyFitResult = { compatibilityScore: number; summary: string };
  type IntroResult = { subject: string; body: string };
  const [whyFitCache, setWhyFitCache] = useState<Record<string, WhyFitResult>>({});
  const [whyFitLoading, setWhyFitLoading] = useState<Record<string, boolean>>({});
  const [introCache, setIntroCache] = useState<Record<string, IntroResult>>({});
  const [introLoading, setIntroLoading] = useState<Record<string, boolean>>({});

  const applyInFlightRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const platformRunRef = useRef(0);
  const whyFitRunRef = useRef<Record<string, number>>({});
  const introRunRef = useRef<Record<string, number>>({});

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      platformRunRef.current += 1;
      whyFitRunRef.current = {};
      introRunRef.current = {};
    };
  }, []);

  // Pre-submit review: the candidate confirms what the employer will receive
  // before the application is actually created.
  const [pendingApply, setPendingApply] = useState<{ job: ApplyReviewJob; score: number | undefined } | null>(null);

  const openApplyReview = (jobId: string, title: string, company: string | undefined, compatibilityScore: number | undefined) => {
    if (!session?.user) {
        addToast(t('tool_opportunity_finder_signin_required'), 'error');
        return;
    }
    if (appliedJobs.has(jobId)) return;
    const meta = internalJobData.get(jobId);
    setPendingApply({
      job: {
        id: jobId,
        title,
        company,
        screenerQuestions: meta?.screener_questions ?? [],
      },
      score: compatibilityScore,
    });
  };

  const confirmApply = async (answers: { questionId: string; answer: string }[]) => {
    if (!session?.user || !pendingApply) return;
    const { job, score } = pendingApply;
    if (appliedJobs.has(job.id) || applyInFlightRef.current === job.id) return;
    applyInFlightRef.current = job.id;
    try {
        // Write goes through a Cloud Function: employer_id / job_title are read
        // server-side from the authoritative job_postings doc (not forgeable from
        // the client), duplicates are rejected atomically, Firestore rules forbid
        // client-side creates, and the ready-Talent-Profile precondition is
        // re-enforced server-side.
        const createJobApplication = httpsCallable(firebaseFunctions, 'createJobApplication');
        await createJobApplication({ jobId: job.id, compatibilityScore: score ?? null, screenerAnswers: answers });
        setAppliedJobs(prev => new Set(prev).add(job.id));
        addToast(t('tool_opportunity_finder_apply_success'), 'success');
        setPendingApply(null);
    } catch (err) {
        const code = (err as { code?: string })?.code ?? '';
        if (code === 'functions/already-exists') {
            setAppliedJobs(prev => new Set(prev).add(job.id));
            addToast(t('browse_jobs_application_recorded'), 'info');
            setPendingApply(null);
        } else if (code === 'functions/failed-precondition') {
            // Modal pre-gates profile + resume, so this is usually a closed job.
            const msg = (err as { message?: string })?.message ?? '';
            if (/profile|resume/i.test(msg)) {
                addToast(t('apply_complete_profile_first'), 'info'); // keep modal open to fix
            } else {
                addToast(t('apply_job_closed'), 'info');
                setPendingApply(null); // job closed — nothing to retry
            }
        } else {
            console.error('Error applying to job:', err);
            addToast(t('tool_opportunity_finder_apply_error'), 'error'); // keep modal open to retry
        }
    } finally {
        applyInFlightRef.current = null;
    }
  };

  const fetchAppliedJobs = useCallback(async () => {
    // FIX 1: depend on the primitive sessionUserId, not the session object.
    // Token refreshes recreate the session object without changing the user id,
    // so using the primitive prevents spurious re-runs.
    if (!sessionUserId) return;
    try {
        const db = getFirestore(firebaseApp);
        const snap = await getDocs(
          query(
            collection(db, 'job_applications'),
            where('candidate_id', '==', sessionUserId),
          ),
        );
        if (mountedRef.current) {
          setAppliedJobs(new Set(snap.docs.map((app) => app.data().job_id as string)));
        }
    } catch (err) {
        // Non-fatal side-fetch (it only powers the "Applied" badges). It must NOT
        // raise the tool's error gate: a transient read hiccup here would otherwise
        // hide the platform jobs that loaded fine behind a full-screen error — which
        // the runTool path guarded against but the auto-load path did not. Log only.
        console.error("Could not fetch applied jobs:", err);
    }
  }, [sessionUserId]);

  // Live saved-opportunities list. Read-only subscription — does not touch `result`.
  useEffect(() => {
    if (!sessionUserId) { setSavedOpps([]); return; }
    const unsub = subscribeSavedOpportunities(sessionUserId, setSavedOpps, () => {/* non-fatal side-list */});
    return () => unsub();
  }, [sessionUserId]);

  const savedUrls = useMemo(() => new Set(savedOpps.map((o) => o.url)), [savedOpps]);

  const setOpportunitySaving = useCallback((url: string, saving: boolean) => {
    if (!mountedRef.current) return;
    setSavingOpportunityUrls((prev) => {
      const next = new Set(prev);
      if (saving) next.add(url);
      else next.delete(url);
      return next;
    });
  }, []);

  const requestRemoveSavedOpportunity = useCallback((target: { url: string; title: string; company?: string }) => {
    if (!sessionUserId || savingUrlsRef.current.has(target.url)) return;
    setRemoveSavedTarget(target);
  }, [sessionUserId]);

  const confirmRemoveSavedOpportunity = useCallback(async () => {
    if (!sessionUserId || !removeSavedTarget || savingUrlsRef.current.has(removeSavedTarget.url)) return;
    const { url } = removeSavedTarget;
    savingUrlsRef.current.add(url);
    setRemovingSavedUrl(url);
    try {
      await removeOpportunity(sessionUserId, url);
      if (!mountedRef.current) return;
      setRemoveSavedTarget(null);
    } catch {
      if (mountedRef.current) addToast(t('tool_opportunity_finder_save_error'), 'error');
    } finally {
      savingUrlsRef.current.delete(url);
      if (mountedRef.current) setRemovingSavedUrl(null);
    }
  }, [addToast, removeSavedTarget, sessionUserId, t]);

  const toggleSaveOpportunity = useCallback(async (job: Opportunity) => {
    if (!sessionUserId || savingUrlsRef.current.has(job.url)) return;
    if (savedUrls.has(job.url)) {
      requestRemoveSavedOpportunity({
        url: job.url,
        title: job.jobTitle,
        company: job.company,
      });
      return;
    }
    savingUrlsRef.current.add(job.url);
    setOpportunitySaving(job.url, true);
    try {
      await saveOpportunity(sessionUserId, {
        jobTitle: job.jobTitle, company: job.company, location: job.location,
        url: job.url, summary: job.summary, compatibilityScore: job.compatibilityScore,
      });
    } catch {
      addToast(t('tool_opportunity_finder_save_error'), 'error');
    } finally {
      savingUrlsRef.current.delete(job.url);
      setOpportunitySaving(job.url, false);
    }
  }, [sessionUserId, savedUrls, addToast, t, requestRemoveSavedOpportunity, setOpportunitySaving]);

  // Rendered in both the empty (revisit-on-open) and results views.
  const savedPanel = savedOpps.length > 0 ? (
    <div data-qa="opportunity-saved-panel" className="rounded-lg border border-blue-100 bg-blue-50/60 p-3 dark:border-blue-900/50 dark:bg-blue-950/20">
      <h5 className="flex items-center gap-2 text-sm font-bold text-blue-900 dark:text-blue-200">
        <BookmarkCheck className="h-4 w-4" aria-hidden="true" />
        {t('tool_opportunity_finder_saved_header').replace('{count}', String(savedOpps.length))}
      </h5>
      <ul className="mt-2 space-y-1.5">
        {savedOpps.map((o) => (
          <li key={o.id} data-qa="opportunity-saved-item" className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{o.job_title}</p>
              <p className="truncate text-xs text-gray-500 dark:text-gray-400">{o.company}{o.location ? ` · ${o.location}` : ''}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {safeHttpUrl(o.url) && !o.url.startsWith('#internal') && (
                <a href={safeHttpUrl(o.url)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline dark:text-blue-300">
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />{t('tool_opportunity_finder_open_link')}
                </a>
              )}
              <button
                type="button"
                data-qa="opportunity-remove-saved"
                onClick={() => requestRemoveSavedOpportunity({ url: o.url, title: o.job_title, company: o.company })}
                aria-label={t('tool_opportunity_finder_remove_saved')}
                className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/30"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  ) : null;

  // Active platform postings (employer-posted jobs). Candidates may read active
  // job_postings per Firestore rules, so we surface them in the results with a
  // one-click Apply, a salary chip, and an at-a-glance match estimate — alongside
  // the AI's external suggestions. Additive and free; never blocks external search.
  const fetchInternalJobs = useCallback(async (): Promise<{
    opps: Opportunity[];
    meta: Map<string, InternalJobMeta>;
  }> => {
    const empty = { opps: [] as Opportunity[], meta: new Map<string, InternalJobMeta>() };
    if (!sessionUserId) return empty;
    try {
      const db = getFirestore(firebaseApp);
      const snap = await getDocs(
        query(collection(db, 'job_postings'), where('is_active', '==', true), limit(25)),
      );
      const opps: Opportunity[] = [];
      const meta = new Map<string, InternalJobMeta>();
      snap.docs.forEach((docSnap) => {
        const d = docSnap.data() as Record<string, unknown>;
        const id = docSnap.id;
        const title = (d.title as string) ?? 'Open role';
        const description = (d.description as string) ?? '';
        opps.push({
          jobTitle: title,
          company: (d.company_name as string) ?? '',
          location: (d.location as string) ?? '',
          url: `#internal-job-${id}`,
          summary: description,
          isInternal: true,
          compatibilityScore: resumeText.trim() ? lexicalKeywordOverlapScore(resumeText, `${title} ${description}`) : undefined,
        });
        meta.set(id, {
          salary_range: d.salary_range as string | undefined,
          location: d.location as string | undefined,
          screener_questions: Array.isArray(d.screener_questions) ? (d.screener_questions as ScreenerQuestion[]) : [],
        });
      });
      return { opps, meta };
    } catch (err) {
      console.error('Could not fetch internal jobs:', err);
      return empty; // additive — never block the external results if this read fails
    }
  }, [sessionUserId, resumeText]);

  const fetchAppliedJobsWithinLimit = useCallback(async () => {
    await Promise.race([
      fetchAppliedJobs(),
      new Promise<void>((resolve) => window.setTimeout(resolve, PLATFORM_JOB_LOAD_TIMEOUT_MS)),
    ]);
  }, [fetchAppliedJobs]);

  const fetchInternalJobsWithinLimit = useCallback(async (): Promise<{
    opps: Opportunity[];
    meta: Map<string, InternalJobMeta>;
  }> => {
    const empty = { opps: [] as Opportunity[], meta: new Map<string, InternalJobMeta>() };
    return Promise.race([
      fetchInternalJobs(),
      new Promise<typeof empty>((resolve) => window.setTimeout(() => resolve(empty), PLATFORM_JOB_LOAD_TIMEOUT_MS)),
    ]);
  }, [fetchInternalJobs]);

  const runTool = useCallback(async () => {
    platformRunRef.current += 1;
    setPlatformLoading(false);
    const alive = begin();
    setError(null);
    try {
      // Feed job preferences into the AI search.
      const resumeForSearch = activeJobPrefs
        ? preferencesToPromptBlock(activeJobPrefs) + '\n\n---\n\n' + resumeText
        : resumeText;

      // Start the two additive Firestore reads and the paid AI search in the same
      // turn. Previously the AI request waited behind two 6.5s watchdogs, adding
      // up to 13 seconds before provider generation even began.
      const appliedJobsPromise = fetchAppliedJobsWithinLimit();
      const internalJobsPromise = fetchInternalJobsWithinLimit();
      // findOpportunities accepts session for legacy signature compatibility;
      // the closure value is fine here — we only fix deps to use the primitive.
      const opportunitiesPromise = findOpportunities(resumeForSearch, market, session).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );

      const [, internal, opportunities] = await Promise.all([
        appliedJobsPromise,
        internalJobsPromise,
        opportunitiesPromise,
      ]);
      if (!alive()) return;

      if (opportunities.ok === true) {
        const normalizedResult = normalizeOpportunityResult(opportunities.value);
        // Internal platform jobs first (one-click apply + tracked status), then the
        // AI's external web suggestions.
        setResult({ ...normalizedResult, opportunities: [...internal.opps, ...normalizedResult.opportunities] });
        setInternalJobData(internal.meta);
        // FIX 2: clear any non-fatal side-error (e.g. fetchAppliedJobs) now that we
        // have a good result so the cards render.
        setError(null);
      } else {
        // External AI search failed (e.g. quota). Still surface platform jobs if any.
        if (internal.opps.length > 0) {
          setResult({ opportunities: internal.opps, jobSearchStrategies: [], groundingChunks: undefined });
          setInternalJobData(internal.meta);
          setError(null);
        } else {
          throw opportunities.error;
        }
      }
    } catch (err) {
      if (alive()) setError(err instanceof Error ? err.message : t('unexpected_error'));
    } finally {
      if (alive()) end();
    }
    // FIX 1: use sessionUserId (primitive) instead of session (object) so that
    // token-refresh events that recreate the session object do not refire this
    // callback (and therefore the expensive AI search + double credit spend).
  }, [resumeText, market, sessionUserId, activeJobPrefsKey, fetchAppliedJobsWithinLimit, fetchInternalJobsWithinLimit, begin, end]);

  // Free platform-posting load only. The external AI search is credit-charging, so
  // it must be started by an explicit click instead of auto-running on page entry.
  const loadPlatformJobs = useCallback(async () => {
    const runId = platformRunRef.current + 1;
    platformRunRef.current = runId;
    setPlatformLoading(true);
    setError(null);
    try {
      await fetchAppliedJobsWithinLimit();
      const internal = await fetchInternalJobsWithinLimit();
      if (!mountedRef.current || runId !== platformRunRef.current) return;
      setInternalJobData(internal.meta);
      setResult(internal.opps.length > 0
        ? {
            opportunities: internal.opps,
            jobSearchStrategies: [],
            groundingChunks: undefined,
            notice: t('tool_opportunity_finder_platform_only_notice'),
          }
        : null);
    } catch {
      if (mountedRef.current && runId === platformRunRef.current) setResult(null);
    } finally {
      if (mountedRef.current && runId === platformRunRef.current) setPlatformLoading(false);
    }
  }, [fetchAppliedJobsWithinLimit, fetchInternalJobsWithinLimit, t]);

  const lastPlatformRunKey = useRef<string | null>(null);
  useEffect(() => {
    const runKey = `${sessionUserId ?? 'anon'}|${market}|${resumeText.length}`;
    if (lastPlatformRunKey.current === runKey) return;
    lastPlatformRunKey.current = runKey;
    loadPlatformJobs();
  }, [loadPlatformJobs, sessionUserId, market, resumeText]);

  // 4c: Why am I a fit?
  const handleWhyFit = useCallback(async (job: Opportunity) => {
    if (whyFitLoading[job.url] || whyFitCache[job.url]) return;
    const runId = (whyFitRunRef.current[job.url] ?? 0) + 1;
    whyFitRunRef.current[job.url] = runId;
    setWhyFitLoading((prev) => ({ ...prev, [job.url]: true }));
    try {
      const jobDesc = `${job.jobTitle} at ${job.company} (${job.location})\n\n${job.summary}`;
      const res = await calculateCompatibility(resumeText, jobDesc);
      if (!mountedRef.current || whyFitRunRef.current[job.url] !== runId) return;
      setWhyFitCache((prev) => ({ ...prev, [job.url]: res }));
    } catch (err) {
      if (mountedRef.current && whyFitRunRef.current[job.url] === runId) {
        addToast(err instanceof Error ? err.message : t('tool_opportunity_finder_action_error'), 'error');
      }
    } finally {
      if (mountedRef.current && whyFitRunRef.current[job.url] === runId) {
        setWhyFitLoading((prev) => ({ ...prev, [job.url]: false }));
      }
    }
  }, [resumeText, whyFitCache, whyFitLoading, addToast, t]);

  // 4c: Intro message
  const handleIntroMessage = useCallback(async (job: Opportunity) => {
    if (introLoading[job.url] || introCache[job.url]) return;
    const runId = (introRunRef.current[job.url] ?? 0) + 1;
    introRunRef.current[job.url] = runId;
    setIntroLoading((prev) => ({ ...prev, [job.url]: true }));
    try {
      const details: Record<string, string> = {
        jobTitle: job.jobTitle,
        company: job.company,
        jobSummary: job.summary ?? '',
      };
      const res = await generateProfessionalEmail(
        resumeText,
        'Brief friendly outreach message to the hiring manager about a specific job opening',
        details,
        market,
        3,   // tone: neutral
        2,   // style: conversational
        3,   // confidence: neutral
      );
      if (!mountedRef.current || introRunRef.current[job.url] !== runId) return;
      setIntroCache((prev) => ({ ...prev, [job.url]: res }));
    } catch (err) {
      if (mountedRef.current && introRunRef.current[job.url] === runId) {
        addToast(err instanceof Error ? err.message : t('tool_opportunity_finder_action_error'), 'error');
      }
    } finally {
      if (mountedRef.current && introRunRef.current[job.url] === runId) {
        setIntroLoading((prev) => ({ ...prev, [job.url]: false }));
      }
    }
  }, [resumeText, market, introCache, introLoading, addToast, t]);

  if (loading) return (
    <StagedLoader
      title={t('tool_opportunity_finder_loading_title')}
      steps={[
        t('tool_opportunity_finder_loading_step1'),
        t('tool_opportunity_finder_loading_step2'),
        t('tool_opportunity_finder_loading_step3'),
        t('tool_opportunity_finder_loading_step4'),
      ]}
      onCancel={cancel}
      cancelLabel={t('tool_loader_hide_button')}
      cancelHint={t('tool_loader_hide_hint')}
      icon={<Search />}
      accent="fuchsia"
    />
  );
  if (error) return <ToolError message={error} onRetry={() => runTool()} retryLabel={t('tool_opportunity_finder_search_again')} />;

  if (platformLoading) return (
    <div data-qa="opportunity-finder-tool" data-qa-tool-state="loading" role="status" aria-live="polite" className="flex flex-col items-center justify-center text-center my-24 gap-4 animate-fade-in">
      <Loader2 className="h-10 w-10 animate-spin text-fuchsia-600" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium text-gray-600 dark:text-gray-300">{t('tool_opportunity_finder_platform_loading')}</p>
        <button
          type="button"
          data-qa="opportunity-finder-start-search"
          onClick={() => runTool()}
          className="mt-3 inline-flex items-center justify-center gap-2 rounded-lg bg-fuchsia-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-fuchsia-800"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          {t('tool_opportunity_finder_start_button')}
        </button>
      </div>
    </div>
  );

  if (!result) return (
    <div data-qa="opportunity-finder-tool" data-qa-tool-state="input" className="space-y-4 animate-fade-in">
      {savedPanel}
      <div className="mx-auto mt-12 flex max-w-xl flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-fuchsia-200 bg-fuchsia-50/60 p-8 text-center dark:border-fuchsia-900/60 dark:bg-fuchsia-950/20">
        <Search className="h-9 w-9 text-fuchsia-600 dark:text-fuchsia-300" aria-hidden="true" />
        <div>
          <h4 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t('tool_opportunity_finder_start_title')}</h4>
          <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">{t('tool_opportunity_finder_start_desc')}</p>
        </div>
        <button
          type="button"
          data-qa="opportunity-finder-start-search"
          onClick={() => runTool()}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-700 hover:bg-blue-800 px-5 py-2.5 text-white font-semibold transition-colors"
        >
          {t('tool_opportunity_finder_start_button')}
        </button>
      </div>
    </div>
  );

  const { opportunities, jobSearchStrategies, groundingChunks, notice } = result;

  // Active prefs for the banner (4a)
  const activePrefsSummary = activeJobPrefs ? prefsSummaryLine(activeJobPrefs) : null;

  const companyOptions = ['all', ...Array.from(new Set(opportunities.map(o => o.company)))];
  const locationOptions = ['all', ...Array.from(new Set(opportunities.map(o => o.location)))];
  
  const filteredOpportunities = opportunities.filter(o => {
      const companyMatch = opportunityFilters.company === 'all' || o.company === opportunityFilters.company;
      const locationMatch = opportunityFilters.location === 'all' || o.location === opportunityFilters.location;
      return companyMatch && locationMatch;
  });
  
  const renderStrategyWithBold = (text: string) => {
    return text.split(/(\*\*.*?\*\*)/g).map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={index}>{part.slice(2, -2)}</strong>;
        }
        return part;
    });
  };

  return (
    <div data-qa="opportunity-finder-tool" data-qa-tool-state="result" className="space-y-4 animate-fade-in">
      <h4 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t('tool_opportunity_finder_results_title')}</h4>

      {activeJobPrefs && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-100 dark:border-blue-800/50 bg-blue-50 dark:bg-blue-900/20 px-3 py-2 text-xs text-blue-800 dark:text-blue-300">
          <span className="font-semibold shrink-0">{t('goals_active_banner')}</span>
          {activePrefsSummary && <span className="text-blue-600 dark:text-blue-400 truncate">{activePrefsSummary}</span>}
        </div>
      )}

      {notice && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{notice}</p>
        </div>
      )}

      {savedPanel}

      {(!jobSearchStrategies || jobSearchStrategies.length === 0) && (
        <div className="flex flex-col gap-3 rounded-lg border border-fuchsia-100 bg-fuchsia-50 p-4 text-sm text-fuchsia-950 dark:border-fuchsia-900/60 dark:bg-fuchsia-950/20 dark:text-fuchsia-100 sm:flex-row sm:items-center sm:justify-between">
          <p>{t('tool_opportunity_finder_ai_search_prompt')}</p>
          <button
            type="button"
            data-qa="opportunity-finder-ai-search"
            onClick={() => runTool()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-fuchsia-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-fuchsia-800"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            {t('tool_opportunity_finder_start_button')}
          </button>
        </div>
      )}
      
      {jobSearchStrategies && jobSearchStrategies.length > 0 && (
        <div className="rounded-xl border border-blue-100 bg-blue-50/80 p-4 dark:border-blue-900/60 dark:bg-blue-950/30">
            <h5 className="font-bold text-blue-900 dark:text-blue-200 flex items-center gap-2">
                <Info className="h-5 w-5" aria-hidden="true" />
                {t('tool_opportunity_finder_strategies_header')}
            </h5>
            <ul className="list-disc list-inside mt-2 space-y-2 text-sm text-blue-800 dark:text-blue-300">
                {jobSearchStrategies.map((strategy, i) => (
                    <li key={i}>{renderStrategyWithBold(strategy)}</li>
                ))}
            </ul>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="grid gap-3 md:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] md:items-center">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <Search className="h-4 w-4 text-slate-400" aria-hidden="true" />
            {t('tool_opportunity_finder_filter_label')}
          </div>
          <div>
            <label htmlFor="opportunity-company-filter" className="sr-only">{t('tool_opportunity_finder_filter_all_companies')}</label>
            <select
              id="opportunity-company-filter"
              value={opportunityFilters.company}
              onChange={e => setOpportunityFilters(p => ({...p, company: e.target.value}))}
              className="block min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-500 dark:focus:ring-blue-900/40"
            >
              {companyOptions.map(c => <option key={c} value={c}>{c === 'all' ? t('tool_opportunity_finder_filter_all_companies') : c}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="opportunity-location-filter" className="sr-only">{t('tool_opportunity_finder_filter_all_locations')}</label>
            <select
              id="opportunity-location-filter"
              value={opportunityFilters.location}
              onChange={e => setOpportunityFilters(p => ({...p, location: e.target.value}))}
              className="block min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-500 dark:focus:ring-blue-900/40"
            >
              {locationOptions.map(l => <option key={l} value={l}>{l === 'all' ? t('tool_opportunity_finder_filter_all_locations') : l}</option>)}
            </select>
          </div>
        </div>
      </div>
      {filteredOpportunities.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center dark:border-slate-700 dark:bg-slate-800">
          <h5 className="font-semibold text-gray-900 dark:text-gray-100">{t('tool_opportunity_finder_empty_title')}</h5>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-gray-600 dark:text-gray-300">{t('tool_opportunity_finder_no_results')}</p>
          <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => setOpportunityFilters({ company: 'all', location: 'all' })}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-200 dark:hover:bg-slate-700"
            >
              {t('tool_opportunity_finder_reset_filters')}
            </button>
            <button
              type="button"
              onClick={() => runTool()}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
            >
              {t('tool_opportunity_finder_search_again')}
            </button>
          </div>
        </div>
      )}
      <div data-qa="opportunity-results-list" className="space-y-3">
        {filteredOpportunities.map((job, i) => {
            const isExpanded = expandedUrl === job.url;
            const jobId = job.isInternal ? job.url.replace('#internal-job-', '') : '';
            const hasApplied = job.isInternal && appliedJobs.has(jobId);
            const isSaved = savedUrls.has(job.url);
            const isSavingOpportunity = savingOpportunityUrls.has(job.url);
            const panelId = `opportunity-detail-${i}`;
            const jobHandoffContext = buildJobContextFromOpportunity(job);
            const internalMeta = job.isInternal ? internalJobData.get(jobId) : undefined;
            const salaryRange = internalMeta?.salary_range;
            const salaryHandoffContext = salaryRange
              ? buildSalaryContextFromOpportunity(job, salaryRange, defaultCurrencyForMarket(market))
              : '';

            return (
                <article key={job.url + i} data-qa="opportunity-result-card" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-300 dark:border-slate-700 dark:bg-slate-900">
                    <button
                      type="button"
                      onClick={() => setExpandedUrl(isExpanded ? null : job.url)}
                      className="w-full rounded-lg text-left transition focus:outline-none focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-900/50"
                      aria-expanded={isExpanded}
                      aria-controls={panelId}
                    >
                        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <h5 data-qa="opportunity-card-title" className="break-words text-base font-bold leading-6 text-slate-950 dark:text-slate-100">{job.jobTitle}</h5>
                                {job.isInternal && (
                                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                                        {t('tool_opportunity_finder_internal_badge')}
                                    </span>
                                )}
                            </div>
                            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600 dark:text-slate-400">
                              <Briefcase className="h-4 w-4 text-slate-400" aria-hidden="true" />
                              <span data-qa="opportunity-card-company" className="break-words">{job.company || t('tool_opportunity_finder_filter_all_companies')}</span>
                              {job.location && <span aria-hidden="true">·</span>}
                              {job.location && <span className="break-words">{job.location}</span>}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                             {/* 4b: salary chip */}
                             {salaryRange && (
                               <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                                 {salaryRange}
                               </span>
                             )}
                             {/* Lexical keyword overlap is persisted
                                 as the application's compatibility_score), not the AI match — keep the label honest. */}
                             {job.isInternal && job.compatibilityScore !== undefined && (
                                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-right dark:border-slate-700 dark:bg-slate-800">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('applications_keyword_overlap')}</p>
                                    <p className="text-lg font-bold leading-5 text-emerald-600 dark:text-emerald-300">{job.compatibilityScore}%</p>
                                </div>
                            )}
                            <ChevronDown className={`h-5 w-5 flex-shrink-0 text-slate-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} aria-hidden="true" />
                          </div>
                        </div>
                    </button>
                    {isExpanded && (
                        <div id={panelId} className="mt-4 border-t border-slate-200 pt-4 animate-fade-in dark:border-slate-700">
                        <div className="rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-700 dark:bg-slate-800/70 dark:text-slate-300 prose prose-sm dark:prose-invert max-w-none">{renderFormattedText(job.summary)}</div>

                        {/* 4c: Why am I a fit? result */}
                        {whyFitCache[job.url] && (
                          <div className="mt-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-3 text-sm text-blue-900 dark:text-blue-200">
                            <p className="font-semibold mb-1">{t('job_card_why_fit')} — {whyFitCache[job.url].compatibilityScore}%</p>
                            <p className="leading-relaxed">{whyFitCache[job.url].summary}</p>
                          </div>
                        )}

                        {/* 4c: Intro message result */}
                        {introCache[job.url] && (
                          <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50 p-3 text-sm">
                            <p className="font-semibold text-gray-800 dark:text-gray-200 mb-1">{introCache[job.url].subject}</p>
                            <p className="text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{introCache[job.url].body}</p>
                            <CopyButton text={`Subject: ${introCache[job.url].subject}\n\n${introCache[job.url].body}`} className="mt-2" />
                          </div>
                        )}

                        <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                          <div className="flex flex-wrap gap-2">
                             {job.isInternal ? (
                                <button type="button" onClick={() => openApplyReview(jobId, job.jobTitle, job.company, job.compatibilityScore)} disabled={hasApplied} className={`inline-flex min-h-10 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors ${hasApplied ? 'bg-emerald-500 cursor-not-allowed' : 'bg-blue-700 hover:bg-blue-800'}`}>
                                    {hasApplied ? t('tool_opportunity_finder_applied_button') : t('tool_opportunity_finder_apply_button')}
                                </button>
                             ) : (
                                <a href={safeUrl(job.url) || undefined} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center justify-center rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800">{t('tool_opportunity_finder_view_apply_button')}</a>
                             )}
                             <button
                              type="button"
                              data-qa="opportunity-generate-cover-letter"
                              onClick={() => openTool('cover-letter', jobHandoffContext)}
                              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                             >
                              <FileText className="h-4 w-4" aria-hidden="true" />
                              {t('tool_opportunity_finder_generate_cover_letter_button')}
                             </button>
                             <button
                              type="button"
                              data-qa="opportunity-draft-email"
                              onClick={() => openTool('email-crafter', jobHandoffContext)}
                              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                             >
                              <Mail className="h-4 w-4" aria-hidden="true" />
                              {t('tool_opportunity_finder_draft_email_button')}
                             </button>
                             <button
                              type="button"
                              data-qa="opportunity-prepare-interview"
                              onClick={() => openTool('interview-prep', jobHandoffContext)}
                              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                             >
                              <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                              {t('tool_opportunity_finder_prepare_interview_button')}
                             </button>
                             <button
                              type="button"
                              data-qa="opportunity-start-mock-interview"
                              onClick={() => openTool('mock-interview', jobHandoffContext)}
                              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                             >
                              <Mic className="h-4 w-4" aria-hidden="true" />
                              {t('tool_opportunity_finder_mock_interview_button')}
                             </button>
                             {salaryRange && (
                               <button
                                type="button"
                                data-qa="opportunity-open-salary-negotiation"
                                onClick={() => openTool('salary-negotiation', salaryHandoffContext)}
                                className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                               >
                                <CircleDollarSign className="h-4 w-4" aria-hidden="true" />
                                {t('tool_opportunity_finder_salary_prep_button')}
                               </button>
                             )}
                             <button
                              type="button"
                              data-qa="opportunity-plan-networking"
                              onClick={() => openTool('networking-assistant', jobHandoffContext)}
                              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                             >
                              <Users className="h-4 w-4" aria-hidden="true" />
                              {t('tool_opportunity_finder_networking_button')}
                             </button>

                             {/* Save / bookmark this opportunity (SCRUM-28) */}
                             {sessionUserId && (
                               <button
                                 type="button"
                                 data-qa="opportunity-save-toggle"
                                 onClick={() => toggleSaveOpportunity(job)}
                                 disabled={isSavingOpportunity}
                                 aria-busy={isSavingOpportunity}
                                 aria-pressed={isSaved}
                                 className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-wait disabled:opacity-70 ${isSaved ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'}`}
                               >
                                 {isSavingOpportunity ? (
                                   <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                 ) : isSaved ? (
                                   <BookmarkCheck className="h-4 w-4" aria-hidden="true" />
                                 ) : (
                                   <Bookmark className="h-4 w-4" aria-hidden="true" />
                                 )}
                                 {isSaved ? t('tool_opportunity_finder_saved_button') : t('tool_opportunity_finder_save_button')}
                               </button>
                             )}
                          </div>

                          <div className="flex flex-wrap justify-start gap-2 sm:justify-end">
                             {/* 4c: Why am I a fit? button */}
                             <button
                               type="button"
                               onClick={() => handleWhyFit(job)}
                               disabled={!!whyFitLoading[job.url] || !!whyFitCache[job.url]}
                               className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                             >
                               {whyFitLoading[job.url] ? (
                                 <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                               ) : null}
                               {t('job_card_why_fit')}
                             </button>

                             {/* 4c: Intro message button */}
                             <div className="flex flex-col items-end gap-0.5">
                               <button
                                 type="button"
                                 onClick={() => handleIntroMessage(job)}
                                 disabled={!!introLoading[job.url] || !!introCache[job.url]}
                                 className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                               >
                                 {introLoading[job.url] ? (
                                   <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                 ) : null}
                                 <Mail className="h-4 w-4" aria-hidden="true" />
                                 {t('job_card_intro_message')}
                               </button>
                               <span className="text-xs text-gray-400 dark:text-gray-500">{t('job_card_uses_credits')}</span>
                             </div>
                          </div>
                        </div>
                        </div>
                    )}
                </article>
            )
        })}
      </div>
      {groundingChunks && groundingChunks.length > 0 && (
        <div className="pt-2 border-t dark:border-slate-700 text-xs text-gray-500 dark:text-gray-400">
          <p className="font-semibold mb-1">{t('tool_opportunity_finder_sources_label')}:</p>
          <ul className="list-disc list-inside">
            {groundingChunks.filter((chunk: any) => chunk.web && safeUrl(chunk.web.uri)).map((chunk: any, i: number) => (
              <li key={i}><a href={safeUrl(chunk.web.uri) || undefined} target="_blank" rel="noopener noreferrer" className="hover:underline text-blue-600 dark:text-blue-400">{chunk.web.title}</a></li>
            ))}
          </ul>
        </div>
      )}

      {session?.user && (
        <ApplyReviewModal
          open={Boolean(pendingApply)}
          job={pendingApply?.job ?? null}
          uid={session.user.id}
          t={t}
          onConfirm={confirmApply}
          onClose={() => setPendingApply(null)}
        />
      )}
      <ConfirmActionDialog
        open={Boolean(removeSavedTarget)}
        dataQa="opportunity-remove-saved-dialog"
        title={t('tool_opportunity_finder_remove_saved')}
        description="Remove this saved opportunity from your list?"
        detail={removeSavedTarget ? `${removeSavedTarget.title}${removeSavedTarget.company ? ` · ${removeSavedTarget.company}` : ''}` : undefined}
        cancelLabel="Cancel"
        confirmLabel={t('tool_opportunity_finder_remove_saved')}
        loadingLabel="Removing..."
        loading={Boolean(removeSavedTarget && removingSavedUrl === removeSavedTarget.url)}
        tone="danger"
        onOpenChange={(open) => {
          if (!open && !removingSavedUrl) setRemoveSavedTarget(null);
        }}
        onCancel={() => {
          if (!removingSavedUrl) setRemoveSavedTarget(null);
        }}
        onConfirm={() => void confirmRemoveSavedOpportunity()}
      />
    </div>
  );
};

export default OpportunityFinder;
