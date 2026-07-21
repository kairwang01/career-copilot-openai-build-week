import { describe, expect, it } from 'vitest';
import {
  interviewConsistency,
  keywordAgreement,
  scoreResumeAgreement,
  stddev,
  summarize,
  withinScoreBand,
} from '../evals/scoring';

describe('eval scoring — M7 resume agreement', () => {
  it('keyword overlap is case/space-insensitive Jaccard', () => {
    expect(keywordAgreement(['React', 'TypeScript'], ['react', ' typescript '])).toBe(1);
    expect(keywordAgreement(['React'], ['React', 'Node'])).toBe(0.5);
    expect(keywordAgreement([], [])).toBe(1);
    expect(keywordAgreement(['a'], [])).toBe(0);
  });

  it('score band check', () => {
    expect(withinScoreBand(85, [80, 90])).toBe(true);
    expect(withinScoreBand(70, [80, 90])).toBe(false);
    expect(withinScoreBand(Number.NaN, [0, 100])).toBe(false);
  });

  it('passes only when keyword overlap AND score band both hold', () => {
    expect(scoreResumeAgreement({ score: 85, keywords: ['React', 'TS'] }, { keywords: ['react', 'ts'], scoreBand: [80, 90] }).pass).toBe(true);
    // good keywords, score out of band → fail
    expect(scoreResumeAgreement({ score: 50, keywords: ['React', 'TS'] }, { keywords: ['react', 'ts'], scoreBand: [80, 90] }).pass).toBe(false);
    // in band, poor keywords → fail
    expect(scoreResumeAgreement({ score: 85, keywords: ['Cooking'] }, { keywords: ['react', 'ts'], scoreBand: [80, 90] }).pass).toBe(false);
  });
});

describe('eval scoring — M8 interview consistency', () => {
  it('identical scores ⇒ consistency 1', () => {
    expect(stddev([80, 80, 80])).toBe(0);
    expect(interviewConsistency([80, 80, 80])).toBe(1);
  });

  it('spread scores reduce consistency', () => {
    expect(interviewConsistency([0, 100])).toBeLessThan(0.6);
    expect(interviewConsistency([78, 80, 82])).toBeGreaterThan(0.95);
  });

  it('single run is trivially consistent', () => {
    expect(interviewConsistency([88])).toBe(1);
  });
});

describe('eval scoring — summary', () => {
  it('aggregates pass rate + means', () => {
    const summary = summarize(
      [
        { keywordAgreement: 1, scoreInBand: true, pass: true },
        { keywordAgreement: 0.4, scoreInBand: false, pass: false },
      ],
      [1, 0.9],
    );
    expect(summary.m7PassRate).toBe(0.5);
    expect(summary.m7Agreement).toBeCloseTo(0.7, 5);
    expect(summary.m8Consistency).toBeCloseTo(0.95, 5);
  });
});
