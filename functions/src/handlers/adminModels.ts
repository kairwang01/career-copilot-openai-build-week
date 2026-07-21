/**
 * Admin callables for managing the dynamic model registry.
 *
 * These callables let an admin add, edit, disable, or delete model entries in
 * Firestore (platform_config/models).  The change propagates to every user's
 * model picker within one TTL cycle (≤60 s) without any redeploy.
 *
 * Security invariants:
 *   - adminListModels requires 'reviewer' role — returns masked keys only.
 *   - adminUpsertModel / adminDeleteModel require 'super' role — they can
 *     create/overwrite api_key / api_keys material.
 *   - api_key and api_keys are NEVER returned raw — masked via maskSecret.
 *   - Raw keys are never written to the audit log — only an api_keys_changed flag.
 *   - Omitted optional fields on update are preserved; clearFields removes them.
 *   - api_keys supplied on update are appended and de-duplicated, never replaced.
 *   - The "gemini" default model and the "custom" BYOA sentinel cannot be deleted.
 *
 * New fields (multi-key pooling + tier chains):
 *   api_keys   — pool of API keys (≤10, each ≤200 chars). Preferred over api_key.
 *   priority   — integer sort priority (lower = earlier for implicit fallback).
 *   fallbackChain — ordered model ids to try on availability failure (≤5 entries).
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireRole } from "../admin/roles";
import {
  PLATFORM_CONFIG_COLLECTION,
  PLATFORM_DOCS,
  ADMIN_AUDIT_LOG_COLLECTION,
  ModelEntry,
  ModelsDoc,
  ModuleRoutes,
  RoutingPool,
  RoutingPoolMember,
} from "../admin/schema";
import {
  ensurePlatformCaches,
  getDefaultModelId,
  getModelRegistry,
  getModuleRoutes,
  getRoutingPools,
  maskSecret,
  refreshPlatformCaches,
} from "../admin/platformConfig";
import { DEFAULT_MODEL_ID, DEFAULT_MODELS } from "../llm/models";
import { keyHash } from "../llm/keyHash";
import { implicitFallbackCandidates, pinnableKeysForModel } from "../llm/routingPools";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/** IDs that are structurally required and must never be deleted via the API. */
const PROTECTED_IDS = new Set([DEFAULT_MODEL_ID, "custom"]);

const VALID_PROVIDERS = new Set<ModelEntry["provider"]>(["gemini", "openai-compatible"]);
const VALID_TIERS = new Set<ModelEntry["minTier"]>(["free", "paid", "business"]);
const VALID_BUILTINS = new Set(["kairllm", "deepseek", undefined]);

const MAX_API_KEYS = 10;
const MAX_API_KEY_LEN = 200;
const MAX_FALLBACK_CHAIN = 5;
const MAX_ROUTING_POOLS = 12;
const MAX_POOL_MEMBERS = 60;
const MAX_MODULE_ROUTES = 80;
const SLUG_RE = /^[a-zA-Z0-9_-]{1,48}$/;
const KEY_HEALTH_COLLECTION = "key_health";

function writeMutationAudit(
  tx: admin.firestore.Transaction,
  ref: admin.firestore.DocumentReference,
  adminUid: string,
  action: string,
  details: Record<string, unknown>,
): void {
  tx.create(ref, {
    admin_uid: adminUid,
    action,
    target_uid: null,
    details,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
  });
}

const CLEARABLE_MODEL_FIELDS = [
  "builtin",
  "base_url",
  "api_key",
  "api_keys",
  "fallbackChain",
  "priority",
  "supportsImageInput",
] as const;
type ClearableModelField = typeof CLEARABLE_MODEL_FIELDS[number];
const CLEARABLE_MODEL_FIELD_SET = new Set<string>(CLEARABLE_MODEL_FIELDS);

type ModelKeyHealth = {
  failureCount: number;
  cooldownUntil: string | null;
  lastErrorCode: string | null;
  lastFailureAt: string | null;
  anyCooled: boolean;
};

const FALLBACK_PREVIEW_TIERS = ["free", "paid", "business"] as const;
type FallbackPreviewTier = typeof FALLBACK_PREVIEW_TIERS[number];

function allowedForFallbackPreview(registry: ModelEntry[], tier: FallbackPreviewTier): ModelEntry[] {
  return registry.filter((m) => {
    if (!m.enabled) return false;
    if (m.id === "custom") return false;
    if (m.id === "auto") return tier === "paid";
    if (m.minTier === "business") return tier === "business";
    if (tier === "paid") return m.minTier === "free" || m.minTier === "paid";
    return m.minTier === "free";
  });
}

