import { describe, expect, it } from 'vitest';

import { getAdminPromptAudience } from '../lib/adminPromptAudience';

describe('admin prompt audience classification', () => {
  it('keeps agency prompts separate from employer prompts', () => {
    expect(getAdminPromptAudience('anonymizeResume', 'Agency Hub')).toBe('agency');
    expect(getAdminPromptAudience('generateClientPitchEmail', 'Agency Hub')).toBe('agency');
  });

  it('keeps explicitly shared agency/candidate prompts shared', () => {
    expect(getAdminPromptAudience('generateCandidatePrepKit', 'Agency Hub + Interview Prep')).toBe('shared');
  });

  it('classifies admin and internal modules before the candidate fallback', () => {
    expect(getAdminPromptAudience('generateOpsSummary', 'Admin Operations')).toBe('admin');
    expect(getAdminPromptAudience('handler_internal_report', 'Internal Reporting')).toBe('admin');
  });

  it('preserves employer, legacy, and candidate behavior', () => {
    expect(getAdminPromptAudience('generateJobDescription', 'Employer Job Posting')).toBe('employer');
    expect(getAdminPromptAudience('analyzeCandidateMatch', 'Applicant Funnel')).toBe('employer');
    expect(getAdminPromptAudience('generateOutreachEmail', 'Legacy Outreach')).toBe('legacy');
    expect(getAdminPromptAudience('generatePortfolioWebsite', 'Portfolio Website Builder')).toBe('candidate');
  });
});
