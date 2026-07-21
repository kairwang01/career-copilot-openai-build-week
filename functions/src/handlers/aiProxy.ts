/**
 * aiProxy — generic authenticated AI tool dispatcher (HTTPS Callable).
 *
 * One callable serves every "long-tail" AI tool (the ~30 operations registered in
 * llm/toolRegistry.ts). It consolidates the security-critical wrapper once:
 *   verify auth → resolve tool → deduct credits (server-side, atomic) → run the
 *   server-held-key LLM call → return the parsed result.
 *
 * The Gemini key never reaches the browser. Adding a new tool = one registry entry,
 * no new function and no new deploy target.
 *
 * Frontend integration (see services/aiClient.ts):
 *   const fn = httpsCallable(getFunctions(), "aiProxy");
 *   const { data } = await fn({ tool: "generateLearningPlan", payload: {...} });
 *   // → { data: <parsed result>, groundingChunks, meta }
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { requireAuth } from "../middleware/auth";
import { resolveProvider } from "../llm/models";
import { ensurePlatformCaches } from "../config/env";
import {
  candidateAnalysisLanguageProtocol,
  employerAnalysisLanguageProtocol,
} from "../llm/languageProtocol";
import { correctiveInstruction } from "../llm/draftQuality";
import { isQuotaError } from "../llm/errorClassification";
import {
  claimFreeToolRun,
  claimMeteredToolRun,
  refundCredits,
} from "../credits/deductCredits";
import type { RefundableCharge } from "../credits/deductCredits";
import { TOOL_CREDIT_COSTS } from "../credits/schema";
import { TOOL_REGISTRY } from "../llm/toolRegistry";
import { buildToolResponse } from "../llm/toolResponse";
import {
  SchemaValidationIssue,
  validateAgainstSchema,
} from "../llm/schemaValidation";
import { toolPayloadIssues } from "../llm/toolPayloadValidation";
import { outputTokenBudgetForTool, thinkingLevelForTool } from "../llm/toolBudgets";
import {
  MAX_AI_TOOL_PAYLOAD_CHARS,
  payloadContentCharacterCount,
} from "../utils/runtimeLimits";

interface AiProxyRequest {
  tool: string;
  payload?: Record<string, unknown>;
  /** Optional model id (tier-gated server-side; ignored for free users). */
  model?: string;
  /** Optional client-generated idempotency key. */
  requestId?: string;
}

/** Tolerant JSON extraction for tools that return free-text JSON (no responseSchema). */
function tryParseJson(str: string): unknown {
  const fence = str.match(/```json\s*([\s\S]*?)\s*```/);
  let s = (fence?.[1] ?? str).trim();
  const b = s.indexOf("{");
  const a = s.indexOf("[");
  const start = b === -1 ? a : a === -1 ? b : Math.min(a, b);
  if (start === -1) return undefined;
  s = s.substring(start);
  try {
    return JSON.parse(s);
  } catch {
    try {
      return JSON.parse(s.replace(/,(\s*[\]}])/g, "$1"));
    } catch {
      return undefined;
    }
  }
}

function addNotice(data: unknown, notice: string | undefined): unknown {
  if (!notice || !data || typeof data !== "object" || Array.isArray(data)) {
    return data;
  }
  return { ...(data as Record<string, unknown>), notice };
}

// The callable retains a generous outer deadline for long structured tools, but
// provider/routing budgets below prevent a dead candidate from consuming it.
// ---------------------------------------------------------------------------
// Central multilingual protocol
//
// Most registry tools have no dedicated language plumbing; the client sends
// its UI language as payload.outputLanguage and we append ONE shared protocol
// block per audience. Tools that already manage language themselves are
// skipped so instructions never conflict.
// ---------------------------------------------------------------------------

const EMPLOYER_TOOLS = new Set([
  "generateJobDescription",
  "analyzeSalary",
  "checkInclusivity",
  "formatJobDescription",
  "analyzeCandidateMatch",
  "anonymizeResume",
  "generateClientPitchEmail",
  "generateCandidatePrepKit",
  "generateOutreachEmail",
]);

const LANGUAGE_SELF_MANAGED_TOOLS = new Set([
  "convertResumeFormat", // outputLanguage is the tool's own core parameter
  "extractTalentProfile", // targetLanguage is the tool's own core parameter
]);

