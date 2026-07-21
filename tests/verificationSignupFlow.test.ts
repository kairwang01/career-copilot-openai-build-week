import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const candidateSource = readFileSync(new URL('../components/Auth.tsx', import.meta.url), 'utf8');
const businessSource = readFileSync(
  new URL('../components/business/BusinessSignUpModal.tsx', import.meta.url),
  'utf8',
);

describe('post-signup verification requests', () => {
  it('uses the exact newly created user instead of a later global auth user', () => {
    expect(candidateSource).toContain('sendAccountVerificationEmail(authData)');
    expect(businessSource).toContain('sendAccountVerificationEmail(authData)');
    expect(candidateSource).not.toMatch(/sendAccountVerificationEmail\(firebaseAuth\.currentUser\)/);
    expect(businessSource).not.toMatch(/sendAccountVerificationEmail\(firebaseAuth\.currentUser\)/);
  });

  it('does not claim a request was accepted after Firebase rejects it', () => {
    expect(candidateSource).toMatch(/if \(verificationRequested\) \{[\s\S]*auth_signup_success_verify/);
    expect(businessSource).toMatch(/if \(verificationRequested\) addToast\(t\('auth_signup_success_verify'\)/);
    expect(candidateSource).toContain("addToast(t('verify_gate_send_failed'), 'error')");
    expect(businessSource).toContain("addToast(t('verify_gate_send_failed'), 'error')");
  });

  it('locks the employer create form immediately after the account exists', () => {
    expect(businessSource).toMatch(/if \(authData\) \{[\s\S]*setCompleted\(true\);/);
    expect(businessSource).toMatch(/\{completed \? \([\s\S]*disabled=\{loading\}/);
  });
});
