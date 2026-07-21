/**
 * sourcingOutreach — consent-gated unlock flow for Discover Talent.
 *
 * discoverTalent intentionally returns only safe, non-contact candidate signals.
 * This handler is the controlled bridge for BOSS/LinkedIn-style sourcing:
 *   - employers/agencies may request contact with a candidate, optionally tied to
 *     one of their jobs.
 *   - candidates may accept, decline, or later revoke the request.
 *   - acceptance freezes a scoped packet for 30 days; no live profile is read by
 *     the employer and access fails after revocation or expiry.
 *
 * Firestore rules let the two parties read their own outreach record, but all
 * writes are server-only through these callables.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { requireAuth } from "../middleware/auth";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const OUTREACH_STATUSES = new Set(["requested", "accepted", "declined", "cancelled", "revoked"]);
const RESPONSE_ACTIONS = new Set(["accept", "decline", "revoke"]);
const MAX_MESSAGE = 2000;
const MAX_NOTE = 1000;
const SOURCING_PACKETS_COLLECTION = "sourcing_candidate_packets";
const SOURCING_PAIR_GUARDS_COLLECTION = "sourcing_outreach_pair_guards";
const SOURCING_DAILY_QUOTAS_COLLECTION = "sourcing_outreach_daily_quotas";
export const SOURCING_PACKET_ACCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SOURCING_PENDING_REQUEST_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const SOURCING_REQUEST_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const SOURCING_QUOTA_RETENTION_MS = 8 * 24 * 60 * 60 * 1000;

/**
 * UTC-day request caps. Unverified organizations get a deliberately small
 * allowance; verified organizations get a conservative recruiting-workflow
 * allowance. Duplicate calls never consume another slot.
 */
export const SOURCING_DAILY_REQUEST_LIMITS = Object.freeze({
  verified: 30,
  unverified: 5,
});

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

function outreachIdFor(employerId: string, candidateId: string, jobId: string): string {
  return [employerId, candidateId, jobId || "general"].map((part) => encodeURIComponent(part)).join("__");
}

function pairGuardIdFor(employerId: string, candidateId: string): string {
  return [employerId, candidateId].map((part) => encodeURIComponent(part)).join("__");
}

function utcDayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function dailyQuotaIdFor(employerId: string, nowMs: number): string {
  return `${encodeURIComponent(employerId)}__${utcDayKey(nowMs)}`;
}

function timestampMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object") return 0;
  const timestamp = value as { toMillis?: unknown; toDate?: unknown };
  if (typeof timestamp.toMillis === "function") {
    const millis = (timestamp.toMillis as () => number)();
    return Number.isFinite(millis) ? millis : 0;
  }
  if (typeof timestamp.toDate === "function") {
    const millis = (timestamp.toDate as () => Date)().getTime();
    return Number.isFinite(millis) ? millis : 0;
  }
  return 0;
}

async function loadBusinessUser(uid: string): Promise<Record<string, unknown>> {
  const snap = await db.collection("users").doc(uid).get();
  const data = snap.data() ?? {};
  const role = typeof data.role === "string" ? data.role : "";
  if (role !== "employer" && role !== "agency") {
    throw new HttpsError("permission-denied", "Sourcing outreach is available to business accounts only.");
  }
  return data;
}

async function loadDiscoverableCandidate(candidateId: string): Promise<Record<string, unknown>> {
  if (!candidateId) throw new HttpsError("invalid-argument", "candidateId is required.");
  const [snap, profileSnap] = await db.getAll(
    db.collection("users").doc(candidateId),
    db.collection("talent_profiles").doc(candidateId),
  );
  if (!snap.exists) throw new HttpsError("not-found", "Candidate not found.");
  const data = snap.data() ?? {};
  if (data.role !== "candidate") {
    throw new HttpsError("failed-precondition", "Sourcing outreach can only target candidate accounts.");
  }
  if (!profileSnap.exists || profileSnap.get("discoverable") !== true) {
    throw new HttpsError("failed-precondition", "This candidate is not currently open to employer discovery.");
  }
  return data;
}

