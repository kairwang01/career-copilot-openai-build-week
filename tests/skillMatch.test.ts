/**
 * Unit tests for the shared skill matcher used by Apply Review (candidate) and
 * the Applicant Packet checklist (employer). Pure — no emulator.
 */
import { describe, expect, it } from 'vitest';
import { collectCandidateSkills, matchSkills } from '../lib/skillMatch';
import type { TalentProfile } from '../lib/talentProfile';

const profile = (skills: Record<string, string[]>) => ({ skills } as unknown as TalentProfile);

describe('collectCandidateSkills', () => {
  it('flattens all groups and de-dups case-insensitively', () => {
    expect(collectCandidateSkills(profile({ a: ['React', 'react', ' TypeScript '], b: ['Node.js'] })))
      .toEqual(['React', 'TypeScript', 'Node.js']);
  });
  it('handles null / empty', () => {
    expect(collectCandidateSkills(null)).toEqual([]);
    expect(collectCandidateSkills(profile({}))).toEqual([]);
  });
  it('ignores malformed skill groups from legacy profile data', () => {
    const dirty = {
      skills: {
        technical: ['React', { label: 'bad' }, ' SQL '],
        tools: { primary: 'Jira' },
        languages: 'English',
      },
    } as unknown as TalentProfile;

    expect(collectCandidateSkills(dirty)).toEqual(['React', 'SQL']);
  });
});

describe('matchSkills', () => {
  it('matches case / spacing / punctuation insensitively', () => {
    const r = matchSkills(['react', 'Type Script', 'node.js'], ['React', 'TypeScript', 'Node.js']);
    expect(r.matched.sort()).toEqual(['Node.js', 'React', 'TypeScript']);
    expect(r.missing).toEqual([]);
    expect(r.matchedCount).toBe(3);
    expect(r.requiredCount).toBe(3);
  });
  it('keeps C++ and C# distinct (no collapse)', () => {
    const r = matchSkills(['C++'], ['C++', 'C#']);
    expect(r.matched).toEqual(['C++']);
    expect(r.missing).toEqual(['C#']);
  });
  it('reports missing required skills the candidate lacks', () => {
    const r = matchSkills(['React'], ['React', 'Kubernetes', 'Go']);
    expect(r.matched).toEqual(['React']);
    expect(r.missing.sort()).toEqual(['Go', 'Kubernetes']);
    expect(r.matchedCount).toBe(1);
    expect(r.requiredCount).toBe(3);
  });
  it('de-dups required skills and tolerates empty input', () => {
    expect(matchSkills([], []).requiredCount).toBe(0);
    expect(matchSkills(['x'], null).requiredCount).toBe(0);
    expect(matchSkills(['React'], ['React', 'react', 'REACT']).requiredCount).toBe(1);
  });
});
