/**
 * Model registry + tier-gated provider resolution.
 *
 * This is the single place that decides WHICH llm a request runs on. Gating is
 * enforced SERVER-SIDE: a free user (or any request for a model above the user's
 * tier) silently falls back to the default — the client cannot override it.
 *
 * Tier hierarchy:
 *   free     — Gemini + KairLLM (our shared gateway). Daily run cap enforced.
 *   paid     — free + DeepSeek (our API key). Subscriptions: essentials/accelerator/executive.
 *   business — free models + custom bring-your-own API. Roles: employer OR
 *              subscriptions: starter/growth/pro/single_post/job_pack.
 *
 * The "auto" kairllm option (id "auto") is preserved for backward-compat with
 * existing paid-tier clients that may have "auto" stored as their preferred
 * model. It is deliberately NOT shown in modelsForTier() listings, but
 * resolveProvider() will still honour it if a paid user requests it.
 *
 * Empty platform_config/models ⇒ DEFAULT_MODELS is used — byte-identical to the
 * previous hardcoded MODEL_OPTIONS behaviour.
 *
 * Multi-key pooling + key health:
 *   ModelEntry.api_keys[] (preferred) or api_key (legacy) form the pool.
 *   Keys are tried in order, skipping any whose cooldownUntil is in the future.
 *   An in-process Map tracks the last-successful key index per provider+modelId
 *   so that the next call starts from the known-good key.
 *   Health failures are written best-effort to Firestore collection 'key_health'.
 *
 * Availability-only fallback chains:
 *   ModelEntry.fallbackChain[] lists model IDs to try when the primary's full
 *   key pool is exhausted on an availability-class error.  Quality errors
 *   (4xx from bad prompts, etc.) are NOT caught by the chain — only errors that
 *   indicate the key/endpoint is down/rate-limited.
 */

import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { LLMProvider, LLMRequest, LLMResult } from "./LLMProvider";
import { llmStubEnabled, makeStubProvider } from "./stubProvider";
import { GeminiProvider } from "./providers/geminiProvider";
import { OpenAICompatibleProvider } from "./providers/openAICompatibleProvider";
import { keyHash } from "./keyHash";
import { isAvailabilityError } from "./errorClassification";
import {
  candidatesForPoolTier,
  implicitFallbackCandidates,
  routingPoolForRoute,
  routingPoolTiers,
  isLatencyPriorityPool,
  routingAttemptTimeoutMs,
  selectWeightedCandidate,
  RoutingCandidate,
} from "./routingPools";
import {
  ensurePlatformCaches,
  getKairllmApiKey,
  getKairllmBaseUrl,
  getDeepseekApiKey,
  getDeepseekBaseUrl,
  getModelRegistry,
  getModuleRoutes,
  getRoutingPools,
  registerDefaultModels,
  getDefaultModelId,
  getFreeMaxOutputTokens,
} from "../config/env";
import { ModelEntry, RoutingPool } from "../admin/schema";
import { USERS_COLLECTION, USER_FIELDS } from "../credits/schema";
import { getCustomProviderConfig, type CustomProviderConfig } from "./customProviderStore";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// ---------------------------------------------------------------------------
// Tier types
// ---------------------------------------------------------------------------

/**
 * Access tiers, derived from the user's subscription_status and role.
 *
 * "business" is orthogonal to the paid upgrade path — it unlocks the
 * custom BYOA (bring-your-own-API) feature for employer/recruiter users.
 * Business users can also use free-tier models but NOT paid-tier premium
 * ones unless they also hold a paid subscription.
 */
export type Tier = "free" | "paid" | "business";

/**
 * Legacy interface kept for backward compatibility (listModels response, aiClient.ts).
 * New code should use ModelEntry from admin/schema.ts instead.
 */
export interface ModelOption {
  /** Selection id the client sends (and the picker shows). */
  id: string;
  /** Human-readable label for the picker. */
  label: string;
  /**
   * Backing provider implementation tag.
   * Note: old "kairllm" tag is normalised to "openai-compatible" in DEFAULT_MODELS.
   */
  provider: "gemini" | "kairllm" | "openai-compatible";
  /** Model name passed to the provider ("" = provider default). */
  providerModel: string;
  /** Minimum caller access allowed to use this model. */
  minTier: Tier;
}

// ---------------------------------------------------------------------------
// Default registry
// ---------------------------------------------------------------------------

/**
 * THE hardcoded default registry.
 *
 * Faithfully reproduces the previous MODEL_OPTIONS semantics so that an empty
 * platform_config/models document yields byte-identical runtime behaviour:
 *
 *   free    → gemini (default) + kairllm (our shared gateway)
 *   paid    → free models + deepseek (our DeepSeek API key)
 *   business→ free models + custom (BYOA endpoint stored server-side per user)
 *
 * "auto" is kept for backward-compat (paid tier legacy id). New code uses "kairllm".
 * "custom" is a sentinel — it is not buildable from this table alone; resolveProvider
 * reads the server-only per-user config at runtime to construct the provider.
 */
