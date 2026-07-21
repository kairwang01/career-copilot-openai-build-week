/**
 * Shared LLM error classification.
 *
 * Single source of truth for the three places that previously carried their own
 * copies (geminiProvider internal fallback, aiProxy quota degradation, models.ts
 * key-rotation / fallback-chain / routing-pool). Exported as pure functions so
 * they are unit-testable against real captured provider error shapes.
 */

interface ErrorShape {
  message?: string;
  status?: number;
  code?: number | string;
}

/** Quota / rate-limit class: HTTP 429 or provider quota language. */
export function isQuotaError(error: unknown): boolean {
  const err = error as ErrorShape;
  const message = (err?.message ?? "").toLowerCase();
  return (
    err?.status === 429 ||
    err?.code === 429 ||
    err?.code === "resource-exhausted" ||
    message.includes("resource_exhausted") ||
    message.includes("quota exceeded") ||
    message.includes("quota")
  );
}

/**
 * Retired / unknown model class. Gemini reports a retired model as HTTP 404
 * "This model models/<id> is no longer available" (live-captured 2026-07-12) and
 * an unknown one as 404 "models/<id> is not found for API version ...";
 * OpenAI-compatible gateways say 404 "The model `<id>` does not exist" or
 * "model not found". None of these are quota errors and none matched
 * isAvailabilityError's patterns, so a retired primary hard-failed every request
 * instead of falling back (the gemini-2.0-flash retirement outage). A model that
 * cannot serve ANY request is exactly what fallbacks exist for.
 */
export function isModelUnavailableError(error: unknown): boolean {
  const err = error as ErrorShape;
  const msg = (err?.message ?? "").toLowerCase();
  if (err?.status === 404 || err?.code === 404) return true;
  if (/llm provider error 404/.test(msg)) return true;
  return (
    msg.includes("no longer available") ||
    msg.includes("is not found for") ||
    msg.includes("model not found") ||
    msg.includes("does not exist")
  );
}

/**
 * Failure classes that justify rotating to another key / model (availability
 * errors): auth failures, rate limits, timeouts, empty responses, dead keys,
 * network errors, modality mismatches, and retired/unknown models. Quality
 * errors (bad prompts, schema violations) must NOT match — they would fail
 * identically on every fallback.
 */
export function isAvailabilityError(err: unknown): boolean {
  const e = err as ErrorShape;
  const msg = (e?.message ?? "").toLowerCase();
  // HTTP status codes
  if ([401, 402, 403, 408, 425, 429, 500, 502, 503, 504].includes(Number(e?.status))) return true;
  if ([401, 402, 403, 408, 425, 429, 500, 502, 503, 504].includes(Number(e?.code))) return true;
  // Detect status codes embedded in message strings (e.g. "LLM provider error 429: ...")
  if (/llm provider error (401|402|403|408|425|429|500|502|503|504)/.test(msg)) return true;
  // Modality mismatch from gateway routers (e.g. OpenRouter-style
  // "No endpoints found that support image input") — this model cannot serve
  // THIS request; rotating to a multimodal fallback can.
  if (msg.includes("support image input") || msg.includes("no endpoints found")) return true;
  // Retired / unknown model (404) — cannot serve ANY request; rotate.
  if (isModelUnavailableError(err)) return true;
  // Timeout
  if (msg.includes("timeout") || msg.includes("timed out")) return true;
  // Empty response
  if (msg.includes("empty response")) return true;
  // Quota / rate-limit language from provider responses
  if (
    msg.includes("resource_exhausted") ||
    msg.includes("quota exceeded") ||
    msg.includes("quota") ||
    msg.includes("rate limit") ||
    msg.includes("rate_limit") ||
    msg.includes("insufficient_quota") ||
    msg.includes("overloaded")
  )
    return true;
  // Gemini: status 429 embedded in error name
  if (msg.includes("429") || msg.includes("401") || msg.includes("403")) return true;
  // Dead/invalid API keys and exhausted key pools. Gemini reports a bad key as
  // HTTP 400 "API key not valid" (NOT 401!), and RotatingKeyProvider throws
  // "All API keys ... are unavailable" when the pool is empty/cooled — neither
  // matched the patterns above, so the fallback chain silently never engaged
  // (live audit 2026-06-10: a dead default model 500'd every tool instead of
  // hopping to the healthy fallback). All of these mean "this model cannot
  // serve right now", which is exactly what the chain exists for.
  if (
    msg.includes("api key not valid") ||
    msg.includes("api_key_invalid") ||
    msg.includes("invalid api key") ||
    msg.includes("incorrect api key") ||
    msg.includes("api key expired") ||
    msg.includes("all api keys") ||
    msg.includes("unavailable") ||
    msg.includes("enotfound") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("fetch failed")
  )
    return true;
  return false;
}
