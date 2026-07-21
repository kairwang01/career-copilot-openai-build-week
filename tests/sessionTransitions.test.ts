/**
 * Locks the session-transition decision CareerApp uses to react to SessionProvider
 * (instead of a private auth subscription). These cases mirror the SIGNED_IN /
 * SIGNED_OUT / token-refresh branches of the old onAuthStateChange handler.
 */
import { describe, it, expect } from 'vitest';
import { decideSessionTransition } from '../lib/access/sessionTransitions';

describe('decideSessionTransition', () => {
  it('same signed-in user → none (token refresh / tab refocus, no view reset)', () => {
    expect(decideSessionTransition('u1', 'u1')).toBe('none');
  });

  it('logged-out staying logged-out → none', () => {
    expect(decideSessionTransition(null, null)).toBe('none');
  });

  it('a new user appears → signed_in (fresh sign-in)', () => {
    expect(decideSessionTransition(null, 'u1')).toBe('signed_in');
  });

  it('the user disappears → signed_out (cleanup)', () => {
    expect(decideSessionTransition('u1', null)).toBe('signed_out');
  });

  it('switching directly between two accounts → signed_in', () => {
    expect(decideSessionTransition('u1', 'u2')).toBe('signed_in');
  });
});
