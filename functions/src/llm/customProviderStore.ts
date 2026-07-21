/**
 * Server-only persistence for per-user BYOA provider credentials.
 *
 * Raw API keys must never live in users/{uid}: owners can read that document.
 * This store keeps credentials in a default-deny top-level collection and
 * transactionally migrates the legacy user field when it is encountered.
 */

import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { ACCOUNT_DELETION_REQUESTS_COLLECTION } from "../accountDeletion/plan";
import { USERS_COLLECTION } from "../credits/schema";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

export const CUSTOM_PROVIDER_CONFIG_COLLECTION = "private_custom_provider_configs";
export const LEGACY_CUSTOM_PROVIDER_FIELD = "custom_provider";

export interface CustomProviderConfig {
  base_url: string;
  api_key: string;
  model: string;
}

export interface CustomProviderConfigPatch {
  base_url: string;
  model: string;
  /** Empty or omitted means keep the existing secret. */
  api_key?: string;
}

export class CustomProviderApiKeyRequiredError extends Error {
  constructor() {
    super("A non-empty api_key is required when no key is already configured.");
    this.name = "CustomProviderApiKeyRequiredError";
  }
}

export class CustomProviderAccountDeletedError extends Error {
  constructor() {
    super("Custom provider credentials cannot be read or changed after account deletion starts.");
    this.name = "CustomProviderAccountDeletedError";
  }
}

/** Returns a complete, trimmed config or null for malformed/incomplete input. */
export function parseCustomProviderConfig(value: unknown): CustomProviderConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.base_url !== "string" ||
    typeof raw.api_key !== "string" ||
    typeof raw.model !== "string"
  ) {
    return null;
  }

  const config = {
    base_url: raw.base_url.trim(),
    api_key: raw.api_key.trim(),
    model: raw.model.trim(),
  };
  return config.base_url && config.api_key && config.model ? config : null;
}

/** Applies set-config PATCH semantics without ever replacing a key with blank input. */
export function mergeCustomProviderConfig(
  current: CustomProviderConfig | null,
  patch: CustomProviderConfigPatch,
): CustomProviderConfig {
  const suppliedKey = typeof patch.api_key === "string" ? patch.api_key.trim() : "";
  const apiKey = suppliedKey || current?.api_key || "";
  if (!apiKey) throw new CustomProviderApiKeyRequiredError();

  return {
    base_url: patch.base_url.trim(),
    api_key: apiKey,
    model: patch.model.trim(),
  };
}

export interface CustomProviderMigrationPlan {
  config: CustomProviderConfig | null;
  configToPersist: CustomProviderConfig | null;
  deleteLegacyField: boolean;
}

export type CustomProviderMigrationStatus =
  | "none"
  | "migrated"
  | "private_preserved"
  | "invalid_removed";

export interface CustomProviderMigrationResult {
  config: CustomProviderConfig | null;
  status: CustomProviderMigrationStatus;
}

/**
 * Chooses the server-only value first. A valid legacy value is copied only
 * when no valid private value exists; any present legacy field is then removed.
 */
export function planCustomProviderMigration(
  privateValue: unknown,
  legacyValue: unknown,
): CustomProviderMigrationPlan {
  const privateConfig = parseCustomProviderConfig(privateValue);
  const legacyConfig = parseCustomProviderConfig(legacyValue);
  const deleteLegacyField = legacyValue !== undefined;
  return {
    config: privateConfig ?? legacyConfig,
    configToPersist: privateConfig ? null : legacyConfig,
    deleteLegacyField,
  };
}

/**
 * Migrates one legacy owner-readable config into the private collection.
 * The status is safe for aggregate migration logs and never contains secrets.
 */
