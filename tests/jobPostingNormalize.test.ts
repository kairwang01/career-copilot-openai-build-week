import { describe, expect, it } from 'vitest';
import {
  cleanStringArray,
  normalizeJobPostingForClient,
  normalizeScreenerQuestions,
} from '../lib/jobPostingNormalize';
import type { JobPosting } from '../lib/recruitingData';

describe('job posting client normalization', () => {
  it('drops malformed screener entries and normalizes expected yes/no values', () => {
    expect(normalizeScreenerQuestions([
      null,
      'bad',
      { id: 7, prompt: '   ', type: 'yes_no', expected: 'yes' },
      { id: 'q-work', prompt: 'Are you authorized to work in Canada?', type: 'yes_no', expected: 'YES', required: true },
      { prompt: 'Tell us about your project work', type: 'unsupported', expected: true },
      { id: 'q-visa', prompt: 'Need sponsorship?', type: 'yes_no', expected: 'maybe' },
    ])).toEqual([
      {
        id: 'q-work',
        prompt: 'Are you authorized to work in Canada?',
        type: 'yes_no',
        required: true,
        expected: 'yes',
      },
      {
        id: 'q2',
        prompt: 'Tell us about your project work',
        type: 'short_text',
        required: false,
        expected: null,
      },
      {
        id: 'q-visa',
        prompt: 'Need sponsorship?',
        type: 'yes_no',
        required: false,
        expected: null,
      },
    ]);
  });

  it('cleans string arrays without coercing objects into visible UI text', () => {
    expect(cleanStringArray(['React', ' ', 42, 'react', 'SQL'])).toEqual(['React', 'SQL']);
  });

  it('normalizes legacy job records before applicant-funnel rendering', () => {
    const dirty = {
      id: 'job-1',
      employer_id: 'emp-1',
      title: 123,
      company_name: 42,
      location: ' Ottawa ',
      is_active: undefined,
      created_at: null,
      required_skills: ['Product', '', { label: 'bad' }, 'SQL'],
      preferred_skills: 'Python',
      screener_questions: [
        null,
        { id: 'q1', prompt: 'Eligible to work?', type: 'yes_no', expected: 'no' },
      ],
      visa_sponsorship: 'yes',
      relocation: true,
    } as unknown as JobPosting;

    const normalized = normalizeJobPostingForClient(dirty);

    expect(normalized.title).toBe('');
    expect(normalized.company_name).toBeNull();
    expect(normalized.organization_verification).toBe('unverified_self_reported');
    expect(normalized.location).toBe('Ottawa');
    expect(normalized.is_active).toBe(true);
    expect(normalized.required_skills).toEqual(['Product', 'SQL']);
    expect(normalized.preferred_skills).toEqual([]);
    expect(normalized.screener_questions).toEqual([
      {
        id: 'q1',
        prompt: 'Eligible to work?',
        type: 'yes_no',
        required: false,
        expected: 'no',
      },
    ]);
    expect(normalized.visa_sponsorship).toBe(false);
    expect(normalized.relocation).toBe(true);
  });
});
