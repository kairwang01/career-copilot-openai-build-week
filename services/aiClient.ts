/**
 * aiClient — the single frontend entry point for AI features.
 *
 * Every AI call goes through a Cloud Function: the Gemini key stays server-side
 * and credits are deducted server-side. There is no browser-side Gemini SDK or
 * VITE_API_KEY anymore (services/geminiService.ts was retired once every feature
 * here was migrated).
 *
 * - Long-tail tools  → httpsCallable("aiProxy", { tool, payload })
 * - Resume analysis / cover letter / career path / mock interview / headshot /
 *   URL extraction / career-coach chat → their dedicated callables
 */

import { httpsCallable } from 'firebase/functions';
import { firebaseFunctions } from '../lib/firebaseClient';
import { createSecureRandomId } from '../lib/secureRandomId';
import { withInFlightDedupe } from '../lib/inFlightDedupe';
import type { TalentProfile } from '../lib/talentProfile';
import { resolveUiLanguagePreference } from '../lib/uiLanguage';
import type {
  AnalysisResult, ResumeImage,
  FormattedResume, CoverLetter, LinkedInOptimization, CareerPathResult,
  AgilePracticeTestResult, SalaryNegotiationResult, EnglishProResult,
  ProfessionalEmailResult, OpportunityResult, PortfolioContent,
  InclusivitySuggestion, CandidateMatchAnalysis, NetworkingStrategyResult,
  SkillBridgeProject, Improvement, PerformanceReviewResult, LearningPlanResult,
  EventScoutResult, UserProfile, SpokenEnglishAnalysisResult,
  EnglishReadingAnalysisResult, EnglishListeningAnalysisResult, ReadingEvaluation,
  ComprehensionQuestion, ReadingPracticePassage, VocabularyFlashcard, CandidatePrepKit,
} from '../types';
import type { AppSession as Session } from '../lib/data';

// API status indicator — driven by callable outcomes (replaces the old client
// geminiService status hook). CareerApp registers an updater on mount.
type ApiStatus = 'online' | 'degraded' | 'offline';
const API_STATUS_INCIDENT_TTL_MS = 30_000;
const noopApiStatusUpdater = () => {};
let updateApiStatus: (status: ApiStatus, error?: string) => void = noopApiStatusUpdater;
let statusIncidentGeneration = 0;
let statusIncidentTimer: ReturnType<typeof setTimeout> | null = null;

function publishApiStatus(status: ApiStatus, error?: string): void {
  statusIncidentGeneration += 1;
  const generation = statusIncidentGeneration;
  if (statusIncidentTimer) {
    clearTimeout(statusIncidentTimer);
    statusIncidentTimer = null;
  }
  updateApiStatus(status, error);
  if (status === 'online') return;

  // This is a recent-request incident indicator, not a permanent health verdict.
  // Expire it after the same 30-second retry window shown to users. A generation
  // guard prevents an older timer from clearing a newer failure.
  statusIncidentTimer = setTimeout(() => {
    if (generation !== statusIncidentGeneration) return;
    statusIncidentTimer = null;
    updateApiStatus('online');
  }, API_STATUS_INCIDENT_TTL_MS);
}

export function clearApiStatusIncident(): void {
  publishApiStatus('online');
}

export const setApiStatusUpdater = (updater: (status: ApiStatus, error?: string) => void) => {
  updateApiStatus = updater;
  return () => {
    if (updateApiStatus !== updater) return;
    statusIncidentGeneration += 1;
    if (statusIncidentTimer) clearTimeout(statusIncidentTimer);
    statusIncidentTimer = null;
    updateApiStatus = noopApiStatusUpdater;
  };
};

// Locale-aware error copy. CareerApp registers the app's translator on mount so
// callable failures surface in the user's language; until then (or for a missing
// key) the English fallback passed alongside each key is used — never a raw key.
type ErrorTranslator = (key: string, fallback: string) => string;
let translateError: ErrorTranslator = (_key, fallback) => fallback;
export const setErrorTranslator = (fn: ErrorTranslator) => {
  translateError = fn;
};