function implicitFallbackPreviewByTier(
  registry: ModelEntry[],
  chosen: ModelEntry
): Record<FallbackPreviewTier, string[]> | undefined {
  if (chosen.fallbackChain?.length) return undefined;
  return Object.fromEntries(
    FALLBACK_PREVIEW_TIERS.map((tier) => [
      tier,
      implicitFallbackCandidates(allowedForFallbackPreview(registry, tier), chosen.id).map((m) => m.id),
    ])
  ) as Record<FallbackPreviewTier, string[]>;
}

function timestampMs(value: unknown): number | null {
  if (value && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function timestampIso(value: unknown): string | null {
  const ms = timestampMs(value);
  return ms === null ? null : new Date(ms).toISOString();
}

function aggregateKeyHealth(
  docs: Array<Record<string, unknown>>,
  nowMs = Date.now()
): Record<string, ModelKeyHealth> {
  const byModel: Record<string, ModelKeyHealth> = {};
  const latestFailureMs: Record<string, number> = {};
  const latestCooldownMs: Record<string, number> = {};

  for (const doc of docs) {
    const modelId = typeof doc.modelId === "string" ? doc.modelId.trim() : "";
    if (!modelId) continue;

    const current = byModel[modelId] ?? {
      failureCount: 0,
      cooldownUntil: null,
      lastErrorCode: null,
      lastFailureAt: null,
      anyCooled: false,
    };

    if (typeof doc.failureCount === "number" && Number.isFinite(doc.failureCount)) {
      current.failureCount += doc.failureCount;
    }

    const cooldownMs = timestampMs(doc.cooldownUntil);
    if (cooldownMs !== null && cooldownMs > nowMs) {
      current.anyCooled = true;
      if (cooldownMs > (latestCooldownMs[modelId] ?? 0)) {
        latestCooldownMs[modelId] = cooldownMs;
        current.cooldownUntil = new Date(cooldownMs).toISOString();
      }
    }

    const failureMs = timestampMs(doc.lastFailureAt);
    if (failureMs !== null && failureMs > (latestFailureMs[modelId] ?? 0)) {
      latestFailureMs[modelId] = failureMs;
      current.lastFailureAt = new Date(failureMs).toISOString();
      current.lastErrorCode = typeof doc.lastErrorCode === "string" ? doc.lastErrorCode : null;
    } else if (!current.lastFailureAt) {
      current.lastFailureAt = timestampIso(doc.lastFailureAt);
      current.lastErrorCode = typeof doc.lastErrorCode === "string" ? doc.lastErrorCode : null;
    }

    byModel[modelId] = current;
  }

  return byModel;
}

/**
 * Hashes a pool member may pin. Built from pinnableKeysForModel — the runtime
 * pool's view — NOT the raw stored fields, so validation never accepts a pin
 * the router would silently skip (gemini keys, or a legacy api_key shadowed
 * by a non-empty api_keys pool).
 */
function keyHashesForModel(entry: ModelEntry): Set<string> {
  return new Set(pinnableKeysForModel(entry).map((k) => keyHash(k.key)));
}

function withAdminKeyPreviews(masked: ModelEntry, raw: ModelEntry): ModelEntry {
  // key_previews feeds the admin key picker for pool pinning — offer only keys
  // the runtime would actually use (same source as pool validation).
  const previews = pinnableKeysForModel(raw).map(({ key, source, index }) => ({
    hash: keyHash(key),
    masked: maskSecret(key),
    index,
    source,
  }));
  return {
    ...masked,
    ...(raw.api_key ? { api_key_hash: keyHash(raw.api_key) } : {}),
    ...(raw.api_keys?.length ? { api_key_hashes: raw.api_keys.map(keyHash) } : {}),
    ...(previews.length > 0 ? { key_previews: previews } : {}),
  };
}

function withoutCustomFallback(entry: ModelEntry): ModelEntry {
  const fallbackChain = entry.fallbackChain?.filter((id) => id !== "custom");
  return {
    ...entry,
    ...(fallbackChain?.length ? { fallbackChain } : { fallbackChain: undefined }),
  };
}

function modelsForAdminResponse(): ModelEntry[] {
  const rawModels = getModelRegistry();
  const displayModels = rawModels.map(withoutCustomFallback);
  return rawModels.map((raw, index) => {
    const displayModel = displayModels[index];
    const preview = implicitFallbackPreviewByTier(displayModels, displayModel);
    return withAdminKeyPreviews({
      ...displayModel,
      ...(preview ? { implicitFallbackPreviewByTier: preview } : {}),
      api_key: raw.api_key ? maskSecret(raw.api_key) : undefined,
      api_keys: raw.api_keys?.length ? raw.api_keys.map(maskSecret) : undefined,
    }, raw);
  });
}

/** Validates and normalises an incoming ModelEntry, throwing HttpsError on bad input. */
function validateEntry(raw: unknown, isCreate: boolean): ModelEntry {
  if (!raw || typeof raw !== "object") {
    throw new HttpsError("invalid-argument", "model must be an object.");
  }
  const m = raw as Record<string, unknown>;

  const id = (typeof m.id === "string" ? m.id.trim() : "") as string;
  if (!id) throw new HttpsError("invalid-argument", "model.id is required.");

  const label = (typeof m.label === "string" ? m.label.trim() : "") as string;
  if (!label) throw new HttpsError("invalid-argument", "model.label is required.");

  const provider = m.provider as ModelEntry["provider"];
  if (!VALID_PROVIDERS.has(provider)) {
    throw new HttpsError("invalid-argument", `model.provider must be "gemini" or "openai-compatible".`);
  }

  const minTier = m.minTier as ModelEntry["minTier"];
  if (!VALID_TIERS.has(minTier)) {
    throw new HttpsError("invalid-argument", `model.minTier must be "free", "paid", or "business".`);
  }

  const builtin = m.builtin as ModelEntry["builtin"] | undefined;
  if (!VALID_BUILTINS.has(builtin)) {
    throw new HttpsError("invalid-argument", `model.builtin must be "kairllm", "deepseek", or omitted.`);
  }

  const base_url = typeof m.base_url === "string" ? m.base_url.trim() : undefined;
  const api_key = typeof m.api_key === "string" ? m.api_key.trim() : undefined;
  const providerModel = typeof m.providerModel === "string" ? m.providerModel : "";
  const enabled = m.enabled !== false; // default true
  // Multimodal capability: only an explicit boolean true marks a gateway model
  // as image-capable (gemini models are implicitly capable at runtime).
  const supportsImageInput =
    typeof m.supportsImageInput === "boolean" ? m.supportsImageInput : undefined;

  // --- api_keys pool validation ---
  let api_keys: string[] | undefined;
  if (Array.isArray(m.api_keys)) {
    const pool = m.api_keys as unknown[];
    if (pool.length > MAX_API_KEYS) {
      throw new HttpsError(
        "invalid-argument",
        `model.api_keys must contain at most ${MAX_API_KEYS} keys.`
      );
    }
    const cleaned: string[] = [];
    for (let i = 0; i < pool.length; i++) {
      if (typeof pool[i] !== "string") {
        throw new HttpsError("invalid-argument", `model.api_keys[${i}] must be a string.`);
      }
      const trimmed = (pool[i] as string).trim();
      if (!trimmed) {
        throw new HttpsError("invalid-argument", `model.api_keys[${i}] must not be empty.`);
      }
      if (trimmed.length > MAX_API_KEY_LEN) {
        throw new HttpsError(
          "invalid-argument",
          `model.api_keys[${i}] exceeds max length of ${MAX_API_KEY_LEN} chars.`
        );
      }
      cleaned.push(trimmed);
    }
    if (cleaned.length > 0) api_keys = cleaned;
  }

  // --- priority validation ---
  let priority: number | undefined;
  if (m.priority !== undefined && m.priority !== null) {
    const p = Number(m.priority);
    if (!Number.isInteger(p)) {
      throw new HttpsError("invalid-argument", "model.priority must be an integer.");
    }
    priority = p;
  }

  // --- fallbackChain validation ---
  let fallbackChain: string[] | undefined;
  if (Array.isArray(m.fallbackChain)) {
    const chain = m.fallbackChain as unknown[];
    if (chain.length > MAX_FALLBACK_CHAIN) {
      throw new HttpsError(
        "invalid-argument",
        `model.fallbackChain must contain at most ${MAX_FALLBACK_CHAIN} entries.`
      );
    }
    const cleanedChain: string[] = [];
    for (let i = 0; i < chain.length; i++) {
      if (typeof chain[i] !== "string" || !(chain[i] as string).trim()) {
        throw new HttpsError("invalid-argument", `model.fallbackChain[${i}] must be a non-empty string.`);
      }
      const chainId = (chain[i] as string).trim();
      if (chainId === "custom") {
        throw new HttpsError("invalid-argument", `model.fallbackChain[${i}] cannot reference custom BYOA.`);
      }
      cleanedChain.push(chainId);
    }
    if (cleanedChain.length > 0) fallbackChain = cleanedChain;
  }

  const hasDirectConnectionFields = !!(base_url || api_key || (api_keys && api_keys.length > 0));
  if (provider === "gemini" && (builtin || hasDirectConnectionFields)) {
    throw new HttpsError(
      "invalid-argument",
      "Gemini models cannot include builtin, base_url, api_key, or api_keys fields."
    );
  }
  if (provider === "openai-compatible" && builtin && hasDirectConnectionFields) {
    throw new HttpsError(
      "invalid-argument",
      "Builtin models inherit their connection and cannot include base_url, api_key, or api_keys fields."
    );
  }

  // Existing connection fields may be omitted on update and are validated after
  // merging. Creates must be complete unless this is the custom BYOA sentinel.
  if (provider === "openai-compatible" && !builtin && id !== "custom") {
    if (base_url && !base_url.startsWith("https://")) {
      throw new HttpsError("invalid-argument", "model.base_url must start with https://");
    }
    if (isCreate && !base_url) {
      throw new HttpsError(
        "invalid-argument",
        "model.base_url (https URL) is required for openai-compatible models without a builtin."
      );
    }
    if (isCreate && !api_key && (!api_keys || api_keys.length === 0)) {
      throw new HttpsError(
        "invalid-argument",
        "model.api_key or model.api_keys is required when creating an openai-compatible model without a builtin."
      );
    }
  }

  const entry: ModelEntry = {
    id,
    label,
    provider,
    providerModel,
    minTier,
    enabled,
  };
  if (builtin) entry.builtin = builtin;
  if (base_url) entry.base_url = base_url;
  // api_key: include only if non-empty (empty on update = keep existing).
  if (api_key) entry.api_key = api_key;
  // api_keys pool: include only if non-empty
  if (api_keys && api_keys.length > 0) entry.api_keys = api_keys;
  // priority / fallbackChain
  if (priority !== undefined) entry.priority = priority;
  if (fallbackChain && fallbackChain.length > 0) entry.fallbackChain = fallbackChain;
  if (supportsImageInput !== undefined) entry.supportsImageInput = supportsImageInput;

  return entry;
}

function validateClearFields(
  raw: unknown,
  isCreate: boolean,
  rawModel: unknown
): ClearableModelField[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new HttpsError("invalid-argument", "clearFields must be an array.");
  }
  if (isCreate && raw.length > 0) {
    throw new HttpsError("invalid-argument", "clearFields is only valid when updating a model.");
  }

  const model = rawModel && typeof rawModel === "object"
    ? rawModel as Record<string, unknown>
    : {};
  const fields: ClearableModelField[] = [];
  for (const candidate of raw) {
    if (typeof candidate !== "string" || !CLEARABLE_MODEL_FIELD_SET.has(candidate)) {
      throw new HttpsError(
        "invalid-argument",
        `clearFields contains unsupported field "${String(candidate)}".`
      );
    }
    const field = candidate as ClearableModelField;
    if (Object.prototype.hasOwnProperty.call(model, field)) {
      throw new HttpsError(
        "invalid-argument",
        `model.${field} cannot be supplied and cleared in the same request.`
      );
    }
    if (!fields.includes(field)) fields.push(field);
  }
  return fields;
}

function canonicalizeConnectionFields(entry: ModelEntry): ModelEntry {
  const canonical = { ...entry };
  if (canonical.provider === "gemini" || canonical.id === "custom") {
    delete canonical.builtin;
    delete canonical.base_url;
    delete canonical.api_key;
    delete canonical.api_keys;
    return canonical;
  }
  if (canonical.builtin) {
    delete canonical.base_url;
    delete canonical.api_key;
    delete canonical.api_keys;
  }
  return canonical;
}

function validateEffectiveConnection(entry: ModelEntry): void {
  if (entry.id === "custom" || entry.provider === "gemini" || entry.builtin) return;
  if (!entry.base_url || !entry.base_url.startsWith("https://")) {
    throw new HttpsError(
      "invalid-argument",
      "model.base_url (https URL) is required for openai-compatible models without a builtin."
    );
  }
  if (!entry.api_key && (!entry.api_keys || entry.api_keys.length === 0)) {
    throw new HttpsError(
      "invalid-argument",
      "An openai-compatible model without a builtin must retain at least one API key."
    );
  }
}

function mergeModelEntry(
  existing: ModelEntry,
  validated: ModelEntry,
  clearFields: ClearableModelField[]
): ModelEntry {
  const merged: ModelEntry = { ...existing, ...validated };

  // api_keys on an update are additions. The admin never receives raw saved
  // keys, so treating this field as replacement would irreversibly drop them.
  if (validated.api_keys?.length) {
    merged.api_keys = [...new Set([...(existing.api_keys ?? []), ...validated.api_keys])];
    if (merged.api_keys.length > MAX_API_KEYS) {
      throw new HttpsError(
        "invalid-argument",
        `model.api_keys would contain ${merged.api_keys.length} keys; the maximum is ${MAX_API_KEYS}.`
      );
    }
  }

  for (const field of clearFields) {
    delete merged[field];
  }

  const canonical = canonicalizeConnectionFields(merged);
  validateEffectiveConnection(canonical);
  return canonical;
}

// ---------------------------------------------------------------------------
// Validate fallbackChain references exist in the registry (called after write)
// ---------------------------------------------------------------------------

/**
 * Validates that all fallbackChain model IDs in the registry refer to existing
 * IDs.  Throws HttpsError if any reference is broken.
 * Called before writing so we never persist a broken chain.
 */
function validateChainReferences(
  entry: ModelEntry,
  registry: ModelEntry[]
): void {
  if (!entry.fallbackChain || entry.fallbackChain.length === 0) return;
  const ids = new Set(registry.map((m) => m.id));
  // Include the entry itself (self-reference not useful but shouldn't error here —
  // would just be a no-op cycle).  Validate against existing ids + the entry being saved.
  ids.add(entry.id);
  for (const chainId of entry.fallbackChain) {
    if (chainId === "custom") {
      throw new HttpsError("invalid-argument", "model.fallbackChain cannot reference custom BYOA.");
    }
    if (!ids.has(chainId)) {
      throw new HttpsError(
        "invalid-argument",
        `model.fallbackChain references unknown model id "${chainId}". ` +
          `Add that model to the registry first.`
      );
    }
  }
}

function validateRoutingPools(rawPools: unknown, registry: ModelEntry[]): RoutingPool[] {
  if (!Array.isArray(rawPools)) {
    throw new HttpsError("invalid-argument", "routing_pools must be an array.");
  }
  if (rawPools.length > MAX_ROUTING_POOLS) {
    throw new HttpsError("invalid-argument", `routing_pools must contain at most ${MAX_ROUTING_POOLS} pools.`);
  }

  const modelIds = new Set(registry.map((m) => m.id));
  const keyHashesByModel = new Map(registry.map((m) => [m.id, keyHashesForModel(m)]));
  const seenIds = new Set<string>();

  return rawPools.map((raw, poolIndex) => {
    if (!raw || typeof raw !== "object") {
      throw new HttpsError("invalid-argument", `routing_pools[${poolIndex}] must be an object.`);
    }
    const p = raw as Record<string, unknown>;
    const id = typeof p.id === "string" ? p.id.trim() : "";
    if (!SLUG_RE.test(id)) {
      throw new HttpsError("invalid-argument", `routing_pools[${poolIndex}].id must be a slug up to 48 chars.`);
    }
    if (seenIds.has(id)) {
      throw new HttpsError("invalid-argument", `routing pool "${id}" is duplicated.`);
    }
    seenIds.add(id);

    const label = typeof p.label === "string" && p.label.trim() ? p.label.trim().slice(0, 80) : id;
    const membersRaw = Array.isArray(p.members) ? p.members : [];
    if (membersRaw.length > MAX_POOL_MEMBERS) {
      throw new HttpsError("invalid-argument", `routing pool "${id}" has too many members.`);
    }

    const members: RoutingPoolMember[] = membersRaw.map((rawMember, memberIndex) => {
      if (!rawMember || typeof rawMember !== "object") {
        throw new HttpsError("invalid-argument", `routing pool "${id}" member ${memberIndex} must be an object.`);
      }
      const m = rawMember as Record<string, unknown>;
      const modelId = typeof m.modelId === "string" ? m.modelId.trim() : "";
      if (!modelIds.has(modelId)) {
        throw new HttpsError("invalid-argument", `routing pool "${id}" references unknown model "${modelId}".`);
      }
      // The "custom" BYOA sentinel has no platform key/URL of its own. Its real
      // config lives in the server-only custom-provider store and is resolved on
      // the dedicated BYOA path. Inside a pool it would build an empty provider.
      if (modelId === "custom") {
        throw new HttpsError("invalid-argument", `routing pool "${id}" cannot include the per-user "custom" BYOA model.`);
      }
      const tier = Number(m.tier);
      const weight = Number(m.weight);
      if (!Number.isInteger(tier) || tier <= 0) {
        throw new HttpsError("invalid-argument", `routing pool "${id}" member tier must be a positive integer.`);
      }
      if (!Number.isInteger(weight) || weight <= 0) {
        throw new HttpsError("invalid-argument", `routing pool "${id}" member weight must be a positive integer.`);
      }
      const keyHashValue = typeof m.keyHash === "string" ? m.keyHash.trim() : "";
      if (keyHashValue && !keyHashesByModel.get(modelId)?.has(keyHashValue)) {
        throw new HttpsError(
          "invalid-argument",
          `routing pool "${id}" pins a key the router would never use for model "${modelId}" ` +
            `(not a saved key, or shadowed by the model's key pool). Re-pick the key or use "Any configured key".`
        );
      }
      return {
        modelId,
        ...(keyHashValue ? { keyHash: keyHashValue } : {}),
        tier,
        weight,
        enabled: m.enabled !== false,
      };
    });

    return { id, label, enabled: p.enabled !== false, members };
  });
}

function validateModuleRoutes(rawRoutes: unknown, pools: RoutingPool[]): ModuleRoutes {
  if (!rawRoutes || typeof rawRoutes !== "object" || Array.isArray(rawRoutes)) {
    throw new HttpsError("invalid-argument", "module_routes must be an object.");
  }
  const poolIds = new Set(pools.map((p) => p.id));
  const entries = Object.entries(rawRoutes as Record<string, unknown>);
  if (entries.length > MAX_MODULE_ROUTES) {
    throw new HttpsError("invalid-argument", `module_routes must contain at most ${MAX_MODULE_ROUTES} entries.`);
  }
  const routes: ModuleRoutes = {};
  for (const [rawKey, rawPoolId] of entries) {
    const key = rawKey.trim();
    const poolId = typeof rawPoolId === "string" ? rawPoolId.trim() : "";
    if (!SLUG_RE.test(key)) {
      throw new HttpsError("invalid-argument", `module route "${rawKey}" must be a slug up to 48 chars.`);
    }
    if (!poolIds.has(poolId)) {
      throw new HttpsError("invalid-argument", `module route "${key}" references unknown pool "${poolId}".`);
    }
    routes[key] = poolId;
  }
  return routes;
}

function registryFromDocument(doc: ModelsDoc): ModelEntry[] {
  return doc.models && doc.models.length > 0 ? doc.models : [...DEFAULT_MODELS];
}

function buildUpsertModelMutation(
  rawModel: unknown,
  rawClearFields: unknown,
  doc: ModelsDoc,
  fallbackRoutingPools: RoutingPool[],
): {
  models: ModelEntry[];
  savedEntry: ModelEntry;
  validated: ModelEntry;
  clearFields: ClearableModelField[];
  isCreate: boolean;
} {
  const current = registryFromDocument(doc);
  const incoming = rawModel as Record<string, unknown> | undefined;
  const incomingId = incoming && typeof incoming.id === "string" ? incoming.id.trim() : "";
  const existingIndex = current.findIndex((model) => model.id === incomingId);
  const isCreate = existingIndex === -1;
  const validated = validateEntry(rawModel, isCreate);
  const clearFields = validateClearFields(rawClearFields, isCreate, rawModel);

  let savedEntry: ModelEntry;
  let models: ModelEntry[];
  if (isCreate) {
    savedEntry = canonicalizeConnectionFields(validated);
    validateEffectiveConnection(savedEntry);
    models = [...current, savedEntry];
  } else {
    savedEntry = mergeModelEntry(current[existingIndex], validated, clearFields);
    models = [
      ...current.slice(0, existingIndex),
      savedEntry,
      ...current.slice(existingIndex + 1),
    ];
  }

  for (const entry of models) validateChainReferences(entry, models);
  validateRoutingPools(doc.routing_pools ?? fallbackRoutingPools, models);
  return { models, savedEntry, validated, clearFields, isCreate };
}

function withoutFallbackReference(entry: ModelEntry, deletedId: string): ModelEntry {
  if (!entry.fallbackChain?.includes(deletedId)) return entry;
  const fallbackChain = entry.fallbackChain.filter((id) => id !== deletedId);
  const { fallbackChain: _removed, ...rest } = entry;
  return fallbackChain.length > 0 ? { ...rest, fallbackChain } : rest;
}

function buildDeleteModelMutation(
  id: string,
  doc: ModelsDoc,
  fallbackRoutingPools: RoutingPool[],
  fallbackModuleRoutes: ModuleRoutes,
): { models: ModelEntry[]; routingPools: RoutingPool[]; moduleRoutes: ModuleRoutes } {
  const current = registryFromDocument(doc);
  if (!current.some((model) => model.id === id)) {
    throw new HttpsError("not-found", `Model "${id}" not found in the registry.`);
  }
  const configuredDefault = doc.default_model_id ?? DEFAULT_MODEL_ID;
  if (configuredDefault === id) {
    throw new HttpsError(
      "failed-precondition",
      `Model "${id}" is the default. Set another default before deleting it.`,
    );
  }

  const models = current
    .filter((model) => model.id !== id)
    .map((model) => withoutFallbackReference(model, id));
  for (const entry of models) validateChainReferences(entry, models);

  const routingPools = validateRoutingPools(
    (doc.routing_pools ?? fallbackRoutingPools).map((pool) => ({
      ...pool,
      members: pool.members.filter((member) => member.modelId !== id),
    })),
    models,
  );
  const moduleRoutes = validateModuleRoutes(doc.module_routes ?? fallbackModuleRoutes, routingPools);
  return { models, routingPools, moduleRoutes };
}

// ---------------------------------------------------------------------------
// adminListModels  (requires 'reviewer')
// ---------------------------------------------------------------------------

/**
 * Returns the effective model registry with api_key and api_keys masked.
 * Includes lightweight key health info (failureCount, cooldownUntil, lastErrorCode)
 * sourced from key_health/{keyHash} docs (best-effort; missing docs are skipped).
 * If Firestore has no models doc (or empty array), returns DEFAULT_MODELS.
 * Seeds nothing — read-only.
 *
 * Role requirement: 'reviewer' (reading masked keys is safe for read-only admins).
 */
export const adminListModelsFunction = onCall({ invoker: "public" }, async (request) => {
  await requireRole(request, "reviewer");
  await refreshPlatformCaches();

  // Read only health docs for keys that the current registry can actually use.
  // Scanning the full collection made this admin read grow forever after key
  // rotation and also attributed shared keys to whichever model wrote last.
  let healthByModelId: Record<string, ModelKeyHealth> = {};
  try {
    const registry = getModelRegistry();
    const hashesByModel = new Map(
      registry.map((model) => [
        model.id,
        [...new Set(pinnableKeysForModel(model).map(({ key }) => keyHash(key)))],
      ]),
    );
    const uniqueHashes = [...new Set([...hashesByModel.values()].flat())];
    const snapshots = uniqueHashes.length
      ? await db.getAll(...uniqueHashes.map((hash) => db.collection(KEY_HEALTH_COLLECTION).doc(hash)))
      : [];
    const healthByHash = new Map(
      snapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, snapshot.data()!]),
    );
    const currentHealthDocs: Array<Record<string, unknown>> = [];
    for (const [modelId, hashes] of hashesByModel) {
      for (const hash of hashes) {
        const health = healthByHash.get(hash);
        if (health) currentHealthDocs.push({ ...health, modelId });
      }
    }
    healthByModelId = aggregateKeyHealth(currentHealthDocs);
  } catch {
    // Health fetch is strictly best-effort; never block the response.
  }

  const maskedModels = modelsForAdminResponse().map((m) => {
    const h = healthByModelId[m.id];
    if (!h) return m;
    return { ...m, keyHealth: h };
  });

  return {
    models: maskedModels,
    // Include the admin-configured default so the UI can render the badge.
    defaultModelId: getDefaultModelId() ?? DEFAULT_MODEL_ID,
    routingPools: getRoutingPools(),
    moduleRoutes: getModuleRoutes(),
  };
});

