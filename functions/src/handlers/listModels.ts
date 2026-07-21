/**
 * listModels — HTTPS Callable. Returns the AI models the caller is allowed to
 * select (based on their tier and role) plus the default. The frontend uses this
 * to render the model picker; gating is still re-enforced server-side on every
 * AI call.
 *
 *   const { data } = await httpsCallable(getFunctions(), "listModels")();
 *   // → { tier, defaultModelId, models: [{ id, label, minTier }], isBusiness? }
 *
 * Response shape is backward-compatible with services/aiClient.ts:
 *   { tier, defaultModelId, models: ModelOption[] }
 * with the optional isBusiness flag added for client-side UI hints.
 */

import { onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAuth } from "../middleware/auth";
import { USERS_COLLECTION, USER_FIELDS } from "../credits/schema";
import { ensurePlatformCaches, getDefaultModelId } from "../config/env";
import {
  tierFromSubscription,
  isBusinessUser,
  modelsForTier,
  DEFAULT_MODEL_ID,
} from "../llm/models";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

export const listModelsFunction = onCall({ invoker: "public" }, async (request) => {
  const uid = requireAuth(request);
  // Warm the platform cache so getModelRegistry() inside modelsForTier() reads
  // the current Firestore registry (or falls back to DEFAULT_MODELS if empty).
  await ensurePlatformCaches();
  const snap = await db.collection(USERS_COLLECTION).doc(uid).get();

  const subscriptionStatus = snap.get(USER_FIELDS.subscriptionStatus) as string | undefined;
  const role = snap.get(USER_FIELDS.role) as string | undefined;

  const tier = tierFromSubscription(subscriptionStatus);
  const business = isBusinessUser(role, subscriptionStatus);

  // modelsForTier(tier, business) correctly gates:
  //   free        → gemini + kairllm
  //   paid        → gemini + kairllm + deepseek
  //   business    → gemini + kairllm + custom
  //   paid+biz    → gemini + kairllm + deepseek + custom
  //   (auto alias is hidden from all listings)
  const allowedModels = modelsForTier(tier, business);
  const models = allowedModels.map(({ id, label, minTier }) => ({
    id,
    label,
    minTier,
  }));

  // Determine effective default: admin-configured if valid for this user's tier,
  // otherwise fall back to the hardcoded DEFAULT_MODEL_ID.
  const adminDefault = getDefaultModelId();
  const adminDefaultAllowed =
    adminDefault && allowedModels.some((m) => m.id === adminDefault && m.enabled !== false);
  const effectiveDefaultModelId = adminDefaultAllowed ? adminDefault : DEFAULT_MODEL_ID;

  return {
    tier,
    defaultModelId: effectiveDefaultModelId,
    models,
    // Optional UI hint — not a security gate (that's enforced in resolveProvider).
    isBusiness: business,
  };
});
