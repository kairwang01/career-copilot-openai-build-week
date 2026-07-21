/**
 * Admin prompt-management callables — versioned lifecycle (draft/publish/rollback).
 *
 * Version bookkeeping lives in the NEW 'admin_prompt_versions' collection.
 * Runtime prompt resolution is UNCHANGED: published content is still written to
 * platform_config/prompts {key: content} exactly as before, and getPromptOverride
 * continues to read from there.
 *
 * Callable exports:
 *   adminGetPrompts          — list keys + defaults + current overrides   (role: admin)
 *   adminSavePromptDraft     — create a new draft version                 (role: admin)
 *   adminPublishPrompt       — publish a draft version; archives prior    (role: super)
 *   adminRollbackPrompt      — fork an old version and publish it         (role: super)
 *   adminListPromptVersions  — newest-first version list for a key        (role: admin)
 *
 * Back-compat wrappers (unchanged callable names, unchanged role requirement):
 *   adminUpdatePrompt  — create draft + immediately publish (role: admin, one-step)
 *   adminResetPrompt   — delete override in platform_config + create archived version (role: admin)
 *
 * Back-compat choice rationale:
 *   adminUpdatePrompt and adminResetPrompt previously required role 'admin'.
 *   Silently upgrading them to 'super' would break the Admin UI for admin-role users.
 *   Instead they are kept at 'admin' but now create a version record internally,
 *   calling the same write path as adminPublishPrompt for full audit coverage.
 *
 * Security conventions (unchanged):
 *   - All callables call requireRole before any other work.
 *   - Audit logs record key + content length only — never the full content body.
 *   - Key validation rejects any key not in the built-in registry.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { requireRole } from "../admin/roles";
import {
  PLATFORM_CONFIG_COLLECTION,
  PLATFORM_DOCS,
} from "../admin/schema";
import {
  getAllPromptOverrides,
  refreshPlatformCaches,
} from "../admin/platformConfig";
import { logAdminAction } from "../admin/usageLog";
import {
  listPromptKeys,
  getPromptDefault,
} from "../llm/prompts";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROMPT_MAX_LENGTH = 20_000;
const PROMPT_VERSIONS_COLLECTION = "admin_prompt_versions";
const MAX_VERSIONS_RETURNED = 50;

// ---------------------------------------------------------------------------
// Version document shape
// ---------------------------------------------------------------------------

interface PromptVersionDoc {
  promptKey: string;
  version: number;          // incrementing integer per key, starting at 1
  status: "draft" | "published" | "archived";
  content: string;
  createdBy: string;
  createdAt: FieldValue | Timestamp;
  publishedBy?: string;
  publishedAt?: FieldValue | Timestamp;
  changeSummary?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns the next version number for a given prompt key by reading the
 * current max version from the versions collection.
 * Runs inside a transaction to avoid racing increments.
 */
async function nextVersionNumber(
  tx: admin.firestore.Transaction,
  promptKey: string
): Promise<number> {
  const snap = await tx.get(
    db
      .collection(PROMPT_VERSIONS_COLLECTION)
      .where("promptKey", "==", promptKey)
      .orderBy("version", "desc")
      .limit(1)
  );
  if (snap.empty) return 1;
  return (snap.docs[0].data().version as number) + 1;
}

function runtimePromptsRef(): admin.firestore.DocumentReference {
  return db.collection(PLATFORM_CONFIG_COLLECTION).doc(PLATFORM_DOCS.prompts);
}

async function refreshPromptCacheBestEffort(): Promise<void> {
  try {
    await refreshPlatformCaches();
  } catch (error) {
    // Durable version/runtime state is already committed atomically. A warm
    // instance may be stale until the next refresh, but the admin action must
    // not be reported as failed and then retried as a second publication.
    console.error("Prompt cache refresh failed after committed publication", error);
  }
}

/**
 * Archives the currently-published version for a given key (sets status →
 * 'archived').  Must be called BEFORE writing the new published version so
 * the new one can be set to 'published' without collision.
 * Returns the ID of the archived doc (or null if there was none).
 */
async function archivePreviousPublished(
  tx: admin.firestore.Transaction,
  promptKey: string
): Promise<string | null> {
  const snap = await tx.get(
    db
      .collection(PROMPT_VERSIONS_COLLECTION)
      .where("promptKey", "==", promptKey)
      .where("status", "==", "published")
      .limit(1)
  );
  if (snap.empty) return null;
  const doc = snap.docs[0];
  tx.update(doc.ref, { status: "archived" });
  return doc.id;
}

/**
 * Shared validation for promptKey and content. Throws HttpsError on failure.
 */