// ---------------------------------------------------------------------------
// adminUpsertModel  (requires 'super' — touches key material)
// ---------------------------------------------------------------------------

/**
 * Creates or updates a model entry by id.
 *
 * - On update: omitted optional fields are preserved; clearFields removes them.
 * - api_keys supplied on update are appended and de-duplicated.
 * - Always refreshes the in-memory cache after writing.
 * - Never logs raw api_key / api_keys — only api_keys_changed boolean.
 *
 * Role requirement: 'super' (writes can include raw API key material).
 */
export const adminUpsertModelFunction = onCall({ invoker: "public" }, async (request) => {
  const { uid: adminUid } = await requireRole(request, "super");
  const data = (request.data ?? {}) as { model?: unknown; clearFields?: unknown };

  await ensurePlatformCaches();
  const ref = db.collection(PLATFORM_CONFIG_COLLECTION).doc(PLATFORM_DOCS.models);
  const auditRef = db.collection(ADMIN_AUDIT_LOG_COLLECTION).doc();
  const fallbackRoutingPools = getRoutingPools();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const mutation = buildUpsertModelMutation(
      data.model,
      data.clearFields,
      snap.exists ? snap.data() as ModelsDoc : {},
      fallbackRoutingPools,
    );
    tx.set(ref, { models: mutation.models } satisfies Partial<ModelsDoc>, { merge: true });
    writeMutationAudit(
      tx,
      auditRef,
      adminUid,
      mutation.isCreate ? "create_model" : "update_model",
      {
        id: mutation.validated.id,
        label: mutation.validated.label,
        provider: mutation.validated.provider,
        minTier: mutation.validated.minTier,
        enabled: mutation.validated.enabled,
        builtin: mutation.savedEntry.builtin ?? null,
        base_url: mutation.savedEntry.base_url ?? null,
        priority: mutation.savedEntry.priority ?? null,
        fallbackChain: mutation.savedEntry.fallbackChain ?? null,
        cleared_fields: mutation.clearFields,
        api_keys_changed: !!(
          mutation.validated.api_key ||
          mutation.validated.api_keys?.length ||
          mutation.clearFields.includes("api_key") ||
          mutation.clearFields.includes("api_keys")
        ),
      },
    );
  });
  await refreshPlatformCaches();

  return { models: modelsForAdminResponse() };
});

