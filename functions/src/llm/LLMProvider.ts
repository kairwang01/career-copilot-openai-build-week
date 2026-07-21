/**
 * Provider-agnostic LLM interface.
 *
 * All AI providers (Gemini, DeepSeek, ...) implement LLMProvider so that
 * feature handlers never depend on a specific model — swapping or cascading
 * models is done in router.ts without touching any handler.
 *
 * Phase A: GeminiProvider is the only implementation.
 * Phase B: DeepSeekProvider will be added; router.ts will implement
 *           the free-first cascade (free → paid).
 *
 * Stability contract: this interface is shared with Xiang (AI/NLP Engineer)
 * for prompt work. Do NOT change field names without coordinating.
 */

/** A single content part — text or inline binary data (e.g., an image). */
export interface LLMContentPart {
  /** Plain text content. */
  text?: string;
  /** Inline binary data, e.g. a base64-encoded image for multimodal calls. */
  inlineData?: {
    mimeType: string;
    data: string; // base64 encoded
  };
}

/** Provider-neutral reasoning effort. Gemini 3 maps this to thinkingLevel. */
export type LLMThinkingLevel = "minimal" | "low" | "medium" | "high";

/** Input to any LLM provider call. */
export interface LLMRequest {
  /** Optional system instruction (model-level persona / rules). */
  system?: string;
  /** The main user-facing prompt. Required. */
  prompt: string;
  /**
   * Optional multimodal parts (images, documents, etc.).
   * When provided, the provider builds a multimodal request using `prompt`
   * as the text part and `parts` as the additional content.
   */
  parts?: LLMContentPart[];
  /**
   * JSON schema for structured output.
   * When set, the provider requests application/json with this schema.
   * Use the Type helpers from @google/genai for Gemini-compatible schemas.
   */
  responseSchema?: object;
  /** Sampling temperature (0 = deterministic, 1 = creative). Default: provider-specific. */
  temperature?: number;
  /**
   * When true, the provider enables live web search grounding (Gemini googleSearch
   * tool) and populates LLMResult.groundingChunks with the cited sources.
   */
  useGoogleSearch?: boolean;
  /**
   * Hard cap on generated tokens for this request.
   * Passed to generationConfig.maxOutputTokens (Gemini) or max_tokens (OpenAI-compatible).
   * When undefined, the provider uses its default limit.
   * Service-tiering: for free-tier requests with this field undefined,
   * resolveProvider injects the admin-configurable cap from
   * platform_config/quotas.free_max_output_tokens (default 8192)
   * (服务分级 — free/paid output-quality boundary).
   */
  maxOutputTokens?: number;
  /**
   * Optional reasoning effort. Providers that do not expose a compatible knob
   * ignore it. Gemini 3 defaults to `low` in GeminiProvider to keep interactive
   * tools responsive; callers may explicitly request a different level.
   */
  thinkingLevel?: LLMThinkingLevel;
  /**
   * Per-provider-attempt deadline in milliseconds. Routing pools lower this for
   * latency-priority routes so one dead upstream cannot consume the callable's
   * entire 180-second deadline before fallback starts.
   */
  timeoutMs?: number;
}

/** Output from any LLM provider call. */
export interface LLMResult {
  /** Raw text response from the model. */
  text: string;
  /**
   * Parsed JSON object — populated when LLMRequest.responseSchema was set
   * and the model returned valid JSON.
   */
  raw?: unknown;
  /** Name of the model that answered (e.g. "gemini-3-pro-preview"). */
  model: string;
  /** Concrete provider/model entry that served the request. */
  provider?: string;
  /** Provider stop reason; incomplete responses are rejected before returning. */
  finishReason?: string;
  /**
   * Web-search grounding sources, populated when LLMRequest.useGoogleSearch was set.
   * Shape mirrors Gemini's groundingMetadata.groundingChunks.
   */
  groundingChunks?: unknown;
  /** Token usage for cost tracking (optional — not all providers expose this). */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

/** The contract every AI provider must implement. */
export interface LLMProvider {
  /** Unique provider name — "gemini" | "deepseek" | ... */
  readonly name: string;
  /**
   * Generate a response for the given request.
   * Implementors must:
   *  - Never throw a non-Error value.
   *  - Propagate quota/network errors as-is so the handler can classify them.
   */
  generate(req: LLMRequest): Promise<LLMResult>;
}
