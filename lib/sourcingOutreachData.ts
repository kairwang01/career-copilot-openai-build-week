/**
 * Client helpers for consent-gated sourcing outreach.
 *
 * Reads use Firestore because rules allow each party to read only their own
 * request status. All writes/unlocks are callables so the client cannot forge
 * acceptance or access candidate PII before consent.
 */
import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { firestoreDb, firebaseFunctions } from './firebaseClient';

export type SourcingOutreachStatus = 'requested' | 'accepted' | 'declined' | 'cancelled' | 'revoked';
export type SourcingOrganizationVerification = 'verified' | 'unverified_self_reported';

export interface SourcingOutreach {
  id: string;
  employer_id: string;
  candidate_id: string;
  job_id: string;
  job_title: string;
  company_name: string;
  message: string;
  status: SourcingOutreachStatus;
  organization_verification: SourcingOrganizationVerification;
  packet_expires_at_ms: number;
  created_at: string;
  updated_at: string;
  responded_at: string;
}

export interface ConsentedCandidatePacket {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  location: string;
  headline: string;
  website: string;
  linkedin: string;
  github: string;
  resume_text: string;
  talent_profile: unknown;
}

const OUTREACH_STATUSES = new Set<SourcingOutreachStatus>([
  'requested',
  'accepted',
  'declined',
  'cancelled',
  'revoked',
]);

const cleanString = (value: unknown, max = 4000): string => (
  typeof value === 'string' ? value.trim().slice(0, max) : ''
);

const toIsoString = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'object' && value !== null && typeof (value as { toDate?: unknown }).toDate === 'function') {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }
  if (typeof value === 'string') return value.trim();
  return '';
};

const cleanStatus = (value: unknown): SourcingOutreachStatus => (
  typeof value === 'string' && OUTREACH_STATUSES.has(value as SourcingOutreachStatus)
    ? value as SourcingOutreachStatus
    : 'requested'
);

const cleanOrganizationVerification = (value: unknown): SourcingOrganizationVerification => (
  value === 'verified' ? 'verified' : 'unverified_self_reported'
);

const cleanTimestampMs = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
};

export const normalizeSourcingOutreach = (id: string, data: DocumentData): SourcingOutreach => ({
  id: cleanString(id, 160),
  employer_id: cleanString(data.employer_id, 160),
  candidate_id: cleanString(data.candidate_id, 160),
  job_id: cleanString(data.job_id, 160),
  job_title: cleanString(data.job_title, 240),
  company_name: cleanString(data.company_name, 240),
  message: cleanString(data.message, 4000),
  // Whitelist-validate so an unexpected stored value can't drive the UI into an
  // undefined status branch (defaults to 'requested').
  status: cleanStatus(data.status),
  // Unknown/missing verification state is displayed as unverified, never as a
  // trusted organization. Legacy accepted rows without an expiry fail closed.
  organization_verification: cleanOrganizationVerification(data.organization_verification),
  packet_expires_at_ms: cleanTimestampMs(data.packet_expires_at_ms),
  created_at: toIsoString(data.created_at),
  updated_at: toIsoString(data.updated_at),
  responded_at: toIsoString(data.responded_at),
});

const byNewest = (a: SourcingOutreach, b: SourcingOutreach) => (
  b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id)
);

// Actionable rows are read independently from the compact history window. This
// prevents a long-lived account's old rows from pushing a pending request or a
// still-revocable acceptance out of the inbox. Both query classes remain
// explicitly bounded; server-side pair guards and sender quotas keep the normal
// actionable set far below this defensive ceiling.
export const SOURCING_ACTIONABLE_PAGE_SIZE = 100;
export const SOURCING_HISTORY_READ_LIMIT = 200;

const candidatePendingQuery = (uid: string, cursor?: QueryDocumentSnapshot<DocumentData>) => query(
  collection(firestoreDb, 'sourcing_outreach'),
  where('candidate_id', '==', uid),
  where('status', '==', 'requested'),
  orderBy('created_at', 'desc'),
  ...(cursor ? [startAfter(cursor)] : []),
  limit(SOURCING_ACTIONABLE_PAGE_SIZE),
);

const candidateAcceptedQuery = (
  uid: string,
  nowMs: number,
  cursor?: QueryDocumentSnapshot<DocumentData>,
) => query(
  collection(firestoreDb, 'sourcing_outreach'),
  where('candidate_id', '==', uid),
  where('status', '==', 'accepted'),
  where('packet_expires_at_ms', '>', nowMs),
  orderBy('packet_expires_at_ms', 'desc'),
  ...(cursor ? [startAfter(cursor)] : []),
  limit(SOURCING_ACTIONABLE_PAGE_SIZE),
);

const candidateHistoryQuery = (uid: string) => query(
  collection(firestoreDb, 'sourcing_outreach'),
  where('candidate_id', '==', uid),
  orderBy('created_at', 'desc'),
  limit(SOURCING_HISTORY_READ_LIMIT),
);

const normalizeSnapshot = (snap: { docs: Array<{ id: string; data: () => DocumentData }> }) => (
  snap.docs.map((d) => normalizeSourcingOutreach(d.id, d.data()))
);

async function readAllCandidateActionablePages(
  uid: string,
  status: 'requested' | 'accepted',
  nowMs: number,
): Promise<SourcingOutreach[]> {
  const rows: SourcingOutreach[] = [];
  let cursor: QueryDocumentSnapshot<DocumentData> | undefined;
  do {
    const snap = await getDocs(status === 'requested'
      ? candidatePendingQuery(uid, cursor)
      : candidateAcceptedQuery(uid, nowMs, cursor));
    rows.push(...normalizeSnapshot(snap));
    cursor = snap.docs.length === SOURCING_ACTIONABLE_PAGE_SIZE
      ? snap.docs[snap.docs.length - 1]
      : undefined;
  } while (cursor);
  return rows;
}

