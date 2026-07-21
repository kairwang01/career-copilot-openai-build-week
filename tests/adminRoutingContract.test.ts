import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('admin model-routing contract', () => {
  it('fails closed when an old backend omits authoritative routing fields', () => {
    const client = fs.readFileSync(path.join(process.cwd(), 'services/adminClient.ts'), 'utf8');
    const portal = fs.readFileSync(path.join(process.cwd(), 'components/admin/AdminPortal.tsx'), 'utf8');

    expect(client).not.toContain('DEFAULT_SPEED_POOL_MEMBERS');
    expect(client).not.toContain('DEFAULT_MODULE_ROUTES');
    expect(client).toContain('if (!routingPools || !moduleRoutes)');
    expect(client).toContain('authoritative model-routing contract');
    expect(portal).toContain('fails closed instead of inventing client-side defaults');
  });

  it('keeps missing-key recovery wired to the current shared-credentials editor', () => {
    const portal = fs.readFileSync(path.join(process.cwd(), 'components/admin/AdminPortal.tsx'), 'utf8');
    const recoveryE2e = fs.readFileSync(path.join(process.cwd(), 'e2e/admin-keys-recovery.spec.ts'), 'utf8');

    expect(portal).toContain("openAdminTab('ai', { modelSection: 'credentials' })");
    expect(portal).toContain('modelSectionRefs.current[initialTarget]?.scrollIntoView');
    expect(portal).toContain('data-qa="shared-credentials-section"');
    expect(portal).toContain('saved successfully.');
    expect(recoveryE2e).not.toContain("locator('#provider-select')");
    expect(recoveryE2e).toContain("getByLabel('New shared API key')");
    expect(recoveryE2e).toContain("getByRole('status')");
  });
});
