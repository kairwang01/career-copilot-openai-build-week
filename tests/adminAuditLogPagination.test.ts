import { describe, expect, it } from 'vitest';
import { resolveAuditLogPageRequest } from '../functions/src/handlers/adminPortal';

describe('admin audit log pagination', () => {
  it('defaults to a small first page', () => {
    expect(resolveAuditLogPageRequest({})).toEqual({ limit: 25, start_after_id: undefined });
  });

  it('clamps page size and ignores invalid cursors', () => {
    expect(resolveAuditLogPageRequest({ limit: 999, start_after_id: '' })).toEqual({
      limit: 100,
      start_after_id: undefined,
    });
    expect(resolveAuditLogPageRequest({ limit: 0, start_after_id: 'audit-1' })).toEqual({
      limit: 1,
      start_after_id: 'audit-1',
    });
  });
});
