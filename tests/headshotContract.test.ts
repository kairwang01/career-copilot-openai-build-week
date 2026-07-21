import { describe, expect, it } from 'vitest';
import { extractImageVariants } from '../functions/src/handlers/generateHeadshot';

describe('headshot response contract', () => {
  it('preserves real MIME types and ignores text and thought images', () => {
    expect(extractImageVariants([
      { text: 'preview' },
      { thought: true, inlineData: { data: 'draft', mimeType: 'image/png' } },
      { inlineData: { data: 'final-jpeg', mimeType: 'image/jpeg' } },
      { inlineData: { data: 'final-webp', mimeType: 'image/webp' } },
    ])).toEqual([
      { data: 'final-jpeg', mimeType: 'image/jpeg' },
      { data: 'final-webp', mimeType: 'image/webp' },
    ]);
  });
});