// ---------------------------------------------------------------------------
// adminDeleteModel  (requires 'super' — removes key material from registry)
// ---------------------------------------------------------------------------

/**
 * Removes a model entry by id.
 *
 * Protected ids ("gemini", "custom") cannot be deleted — they are structurally
 * required by the tier-gating logic and BYOA path respectively.
 *
 * Role requirement: 'super' (deleting an entry also removes its stored keys).
 */
export const adminDeleteModelFunction = onCall({ invoker: "public" }, async (request) => {
  const { uid: adminUid } = await requireRole(request, "super");
  const data = (request.data ?? {}) as { id?: unknown };

  const id = typeof data.id === "string" ? data.id.trim() : "";
  if (!id) throw new HttpsError("invalid-argument", "id is required.");

  if (PROTECTED_IDS.has(id)) {
    throw new HttpsError(
      "failed-precondition",
      `Model "${id}" is protected and cannot be deleted.`
    );
  }

  await ensurePlatformCaches();
  const ref = db.collection(PLATFORM_CONFIG_COLLECTION).doc(PLATFORM_DOCS.models);
  const auditRef = db.collection(ADMIN_AUDIT_LOG_COLLECTION).doc();
  const fallbackRoutingPools = getRoutingPools();
  const fallbackModuleRoutes = getModuleRoutes();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const mutation = buildDeleteModelMutation(
      id,
      snap.exists ? snap.data() as ModelsDoc : {},
      fallbackRoutingPools,
      fallbackModuleRoutes,
    );
    tx.set(ref, {
      models: mutation.models,
      routing_pools: mutation.routingPools,
      module_routes: mutation.moduleRoutes,
    } satisfies Partial<ModelsDoc>, { merge: true });
    writeMutationAudit(tx, auditRef, adminUid, "delete_model", { id });
  });
  await refreshPlatformCaches();

  return { models: modelsForAdminResponse() };
});

