/**
 * Pure decision for what a session change means, so CareerApp can react to the shared
 * SessionProvider instead of owning a Firebase auth subscription.
 *
 * The provider emits session VALUES, not SIGNED_IN/SIGNED_OUT events, so intent is
 * reconstructed from the signed-in user-id transition:
 *   - same id (incl. null → null)        → 'none'      (token refresh / tab refocus)
 *   - a (different) user id appears       → 'signed_in' (new sign-in or account switch)
 *   - the user id disappears (→ null)     → 'signed_out'
 *
 * The "initial restore" of an already-logged-in user (provider resolving from its
 * transient initial null to the real user on first load) is NOT a sign-in: the caller
 * captures a baseline on the provider's first `sessionResolved`, so this function only
 * ever sees post-baseline transitions.
 */
export type SessionTransition = 'none' | 'signed_in' | 'signed_out';

export function decideSessionTransition(
  prevUserId: string | null,
  nextUserId: string | null,
): SessionTransition {
  if (nextUserId === prevUserId) return 'none';
  if (nextUserId === null) return 'signed_out';
  return 'signed_in';
}
