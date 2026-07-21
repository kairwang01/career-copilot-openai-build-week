/**
 * bulkApplicationActions — employer-only batch pipeline operations.
 *
 * This intentionally composes the existing single-application callables instead
 * of duplicating the hiring state machine. Each item still goes through
 * updateApplicationStatusImpl for ownership, transition, and audit-event rules.
 * Optional candidate notification reuses sendApplicationMessageImpl so message
 * authorization and attribution stay centralized too.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { requireAuth } from "../middleware/auth";
import { updateApplicationStatusImpl } from "./updateApplicationStatus";
import { sendApplicationMessageImpl } from "./applicationMessages";

type BulkAction = "advance" | "reject";

interface BulkActionRequest {
  applicationIds?: unknown;
  action?: unknown;
  reason?: unknown;
  candidateNote?: unknown;
  notify?: unknown;
  messageBody?: unknown;
  templateKey?: unknown;
}

interface BulkActionItemResult {
  applicationId: string;
  ok: boolean;
  status?: string;
  action?: string;
  changed?: boolean;
  eventId?: string | null;
  messageId?: string;
  errorCode?: string;
  errorMessage?: string;
}

const MAX_BATCH = 50;
const MAX_REASON = 500;
const MAX_NOTE = 1000;
const MAX_MESSAGE = 4000;

const cleanText = (value: unknown, maxLen: number): string =>
  typeof value === "string" ? value.trim().slice(0, maxLen) : "";

function cleanApplicationIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new HttpsError("invalid-argument", "applicationIds must be a non-empty array.");
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  value.forEach((item) => {
    const id = cleanText(item, 256);
    if (!id || id.includes("/") || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  });
  if (ids.length === 0) {
    throw new HttpsError("invalid-argument", "At least one valid application id is required.");
  }
  if (ids.length > MAX_BATCH) {
    throw new HttpsError("invalid-argument", `Batch actions are limited to ${MAX_BATCH} applications.`);
  }
  return ids;
}

function cleanAction(value: unknown): BulkAction {
  const action = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (action === "advance" || action === "reject") return action;
  throw new HttpsError("invalid-argument", "Bulk action must be advance or reject.");
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" ? code : "internal";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Batch item failed.";
}

export async function bulkUpdateApplicationStatusImpl(uid: string, rawData: unknown) {
  const data = (rawData ?? {}) as BulkActionRequest;
  const applicationIds = cleanApplicationIds(data.applicationIds);
  const action = cleanAction(data.action);
  const reason = cleanText(data.reason, MAX_REASON);
  const candidateNote = cleanText(data.candidateNote, MAX_NOTE);
  const notify = data.notify === true;
  const messageBody = cleanText(data.messageBody, MAX_MESSAGE);
  const templateKey = cleanText(data.templateKey, 40) || (action === "reject" ? "rejection" : "interview_invite");

  if (action === "reject" && !reason) {
    throw new HttpsError("invalid-argument", "A reason is required when rejecting candidates in bulk.");
  }
  if (notify && !messageBody) {
    throw new HttpsError("invalid-argument", "A notification message is required when notify is enabled.");
  }

  const results: BulkActionItemResult[] = [];
  for (const applicationId of applicationIds) {
    try {
      const statusResult = await updateApplicationStatusImpl(uid, {
        applicationId,
        action,
        status: action === "reject" ? "Rejected" : "",
        reason,
        candidateNote,
      });
      const item: BulkActionItemResult = {
        applicationId,
        ok: true,
        status: statusResult.status,
        action: statusResult.action,
        changed: statusResult.changed,
        eventId: statusResult.eventId,
      };
      if (notify) {
        const message = await sendApplicationMessageImpl(uid, {
          applicationId,
          body: messageBody,
          templateKey,
        });
        item.messageId = message.messageId;
      }
      results.push(item);
    } catch (error) {
      results.push({
        applicationId,
        ok: false,
        errorCode: errorCode(error),
        errorMessage: errorMessage(error),
      });
    }
  }

  const succeeded = results.filter((item) => item.ok).length;
  return {
    total: results.length,
    succeeded,
    failed: results.length - succeeded,
    results,
  };
}

export const bulkUpdateApplicationStatusFunction = onCall({ invoker: "public" }, (request) =>
  bulkUpdateApplicationStatusImpl(requireAuth(request), request.data ?? {}));