export const adminUpdateModelRoutingFunction = onCall({ invoker: "public" }, async (request) => {
  const { uid: adminUid } = await requireRole(request, "super");
  const data = (request.data ?? {}) as { routingPools?: unknown; moduleRoutes?: unknown };

  await ensurePlatformCaches();
  const ref = db.collection(PLATFORM_CONFIG_COLLECTION).doc(PLATFORM_DOCS.models);
  const auditRef = db.collection(ADMIN_AUDIT_LOG_COLLECTION).doc();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const registry = registryFromDocument(snap.exists ? snap.data() as ModelsDoc : {});
    const routingPools = validateRoutingPools(data.routingPools, registry);
    const moduleRoutes = validateModuleRoutes(data.moduleRoutes, routingPools);
    tx.set(
      ref,
      { routing_pools: routingPools, module_routes: moduleRoutes } satisfies Partial<ModelsDoc>,
      { merge: true },
    );
    writeMutationAudit(tx, auditRef, adminUid, "update_model_routing", {
      pool_count: routingPools.length,
      member_count: routingPools.reduce((sum, pool) => sum + pool.members.length, 0),
      module_route_count: Object.keys(moduleRoutes).length,
    });
  });
  await refreshPlatformCaches();

  return { routingPools: getRoutingPools(), moduleRoutes: getModuleRoutes() };
});

