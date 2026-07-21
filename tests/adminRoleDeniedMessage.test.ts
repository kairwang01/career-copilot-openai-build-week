import { describe, expect, it } from 'vitest';
import { adminRoleDeniedMessage } from '../functions/src/admin/roles';

describe('adminRoleDeniedMessage', () => {
  it('includes current role, required role, and capability context', () => {
    const message = adminRoleDeniedMessage('reviewer', 'admin');

    expect(message).toContain('Current admin role: reviewer.');
    expect(message).toContain('Required role: admin or higher.');
    expect(message).toContain('Reviewer can view the dashboard, audit log, and masked model routing settings.');
    expect(message).toContain('Admin can manage users');
  });
});
