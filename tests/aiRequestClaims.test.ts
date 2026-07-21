import { describe, expect, it } from 'vitest';
import { requireFreshToolRun } from '../functions/src/credits/deductCredits';

describe('AI tool request claims', () => {
  it('allows a newly claimed request to continue', () => {
    expect(() => requireFreshToolRun({ duplicate: false })).not.toThrow();
  });

  it('rejects a duplicate request before downstream work can start', () => {
    expect(() => requireFreshToolRun({ duplicate: true })).toThrowError(
      expect.objectContaining({ code: 'already-exists' }),
    );
  });
});