async function loadOwnedJob(uid: string, jobId: string): Promise<Record<string, unknown> | undefined> {
  if (!jobId) return undefined;
  const snap = await db.collection("job_postings").doc(jobId).get();
  if (!snap.exists) throw new HttpsError("not-found", "Job not found.");
  const data = snap.data() ?? {};
  if (data.employer_id !== uid) {
    throw new HttpsError("permission-denied", "You can only source candidates for your own jobs.");
  }
  if (data.is_active !== true) {
    throw new HttpsError("failed-precondition", "Sourcing outreach requires an active job posting.");
  }
  return data;
}

function pickString(data: Record<string, unknown>, keys: string[], max: number): string {
  for (const key of keys) {
    const value = str(data[key], max);
    if (value) return value;
  }
  return "";
}

function candidatePacket(candidateId: string, user: Record<string, unknown>) {
  return {
    id: candidateId,
    full_name: pickString(user, ["full_name", "name", "display_name"], 200),
    email: pickString(user, ["email"], 320),
    phone: pickString(user, ["phone", "phone_number"], 80),
    location: pickString(user, ["location", "city"], 160),
    headline: pickString(user, ["headline", "target_role", "desired_role"], 240),
    website: pickString(user, ["personal_website", "website", "portfolio_url"], 500),
    linkedin: pickString(user, ["linkedin", "linkedin_url"], 500),
    github: pickString(user, ["github", "github_url"], 500),
    resume_text: pickString(user, ["resume_text"], 80_000),
    // The current packet UI renders contact details and the candidate's resume.
    // Do not copy the raw talent profile: it can contain references and other
    // third-party details that were not needed for this consented workflow.
    talent_profile: null,
  };
}

type SourcingCandidatePacket = ReturnType<typeof candidatePacket>;

function sanitizeStoredCandidatePacket(value: unknown): SourcingCandidatePacket {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    id: pickString(raw, ["id"], 200),
    full_name: pickString(raw, ["full_name"], 200),
    email: pickString(raw, ["email"], 320),
    phone: pickString(raw, ["phone"], 80),
    location: pickString(raw, ["location"], 160),
    headline: pickString(raw, ["headline"], 240),
    website: pickString(raw, ["website"], 500),
    linkedin: pickString(raw, ["linkedin"], 500),
    github: pickString(raw, ["github"], 500),
    resume_text: pickString(raw, ["resume_text"], 80_000),
    // Legacy packets may contain a copied raw profile. Never return it: the raw
    // document can include references and other third-party details.
    talent_profile: null,
  };
}

export function hasActiveSourcingPacketAccess(
  outreach: Record<string, unknown>,
  nowMs = Date.now(),
): boolean {
  const expiresAtMs = Number(outreach.packet_expires_at_ms);
  return outreach.status === "accepted" && Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
}

interface PairOutreachState {
  id: string;
  status: string;
  data: Record<string, unknown>;
}