/** Turns Firebase callable errors into user-readable text (avoids bare "INTERNAL"). */
export function formatCallableError(err: unknown): string {
  const e = err as { code?: string; message?: string; details?: unknown };
  const code = e?.code ?? '';
  const message = e?.message ?? '';
  const lower = message.toLowerCase();
  const detailsStr = JSON.stringify(e?.details ?? '').toLowerCase();

  const isQuota =
    code === 'functions/resource-exhausted' ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    detailsStr.includes('quota') ||
    detailsStr.includes('resource_exhausted');

  // User-facing copy only — no internal/infra jargon (model keys, Cloud Run,
  // Admin), which end users (candidates/recruiters) should never see.
  if (isQuota) {
    return translateError('ai_error_busy', 'Our AI service is busy right now. Please wait about 30 seconds and try again.');
  }
  if (code === 'functions/unauthenticated') {
    return translateError('ai_error_signin', 'Please sign in to use AI features.');
  }
  if (code === 'functions/permission-denied' || lower.includes('not authenticated')) {
    return translateError('ai_error_no_access', 'You do not have access to this feature. Please sign in again, or contact support if this keeps happening.');
  }
  if (code === 'functions/not-found') {
    return translateError('ai_error_profile_load', 'We could not load your profile. Please sign out and sign back in.');
  }
  if (code === 'functions/already-exists') {
    return translateError('ai_error_duplicate_request', 'That AI request is already running. Please wait for the current result.');
  }
  if (code === 'functions/internal' && (lower === 'internal' || message === 'INTERNAL')) {
    return translateError('ai_error_failed', 'The AI request failed. Please try again in a moment.');
  }
  // Insufficient credits — strip the raw server string (which embeds the internal
  // tool slug, e.g. "resume-analysis") and show clean, jargon-free copy.
  if (code === 'functions/failed-precondition' && lower.includes('credit')) {
    return translateError('ai_error_no_credits', "You don't have enough credits for this feature. Please purchase more credits to continue.");
  }
  // AI provider not configured (missing key) or otherwise unavailable. The raw
  // server text can name operator concerns ("API key", "Admin Portal", "is not
  // set") that candidates/recruiters must never see — surface neutral copy
  // instead so an ops misconfiguration reads as a transient outage, not a leak.
  if (
    code === 'functions/unavailable' ||
    lower.includes('is not set') ||
    lower.includes('not configured') ||
    lower.includes('admin portal') ||
    lower.includes('api_key') ||
    // Chain-exhausted message from the backend names admin actions ("check the
    // API keys in the admin console") — same operator concern, same neutral copy.
    lower.includes('all configured ai models') ||
    lower.includes('check the api keys')
  ) {
    return translateError('ai_error_unavailable', 'AI features are temporarily unavailable. Please try again shortly, or contact support if this continues.');
  }
  return message || translateError('ai_error_generic', 'Something went wrong with the AI service. Please try again.');
}

export function reportApiStatusFromError(err: any): void {
  const code = err?.code ?? '';
  const message = err?.message ?? '';
  const lower = message.toLowerCase();
  const friendly = formatCallableError(err);

  if (code === 'functions/resource-exhausted' || lower.includes('resource_exhausted') || lower.includes('quota')) {
    publishApiStatus('degraded', friendly);
  } else if (lower.includes('network') || lower.includes('failed to fetch')) {
    publishApiStatus('offline', translateError('ai_error_network', 'Network connection issue. Please check your internet connection.'));
  } else if (code === 'functions/unavailable' || code === 'functions/deadline-exceeded') {
    // Server reachable but the AI provider is down or unconfigured — not the
    // user's connection. Surface neutral "temporarily unavailable" copy and mark
    // AI degraded (the rest of the app still works) rather than blaming their network.
    publishApiStatus('degraded', friendly);
  }
}

const inFlightDedicatedCalls = new Map<string, Promise<unknown>>();

/**
 * Surfaces callable failures to the status banner and rethrows for local UI error text.
 *
 * When `dedupeKey` is supplied, concurrent identical calls share ONE in-flight network
 * request (mirrors callAiProxy's inFlightAiProxyCalls). This is the real double-charge
 * guard for the charged dedicated callables: useCancellableLoading.begin() only
 * supersedes the UI result — it can NOT abort an in-flight Firebase callable — and a
 * fresh-per-call requestId can't dedup two distinct invocations, so a double-click /
 * rapid re-submit would otherwise bill twice server-side.
 */
function callDedicated<T>(
  fn: () => Promise<T>,
  dedupeKey?: string,
  affectsAiStatus: boolean = true,
): Promise<T> {
  return withInFlightDedupe(inFlightDedicatedCalls, dedupeKey, async () => {
    try {
      const result = await fn();
      if (affectsAiStatus) clearApiStatusIncident();
      return result;
    } catch (err) {
      if (affectsAiStatus) reportApiStatusFromError(err);
      throw new Error(formatCallableError(err));
    }
  });
}

type AiProxyPayload = {
  tool: string;
  payload: Record<string, unknown>;
  model?: string;
  requestId: string;
};

const inFlightAiProxyCalls = new Map<string, Promise<unknown>>();

/** UI language ("zh", "fr", …) — the app persists it under preferred_language.
 *  Sent to the backend so AI coaching/analysis prose matches the user's UI. */
