/**
 * adminTestModel — admin callable that performs a real minimal LLM round-trip
 * to confirm a model/key is working.
 *
 * Security invariants:
 *   - requireRole('super') is called first — only super-admins may test key material.
 *   - The raw api_key is NEVER returned in the response, logged in the audit
 *     trail, or included in error messages (scrubbed via scrubKey()).
 *   - The test prompt is tiny (cost-bounded: ~5 input tokens, ~2 output tokens).
 *   - A 15-second Promise.race timeout prevents hanging on dead endpoints.
 *   - Returns { ok: false, error } on failure — never throws — so the UI always
 *     gets a structured response rather than an opaque Functions error.
 *
 * Supported request shapes (exactly ONE of id / config must be present):
 *
 *   { id: string }
 *     Test a registry model using its configured key pool (full rotation),
 *     OR optionally target one specific key in the pool via:
 *       keyIndex: number  — 0-based index into api_keys (or api_key if no pool)
 *       keyHash: string   — 16-hex hash of a pinnable saved key (the id used by
 *                           routing-pool member pins); resolves via the SAME
 *                           key-pool semantics as the runtime router
 *       rawKey: string    — ad-hoc raw key to substitute (bypasses pool entirely)
 *     At most one of keyIndex / keyHash / rawKey may be set at a time.
 *
 *   { config: AdHocConfig }
 *     Test an ad-hoc config (e.g. a key the admin just typed in the UI).
 *     Same ad-hoc shape as before; unchanged.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { requireRole } from "../admin/roles";
import { ensurePlatformCaches, getModelRegistry } from "../admin/platformConfig";
import { buildProvider } from "../llm/models";
import { keyHash } from "../llm/keyHash";
import { pinnableKeysForModel } from "../llm/routingPools";
import { logAdminAction } from "../admin/usageLog";
import { ModelEntry } from "../admin/schema";

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

/**
 * Ad-hoc config the admin can pass to test a key they have NOT yet saved.
 * Mirrors the fields of ModelEntry that buildProvider() actually reads.
 */
interface AdHocConfig {
  provider: "gemini" | "openai-compatible";
  /** Required (https) for openai-compatible without a builtin. */
  base_url?: string;
  /** The api_key to test. Treated as write-only — never echoed back. */
  api_key?: string;
  /** Inherit platform-configured key+base for this builtin gateway. */
  builtin?: "kairllm" | "deepseek";
  /** Model name passed to the provider. Defaults to "" (provider default). */
  providerModel?: string;
}

/**
 * Request shape accepted by adminTestModel.
 *
 * Exactly ONE of `id` or `config` must be present:
 *   { id: string }           — test a model already in the registry by id
 *   { config: AdHocConfig }  — test an ad-hoc config (e.g. a key the admin just typed)
 *
 * When using `id`, optionally supply ONE of:
 *   keyIndex: number  — 0-based index into the model's api_keys pool (or api_key for
 *                       single-key models).  Tests that specific key only; bypasses
 *                       rotation so other keys in the pool are not tried on failure.
 *   rawKey: string    — override the key entirely with this raw value; bypasses the
 *                       stored pool.  Useful to preview-test a key before adding it.
 */
interface TestModelRequest {
  id?: string;
  config?: AdHocConfig;
  /** 0-based index into the model's key pool (api_keys or api_key). */
  keyIndex?: number;
  /** Hash of a pinnable saved key — same identifier routing-pool pins use. */
  keyHash?: string;
  /** Raw API key override — bypasses the stored pool entirely. */
  rawKey?: string;
}

/** Success response. */
interface TestModelOk {
  ok: true;
  text: string;      // first 300 chars of the model's reply
  latencyMs: number;
}

/** Failure response (never throws — always returns this shape on error). */
interface TestModelFail {
  ok: false;
  error: string;     // scrubbed — never contains the raw api_key
}

type TestModelResponse = TestModelOk | TestModelFail;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_PROVIDERS = new Set<AdHocConfig["provider"]>(["gemini", "openai-compatible"]);
const VALID_BUILTINS = new Set(["kairllm", "deepseek"]);
const PROVIDER_TIMEOUT_MS = 14_000;
const OUTER_TIMEOUT_MS = 15_000;
const PROBE_PROMPT = "Reply with exactly the word OK and no other text.";

/**
 * Replaces every occurrence of a non-empty secret string in `message` with
 * "[REDACTED]" so api_keys never leak through error text.
 */
function scrubKey(message: string, ...apiKeys: (string | undefined)[]): string {
  let result = message;
  for (const apiKey of apiKeys) {
    if (!apiKey) continue;
    // Escape regex metacharacters in the key before using it as a pattern.
    const escaped = apiKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "g"), "[REDACTED]");
  }
  return result;
}