export const DEFAULT_MODELS: ModelEntry[] = [
  {
    id: "gemini",
    label: "Gemini (default)",
    provider: "gemini",
    providerModel: "",
    minTier: "free",
    enabled: true,
  },
  {
    id: "kairllm",
    label: "KairLLM",
    provider: "openai-compatible",
    builtin: "kairllm",
    providerModel: "auto",
    minTier: "free",
    enabled: true,
  },
  {
    // Backward-compat alias for "kairllm". Keep minTier "paid" so it stays
    // invisible on free tier UI, but resolveProvider accepts it for paid users.
    id: "auto",
    label: "Auto · multi-model (legacy)",
    provider: "openai-compatible",
    builtin: "kairllm",
    providerModel: "auto",
    minTier: "paid",
    enabled: true,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    provider: "openai-compatible",
    builtin: "deepseek",
    providerModel: "deepseek-chat",
    minTier: "paid",
    enabled: true,
  },
  {
    // Sentinel: custom BYOA provider for business users.
    // The actual provider config is stored in a server-only collection.
    // buildProvider() must NOT be called on this entry directly.
    id: "custom",
    label: "Custom · your API",
    provider: "openai-compatible",
    providerModel: "",
    minTier: "business",
    enabled: true,
  },
];

// Register the seed so platformConfig.getModelRegistry() has defaults available
// even before the first Firestore fetch completes.
registerDefaultModels(DEFAULT_MODELS);

export const DEFAULT_MODEL_ID = "gemini";

/**
 * True when the entry can accept inline image parts. Gemini is natively
 * multimodal; openai-compatible gateway models must be explicitly marked
 * (supportsImageInput) because most gateway text routes reject images with
 * a 404 ("No endpoints found that support image input").
 */
export function modelSupportsImageInput(entry: ModelEntry): boolean {
  return entry.provider === "gemini" || entry.supportsImageInput === true;
}

/** Built-in Google Search grounding is implemented only by GeminiProvider. */
export function modelSupportsGoogleSearch(entry: ModelEntry): boolean {
  return entry.provider === "gemini";
}

const TIER_RANK: Record<Tier, number> = { free: 0, paid: 1, business: 0 };
// Note: "business" shares rank 0 with "free" — business users get free-tier
// models but NOT paid-tier premium ones. The business sentinel ("custom")
// lives at minTier "business" which is gated separately in modelsForTier().

/** Maps a subscription_status string to an access tier. */
export function tierFromSubscription(status: string | undefined): Tier {
  switch (status) {
    case "essentials":
    case "accelerator":
    case "executive":
      return "paid";
    // Business subscriptions — tier is "free" for model-rank purposes. Note a
    // business PLAN alone does NOT unlock BYOA "custom": isBusinessUser() gates
    // on role === "employer" only (product role is authoritative).
    case "starter":
    case "growth":
    case "pro":
    case "single_post":
    case "job_pack":
      return "free";
    default:
      return "free"; // free, pending_*, unknown
  }
}

/**
 * Returns true if the user qualifies for business-tier features (BYOA custom
 * provider). Product role is authoritative; stale business tiers on candidate
 * accounts must not unlock employer-only features.
 */
export function isBusinessUser(
  role: string | undefined,
  subscriptionStatus: string | undefined
): boolean {
  return role === "employer";
}

/** Business accounts share the free model catalog, but not free-user output caps. */
export function shouldCapFreeTierOutput(tier: Tier, business: boolean): boolean {
  return tier === "free" && !business;
}

/**
 * The models a given tier is allowed to select (for the frontend picker).
 * Pass `business = true` to include the "custom" sentinel for BYOA users.
 * Reads the dynamic registry (Firestore if configured, else DEFAULT_MODELS).
 * Disabled models (enabled: false) are always excluded.
 */
export function modelsForTier(tier: Tier, business = false): ModelEntry[] {
  const registry = getModelRegistry();
  const tierRank = TIER_RANK[tier];
  return registry.filter((m) => {
    if (!m.enabled) return false;
    if (m.id === "auto") return false; // hidden: legacy alias, not shown in picker
    if (m.minTier === "business") return business; // shown only for business users
    return TIER_RANK[m.minTier] <= tierRank;
  });
}

// ---------------------------------------------------------------------------
// Key health — Firestore collection "key_health"
// ---------------------------------------------------------------------------

/** Stable 16-hex-char ID derived from a key — never stores the raw key. */
// Availability classification (what justifies key rotation / chain fallback /
// pool rotation) lives in ./errorClassification.ts, shared with geminiProvider
// and aiProxy and unit-tested against live-captured provider error shapes.

