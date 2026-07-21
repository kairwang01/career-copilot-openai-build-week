import { describe, expect, it } from 'vitest';
import {
  normalizeCareerPathResult,
  normalizeInterviewSessionReport,
  normalizeOpportunityResult,
} from '../lib/aiResultGuards';

describe('AI result guards', () => {
  it('turns missing opportunity arrays into render-safe empty arrays', () => {
    expect(normalizeOpportunityResult({ notice: 'Partial response' })).toEqual({
      opportunities: [],
      jobSearchStrategies: [],
      groundingChunks: undefined,
      notice: 'Partial response',
    });
  });

  it('keeps valid opportunities and drops malformed entries', () => {
    const result = normalizeOpportunityResult({
      opportunities: [null, { jobTitle: 'Engineer', url: 'https://example.com/job' }],
      jobSearchStrategies: ['Search directly', null],
    });
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0]).toMatchObject({ jobTitle: 'Engineer', company: '', location: '' });
    expect(result.jobSearchStrategies).toEqual(['Search directly']);
  });

  it('normalizes missing and nested career-path arrays', () => {
    const result = normalizeCareerPathResult({
      summary: 'Plan',
      roadmap: [{ phaseTitle: 'Start', actionableSteps: [{ description: 'Learn' }] }],
    });
    expect(result.overallSkillGaps).toEqual([]);
    expect(result.bridgeRoles).toEqual([]);
    expect(result.roadmap[0].milestones).toEqual([]);
    expect(result.roadmap[0].actionableSteps[0]).toMatchObject({ type: 'self-study', resources: [] });
  });

  it('cleans skill-gap text and drops blank or duplicate entries', () => {
    const result = normalizeCareerPathResult({
      overallSkillGaps: [
        { skill: '  Data   storytelling ', reason: ' Turn findings into\n\n\n clear decisions.  ' },
        { skill: 'data storytelling', reason: 'Duplicate' },
        { skill: 'SQL', reason: '   ' },
        { skill: {}, reason: 'Malformed' },
      ],
    });

    expect(result.overallSkillGaps).toEqual([{
      skill: 'Data storytelling',
      reason: 'Turn findings into\n\n clear decisions.',
    }]);
  });

  it('normalizes incomplete interview reports before persistence and export', () => {
    const result = normalizeInterviewSessionReport({ overallScore: 82, summary: 'Good session' });
    expect(result).toMatchObject({
      overallScore: 82,
      summary: 'Good session',
      strengths: [],
      improvements: [],
      perQuestion: [],
    });
  });
});