async function loadLegacyPairState(
  tx: admin.firestore.Transaction,
  employerId: string,
  candidateId: string,
  nowMs: number,
): Promise<{
  pending?: PairOutreachState;
  activeAccepted?: PairOutreachState;
  cooldownUntilMs: number;
}> {
  const pairQuery = db.collection("sourcing_outreach")
    .where("employer_id", "==", employerId)
    .where("candidate_id", "==", candidateId);
  const pendingSnap = await tx.get(
    pairQuery.where("status", "==", "requested").orderBy("created_at", "desc").limit(100),
  );
  const acceptedSnap = await tx.get(
    pairQuery.where("status", "==", "accepted").orderBy("packet_expires_at_ms", "desc").limit(1),
  );
  const terminalSnap = await tx.get(
    pairQuery
      .where("status", "in", ["declined", "cancelled", "revoked"])
      .orderBy("updated_at", "desc")
      .limit(1),
  );

  const pendingDoc = pendingSnap.docs.find((doc) => {
    const expiresAtMs = Number(doc.get("request_expires_at_ms")) || 0;
    return expiresAtMs === 0 || expiresAtMs > nowMs;
  });
  const acceptedDoc = acceptedSnap.docs[0];
  const terminalDoc = terminalSnap.docs[0];
  const acceptedData = acceptedDoc?.data() ?? {};
  const acceptedExpiryMs = Number(acceptedData.packet_expires_at_ms);
  const acceptedCooldownMs = Number.isFinite(acceptedExpiryMs)
    ? acceptedExpiryMs + SOURCING_REQUEST_COOLDOWN_MS
    : 0;
  const terminalData = terminalDoc?.data() ?? {};
  const terminalCooldownMs = Math.max(
    Number(terminalData.cooldown_until_ms) || 0,
    timestampMs(terminalData.updated_at) + SOURCING_REQUEST_COOLDOWN_MS,
  );

  return {
    pending: pendingDoc ? { id: pendingDoc.id, status: "requested", data: pendingDoc.data() } : undefined,
    activeAccepted: acceptedDoc && acceptedExpiryMs > nowMs
      ? { id: acceptedDoc.id, status: "accepted", data: acceptedData }
      : undefined,
    cooldownUntilMs: Math.max(acceptedCooldownMs, terminalCooldownMs),
  };
}

