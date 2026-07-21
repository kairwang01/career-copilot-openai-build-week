import type { ApplicationStatusHistoryEvent, JobApplicant } from '../services/aiClient';

type ScreenerAnswer = JobApplicant['screener_answers'][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(cleanString).filter((item) => item.length > 0)
    : [];
}

function normalizeScreenerAnswers(value: unknown): ScreenerAnswer[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      question_id: typeof item.question_id === 'string' ? item.question_id : '',
      prompt: typeof item.prompt === 'string' ? item.prompt : '',
      answer: typeof item.answer === 'string' ? item.answer : '',
    }))
    .filter((item) => item.question_id || item.prompt || item.answer);
}

function normalizeStatusHistory(value: unknown): ApplicationStatusHistoryEvent[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((event): event is Record<string, unknown> => Boolean(event) && typeof event === 'object' && !Array.isArray(event))
    .map((event) => ({
      id: typeof event.id === 'string' ? event.id : null,
      action: typeof event.action === 'string' ? event.action : null,
      from_status: typeof event.from_status === 'string' ? event.from_status : '',
      to_status: typeof event.to_status === 'string' ? event.to_status : '',
      reason: typeof event.reason === 'string' ? event.reason : null,
      candidate_note: typeof event.candidate_note === 'string' ? event.candidate_note : null,
      skipped_statuses: stringArray(event.skipped_statuses),
      created_at: typeof event.created_at === 'string' ? event.created_at : null,
    }));
}

export function normalizeApplicantForFunnel(applicant: JobApplicant): JobApplicant {
  const raw = isRecord(applicant) ? applicant as unknown as Record<string, unknown> : {};
  const id = cleanString(raw.id) || cleanString(raw.application_id) || cleanString(raw.applicationId);
  return {
    ...applicant,
    id,
    candidate_name: cleanString(raw.candidate_name),
    application_date: cleanString(raw.application_date) || null,
    status: cleanString(raw.status) || 'Submitted',
    compatibility_score: typeof raw.compatibility_score === 'number' && Number.isFinite(raw.compatibility_score)
      ? raw.compatibility_score
      : null,
    analysis_status: ['complete', 'failed', 'not_requested', 'no_context', 'not_analyzed_cap'].includes(String(raw.analysis_status))
      ? raw.analysis_status as JobApplicant['analysis_status']
      : (typeof raw.compatibility_score === 'number' && Number.isFinite(raw.compatibility_score) ? 'complete' : 'not_requested'),
    summary: cleanString(raw.summary),
    strengths: stringArray(raw.strengths),
    potentialGaps: stringArray(raw.potentialGaps),
    suggestedQuestions: stringArray(raw.suggestedQuestions),
    talent_profile: raw.talent_profile && typeof raw.talent_profile === 'object' && !Array.isArray(raw.talent_profile)
      ? applicant.talent_profile
      : null,
    status_history: normalizeStatusHistory(raw.status_history),
    screener_answers: normalizeScreenerAnswers(raw.screener_answers),
  };
}

export function normalizeApplicantsForFunnel(value: unknown): JobApplicant[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item) => normalizeApplicantForFunnel(item as unknown as JobApplicant))
    .filter((applicant) => applicant.id.length > 0);
}
