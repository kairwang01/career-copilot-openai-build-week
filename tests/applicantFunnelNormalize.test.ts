import { describe, expect, it } from 'vitest';
import { normalizeApplicantForFunnel, normalizeApplicantsForFunnel, stringArray } from '../lib/applicantFunnelNormalize';
import type { JobApplicant } from '../services/aiClient';

describe('applicant funnel normalization', () => {
  it('coerces missing legacy array fields to safe arrays', () => {
    const legacy = {
      id: 'app-legacy',
      candidate_name: 'Legacy Candidate',
      application_date: null,
      status: 'Submitted',
      compatibility_score: 0,
      summary: '',
      talent_profile: null,
    } as unknown as JobApplicant;

    const applicant = normalizeApplicantForFunnel(legacy);

    expect(applicant.strengths).toEqual([]);
    expect(applicant.potentialGaps).toEqual([]);
    expect(applicant.suggestedQuestions).toEqual([]);
    expect(applicant.status_history).toEqual([]);
    expect(applicant.screener_answers).toEqual([]);
  });

  it('drops malformed status-history and screener values while keeping valid data', () => {
    const dirty = {
      id: '  ',
      applicationId: ' app-fallback ',
      candidate_name: 123,
      application_date: 456,
      status: null,
      compatibility_score: Number.NaN,
      summary: false,
      strengths: ['React', '', 42],
      potentialGaps: 'none',
      suggestedQuestions: [null, 'Ask about systems design'],
      talent_profile: ['bad'],
      status_history: [
        {
          id: 'ev1',
          action: 'advance',
          from_status: 'Submitted',
          to_status: 'First interview',
          skipped_statuses: ['Group interview', 9],
          created_at: '2026-06-24T10:00:00.000Z',
        },
        null,
      ],
      screener_answers: [
        { question_id: 'q1', prompt: 'Eligible to work?', answer: 'yes' },
        { question_id: 2, prompt: null, answer: false },
      ],
    } as unknown as JobApplicant;

    const applicant = normalizeApplicantForFunnel(dirty);

    expect(applicant.id).toBe('app-fallback');
    expect(applicant.candidate_name).toBe('');
    expect(applicant.application_date).toBeNull();
    expect(applicant.status).toBe('Submitted');
    expect(applicant.compatibility_score).toBeNull();
    expect(applicant.summary).toBe('');
    expect(applicant.strengths).toEqual(['React']);
    expect(applicant.potentialGaps).toEqual([]);
    expect(applicant.suggestedQuestions).toEqual(['Ask about systems design']);
    expect(applicant.talent_profile).toBeNull();
    expect(applicant.status_history).toEqual([
      {
        id: 'ev1',
        action: 'advance',
        from_status: 'Submitted',
        to_status: 'First interview',
        reason: null,
        candidate_note: null,
        skipped_statuses: ['Group interview'],
        created_at: '2026-06-24T10:00:00.000Z',
      },
    ]);
    expect(applicant.screener_answers).toEqual([
      { question_id: 'q1', prompt: 'Eligible to work?', answer: 'yes' },
    ]);
  });

  it('filters non-empty strings only', () => {
    expect(stringArray(['Python', ' ', 1, null, 'SQL'])).toEqual(['Python', 'SQL']);
  });

  it('keeps selected-applicant detail fields safe after malformed server payloads', () => {
    const malformed = normalizeApplicantForFunnel({
      id: 'app-detail',
      candidate_name: 'Candidate',
      strengths: { 0: 'not an array' },
      potentialGaps: null,
      suggestedQuestions: 'Ask this?',
      status_history: {
        skipped_statuses: 'Group interview',
      },
      screener_answers: {
        question_id: 'q1',
        answer: 'yes',
      },
      compatibility_score: Infinity,
    } as unknown as JobApplicant);

    expect(malformed.strengths).toEqual([]);
    expect(malformed.potentialGaps).toEqual([]);
    expect(malformed.suggestedQuestions).toEqual([]);
    expect(malformed.status_history).toEqual([]);
    expect(malformed.screener_answers).toEqual([]);
    expect(malformed.compatibility_score).toBeNull();
  });

  it('drops non-renderable applicant rows before they reach the funnel UI', () => {
    const applicants = normalizeApplicantsForFunnel([
      null,
      'bad row',
      { id: ' ', candidate_name: 'No id' },
      {
        application_id: ' app-from-legacy ',
        candidate_name: 'Legacy Applicant',
        strengths: ['Evidence'],
        status_history: [{ skipped_statuses: 'bad' }],
      },
      {
        id: 'app-valid',
        candidate_name: 'Valid Applicant',
        screener_answers: [{ question_id: 'q1', prompt: 'Work authorized?', answer: 'yes' }],
      },
    ]);

    expect(applicants.map((applicant) => applicant.id)).toEqual(['app-from-legacy', 'app-valid']);
    expect(applicants[0].strengths).toEqual(['Evidence']);
    expect(applicants[0].status_history).toEqual([
      {
        id: null,
        action: null,
        from_status: '',
        to_status: '',
        reason: null,
        candidate_note: null,
        skipped_statuses: [],
        created_at: null,
      },
    ]);
    expect(applicants[1].screener_answers).toEqual([
      { question_id: 'q1', prompt: 'Work authorized?', answer: 'yes' },
    ]);
  });
});
