/**
 * toolResults — tier-gated persistence of a candidate's latest AI-tool output.
 *
 * Stored at users/{uid}/tool_results/{toolKey} (one doc per tool, latest only).
 * A PAID candidate (essentials/accelerator/executive) sees their last result for
 * free on the next visit; "Try next" re-runs the tool and overwrites it. Free
 * users get no save — enforced in firestore.rules (the create/update rule reads
 * the user's server-immutable subscription_status), this client check is just
 * UX so we don't attempt a write that the rules would reject.
 */
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { firestoreDb } from '../lib/firebaseClient';

// Candidate plans whose users may save results. Mirrors the rules allowlist and
// the PAID_STATUSES set used elsewhere (e.g. InterviewSimulator).
export const SAVE_RESULTS_STATUSES = new Set(['essentials', 'accelerator', 'executive']);

export function canSaveResults(subscriptionStatus: string | null | undefined): boolean {
  return SAVE_RESULTS_STATUSES.has((subscriptionStatus ?? '').trim());
}

export interface SavedToolResult<T = unknown> {
  result: T;
  /** epoch millis when the result was saved (best-effort; serverTimestamp on write). */
  savedAt: number;
}

// Firestore caps a document at ~1 MiB. Stay well under it; if a result somehow
// serializes larger, skip the save rather than throw (the tool still works).
const MAX_RESULT_BYTES = 900_000;

// Strip undefined / functions / non-JSON values so Firestore accepts the object.
function sanitize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null));
}

function toMillis(value: unknown): number {
  const ts = value as { toMillis?: () => number } | null | undefined;
  try {
    if (ts && typeof ts.toMillis === 'function') return ts.toMillis();
  } catch {
    /* ignore */
  }
  return Date.now();
}

/** Loads the saved result for a tool, or null. Safe to call for any tier (free
 *  users simply have nothing saved). Never throws — returns null on any error. */
export async function loadToolResult<T = unknown>(uid: string, toolKey: string): Promise<SavedToolResult<T> | null> {
  try {
    const snap = await getDoc(doc(firestoreDb, 'users', uid, 'tool_results', toolKey));
    if (!snap.exists()) return null;
    const data = snap.data();
    if (data?.result === undefined || data?.result === null) return null;
    return { result: data.result as T, savedAt: toMillis(data.saved_at) };
  } catch {
    return null;
  }
}

/** Persists the latest result for a tool (paid tiers only; rules reject free).
 *  Best-effort and non-throwing: a failed save must never break the tool run. */
export async function saveToolResult<T = unknown>(uid: string, toolKey: string, result: T): Promise<boolean> {
  try {
    const clean = sanitize(result);
    if (clean == null) return false;
    if (JSON.stringify(clean).length > MAX_RESULT_BYTES) return false; // too big to persist
    await setDoc(
      doc(firestoreDb, 'users', uid, 'tool_results', toolKey),
      { tool_key: toolKey, version: 1, result: clean, saved_at: serverTimestamp() },
      { merge: false },
    );
    return true;
  } catch {
    // free tier (rules reject), offline, or oversized — silently skip.
    return false;
  }
}

/** Removes a saved result (e.g. the user discards it). Non-throwing. */
export async function clearToolResult(uid: string, toolKey: string): Promise<void> {
  try {
    await deleteDoc(doc(firestoreDb, 'users', uid, 'tool_results', toolKey));
  } catch {
    /* ignore */
  }
}