export async function createSourcingOutreachImpl(uid: string, data: Record<string, unknown>) {
  await loadBusinessUser(uid);
  const candidateId = str(data.candidateId, 200);
  if (candidateId === uid) throw new HttpsError("invalid-argument", "You cannot source your own account.");
  await loadDiscoverableCandidate(candidateId);

  const message = str(data.message, MAX_MESSAGE);
  if (!message) throw new HttpsError("invalid-argument", "Outreach message is required.");
  const jobId = str(data.jobId, 200);
  await loadOwnedJob(uid, jobId);

  const ref = db.collection("sourcing_outreach").doc(outreachIdFor(uid, candidateId, jobId));
  const guardRef = db.collection(SOURCING_PAIR_GUARDS_COLLECTION).doc(pairGuardIdFor(uid, candidateId));
  const businessRef = db.collection("users").doc(uid);
  const candidateRef = db.collection("users").doc(candidateId);
  const profileRef = db.collection("talent_profiles").doc(candidateId);
  return db.runTransaction(async (tx) => {
    const nowMs = Date.now();
    const quotaRef = db.collection(SOURCING_DAILY_QUOTAS_COLLECTION).doc(dailyQuotaIdFor(uid, nowMs));
    const [guardSnap, existing, quotaSnap, businessSnap, candidateSnap, profileSnap] = await tx.getAll(
      guardRef,
      ref,
      quotaRef,
      businessRef,
      candidateRef,
      profileRef,
    );
    const business = businessSnap.data() ?? {};
    if (business.role !== "employer" && business.role !== "agency") {
      throw new HttpsError("permission-denied", "Sourcing outreach is available to business accounts only.");
    }
    if (!candidateSnap.exists || candidateSnap.get("role") !== "candidate") {
      throw new HttpsError("failed-precondition", "Sourcing outreach can only target candidate accounts.");
    }
    if (!profileSnap.exists || profileSnap.get("discoverable") !== true) {
      throw new HttpsError("failed-precondition", "This candidate is not currently open to employer discovery.");
    }

    let job: Record<string, unknown> | undefined;
    if (jobId) {
      const jobSnap = await tx.get(db.collection("job_postings").doc(jobId));
      if (!jobSnap.exists) throw new HttpsError("not-found", "Job not found.");
      job = jobSnap.data() ?? {};
      if (job.employer_id !== uid) {
        throw new HttpsError("permission-denied", "You can only source candidates for your own jobs.");
      }
      if (job.is_active !== true) {
        throw new HttpsError("failed-precondition", "Sourcing outreach requires an active job posting.");
      }
    }

    const guard = guardSnap.data() ?? {};
    const guardedStatus = str(guard.status, 40);
    const guardedOutreachId = str(guard.outreach_id, 300);
    const guardedOutreachSnap = guardSnap.exists && guardedOutreachId
      ? guardedOutreachId === ref.id
        ? existing
        : await tx.get(db.collection("sourcing_outreach").doc(guardedOutreachId))
      : undefined;
    const guardedOutreach = guardedOutreachSnap?.data() ?? {};
    const guardReferencesPair = Boolean(
      guardedOutreachSnap?.exists
      && guardedOutreach.employer_id === uid
      && guardedOutreach.candidate_id === candidateId,
    );
    const guardedSourceStatus = guardReferencesPair ? str(guardedOutreach.status, 40) : "";
    const guardedRequestExpiresAtMs = Number(guardedOutreach.request_expires_at_ms) || 0;
    const guardedPendingIsActive = guardedSourceStatus === "requested"
      && (guardedRequestExpiresAtMs === 0 || guardedRequestExpiresAtMs > nowMs);
    if (guardedPendingIsActive && guardedOutreachId) {
      return { outreachId: guardedOutreachId, status: "requested", duplicate: true };
    }
    if (guardedOutreachId && hasActiveSourcingPacketAccess(guardedOutreach, nowMs)) {
      return { outreachId: guardedOutreachId, status: "accepted", duplicate: true };
    }
    // The guard is a serialization aid, not the consent authority. A packet can
    // be shortened or revoked on the outreach record after the guard was
    // written, so derive active/cooldown state from the referenced outreach.
    // Only fall back to the guard's cooldown when its source record no longer
    // exists (for example after TTL cleanup).
    const guardedCooldownUntilMs = guardReferencesPair
      ? Math.max(
        Number(guardedOutreach.cooldown_until_ms) || 0,
        guardedSourceStatus === "accepted"
          ? (Number(guardedOutreach.packet_expires_at_ms) || 0) + SOURCING_REQUEST_COOLDOWN_MS
          : guardedSourceStatus === "requested" && guardedRequestExpiresAtMs > 0
            ? guardedRequestExpiresAtMs + SOURCING_REQUEST_COOLDOWN_MS
            : timestampMs(guardedOutreach.updated_at)
              + (OUTREACH_STATUSES.has(guardedSourceStatus) ? SOURCING_REQUEST_COOLDOWN_MS : 0),
      )
      : guardSnap.exists && OUTREACH_STATUSES.has(guardedStatus)
        ? Number(guard.cooldown_until_ms) || 0
        : 0;

    let legacy: Awaited<ReturnType<typeof loadLegacyPairState>> = { cooldownUntilMs: 0 };
    if (!guardSnap.exists) {
      legacy = await loadLegacyPairState(tx, uid, candidateId, nowMs);
    }
    if (legacy.pending) {
      tx.set(guardRef, {
        employer_id: uid,
        candidate_id: candidateId,
        outreach_id: legacy.pending.id,
        status: "requested",
        active_until_ms: 0,
        cooldown_until_ms: 0,
        updated_at: FieldValue.serverTimestamp(),
      });
      return { outreachId: legacy.pending.id, status: "requested", duplicate: true };
    }
    if (legacy.activeAccepted) {
      const activeUntilMs = Number(legacy.activeAccepted.data.packet_expires_at_ms) || 0;
      tx.set(guardRef, {
        employer_id: uid,
        candidate_id: candidateId,
        outreach_id: legacy.activeAccepted.id,
        status: "accepted",
        active_until_ms: activeUntilMs,
        cooldown_until_ms: activeUntilMs + SOURCING_REQUEST_COOLDOWN_MS,
        updated_at: FieldValue.serverTimestamp(),
      });
      return { outreachId: legacy.activeAccepted.id, status: "accepted", duplicate: true };
    }

    const status = existing.exists ? str(existing.data()?.status, 40) : "";

    const existingData = existing.data() ?? {};
    const existingRequestExpiresAtMs = Number(existingData.request_expires_at_ms) || 0;
    const existingPendingIsActive = status === "requested"
      && (existingRequestExpiresAtMs === 0 || existingRequestExpiresAtMs > nowMs);
    if (existingPendingIsActive || (status === "accepted" && hasActiveSourcingPacketAccess(existingData))) {
      tx.set(guardRef, {
        employer_id: uid,
        candidate_id: candidateId,
        outreach_id: ref.id,
        status,
        active_until_ms: status === "accepted"
          ? Number(existingData.packet_expires_at_ms) || 0
          : existingRequestExpiresAtMs,
        cooldown_until_ms: status === "accepted"
          ? (Number(existingData.packet_expires_at_ms) || 0) + SOURCING_REQUEST_COOLDOWN_MS
          : existingRequestExpiresAtMs > 0
            ? existingRequestExpiresAtMs + SOURCING_REQUEST_COOLDOWN_MS
            : 0,
        updated_at: FieldValue.serverTimestamp(),
      });
      return { outreachId: ref.id, status, duplicate: true };
    }
    if (status && !OUTREACH_STATUSES.has(status)) {
      throw new HttpsError("failed-precondition", "Existing outreach record has an invalid status.");
    }

    const existingCooldownUntilMs = Math.max(
      Number(existingData.cooldown_until_ms) || 0,
      status === "accepted"
        ? (Number(existingData.packet_expires_at_ms) || 0) + SOURCING_REQUEST_COOLDOWN_MS
        : status === "requested" && existingRequestExpiresAtMs > 0
          ? existingRequestExpiresAtMs + SOURCING_REQUEST_COOLDOWN_MS
        : timestampMs(existingData.updated_at) + (status ? SOURCING_REQUEST_COOLDOWN_MS : 0),
    );
    const cooldownUntilMs = Math.max(
      guardedCooldownUntilMs,
      legacy.cooldownUntilMs,
      existingCooldownUntilMs,
    );
    if (cooldownUntilMs > nowMs) {
      throw new HttpsError(
        "resource-exhausted",
        "A new request to this candidate is unavailable during the seven-day cooldown.",
      );
    }

    const verifiedOrganization = business.organization_verified === true;
    const dailyLimit = verifiedOrganization
      ? SOURCING_DAILY_REQUEST_LIMITS.verified
      : SOURCING_DAILY_REQUEST_LIMITS.unverified;
    const currentDailyCount = Math.max(0, Math.trunc(Number(quotaSnap.get("count")) || 0));
    if (currentDailyCount >= dailyLimit) {
      throw new HttpsError(
        "resource-exhausted",
        `Daily sourcing outreach limit reached (${dailyLimit} requests per UTC day).`,
      );
    }

    // A revoked or expired packet is no longer needed. Delete it in the same
    // transaction before reopening the deterministic request id so stale PII
    // cannot survive into a later consent cycle.
    if (existing.exists) {
      tx.delete(db.collection(SOURCING_PACKETS_COLLECTION).doc(ref.id));
    }
    const requestExpiresAtMs = nowMs + SOURCING_PENDING_REQUEST_TTL_MS;
    tx.set(ref, {
      employer_id: uid,
      candidate_id: candidateId,
      job_id: jobId,
      job_title: pickString(job ?? {}, ["title"], 240),
      company_name: pickString(job ?? business, ["company_name", "company"], 240),
      message,
      status: "requested",
      request_source: str(data.requestSource, 80) || "discover_talent",
      organization_verification: verifiedOrganization ? "verified" : "unverified_self_reported",
      previous_status: status || "",
      created_at: FieldValue.serverTimestamp(),
      created_at_ms: nowMs,
      request_expires_at: Timestamp.fromMillis(requestExpiresAtMs),
      request_expires_at_ms: requestExpiresAtMs,
      expires_at: Timestamp.fromMillis(requestExpiresAtMs),
      updated_at: FieldValue.serverTimestamp(),
      updated_at_ms: nowMs,
    });
    tx.set(guardRef, {
      employer_id: uid,
      candidate_id: candidateId,
      outreach_id: ref.id,
      status: "requested",
      active_until_ms: requestExpiresAtMs,
      cooldown_until_ms: requestExpiresAtMs + SOURCING_REQUEST_COOLDOWN_MS,
      updated_at: FieldValue.serverTimestamp(),
      updated_at_ms: nowMs,
    });
    tx.set(quotaRef, {
      employer_id: uid,
      day_key: utcDayKey(nowMs),
      count: currentDailyCount + 1,
      limit: dailyLimit,
      organization_verification: verifiedOrganization ? "verified" : "unverified_self_reported",
      updated_at: FieldValue.serverTimestamp(),
      expires_at: Timestamp.fromMillis(nowMs + SOURCING_QUOTA_RETENTION_MS),
    }, { merge: true });

    return { outreachId: ref.id, status: "requested", duplicate: false };
  });
}

