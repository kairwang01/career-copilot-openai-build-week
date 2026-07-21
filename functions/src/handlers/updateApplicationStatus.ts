/**
 * updateApplicationStatus — audited employer-owned status transitions.
 *
 * Replaces direct client updateDoc(job_applications/{id}) writes. The callable
 * verifies the employer owns the authoritative job posting, updates the lean
 * application document, and writes a server-only audit event with actor + notes.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth } from "../middleware/auth";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const KNOWN_STATUSES = [
  "Applied",
  "Group Interview",
  "First Interview",
  "Second Interview",
  "Decision Maker Interview",
  "HR Interview",
  "Offer",
  "Hiring Evaluation",
  "Intent Letter",
  "Offer Confirmed",
  "Tripartite Agreement",
  "Signed",
  "Rejected",
] as const;

type ApplicationStatus = (typeof KNOWN_STATUSES)[number];
type PipelineApplicationStatus = Exclude<ApplicationStatus, "Rejected">;

const KNOWN_STATUS_SET = new Set<string>(KNOWN_STATUSES);
const PIPELINE_STATUSES = KNOWN_STATUSES.filter(
  (status): status is PipelineApplicationStatus => status !== "Rejected",
);
const STATUS_ALIASES: Record<string, ApplicationStatus> = {
  applied: "Applied",
  apply: "Applied",
  submitted: "Applied",
  "resume submitted": "Applied",
  "投递简历": "Applied",
  "已投递": "Applied",
  interviewing: "First Interview",
  interview: "First Interview",
  "interview-stage": "First Interview",
  "interview stage": "First Interview",
  "面试中": "First Interview",
  "group interview": "Group Interview",
  "集体面试": "Group Interview",
  "first interview": "First Interview",
  "初试": "First Interview",
  "second interview": "Second Interview",
  "复试": "Second Interview",
  "decision maker interview": "Decision Maker Interview",
  "hiring manager interview": "Decision Maker Interview",
  "用人决策者面试": "Decision Maker Interview",
  "hr interview": "HR Interview",
  "hr面试": "HR Interview",
  offer: "Offer",
  "录用评估中": "Hiring Evaluation",
  "hiring evaluation": "Hiring Evaluation",
  "intent letter": "Intent Letter",
  "确认意向书": "Intent Letter",
  "offer confirmed": "Offer Confirmed",
  accepted: "Offer Confirmed",
  "确认offer": "Offer Confirmed",
  "tripartite agreement": "Tripartite Agreement",
  "三方协议": "Tripartite Agreement",
  signed: "Signed",
  hired: "Signed",
  "签约": "Signed",
  "已录用": "Signed",
  rejected: "Rejected",
  closed: "Rejected",
  declined: "Rejected",
  "未通过": "Rejected",
};

interface UpdateApplicationStatusRequest {
  applicationId?: unknown;
  status?: unknown;
  action?: unknown;
  reason?: unknown;
  candidateNote?: unknown;
}

const STATUS_INDEX = new Map<string, number>(
  KNOWN_STATUSES.filter((status) => status !== "Rejected").map((status, index) => [status, index]),
);

const TRANSITION_ACTIONS = new Set(["advance", "skip", "reject", "reopen"]);
type TransitionAction = "advance" | "skip" | "reject" | "reopen";

interface ResolvedTransition {
  action: TransitionAction;
  nextStatus: ApplicationStatus;
  skippedStatuses: string[];
}

function cleanText(value: unknown, maxLen: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLen);
}

function normalizeStatus(value: unknown): ApplicationStatus | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  if (KNOWN_STATUS_SET.has(raw)) return raw as ApplicationStatus;
  const lower = raw.toLowerCase();
  const caseHit = KNOWN_STATUSES.find((status) => status.toLowerCase() === lower);
  if (caseHit) return caseHit;
  return STATUS_ALIASES[raw] ?? STATUS_ALIASES[lower] ?? null;
}

function statusIndex(status: ApplicationStatus): number {
  return STATUS_INDEX.get(status) ?? -1;
}

function getNextStatus(status: ApplicationStatus): ApplicationStatus | null {
  const current = statusIndex(status);
  if (current < 0 || current >= KNOWN_STATUSES.length - 2) return null;
  return KNOWN_STATUSES[current + 1];
}

function skippedBetween(fromStatus: ApplicationStatus, toStatus: ApplicationStatus): string[] {
  const from = statusIndex(fromStatus);
  const to = statusIndex(toStatus);
  if (from < 0 || to < 0 || to <= from + 1) return [];
  return KNOWN_STATUSES.slice(from + 1, to);
}

function normalizeSkippedStatuses(value: unknown): PipelineApplicationStatus[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<PipelineApplicationStatus>();
  value.forEach((item) => {
    const status = normalizeStatus(item);
    if (status && status !== "Rejected" && statusIndex(status) >= 0) {
      seen.add(status);
    }
  });
  return PIPELINE_STATUSES.filter((status) => seen.has(status));
}

function mergeSkippedStatuses(
  existingValue: unknown,
  latestSkippedStatuses: readonly string[],
  action: TransitionAction,
): PipelineApplicationStatus[] {
  if (action === "reopen") return [];
  const seen = new Set<PipelineApplicationStatus>(normalizeSkippedStatuses(existingValue));
  latestSkippedStatuses.forEach((item) => {
    const status = normalizeStatus(item);
    if (status && status !== "Rejected" && statusIndex(status) >= 0) {
      seen.add(status);
    }
  });
  return PIPELINE_STATUSES.filter((status) => seen.has(status));
}

function cleanAction(value: unknown): TransitionAction | null {
  const action = typeof value === "string" ? value.trim().toLowerCase() : "";
  return TRANSITION_ACTIONS.has(action) ? (action as TransitionAction) : null;
}

function requireReason(action: TransitionAction, reason: string): void {
  if ((action === "skip" || action === "reject" || action === "reopen") && !reason) {
    throw new HttpsError("invalid-argument", "A reason is required for skip, reject, and reopen actions.");
  }
}

function resolveTransition(previousStatus: ApplicationStatus, data: UpdateApplicationStatusRequest, reason: string): ResolvedTransition {
  const requestedAction = cleanAction(data.action);
  const requestedStatus = normalizeStatus(data.status);

  const resolveWithAction = (action: TransitionAction): ResolvedTransition => {
    if (action === "advance") {
      if (previousStatus === "Rejected") {
        throw new HttpsError("failed-precondition", "Rejected applications must be reopened before advancing.");
      }
      const next = getNextStatus(previousStatus);
      if (!next) throw new HttpsError("failed-precondition", "This application is already at the final tracked stage.");
      return { action, nextStatus: next, skippedStatuses: [] };
    }

    if (action === "reject") {
      if (previousStatus === "Rejected") {
        return { action, nextStatus: "Rejected", skippedStatuses: [] };
      }
      if (previousStatus === "Signed") {
        throw new HttpsError("failed-precondition", "Signed applications are already at the final tracked stage.");
      }
      requireReason(action, reason);
      return { action, nextStatus: "Rejected", skippedStatuses: [] };
    }

    if (action === "reopen") {
      if (previousStatus !== "Rejected") {
        throw new HttpsError("failed-precondition", "Only rejected applications can be reopened.");
      }
      const target = requestedStatus && requestedStatus !== "Rejected" ? requestedStatus : "Applied";
      requireReason(action, reason);
      return { action, nextStatus: target, skippedStatuses: [] };
    }

    if (previousStatus === "Rejected") {
      throw new HttpsError("failed-precondition", "Rejected applications must be reopened before changing stages.");
    }
    if (!requestedStatus || requestedStatus === "Rejected") {
      throw new HttpsError("invalid-argument", "A later stage is required when skipping.");
    }
    const from = statusIndex(previousStatus);
    const to = statusIndex(requestedStatus);
    if (from < 0 || to <= from + 1) {
      throw new HttpsError("invalid-argument", "Skip actions must move to a later non-adjacent stage.");
    }
    requireReason(action, reason);
    return { action, nextStatus: requestedStatus, skippedStatuses: skippedBetween(previousStatus, requestedStatus) };
  };

  if (requestedAction) return resolveWithAction(requestedAction);

  // Backward-compatible path for clients that still send only `{ status }`.
  if (!requestedStatus) throw new HttpsError("invalid-argument", "Unknown application status.");
  if (previousStatus === requestedStatus) {
    return { action: previousStatus === "Rejected" ? "reject" : "advance", nextStatus: requestedStatus, skippedStatuses: [] };
  }
  if (requestedStatus === "Rejected") return resolveWithAction("reject");
  if (previousStatus === "Rejected") return resolveWithAction("reopen");
  const from = statusIndex(previousStatus);
  const to = statusIndex(requestedStatus);
  if (to === from + 1) return { action: "advance", nextStatus: requestedStatus, skippedStatuses: [] };
  if (to > from + 1) return resolveWithAction("skip");
  throw new HttpsError("invalid-argument", "Application stages can only move forward, be rejected, or be reopened.");
}

export const updateApplicationStatusFunction = onCall({ invoker: "public" }, async (request) => {
  return updateApplicationStatusImpl(requireAuth(request), request.data ?? {});
});

// Core implementation exported for emulator integration tests. The onCall wrapper
// above only extracts auth; every authorization and transition rule lives here.
export async function updateApplicationStatusImpl(uid: string, rawData: unknown) {
  const data = (rawData ?? {}) as UpdateApplicationStatusRequest;

  const applicationId = cleanText(data.applicationId, 256);
  if (!applicationId || applicationId.includes("/")) {
    throw new HttpsError("invalid-argument", "applicationId is required.");
  }

  const reason = cleanText(data.reason, 500);
  const candidateNote = cleanText(data.candidateNote, 1000);
  const appRef = db.collection("job_applications").doc(applicationId);
  const eventRef = db.collection("application_status_events").doc();

  return db.runTransaction(async (tx) => {
    const appSnap = await tx.get(appRef);
    if (!appSnap.exists) {
      throw new HttpsError("not-found", "Application not found.");
    }

    const app = appSnap.data()!;
    const candidateId = typeof app.candidate_id === "string" ? app.candidate_id : "";
    const jobId = typeof app.job_id === "string" ? app.job_id : "";
    if (!candidateId || !jobId) {
      throw new HttpsError("failed-precondition", "Application is missing a candidate or job reference.");
    }

    const jobRef = db.collection("job_postings").doc(jobId);
    const jobSnap = await tx.get(jobRef);
    if (!jobSnap.exists || jobSnap.data()?.employer_id !== uid) {
      throw new HttpsError("permission-denied", "You do not own the job for this application.");
    }

    const previousStatus = normalizeStatus(app.status) ?? "Applied";
    const transition = resolveTransition(previousStatus, data, reason);
    const { action, nextStatus, skippedStatuses } = transition;
    const cumulativeSkippedStatuses = mergeSkippedStatuses(app.skipped_statuses, skippedStatuses, action);
    if (previousStatus === nextStatus) {
      return {
        applicationId,
        previousStatus,
        status: nextStatus,
        action,
        skippedStatuses,
        eventId: null,
        changed: false,
      };
    }

    // candidate_note is candidate-facing — mirror it onto the (candidate-readable)
    // application doc so My Applications can show it. The `reason` field is
    // employer-internal and is written ONLY to the deny-all audit event below.
    tx.update(appRef, {
      status: nextStatus,
      last_status_note: candidateNote || null,
      last_status_action: action,
      skipped_statuses: cumulativeSkippedStatuses,
      last_status_at: FieldValue.serverTimestamp(),
    });
    tx.create(eventRef, {
      application_id: applicationId,
      job_id: jobId,
      candidate_id: candidateId,
      employer_id: uid,
      from_status: previousStatus,
      to_status: nextStatus,
      action,
      skipped_statuses: skippedStatuses,
      actor_id: uid,
      actor_role: "employer",
      reason: reason || null,
      candidate_note: candidateNote || null,
      created_at: FieldValue.serverTimestamp(),
    });

    return {
      applicationId,
      previousStatus,
      status: nextStatus,
      action,
      skippedStatuses,
      eventId: eventRef.id,
      changed: true,
    };
  });
}