/** Outer guard whose timer is cleared immediately after the provider settles. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`LLM test timed out after ${ms}ms`)),
          ms
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/** Reject proxy HTML, empty output, and models that ignored the probe. */
export function isSuccessfulProbeResponse(text: unknown): text is string {
  return typeof text === "string" && text.trim().toUpperCase() === "OK";
}

async function runProbe(provider: ReturnType<typeof buildProvider>): Promise<{
  ok: boolean;
  responseText: string;
  errorMessage: string;
  latencyMs: number;
}> {
  const startMs = Date.now();
  try {
    const result = await withTimeout(
      provider.generate({
        prompt: PROBE_PROMPT,
        temperature: 0,
        maxOutputTokens: 8,
        timeoutMs: PROVIDER_TIMEOUT_MS,
      }),
      OUTER_TIMEOUT_MS
    );
    const responseText = (result.text ?? "").slice(0, 300);
    if (!isSuccessfulProbeResponse(responseText)) {
      return {
        ok: false,
        responseText: "",
        errorMessage: "Model returned an unexpected probe response.",
        latencyMs: Date.now() - startMs,
      };
    }
    return {
      ok: true,
      responseText,
      errorMessage: "",
      latencyMs: Date.now() - startMs,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      responseText: "",
      errorMessage: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - startMs,
    };
  }
}

/**
 * Resolves the ordered key pool for a registry entry:
 *   api_keys (if non-empty) → [api_key] → [] (builtin keys are in the provider itself)
 */
function resolvePool(found: ModelEntry): string[] {
  if (found.api_keys && found.api_keys.length > 0) return found.api_keys;
  if (found.api_key) return [found.api_key];
  return [];
}

// ---------------------------------------------------------------------------
// Callable
// ---------------------------------------------------------------------------

