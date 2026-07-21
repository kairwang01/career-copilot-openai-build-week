import { describe, expect, it, vi } from 'vitest';
import { resolveRoleWithFallback } from '../lib/access/adminRoleFallback';

describe('admin role lookup fallback', () => {
  it('uses the authoritative role when lookup succeeds', async () => {
    await expect(resolveRoleWithFallback(
      vi.fn(async () => ({ role: 'super' as const })),
    )).resolves.toBe('super');
  });

  it.each(['functions/permission-denied', 'functions/not-found'])(
    'fails closed to reviewer for %s during a degraded rollout',
    async (code) => {
      await expect(resolveRoleWithFallback(vi.fn(async () => {
        throw { code };
      }))).resolves.toBe('reviewer');
    },
  );

  it('does not hide unrelated role lookup failures', async () => {
    const error = new Error('network unavailable');
    await expect(resolveRoleWithFallback(vi.fn(async () => {
      throw error;
    }))).rejects.toBe(error);
  });
});
