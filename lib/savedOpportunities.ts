/**
 * savedOpportunities — candidate's bookmarked AI-found job opportunities.
 *
 * Persisted at users/{uid}/job_opportunities/{id} (owner-only reads/writes per
 * firestore.rules validJobOpportunity). The saved list is intentionally kept SEPARATE
 * from the live "found opportunities" result in OpportunityFinder: we never auto-persist
 * search results on mount (that clobber bug got the earlier attempt reverted) — only an
 * explicit bookmark writes, and the saved list is a read-only subscription.
 */
import { collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';
import { firestoreDb } from './firebaseClient';

export interface SavedOpportunity {
  id: string;
  job_title: string;
  company: string;
  location?: string;
  url: string;
  ai_summary?: string;
  compatibility_score?: number;
  missing_skills?: string[];
  created_at?: number; // epoch ms
}

export interface SaveOpportunityInput {
  jobTitle: string;
  company: string;
  location?: string;
  url: string;
  summary?: string;
  compatibilityScore?: number;
  missingSkills?: string[];
}

// Deterministic doc id from the opportunity URL so saving the same listing twice is
// idempotent and a bookmark can be toggled off by the same key.
export const savedOpportunityId = (url: string): string => {
  let h = 5381;
  for (let i = 0; i < url.length; i += 1) h = (((h << 5) + h + url.charCodeAt(i)) >>> 0);
  return `opp_${h.toString(36)}`;
};

export async function saveOpportunity(uid: string, opp: SaveOpportunityInput): Promise<void> {
  // Build with EXACTLY the keys validJobOpportunity allows (hasOnly), required ones always present.
  const data: Record<string, unknown> = {
    job_title: (opp.jobTitle || '').slice(0, 180),
    company: (opp.company || '—').slice(0, 180),
    url: (opp.url || '').slice(0, 2048),
    is_saved: true,
    created_at: serverTimestamp(),
  };
  if (opp.location) data.location = opp.location.slice(0, 180);
  if (opp.summary) data.ai_summary = opp.summary.slice(0, 20000);
  if (typeof opp.compatibilityScore === 'number' && Number.isFinite(opp.compatibilityScore)) {
    data.compatibility_score = Math.max(0, Math.min(100, Math.round(opp.compatibilityScore)));
  }
  if (Array.isArray(opp.missingSkills) && opp.missingSkills.length > 0) {
    data.missing_skills = opp.missingSkills.slice(0, 50);
  }
  await setDoc(doc(firestoreDb, 'users', uid, 'job_opportunities', savedOpportunityId(opp.url)), data);
}

export async function removeOpportunity(uid: string, url: string): Promise<void> {
  await deleteDoc(doc(firestoreDb, 'users', uid, 'job_opportunities', savedOpportunityId(url)));
}

/** Live subscription to the candidate's saved opportunities (newest first). */
export function subscribeSavedOpportunities(
  uid: string,
  onChange: (opps: SavedOpportunity[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  return onSnapshot(
    query(collection(firestoreDb, 'users', uid, 'job_opportunities'), orderBy('created_at', 'desc'), limit(100)),
    (snap) => onChange(snap.docs.map((d) => {
      const x = d.data() as Record<string, unknown>;
      const ts = x.created_at as { toMillis?: () => number } | undefined;
      return {
        id: d.id,
        job_title: String(x.job_title ?? ''),
        company: String(x.company ?? ''),
        location: x.location ? String(x.location) : undefined,
        url: String(x.url ?? ''),
        ai_summary: x.ai_summary ? String(x.ai_summary) : undefined,
        compatibility_score: typeof x.compatibility_score === 'number' ? x.compatibility_score : undefined,
        missing_skills: Array.isArray(x.missing_skills) ? (x.missing_skills as string[]) : undefined,
        created_at: ts?.toMillis?.() ?? undefined,
      } as SavedOpportunity;
    })),
    (e) => onError?.(e),
  );
}
