/**
 * Gemini provider — implements LLMProvider using the @google/genai SDK.
 *
 * This is a server-side port of the core logic from the frontend's
 * services/geminiService.ts.  The API key is read from the environment
 * (config/env.ts) and NEVER exposed to the browser.
 *
 * Supported features:
 *   - Text-only generation
 *   - Multimodal generation (inline images via LLMRequest.parts)
 *   - Structured JSON output (via LLMRequest.responseSchema)
 *
 * Phase B: the router will select between GeminiProvider("gemini-3-flash-preview")
 * for free-tier tasks and GeminiProvider("gemini-3-pro-preview") for heavy reasoning.
 */

import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { LLMProvider, LLMRequest, LLMResult, LLMThinkingLevel } from "../LLMProvider";
import { isQuotaError, isModelUnavailableError } from "../errorClassification";
import {
  getGeminiApiKey,
  getGeminiFallbackModel,
  getGeminiModel,
} from "../../config/env";

// The default model is resolved at CONSTRUCTION time (getGeminiModel(), in the
// constructor below), never at module-load time — otherwise it would capture a
// cold cache and ignore the model configured via the Admin Portal
// (platform_config/llm). Change it from the Admin Portal or functions/.env.

/**
 * Extracts a JSON value from a string that may be wrapped in a markdown
 * code fence (```json ... ```) or contain leading prose.
 *
 * Ported from frontend services/geminiService.ts extractJson() so both sides
 * handle malformed responses the same way.
 */
export function extractJson(str: string): unknown {
  const match = str.match(/```json\s*([\s\S]*?)\s*```/);
  const candidate = (match?.[1] ?? str).trim();

  const firstBracket = candidate.indexOf("{");
  const firstSquare = candidate.indexOf("[");

  let start = -1;
  if (firstBracket === -1) start = firstSquare;
  else if (firstSquare === -1) start = firstBracket;
  else start = Math.min(firstBracket, firstSquare);

  if (start === -1) {
    throw new Error("No JSON object or array found in the AI response.");
  }

  const jsonStr = firstCompleteJsonValue(candidate, start);

  try {
    return JSON.parse(jsonStr);
  } catch {
    try {
      // Strip trailing commas before closing brackets (common Gemini quirk)
      return JSON.parse(jsonStr.replace(/,(\s*[\]}])/g, "$1"));
    } catch {
      throw new Error(
        "The AI returned a response that could not be parsed as JSON."
      );
    }
  }
}

