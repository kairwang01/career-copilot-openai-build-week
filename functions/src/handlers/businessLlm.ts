/**
 * businessLlm — User-facing callables for business-tier custom LLM config.
 *
 * Business users (role "employer") may
 * supply their own OpenAI-compatible API endpoint. The config is stored in a
 * server-only collection that is unreachable through client Firestore rules.
 *
 * Security guarantees:
 *   - Only authenticated business users may write their own provider config.
 *   - The raw api_key is NEVER returned to the client — only a masked preview.
 *   - base_url is validated to be a valid https URL before persistence.
 *   - Non-business users receive permission-denied; they cannot read or write.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAuth } from "../middleware/auth";
import { USERS_COLLECTION, USER_FIELDS } from "../credits/schema";
import { isBusinessUser } from "../llm/models";
import {
  CustomProviderAccountDeletedError,
  CustomProviderApiKeyRequiredError,
  getCustomProviderConfig,
  setCustomProviderConfig,
  type CustomProviderConfig,
} from "../llm/customProviderStore";
import { maskSecret } from "../config/env";
import { assertSafeHttpsUrl, resolveSafeAddresses } from "../utils/safeHttpsTransport";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/** Maximum allowed lengths to prevent excessively large payloads. */
const MAX_URL_LENGTH = 512;
const MAX_MODEL_LENGTH = 128;
const MAX_API_KEY_LENGTH = 256;

/**
 * Validates that `value` is a non-empty https URL. Returns the trimmed URL or
 * throws HttpsError("invalid-argument") with a human-readable message.
 */
function validateHttpsUrl(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpsError("invalid-argument", `${fieldName} must be a non-empty string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_URL_LENGTH) {
    throw new HttpsError("invalid-argument", `${fieldName} is too long (max ${MAX_URL_LENGTH} chars).`);
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new HttpsError("invalid-argument", `${fieldName} is not a valid URL.`);
  }
  if (parsed.protocol !== "https:") {
    throw new HttpsError(
      "invalid-argument",
      `${fieldName} must use HTTPS. Received protocol: ${parsed.protocol}`
    );
  }
  return trimmed;
}

/** Validates both the URL and its current DNS answers before persistence. */
export async function validateBusinessProviderUrl(value: unknown): Promise<string> {
  const trimmed = validateHttpsUrl(value, "base_url");
  const safe = assertSafeHttpsUrl(trimmed);
  await resolveSafeAddresses(safe.hostname);
  return trimmed;
}

function validateNonEmptyString(value: unknown, fieldName: string, maxLen: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpsError("invalid-argument", `${fieldName} must be a non-empty string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLen) {
    throw new HttpsError("invalid-argument", `${fieldName} is too long (max ${maxLen} chars).`);
  }
  return trimmed;
}

/** Empty or omitted keys preserve the currently configured server-side key. */
function validateApiKeyPatch(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", "api_key must be a string when provided.");
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_API_KEY_LENGTH) {
    throw new HttpsError(
      "invalid-argument",
      `api_key is too long (max ${MAX_API_KEY_LENGTH} chars).`
    );
  }
  return trimmed || undefined;
}

export type BusinessLlmConfigResponse =
  | { configured: false }
  | { configured: true; base_url: string; model: string; api_key_masked: string };

/** Projects a private config into the only shape callers may receive. */
export function businessLlmConfigResponse(
  config: CustomProviderConfig | null,
): BusinessLlmConfigResponse {
  if (!config) return { configured: false };
  return {
    configured: true,
    base_url: config.base_url,
    model: config.model,
    api_key_masked: maskSecret(config.api_key),
  };
}

/** Asserts the caller is an authenticated business user; returns uid. */
async function requireBusinessUser(request: Parameters<typeof requireAuth>[0]): Promise<string> {
  const uid = requireAuth(request);
  const snap = await db.collection(USERS_COLLECTION).doc(uid).get();
  const subscriptionStatus = snap.get(USER_FIELDS.subscriptionStatus) as string | undefined;
  const role = snap.get(USER_FIELDS.role) as string | undefined;
  if (!isBusinessUser(role, subscriptionStatus)) {
    throw new HttpsError(
      "permission-denied",
      "Custom LLM configuration is available for business accounts only. " +
        "Upgrade to an employer plan to use this feature."
    );
  }
  return uid;
}

/**
 * setBusinessLlmConfig({ base_url, api_key, model })
 *
 * Stores the caller's custom OpenAI-compatible provider config in the
 * server-only credential store. Business users only. Empty api_key input keeps
 * the prior key; a first-time config still requires a non-empty key.
 *
 * @throws permission-denied — caller is not a business user.
 * @throws invalid-argument  — base_url is not https, or fields are empty/too long.
 */
export const setBusinessLlmConfigFunction = onCall(
  { invoker: "public" },
  async (request) => {
    const uid = await requireBusinessUser(request);

    const data = request.data as Record<string, unknown>;

    // Check current DNS answers before persistence. The custom provider transport
    // repeats this check and pins the approved address for every request/redirect,
    // so changing DNS after this write cannot rebind the runtime connection.
    const base_url = await validateBusinessProviderUrl(data.base_url);
    const api_key = validateApiKeyPatch(data.api_key);
    const model = validateNonEmptyString(data.model, "model", MAX_MODEL_LENGTH);

    try {
      await setCustomProviderConfig(uid, { base_url, api_key, model });
    } catch (error) {
      if (error instanceof CustomProviderApiKeyRequiredError) {
        throw new HttpsError("invalid-argument", error.message);
      }
      if (error instanceof CustomProviderAccountDeletedError) {
        throw new HttpsError("failed-precondition", error.message);
      }
      throw error;
    }

    return { success: true };
  }
);

/**
 * getBusinessLlmConfig()
 *
 * Returns the caller's stored custom provider config with the api_key masked.
 * NEVER returns the raw api_key. Business users only.
 *
 * Response shape: { base_url, model, api_key_masked } | { configured: false }
 *
 * @throws permission-denied — caller is not a business user.
 */
export const getBusinessLlmConfigFunction = onCall(
  { invoker: "public" },
  async (request) => {
    const uid = await requireBusinessUser(request);

    try {
      const config = await getCustomProviderConfig(uid);
      return businessLlmConfigResponse(config);
    } catch (error) {
      if (error instanceof CustomProviderAccountDeletedError) {
        throw new HttpsError("failed-precondition", error.message);
      }
      throw error;
    }
  }
);
