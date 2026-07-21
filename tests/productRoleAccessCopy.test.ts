import { describe, expect, it } from 'vitest';
import { PRODUCT_ROLE_ACCESS } from '../lib/access/permissions';

describe('admin product-role overview', () => {
  it('does not advertise hidden user API-key or BYOA surfaces', () => {
    const copy = Object.values(PRODUCT_ROLE_ACCESS).flatMap((role) => role.access).join(' ');
    expect(copy).not.toMatch(/Personal API keys|Custom AI endpoint|BYOA/i);
  });

  it('states that paid candidate tools retain usage controls', () => {
    expect(PRODUCT_ROLE_ACCESS.candidate_paid.access.join(' ')).toMatch(/Credit and per-tool limits still apply/i);
  });
});