const KEY_HEALTH_COLLECTION = "key_health";
const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

interface KeyHealthDoc {
  keyHash: string;
  provider: string;
  modelId: string;
  failureCount: number;
  lastFailureAt: Timestamp | null;
  lastSuccessAt: Timestamp | null;
  cooldownUntil: Timestamp | null;
  lastErrorCode: string | null;
}

/**
 * Record a successful key use — clears cooldown best-effort.
 * Never throws; health tracking must not block user requests.
 */
async function recordKeySuccess(
  rawKey: string,
  provider: string,
  modelId: string
): Promise<void> {
  try {
    const hash = keyHash(rawKey);
    const ref = db.collection(KEY_HEALTH_COLLECTION).doc(hash);
    await ref.set(
      {
        keyHash: hash,
        provider,
        modelId,
        lastSuccessAt: FieldValue.serverTimestamp(),
        cooldownUntil: null,
        lastErrorCode: null,
      },
      { merge: true }
    );
  } catch {
    // best-effort: swallow
  }
}

/**
 * Record a key failure — increments failureCount and sets cooldownUntil.
 * Never throws.
 */
async function recordKeyFailure(
  rawKey: string,
  provider: string,
  modelId: string,
  err: unknown
): Promise<void> {
  try {
    const hash = keyHash(rawKey);
    const ref = db.collection(KEY_HEALTH_COLLECTION).doc(hash);
    const cooldownUntil = Timestamp.fromMillis(Date.now() + COOLDOWN_MS);
    const lastErrorCode = extractErrorCode(err);
    await ref.set(
      {
        keyHash: hash,
        provider,
        modelId,
        failureCount: FieldValue.increment(1),
        lastFailureAt: FieldValue.serverTimestamp(),
        cooldownUntil,
        lastErrorCode,
      },
      { merge: true }
    );
  } catch {
    // best-effort: swallow
  }
}

function extractErrorCode(err: unknown): string {
  const e = err as { message?: string; status?: number; code?: number | string };
  if (e?.status) return String(e.status);
  if (e?.code) return String(e.code);
  const msg = (e?.message ?? "").toLowerCase();
  const match = msg.match(/\b(401|402|403|408|425|429|500|502|503|504)\b/);
  if (match) return match[1];
  if (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("abort") ||
    (err as { code?: unknown })?.code === 23
  ) return "timeout";
  if (msg.includes("empty response")) return "empty";
  return "unknown";
}

// ---------------------------------------------------------------------------
// In-process "last successful key index" per provider+modelId
// ---------------------------------------------------------------------------

/**
 * Maps `${provider}:${modelId}` → last successful key index.
 * Used to start rotation from the last-known-working key rather than always
 * index 0. Process-scoped (resets on cold start) — just an optimisation.
 */
const lastSuccessfulKeyIndex = new Map<string, number>();

// ---------------------------------------------------------------------------
// Key pool resolution (api_keys > api_key > builtin)
// ---------------------------------------------------------------------------

/**
 * Resolves the ordered pool of raw API keys for an entry.
 * Returns [] if the entry is gemini (gemini uses its own key internally).
 */
function resolveKeyPool(entry: ModelEntry): string[] {
  if (entry.provider === "gemini") return [];

  // api_keys pool (multi-key, preferred)
  if (entry.api_keys && entry.api_keys.length > 0) {
    return entry.api_keys.filter((k) => k.trim().length > 0);
  }
  // legacy single key
  if (entry.api_key && entry.api_key.trim()) {
    return [entry.api_key];
  }
  // builtin platform keys — single key from platform config
  if (entry.builtin === "kairllm") {
    try { return [getKairllmApiKey()]; } catch { return []; }
  }
  if (entry.builtin === "deepseek") {
    try { return [getDeepseekApiKey()]; } catch { return []; }
  }
  return [];
}

// ---------------------------------------------------------------------------
// buildProvider (single-key, inner factory — no rotation wrapper)
// ---------------------------------------------------------------------------

/**
 * Constructs an LLMProvider from a registry entry, using the given apiKey override.
 * Used internally by the rotation wrapper; external callers should use
 * buildProvider() which handles the full pool automatically.
 *
 * The "custom" sentinel MUST NOT reach this function — resolveProvider handles
 * it separately through the server-only custom-provider store.
 */