function validateKeyAndContent(key: unknown, content: unknown): void {
  if (!key || typeof key !== "string") {
    throw new HttpsError("invalid-argument", "promptKey is required.");
  }
  const knownKeys = new Set(listPromptKeys());
  if (!knownKeys.has(key)) {
    throw new HttpsError("invalid-argument", `Unknown prompt key: "${key}".`);
  }
  if (!content || typeof content !== "string" || (content as string).trim() === "") {
    throw new HttpsError("invalid-argument", "content must be a non-empty string.");
  }
  if ((content as string).length > PROMPT_MAX_LENGTH) {
    throw new HttpsError(
      "invalid-argument",
      `content exceeds maximum length of ${PROMPT_MAX_LENGTH} characters.`
    );
  }
  const missing = missingPromptPlaceholders(key, content as string);
  if (missing.length > 0) {
    throw new HttpsError(
      "invalid-argument",
      `content is missing required placeholders: ${missing.map((name) => `{{${name}}}`).join(", ")}`
    );
  }
}

export function missingPromptPlaceholders(promptKey: string, content: string): string[] {
  const required = [...getPromptDefault(promptKey).matchAll(/\{\{\s*(\w+)\s*\}\}/g)]
    .map((match) => match[1]);
  const present = new Set(
    [...content.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1])
  );
  return [...new Set(required)].filter((name) => !present.has(name));
}

// ---------------------------------------------------------------------------
// adminGetPrompts
// ---------------------------------------------------------------------------

/**
 * Returns all registered prompt keys with their built-in default and current
 * Firestore override (null if no override is stored). Sorted alphabetically.
 */
export const adminGetPromptsFunction = onCall({ invoker: "public" }, async (request) => {
  await requireRole(request, "admin");

  const overrides = getAllPromptOverrides();
  const keys = listPromptKeys().sort();

  const prompts = keys.map((key) => ({
    key,
    default: getPromptDefault(key),
    override: overrides[key] ?? null,
  }));

  return { prompts };
});

// ---------------------------------------------------------------------------
// adminSavePromptDraft
// ---------------------------------------------------------------------------

interface SavePromptDraftRequest {
  promptKey: string;
  content: string;
  changeSummary?: string;
}

/**
 * Creates a new version document with status 'draft'.
 * Does NOT touch platform_config/prompts — drafts are not live.
 */
export const adminSavePromptDraftFunction = onCall({ invoker: "public" }, async (request) => {
  const { uid: adminUid } = await requireRole(request, "admin");

  const { promptKey, content, changeSummary } = (request.data ?? {}) as SavePromptDraftRequest;

  validateKeyAndContent(promptKey, content);

  const newDocRef = db.collection(PROMPT_VERSIONS_COLLECTION).doc();

  const versionDoc: Omit<PromptVersionDoc, "createdAt"> & {
    createdAt: FieldValue;
  } = await db.runTransaction(async (tx) => {
    const versionNumber = await nextVersionNumber(tx, promptKey);
    const doc = {
      promptKey,
      version: versionNumber,
      status: "draft" as const,
      content,
      createdBy: adminUid,
      createdAt: FieldValue.serverTimestamp(),
      ...(changeSummary ? { changeSummary } : {}),
    };
    tx.set(newDocRef, doc);
    return doc;
  });

  await logAdminAction({
    admin_uid: adminUid,
    action: "save_prompt_draft",
    details: {
      key: promptKey,
      version: versionDoc.version,
      length: content.length,
      versionId: newDocRef.id,
    },
  });

  return {
    versionId: newDocRef.id,
    promptKey,
    version: versionDoc.version,
    status: "draft",
  };
});

// ---------------------------------------------------------------------------
// adminPublishPrompt
// ---------------------------------------------------------------------------

interface PublishPromptRequest {
  versionId: string;
}

/**
 * Publishes a draft (or archived) version.
 * - Archives the previously-published version for the same key.
 * - Sets the target version status → 'published'.
 * - Writes content into platform_config/prompts (runtime read path).
 */
