import { describe, expect, it } from 'vitest';

import { requireAnyAuth, requireAuth } from '../functions/src/middleware/auth';

const request = (emailVerified?: boolean) => ({
  auth: {
    uid: 'user-1',
    token: emailVerified === undefined ? {} : { email_verified: emailVerified },
  },
}) as never;

describe('callable email-verification boundary', () => {
  it('allows verified product identities', () => {
    expect(requireAuth(request(true))).toBe('user-1');
  });

  it('fails closed for an unverified or unsupported identity', () => {
    expect(() => requireAuth(request(false))).toThrow(/verify your email/i);
    expect(() => requireAuth(request())).toThrow(/verify your email/i);
  });

  it('keeps the narrow bootstrap and billing path available before verification', () => {
    expect(requireAnyAuth(request(false))).toBe('user-1');
  });

  it('still rejects a missing Firebase auth context', () => {
    expect(() => requireAuth({ auth: null } as never)).toThrow(/signed in/i);
    expect(() => requireAnyAuth({ auth: null } as never)).toThrow(/signed in/i);
  });
});