function buildProviderWithKey(entry: ModelEntry, apiKey?: string): LLMProvider {
  if (entry.provider === "gemini") {
    return new GeminiProvider(entry.providerModel || undefined, apiKey);
  }

  // openai-compatible: resolve base_url
  let baseUrl: string;
  if (entry.base_url) {
    baseUrl = entry.base_url;
  } else if (entry.builtin === "kairllm") {
    baseUrl = getKairllmBaseUrl();
  } else if (entry.builtin === "deepseek") {
    baseUrl = getDeepseekBaseUrl();
  } else {
    baseUrl = entry.base_url ?? "";
  }

  // resolve api_key: prefer caller-supplied override
  let resolvedKey: string;
  if (apiKey) {
    resolvedKey = apiKey;
  } else if (entry.api_key) {
    resolvedKey = entry.api_key;
  } else if (entry.builtin === "kairllm") {
    resolvedKey = getKairllmApiKey();
  } else if (entry.builtin === "deepseek") {
    resolvedKey = getDeepseekApiKey();
  } else {
    resolvedKey = entry.api_key ?? "";
  }

  return new OpenAICompatibleProvider({
    name: entry.id,
    baseUrl,
    apiKey: resolvedKey,
    model: entry.providerModel || "auto",
  });
}

// ---------------------------------------------------------------------------
// RotatingKeyProvider — wraps multi-key pool with health-aware rotation
// ---------------------------------------------------------------------------

/**
 * Wraps an openai-compatible entry's key pool with health-aware rotation.
 *
 * On each generate() call:
 *   1. Starts from lastSuccessfulKeyIndex for the entry (if set) to favour the
 *      last working key.
 *   2. Skips keys whose cooldownUntil is still in the future (async check on
 *      key_health docs — best-effort; if Firestore is unavailable we skip the
 *      health check and try all keys).
 *   3. Attempts the first non-cooled key; on availability-class failure rotates
 *      to the next, recording the failure to key_health (best-effort).
 *   4. On success records the success (best-effort) and saves the index.
 *   5. Throws the last error if all keys are exhausted.
 *
 * For the Gemini provider (no key pool), generate() is a straight pass-through.
 * HANDLER CODE NEVER CHANGES — they just call provider.generate().
 */
class RotatingKeyProvider implements LLMProvider {
  readonly name: string;
  private readonly entry: ModelEntry;
  private readonly keyPool: string[];
  private readonly poolKey: string; // for lastSuccessfulKeyIndex map

  constructor(entry: ModelEntry, keyPool: string[]) {
    this.entry = entry;
    this.name = entry.id;
    this.keyPool = keyPool;
    this.poolKey = `${entry.provider}:${entry.id}`;
  }

  async generate(req: LLMRequest): Promise<LLMResult> {
    // Gemini: no key pool, direct build
    if (this.entry.provider === "gemini" || this.keyPool.length === 0) {
      return buildProviderWithKey(this.entry).generate(req);
    }

    // Build cooldown status for keys (best-effort — don't block on Firestore errors)
    const cooldownSet = await this.getCooledDownKeys();

    // Determine start index (favour last-known-good key)
    const startIdx = lastSuccessfulKeyIndex.get(this.poolKey) ?? 0;
    const n = this.keyPool.length;

    let lastErr: unknown;
    for (let i = 0; i < n; i++) {
      const idx = (startIdx + i) % n;
      const rawKey = this.keyPool[idx];
      const hash = keyHash(rawKey);

      if (cooldownSet.has(hash)) {
        // Skip cooled-down key — keep lastErr as is
        continue;
      }

      const inner = buildProviderWithKey(this.entry, rawKey);
      try {
        const result = await inner.generate(req);
        // Success: update in-process index and record health
        lastSuccessfulKeyIndex.set(this.poolKey, idx);
        recordKeySuccess(rawKey, this.entry.provider, this.entry.id).catch(() => undefined);
        return result;
      } catch (err: unknown) {
        lastErr = err;
        if (isAvailabilityError(err)) {
          // Record failure and try next key
          recordKeyFailure(rawKey, this.entry.provider, this.entry.id, err).catch(
            () => undefined
          );
          console.warn(
            `[key-rotation] Key[${idx}] for model "${this.entry.id}" failed (availability). ` +
              `Trying next key. Error: ${(err as Error)?.message?.slice(0, 120)}`
          );
          continue;
        }
        // Non-availability error (e.g. bad prompt, schema error) — rethrow immediately
        throw err;
      }
    }

    // All keys exhausted (or all cooled down)
    throw lastErr ?? new Error(`All API keys for model "${this.entry.id}" are unavailable.`);
  }

  /** Returns a set of keyHash strings that are currently in cooldown. */
  private async getCooledDownKeys(): Promise<Set<string>> {
    if (this.keyPool.length === 0) return new Set();
    try {
      const hashes = this.keyPool.map(keyHash);
      const refs = hashes.map((h) => db.collection(KEY_HEALTH_COLLECTION).doc(h));
      const snaps = await db.getAll(...refs);
      const cooled = new Set<string>();
      const now = Date.now();
      for (const snap of snaps) {
        if (!snap.exists) continue;
        const doc = snap.data() as KeyHealthDoc;
        if (doc.cooldownUntil && doc.cooldownUntil.toMillis() > now) {
          cooled.add(doc.keyHash);
        }
      }
      return cooled;
    } catch {
      // Best-effort: if Firestore health check fails, treat all keys as available
      return new Set();
    }
  }
}

