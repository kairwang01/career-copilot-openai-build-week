/**
 * Runtime LLM config — Firestore platform_config/llm with functions/.env fallback.
 * Cached in memory so providers keep sync getters.
 */

import * as admin from "firebase-admin";
import {
  AppConfigDoc,
  LlmConfigDoc,
  ModelEntry,
  ModelsDoc,
  ModuleRoutes,
  PLATFORM_CONFIG_COLLECTION,
  PLATFORM_DOCS,
  PlanQuota,
  QuotasDoc,
  RoutingPool,
  ToolQuota,
} from "./schema";
import {
  effectivePlanQuota,
  effectiveQuotasDoc,
  effectiveToolQuota,
} from "./quotaDefaults";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

let llmCache: LlmConfigDoc | null = null;
let quotasCache: QuotasDoc | null = null;
let modelsCache: ModelsDoc | null = null;
let promptsCache: Record<string, string> | null = null;
let appCache: AppConfigDoc | null = null;
let cacheAt = 0;
const TTL_MS = 60_000;
let refreshInFlight: Promise<void> | null = null;

const DEFAULT_SPEED_POOL_MEMBERS = [
  // The platform's direct Gemini route is the latency-certified default. Third-
  // party/free gateways may be added deliberately as lower fallback tiers in the
  // Admin Portal, but must not become the fresh-install primary by label alone.
  { id: "gemini", label: "Gemini (default)", weight: 100 },
];

const DEFAULT_QUALITY_POOL_MEMBERS = [
  // Stable registry id keeps a fresh deployment functional even when display
  // labels are renamed in the Admin Portal.
  { id: "deepseek", label: "DeepSeek", weight: 100 },
];

export const DEFAULT_MODULE_ROUTES: ModuleRoutes = {
  careerCoach: "speed",
  mockInterview: "speed",
  analyzeResume: "quality",
  generateCoverLetter: "quality",
  generateCareerPath: "quality",
  extractTalentProfile: "quality",
  applyResumeImprovements: "quality",
  convertResumeFormat: "quality",
  calculateCompatibility: "quality",
  findOpportunities: "quality",
  optimizeLinkedInProfile: "quality",
  optimizeLinkedInProfileFromText: "quality",
  generateSkillBridgeProject: "quality",
  generateAgilePracticeTest: "quality",
  generateSalaryNegotiationStrategy: "quality",
  analyzeEnglishProficiency: "quality",
  generateSpeakingTopics: "speed",
  analyzeSpokenEnglish: "quality",
  generateReadingPracticePassage: "quality",
  analyzeEnglishReading: "quality",
  evaluateReadingComprehension: "speed",
  analyzeEnglishListening: "quality",
  generateVocabularyFlashcards: "speed",
  generateProfessionalEmail: "quality",
  generateOutreachEmail: "quality",
  generatePortfolioWebsite: "quality",
  generateWeeklySummary: "speed",
  generateJobDescription: "quality",
  analyzeSalary: "quality",
  checkInclusivity: "quality",
  formatJobDescription: "quality",
  analyzeCandidateMatch: "quality",
  generateNetworkingStrategy: "quality",
  generatePerformanceReviewPrep: "quality",
  generateLearningPlan: "quality",
  findIndustryEvents: "quality",
  anonymizeResume: "quality",
  generateClientPitchEmail: "quality",
  generateCandidatePrepKit: "quality",
  discoverTalent: "quality",
  listJobApplicants: "quality",
  extractTextFromUrl: "quality",
  apiResumeAnalyze: "quality",
  apiCoverLetter: "quality",
};

const normalizeModelLabel = (label: string): string => label.trim().toLowerCase();

function defaultPoolMembersForLabels(
  registry: ModelEntry[],
  specs: Array<{ id?: string; label: string; weight: number }>
): RoutingPool["members"] {
  return specs.flatMap((spec) => {
    const model = registry.find((entry) =>
      (spec.id && entry.id === spec.id) ||
      normalizeModelLabel(entry.label) === normalizeModelLabel(spec.label)
    );
    return model ? [{ modelId: model.id, tier: 1, weight: spec.weight, enabled: true }] : [];
  });
}

function cloneRoutingPools(pools: RoutingPool[]): RoutingPool[] {
  return pools.map((pool) => ({
    ...pool,
    members: pool.members.map((member) => ({ ...member })),
  }));
}

export function defaultRoutingPoolsForRegistry(registry: ModelEntry[]): RoutingPool[] {
  return [
    {
      id: "speed",
      label: "Speed priority",
      enabled: true,
      members: defaultPoolMembersForLabels(registry, DEFAULT_SPEED_POOL_MEMBERS),
    },
    {
      id: "quality",
      label: "Quality priority",
      enabled: true,
      members: defaultPoolMembersForLabels(registry, DEFAULT_QUALITY_POOL_MEMBERS),
    },
  ];
}