export const adminPublishPromptFunction = onCall({ invoker: "public" }, async (request) => {
  const { uid: superUid } = await requireRole(request, "super");

  const { versionId } = (request.data ?? {}) as PublishPromptRequest;
  if (!versionId || typeof versionId !== "string") {
    throw new HttpsError("invalid-argument", "versionId is required.");
  }

  const targetRef = db.collection(PROMPT_VERSIONS_COLLECTION).doc(versionId);

  let promptKey = "";
  let content = "";
  let versionNumber = 0;
  let alreadyPublished = false;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(targetRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", `Version "${versionId}" not found.`);
    }
    const data = snap.data() as PromptVersionDoc;
    const knownKeys = new Set(listPromptKeys());
    if (!knownKeys.has(data.promptKey)) {
      throw new HttpsError("invalid-argument", `Prompt key "${data.promptKey}" is no longer in the registry.`);
    }
    if (data.status === "published") {
      // Heal a publication created by the legacy split transaction if needed.
      promptKey = data.promptKey;
      content = data.content;
      versionNumber = data.version;
      alreadyPublished = true;
      tx.set(runtimePromptsRef(), { [promptKey]: content }, { merge: true });
      return;
    }

    promptKey = data.promptKey;
    content = data.content;
    versionNumber = data.version;

    // Validate key is still in whitelist (guard against key removal after draft creation)
    // Archive the current published version (if any)
    await archivePreviousPublished(tx, promptKey);

    // Mark this version as published
    tx.update(targetRef, {
      status: "published",
      publishedBy: superUid,
      publishedAt: FieldValue.serverTimestamp(),
    });
    tx.set(runtimePromptsRef(), { [promptKey]: content }, { merge: true });
  });

  await refreshPromptCacheBestEffort();

  if (!alreadyPublished) {
    await logAdminAction({
      admin_uid: superUid,
      action: "publish_prompt",
      details: {
        key: promptKey,
        version: versionNumber,
        length: content.length,
        versionId,
      },
    });
  }

  return { versionId, promptKey, version: versionNumber, status: "published" };
});

// ---------------------------------------------------------------------------
// adminRollbackPrompt
// ---------------------------------------------------------------------------

interface RollbackPromptRequest {
  versionId: string;
}

/**
 * Creates a NEW version document copying the content from a previous version,
 * then immediately publishes it (history is immutable — old docs are untouched).
 */
export const adminRollbackPromptFunction = onCall({ invoker: "public" }, async (request) => {
  const { uid: superUid } = await requireRole(request, "super");

  const { versionId } = (request.data ?? {}) as RollbackPromptRequest;
  if (!versionId || typeof versionId !== "string") {
    throw new HttpsError("invalid-argument", "versionId is required.");
  }

  // Read the source version
  const sourceRef = db.collection(PROMPT_VERSIONS_COLLECTION).doc(versionId);
  const sourceSnap = await sourceRef.get();
  if (!sourceSnap.exists) {
    throw new HttpsError("not-found", `Version "${versionId}" not found.`);
  }
  const source = sourceSnap.data() as PromptVersionDoc;

  const promptKey = source.promptKey;
  const content = source.content;

  // Validate key still in whitelist
  const knownKeys = new Set(listPromptKeys());
  if (!knownKeys.has(promptKey)) {
    throw new HttpsError("invalid-argument", `Prompt key "${promptKey}" is no longer in the registry.`);
  }

  const newDocRef = db.collection(PROMPT_VERSIONS_COLLECTION).doc();
  let newVersionNumber = 0;

  await db.runTransaction(async (tx) => {
    newVersionNumber = await nextVersionNumber(tx, promptKey);

    // Archive the current published version (if any)
    await archivePreviousPublished(tx, promptKey);

    // Create new published version (rollback copy)
    const newDoc: Omit<PromptVersionDoc, "createdAt" | "publishedAt"> & {
      createdAt: FieldValue;
      publishedAt: FieldValue;
    } = {
      promptKey,
      version: newVersionNumber,
      status: "published",
      content,
      createdBy: superUid,
      createdAt: FieldValue.serverTimestamp(),
      publishedBy: superUid,
      publishedAt: FieldValue.serverTimestamp(),
      changeSummary: `Rollback from version ${source.version} (${versionId})`,
    };
    tx.set(newDocRef, newDoc);
    tx.set(runtimePromptsRef(), { [promptKey]: content }, { merge: true });
  });

  await refreshPromptCacheBestEffort();

  await logAdminAction({
    admin_uid: superUid,
    action: "rollback_prompt",
    details: {
      key: promptKey,
      sourceVersionId: versionId,
      sourceVersion: source.version,
      newVersion: newVersionNumber,
      newVersionId: newDocRef.id,
      length: content.length,
    },
  });

  return {
    newVersionId: newDocRef.id,
    newVersion: newVersionNumber,
    promptKey,
    status: "published",
    rolledBackFrom: { versionId, version: source.version },
  };
});

// ---------------------------------------------------------------------------
// adminListPromptVersions
// ---------------------------------------------------------------------------

interface ListPromptVersionsRequest {
  promptKey: string;
}

/**
 * Returns versions for a given prompt key, newest first (up to 50).
 * Content is included — admins may read prompt bodies.
 */