// ---------------------------------------------------------------------------
// FallbackProvider — wraps primary with availability-only chain fallback
// ---------------------------------------------------------------------------

/**
 * Wraps a primary provider with an ordered list of fallback providers.
 *
 * On generate():
 *   - Calls primary.generate().
 *   - If primary throws an availability-class error (after key rotation is
 *     exhausted), tries each fallback in order.
 *   - Quality / non-availability errors from the primary are rethrown immediately
 *     without trying fallbacks.
 *   - Logs fallbacks via console.warn (model ids only — no keys).
 */
class FallbackProvider implements LLMProvider {
  readonly name: string;
  private readonly primary: LLMProvider;
  private readonly fallbacks: Array<{ modelId: string; provider: LLMProvider }>;

  constructor(
    primary: LLMProvider,
    primaryModelId: string,
    fallbacks: Array<{ modelId: string; provider: LLMProvider }>
  ) {
    this.primary = primary;
    this.name = primaryModelId;
    this.fallbacks = fallbacks;
  }

  async generate(req: LLMRequest): Promise<LLMResult> {
    try {
      return await this.primary.generate(req);
    } catch (primaryErr: unknown) {
      if (!isAvailabilityError(primaryErr)) {
        throw primaryErr;
      }
      console.warn(
        `[fallback-chain] Primary model "${this.name}" unavailable. ` +
          `Trying chain: [${this.fallbacks.map((f) => f.modelId).join(", ")}]`
      );
      let lastErr: unknown = primaryErr;
      for (const fb of this.fallbacks) {
        try {
          const result = await fb.provider.generate(req);
          console.warn(`[fallback-chain] Succeeded on fallback model "${fb.modelId}".`);
          return result;
        } catch (fbErr: unknown) {
          lastErr = fbErr;
          if (!isAvailabilityError(fbErr)) {
            throw fbErr;
          }
          console.warn(
            `[fallback-chain] Fallback model "${fb.modelId}" also unavailable: ` +
              `${(fbErr as Error)?.message?.slice(0, 120)}`
          );
        }
      }
      // Whole chain exhausted — log the technical detail server-side, but throw
      // ONE clear, key-free message users and support can act on (instead of
      // whatever internal error the last provider happened to raise).
      console.error(
        `[fallback-chain] All models exhausted (primary "${this.name}" + ${this.fallbacks.length} fallbacks). ` +
          `Last error: ${(lastErr as Error)?.message?.slice(0, 160)}`
      );
      throw new Error(
        "All configured AI models are currently unavailable. Please try again in a few minutes — if this persists, an administrator needs to check the API keys in the admin console."
      );
    }
  }
}

// ---------------------------------------------------------------------------
// FreeTierOutputCapProvider — caps maxOutputTokens for free-tier requests (C)
// ---------------------------------------------------------------------------

/**
 * Service-tiering wrapper (服务分级 — free/paid output-quality boundary).
 *
 * When a free-tier user's request arrives with maxOutputTokens undefined, this
 * wrapper injects the admin-configurable cap from
 * platform_config/quotas.free_max_output_tokens (default 8192) before delegating
 * to the inner provider. (Earlier fixed values proved too tight: large structured
 * outputs — career roadmaps, formatted resumes — truncated mid-JSON and failed to
 * parse, bricking those tools for free users.)
 * Paid/business callers pass through unmodified (they may supply their own cap
 * or leave it undefined for the provider default).
 *
 * Admins can deepen the gap later via per-tier prompt variants without touching
 * provider code — the token cap is the enforceable output boundary.
 */
function buildProviderForPoolMember(candidate: RoutingCandidate): LLMProvider | null {
  const { model, member } = candidate;
  // Defensive mirror of the admin-side validation: the "custom" BYOA sentinel
  // must never build from the registry (no key/URL — per-user config only). A
  // stale or hand-edited pool doc would otherwise route into an empty provider.
  if (model.id === "custom") return null;
  if (!member.keyHash) return buildProvider(model);
  const rawKey = resolveKeyPool(model).find((key) => keyHash(key) === member.keyHash);
  if (!rawKey) return null;
  return new RotatingKeyProvider(model, [rawKey]);
}

class RoutingPoolProvider implements LLMProvider {
  readonly name: string;
  private readonly pool: RoutingPool;
  private readonly registry: ModelEntry[];
  private readonly allowedModelIds: Set<string>;

  constructor(pool: RoutingPool, registry: ModelEntry[], allowedModelIds: Set<string>) {
    this.name = pool.id;
    this.pool = pool;
    this.registry = registry;
    this.allowedModelIds = allowedModelIds;
  }

