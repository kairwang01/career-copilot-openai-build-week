import { describe, it, expect } from 'vitest';
import { stripMarkdownLite } from '../components/MarkdownLite';

describe('stripMarkdownLite', () => {
  it('strips headings, bullets, and inline emphasis for clamped previews', () => {
    const md = [
      '## Role Overview',
      'We are looking for a **senior** engineer.',
      '',
      '### Responsibilities',
      '- Build `React` features',
      '* Ship *quality* code',
      '1. Mentor teammates',
    ].join('\n');
    expect(stripMarkdownLite(md)).toBe(
      'Role Overview We are looking for a senior engineer. Responsibilities Build React features Ship quality code Mentor teammates',
    );
  });

  it('passes plain text through unchanged', () => {
    expect(stripMarkdownLite('A plain description with no markup.')).toBe(
      'A plain description with no markup.',
    );
  });

  it('collapses blank lines instead of leaking empty segments', () => {
    expect(stripMarkdownLite('First\n\n\nSecond')).toBe('First Second');
  });
});