export function maskSecret(value: string | undefined): string {
  if (!value) return "";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

export async function refreshPlatformCaches(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const [llmSnap, quotasSnap, modelsSnap, promptsSnap, appSnap] = await Promise.all([
      db.collection(PLATFORM_CONFIG_COLLECTION).doc(PLATFORM_DOCS.llm).get(),
      db.collection(PLATFORM_CONFIG_COLLECTION).doc(PLATFORM_DOCS.quotas).get(),
      db.collection(PLATFORM_CONFIG_COLLECTION).doc(PLATFORM_DOCS.models).get(),
      db.collection(PLATFORM_CONFIG_COLLECTION).doc(PLATFORM_DOCS.prompts).get(),
      db.collection(PLATFORM_CONFIG_COLLECTION).doc(PLATFORM_DOCS.app).get(),
    ]);
    llmCache = llmSnap.exists ? (llmSnap.data() as LlmConfigDoc) : {};
    quotasCache = quotasSnap.exists ? (quotasSnap.data() as QuotasDoc) : {};
    modelsCache = modelsSnap.exists ? (modelsSnap.data() as ModelsDoc) : {};
    promptsCache = promptsSnap.exists
      ? (promptsSnap.data() as Record<string, string>)
      : {};
    appCache = appSnap.exists ? (appSnap.data() as AppConfigDoc) : {};
    cacheAt = Date.now();
  })();
  try {
    await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export async function ensurePlatformCaches(): Promise<void> {
  if (
    llmCache &&
    quotasCache &&
    modelsCache &&
    promptsCache !== null &&
    appCache !== null &&
    Date.now() - cacheAt < TTL_MS
  )
    return;
  await refreshPlatformCaches();
}

export function getGeminiApiKey(): string {
  const key = llmCache?.gemini_api_key || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY is not set. Add it via Admin Portal or functions/.env.");
  }
  return key;
}

export function getGeminiModel(): string {
  // Use the stable production id. Admins can deliberately choose an alias, but
  // an unconfigured deployment should not silently hot-swap model behavior.
  return llmCache?.gemini_model || process.env.GEMINI_MODEL || "gemini-3.5-flash";
}

export function getGeminiFallbackModel(): string | undefined {
  const model = llmCache?.gemini_fallback_model || process.env.GEMINI_FALLBACK_MODEL;
  return model?.trim() || undefined;
}

/**
 * Returns the canonical public base URL from platform_config/app.app_base_url
 * (trimmed), or undefined when unset. Requires ensurePlatformCaches() to have run.
 */
export function getAppBaseUrl(): string | undefined {
  const value = appCache?.app_base_url;
  return value?.trim() || undefined;
}

export function getOpportunityUseGoogleSearch(): boolean {
  return process.env.OPPORTUNITY_USE_GOOGLE_SEARCH !== "false";
}

export function getKairllmBaseUrl(): string {
  const url = llmCache?.kairllm_base_url || process.env.KAIRLLM_BASE_URL || "https://ai.gogosling.ca/v1";
  return url.replace(/\/$/, "");
}

export function getKairllmApiKey(): string {
  const key = llmCache?.kairllm_api_key || process.env.KAIRLLM_API_KEY;
  if (!key) {
    throw new Error("KAIRLLM_API_KEY is not set. Add it via Admin Portal or functions/.env.");
  }
  return key;
}

export function getDeepseekBaseUrl(): string {
  const url = llmCache?.deepseek_base_url || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";
  return url.replace(/\/$/, "");
}

export function getDeepseekApiKey(): string {
  const key = llmCache?.deepseek_api_key || process.env.DEEPSEEK_API_KEY;
  if (!key) {
    throw new Error("DEEPSEEK_API_KEY is not set. Add it via Admin Portal or functions/.env.");
  }
  return key;
}

export function getQuotasConfig(): QuotasDoc {
  return quotasCache ?? {};
}

export function getEffectiveQuotasConfig(): QuotasDoc {
  return effectiveQuotasDoc(quotasCache ?? {});
}

export function getPlanQuota(plan: string | undefined | null): PlanQuota {
  return effectivePlanQuota(quotasCache ?? {}, plan);
}

export function getToolQuota(tool: string): ToolQuota | null {
  return effectiveToolQuota(quotasCache ?? {}, tool);
}

export function getToolCreditCost(tool: string, fallback: number): number {
  const quota = getToolQuota(tool);
  return quota ? quota.credit_cost : fallback;
}

export function getMonthlyCreditGrant(plan: string): number {
  return getPlanQuota(plan).monthly_credit_grant;
}

export function getActiveJobLimit(plan: string | undefined | null): number {
  return getPlanQuota(plan).active_job_limit;
}

/**
 * Returns the active model registry.
 *
 * Priority: Firestore platform_config/models.models (non-empty array) → DEFAULT_MODELS.
 *
 * Import is lazy (bottom of file) to avoid a circular dependency:
 *   models.ts → platformConfig.ts → models.ts
 * Instead we accept the DEFAULT_MODELS array as a parameter, injected by models.ts.
 * The admin handlers call getModelRegistry() via the overload that passes no
 * argument; models.ts passes its own DEFAULT_MODELS at boot time.
 */
let _defaultModels: ModelEntry[] | null = null;

