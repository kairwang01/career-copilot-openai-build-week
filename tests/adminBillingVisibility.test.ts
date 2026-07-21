import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('admin billing launch visibility', () => {
  it('hides the placeholder sidebar destination and keeps ADMIN_TAB_HELP accurate', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'components/admin/AdminPortal.tsx'),
      'utf8',
    );

    expect(source).toMatch(/id: 'billing', label: 'Billing', visible: false/);
    expect(source).toContain('Feature in development and intentionally hidden from the production sidebar.');
    expect(source).toContain('subscription overrides remain available from Users');
  });
});
