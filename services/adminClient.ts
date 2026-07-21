/**
 * Admin portal API — all calls go through gated Cloud Functions (requireAdmin).
 */

import { httpsCallable } from 'firebase/functions';
import { firebaseFunctions } from '../lib/firebaseClient';

const call = <Req, Res>(name: string) =>
  httpsCallable<Req, Res>(firebaseFunctions, name);

export interface AdminDashboard {
  user_count: number;
  users_truncated?: boolean;
  today_runs: number;
  today_credits: number;
  week_tool_breakdown: Record<string, { runs: number; credits: number }>;
  week_usage_truncated?: boolean;
  // Uncharged tools (careerCoach/discoverTalent/listJobApplicants/generateHeadshot):
  // call volume only, never billed or capped.
  free_tool_breakdown?: Record<string, { runs: number }>;
  free_usage_truncated?: boolean;
  top_users_week: { uid: string; credits_spent: number }[];
  recent_events: Array<Record<string, unknown>>;
  pending_usage_counter_reviews?: number;
  pending_usage_counter_reviews_truncated?: boolean;
  quotas: Record<string, unknown>;
}

export interface AdminUserRow {
  uid: string;
  email: string | null;
  full_name: string | null;
  avatar_url?: string | null;
  role: string | null;
  subscription_status: string | null;
  credits: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface AdminUserFilters {
  search?: string;
  roles?: string[];
  plans?: string[];
  created_after?: string;
}

export const adminCheckAccess = () =>
  call<Record<string, never>, { admin: boolean; uid?: string }>('adminCheckAccess')({}).then((r) => r.data);

export const adminWhoAmI = () =>
  call<Record<string, never>, { role: 'super' | 'admin' | 'reviewer' }>('adminWhoAmI')({}).then((r) => r.data);

export const adminGetDashboard = () =>
  call<Record<string, never>, AdminDashboard>('adminGetDashboard')({}).then((r) => r.data);

export const adminGetLlmConfig = () =>
  call<Record<string, never>, Record<string, string>>('adminGetLlmConfig')({}).then((r) => r.data);

export const adminUpdateLlmConfig = (payload: {
  gemini_api_key?: string;
  gemini_model?: string;
  gemini_fallback_model?: string;
  kairllm_api_key?: string;
  kairllm_base_url?: string;
  deepseek_api_key?: string;
  deepseek_base_url?: string;
}) => call<typeof payload, Record<string, string>>('adminUpdateLlmConfig')(payload).then((r) => r.data);

export type AdminPlanKey =
  | 'free'
  | 'essentials'
  | 'accelerator'
  | 'executive'
  | 'starter'
  | 'growth'
  | 'pro'
  | 'single_post'
  | 'job_pack';

export interface AdminPlanQuota {
  daily_run_limit: number;
  daily_credit_limit: number;
  monthly_credit_grant: number;
  active_job_limit: number;
}

export interface AdminToolQuota {
  enabled: boolean;
  credit_cost: number;
  allowed_plans: AdminPlanKey[];
}

export interface AdminQuotas {
  daily_tool_run_limit?: number;
  daily_credit_spend_limit?: number;
  per_user_daily_credit_limit?: number;
  enabled?: boolean;
  free_max_output_tokens?: number;
  mi_min_tier?: 'free' | 'paid';
  mi_report_unlock_credits?: number;
  plan_quotas?: Partial<Record<AdminPlanKey, Partial<AdminPlanQuota>>>;
  tool_quotas?: Record<string, Partial<AdminToolQuota>>;
  updated_at?: string;
  updated_by?: string;
}

export const adminGetQuotas = () =>
  call<Record<string, never>, AdminQuotas>('adminGetQuotas')({}).then((r) => r.data);

export const adminUpdateQuotas = (payload: {
  daily_tool_run_limit: number;
  daily_credit_spend_limit: number;
  per_user_daily_credit_limit: number;
  enabled: boolean;
  free_max_output_tokens?: number;
  mi_min_tier?: 'free' | 'paid';
  mi_report_unlock_credits?: number;
  plan_quotas?: Partial<Record<AdminPlanKey, Partial<AdminPlanQuota>>>;
  tool_quotas?: Record<string, Partial<AdminToolQuota>>;
}) => call<typeof payload, AdminQuotas>('adminUpdateQuotas')(payload).then((r) => r.data);

export const adminListUsers = (limit = 50, start_after_uid?: string, filters?: AdminUserFilters) =>
  call<
    { limit?: number; start_after_uid?: string } & AdminUserFilters,
    { users: AdminUserRow[]; next_cursor: string | null }
  >(
    'adminListUsers',
  )({ limit, start_after_uid, ...(filters ?? {}) }).then((r) => r.data);

export const adminGetUserReport = (uid: string) =>
  call<{ uid: string }, Record<string, unknown>>('adminGetUserReport')({ uid }).then((r) => r.data);

export const adminAdjustCredits = (uid: string, delta: number, reason: string) =>
  call<{ uid: string; delta: number; reason: string }, { uid: string; credits: number }>(
    'adminAdjustCredits',
  )({ uid, delta, reason }).then((r) => r.data);

/** Candidate + business plan keys an admin may assign. */
export const SUBSCRIPTION_PLANS = [
  'free',
  'essentials',
  'accelerator',
  'executive',
  'starter',
  'growth',
  'pro',
  'single_post',
  'job_pack',
] as const;

export const adminSetSubscription = (uid: string, subscription_status: string) =>
  call<{ uid: string; subscription_status: string }, { uid: string; subscription_status: string }>(
    'adminSetSubscription',
  )({ uid, subscription_status }).then((r) => r.data);

export interface AdminAccountDeletionCleanupItem {
  category: 'firestore_user_subcollection' | 'firestore_shared_record' | 'firestore_financial_record' | 'storage_prefix' | 'stripe_record';
  resource: string;
  selector: string;
  disposition: 'retain_pending_policy' | 'external_action_required';
  reason: string;
}

export interface AdminAccountDeletionResult {
  uid: string;
  email: string | null;
  deleted_auth: boolean;
  deleted_profile: boolean;
  deleted_private_credentials: boolean;
  auth_absent: boolean;
  profile_absent: boolean;
  pending_cleanup: AdminAccountDeletionCleanupItem[];
  already_deleted?: boolean;
}

export const adminDeleteUser = (args: { uid?: string; email?: string; reason: string }) =>
  call<typeof args, AdminAccountDeletionResult>(
    'adminDeleteUser',
  )(args).then((r) => r.data);

export interface AdminSampleAccount {
  kind: 'job_seeker' | 'employer';
  uid: string;
  email: string;
  password: string;
  role: string;
  subscription_status: string;
  credits: number;
  created: boolean;
}

export const adminCreateSampleAccounts = () =>
  call<Record<string, never>, { accounts: AdminSampleAccount[] }>(
    'adminCreateSampleAccounts',
  )({}).then((r) => r.data);

export interface AdminRow {
  uid: string;
  email: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  /** 'rbac' = portal-managed, 'legacy_doc' = old allowlist, 'env' = ADMIN_UIDS bootstrap. */
  source?: 'rbac' | 'legacy_doc' | 'env';
  /** New: role for role-aware admin system */
  role?: 'super' | 'admin' | 'reviewer';
  status?: string;
  invited_at?: string | null;
}

export const adminSetAdmin = (args: { uid?: string; email?: string; makeAdmin: boolean }) =>
  call<typeof args, { uid: string; email: string | null; admin: boolean; admin_uids: string[] }>(
    'adminSetAdmin',
  )(args).then((r) => r.data);

export const adminListAdmins = () =>
  call<Record<string, never>, { admins: AdminRow[] }>('adminListAdmins')({}).then((r) => r.data);

/** Super-only: invite a new admin or reviewer by email. */
export const adminInviteAdmin = (args: { email: string; role: 'admin' | 'reviewer' }) =>
  call<typeof args, { uid: string; email: string; role: string; status: string; invited_at: string }>(
    'adminInviteAdmin',
  )(args).then((r) => r.data);

/** Super-only: change the role of an existing admin. */
export const adminSetAdminRole = (args: { uid: string; role: 'admin' | 'reviewer' }) =>
  call<typeof args, { uid: string; role: string }>('adminSetAdminRole')(args).then((r) => r.data);

/** Super-only: remove an admin/reviewer. */
export const adminRemoveAdmin = (args: { uid: string }) =>
  call<typeof args, { uid: string }>('adminRemoveAdmin')(args).then((r) => r.data);

export interface AuditLogEntry {
  id: string;
  admin_uid: string;
  action: string;
  target_uid: string | null;
  details: Record<string, unknown>;
  created_at: string | null;
}

export const adminGetAuditLog = (limit = 25, start_after_id?: string) =>
  call<
    { limit?: number; start_after_id?: string },
    { entries: AuditLogEntry[]; next_cursor: string | null }
  >('adminGetAuditLog')({ limit, start_after_id }).then((r) => r.data);

// ─── Models ────────────────────────────────────────────────────────────────

export interface ModelEntry {
  /** Unique selection id — immutable once created (drives the user picker). */
  id: string;
  /** Display name shown in the user-facing model picker. */
  label: string;
  provider: 'gemini' | 'openai-compatible';
  /** Required for openai-compatible models without a builtin. Must be https. */
  base_url?: string;
  /**
   * OpenAI-compatible API key (legacy single-key).
   * On a list response this is a masked preview like "ab12••••wxyz".
   * On upsert, sending an empty string keeps the stored key unchanged.
   */
  api_key?: string;
  /**
   * Multi-key pool. Masked from server on list responses.
   * On upsert: existing saved keys are not echoed back; supplied entries are
   * appended and de-duplicated server-side.
   */
  api_keys?: string[];
  api_key_hash?: string;
  api_key_hashes?: string[];
  key_previews?: {
    hash: string;
    masked: string;
    index: number;
    source: 'api_key' | 'api_keys' | 'builtin';
  }[];
  /** True when the model accepts inline image parts (multimodal). */
  supportsImageInput?: boolean;
  /** Ordered list of model ids to fall back to when this model fails. */
  fallbackChain?: string[];
  /** Read-only admin preview; omitted when an explicit fallbackChain is configured. */
  implicitFallbackPreviewByTier?: Record<'free' | 'paid' | 'business', string[]>;
  /** Numeric routing priority (lower = higher priority). */
  priority?: number;
  /** Platform-managed builtin — inherits key/base from platform_config/llm. */
  builtin?: 'kairllm' | 'deepseek';
  /** Model name forwarded to the provider. Empty string = provider default. */
  providerModel: string;
  minTier: 'free' | 'paid' | 'business';
  enabled: boolean;
  /** Optional per-key health info if server includes it. */
  health?: { keyIndex: number; ok: boolean; latencyMs?: number; checkedAt?: string }[];
  /** Lightweight key-pool health from platform_config/key_health (best-effort, may be absent). */
  keyHealth?: {
    failureCount?: number;
    cooldownUntil?: string | null;
    lastErrorCode?: string | null;
    lastFailureAt?: string | null;
    anyCooled?: boolean;
  };
}

export interface RoutingPoolMember {
  modelId: string;
  keyHash?: string;
  tier: number;
  weight: number;
  enabled: boolean;
}

export interface RoutingPool {
  id: string;
  label: string;
  enabled: boolean;
  members: RoutingPoolMember[];
}

export type ModuleRoutes = Record<string, string>;

export const MODULE_ROUTE_TOOL_LABELS: Record<string, string> = {
  careerCoach: 'Career coach',
  mockInterview: 'Mock interview',
  analyzeResume: 'Resume analysis',
  generateCoverLetter: 'Cover letter',
  generateCareerPath: 'Career path',
  extractTalentProfile: 'Talent Profile extraction',
  applyResumeImprovements: 'Resume deep optimization',
  convertResumeFormat: 'Resume formatter',
  calculateCompatibility: 'Resume match',
  findOpportunities: 'Opportunity finder',
  optimizeLinkedInProfile: 'LinkedIn optimizer',
  optimizeLinkedInProfileFromText: 'LinkedIn profile text optimizer',
  generateSkillBridgeProject: 'Skill bridge project',
  generateAgilePracticeTest: 'Agile coach',
  generateSalaryNegotiationStrategy: 'Salary negotiator',
  analyzeEnglishProficiency: 'English Pro writing',
  generateSpeakingTopics: 'English Pro speaking topics',
  analyzeSpokenEnglish: 'English Pro speaking analysis',
  generateReadingPracticePassage: 'English Pro reading passage',
  analyzeEnglishReading: 'English Pro reading analysis',
  evaluateReadingComprehension: 'English Pro comprehension grading',
  analyzeEnglishListening: 'English Pro listening analysis',
  generateVocabularyFlashcards: 'English Pro vocabulary cards',
  generateProfessionalEmail: 'Email crafter',
  generateOutreachEmail: 'Employer outreach email',
  generatePortfolioWebsite: 'Portfolio website builder',
  generateWeeklySummary: 'Dashboard weekly summary',
  generateJobDescription: 'Employer job description',
  analyzeSalary: 'Employer salary estimate',
  checkInclusivity: 'Employer inclusivity check',
  formatJobDescription: 'Employer job description formatter',
  analyzeCandidateMatch: 'Applicant/candidate match',
  generateNetworkingStrategy: 'Networking assistant',
  generatePerformanceReviewPrep: 'Performance review prep',
  generateLearningPlan: 'Skill learning planner',
  findIndustryEvents: 'Industry event scout',
  anonymizeResume: 'Agency resume anonymizer',
  generateClientPitchEmail: 'Agency client pitch email',
  generateCandidatePrepKit: 'Candidate prep kit',
  discoverTalent: 'Employer talent discovery',
  listJobApplicants: 'Employer applicant funnel',
  extractTextFromUrl: 'URL resume import',
  apiResumeAnalyze: 'Public API resume analysis',
  apiCoverLetter: 'Public API cover letter',
};

export const MODULE_ROUTE_GROUPS = [
  { key: 'career_coach', label: 'Career coach', routes: ['careerCoach'] },
  { key: 'mock_interview', label: 'Mock interview', routes: ['mockInterview'] },
  { key: 'resume_analysis', label: 'Resume analysis', routes: ['analyzeResume', 'applyResumeImprovements', 'extractTalentProfile'] },
  { key: 'cover_letter', label: 'Cover letter', routes: ['generateCoverLetter'] },
  { key: 'career_path', label: 'Career path', routes: ['generateCareerPath', 'generateSkillBridgeProject', 'generateLearningPlan'] },
  { key: 'resume_formatter', label: 'Resume formatter', routes: ['convertResumeFormat', 'extractTextFromUrl'] },
  { key: 'job_search', label: 'Job search & matching', routes: ['findOpportunities', 'calculateCompatibility'] },
  { key: 'linkedin', label: 'LinkedIn optimizer', routes: ['optimizeLinkedInProfile', 'optimizeLinkedInProfileFromText'] },
  { key: 'salary', label: 'Salary negotiator', routes: ['generateSalaryNegotiationStrategy'] },
  {
    key: 'english_pro',
    label: 'English Pro',
    routes: [
      'analyzeEnglishProficiency',
      'generateSpeakingTopics',
      'analyzeSpokenEnglish',
      'generateReadingPracticePassage',
      'analyzeEnglishReading',
      'evaluateReadingComprehension',
      'analyzeEnglishListening',
      'generateVocabularyFlashcards',
    ],
  },
  { key: 'email', label: 'Email & outreach', routes: ['generateProfessionalEmail', 'generateOutreachEmail'] },
  { key: 'portfolio', label: 'Portfolio website', routes: ['generatePortfolioWebsite'] },
  {
    key: 'employer_posting',
    label: 'Employer job posting',
    routes: ['generateJobDescription', 'analyzeSalary', 'checkInclusivity', 'formatJobDescription'],
  },
  {
    key: 'employer_talent',
    label: 'Employer talent & applicants',
    routes: ['analyzeCandidateMatch', 'discoverTalent', 'listJobApplicants'],
  },
  { key: 'networking_events', label: 'Networking & events', routes: ['generateNetworkingStrategy', 'findIndustryEvents'] },
  { key: 'performance_review', label: 'Performance review prep', routes: ['generatePerformanceReviewPrep'] },
  { key: 'agile', label: 'Agile coach', routes: ['generateAgilePracticeTest'] },
  { key: 'agency', label: 'Agency hub', routes: ['anonymizeResume', 'generateClientPitchEmail', 'generateCandidatePrepKit'] },
  { key: 'reporting_api', label: 'Reporting & public API', routes: ['generateWeeklySummary', 'apiResumeAnalyze', 'apiCoverLetter'] },
] as const;

export const normalizeModelRouting = (
  _models: ModelEntry[],
  routingPools?: RoutingPool[],
  moduleRoutes?: ModuleRoutes,
) => {
  if (!routingPools || !moduleRoutes) {
    throw new Error('The deployed admin API does not provide the authoritative model-routing contract. Update the backend before editing routing.');
  }
  return { routingPools, moduleRoutes };
};

export const adminListModels = () =>
  call<Record<string, never>, {
    models: ModelEntry[];
    defaultModelId: string | null;
    routingPools?: RoutingPool[];
    moduleRoutes?: ModuleRoutes;
  }>(
    'adminListModels',
  )({}).then((r) => r.data);

/** Super-only: set the platform default model for auto-routing. */
export const adminSetDefaultModel = (id: string) =>
  call<{ id: string }, { ok: true; defaultModelId: string }>(
    'adminSetDefaultModel',
  )({ id }).then((r) => r.data);

export type ModelClearableField =
  | 'builtin'
  | 'base_url'
  | 'api_key'
  | 'api_keys'
  | 'fallbackChain'
  | 'priority'
  | 'supportsImageInput';

export interface ModelUpsertMutation {
  /** Optional stored fields to remove. Omission always means preserve on update. */
  clearFields?: ModelClearableField[];
}

export const adminUpsertModel = (model: ModelEntry, mutation: ModelUpsertMutation = {}) =>
  call<{ model: ModelEntry; clearFields?: ModelClearableField[] }, { models: ModelEntry[] }>('adminUpsertModel')({
    model,
    ...(mutation.clearFields?.length ? { clearFields: mutation.clearFields } : {}),
  }).then(
    (r) => r.data,
  );

export const adminDeleteModel = (id: string) =>
  call<{ id: string }, { models: ModelEntry[] }>('adminDeleteModel')({ id }).then((r) => r.data);

export const adminUpdateModelRouting = (input: {
  routingPools: RoutingPool[];
  moduleRoutes: ModuleRoutes;
}) =>
  call<typeof input, { routingPools: RoutingPool[]; moduleRoutes: ModuleRoutes }>(
    'adminUpdateModelRouting',
  )(input).then((r) => r.data);

export interface TestModelResult {
  ok: boolean;
  text?: string;
  latencyMs?: number;
  error?: string;
}

export type TestModelInput =
  | { id: string; keyIndex?: number; keyHash?: string }
  | {
      config: {
        provider: 'gemini' | 'openai-compatible';
        base_url?: string;
        api_key?: string;
        builtin?: 'kairllm' | 'deepseek';
        providerModel?: string;
      };
    };

export const adminTestModel = (input: TestModelInput): Promise<TestModelResult> =>
  call<TestModelInput, TestModelResult>('adminTestModel')(input).then((r) => r.data);

// ─── Prompts ───────────────────────────────────────────────────────────────

/** A single prompt entry as returned by adminGetPrompts. */
export interface PromptEntry {
  /** Unique key, e.g. "convertResumeFormat" or "handler_career_coach_candidate". */
  key: string;
  /** The compiled-in default template (read-only from the admin's perspective). */
  default: string;
  /** Admin-supplied override, or null when the default is in effect. */
  override: string | null;
}

export const adminGetPrompts = () =>
  call<Record<string, never>, { prompts: PromptEntry[] }>('adminGetPrompts')({}).then(
    (r) => r.data,
  );

export const adminUpdatePrompt = (key: string, template: string) =>
  call<{ key: string; template: string }, { key: string; override: string }>(
    'adminUpdatePrompt',
  )({ key, template }).then((r) => r.data);

export const adminResetPrompt = (key: string) =>
  call<{ key: string }, { key: string; override: null }>(
    'adminResetPrompt',
  )({ key }).then((r) => r.data);

// ─── Prompt lifecycle (versioned) ─────────────────────────────────────────

export interface PromptVersion {
  id: string;
  version: number;
  status: 'draft' | 'published' | 'rolled_back';
  content: string;
  createdBy: string;
  createdAt: string;
  publishedBy?: string | null;
  publishedAt?: string | null;
  changeSummary?: string | null;
}

export const adminSavePromptDraft = (args: {
  promptKey: string;
  content: string;
  changeSummary?: string;
}) =>
  call<typeof args, { versionId: string }>(
    'adminSavePromptDraft',
  )(args).then((r) => r.data);

export const adminPublishPrompt = (args: { versionId: string }) =>
  call<typeof args, { versionId: string; status: string }>(
    'adminPublishPrompt',
  )(args).then((r) => r.data);

export const adminRollbackPrompt = (args: { versionId: string }) =>
  call<typeof args, { versionId: string; status: string }>(
    'adminRollbackPrompt',
  )(args).then((r) => r.data);

export const adminListPromptVersions = (args: { promptKey: string }) =>
  call<typeof args, { versions: PromptVersion[] }>(
    'adminListPromptVersions',
  )(args).then((r) => r.data);