export function mergeCandidateOutreachBatches(
  ...batches: ReadonlyArray<ReadonlyArray<SourcingOutreach>>
): SourcingOutreach[] {
  const byId = new Map<string, SourcingOutreach>();
  for (const batch of batches) {
    for (const outreach of batch) byId.set(outreach.id, outreach);
  }
  return [...byId.values()].sort(byNewest);
}

export async function listSourcingOutreachForCandidate(uid: string): Promise<SourcingOutreach[]> {
  const nowMs = Date.now();
  const [history, pending, accepted] = await Promise.all([
    getDocs(candidateHistoryQuery(uid)),
    readAllCandidateActionablePages(uid, 'requested', nowMs),
    readAllCandidateActionablePages(uid, 'accepted', nowMs),
  ]);
  return mergeCandidateOutreachBatches(
    normalizeSnapshot(history),
    pending,
    accepted,
  );
}

export async function listSourcingOutreachForEmployer(uid: string): Promise<SourcingOutreach[]> {
  const snap = await getDocs(query(
    collection(firestoreDb, 'sourcing_outreach'),
    where('employer_id', '==', uid),
    orderBy('created_at', 'desc'),
    limit(SOURCING_HISTORY_READ_LIMIT),
  ));
  return snap.docs.map((d) => normalizeSourcingOutreach(d.id, d.data())).sort(byNewest);
}

export function subscribeSourcingOutreachForEmployer(
  uid: string,
  onChange: (requests: SourcingOutreach[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  return onSnapshot(
    query(
      collection(firestoreDb, 'sourcing_outreach'),
      where('employer_id', '==', uid),
      orderBy('created_at', 'desc'),
      limit(SOURCING_HISTORY_READ_LIMIT),
    ),
    (snap) => onChange(normalizeSnapshot(snap).sort(byNewest)),
    (error) => onError?.(error),
  );
}

export function subscribeSourcingOutreachForCandidate(
  uid: string,
  onChange: (requests: SourcingOutreach[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  let closed = false;
  let reportedError = false;
  let refreshRunning = false;
  let refreshQueued = false;
  const reportError = (error: unknown) => {
    if (closed || reportedError) return;
    reportedError = true;
    onError?.(error);
  };
  const refresh = async () => {
    if (closed) return;
    if (refreshRunning) {
      refreshQueued = true;
      return;
    }
    refreshRunning = true;
    try {
      do {
        refreshQueued = false;
        const next = await listSourcingOutreachForCandidate(uid);
        if (!closed) onChange(next);
      } while (!closed && refreshQueued);
    } catch (error) {
      reportError(error);
    } finally {
      refreshRunning = false;
    }
  };

  // Any create/respond/cancel/revoke updates `updated_at`. Listening to the
  // newest activity pulse lets us re-page the complete actionable set without
  // keeping an unbounded live listener open.
  const unsubscribe = onSnapshot(
    query(
      collection(firestoreDb, 'sourcing_outreach'),
      where('candidate_id', '==', uid),
      orderBy('updated_at', 'desc'),
      limit(1),
    ),
    () => { void refresh(); },
    reportError,
  );

  return () => {
    closed = true;
    unsubscribe();
  };
}

export async function createSourcingOutreach(input: {
  candidateId: string;
  message: string;
  jobId?: string;
  requestSource?: string;
}): Promise<{ outreachId: string; status: SourcingOutreachStatus; duplicate: boolean }> {
  const res = await httpsCallable<typeof input, { outreachId: string; status: SourcingOutreachStatus; duplicate: boolean }>(
    firebaseFunctions,
    'createSourcingOutreach',
  )(input);
  return res.data;
}

export async function respondSourcingOutreach(input: {
  outreachId: string;
  action: 'accept' | 'decline' | 'revoke';
  note?: string;
}): Promise<void> {
  await httpsCallable<typeof input, { outreachId: string; status: SourcingOutreachStatus }>(
    firebaseFunctions,
    'respondSourcingOutreach',
  )(input);
}

export async function cancelSourcingOutreach(input: { outreachId: string; note?: string }): Promise<void> {
  await httpsCallable<typeof input, { outreachId: string; status: SourcingOutreachStatus }>(
    firebaseFunctions,
    'cancelSourcingOutreach',
  )(input);
}

export async function getSourcingCandidatePacket(outreachId: string): Promise<ConsentedCandidatePacket> {
  const res = await httpsCallable<{ outreachId: string }, { candidate: ConsentedCandidatePacket }>(
    firebaseFunctions,
    'getSourcingCandidatePacket',
  )({ outreachId });
  return normalizeConsentedCandidatePacket(res.data.candidate);
}

export function normalizeConsentedCandidatePacket(data: unknown): ConsentedCandidatePacket {
  const raw = data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};

  return {
    id: cleanString(raw.id, 160),
    full_name: cleanString(raw.full_name, 240),
    email: cleanString(raw.email, 320),
    phone: cleanString(raw.phone, 120),
    location: cleanString(raw.location, 240),
    headline: cleanString(raw.headline, 500),
    website: cleanString(raw.website, 1000),
    linkedin: cleanString(raw.linkedin, 1000),
    github: cleanString(raw.github, 1000),
    resume_text: cleanString(raw.resume_text, 60000),
    talent_profile: raw.talent_profile && typeof raw.talent_profile === 'object' && !Array.isArray(raw.talent_profile)
      ? raw.talent_profile
      : null,
  };
}
