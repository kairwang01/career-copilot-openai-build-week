import { describe, expect, it } from 'vitest';
import { projectAdminUserProfile } from '../functions/src/admin/userReportProjection';

describe('admin user report projection', () => {
  it('returns only the support fields the admin UI consumes', () => {
    const profile = projectAdminUserProfile(
      'user-123',
      {
        email: 'stale@example.com',
        full_name: 'Alex Example',
        company_name: 'Example Co',
        role: 'employer',
        subscription_status: 'starter',
        credits: 420,
        created_at: '2026-01-02T03:04:05.000Z',
        custom_provider: {
          base_url: 'https://llm.example.com',
          api_key: 'sk-secret-sentinel',
          model: 'private-model',
        },
        resume_text: 'private resume sentinel',
        resume_file_url: 'https://storage.example.com/private-resume.pdf',
        wallet_address: '0xsecretwallet',
        phone: '+1-555-private',
      },
      'verified@example.com',
    );

    expect(profile).toEqual({
      uid: 'user-123',
      email: 'verified@example.com',
      full_name: 'Alex Example',
      company_name: 'Example Co',
      role: 'employer',
      subscription_status: 'starter',
      credits: 420,
      created_at: '2026-01-02T03:04:05.000Z',
    });
  });

  it('never serializes secrets or unrelated PII from future profile fields', () => {
    const profile = projectAdminUserProfile('user-456', {
      custom_provider: { api_key: 'sk-secret-sentinel' },
      resume_text: 'private resume sentinel',
      arbitrary_future_secret: 'future-secret-sentinel',
      credits: 'not-a-number',
    });
    const serialized = JSON.stringify(profile);

    expect(serialized).not.toContain('sk-secret-sentinel');
    expect(serialized).not.toContain('private resume sentinel');
    expect(serialized).not.toContain('future-secret-sentinel');
    expect(profile).toEqual({
      uid: 'user-456',
      email: null,
      full_name: null,
      company_name: null,
      role: null,
      subscription_status: null,
      credits: null,
      created_at: null,
    });
  });
});
