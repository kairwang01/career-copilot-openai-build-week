/**
 * scorecardData — employer-only interview scorecards.
 *
 * Reads are direct Firestore queries scoped by employer_id so rules can prove
 * every returned scorecard belongs to the caller. The application filter is
 * applied client-side to avoid requiring an extra composite index.
 * Writes use the upsertScorecard callable; candidates have no read/write path.
 */
import { collection, getDocs, query, where, type DocumentData } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { firestoreDb, firebaseFunctions } from './firebaseClient';

export type ScorecardRecommendation = 'strong_hire' | 'hire' | 'hold' | 'no_hire';

export const SCORECARD_RATING_KEYS = [
  'role_fit',
  'technical_skill',
  'problem_solving',
  'communication',
  'evidence_depth',
] as const;

export type ScorecardRatingKey = (typeof SCORECARD_RATING_KEYS)[number];

export interface ApplicationScorecard {
  id: string;
  application_id: string;
  interview_id: string;
  job_id: string;
  employer_id: string;
  candidate_id: string;
  stage: string;
  recommendation: ScorecardRecommendation;
  overall_score: number;
  ratings: Record<ScorecardRatingKey, number>;
  evidence: string;
  concerns: string;
  next_steps: string;
  private_notes: string;
  created_at: string | null;
  updated_at: string | null;
}

const toIso = (v: unknown): string | null => (
  v && typeof (v as { toDate?: unknown }).toDate === 'function'
    ? (v as { toDate: () => Date }).toDate().toISOString()
    : null
);

const cleanString = (v: unknown, max = 4000): string => (
  typeof v === 'string' ? v.trim().slice(0, max) : ''
);

const cleanScore = (v: unknown, fallback = 3): number => {
  const value = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.max(1, Math.min(5, Math.round(value)));
};

const cleanRecommendation = (v: unknown): ScorecardRecommendation => {
  const value = String(v ?? '');
  return value === 'strong_hire' || value === 'hire' || value === 'hold' || value === 'no_hire'
    ? value
    : 'hold';
};

const cleanRatings = (v: unknown): Record<ScorecardRatingKey, number> => {
  const raw = v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
  return SCORECARD_RATING_KEYS.reduce((acc, key) => {
    acc[key] = cleanScore(raw[key]);
    return acc;
  }, {} as Record<ScorecardRatingKey, number>);
};

export const normalizeApplicationScorecard = (id: string, d: DocumentData): ApplicationScorecard => ({
  id: cleanString(id, 160),
  application_id: cleanString(d.application_id, 160),
  interview_id: cleanString(d.interview_id, 160),
  job_id: cleanString(d.job_id, 160),
  employer_id: cleanString(d.employer_id, 160),
  candidate_id: cleanString(d.candidate_id, 160),
  stage: cleanString(d.stage, 120) || 'Interview',
  recommendation: cleanRecommendation(d.recommendation),
  overall_score: cleanScore(d.overall_score),
  ratings: cleanRatings(d.ratings),
  evidence: cleanString(d.evidence),
  concerns: cleanString(d.concerns),
  next_steps: cleanString(d.next_steps),
  private_notes: cleanString(d.private_notes),
  created_at: toIso(d.created_at),
  updated_at: toIso(d.updated_at),
});

export async function listScorecardsForApplication(applicationId: string, employerId: string): Promise<ApplicationScorecard[]> {
  // Filter to the one application in Firestore (two equality filters need no
  // composite index) instead of reading the employer's entire scorecard corpus
  // and narrowing client-side. Rules still prove ownership via employer_id.
  const snap = await getDocs(query(
    collection(firestoreDb, 'application_scorecards'),
    where('employer_id', '==', employerId),
    where('application_id', '==', applicationId),
  ));
  return snap.docs
    .map((d) => normalizeApplicationScorecard(d.id, d.data()))
    .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
}

export interface UpsertScorecardInput {
  scorecardId?: string;
  interviewId: string;
  stage?: string;
  recommendation: ScorecardRecommendation;
  overallScore: number;
  ratings: Record<ScorecardRatingKey, number>;
  evidence: string;
  concerns?: string;
  nextSteps?: string;
  privateNotes?: string;
}

export async function upsertScorecard(input: UpsertScorecardInput): Promise<{ scorecardId: string }> {
  const fn = httpsCallable<UpsertScorecardInput, { scorecardId: string }>(firebaseFunctions, 'upsertScorecard');
  const res = await fn(input);
  return res.data;
}
