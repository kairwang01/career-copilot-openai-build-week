import { describe, expect, it } from 'vitest';
import { lexicalKeywordOverlapScore } from '../lib/keywordOverlap';

describe('lexicalKeywordOverlapScore', () => {
  it('does not inflate a posting with no shared terms', () => {
    expect(lexicalKeywordOverlapScore('React TypeScript', 'Payroll compliance accountant')).toBe(0);
  });

  it('scores unique posting terms and ignores common stop words', () => {
    expect(lexicalKeywordOverlapScore(
      'Built React services with TypeScript',
      'The React, TypeScript, and GraphQL',
    )).toBe(67);
  });

  it('supports overlapping CJK terms without fabricating a minimum score', () => {
    expect(lexicalKeywordOverlapScore('软件工程师开发平台', '招聘软件工程师')).toBeGreaterThan(0);
    expect(lexicalKeywordOverlapScore('软件工程师', '财务审计')).toBe(0);
  });

  it('returns zero when either side has no meaningful terms', () => {
    expect(lexicalKeywordOverlapScore('', 'React developer')).toBe(0);
    expect(lexicalKeywordOverlapScore('React developer', 'the and for')).toBe(0);
  });
});