function firstCompleteJsonValue(input: string, start: number): string {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") stack.push(char);
    if (char === "}" || char === "]") {
      const expected = char === "}" ? "{" : "[";
      if (stack.pop() !== expected) break;
      if (stack.length === 0) return input.slice(start, index + 1);
    }
  }
  return input.slice(start);
}

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";

  private readonly ai: GoogleGenAI;
  private readonly model: string;
  private readonly fallbackModel?: string;

  constructor(model?: string, apiKeyOverride?: string) {
    // Admin connection tests must exercise the key the operator just entered,
    // rather than silently falling back to the saved platform credential.
    this.ai = new GoogleGenAI({ apiKey: resolveGeminiApiKey(apiKeyOverride) });
    // Read the admin-configured model at construction time (cache is warm by now,
    // because resolveProvider() calls ensurePlatformCaches() before building us).
    this.model = model || getGeminiModel();
    const fallback = getGeminiFallbackModel();
    this.fallbackModel = fallback && fallback !== this.model ? fallback : undefined;
  }

  async generate(req: LLMRequest): Promise<LLMResult> {
    // Build the contents payload
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let contents: any;

    if (req.parts && req.parts.length > 0) {
      // Multimodal request: combine text prompt with inline data parts
      const textPart = { text: req.prompt };
      const binaryParts = req.parts
        .filter((p) => p.inlineData)
        .map((p) => ({ inlineData: p.inlineData! }));
      contents = { parts: [textPart, ...binaryParts] };
    } else {
      contents = req.prompt;
    }

    // Build the config object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: Record<string, any> = {};
    if (req.system) {
      // Keep policy/persona instructions at model priority. Concatenating them
      // into user content made them easier for transcript text to override and
      // dropped them completely on multimodal requests.
      config.systemInstruction = req.system;
    }
    if (req.useGoogleSearch) {
      // Gemini 3 supports built-in tools and structured output in one request.
      // Keeping the schema enabled is essential: otherwise search tools return
      // best-effort JSON whose keys may not match the frontend contract.
      config.tools = [{ googleSearch: {} }];
    }
    if (req.responseSchema) {
      config.responseMimeType = "application/json";
      config.responseSchema = req.responseSchema;
    }
    if (req.temperature !== undefined) {
      config.temperature = req.temperature;
    }
    if (req.maxOutputTokens !== undefined) {
      config.maxOutputTokens = req.maxOutputTokens;
    }
    // The SDK otherwise retries up to five times and has no useful request-level
    // deadline. Outer routing owns fallback, so keep SDK retries bounded and let
    // the route's remaining budget decide how long this attempt may run.
    config.httpOptions = {
      // Most callable surfaces have a 60-second outer deadline. Leave enough
      // time for validation, logging, and credit refunds when callers do not
      // provide a tighter routing budget.
      timeout: normalizeTimeoutMs(req.timeoutMs, 45_000),
      retryOptions: { attempts: 1 },
    };

    const generateWithModel = (model: string) => {
      const modelConfig = { ...config };
      const thinkingLevel = resolveThinkingLevel(model, req.thinkingLevel);
      if (thinkingLevel) {
        modelConfig.thinkingConfig = { thinkingLevel };
      }
      return this.ai.models.generateContent({
        model,
        contents,
        ...(Object.keys(modelConfig).length > 0 ? { config: modelConfig } : {}),
      });
    };

    let modelUsed = this.model;
    let response;
    try {
      response = await generateWithModel(this.model);
    } catch (error) {
      // Fall back on quota exhaustion AND on a retired/unknown primary model —
      // Gemini reports retirement as 404 "no longer available", which is not a
      // quota error, so the fallback previously never fired for it (live-verified
      // 2026-07-12: GEMINI_FALLBACK_MODEL did not rescue a retired primary).
      if (!this.fallbackModel || !(isQuotaError(error) || isModelUnavailableError(error))) {
        throw error;
      }
      modelUsed = this.fallbackModel;
      response = await generateWithModel(this.fallbackModel);
    }

    if (!response.text) {
      throw new Error("Gemini returned an empty response.");
    }

    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== "STOP") {
      throw new Error(
        finishReason === "MAX_TOKENS"
          ? "Gemini response was truncated before completion."
          : `Gemini response stopped before completion (${finishReason}).`
      );
    }

    const text = response.text;
    const raw = req.responseSchema ? extractJson(text) : undefined;
    const groundingChunks = req.useGoogleSearch
      ? response.candidates?.[0]?.groundingMetadata?.groundingChunks
      : undefined;

    return {
      text,
      raw,
      model: modelUsed,
      provider: this.name,
      finishReason,
      groundingChunks,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount,
        outputTokens: response.usageMetadata?.candidatesTokenCount,
      },
    };
  }
}

export function resolveGeminiApiKey(apiKeyOverride?: string): string {
  return apiKeyOverride || getGeminiApiKey();
}

const THINKING_LEVEL_MAP: Record<LLMThinkingLevel, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

/**
 * `gemini-flash-latest` currently aliases Gemini 3.5 Flash. Earlier Gemini
 * generations reject thinkingLevel, so only known Gemini 3 ids/aliases receive
 * the setting. Low is Google's recommended lower-latency level for analysis and
 * writing tools and remains overridable per request.
 */
export function resolveThinkingLevel(
  model: string,
  requested?: LLMThinkingLevel
): ThinkingLevel | undefined {
  const normalized = model.trim().toLowerCase();
  const supportsThinkingLevel =
    /^gemini-3(?:[.-]|$)/.test(normalized) ||
    normalized === "gemini-flash-latest" ||
    normalized === "gemini-pro-latest";
  if (!supportsThinkingLevel) return undefined;
  return THINKING_LEVEL_MAP[requested ?? "low"];
}

function normalizeTimeoutMs(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || (value ?? 0) < 1_000) return fallback;
  return Math.min(180_000, Math.floor(value!));
}