export const adminTestModelFunction = onCall(
  { invoker: "public" },
  async (request): Promise<TestModelResponse> => {
    // ── 1. Auth gate — 'super' only (key material is involved) ───────────────
    const { uid: adminUid } = await requireRole(request, "super");

    // ── 2. Warm platform config caches (needed for builtin key getters) ───────
    await ensurePlatformCaches();

    const data = (request.data ?? {}) as TestModelRequest;

    const hasId = typeof data.id === "string" && data.id.trim().length > 0;
    const hasConfig = !!data.config && typeof data.config === "object";
    if (hasId === hasConfig) {
      throw new HttpsError(
        "invalid-argument",
        "Provide exactly one of id or config."
      );
    }

    // ── 3. Validate keyIndex / keyHash / rawKey mutual exclusivity ───────────
    const hasKeyIndex =
      data.keyIndex !== undefined && data.keyIndex !== null;
    const hasKeyHash =
      typeof data.keyHash === "string" && data.keyHash.trim().length > 0;
    const hasRawKey =
      typeof data.rawKey === "string" && data.rawKey.trim().length > 0;

    if ([hasKeyIndex, hasKeyHash, hasRawKey].filter(Boolean).length > 1) {
      throw new HttpsError(
        "invalid-argument",
        "Provide at most one of keyIndex, keyHash, or rawKey."
      );
    }

    // ── 4. Resolve the ModelEntry to build a provider from ───────────────────
    let entry: ModelEntry;
    let idOrProvider: string; // for audit log — never the key
    // Collect raw keys for scrubbing; never include them in logs or responses.
    const rawKeysForScrubbing: (string | undefined)[] = [];

    if (typeof data.id === "string" && data.id.trim()) {
      // ── 4a. Registry lookup path ─────────────────────────────────────────
      const id = data.id.trim();
      const registry = getModelRegistry();
      const found = registry.find((m) => m.id === id);
      if (!found) {
        throw new HttpsError("invalid-argument", `Model "${id}" not found in the registry.`);
      }
      if (found.id === "custom") {
        throw new HttpsError(
          "invalid-argument",
          'The "custom" model is a per-user BYOA sentinel and cannot be tested via this endpoint.'
        );
      }

      let rawKeyOverride: string | undefined;

      if (hasRawKey) {
        // Admin supplies a raw key to test (e.g. before adding to pool)
        rawKeyOverride = (data.rawKey as string).trim();
        rawKeysForScrubbing.push(rawKeyOverride);
      } else if (hasKeyHash) {
        // Routing-pool pin test: resolve via the SAME pinnable-key semantics
        // as the runtime router, so a green result here means the pinned key
        // is the one the pool member will really use.
        const wanted = (data.keyHash as string).trim();
        const match = pinnableKeysForModel(found).find((k) => keyHash(k.key) === wanted);
        if (!match) {
          throw new HttpsError(
            "invalid-argument",
            `Model "${id}" has no pinnable saved key with that hash — the key was removed ` +
              `or is shadowed by the model's key pool. Re-pick the key in the pool editor.`
          );
        }
        rawKeyOverride = match.key;
        rawKeysForScrubbing.push(rawKeyOverride);
      } else if (hasKeyIndex) {
        // Admin wants to test a specific key from the pool by index
        const pool = resolvePool(found);
        const idx = Number(data.keyIndex);
        if (!Number.isInteger(idx) || idx < 0) {
          throw new HttpsError("invalid-argument", "keyIndex must be a non-negative integer.");
        }
        if (pool.length === 0) {
          throw new HttpsError(
            "invalid-argument",
            `Model "${id}" has no explicit key pool (uses builtin platform key). ` +
              `Use rawKey to test a specific key.`
          );
        }
        if (idx >= pool.length) {
          throw new HttpsError(
            "invalid-argument",
            `keyIndex ${idx} is out of range — model "${id}" has ${pool.length} key(s) (indices 0–${pool.length - 1}).`
          );
        }
        rawKeyOverride = pool[idx];
        rawKeysForScrubbing.push(rawKeyOverride);
      } else {
        // Normal path: use the full pool (rotation handled inside buildProvider)
        rawKeysForScrubbing.push(found.api_key, ...(found.api_keys ?? []));
      }

      entry = found;
      idOrProvider = id;

      // Build the provider, passing the raw key override if present
      // (bypasses pool rotation for the specific-key test case)
      const provider = buildProvider(entry, rawKeyOverride);

      // ── 5. Minimal generation with timeout ─────────────────────────────────
      const probe = await runProbe(provider);
      const { ok, responseText, latencyMs } = probe;
      const errorMessage = scrubKey(probe.errorMessage, ...rawKeysForScrubbing);

      // ── 6. Audit log ────────────────────────────────────────────────────────
      await logAdminAction({
        admin_uid: adminUid,
        action: "test_model",
        details: {
          id_or_provider: idOrProvider,
          ok,
          latencyMs,
          key_mode: hasRawKey ? "rawKey" : hasKeyHash ? "keyHash" : hasKeyIndex ? `keyIndex:${data.keyIndex}` : "pool",
          ...(ok ? {} : { error_present: true }),
        },
      });

      if (ok) return { ok: true, text: responseText, latencyMs };
      return { ok: false, error: errorMessage };

    } else if (data.config && typeof data.config === "object") {
      // ── 4b. Ad-hoc config path ─────────────────────────────────────────────
      if (hasKeyIndex || hasKeyHash || hasRawKey) {
        throw new HttpsError(
          "invalid-argument",
          "keyIndex, keyHash and rawKey are only valid when using the `id` path, not `config`."
        );
      }

      const cfg = data.config;

      if (!VALID_PROVIDERS.has(cfg.provider)) {
        throw new HttpsError(
          "invalid-argument",
          `config.provider must be "gemini" or "openai-compatible".`
        );
      }

      if (cfg.provider === "openai-compatible") {
        const hasBuiltin = cfg.builtin && VALID_BUILTINS.has(cfg.builtin);
        if (!hasBuiltin) {
          if (!cfg.base_url || !cfg.base_url.startsWith("https://")) {
            throw new HttpsError(
              "invalid-argument",
              "config.base_url (starting with https://) is required for openai-compatible without a builtin."
            );
          }
          if (!cfg.api_key) {
            throw new HttpsError(
              "invalid-argument",
              "config.api_key is required for openai-compatible without a builtin."
            );
          }
        }
      }

      // Coerce into a ModelEntry-shaped object so buildProvider() can consume it.
      entry = {
        id: "test",
        label: "test",
        provider: cfg.provider,
        providerModel: cfg.providerModel ?? "",
        minTier: "free",
        enabled: true,
        ...(cfg.builtin ? { builtin: cfg.builtin as ModelEntry["builtin"] } : {}),
        ...(cfg.base_url ? { base_url: cfg.base_url } : {}),
        ...(cfg.api_key ? { api_key: cfg.api_key } : {}),
      };
      idOrProvider = cfg.provider + (cfg.builtin ? `/${cfg.builtin}` : "");
      rawKeysForScrubbing.push(cfg.api_key);

      const provider = buildProvider(entry);

      // ── 5b. Minimal generation with timeout ────────────────────────────────
      const probe = await runProbe(provider);
      const { ok, responseText, latencyMs } = probe;
      const errorMessage = scrubKey(probe.errorMessage, ...rawKeysForScrubbing);

      // ── 6b. Audit log ───────────────────────────────────────────────────────
      await logAdminAction({
        admin_uid: adminUid,
        action: "test_model",
        details: {
          id_or_provider: idOrProvider,
          ok,
          latencyMs,
          key_mode: "adhoc",
          ...(ok ? {} : { error_present: true }),
        },
      });

      if (ok) return { ok: true, text: responseText, latencyMs };
      return { ok: false, error: errorMessage };

    } else {
      throw new HttpsError(
        "invalid-argument",
        'Provide either { id: string } to test a registry model or { config: {...} } for an ad-hoc test.'
      );
    }
  }
);
