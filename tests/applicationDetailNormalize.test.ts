import { describe, expect, it } from 'vitest';
import { normalizeApplicationInterview } from '../lib/interviewData';
import { normalizeApplicationScorecard } from '../lib/scorecardData';
import {
  normalizeConsentedCandidatePacket,
  normalizeSourcingOutreach,
} from '../lib/sourcingOutreachData';

describe('application detail data normalization', () => {
  it('sanitizes malformed interview records before applicant detail renders them', () => {
    const interview = normalizeApplicationInterview(' iv1 ', {
      application_id: 42,
      stage: { label: 'Bad child' },
      scheduled_at: { toDate: 'not-a-function' },
      format: 'carrier-pigeon',
      interview_status: 'maybe',
      location_or_link: ['https://example.com'],
      interviewer: null,
      notes: { body: 'not renderable' },
      candidate_confirmed: 'true',
    });

    expect(interview).toMatchObject({
      id: 'iv1',
      application_id: '',
      stage: 'Interview',
      scheduled_at: '',
      format: 'video',
      interview_status: 'scheduled',
      location_or_link: '',
      interviewer: '',
      notes: '',
      candidate_confirmed: false,
    });
  });

  it('keeps valid interview timestamps and status values', () => {
    const scheduledAt = { toDate: () => new Date('2026-07-01T14:00:00.000Z') };
    const interview = normalizeApplicationInterview('iv2', {
      application_id: 'app1',
      stage: 'First Interview',
      scheduled_at: scheduledAt,
      format: 'onsite',
      interview_status: 'completed',
      candidate_confirmed: true,
    });

    expect(interview.scheduled_at).toBe('2026-07-01T14:00:00.000Z');
    expect(interview.format).toBe('onsite');
    expect(interview.interview_status).toBe('completed');
    expect(interview.candidate_confirmed).toBe(true);
  });

  it('sanitizes scorecard values so form controls stay in valid ranges', () => {
    const scorecard = normalizeApplicationScorecard('sc1', {
      application_id: 'app1',
      interview_id: 'iv1',
      stage: {},
      recommendation: 'maybe',
      overall_score: 9,
      ratings: {
        role_fit: -3,
        technical_skill: Number.NaN,
        problem_solving: 4.6,
        communication: '5',
        evidence_depth: 2,
      },
      evidence: { text: 'not renderable' },
      concerns: ['array'],
      next_steps: '  Follow up with panel.  ',
    });

    expect(scorecard.recommendation).toBe('hold');
    expect(scorecard.overall_score).toBe(5);
    expect(scorecard.ratings).toEqual({
      role_fit: 1,
      technical_skill: 3,
      problem_solving: 5,
      communication: 3,
      evidence_depth: 2,
    });
    expect(scorecard.stage).toBe('Interview');
    expect(scorecard.evidence).toBe('');
    expect(scorecard.concerns).toBe('');
    expect(scorecard.next_steps).toBe('Follow up with panel.');
  });

  it('sanitizes sourcing outreach rows and ignores malformed timestamp-like objects', () => {
    const outreach = normalizeSourcingOutreach('out1', {
      employer_id: {},
      candidate_id: 'cand1',
      job_title: { title: 'Bad child' },
      company_name: '  Acme  ',
      message: ['hello'],
      status: 'unknown',
      created_at: { toDate: 'not-a-function' },
    });

    expect(outreach).toMatchObject({
      id: 'out1',
      employer_id: '',
      candidate_id: 'cand1',
      job_title: '',
      company_name: 'Acme',
      message: '',
      status: 'requested',
      organization_verification: 'unverified_self_reported',
      packet_expires_at_ms: 0,
      created_at: '',
    });
  });

  it('keeps only trusted sourcing verification and expiry values', () => {
    const outreach = normalizeSourcingOutreach('out2', {
      status: 'revoked',
      organization_verification: 'verified',
      packet_expires_at_ms: 1_800_000_000_000,
    });

    expect(outreach.status).toBe('revoked');
    expect(outreach.organization_verification).toBe('verified');
    expect(outreach.packet_expires_at_ms).toBe(1_800_000_000_000);
  });

  it('sanitizes consented candidate packet fields before packet modal renders them', () => {
    const packet = normalizeConsentedCandidatePacket({
      id: 'cand1',
      full_name: ['Candidate'],
      email: { value: 'bad' },
      phone: null,
      location: '  Ottawa  ',
      headline: 123,
      website: 'https://example.com',
      linkedin: {},
      github: 'https://github.com/example',
      resume_text: { body: 'not renderable' },
      talent_profile: ['not an object'],
    });

    expect(packet).toEqual({
      id: 'cand1',
      full_name: '',
      email: '',
      phone: '',
      location: 'Ottawa',
      headline: '',
      website: 'https://example.com',
      linkedin: '',
      github: 'https://github.com/example',
      resume_text: '',
      talent_profile: null,
    });
  });
});
