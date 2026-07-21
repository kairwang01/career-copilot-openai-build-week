/**
 * careerPathAnalyses — client-side accessor for users/{uid}/career_path_analyses.
 *
 * Persists each generated career roadmap so a candidate can revisit and compare
 * past analyses ("My Roadmaps") instead of re-spending credits to regenerate.
 *
 * Owner-scoped: firestore.rules (users/{uid}/career_path_analyses) allow ONLY the
 * owner to read/create/delete their own roadmaps, validated by validCareerPath.
 * Mirrors the notificationsData.ts subcollection pattern (collection + query +
 * orderBy created_at desc + capped limit).
 *
 * The persisted shape keeps the ticket's columns
 *   desired_role, summary, skill_gaps, actionable_steps, bridge_roles
 * plus a created_at server timestamp. skill_gaps / actionable_steps / bridge_roles
 * carry the full structured CareerPathResult sub-objects so a reopened roadmap
 * renders identically to a freshly generated one.
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  type DocumentData,
} from 'firebase/firestore';
import { firestoreDb } from './firebaseClient';
import type {
  CareerPathResult,
  SkillGap,
  RoadmapPhase,
  BridgeRole,
} from '../types';

// Cap how many roadmaps we list (and implicitly keep visible). Plenty for the
// revisit/compare use case while bounding reads.
const CAP = 50;

// Firestore caps a document at ~1 MiB. Stay well under it; skip the save rather
// than throw if a roadmap somehow serializes larger (the tool still works).
const MAX_DOC_BYTES = 900_000;

export interface SavedCareerPathAnalysis {
  id: string;
  desired_role: string;
  /** epoch millis when saved (best-effort; serverTimestamp on write). */
  created_at: number;
  /** Full structured roadmap, reconstructed for rendering on reopen. */
  result: CareerPathResult;
}

/** Strip undefined / functions / non-JSON values so Firestore accepts the object. */
function sanitize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null));
}

function toMillis(value: unknown): number {
  const tsLike = value as { toMillis?: () => number } | null | undefined;
  try {
    if (tsLike && typeof tsLike.toMillis === 'function') return tsLike.toMillis();
  } catch {
    /* ignore */
  }
  return Date.now();
}

function mapAnalysis(id: string, data: DocumentData): SavedCareerPathAnalysis {
  const skillGaps = (data.skill_gaps as SkillGap[] | undefined) ?? [];
  const actionableSteps = (data.actionable_steps as RoadmapPhase[] | undefined) ?? [];
  const bridgeRoles = (data.bridge_roles as BridgeRole[] | undefined) ?? [];
  return {
    id,
    desired_role: String(data.desired_role ?? ''),
    created_at: toMillis(data.created_at),
    result: {
      summary: String(data.summary ?? ''),
      overallSkillGaps: skillGaps,
      roadmap: actionableSteps,
      bridgeRoles,
    },
  };
}

/**
 * Persist a generated roadmap under users/{uid}/career_path_analyses.
 * Best-effort and non-throwing: a failed save must never break the tool run.
 * Returns the new doc id on success, or null when skipped/failed.
 */
export async function saveCareerPathAnalysis(
  uid: string,
  desiredRole: string,
  result: CareerPathResult,
): Promise<string | null> {
  if (!uid || !desiredRole.trim()) return null;
  try {
    const payload = {
      desired_role: desiredRole.trim().slice(0, 180),
      summary: sanitize(result.summary ?? ''),
      skill_gaps: sanitize(result.overallSkillGaps ?? []),
      actionable_steps: sanitize(result.roadmap ?? []),
      bridge_roles: sanitize(result.bridgeRoles ?? []),
      created_at: serverTimestamp(),
    };
    if (JSON.stringify(payload).length > MAX_DOC_BYTES) return null; // too big to persist
    const ref = await addDoc(
      collection(firestoreDb, 'users', uid, 'career_path_analyses'),
      payload,
    );
    return ref.id;
  } catch {
    // offline, oversized, or rules rejection — silently skip.
    return null;
  }
}

/**
 * List a candidate's saved roadmaps, most recent first. Never throws —
 * returns [] on any error (e.g. offline).
 */
export async function listCareerPathAnalyses(uid: string): Promise<SavedCareerPathAnalysis[]> {
  if (!uid) return [];
  try {
    const q = query(
      collection(firestoreDb, 'users', uid, 'career_path_analyses'),
      orderBy('created_at', 'desc'),
      limit(CAP),
    );
    const snap = await getDocs(q);
    const rows = snap.docs.map((d) => mapAnalysis(d.id, d.data()));
    // Secondary sort: a just-written doc with a pending server timestamp sorts to top.
    rows.sort((a, b) => b.created_at - a.created_at);
    return rows;
  } catch {
    return [];
  }
}

/** Fetch a single saved roadmap by id, or null. Never throws. */
export async function getCareerPathAnalysis(
  uid: string,
  id: string,
): Promise<SavedCareerPathAnalysis | null> {
  if (!uid || !id) return null;
  try {
    const snap = await getDoc(doc(firestoreDb, 'users', uid, 'career_path_analyses', id));
    if (!snap.exists()) return null;
    return mapAnalysis(snap.id, snap.data());
  } catch {
    return null;
  }
}

/** Remove a saved roadmap (e.g. the candidate deletes it). Non-throwing. */
export async function deleteCareerPathAnalysis(uid: string, id: string): Promise<void> {
  if (!uid || !id) return;
  try {
    await deleteDoc(doc(firestoreDb, 'users', uid, 'career_path_analyses', id));
  } catch {
    /* ignore */
  }
}
