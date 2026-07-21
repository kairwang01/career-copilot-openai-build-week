import { describe, expect, it } from 'vitest';
import { isSampleAccountMutationEnabled } from '../functions/src/handlers/adminPortal';
import { hasAdminPermission } from '../lib/access/permissions';

describe('sample-account mutation safety', () => {
  it('allows the Firebase emulator without production flags', () => {
    expect(isSampleAccountMutationEnabled({ FUNCTIONS_EMULATOR: 'true' })).toBe(true);
  });

  it('fails closed for production-like environments and partial configuration', () => {
    expect(isSampleAccountMutationEnabled({ GCLOUD_PROJECT: 'production-project' })).toBe(false);
    expect(isSampleAccountMutationEnabled({
      GCLOUD_PROJECT: 'production-project',
      ALLOW_SAMPLE_ACCOUNT_MUTATION: 'true',
    })).toBe(false);
    expect(isSampleAccountMutationEnabled({
      GCLOUD_PROJECT: 'production-project',
      ALLOW_SAMPLE_ACCOUNT_MUTATION: 'true',
      SAMPLE_ACCOUNT_PROJECT_ID: 'different-project',
    })).toBe(false);
  });

  it('requires both explicit flags to match the current non-emulator project', () => {
    expect(isSampleAccountMutationEnabled({
      GCLOUD_PROJECT: 'qa-project',
      ALLOW_SAMPLE_ACCOUNT_MUTATION: 'true',
      SAMPLE_ACCOUNT_PROJECT_ID: 'qa-project',
    })).toBe(true);
  });

  it('exposes the UI capability only to super administrators', () => {
    expect(hasAdminPermission('reviewer', 'admin.users.sample.create')).toBe(false);
    expect(hasAdminPermission('admin', 'admin.users.sample.create')).toBe(false);
    expect(hasAdminPermission('super', 'admin.users.sample.create')).toBe(true);
  });
});