export async function respondSourcingOutreachImpl(uid: string, data: Record<string, unknown>) {
  const outreachId = str(data.outreachId, 300);
  if (!outreachId) throw new HttpsError("invalid-argument", "outreachId is required.");
  const action = str(data.action, 20);
  if (!RESPONSE_ACTIONS.has(action)) {
    throw new HttpsError("invalid-argument", "action must be accept, decline, or revoke.");
  }
  const status = action === "accept" ? "accepted" : action === "revoke" ? "revoked" : "declined";
  const ref = db.collection("sourcing_outreach").doc(outreachId);
  await db.runTransaction(async (tx) => {
    const nowMs = Date.now();
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Outreach request not found.");
    const outreach = snap.data() ?? {};
    if (outreach.candidate_id !== uid) {
      throw new HttpsError("permission-denied", "Only the requested candidate can respond.");
    }
    const employerId = str(outreach.employer_id, 200);
    const candidateId = str(outreach.candidate_id, 200);
    if (!candidateId || !employerId) {
      throw new HttpsError("failed-precondition", "Outreach request is missing participant references.");
    }
    const guardRef = db.collection(SOURCING_PAIR_GUARDS_COLLECTION).doc(pairGuardIdFor(employerId, candidateId));
    const guardSnap = await tx.get(guardRef);
    const guard = guardSnap.data() ?? {};
    const guardOutreachId = str(guard.outreach_id, 300);
    const guardHasOtherActiveRequest = guardSnap.exists
      && guardOutreachId
      && guardOutreachId !== outreachId
      && (
        guard.status === "requested"
        || (guard.status === "accepted" && Number(guard.active_until_ms) > nowMs)
      );
    if (action === "revoke") {
      if (outreach.status !== "accepted") {
        throw new HttpsError("failed-precondition", "Only an accepted outreach request can be revoked.");
      }
      tx.update(ref, {
        status: "revoked",
        candidate_response_note: str(data.note, MAX_NOTE),
        revoked_at: FieldValue.serverTimestamp(),
        packet_expires_at: FieldValue.delete(),
        packet_expires_at_ms: FieldValue.delete(),
        cooldown_until_ms: nowMs + SOURCING_REQUEST_COOLDOWN_MS,
        updated_at: FieldValue.serverTimestamp(),
        updated_at_ms: nowMs,
      });
      if (!guardHasOtherActiveRequest) {
        tx.set(guardRef, {
          employer_id: employerId,
          candidate_id: candidateId,
          outreach_id: outreachId,
          status: "revoked",
          active_until_ms: 0,
          cooldown_until_ms: nowMs + SOURCING_REQUEST_COOLDOWN_MS,
          updated_at: FieldValue.serverTimestamp(),
          updated_at_ms: nowMs,
        });
      }
      tx.delete(db.collection(SOURCING_PACKETS_COLLECTION).doc(outreachId));
      return;
    }
    if (outreach.status !== "requested") {
      throw new HttpsError("failed-precondition", "This outreach request is no longer pending.");
    }
    const requestExpiresAtMs = Number(outreach.request_expires_at_ms) || 0;
    if (requestExpiresAtMs > 0 && requestExpiresAtMs <= nowMs) {
      throw new HttpsError("failed-precondition", "This outreach request has expired.");
    }

    if (action === "accept") {
      if (guardHasOtherActiveRequest) {
        throw new HttpsError("failed-precondition", "Another outreach request is already active for this organization.");
      }
      const packetRef = db.collection(SOURCING_PACKETS_COLLECTION).doc(outreachId);
      const userSnap = await tx.get(db.collection("users").doc(candidateId));
      if (!userSnap.exists) throw new HttpsError("not-found", "Candidate not found.");
      const expiresAtMs = nowMs + SOURCING_PACKET_ACCESS_TTL_MS;
      tx.set(packetRef, {
        outreach_id: outreachId,
        employer_id: employerId,
        candidate_id: candidateId,
        candidate: candidatePacket(candidateId, userSnap.data() ?? {}),
        created_at: FieldValue.serverTimestamp(),
        expires_at: Timestamp.fromMillis(expiresAtMs),
        expires_at_ms: expiresAtMs,
      });
      tx.update(ref, {
        status: "accepted",
        candidate_response_note: str(data.note, MAX_NOTE),
        responded_at: FieldValue.serverTimestamp(),
        packet_expires_at: Timestamp.fromMillis(expiresAtMs),
        packet_expires_at_ms: expiresAtMs,
        request_expires_at: FieldValue.delete(),
        request_expires_at_ms: FieldValue.delete(),
        expires_at: FieldValue.delete(),
        cooldown_until_ms: expiresAtMs + SOURCING_REQUEST_COOLDOWN_MS,
        updated_at: FieldValue.serverTimestamp(),
        updated_at_ms: nowMs,
      });
      tx.set(guardRef, {
        employer_id: employerId,
        candidate_id: candidateId,
        outreach_id: outreachId,
        status: "accepted",
        active_until_ms: expiresAtMs,
        cooldown_until_ms: expiresAtMs + SOURCING_REQUEST_COOLDOWN_MS,
        updated_at: FieldValue.serverTimestamp(),
        updated_at_ms: nowMs,
      });
      return;
    }

    const cooldownUntilMs = nowMs + SOURCING_REQUEST_COOLDOWN_MS;
    tx.update(ref, {
      status,
      candidate_response_note: str(data.note, MAX_NOTE),
      responded_at: FieldValue.serverTimestamp(),
      request_expires_at: FieldValue.delete(),
      request_expires_at_ms: FieldValue.delete(),
      expires_at: FieldValue.delete(),
      cooldown_until_ms: cooldownUntilMs,
      updated_at: FieldValue.serverTimestamp(),
      updated_at_ms: nowMs,
    });
    if (!guardHasOtherActiveRequest) {
      tx.set(guardRef, {
        employer_id: employerId,
        candidate_id: candidateId,
        outreach_id: outreachId,
        status,
        active_until_ms: 0,
        cooldown_until_ms: cooldownUntilMs,
        updated_at: FieldValue.serverTimestamp(),
        updated_at_ms: nowMs,
      });
    }
  });
  return { outreachId, status };
}