export async function migrateLegacyCustomProviderConfig(
  uid: string,
  database: admin.firestore.Firestore = db,
): Promise<CustomProviderMigrationResult> {
  const privateRef = database.collection(CUSTOM_PROVIDER_CONFIG_COLLECTION).doc(uid);
  const userRef = database.collection(USERS_COLLECTION).doc(uid);
  const deletionRef = database.collection(ACCOUNT_DELETION_REQUESTS_COLLECTION).doc(uid);

  return database.runTransaction(async (tx) => {
    const [privateSnap, userSnap, deletionSnap] = await tx.getAll(privateRef, userRef, deletionRef);
    if (deletionSnap.exists) throw new CustomProviderAccountDeletedError();

    const privateValue = privateSnap.data();
    const legacyValue = userSnap.get(LEGACY_CUSTOM_PROVIDER_FIELD);
    const plan = planCustomProviderMigration(privateValue, legacyValue);
    let status: CustomProviderMigrationStatus = "none";

    if (plan.configToPersist) {
      tx.set(privateRef, {
        ...plan.configToPersist,
        updated_at: FieldValue.serverTimestamp(),
        migrated_from_legacy_at: FieldValue.serverTimestamp(),
      });
      status = "migrated";
    } else if (plan.deleteLegacyField) {
      status = parseCustomProviderConfig(privateValue) ? "private_preserved" : "invalid_removed";
    }
    if (plan.deleteLegacyField && userSnap.exists) {
      tx.update(userRef, { [LEGACY_CUSTOM_PROVIDER_FIELD]: FieldValue.delete() });
    }

    return { config: plan.config, status };
  });
}

/**
 * Reads the private config. If a legacy users/{uid}.custom_provider field is
 * present, its copy/delete migration occurs in the same Admin SDK transaction.
 */
export async function getCustomProviderConfig(
  uid: string,
  database: admin.firestore.Firestore = db,
): Promise<CustomProviderConfig | null> {
  return (await migrateLegacyCustomProviderConfig(uid, database)).config;
}

/**
 * Replaces public provider metadata while preserving an existing key for an
 * empty-key PATCH. The private write and legacy-field deletion are atomic.
 */
export async function setCustomProviderConfig(
  uid: string,
  patch: CustomProviderConfigPatch,
  database: admin.firestore.Firestore = db,
): Promise<CustomProviderConfig> {
  const privateRef = database.collection(CUSTOM_PROVIDER_CONFIG_COLLECTION).doc(uid);
  const userRef = database.collection(USERS_COLLECTION).doc(uid);
  const deletionRef = database.collection(ACCOUNT_DELETION_REQUESTS_COLLECTION).doc(uid);

  return database.runTransaction(async (tx) => {
    const [privateSnap, userSnap, deletionSnap] = await tx.getAll(privateRef, userRef, deletionRef);
    if (deletionSnap.exists) throw new CustomProviderAccountDeletedError();
    const plan = planCustomProviderMigration(
      privateSnap.data(),
      userSnap.get(LEGACY_CUSTOM_PROVIDER_FIELD),
    );
    const next = mergeCustomProviderConfig(plan.config, patch);

    tx.set(privateRef, {
      ...next,
      updated_at: FieldValue.serverTimestamp(),
    });
    if (plan.deleteLegacyField && userSnap.exists) {
      tx.update(userRef, { [LEGACY_CUSTOM_PROVIDER_FIELD]: FieldValue.delete() });
    }

    return next;
  });
}

/**
 * Permanently removes both private and legacy credential copies. Account
 * deletion should call this before deleting the parent users/{uid} document.
 */
export async function deleteCustomProviderConfig(
  uid: string,
  database: admin.firestore.Firestore = db,
): Promise<void> {
  const privateRef = database.collection(CUSTOM_PROVIDER_CONFIG_COLLECTION).doc(uid);
  const userRef = database.collection(USERS_COLLECTION).doc(uid);

  await database.runTransaction(async (tx) => {
    const [, userSnap] = await tx.getAll(privateRef, userRef);
    tx.delete(privateRef);
    if (userSnap.exists && userSnap.get(LEGACY_CUSTOM_PROVIDER_FIELD) !== undefined) {
      tx.update(userRef, { [LEGACY_CUSTOM_PROVIDER_FIELD]: FieldValue.delete() });
    }
  });
}