  async generate(req: LLMRequest): Promise<LLMResult> {
    const latencyPriority = isLatencyPriorityPool(this.pool);
    const totalBudgetMs = latencyPriority
      ? envDurationMs("LLM_SPEED_ROUTE_TOTAL_TIMEOUT_MS", 45_000, 5_000, 120_000)
      : undefined;
    const attemptBudgetMs = latencyPriority
      ? envDurationMs("LLM_SPEED_ROUTE_ATTEMPT_TIMEOUT_MS", 30_000, 3_000, 60_000)
      : undefined;
    const deadlineAt = totalBudgetMs ? Date.now() + totalBudgetMs : undefined;
    let lastErr: unknown;
    for (const tier of routingPoolTiers(this.pool)) {
      let candidates = candidatesForPoolTier(this.pool, this.registry, this.allowedModelIds, tier);
      while (candidates.length > 0) {
        const remainingMs = deadlineAt ? deadlineAt - Date.now() : undefined;
        if (remainingMs !== undefined && remainingMs < 1_000) {
          throw lastErr ?? new Error(`Routing pool "${this.pool.id}" exhausted its latency budget.`);
        }
        const selected = selectWeightedCandidate(candidates);
        if (!selected) break;
        candidates = candidates.filter((candidate) => candidate !== selected);
        const provider = buildProviderForPoolMember(selected);
        if (!provider) continue;
        try {
          const timeoutMs = attemptBudgetMs
            ? routingAttemptTimeoutMs(
                attemptBudgetMs,
                remainingMs ?? attemptBudgetMs,
                req.timeoutMs
              )
            : req.timeoutMs;
          return await provider.generate(
            timeoutMs === req.timeoutMs ? req : { ...req, timeoutMs }
          );
        } catch (err: unknown) {
          lastErr = err;
          if (!isAvailabilityError(err)) throw err;
          console.warn(
            `[routing-pool] Pool "${this.pool.id}" tier ${tier} member "${selected.member.modelId}" unavailable.`
          );
        }
      }
    }
    throw lastErr ?? new Error(`No available routing-pool member for "${this.pool.id}".`);
  }
}

class FreeTierOutputCapProvider implements LLMProvider {
  readonly name: string;
  private readonly inner: LLMProvider;
  private readonly cap: number;

  constructor(inner: LLMProvider, cap: number) {
    this.inner = inner;
    this.name = inner.name;
    this.cap = cap;
  }

  async generate(req: LLMRequest): Promise<LLMResult> {
    // Only inject the cap when the caller did not already specify one.
    const cappedReq: LLMRequest =
      req.maxOutputTokens === undefined
        ? { ...req, maxOutputTokens: this.cap }
        : req;
    return this.inner.generate(cappedReq);
  }
}

// ---------------------------------------------------------------------------
// buildProvider — public entry point (with key-pool rotation support)
// ---------------------------------------------------------------------------

/**
 * Constructs an LLMProvider from a registry entry.
 *
 * Key/URL resolution for openai-compatible entries:
 *   api_keys (if non-empty) → api_key → builtin platform key
 *   base_url = entry.base_url (if non-empty) else built-in from entry.builtin
 *
 * For entries with more than one key (after resolveKeyPool), the returned
 * provider is a RotatingKeyProvider that handles health-aware rotation
 * transparently.  For single-key entries a RotatingKeyProvider is still
 * returned (it degrades gracefully to a single attempt with health recording).
 *
 * NOTE: buildProvider does NOT attach the fallbackChain — that is done by
 * resolveProvider() which has access to the full registry and user tier.
 *
 * The "custom" sentinel MUST NOT reach this function — resolveProvider handles
 * it separately through the server-only custom-provider store.
 *
 * Exported so admin test-connection code can reuse the same key/base resolution
 * without duplicating logic. Does NOT do tier-gating — callers are responsible
 * for any access checks before calling this.
 *
 * @param rawKeyOverride Optional raw key override — bypasses pool resolution.
 *   Used by adminTestModel to test a specific key from the pool without full rotation.
 */
export function buildProvider(entry: ModelEntry, rawKeyOverride?: string): LLMProvider {
  if (entry.provider === "gemini") {
    return new GeminiProvider(entry.providerModel || undefined, rawKeyOverride || entry.api_key);
  }

  // If caller supplies a raw key override (e.g. admin testing a specific key),
  // bypass pool rotation and build a single-key provider directly.
  if (rawKeyOverride) {
    return buildProviderWithKey(entry, rawKeyOverride);
  }

  // Resolve key pool and wrap in rotation provider
  const pool = resolveKeyPool(entry);
  return new RotatingKeyProvider(entry, pool);
}

// ---------------------------------------------------------------------------
// resolveProvider — main entry point for all feature handlers
// ---------------------------------------------------------------------------