export const adminListPromptVersionsFunction = onCall({ invoker: "public" }, async (request) => {
  await requireRole(request, "admin");

  const { promptKey } = (request.data ?? {}) as ListPromptVersionsRequest;
  if (!promptKey || typeof promptKey !== "string") {
    throw new HttpsError("invalid-argument", "promptKey is required.");
  }
  const knownKeys = new Set(listPromptKeys());
  if (!knownKeys.has(promptKey)) {
    throw new HttpsError("invalid-argument", `Unknown prompt key: "${promptKey}".`);
  }

  const snap = await db
    .collection(PROMPT_VERSIONS_COLLECTION)
    .where("promptKey", "==", promptKey)
    .orderBy("version", "desc")
    .limit(MAX_VERSIONS_RETURNED)
    .get();

  const versions = snap.docs.map((doc) => {
    const d = doc.data() as PromptVersionDoc;
    return {
      versionId: doc.id,
      promptKey: d.promptKey,
      version: d.version,
      status: d.status,
      content: d.content,
      createdBy: d.createdBy,
      createdAt: d.createdAt,
      publishedBy: d.publishedBy ?? null,
      publishedAt: d.publishedAt ?? null,
      changeSummary: d.changeSummary ?? null,
    };
  });

  return { promptKey, versions };
});

// ---------------------------------------------------------------------------
// adminUpdatePrompt  (back-compat wrapper — unchanged role: admin)
// ---------------------------------------------------------------------------

interface UpdatePromptRequest {
  key: string;
  template: string;
}

/**
 * Back-compat wrapper retained so the Admin UI continues to work without changes.
 * Creates a draft version and immediately publishes it in one atomic step.
 * Role requirement is unchanged ('admin') so existing admin-role users are unaffected.
 *
 * NOTE: This intentionally bypasses the super-only publish gate because it is an
 * existing capability (admin could already write directly).  New workflows should
 * prefer adminSavePromptDraft + adminPublishPrompt.
 */
export const adminUpdatePromptFunction = onCall({ invoker: "public" }, async (request) => {
  const { uid: adminUid } = await requireRole(request, "admin");

  const { key, template } = (request.data ?? {}) as UpdatePromptRequest;

  // Validate (reuse same rules — key whitelist + non-empty + length cap)
  validateKeyAndContent(key, template);

  const newDocRef = db.collection(PROMPT_VERSIONS_COLLECTION).doc();
  let versionNumber = 0;

  await db.runTransaction(async (tx) => {
    versionNumber = await nextVersionNumber(tx, key);
    await archivePreviousPublished(tx, key);
    tx.set(newDocRef, {
      promptKey: key,
      version: versionNumber,
      status: "published",
      content: template,
      createdBy: adminUid,
      createdAt: FieldValue.serverTimestamp(),
      publishedBy: adminUid,
      publishedAt: FieldValue.serverTimestamp(),
      changeSummary: "Direct update via adminUpdatePrompt (back-compat)",
    } as Omit<PromptVersionDoc, "createdAt" | "publishedAt"> & {
      createdAt: FieldValue;
      publishedAt: FieldValue;
    });
    tx.set(runtimePromptsRef(), { [key]: template }, { merge: true });
  });

  await refreshPromptCacheBestEffort();

  await logAdminAction({
    admin_uid: adminUid,
    action: "update_prompt",
    details: { key, length: template.length, version: versionNumber, versionId: newDocRef.id },
  });

  return { key, override: template };
});

// ---------------------------------------------------------------------------
// adminResetPrompt  (back-compat wrapper — unchanged role: admin)
// ---------------------------------------------------------------------------

interface ResetPromptRequest {
  key: string;
}

/**
 * Back-compat wrapper retained so the Admin UI continues to work without changes.
 * Deletes the override from platform_config/prompts (reverts to built-in default)
 * and records an archived version entry for audit purposes.
 * Role requirement is unchanged ('admin').
 */
export const adminResetPromptFunction = onCall({ invoker: "public" }, async (request) => {
  const { uid: adminUid } = await requireRole(request, "admin");

  const { key } = (request.data ?? {}) as ResetPromptRequest;

  if (!key || typeof key !== "string") {
    throw new HttpsError("invalid-argument", "key is required.");
  }
  const knownKeys = new Set(listPromptKeys());
  if (!knownKeys.has(key)) {
    throw new HttpsError("invalid-argument", `Unknown prompt key: "${key}".`);
  }

  // Archive version metadata and remove the runtime override atomically.
  await db.runTransaction(async (tx) => {
    await archivePreviousPublished(tx, key);
    tx.set(runtimePromptsRef(), { [key]: FieldValue.delete() }, { merge: true });
  });

  await refreshPromptCacheBestEffort();

  await logAdminAction({
    admin_uid: adminUid,
    action: "reset_prompt",
    details: { key },
  });

  return { key, override: null };
});
