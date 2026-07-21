import { describe, expect, it } from 'vitest';
import { safeHttpUrl, safeUrl } from '../lib/safeUrl';

describe('untrusted URL rendering', () => {
  it('allows expected links and upgrades bare web domains', () => {
    expect(safeHttpUrl('https://example.com/path')).toBe('https://example.com/path');
    expect(safeHttpUrl('www.example.com/jobs')).toBe('https://www.example.com/jobs');
    expect(safeUrl('mailto:help@example.com')).toBe('mailto:help@example.com');
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'mailto:attacker@example.com',
    'https://',
    'https://exa mple.com',
  ])('blocks %s from http-only links', (value) => {
    expect(safeHttpUrl(value)).toBe('');
  });

  it('routes stored AI and profile URLs through the http-only guard', async () => {
    const { readFile } = await import('node:fs/promises');
    const root = new URL('../', import.meta.url);
    const opportunity = await readFile(new URL('components/tools/OpportunityFinder.tsx', root), 'utf8');
    const upload = await readFile(new URL('components/UploadSection.tsx', root), 'utf8');
    expect(opportunity).toContain('href={safeHttpUrl(o.url)}');
    expect(upload).toContain('href={safeHttpUrl(storedResumeFile?.url)}');
  });
});