export const _testRoutingValidation = {
  aggregateKeyHealth,
  implicitFallbackPreviewByTier,
  mergeModelEntry,
  validateEntry,
  validateClearFields,
  validateEffectiveConnection,
  validateRoutingPools,
  validateModuleRoutes,
  buildUpsertModelMutation,
  buildDeleteModelMutation,
};

// ---------------------------------------------------------------------------
// adminSetDefaultModel  (requires 'super' — changes the global default model)
// ---------------------------------------------------------------------------

/**
 * Sets the admin-configured default model for all users.
 *
 * The supplied id must exist in the current registry and be enabled.
 * Writes default_model_id into platform_config/models (merge), busts the cache,
 * and audit-logs the change.
 *
 * resolveProvider() and listModels both read this via getDefaultModelId() on the
 * next request (within one TTL cycle — ≤60 s).
 *
 * Role requirement: 'super'.
 */
export const adminSetDefaultModelFunction = onCall({ invoker: "public" }, async (request) => {
  const { uid: adminUid } = await requireRole(request, "super");
  const data = (request.data ?? {}) as { id?: unknown };

  const id = typeof data.id === "string" ? data.id.trim() : "";
  if (!id) throw new HttpsError("invalid-argument", "id is required.");

  await ensurePlatformCaches();
  const ref = db.collection(PLATFORM_CONFIG_COLLECTION).doc(PLATFORM_DOCS.models);
  const auditRef = db.collection(ADMIN_AUDIT_LOG_COLLECTION).doc();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const registry = registryFromDocument(snap.exists ? snap.data() as ModelsDoc : {});
    const entry = registry.find((model) => model.id === id);
    if (!entry) {
      throw new HttpsError("not-found", `Model "${id}" not found in the registry.`);
    }
    if (!entry.enabled) {
      throw new HttpsError(
        "failed-precondition",
        `Model "${id}" is disabled and cannot be set as the default.`,
      );
    }
    tx.set(ref, { default_model_id: id } as Partial<ModelsDoc>, { merge: true });
    writeMutationAudit(tx, auditRef, adminUid, "set_default_model", { id });
  });
  await refreshPlatformCaches();

  return { ok: true, defaultModelId: id };
});