/** Called once by models.ts to register the DEFAULT_MODELS seed. */
export function registerDefaultModels(defaults: ModelEntry[]): void {
  _defaultModels = defaults;
}

/**
 * Returns the admin-configured default model id from the platform_config/models
 * doc, or null if none is set.
 *
 * The same cache TTL as getModelRegistry() applies — ensurePlatformCaches() must
 * have been called first (resolveProvider() and listModels both do this).
 */
export function getDefaultModelId(): string | null {
  const id = modelsCache?.default_model_id;
  if (typeof id === "string" && id.trim() !== "") return id.trim();
  return null;
}

/**
 * Free-tier output-token ceiling (服务分级). Admin-configurable via
 * platform_config/quotas.free_max_output_tokens. Default 8192 = Gemini Flash's
 * native max (no artificial truncation — large structured outputs like career
 * roadmaps / formatted resumes must never be cut mid-JSON). Returns the default
 * when the cache is cold or the value is missing/invalid.
 */
export function getFreeMaxOutputTokens(): number {
  const v = quotasCache?.free_max_output_tokens;
  if (typeof v === "number" && Number.isFinite(v) && v >= 256) return Math.floor(v);
  return 8192;
}

/** Minimum tier allowed to run the timed mock-interview simulation (default: paid). */
export function getMockInterviewMinTier(): "free" | "paid" {
  return quotasCache?.mi_min_tier === "free" ? "free" : "paid";
}

/** Credit price for a non-included tier to unlock a finished interview report (default: 500). */
export function getMiReportUnlockCredits(): number {
  const v = quotasCache?.mi_report_unlock_credits;
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.floor(v);
  return 500;
}

/**
 * Returns the effective model registry (Firestore if non-empty, else defaults).
 * Requires ensurePlatformCaches() to have been called first (models.ts calls it
 * in resolveProvider; adminModels.ts calls it explicitly).
 */
export function getModelRegistry(): ModelEntry[] {
  const firestoreModels = modelsCache?.models;
  if (Array.isArray(firestoreModels) && firestoreModels.length > 0) {
    return firestoreModels;
  }
  return _defaultModels ?? [];
}

export function getRoutingPools(): RoutingPool[] {
  const pools = modelsCache?.routing_pools;
  if (Array.isArray(pools)) return cloneRoutingPools(pools);
  return defaultRoutingPoolsForRegistry(getModelRegistry());
}

export function getModuleRoutes(): ModuleRoutes {
  return { ...DEFAULT_MODULE_ROUTES, ...(modelsCache?.module_routes ?? {}) };
}

/** Admin-safe view: api_key and api_keys replaced with masked previews. */
export function getModelRegistryMasked(): ModelEntry[] {
  return getModelRegistry().map((m) => ({
    ...m,
    api_key: m.api_key ? maskSecret(m.api_key) : undefined,
    api_keys: m.api_keys?.length
      ? m.api_keys.map((k) => maskSecret(k))
      : undefined,
  }));
}

export interface MaskedLlmConfig {
  gemini_api_key_masked: string;
  kairllm_api_key_masked: string;
  gemini_model: string;
  gemini_fallback_model: string;
  kairllm_base_url: string;
  deepseek_api_key_masked: string;
  deepseek_base_url: string;
  updated_at?: string;
  updated_by?: string;
}

export async function getLlmConfigMasked(): Promise<MaskedLlmConfig> {
  await ensurePlatformCaches();
  const doc = llmCache ?? {};
  // SECURITY: never spread `doc` — it holds the RAW api keys.
  // Return only masked previews + non-secret fields so keys never reach the client.
  return {
    gemini_api_key_masked: maskSecret(doc.gemini_api_key || process.env.GEMINI_API_KEY),
    kairllm_api_key_masked: maskSecret(doc.kairllm_api_key || process.env.KAIRLLM_API_KEY),
    gemini_model: getGeminiModel(),
    gemini_fallback_model: getGeminiFallbackModel() ?? "",
    kairllm_base_url: getKairllmBaseUrl(),
    deepseek_api_key_masked: maskSecret(doc.deepseek_api_key || process.env.DEEPSEEK_API_KEY),
    deepseek_base_url: getDeepseekBaseUrl(),
    updated_at: doc.updated_at,
    updated_by: doc.updated_by,
  };
}

export async function getQuotasConfigForAdmin(): Promise<QuotasDoc> {
  await ensurePlatformCaches();
  return effectiveQuotasDoc(quotasCache ?? {});
}

/**
 * Returns the Firestore override template for a prompt key (trimmed, non-empty),
 * or undefined if no override is stored.
 * Requires ensurePlatformCaches() to have run (called on every request by handlers).
 */
export function getPromptOverride(key: string): string | undefined {
  const raw = promptsCache?.[key];
  if (typeof raw === "string" && raw.trim() !== "") return raw;
  return undefined;
}

/**
 * Returns the entire prompts override map currently in cache.
 * Useful for the admin list-prompts callable.
 */
export function getAllPromptOverrides(): Record<string, string> {
  return promptsCache ?? {};
}