export async function cancelSourcingOutreachImpl(uid: string, data: Record<string, unknown>) {
  const outreachId = str(data.outreachId, 300);
  if (!outreachId) throw new HttpsError("invalid-argument", "outreachId is required.");
  const ref = db.collection("sourcing_outreach").doc(outreachId);
  await db.runTransaction(async (tx) => {
    const nowMs = Date.now();
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Outreach request not found.");
    const outreach = snap.data() ?? {};
    if (outreach.employer_id !== uid) {
      throw new HttpsError("permission-denied", "Only the requesting employer can cancel.");
    }
    if (outreach.status !== "requested") {
      throw new HttpsError("failed-precondition", "Only pending outreach requests can be cancelled.");
    }
    const employerId = str(outreach.employer_id, 200);
    const candidateId = str(outreach.candidate_id, 200);
    if (!candidateId || !employerId) {
      throw new HttpsError("failed-precondition", "Outreach request is missing participant references.");
    }
    const guardRef = db.collection(SOURCING_PAIR_GUARDS_COLLECTION).doc(pairGuardIdFor(employerId, candidateId));
    const guardSnap = await tx.get(guardRef);
    const guard = guardSnap.data() ?? {};
    const guardOutreachId = str(guard.outreach_id, 300);
    const guardHasOtherActiveRequest = guardSnap.exists
      && guardOutreachId
      && guardOutreachId !== outreachId
      && (
        guard.status === "requested"
        || (guard.status === "accepted" && Number(guard.active_until_ms) > nowMs)
      );
    const cooldownUntilMs = nowMs + SOURCING_REQUEST_COOLDOWN_MS;
    tx.update(ref, {
      status: "cancelled",
      cancellation_note: str(data.note, MAX_NOTE),
      request_expires_at: FieldValue.delete(),
      request_expires_at_ms: FieldValue.delete(),
      expires_at: FieldValue.delete(),
      cooldown_until_ms: cooldownUntilMs,
      updated_at: FieldValue.serverTimestamp(),
      updated_at_ms: nowMs,
    });
    if (!guardHasOtherActiveRequest) {
      tx.set(guardRef, {
        employer_id: employerId,
        candidate_id: candidateId,
        outreach_id: outreachId,
        status: "cancelled",
        active_until_ms: 0,
        cooldown_until_ms: cooldownUntilMs,
        updated_at: FieldValue.serverTimestamp(),
        updated_at_ms: nowMs,
      });
    }
  });
  return { outreachId, status: "cancelled" };
}

