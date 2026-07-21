/**
 * Typed access to LLM secrets and runtime config.
 *
 * Resolution order: Firestore platform_config/llm (Admin Portal) → functions/.env fallback.
 * Call ensurePlatformCaches() at the start of handlers before reading keys.
 */

export {
  ensurePlatformCaches,
  refreshPlatformCaches,
  getGeminiApiKey,
  getGeminiModel,
  getGeminiFallbackModel,
  getOpportunityUseGoogleSearch,
  getKairllmApiKey,
  getKairllmBaseUrl,
  getDeepseekApiKey,
  getDeepseekBaseUrl,
  getLlmConfigMasked,
  getQuotasConfigForAdmin,
  getQuotasConfig,
  getEffectiveQuotasConfig,
  getPlanQuota,
  getToolQuota,
  getToolCreditCost,
  getMonthlyCreditGrant,
  getActiveJobLimit,
  maskSecret,
  getModelRegistry,
  getModelRegistryMasked,
  getRoutingPools,
  getModuleRoutes,
  registerDefaultModels,
  getPromptOverride,
  getAllPromptOverrides,
  getDefaultModelId,
  getFreeMaxOutputTokens,
  getMockInterviewMinTier,
  getMiReportUnlockCredits,
} from "../admin/platformConfig";
