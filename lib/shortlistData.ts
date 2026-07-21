import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentData,
  type Timestamp,
} from 'firebase/firestore';
import { firestoreDb } from './firebaseClient';

// ---- Types ------------------------------------------------------------------

export type ShortlistStatus = 'saved' | 'contacted' | 'rejected';

export interface CandidateSnapshot {
  skills?: string[];
  current_role?: string;
  summary?: string;
}

export interface ShortlistEntry {
  id: string;
  candidate_name: string;
  candidate_snapshot: CandidateSnapshot;
  job_id: string;
  job_title: string;
  match_score: number;
  match_reasons: string[];
  missing_requirements?: string[];
  notes: string;
  status: ShortlistStatus;
  saved_at: string;
  saved_by: string;
}

// Fields written to Firestore on create/update (id omitted — it's the doc id).
type ShortlistWriteData = Omit<ShortlistEntry, 'id' | 'saved_at'> & {
  saved_at: ReturnType<typeof serverTimestamp>;
};

// Partial update payload (only mutable fields).
export interface ShortlistEntryPatch {
  notes?: string;
  status?: ShortlistStatus;
}

// ---- Firestore helpers ------------------------------------------------------

const toIsoString = (value: unknown): string => {
  if (!value) return new Date().toISOString();
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    return (value as Timestamp).toDate().toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date().toISOString();
};

function mapEntry(id: string, data: DocumentData): ShortlistEntry {
  return {
    id,
    candidate_name: String(data.candidate_name ?? ''),
    candidate_snapshot: (data.candidate_snapshot as CandidateSnapshot) ?? {},
    job_id: String(data.job_id ?? ''),
    job_title: String(data.job_title ?? ''),
    match_score: Number(data.match_score ?? 0),
    match_reasons: Array.isArray(data.match_reasons) ? (data.match_reasons as string[]) : [],
    missing_requirements: Array.isArray(data.missing_requirements)
      ? (data.missing_requirements as string[])
      : undefined,
    notes: String(data.notes ?? ''),
    status: (data.status as ShortlistStatus) ?? 'saved',
    saved_at: toIsoString(data.saved_at),
    saved_by: String(data.saved_by ?? ''),
  };
}

function shortlistCol(employerUid: string) {
  return collection(firestoreDb, 'users', employerUid, 'shortlists');
}

// ---- Public API -------------------------------------------------------------

/**
 * Add a candidate snapshot to the employer's shortlist.
 * Returns the new document id.
 */
export async function saveToShortlist(
  employerUid: string,
  entry: Omit<ShortlistEntry, 'id' | 'saved_at'>,
): Promise<string> {
  const writeData: ShortlistWriteData = {
    candidate_name: entry.candidate_name,
    candidate_snapshot: entry.candidate_snapshot,
    job_id: entry.job_id,
    job_title: entry.job_title,
    match_score: entry.match_score,
    match_reasons: entry.match_reasons,
    ...(entry.missing_requirements !== undefined
      ? { missing_requirements: entry.missing_requirements }
      : {}),
    notes: entry.notes,
    status: entry.status,
    saved_by: entry.saved_by,
    saved_at: serverTimestamp(),
  };
  const ref = await addDoc(shortlistCol(employerUid), writeData);
  return ref.id;
}

/** Remove an entry from the shortlist. */
export async function removeFromShortlist(
  employerUid: string,
  entryId: string,
): Promise<void> {
  await deleteDoc(doc(firestoreDb, 'users', employerUid, 'shortlists', entryId));
}

/** Fetch the employer's full shortlist, newest-first. */
export async function listShortlist(employerUid: string): Promise<ShortlistEntry[]> {
  const q = query(shortlistCol(employerUid), orderBy('saved_at', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => mapEntry(d.id, d.data()));
}

/** Update mutable fields (notes and/or status) on a shortlist entry. */
export async function updateShortlistEntry(
  employerUid: string,
  entryId: string,
  patch: ShortlistEntryPatch,
): Promise<void> {
  const ref = doc(firestoreDb, 'users', employerUid, 'shortlists', entryId);
  await updateDoc(ref, patch as DocumentData);
}

// ---- Hidden candidates (Talent Discovery "don't surface again") --------------

function hiddenCol(employerUid: string) {
  return collection(firestoreDb, 'users', employerUid, 'hidden_candidates');
}

/** Hide a discovered candidate so they no longer appear in this employer's search. */
export async function hideCandidate(employerUid: string, candidateId: string): Promise<void> {
  await setDoc(doc(hiddenCol(employerUid), candidateId), { hidden_at: serverTimestamp() });
}

/** Un-hide a previously hidden candidate. */
export async function unhideCandidate(employerUid: string, candidateId: string): Promise<void> {
  await deleteDoc(doc(hiddenCol(employerUid), candidateId));
}

/** The set of candidate ids this employer has hidden (used to filter search results). */
export async function listHiddenCandidateIds(employerUid: string): Promise<Set<string>> {
  const snap = await getDocs(hiddenCol(employerUid));
  return new Set(snap.docs.map((d) => d.id));
}