function languageBlockForTool(tool: string, payload: Record<string, unknown> | undefined): string {
  if (LANGUAGE_SELF_MANAGED_TOOLS.has(tool)) return "";
  const outputLanguage = typeof payload?.outputLanguage === "string" ? payload.outputLanguage : undefined;
  const marketName = typeof payload?.marketName === "string" ? payload.marketName : undefined;
  return EMPLOYER_TOOLS.has(tool)
    ? employerAnalysisLanguageProtocol({ outputLanguage })
    : candidateAnalysisLanguageProtocol({ outputLanguage, marketName });
}

export const aiProxyFunction = onCall({ invoker: "public", timeoutSeconds: 180 }, async (request) => {
  const requestStartedAt = Date.now();
  const uid = requireAuth(request);

  const { tool, payload, model, requestId } = (request.data ?? {}) as AiProxyRequest;

  if (!tool || typeof tool !== "string") {
    throw new HttpsError("invalid-argument", "tool is required.");
  }

  const spec = TOOL_REGISTRY[tool];
  if (!spec) {
    throw new HttpsError("invalid-argument", `Unknown tool: ${tool}`);
  }

  // Measure deserialized content rather than JSON.stringify output. Escaped
  // quotes/newlines must not make a frontend-valid resume fail at this layer.
  const payloadChars = payloadContentCharacterCount(payload ?? {});
  if (payloadChars > MAX_AI_TOOL_PAYLOAD_CHARS) {
    throw new HttpsError(
      "invalid-argument",
      `Request payload exceeds the ${MAX_AI_TOOL_PAYLOAD_CHARS} character content limit.`
    );
  }

  const requestPayloadIssues = toolPayloadIssues(tool, payload ?? {});
  if (requestPayloadIssues.length > 0) {
    throw new HttpsError(
      "invalid-argument",
      `Invalid ${tool} payload: ${requestPayloadIssues.slice(0, 4).join("; ")}`
    );
  }

  let cost = spec.creditKey ? TOOL_CREDIT_COSTS[spec.creditKey] : 0;
  let refundableCharge: RefundableCharge | undefined;
  let result: Awaited<ReturnType<Awaited<ReturnType<typeof resolveProvider>>["generate"]>> | undefined;
  let providerName: string | undefined;
  let generationMs = 0;
  let repairMs = 0;
  let qualityRetryCount = 0;
  let contractRetryCount = 0;
  let quotaFallbackCount = 0;
  let groundingFallbackCount = 0;

  try {
    // Warm the cache before spec.build so prompt overrides are correct. Cache
    // refresh is single-flight, preventing a cold-instance Firestore stampede.
    await ensurePlatformCaches();
    const llmRequest = spec.build(payload ?? {});
    llmRequest.maxOutputTokens ??= outputTokenBudgetForTool(tool);
    llmRequest.thinkingLevel ??= thinkingLevelForTool(tool);
    const languageBlock = languageBlockForTool(tool, payload ?? {});
    if (languageBlock) llmRequest.prompt = `${llmRequest.prompt}\n\n${languageBlock}`;

    // Metering and provider selection both perform Firestore reads but neither
    // calls the model. Run them concurrently, then require successful metering
    // before provider.generate below. allSettled lets us refund safely if model
    // resolution fails after the atomic charge completes.
    const meteringPromise = spec.creditKey
      ? claimMeteredToolRun(uid, spec.creditKey, cost, { requestId }).then((deduction) => ({
          creditCost: deduction.creditCost,
          charge: deduction as RefundableCharge,
        }))
      : claimFreeToolRun(uid, tool, { requestId }).then(() => ({
          creditCost: 0,
          charge: undefined,
        }));
    const providerPromise = resolveProvider(uid, model, tool, {
      needsImageInput: llmRequest.parts?.some((part) => !!part.inlineData) === true,
      needsGoogleSearch: llmRequest.useGoogleSearch === true,
    });
    const [meteringOutcome, providerOutcome] = await Promise.allSettled([
      meteringPromise,
      providerPromise,
    ]);
    if (meteringOutcome.status === "fulfilled") {
      cost = meteringOutcome.value.creditCost;
      refundableCharge = meteringOutcome.value.charge;
    } else {
      throw meteringOutcome.reason;
    }
    if (providerOutcome.status === "rejected") throw providerOutcome.reason;
    const provider = providerOutcome.value;
    providerName = provider.name;
    let notice: string | undefined;

    const generationStartedAt = Date.now();
    let activeRequest = llmRequest;
    try {
      result = await provider.generate(llmRequest);
    } catch (err) {
      if (!spec.quotaFallback || !isQuotaError(err)) {
        throw err;
      }
      const fallbackRequest = spec.quotaFallback(payload ?? {});
      if (languageBlock) fallbackRequest.prompt = `${fallbackRequest.prompt}\n\n${languageBlock}`;
      fallbackRequest.timeoutMs = Math.min(
        fallbackRequest.timeoutMs ?? llmRequest.timeoutMs ?? 20_000,
        20_000
      );
      fallbackRequest.thinkingLevel ??= "low";
      quotaFallbackCount += 1;
      activeRequest = fallbackRequest;
      result = await provider.generate(fallbackRequest);
      notice = spec.quotaFallbackNotice;
    }
    if (
      spec.requiresGrounding &&
      activeRequest.useGoogleSearch === true &&
      !hasGroundingChunks(result.groundingChunks)
    ) {
      groundingFallbackCount += 1;
      if (spec.ungroundedFallbackData !== undefined) {
        result = {
          ...result,
          raw: spec.ungroundedFallbackData,
          text: JSON.stringify(spec.ungroundedFallbackData),
          groundingChunks: undefined,
        };
        activeRequest = { ...activeRequest, useGoogleSearch: false };
        notice = spec.quotaFallbackNotice;
      } else if (spec.quotaFallback) {
        const fallbackRequest = spec.quotaFallback(payload ?? {});
        if (languageBlock) fallbackRequest.prompt = `${fallbackRequest.prompt}\n\n${languageBlock}`;
        fallbackRequest.maxOutputTokens ??= outputTokenBudgetForTool(tool);
        fallbackRequest.timeoutMs = Math.min(
          fallbackRequest.timeoutMs ?? activeRequest.timeoutMs ?? 20_000,
          20_000
        );
        fallbackRequest.thinkingLevel ??= "low";
        activeRequest = fallbackRequest;
        result = await provider.generate(fallbackRequest);
        notice = spec.quotaFallbackNotice;
      } else {
        throw new Error("Gemini did not return verifiable Google Search sources. Please try again.");
      }
    }
    generationMs = Date.now() - generationStartedAt;

    // Internal second-pass review (ToolSpec.qualityCheck): when the parsed
    // draft would trip the client's export gate, retry ONCE with a corrective
    // instruction inside the same charged call. Users get a finished draft on
    // the first click instead of "Fix this draft before exporting".
    {
      const firstParsed = result.raw !== undefined ? result.raw : tryParseJson(result.text);
      const contractIssues = activeRequest.responseSchema
        ? validateAgainstSchema(firstParsed, activeRequest.responseSchema)
        : [];
      const qualityIssues = spec.qualityCheck
        ? spec.qualityCheck(firstParsed, payload ?? {})
        : [];
      if (contractIssues.length > 0 || qualityIssues.length > 0) {
        const maxRepairStartMs = envDurationMs("LLM_QUALITY_REPAIR_START_BEFORE_MS", 25_000);
        if (Date.now() - requestStartedAt <= maxRepairStartMs) {
          console.warn(
            `[aiProxy] ${tool} response failed review ` +
              `(contract=${contractIssues.length}, quality=${qualityIssues.join(",") || "none"}) — retrying once`
          );
          const repairStartedAt = Date.now();
          qualityRetryCount = qualityIssues.length > 0 ? 1 : 0;
          contractRetryCount = contractIssues.length > 0 ? 1 : 0;
          try {
            const retryRequest = {
              ...activeRequest,
              prompt: [
                activeRequest.prompt,
                contractIssues.length > 0 ? contractCorrection(contractIssues) : "",
                qualityIssues.length > 0 ? correctiveInstruction(qualityIssues) : "",
              ].filter(Boolean).join("\n\n"),
              // A repair should not repeat a full medium-thinking pass or inherit
              // a 150-second provider timeout. Keep the best result if it misses
              // this bounded best-effort window.
              thinkingLevel: "minimal" as const,
              timeoutMs: Math.min(activeRequest.timeoutMs ?? 15_000, 15_000),
            };
            const retryResult = await provider.generate(retryRequest);
            const retryParsed = retryResult.raw !== undefined ? retryResult.raw : tryParseJson(retryResult.text);
            const retryContractIssues = retryRequest.responseSchema
              ? validateAgainstSchema(retryParsed, retryRequest.responseSchema)
              : [];
            const retryQualityIssues = spec.qualityCheck
              ? spec.qualityCheck(retryParsed, payload ?? {})
              : [];
            if (
              retryContractIssues.length + retryQualityIssues.length <
              contractIssues.length + qualityIssues.length
            ) {
              result = retryResult;
            }
          } catch {
            // Retry is best-effort — keep the first draft; the client gate
            // remains the final safety net.
          }
          repairMs = Date.now() - repairStartedAt;
        } else {
          console.warn(
            `[aiProxy] ${tool} response review found ` +
              `contract=${contractIssues.length}, quality=${qualityIssues.join(",") || "none"}; ` +
              `repair skipped because the latency budget was already consumed`
          );
        }
      }
    }

    const parsedResult = result.raw !== undefined ? result.raw : tryParseJson(result.text);
    const finalContractIssues = activeRequest.responseSchema
      ? validateAgainstSchema(parsedResult, activeRequest.responseSchema)
      : [];
    if (finalContractIssues.length > 0) {
      console.error(
        `[aiProxy] ${tool} returned an invalid structured response: ` +
          finalContractIssues.slice(0, 8).map(formatSchemaIssue).join("; ")
      );
      throw new Error("The AI response was incomplete. Please try again.");
    }
    if (spec.blockOnQualityFailure && spec.qualityCheck) {
      const finalQualityIssues = spec.qualityCheck(parsedResult, payload ?? {});
      if (finalQualityIssues.length > 0) {
        throw new Error("The AI response did not pass the required privacy review. Please try again.");
      }
    }
    const data = addNotice(parsedResult, notice);
    const totalMs = Date.now() - requestStartedAt;
    const meta = {
      requestId: requestId ?? null,
      modelUsed: result.model,
      providerUsed: result.provider ?? providerName ?? null,
      finishReason: result.finishReason ?? null,
      inputTokens: result.usage?.inputTokens ?? null,
      outputTokens: result.usage?.outputTokens ?? null,
      totalMs,
      generationMs,
      repairMs,
      qualityRetryCount,
      contractRetryCount,
      quotaFallbackCount,
      groundingFallbackCount,
    };
    console.info(JSON.stringify({
      event: "ai_tool_latency",
      outcome: "success",
      tool,
      payloadChars,
      promptChars: llmRequest.prompt.length,
      responseChars: result.text.length,
      ...meta,
    }));

    // Structured tools already return the same content as parsed data. Avoid
    // serializing and transferring a second full copy; retain text only for a
    // genuinely unstructured/unparseable response.
    return buildToolResponse(data, result.text, result.groundingChunks, meta);
  } catch (err) {
    // The model call failed AFTER charging — refund so users aren't billed for nothing.
    if (refundableCharge) await refundCredits(uid, refundableCharge);
    console.error(JSON.stringify({
      event: "ai_tool_latency",
      outcome: "error",
      tool,
      requestId: requestId ?? null,
      providerUsed: result?.provider ?? providerName ?? null,
      modelUsed: result?.model ?? null,
      payloadChars,
      totalMs: Date.now() - requestStartedAt,
      generationMs,
      repairMs,
      qualityRetryCount,
      contractRetryCount,
      quotaFallbackCount,
      groundingFallbackCount,
      errorCode: (err as { code?: unknown; status?: unknown })?.code ??
        (err as { status?: unknown })?.status ?? null,
    }));
    if (err instanceof HttpsError) throw err;
    // A plain Error thrown to the callable layer reaches the client as a blank
    // "INTERNAL" with no message (live audit: every tool failure looked identical
    // and undiagnosable). Surface the provider's message — they are key-free by
    // construction (RotatingKeyProvider/FallbackProvider never include secrets).
    const msg = err instanceof Error && err.message ? err.message : "AI generation failed. Please try again.";
    throw new HttpsError("unavailable", msg);
  }
});

function envDurationMs(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1_000, Math.min(120_000, Math.floor(value)));
}

function hasGroundingChunks(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function formatSchemaIssue(issue: SchemaValidationIssue): string {
  return `${issue.path} ${issue.message}`;
}

function contractCorrection(issues: SchemaValidationIssue[]): string {
  const summary = issues.slice(0, 12).map(formatSchemaIssue).join("; ");
  return [
    "Your previous response did not match the required JSON contract.",
    `Fix these contract errors: ${summary}.`,
    "Return one complete JSON value matching every required field and type. Do not add commentary.",
  ].join("\n");
}
