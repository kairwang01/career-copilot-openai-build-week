import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

describe('business role provenance launch controls', () => {
  it('keeps the production audit read-only, explicitly targeted, and PII-safe', () => {
    const source = readFileSync(
      resolve(root, 'functions', 'scripts', 'auditBusinessRoleProvenance.js'),
      'utf8',
    );
    expect(source).toContain('--project=<exact-project-id>');
    expect(source).toContain('.where("role", "==", role).stream()');
    expect(source).toContain('crypto.createHash("sha256")');
    expect(source).not.toMatch(/\b(?:batch|transaction|document|ref)\.(?:set|update|delete|create)\(/);
    expect(source).not.toMatch(/console\.log\([^\n]*(email|uid|company_name)/i);
  });

  it('records provenance and explicit unverified organization state at business signup', () => {
    const source = readFileSync(
      resolve(root, 'functions', 'src', 'handlers', 'setSubscriptionStatus.ts'),
      'utf8',
    );
    expect(source).toContain('"business_signup_callable"');
    expect(source).toContain('[USER_FIELDS.organizationVerified] = false');
    expect(source).toContain('[USER_FIELDS.roleProvisionedAt] = now');
  });
});
