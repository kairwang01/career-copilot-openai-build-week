import { describe, expect, it } from 'vitest';
import { shouldCapFreeTierOutput } from '../functions/src/llm/models';

describe('business model output-cap policy', () => {
  it('caps ordinary free candidates', () => {
    expect(shouldCapFreeTierOutput('free', false)).toBe(true);
  });

  it('does not cap employer accounts that share the free model catalog', () => {
    expect(shouldCapFreeTierOutput('free', true)).toBe(false);
  });

  it('does not cap paid candidate or business tiers', () => {
    expect(shouldCapFreeTierOutput('paid', false)).toBe(false);
    expect(shouldCapFreeTierOutput('business', true)).toBe(false);
  });
});
