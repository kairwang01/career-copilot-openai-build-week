/**
 * Candidate-owned mock interview history.
 *
 * Firestore rules already allow users/{uid}/interview_sessions with a narrow
 * schema. Keep this helper aligned with that schema so the feature needs no
 * rules deploy and cannot leak employer/candidate data across users.
 */
import {
  addDoc,
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  type DocumentData,
  type Timestamp,
} from 'firebase/firestore';
import { firestoreDb } from './firebaseClient';

export interface InterviewSessionExchange {
  question: string;
  answer: string;
  score?: number;
  feedback?: string;
}

export interface InterviewSessionHistoryItem {
  id: string;
  job_description: string;
  market_name: string;
  overall_summary: string;
  started_at: string;
  exchanges: InterviewSessionExchange[];
}

export interface SaveInterviewSessionInput {
  jobDescription?: string;
  marketName?: string;
  overallSummary?: string;
  exchanges: InterviewSessionExchange[];
}

const MAX_HISTORY = 12;

const toIsoString = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    return (value as Timestamp).toDate().toISOString();
  }
  if (typeof value === 'string') return value;
  return '';
};

const cleanExchange = (exchange: InterviewSessionExchange): InterviewSessionExchange => ({
  question: String(exchange.question ?? '').slice(0, 4000),
  answer: String(exchange.answer ?? '').slice(0, 8000),
  ...(typeof exchange.score === 'number' && Number.isFinite(exchange.score)
    ? { score: Math.max(0, Math.min(100, Math.round(exchange.score))) }
    : {}),
  ...(exchange.feedback ? { feedback: String(exchange.feedback).slice(0, 6000) } : {}),
});

function mapSession(id: string, data: DocumentData): InterviewSessionHistoryItem {
  const rawExchanges = Array.isArray(data.exchanges) ? data.exchanges : [];
  return {
    id,
    job_description: String(data.job_description ?? ''),
    market_name: String(data.market_name ?? ''),
    overall_summary: String(data.overall_summary ?? ''),
    started_at: toIsoString(data.started_at),
    exchanges: rawExchanges.map((item) => cleanExchange(item as InterviewSessionExchange)),
  };
}

function sessionCollection(uid: string) {
  return collection(firestoreDb, 'users', uid, 'interview_sessions');
}

export async function saveInterviewSession(uid: string, input: SaveInterviewSessionInput): Promise<string> {
  const exchanges = input.exchanges.map(cleanExchange).filter((exchange) => exchange.question || exchange.answer);
  const ref = await addDoc(sessionCollection(uid), {
    job_description: String(input.jobDescription ?? '').slice(0, 20_000),
    market_name: String(input.marketName ?? '').slice(0, 120),
    overall_summary: String(input.overallSummary ?? '').slice(0, 20_000),
    started_at: serverTimestamp(),
    exchanges,
  });
  return ref.id;
}

export async function listInterviewSessions(uid: string): Promise<InterviewSessionHistoryItem[]> {
  const snap = await getDocs(query(sessionCollection(uid), orderBy('started_at', 'desc'), limit(MAX_HISTORY)));
  return snap.docs.map((doc) => mapSession(doc.id, doc.data()));
}

export function subscribeInterviewSessions(
  uid: string,
  onChange: (items: InterviewSessionHistoryItem[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  return onSnapshot(
    query(sessionCollection(uid), orderBy('started_at', 'desc'), limit(MAX_HISTORY)),
    (snap) => onChange(snap.docs.map((doc) => mapSession(doc.id, doc.data()))),
    (error) => onError?.(error),
  );
}