export async function getSourcingCandidatePacketImpl(uid: string, data: Record<string, unknown>) {
  const outreachId = str(data.outreachId, 300);
  if (!outreachId) throw new HttpsError("invalid-argument", "outreachId is required.");
  return db.runTransaction(async (tx) => {
    const nowMs = Date.now();
    const outreachRef = db.collection("sourcing_outreach").doc(outreachId);
    const packetRef = db.collection(SOURCING_PACKETS_COLLECTION).doc(outreachId);
    const [snap, packetSnap] = await tx.getAll(outreachRef, packetRef);
    if (!snap.exists) throw new HttpsError("not-found", "Outreach request not found.");
    const outreach = snap.data() ?? {};
    if (outreach.employer_id !== uid) {
      throw new HttpsError("permission-denied", "Only the requesting employer can unlock this packet.");
    }
    if (!hasActiveSourcingPacketAccess(outreach, nowMs)) {
      throw new HttpsError("failed-precondition", "Candidate packet access is not active or has expired.");
    }
    if (!packetSnap.exists) throw new HttpsError("failed-precondition", "Accepted candidate packet is unavailable.");
    const packet = packetSnap.data() ?? {};
    if (packet.employer_id !== uid || packet.outreach_id !== outreachId) {
      throw new HttpsError("permission-denied", "Candidate packet ownership does not match this request.");
    }
    const packetExpiresAtMs = Number(packet.expires_at_ms);
    if (!Number.isFinite(packetExpiresAtMs) || packetExpiresAtMs <= nowMs) {
      throw new HttpsError("failed-precondition", "Candidate packet access has expired.");
    }
    if (!packet.candidate || typeof packet.candidate !== "object" || Array.isArray(packet.candidate)) {
      throw new HttpsError("failed-precondition", "Accepted candidate packet is malformed.");
    }
    const candidate = sanitizeStoredCandidatePacket(packet.candidate);

    return {
      outreachId,
      status: "accepted",
      expires_at_ms: Math.min(Number(outreach.packet_expires_at_ms), packetExpiresAtMs),
      candidate,
    };
  });
}

export const createSourcingOutreachFunction = onCall({ invoker: "public" }, (request) =>
  createSourcingOutreachImpl(requireAuth(request), request.data ?? {}));

export const respondSourcingOutreachFunction = onCall({ invoker: "public" }, (request) =>
  respondSourcingOutreachImpl(requireAuth(request), request.data ?? {}));

export const cancelSourcingOutreachFunction = onCall({ invoker: "public" }, (request) =>
  cancelSourcingOutreachImpl(requireAuth(request), request.data ?? {}));

export const getSourcingCandidatePacketFunction = onCall({ invoker: "public" }, (request) =>
  getSourcingCandidatePacketImpl(requireAuth(request), request.data ?? {}));
