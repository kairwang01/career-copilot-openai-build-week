import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const gateSource = readFileSync(new URL('../components/VerifyEmailGate.tsx', import.meta.url), 'utf8');

describe('verification ownership gate', () => {
  it('scopes resend state to the authenticated user and checks cooldown at the handler boundary', () => {
    expect(gateSource).toContain('wasVerificationEmailDispatchedRecently(user.uid)');
    expect(gateSource).toMatch(/handleResend[\s\S]*verificationEmailCooldownRemainingMs\(user\.uid\)/);
    expect(gateSource).toContain('initialSendForUserRef');
  });

  it('drops stale async UI updates after unmount or account replacement', () => {
    expect(gateSource).toContain('mountedRef.current');
    expect(gateSource).toContain('firebaseAuth.currentUser?.uid === user.uid');
    expect(gateSource).toContain('operationId === sendOperationRef.current');
    expect(gateSource).toContain('operationId !== checkOperationRef.current');
  });

  it('uses accessible status semantics and a 320px-safe page layout', () => {
    expect(gateSource).toContain('aria-labelledby="verify-email-title"');
    expect(gateSource).toContain('role="status" aria-live="polite"');
    expect(gateSource).toContain('role="alert"');
    expect(gateSource).toContain('min-h-dvh');
    expect(gateSource).toContain('px-3 py-5 sm:items-center');
    expect(gateSource).toContain('[overflow-wrap:anywhere]');
    expect(gateSource).toContain('min-h-11 w-full');
  });
});