/**
 * Resolves the provider for a user + requested model, enforcing tier gating.
 * Reads users/{uid} to determine tier and role, then reads business credentials
 * from the server-only custom-provider store only when requested.
 *
 * Gating is fail-safe: any model a user's tier can't access silently falls
 * back to the tier default. No exception is thrown, no higher model leaks.
 * Disabled models are treated as non-existent.
 *
 * Business custom provider flow:
 *   - User must be business (role employer).
 *   - User must request model id "custom".
 *   - The server-only provider document must have { base_url, api_key, model }.
 *   - Falls back to gemini if any of those conditions are unmet.
 *
 * Multi-key rotation:
 *   The returned provider is a RotatingKeyProvider (transparent to callers).
 *
 * Fallback chain:
 *   If the chosen entry has a non-empty fallbackChain, the returned provider
 *   is wrapped in a FallbackProvider.  Each chain entry must exist in the
 *   registry and be accessible to the user's tier; inaccessible entries are
 *   skipped silently.
 */
export async function resolveProvider(
  uid: string,
  requestedModelId?: string,
  routeKey?: string,
  opts?: { needsImageInput?: boolean; needsGoogleSearch?: boolean }
): Promise<LLMProvider> {
  // E2E happy-path harness (SCRUM-42): deterministic, free, schema-valid output.
  // Gated on E2E_LLM_STUB so it can never short-circuit a real production request.
  if (llmStubEnabled()) return makeStubProvider();

  // Warm the platform-config cache FIRST so the (sync) key/model getters used by
  // buildProvider() read admin-configured Firestore values instead of a cold cache.
  await ensurePlatformCaches();

  let tier: Tier = "free";
  let business = false;
  let customProviderConfig: CustomProviderConfig | null = null;

  try {
    const snap = await db.collection(USERS_COLLECTION).doc(uid).get();
    const subscriptionStatus = snap.get(USER_FIELDS.subscriptionStatus) as
      | string
      | undefined;
    const role = snap.get(USER_FIELDS.role) as string | undefined;

    tier = tierFromSubscription(subscriptionStatus);
    business = isBusinessUser(role, subscriptionStatus);

    // Read private credentials only when needed. The store atomically migrates
    // and deletes any legacy users/{uid}.custom_provider field it encounters.
    if (business && requestedModelId === "custom") {
      customProviderConfig = await getCustomProviderConfig(uid);
    }
  } catch {
    tier = "free"; // fail safe
    business = false;
  }

  // --- Custom BYOA path (business only) ---
  if (business && requestedModelId === "custom" && customProviderConfig) {
    return new OpenAICompatibleProvider({
      name: "custom",
      baseUrl: customProviderConfig.base_url,
      apiKey: customProviderConfig.api_key,
      model: customProviderConfig.model,
    });
  }

  // --- Standard model registry path ---
  // Build the allowed set for this user (respects tier + business flag).
  const registry = getModelRegistry();
  const allowed = modelsForTier(tier, business);

  // Also allow the "auto" alias for paid users who may have it stored.
  // We look it up in the registry directly (it's excluded from modelsForTier).
  const autoOption = registry.find((m) => m.id === "auto" && m.enabled);
  const allowedWithAutoUnfiltered =
    tier === "paid" && autoOption ? [...allowed, autoOption] : allowed;
  // Modality gate: an image-bearing request (multimodal resume upload) may
  // only route to models that can accept image parts — routing pools and the
  // standard path both read this set, so a text-only pool member is skipped
  // instead of 404ing the whole request.
  const needsImageInput = opts?.needsImageInput === true;
  const modalityAllowed = needsImageInput
    ? allowedWithAutoUnfiltered.filter(modelSupportsImageInput)
    : allowedWithAutoUnfiltered;
  // Google Search grounding is a Gemini capability in this provider layer.
  // OpenAI-compatible routes explicitly ignore useGoogleSearch; allowing them
  // here silently returned ungrounded data while the UI presented source affordances.
  const allowedWithAuto = opts?.needsGoogleSearch
    ? modalityAllowed.filter(modelSupportsGoogleSearch)
    : modalityAllowed;
  const allowedIds = new Set(allowedWithAuto.map((m) => m.id));

  // Module routing pools take precedence over requestedModelId. This is safe
  // ONLY because model routing is platform-managed: the client's aiClient
  // discards every user pick except the business BYOA sentinel "custom"
  // (handled above, before this point) and always sends the platform default.
  // If a real per-user model picker is ever reintroduced, an explicit concrete
  // pick must bypass the pool here — otherwise the user's choice is silently
  // ignored.
  const routePool = routingPoolForRoute(routeKey, getModuleRoutes(), getRoutingPools());
  if (routePool) {
    const hasUsableCandidate = routingPoolTiers(routePool).some((poolTier) =>
      candidatesForPoolTier(routePool, registry, allowedIds, poolTier).some((candidate) =>
        !candidate.member.keyHash ||
        resolveKeyPool(candidate.model).some((key) => keyHash(key) === candidate.member.keyHash)
      )
    );
    if (hasUsableCandidate) {
      const provider = new RoutingPoolProvider(routePool, registry, allowedIds);
      if (shouldCapFreeTierOutput(tier, business)) {
        return new FreeTierOutputCapProvider(provider, getFreeMaxOutputTokens());
      }
      return provider;
    }
  }

  // --- Feature A: admin-configured default model ---
  // Prefer the admin-set default when it exists in the registry, is enabled,
  // and the user's tier is allowed to use it.
  const adminDefaultId = getDefaultModelId();
  const adminDefaultEntry =
    adminDefaultId
      ? allowedWithAuto.find((m) => m.id === adminDefaultId && m.enabled)
      : undefined;

  // Absolute fallback: admin default (if valid) > hardcoded DEFAULT_MODEL_ID > first enabled.
  // Image requests additionally require an image-capable entry — DEFAULT_MODELS[0]
  // is gemini, which is always multimodal.
  const absoluteFallback =
    adminDefaultEntry ??
    (needsImageInput
      ? registry.find((m) => m.id === DEFAULT_MODEL_ID && m.enabled) ??
        registry.find((m) => m.enabled && modelSupportsImageInput(m)) ??
        DEFAULT_MODELS[0]
      : registry.find((m) => m.id === DEFAULT_MODEL_ID && m.enabled) ??
        registry.find((m) => m.enabled) ??
        DEFAULT_MODELS[0]); // always gemini

  const chosen =
    allowedWithAuto.find((m) => m.id === requestedModelId) ??
    adminDefaultEntry ??
    allowedWithAuto.find((m) => m.id === DEFAULT_MODEL_ID) ??
    absoluteFallback;

  // Build the primary provider (with key-pool rotation)
  const primary = buildProvider(chosen);

  // --- Feature B: implicit availability auto-fallback ---
  // Build a FallbackProvider even when the chosen entry has no explicit
  // fallbackChain, using other enabled+tier-allowed models (excluding the
  // primary) sorted by (priority ?? 999) then registry order, capped at 3.
  const buildFallbackList = (
    explicitChain: string[] | undefined
  ): Array<{ modelId: string; provider: LLMProvider }> => {
    const fallbacks: Array<{ modelId: string; provider: LLMProvider }> = [];

    if (explicitChain && explicitChain.length > 0) {
      // Explicit chain: respect the admin-defined order, apply tier check.
      for (const chainId of explicitChain) {
        if (chainId === "custom") {
          console.warn(`[fallback-chain] Chain entry "custom" is per-user BYOA. Skipping.`);
          continue;
        }
        const chainEntry = registry.find((m) => m.id === chainId && m.enabled);
        if (!chainEntry) {
          console.warn(
            `[fallback-chain] Chain entry "${chainId}" not found or disabled. Skipping.`
          );
          continue;
        }
        if (!allowedWithAuto.some((m) => m.id === chainId)) {
          console.warn(
            `[fallback-chain] Chain entry "${chainId}" exceeds user tier. Skipping.`
          );
          continue;
        }
        fallbacks.push({ modelId: chainId, provider: buildProvider(chainEntry) });
      }
      return fallbacks;
    }

    // Implicit chain: other enabled models accessible to the user's tier,
    // sorted by (priority ?? 999) ascending then registry order, capped at 3.
    const candidates = implicitFallbackCandidates(allowedWithAuto, chosen.id);

    for (const entry of candidates) {
      fallbacks.push({ modelId: entry.id, provider: buildProvider(entry) });
    }
    return fallbacks;
  };

  const fallbacks = buildFallbackList(chosen.fallbackChain);

  // Wrap with FallbackProvider when at least one fallback is available.
  let finalProvider: LLMProvider;
  if (fallbacks.length > 0) {
    finalProvider = new FallbackProvider(primary, chosen.id, fallbacks);
  } else {
    finalProvider = primary;
  }

  // --- Feature C: service tiering — free-tier output cap ---
  // Free-tier requests get an output-token ceiling (服务分级), admin-configurable
  // via platform_config/quotas.free_max_output_tokens. Default 8192 = the model's
  // native max, i.e. NO artificial truncation (a lower value previously cut large
  // structured outputs — career roadmaps, formatted resumes — mid-JSON and broke
  // those tools). The genuine free/paid quality gap is the model access class; admins can
  // lower this knob for a harder boundary. Paid/business pass through uncapped.
  if (shouldCapFreeTierOutput(tier, business)) {
    return new FreeTierOutputCapProvider(finalProvider, getFreeMaxOutputTokens());
  }

  return finalProvider;
}

function envDurationMs(
  name: string,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}
