/**
 * jobPostings — server-only job-posting lifecycle (create / update / close+reopen).
 *
 * Direct client writes to job_postings are forbidden by firestore.rules; every
 * mutation goes through these Admin-SDK callables so the platform can enforce the
 * trust contract a hiring marketplace needs:
 *   - role gate: only employer/agency accounts may post (candidates cannot).
 *   - entitlement: per-plan ACTIVE-job cap (rules can't count; this is why it must
 *     be a callable). Admins bypass.
 *   - identity: company_* fields are read from the employer's authoritative user
 *     doc, NOT the request — a client cannot forge the company on a posting.
 *   - audit: every create/update/close/reopen writes a job_posting_events doc.
 *
 * Region/timeout inherited from setGlobalOptions() in index.ts.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, isAdminUid } from "../middleware/auth";
import { ensurePlatformCaches, getActiveJobLimit } from "../config/env";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();
const ACTIVE_JOB_COUNTERS_COLLECTION = "active_job_counters";

const POSTER_ROLES = new Set(["employer", "agency"]);

interface Poster {
  role: string;
  subscription_status: string;
  company_name: string | null;
  organization_verified: boolean;
  company_size: string | null;
  industry: string | null;
  founded_year: string | null;
  company_logo_url: string | null;
  company_website: string | null;
}

// Enum option sets — MIRROR of constants/jobPostingFields.ts (repo-root modules
// aren't bundled into the deployed functions). Keep the two in sync.
const WORK_MODES = new Set(["remote", "hybrid", "onsite"]);
const EMPLOYMENT_TYPES = new Set(["full_time", "part_time", "internship", "contract", "co_op"]);
const EXPERIENCE_LEVELS = new Set(["internship", "entry", "junior", "mid", "senior"]);

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strOrNull = (v: unknown, max: number): string | null => { const s = str(v, max); return s || null; };

function reqStr(input: Record<string, unknown>, key: string, label: string, max: number): string {
  const s = str(input[key], max);
  if (!s) throw new HttpsError("invalid-argument", `${label} is required.`);
  return s;
}

function reqEnum(input: Record<string, unknown>, key: string, set: Set<string>, label: string): string {
  const v = typeof input[key] === "string" ? (input[key] as string) : "";
  if (!set.has(v)) throw new HttpsError("invalid-argument", `${label} is required.`);
  return v;
}

function strArray(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") continue;
    const s = item.trim().slice(0, maxLen);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

// Indeed/LinkedIn-style screener questions. Server-assigns stable ids and caps the
// count. `expected` is a SCREENING SIGNAL only (shown as met/gap in the employer
// packet) — it NEVER auto-rejects an applicant.
const SCREENER_TYPES = new Set(["yes_no", "short_text"]);
function screenerQuestions(
  v: unknown,
): { id: string; prompt: string; type: string; required: boolean; expected: string | null }[] {
  if (!Array.isArray(v)) return [];
  const out: { id: string; prompt: string; type: string; required: boolean; expected: string | null }[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const q = item as Record<string, unknown>;
    const prompt = str(q.prompt, 300);
    if (!prompt) continue;
    const type = typeof q.type === "string" && SCREENER_TYPES.has(q.type) ? q.type : "short_text";
    const expectedRaw = typeof q.expected === "string" ? q.expected : "";
    const expected = type === "yes_no" && (expectedRaw === "yes" || expectedRaw === "no") ? expectedRaw : null;
    out.push({ id: `q${out.length + 1}`, prompt, type, required: q.required === true, expected });
    if (out.length >= 8) break;
  }
  return out;
}

async function loadPoster(uid: string): Promise<Poster> {
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) throw new HttpsError("not-found", "We could not load your profile. Please sign out and back in.");
  const d = snap.data() ?? {};
  return {
    role: typeof d.role === "string" ? d.role : "",
    subscription_status: typeof d.subscription_status === "string" ? d.subscription_status : "free",
    company_name: typeof d.company_name === "string" ? d.company_name : null,
    organization_verified: d.organization_verified === true,
    company_size: typeof d.company_size === "string" ? d.company_size : null,
    industry: typeof d.industry === "string" ? d.industry : null,
    founded_year: typeof d.founded_year === "string" ? d.founded_year : null,
    company_logo_url: typeof d.company_logo_url === "string" ? d.company_logo_url : null,
    company_website: typeof d.company_website === "string" ? d.company_website : null,
  };
}

function assertPoster(role: string): void {
  if (!POSTER_ROLES.has(role)) {
    throw new HttpsError("permission-denied", "Only employer accounts can post jobs.");
  }
}

async function limitFor(sub: string): Promise<number> {
  await ensurePlatformCaches();
  return getActiveJobLimit(sub);
}

function assertWithinLimit(active: number, limit: number, adminOverride: boolean): void {
  if (adminOverride) return;
  if (active >= limit) {
    throw new HttpsError(
      "failed-precondition",
      `Your plan allows ${limit} active job post${limit === 1 ? "" : "s"}. Close one or upgrade to add more.`,
    );
  }
}

async function activeJobCountInTransaction(
  tx: admin.firestore.Transaction,
  uid: string,
): Promise<{ count: number; counterRef: admin.firestore.DocumentReference }> {
  const counterRef = db.collection(ACTIVE_JOB_COUNTERS_COLLECTION).doc(uid);
  const counterSnap = await tx.get(counterRef);
  if (counterSnap.exists) {
    const count = Number(counterSnap.get("active_count") ?? 0);
    return { count: Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0, counterRef };
  }

  // One-time migration path for employers with pre-counter postings. Because
  // the missing counter document is read and then written in this transaction,
  // concurrent first-use requests contend on the same document and retry.
  const active = await tx.get(
    db.collection("job_postings")
      .where("employer_id", "==", uid)
      .where("is_active", "==", true),
  );
  return { count: active.size, counterRef };
}

function writeActiveJobCount(
  tx: admin.firestore.Transaction,
  counterRef: admin.firestore.DocumentReference,
  uid: string,
  count: number,
): void {
  tx.set(counterRef, {
    employer_id: uid,
    active_count: Math.max(0, count),
    updated_at: FieldValue.serverTimestamp(),
  }, { merge: true });
}

function writeEvent(
  tx: admin.firestore.Transaction,
  jobId: string,
  employerId: string,
  action: string,
  reason: string | null,
): void {
  tx.set(db.collection("job_posting_events").doc(), {
    job_id: jobId,
    employer_id: employerId,
    action,
    reason,
    created_at: FieldValue.serverTimestamp(),
  });
}

// Structured content the client may supply. Company identity (company_name /
// size / industry / founded / logo / website / verified) is NEVER read from here
// — it is snapshotted from the employer's authoritative user doc on create.
function buildContent(input: Record<string, unknown>): Record<string, unknown> {
  const required_skills = strArray(input.required_skills, 30, 80);
  if (required_skills.length === 0) {
    throw new HttpsError("invalid-argument", "At least one required skill is needed.");
  }
  const headcountRaw = input.headcount;
  const headcount = typeof headcountRaw === "number" && Number.isFinite(headcountRaw)
    ? Math.min(Math.max(Math.floor(headcountRaw), 1), 9999)
    : 0;
  if (headcount < 1) throw new HttpsError("invalid-argument", "Headcount (at least 1) is required.");

  return {
    // required
    title: reqStr(input, "title", "A job title", 180),
    location: reqStr(input, "location", "Location", 180),
    work_mode: reqEnum(input, "work_mode", WORK_MODES, "Work mode"),
    employment_type: reqEnum(input, "employment_type", EMPLOYMENT_TYPES, "Employment type"),
    experience_level: reqEnum(input, "experience_level", EXPERIENCE_LEVELS, "Experience level"),
    department: reqStr(input, "department", "Department or function", 120),
    description: reqStr(input, "description", "Description", 20000),
    responsibilities: reqStr(input, "responsibilities", "Responsibilities", 8000),
    required_qualifications: reqStr(input, "required_qualifications", "Required qualifications", 8000),
    required_skills,
    application_deadline: reqStr(input, "application_deadline", "Application deadline", 40),
    headcount,
    // optional
    nice_to_have_qualifications: strOrNull(input.nice_to_have_qualifications, 8000),
    preferred_skills: strArray(input.preferred_skills, 30, 80),
    salary_range: strOrNull(input.salary_range, 120),
    visa_sponsorship: input.visa_sponsorship === true,
    relocation: input.relocation === true,
    language_requirement: strOrNull(input.language_requirement, 200),
    interview_process: strOrNull(input.interview_process, 4000),
    campus_new_grad: input.campus_new_grad === true,
    screener_questions: screenerQuestions(input.screener_questions),
  };
}

function jobRef(jobId: string) {
  if (!jobId) throw new HttpsError("invalid-argument", "jobId is required.");
  return db.collection("job_postings").doc(jobId);
}

function assertOwnedJob(uid: string, snap: admin.firestore.DocumentSnapshot): void {
  if (!snap.exists || snap.data()?.employer_id !== uid) {
    throw new HttpsError("permission-denied", "You can only change your own job posts.");
  }
}

// ── Core impls (exported for emulator integration tests) ─────────────────────
// They take the resolved uid + raw data + decoded token; the onCall wrappers
// below are thin (auth extraction only). All trust checks live here.

export async function createJobPostingImpl(uid: string, data: Record<string, unknown>, token?: Record<string, unknown>) {
  const poster = await loadPoster(uid);
  assertPoster(poster.role);
  if (!poster.company_name) {
    throw new HttpsError("failed-precondition", "Add your company name in your profile before posting a job.");
  }
  const content = buildContent((data?.posting ?? data ?? {}) as Record<string, unknown>);
  const adminOverride = await isAdminUid(uid, token);
  const limit = await limitFor(poster.subscription_status);
  const now = FieldValue.serverTimestamp();
  const ref = db.collection("job_postings").doc();
  await db.runTransaction(async (tx) => {
    const active = await activeJobCountInTransaction(tx, uid);
    assertWithinLimit(active.count, limit, adminOverride);
    tx.set(ref, {
      ...content,
      employer_id: uid,
      // Company identity snapshotted from the employer's server profile (never the
      // request) so a client can't forge the company on a posting.
      company_name: poster.company_name,
      organization_verification: poster.organization_verified ? "verified" : "unverified_self_reported",
      company_size: poster.company_size,
      industry: poster.industry,
      founded_year: poster.founded_year,
      company_logo_url: poster.company_logo_url,
      company_website: poster.company_website,
      is_active: true,
      created_at: now,
      updated_at: now,
    });
    writeActiveJobCount(tx, active.counterRef, uid, active.count + 1);
    writeEvent(tx, ref.id, uid, "created", null);
  });
  return { jobId: ref.id };
}

export async function updateJobPostingImpl(uid: string, data: Record<string, unknown>) {
  const poster = await loadPoster(uid);
  assertPoster(poster.role);
  const jobId = String(data?.jobId ?? "");
  const ref = jobRef(jobId);
  const content = buildContent((data?.posting ?? data ?? {}) as Record<string, unknown>);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    assertOwnedJob(uid, snap);
    tx.update(ref, {
      ...content,
      organization_verification: poster.organization_verified ? "verified" : "unverified_self_reported",
      updated_at: FieldValue.serverTimestamp(),
    });
    writeEvent(tx, jobId, uid, "updated", null);
  });
  return { jobId };
}

export async function setJobPostingActiveImpl(uid: string, data: Record<string, unknown>, token?: Record<string, unknown>) {
  const poster = await loadPoster(uid);
  assertPoster(poster.role);
  const jobId = String(data?.jobId ?? "");
  const isActive = data?.isActive === true;
  const reason = typeof data?.reason === "string" ? data.reason.trim().slice(0, 500) : null;
  const ref = jobRef(jobId);
  const adminOverride = await isAdminUid(uid, token);
  const limit = await limitFor(poster.subscription_status);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    assertOwnedJob(uid, snap);
    const wasActive = snap.get("is_active") === true;
    if (wasActive === isActive) return;

    const active = await activeJobCountInTransaction(tx, uid);
    if (isActive) assertWithinLimit(active.count, limit, adminOverride);
    writeActiveJobCount(
      tx,
      active.counterRef,
      uid,
      isActive ? active.count + 1 : active.count - 1,
    );
    tx.update(ref, { is_active: isActive, updated_at: FieldValue.serverTimestamp() });
    writeEvent(tx, jobId, uid, isActive ? "reopened" : "closed", reason);
  });
  return { jobId, isActive };
}

export const createJobPostingFunction = onCall({ invoker: "public" }, (request) =>
  createJobPostingImpl(requireAuth(request), request.data ?? {}, request.auth?.token));

export const updateJobPostingFunction = onCall({ invoker: "public" }, (request) =>
  updateJobPostingImpl(requireAuth(request), request.data ?? {}));

export const setJobPostingActiveFunction = onCall({ invoker: "public" }, (request) =>
  setJobPostingActiveImpl(requireAuth(request), request.data ?? {}, request.auth?.token));
