import type { AdminRole } from './permissions';

/**
 * Preserve read-only access during a staged backend rollout, but never infer a
 * mutation-capable role when the authoritative role endpoint is unavailable.
 */
export const resolveRoleWithFallback = async (
  whoAmI: () => Promise<{ role: AdminRole }>,
): Promise<AdminRole> => {
  try {
    const result = await whoAmI();
    return result.role;
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code;
    if (code === 'functions/permission-denied' || code === 'functions/not-found') {
      return 'reviewer';
    }
    throw error;
  }
};
