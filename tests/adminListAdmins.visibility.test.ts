import { describe, expect, it } from 'vitest';
import { buildAdminRoleAccessPatch, filterAdminRowsForViewer, profileAvatarUrl } from '../functions/src/handlers/adminPortal';

type Rows = Parameters<typeof filterAdminRowsForViewer>[0];

const rows: Rows = [
  { uid: 'reviewer-active', email: 'reviewer@example.com', role: 'reviewer', status: 'active', invited_at: null, source: 'rbac' },
  { uid: 'reviewer-disabled', email: 'off@example.com', role: 'reviewer', status: 'disabled', invited_at: null, source: 'rbac' },
  { uid: 'admin-active', email: 'admin@example.com', role: 'admin', status: 'active', invited_at: null, source: 'rbac' },
  { uid: 'super-active', email: 'super@example.com', role: 'super', status: 'active', invited_at: null, source: 'rbac' },
  { uid: 'legacy-admin', email: 'legacy@example.com', role: 'admin', status: 'active', invited_at: null, source: 'legacy_doc' },
  { uid: 'env-super', email: 'env@example.com', role: 'super', status: 'active', invited_at: null, source: 'env' },
];

describe('adminListAdmins visibility', () => {
  it('plain admin sees all reviewers only', () => {
    expect(filterAdminRowsForViewer(rows, 'admin').map((row) => row.uid)).toEqual([
      'reviewer-active',
      'reviewer-disabled',
    ]);
  });

  it('super sees reviewer, admin, and super entries', () => {
    expect(filterAdminRowsForViewer(rows, 'super').map((row) => row.uid)).toEqual(rows.map((row) => row.uid));
  });

  it('reviewer sees no console-user list', () => {
    expect(filterAdminRowsForViewer(rows, 'reviewer')).toEqual([]);
  });

  it('uses the profile avatar_url field used by the admin account page', () => {
    expect(profileAvatarUrl({ avatar_url: 'https://cdn.example.com/avatar.png' })).toBe('https://cdn.example.com/avatar.png');
  });

  it('falls back to the Firebase Auth photo URL', () => {
    expect(profileAvatarUrl({}, { photoURL: 'https://cdn.example.com/auth.png' } as any)).toBe('https://cdn.example.com/auth.png');
  });

  it('promotes legacy admin_uids entries into RBAC when changing role', () => {
    expect(buildAdminRoleAccessPatch({}, ['legacy-admin', 'other-admin'], 'legacy-admin', 'reviewer')).toEqual({
      admins: { 'legacy-admin': { role: 'reviewer', status: 'active' } },
      admin_uids: ['other-admin'],
    });
  });
});
