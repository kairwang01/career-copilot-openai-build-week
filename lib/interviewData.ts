/**
 * interviewData — client access to application_interviews.
 *
 * Reads are direct Firestore queries (rules allow each party to read their own:
 * candidate_id == uid OR employer_id == uid). Writes are server-only callables —
 * the employer schedules / reschedules / cancels / completes; the candidate only
 * confirms.
 */
import { collection, getDocs, limit, onSnapshot, query, where, type DocumentData } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { firestoreDb, firebaseFunctions } from './firebaseClient';

export type InterviewFormat = 'phone' | 'video' | 'onsite';
export type InterviewStatus = 'scheduled' | 'rescheduled' | 'cancelled' | 'completed';

export interface ApplicationInterview {
  id: string;
  application_id: string;
  job_id: string;
  employer_id: string;
  candidate_id: string;
  stage: string;
  scheduled_at: string;
  timezone: string;
  format: string;
  location_or_link: string;
  interviewer: string;
  notes: string;
  candidate_confirmed: boolean;
  interview_status: string;
}

const INTERVIEW_FORMATS = new Set<InterviewFormat>(['phone', 'video', 'onsite']);
const INTERVIEW_STATUSES = new Set<InterviewStatus>(['scheduled', 'rescheduled', 'cancelled', 'completed']);

const cleanString = (value: unknown, fallback = '', max = 2000): string => (
  typeof value === 'string' ? value.trim().slice(0, max) : fallback
);

const cleanTimestampString = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }
  return '';
};

const cleanFormat = (value: unknown): InterviewFormat => (
  typeof value === 'string' && INTERVIEW_FORMATS.has(value as InterviewFormat)
    ? value as InterviewFormat
    : 'video'
);

const cleanStatus = (value: unknown): InterviewStatus => (
  typeof value === 'string' && INTERVIEW_STATUSES.has(value as InterviewStatus)
    ? value as InterviewStatus
    : 'scheduled'
);

export const normalizeApplicationInterview = (id: string, d: DocumentData): ApplicationInterview => ({
  id: cleanString(id, '', 160),
  application_id: cleanString(d.application_id, '', 160),
  job_id: cleanString(d.job_id, '', 160),
  employer_id: cleanString(d.employer_id, '', 160),
  candidate_id: cleanString(d.candidate_id, '', 160),
  stage: cleanString(d.stage, 'Interview', 120),
  scheduled_at: cleanTimestampString(d.scheduled_at),
  timezone: cleanString(d.timezone, '', 80),
  format: cleanFormat(d.format),
  location_or_link: cleanString(d.location_or_link, '', 1000),
  interviewer: cleanString(d.interviewer, '', 240),
  notes: cleanString(d.notes, '', 4000),
  candidate_confirmed: d.candidate_confirmed === true,
  interview_status: cleanStatus(d.interview_status),
});

// Cancelled last; otherwise soonest scheduled first.
const byScheduled = (a: ApplicationInterview, b: ApplicationInterview): number => {
  const ac = a.interview_status === 'cancelled' ? 1 : 0;
  const bc = b.interview_status === 'cancelled' ? 1 : 0;
  if (ac !== bc) return ac - bc;
  return a.scheduled_at.localeCompare(b.scheduled_at);
};

export async function listInterviewsForApplication(applicationId: string, employerId: string): Promise<ApplicationInterview[]> {
  const snap = await getDocs(query(
    collection(firestoreDb, 'application_interviews'),
    where('application_id', '==', applicationId),
    where('employer_id', '==', employerId),
  ));
  return snap.docs.map((d) => normalizeApplicationInterview(d.id, d.data())).sort(byScheduled);
}

// Bound per-user interview reads so a long-lived account can't page an unbounded
// collection on every timeline render. A bare limit() (no orderBy) avoids new
// composite indexes; scheduled_at is a plain string, so ordering stays client-side.
const CANDIDATE_INTERVIEWS_LIMIT = 200;

export async function listInterviewsForCandidate(uid: string): Promise<ApplicationInterview[]> {
  const snap = await getDocs(query(
    collection(firestoreDb, 'application_interviews'),
    where('candidate_id', '==', uid),
    limit(CANDIDATE_INTERVIEWS_LIMIT),
  ));
  return snap.docs.map((d) => normalizeApplicationInterview(d.id, d.data())).sort(byScheduled);
}

/** Live subscription to a candidate's interviews — keeps the timeline fresh across
 *  tabs and when the employer reschedules/cancels, with no manual reload. */
export function subscribeInterviewsForCandidate(
  uid: string,
  onChange: (interviews: ApplicationInterview[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  return onSnapshot(
    query(
      collection(firestoreDb, 'application_interviews'),
      where('candidate_id', '==', uid),
      limit(CANDIDATE_INTERVIEWS_LIMIT),
    ),
    (snap) => onChange(snap.docs.map((d) => normalizeApplicationInterview(d.id, d.data())).sort(byScheduled)),
    (error) => onError?.(error),
  );
}

export interface ScheduleInterviewInput {
  applicationId: string;
  stage?: string;
  scheduledAt: string;
  timezone?: string;
  format: InterviewFormat;
  locationOrLink?: string;
  interviewer?: string;
  notes?: string;
}

export async function scheduleInterview(input: ScheduleInterviewInput): Promise<void> {
  await httpsCallable<ScheduleInterviewInput, { interviewId: string }>(firebaseFunctions, 'scheduleInterview')(input);
}

export interface UpdateInterviewInput {
  interviewId: string;
  interviewStatus?: InterviewStatus;
  scheduledAt?: string;
  timezone?: string;
  format?: InterviewFormat;
  locationOrLink?: string;
  interviewer?: string;
  notes?: string;
  stage?: string;
}

export async function updateInterview(input: UpdateInterviewInput): Promise<void> {
  await httpsCallable<UpdateInterviewInput, { interviewId: string }>(firebaseFunctions, 'updateInterview')(input);
}

export async function confirmInterview(interviewId: string): Promise<void> {
  await httpsCallable<{ interviewId: string }, { interviewId: string }>(firebaseFunctions, 'confirmInterview')({ interviewId });
}
