import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../components/admin/AdminPortal.tsx', import.meta.url), 'utf8');

describe('admin account removal disclosure', () => {
  it('does not present Auth/profile removal as full data erasure', () => {
    expect(source).toContain('this is not full data erasure');
    expect(source).toContain('Review retained resources');
    expect(source).toContain('active or unresolved recurring billing');
    expect(source).toContain('delayed checkout activation');
    expect(source).toContain('Remove login &amp; profile');
  });
});