const getUiLanguage = (): string | undefined => {
  let storedLanguage: string | null = null;
  try {
    storedLanguage = localStorage.getItem('preferred_language');
  } catch {
    // Browser language still gives the backend a reliable first-visit default.
  }
  const browserLanguage = typeof navigator !== 'undefined' ? navigator.language : null;
  return resolveUiLanguagePreference(storedLanguage, browserLanguage);
};
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',')}}`;
}

function makeCallableRequestId(prefix: string): string {
  return createSecureRandomId(prefix);
}

async function callAiProxy<TResponse, TResult>(
  mode: 'plain' | 'grounding',
  tool: string,
  payload: Record<string, unknown>,
  mapResult: (data: TResponse) => TResult
): Promise<TResult> {
  const model = getEffectiveAiModelId();
  // Attach the UI language for the backend's shared multilingual protocol;
  // explicit per-tool language params (e.g. outputLanguage, targetLanguage)
  // always win over this default.
  if (payload.outputLanguage === undefined && getUiLanguage()) {
    payload = { ...payload, outputLanguage: getUiLanguage() };
  }
  const key = `${mode}:${model}:${tool}:${stableStringify(payload)}`;
  const existing = inFlightAiProxyCalls.get(key);
  if (existing) return existing as Promise<TResult>;

  const promise = (async () => {
    const fn = httpsCallable<AiProxyPayload, TResponse>(firebaseFunctions, 'aiProxy', { timeout: 190_000 });
    const request: AiProxyPayload = {
      tool,
      payload,
      requestId: makeCallableRequestId('ai'),
      // Platform-managed mode deliberately omits a concrete model. Sending a
      // hardcoded DeepSeek id bypassed the admin Gemini default whenever a route
      // was missing or invalid. Business BYOA remains the sole client override.
      ...(model ? { model } : {}),
    };
    const res = await fn(request);
    clearApiStatusIncident();
    return mapResult(res.data);
  })();

  inFlightAiProxyCalls.set(key, promise);
  try {
    return await promise;
  } finally {
    if (inFlightAiProxyCalls.get(key) === promise) {
      inFlightAiProxyCalls.delete(key);
    }
  }
}

// ---- Mock interview (stateless callable) -----------------------------------
export interface InterviewQuestion { question: string; category: string; tip: string }
export interface InterviewEvaluation { score: number; strengths: string[]; improvements: string[]; modelAnswer: string }

export const generateInterviewQuestions = async (resumeText: string, jobDescription: string, marketName: string): Promise<InterviewQuestion[]> =>
  callDedicated(async () => {
    const fn = httpsCallable<any, { questions: InterviewQuestion[] }>(firebaseFunctions, 'mockInterview', { timeout: 190_000 });
    const res = await fn({
      mode: 'generate',
      resumeText,
      jobDescription,
      marketName,
      outputLanguage: getUiLanguage(),
      ...modelPayload(),
      requestId: makeCallableRequestId('mock_interview'),
    });
    return res.data.questions;
  }, `mockInterview:${currentModelId ?? ''}:${stableStringify({ resumeText, jobDescription, marketName })}`);

export const evaluateInterviewAnswer = async (question: string, answer: string, jobDescription: string): Promise<InterviewEvaluation> => {
  const requestPayload = {
    mode: 'evaluate',
    question,
    answer,
    jobDescription,
    outputLanguage: getUiLanguage(),
    ...modelPayload(),
  };
  return callDedicated(async () => {
    const fn = httpsCallable<any, InterviewEvaluation>(firebaseFunctions, 'mockInterview', { timeout: 190_000 });
    const res = await fn({ ...requestPayload, requestId: makeCallableRequestId('mock_interview_evaluate') });
    return res.data;
  }, `mockInterviewEvaluate:${stableStringify(requestPayload)}`);
};

export interface InterviewSessionReport {
  overallScore: number;
  verdict: string; // "Strong Hire" | "Hire" | "Leaning Hire" | "Leaning No Hire" | "No Hire"
  summary: string;
  strengths: string[];
  improvements: string[];
  perQuestion: { question: string; score: number; feedback: string }[];
}

/** Teaser returned to non-included tiers: full report is stored server-side behind a credit unlock. */
export interface LockedSessionReport {
  locked: true;
  reportId: string;
  unlockCredits: number;
  preview: { overallScore: number; firstStrength: string; perQuestionCount: number };
}

export type SessionEvalResult = ({ locked: false } & InterviewSessionReport) | LockedSessionReport;

/** Holistic end-of-interview report over the full timed transcript (free within the session — charged at generate).
 *  Paid tiers receive the full report (locked:false); other tiers receive a locked teaser envelope. */
export const evaluateInterviewSession = async (
  qa: { question: string; answer: string }[],
  jobDescription: string,
  resumeText: string,
): Promise<SessionEvalResult> => {
  const requestPayload = {
    mode: 'evaluate_session',
    qa,
    jobDescription,
    resumeText,
    outputLanguage: getUiLanguage(),
    ...modelPayload(),
  };
  return callDedicated(async () => {
    const fn = httpsCallable<any, SessionEvalResult>(firebaseFunctions, 'mockInterview', { timeout: 190_000 });
    const res = await fn({ ...requestPayload, requestId: makeCallableRequestId('mock_interview_session') });
    return res.data;
  }, `mockInterviewSession:${stableStringify(requestPayload)}`);
};

/** Pays the one-time unlock price for a stored locked report (idempotent for already-unlocked reports). */
export const unlockInterviewReport = async (reportId: string): Promise<{ locked: false } & InterviewSessionReport> =>
  callDedicated(async () => {
    const fn = httpsCallable<any, { locked: false } & InterviewSessionReport>(firebaseFunctions, 'mockInterview', { timeout: 190_000 });
    const res = await fn({ mode: 'unlock_report', reportId });
    return res.data;
  }, undefined, false);

// ---- Career coach chat (stateless callable) --------------------------------
export interface CoachMessage { role: 'user' | 'model'; content: string }

export const careerCoach = async (payload: {
  messages: CoachMessage[];
  role?: 'candidate' | 'employer' | null;
  resumeText?: string;
  companyName?: string | null;
  companyWebsite?: string | null;
  companyDescription?: string | null;
}): Promise<string> => {
  const outputLanguage = getUiLanguage();
  const requestPayload = { outputLanguage, ...payload, ...modelPayload() };
  return callDedicated(async () => {
    const fn = httpsCallable<any, { reply: string }>(firebaseFunctions, 'careerCoach', { timeout: 190_000 });
    const res = await fn({ ...requestPayload, requestId: makeCallableRequestId('career_coach') });
    return res.data.reply;
  }, `careerCoach:${stableStringify(requestPayload)}`);
};

// ---- Resume analysis (dedicated callable) ----------------------------------
export const analyzeResume = async (
  resumeText: string,
  resumeImages: ResumeImage[] | null,
  marketName: string,
  outputLanguage?: string,
): Promise<AnalysisResult & { extractedText?: string }> => {
  return callDedicated(async () => {
    const fn = httpsCallable<any, AnalysisResult & { extractedText?: string }>(firebaseFunctions, 'analyzeResume', { timeout: 190_000 });
    const res = await fn({
      resumeText,
      resumeImages: resumeImages ?? undefined,
      marketName,
      outputLanguage,
      ...modelPayload(),
      requestId: makeCallableRequestId('resume_analysis'),
    });
    return res.data;
    // Content-based dedupeKey collapses concurrent/rapid re-submits into one
    // in-flight request so a double-click cannot mint two requestIds and be
    // charged twice server-side (mirrors generateCoverLetter / careerPath).
  }, `resumeAnalysis:${currentModelId ?? ''}:${stableStringify({ resumeText, resumeImages, marketName, outputLanguage })}`);
};

// Model routing is platform-managed. The only client override is the business
// custom endpoint, represented by the reserved "custom" id.
const MODEL_STORAGE_KEY = 'preferred_ai_model';
const _stored = typeof localStorage !== 'undefined' ? localStorage.getItem(MODEL_STORAGE_KEY) : null;
let currentModelId: string | undefined = _stored === 'custom' ? 'custom' : undefined;

// The callable encoder serializes undefined to null, and hardened handlers
// reject a null model. Spread this instead of passing model directly so the
// platform-managed default omits the field entirely.
function modelPayload(): { model?: string } {
  return currentModelId ? { model: currentModelId } : {};
}

export function getEffectiveAiModelId(): string | undefined {
  return currentModelId;
}

export const setAiModel = (id: string | undefined): void => {
  currentModelId = id === 'custom' ? 'custom' : undefined;
  try {
    if (currentModelId) localStorage.setItem(MODEL_STORAGE_KEY, currentModelId);
    else localStorage.removeItem(MODEL_STORAGE_KEY);
  } catch { /* localStorage may be unavailable */ }
};

export interface ModelOption { id: string; label: string; minTier: 'free' | 'paid' | 'business' | 'premium' }

/** Shape returned by the listModels callable. */
export interface ListModelsResult {
  tier: 'free' | 'paid' | 'business' | string;
  defaultModelId: string;
  models: ModelOption[];
  isBusiness?: boolean;
}

const DEFAULT_MODEL_OPTIONS: ModelOption[] = [
  { id: 'gemini', label: 'Gemini (default)', minTier: 'free' },
];

/** Returns the models the current user is allowed to select, plus the default. */
export const listModels = async (): Promise<ListModelsResult> => {
  try {
    const fn = httpsCallable<Record<string, never>, ListModelsResult>(firebaseFunctions, 'listModels');
    const res = await fn({});
    return res.data;
  } catch {
    // listModels is a new callable whose Cloud Run invoker may not be set yet.
    return { tier: 'free', defaultModelId: 'gemini', models: DEFAULT_MODEL_OPTIONS, isBusiness: false };
  }
};

// ---- Business custom LLM config --------------------------------------------

export interface SetBusinessLlmConfigPayload {
  base_url: string;
  api_key: string;
  model: string;
}

export type BusinessLlmConfigResult =
  | { configured: false }
  | { configured: true; base_url: string; model: string; api_key_masked: string };

/** Saves the business-tier custom LLM endpoint. Throws for non-business users or bad input. */
export const setBusinessLlmConfig = async (payload: SetBusinessLlmConfigPayload): Promise<{ success: true }> => {
  const fn = httpsCallable<SetBusinessLlmConfigPayload, { success: true }>(firebaseFunctions, 'setBusinessLlmConfig');
  const res = await fn(payload);
  return res.data;
};

/** Retrieves the saved business-tier custom LLM config (api_key_masked only — raw key is never returned). */
export const getBusinessLlmConfig = async (): Promise<BusinessLlmConfigResult> => {
  const fn = httpsCallable<Record<string, never>, BusinessLlmConfigResult>(firebaseFunctions, 'getBusinessLlmConfig');
  const res = await fn({});
  return res.data;
};

// ---- Employer talent discovery (server-side; resumes never reach the browser) --

export interface DiscoveredCandidate {
  id: string;
  nft_staked: boolean;
  compatibilityScore: number;
  summary: string;
  strengths: string[];
  potentialGaps: string[];
  suggestedQuestions: string[];
}

export interface DiscoverTalentResult {
  candidates: DiscoveredCandidate[];
  scanned?: number;
  eligible?: number;
  failures?: number;
  analysisStatus?: 'complete' | 'partial';
}

/**
 * Server-side talent search. Without a jobDescription it returns the verified
 * (staked) rail; with one it returns AI-scored matches. Candidate resume text
 * stays on the server — clients are rules-blocked from reading other profiles.
 */
export const discoverTalent = (jobDescription?: string): Promise<DiscoverTalentResult> =>
  callDedicated(async () => {
    const fn = httpsCallable<{ jobDescription?: string; requestId?: string }, DiscoverTalentResult>(firebaseFunctions, 'discoverTalent');
    const res = await fn(jobDescription
      ? { jobDescription, requestId: makeCallableRequestId('discover_talent') }
      : {});
    return res.data;
  }, jobDescription ? `discoverTalent:${stableStringify({ jobDescription })}` : undefined, Boolean(jobDescription));

// ---- Employer applicant funnel (server-side; resumes never reach the browser) --

export interface JobApplicant {
  id: string;
  candidate_name: string;
  application_date: string | null;
  status: string;
  compatibility_score: number | null;
  summary: string;
  strengths: string[];
  potentialGaps: string[];
  suggestedQuestions: string[];
  analysis_status: 'complete' | 'failed' | 'not_requested' | 'no_context' | 'not_analyzed_cap';
  talent_profile: TalentProfile | null;
  status_history: ApplicationStatusHistoryEvent[];
  screener_answers: { question_id: string; prompt: string; answer: string }[];
}

export interface ListJobApplicantsResult {
  applicants: JobApplicant[];
  /** True when the posting exceeded the bounded applicant review page. */
  applicants_truncated?: boolean;
  /** True when a pathological job exceeded the server's bounded audit-history read. */
  status_history_truncated?: boolean;
}

export interface UpdateApplicationStatusResult {
  applicationId: string;
  previousStatus: string;
  status: string;
  action: ApplicationStatusAction;
  skippedStatuses: string[];
  eventId: string | null;
  changed: boolean;
}

export type ApplicationStatusAction = 'advance' | 'skip' | 'reject' | 'reopen';

export type BulkApplicationStatusAction = 'advance' | 'reject';

export interface BulkApplicationStatusItemResult {
  applicationId: string;
  ok: boolean;
  status?: string;
  action?: ApplicationStatusAction;
  changed?: boolean;
  eventId?: string | null;
  messageId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface BulkApplicationStatusResult {
  total: number;
  succeeded: number;
  failed: number;
  results: BulkApplicationStatusItemResult[];
}

export interface ApplicationStatusHistoryEvent {
  id: string | null;
  action: string | null;
  from_status: string;
  to_status: string;
  reason: string | null;
  candidate_note: string | null;
  skipped_statuses: string[];
  created_at: string | null;
}

/**
 * Returns the applicants for a job the caller owns, each with a server-computed
 * match analysis. Resume text stays on the server (clients are rules-blocked
 * from reading other profiles); viewing applicants is free (no wallet unlock).
 */
export const listJobApplicants = (jobId: string, options: { includeAnalysis?: boolean } = {}): Promise<ListJobApplicantsResult> =>
  callDedicated(async () => {
    const fn = httpsCallable<{ jobId: string; includeAnalysis?: boolean; requestId?: string }, ListJobApplicantsResult>(firebaseFunctions, 'listJobApplicants', { timeout: 190_000 });
    const res = await fn({ jobId, ...options, requestId: makeCallableRequestId('list_job_applicants') });
    return res.data;
  }, `listJobApplicants:${jobId}:${options.includeAnalysis !== false ? 'analysis' : 'basic'}`, false);

export const updateApplicationStatus = (
  applicationId: string,
  status: string,
  reason = '',
  candidateNote = '',
  action?: ApplicationStatusAction,
): Promise<UpdateApplicationStatusResult> =>
  callDedicated(async () => {
    const fn = httpsCallable<
      { applicationId: string; status: string; reason?: string; candidateNote?: string; action?: ApplicationStatusAction },
      UpdateApplicationStatusResult
    >(firebaseFunctions, 'updateApplicationStatus', { timeout: 60_000 });
    const res = await fn({ applicationId, status, reason, candidateNote, action });
    return res.data;
  }, undefined, false);

export const bulkUpdateApplicationStatus = (
  applicationIds: string[],
  action: BulkApplicationStatusAction,
  options: {
    reason?: string;
    candidateNote?: string;
    notify?: boolean;
    messageBody?: string;
    templateKey?: string;
  } = {},
): Promise<BulkApplicationStatusResult> =>
  callDedicated(async () => {
    const fn = httpsCallable<
      {
        applicationIds: string[];
        action: BulkApplicationStatusAction;
        reason?: string;
        candidateNote?: string;
        notify?: boolean;
        messageBody?: string;
        templateKey?: string;
      },
      BulkApplicationStatusResult
    >(firebaseFunctions, 'bulkUpdateApplicationStatus', { timeout: 120_000 });
    const res = await fn({ applicationIds, action, ...options });
    return res.data;
  }, undefined, false);

export interface ApplicantResumeFile {
  available: boolean;
  url?: string;
  fileName?: string;
  contentType?: string;
  base64?: string;
}

/**
 * Downloads the original resume FILE of a candidate who applied to a job the
 * caller owns (verified server-side). Returns { available: false } when the
 * applicant only submitted text and never uploaded a file. Talent-discovery
 * (passive) candidates are not downloadable — applicants only.
 */
export const getApplicantResumeFile = (applicationId: string): Promise<ApplicantResumeFile> =>
  callDedicated(async () => {
    const fn = httpsCallable<{ applicationId: string }, ApplicantResumeFile>(firebaseFunctions, 'getApplicantResumeFile', { timeout: 120_000 });
    const res = await fn({ applicationId });
    return res.data;
  }, undefined, false);

/**
 * Returns the resume TEXT of a candidate who applied to a job the caller owns
 * (same server-side authorization as getApplicantResumeFile). Lets the
 * job-owning employer read the applicant's resume inline. Empty string when the
 * applicant has no stored resume_text.
 */
export const getApplicantResumeText = (applicationId: string): Promise<{ resumeText: string }> =>
  callDedicated(async () => {
    const fn = httpsCallable<{ applicationId: string }, { resumeText: string }>(firebaseFunctions, 'getApplicantResumeText', { timeout: 60_000 });
    const res = await fn({ applicationId });
    return res.data;
  }, undefined, false);

/**
 * Dispatches a long-tail tool through the consolidated `aiProxy` callable, which
 * applies tier-gated model routing (Gemini / KairLLM / DeepSeek / custom). The
 * legacy per-tool functions are Gemini-only and ignore the selected model — this
 * is why selecting KairLLM/DeepSeek used to have no effect. aiProxy returns
 * `{ data, groundingChunks, meta }`; unparseable/unstructured responses may also
 * include `text`. The parsed result is `.data`.
 */
async function callTool<T>(tool: string, payload: Record<string, unknown>): Promise<T> {
  try {
    return await callAiProxy<{ data?: T; text?: string; groundingChunks?: unknown; meta?: unknown }, T>(
      'plain',
      tool,
      payload,
      (data) => {
        if (data?.data === undefined || data.data === null) {
          throw new Error(translateError('ai_error_empty_response', 'The AI returned an empty or unparseable response. Please try again.'));
        }
        return data.data;
      }
    );
  } catch (err) {
    reportApiStatusFromError(err);
    throw new Error(formatCallableError(err));
  }
}

/** Like callTool, but merges aiProxy's separate groundingChunks back into the result. */
async function callToolWithGrounding<T>(tool: string, payload: Record<string, unknown>): Promise<T> {
  try {
    return await callAiProxy<{ data?: Record<string, unknown>; text?: string; groundingChunks?: unknown; meta?: unknown }, T>(
      'grounding',
      tool,
      payload,
      (data) => {
        const parsed = data?.data;
        if (parsed === undefined || parsed === null) {
          throw new Error(translateError('ai_error_empty_response', 'The AI returned an empty or unparseable response. Please try again.'));
        }
        return { ...(parsed as object), groundingChunks: data?.groundingChunks } as T;
      }
    );
  } catch (err) {
    reportApiStatusFromError(err);
    throw new Error(formatCallableError(err));
  }
}

// ---- Resume / cover letter / career path (dedicated callables) -------------
export const applyResumeImprovements = (resumeText: string, improvements: Improvement[]) =>
  callTool<{ updatedResumeText: string }>('applyResumeImprovements', { resumeText, improvements });

/** Parses a resume into the structured Talent Profile shape (keys match lib/talentProfile.ts). */
export interface ExtractedTalentProfile {
  basic?: Record<string, string>;
  intention?: Record<string, string>;
  education?: Record<string, string | string[]>[];
  experience?: Record<string, string | string[]>[];
  projects?: Record<string, string | string[]>[];
  skills?: Record<string, string[]>;
  awards?: Record<string, string | string[]>[];
  portfolio?: Record<string, string | string[]>[];
  additional?: Record<string, string>;
}
export const extractTalentProfile = (resumeText: string, options?: { targetLanguage?: string }) =>
  callTool<ExtractedTalentProfile>('extractTalentProfile', { resumeText, targetLanguage: options?.targetLanguage ?? 'en' });

export const convertResumeFormat = (resumeText: string, marketName: string, coverLetterText?: string, outputLanguage?: string, jobDescription?: string) =>
  callTool<FormattedResume>('convertResumeFormat', { resumeText, marketName, coverLetterText, outputLanguage, jobDescription });

export const generateCoverLetter = async (resumeText: string, jobDescription: string, marketName: string, outputLanguage?: string): Promise<CoverLetter> =>
  callDedicated(async () => {
    const fn = httpsCallable<any, CoverLetter>(firebaseFunctions, 'generateCoverLetter', { timeout: 190_000 });
    const res = await fn({
      resumeText,
      jobDescription,
      marketName,
      outputLanguage,
      ...modelPayload(),
      requestId: makeCallableRequestId('cover_letter'),
    });
    return res.data;
  }, `coverLetter:${currentModelId ?? ''}:${stableStringify({ resumeText, jobDescription, marketName, outputLanguage })}`);

export const generateCareerPath = async (
  resumeText: string,
  desiredRole: string,
  marketName: string,
  _session?: Session,
  outputLanguage?: string,
): Promise<CareerPathResult> =>
  callDedicated(async () => {
    const fn = httpsCallable<any, CareerPathResult>(firebaseFunctions, 'generateCareerPath', { timeout: 190_000 });
    const res = await fn({
      resumeText,
      desiredRole,
      marketName,
      outputLanguage: outputLanguage ?? getUiLanguage(),
      ...modelPayload(),
      requestId: makeCallableRequestId('career_path'),
    });
    return res.data;
  }, `careerPath:${currentModelId ?? ''}:${stableStringify({ resumeText, desiredRole, marketName, outputLanguage: outputLanguage ?? getUiLanguage() })}`);

// ---- Matching / opportunities ---------------------------------------------
export const calculateCompatibility = (resumeText: string, jobDescription: string) =>
  callTool<{ compatibilityScore: number; summary: string; candidateName?: string }>('calculateCompatibility', { resumeText, jobDescription });

export const findOpportunities = (resumeText: string, marketName: string, _session: Session | null) =>
  callToolWithGrounding<OpportunityResult>('findOpportunities', { resumeText, marketName });

// ---- LinkedIn --------------------------------------------------------------
export const optimizeLinkedInProfile = (resumeText: string, marketName: string) =>
  callTool<LinkedInOptimization>('optimizeLinkedInProfile', { resumeText, marketName });

export const optimizeLinkedInProfileFromText = (profileText: string, resumeText: string, marketName: string, customPrompt?: string, additionalUrl?: string) =>
  callTool<LinkedInOptimization>('optimizeLinkedInProfileFromText', { profileText, resumeText, marketName, customPrompt, additionalUrl });

// ---- Career path helpers ---------------------------------------------------
export const generateSkillBridgeProject = (resumeText: string, desiredRole: string, skill: string) =>
  callTool<SkillBridgeProject>('generateSkillBridgeProject', { resumeText, desiredRole, skill });

// ---- Agile -----------------------------------------------------------------
export const generateAgilePracticeTest = (agileRole: string, agileCertification: string) =>
  callTool<AgilePracticeTestResult>('generateAgilePracticeTest', { agileRole, agileCertification });

// ---- Salary ----------------------------------------------------------------
export const generateSalaryNegotiationStrategy = (resumeText: string, jobTitle: string, company: string, location: string, currentOffer: string, currency: string) =>
  callToolWithGrounding<SalaryNegotiationResult & { groundingChunks: any[] | undefined }>('generateSalaryNegotiationStrategy', { resumeText, jobTitle, company, location, currentOffer, currency });

// ---- EnglishPro ------------------------------------------------------------
export const analyzeEnglishProficiency = (emailText: string, nativeLanguage: string, targetIeltsBand: string) =>
  callTool<EnglishProResult>('analyzeEnglishProficiency', { emailText, nativeLanguage, targetIeltsBand });

export const generateSpeakingTopics = (targetIeltsBand: string) =>
  callTool<{ topics: string[] }>('generateSpeakingTopics', { targetIeltsBand });

export const analyzeSpokenEnglish = (transcript: string, durationSeconds: number, targetIeltsBand: string) =>
  callTool<SpokenEnglishAnalysisResult>('analyzeSpokenEnglish', { transcript, durationSeconds, targetIeltsBand });

export const generateReadingPracticePassage = (targetIeltsBand: string) =>
  callTool<ReadingPracticePassage>('generateReadingPracticePassage', { targetIeltsBand });

export const analyzeEnglishReading = (textToAnalyze: string, targetIeltsBand: string) =>
  callTool<EnglishReadingAnalysisResult>('analyzeEnglishReading', { textToAnalyze, targetIeltsBand });

export const evaluateReadingComprehension = (originalText: string, questionsAndAnswers: ComprehensionQuestion[], userAnswers: string[]) =>
  callTool<ReadingEvaluation[]>('evaluateReadingComprehension', { originalText, questionsAndAnswers, userAnswers });

export const analyzeEnglishListening = (originalText: string, userTranscription: string, targetIeltsBand: string) =>
  callTool<EnglishListeningAnalysisResult>('analyzeEnglishListening', { originalText, userTranscription, targetIeltsBand });

export const generateVocabularyFlashcards = (targetIeltsBand: string) =>
  callTool<{ cards: VocabularyFlashcard[] }>('generateVocabularyFlashcards', { targetIeltsBand });

// ---- Email -----------------------------------------------------------------
export const generateProfessionalEmail = (resumeText: string, scenario: string, details: { [key: string]: string }, marketName: string, tone: number, style: number, confidence: number) =>
  callTool<ProfessionalEmailResult>('generateProfessionalEmail', { resumeText, scenario, details, marketName, tone, style, confidence });

export const generateOutreachEmail = (candidateResumeText: string, jobDescription: string, employerProfile: UserProfile, marketName: string) =>
  callTool<ProfessionalEmailResult>('generateOutreachEmail', { candidateResumeText, jobDescription, employerProfile, marketName });

// ---- Portfolio -------------------------------------------------------------
export const generatePortfolioWebsite = (resumeText: string) =>
  callTool<PortfolioContent>('generatePortfolioWebsite', { resumeText });

// ---- Dashboard / employer helpers ------------------------------------------
export const generateWeeklySummary = (data: any) =>
  callTool<{ summary: string }>('generateWeeklySummary', { data });

export const generateJobDescription = (jobTitle: string, keyResponsibilities: string, companyName: string, companyDescription: string) =>
  callTool<{ jobDescription: string }>('generateJobDescription', { jobTitle, keyResponsibilities, companyName, companyDescription });

export const analyzeSalary = (jobTitle: string, location: string, jobDescription: string) =>
  callTool<{ yearlySalary: string; monthlySalary: string; sources?: string[]; notice?: string }>('analyzeSalary', { jobTitle, location, jobDescription });

export const checkInclusivity = (jobDescription: string) =>
  callTool<{ suggestions: InclusivitySuggestion[] }>('checkInclusivity', { jobDescription });

export const formatJobDescription = (jobDescription: string) =>
  callTool<{ formattedDescription: string; jobTitle: string; location: string }>('formatJobDescription', { jobDescription });

export const analyzeCandidateMatch = (resumeText: string, jobDescription: string) =>
  callTool<CandidateMatchAnalysis>('analyzeCandidateMatch', { resumeText, jobDescription });

// ---- Networking / performance / learning -----------------------------------
export const generateNetworkingStrategy = (resumeText: string, targetCompany: string, targetRole: string, targetLocation: string, marketName: string) =>
  callTool<NetworkingStrategyResult>('generateNetworkingStrategy', { resumeText, targetCompany, targetRole, targetLocation, marketName });

export const generatePerformanceReviewPrep = (resumeText: string, userAccomplishments: string, jobTitle: string) =>
  callTool<PerformanceReviewResult>('generatePerformanceReviewPrep', { resumeText, userAccomplishments, jobTitle });

export const generateLearningPlan = (resumeText: string, skillToLearn: string, marketName: string) =>
  callTool<LearningPlanResult>('generateLearningPlan', { resumeText, skillToLearn, marketName });

export const findIndustryEvents = (fieldOfInterest: string, location: string) =>
  callToolWithGrounding<EventScoutResult>('findIndustryEvents', { fieldOfInterest, location });

// ---- Agency ----------------------------------------------------------------
export const anonymizeResume = (resumeText: string, agencyName?: string) =>
  callTool<{ anonymizedText: string }>('anonymizeResume', { resumeText, agencyName });

export const generateClientPitchEmail = (candidateResumeText: string, candidateName: string, jobDescription?: string) =>
  callTool<{ subject: string; body: string }>('generateClientPitchEmail', { candidateResumeText, candidateName, jobDescription });

/**
 * Builds an evidence-driven interview prep kit from a resume + target role.
 *
 * Shared by the agency Candidate Prep Kit (passes only resumeText + jobDescription)
 * and the candidate Interview Prep tool (passes targetRole / marketName for
 * localized, role-anchored output and optional sourceNotes — pasted real
 * interview reports — that let the model mark questions "source-backed").
 */
export const generateCandidatePrepKit = (
  resumeText: string,
  jobDescription: string,
  options?: { targetRole?: string; marketName?: string; sourceNotes?: string },
) =>
  callTool<CandidatePrepKit>('generateCandidatePrepKit', {
    resumeText,
    jobDescription,
    ...(options?.targetRole ? { targetRole: options.targetRole } : {}),
    ...(options?.marketName ? { marketName: options.marketName } : {}),
    ...(options?.sourceNotes ? { sourceNotes: options.sourceNotes } : {}),
  });

// ---- Image generation & URL extraction (dedicated callables) ---------------
export interface GeneratedHeadshot {
  data: string;
  mimeType: string;
}

export const generateProfessionalHeadshot = async (imageBase64: string): Promise<GeneratedHeadshot[]> =>
  callDedicated(async () => {
    // Legacy production name is generateProfessionalHeadshot (IAM already set).
    const fn = httpsCallable<any, { images: GeneratedHeadshot[] }>(firebaseFunctions, 'generateProfessionalHeadshot', { timeout: 190_000 });
    const res = await fn({ imageBase64, requestId: makeCallableRequestId('headshot') });
    return res.data.images;
  }, `headshot:${stableStringify({ imageBase64 })}`);

export const extractTextFromUrl = async (url: string): Promise<{ extractedText: string }> => {
  const requestPayload = { url, ...modelPayload() };
  return callDedicated(async () => {
    const fn = httpsCallable<any, { extractedText: string }>(firebaseFunctions, 'extractTextFromUrl');
    const res = await fn({ ...requestPayload, requestId: makeCallableRequestId('extract_url') });
    return res.data;
  }, `extractTextFromUrl:${stableStringify(requestPayload)}`);
};
