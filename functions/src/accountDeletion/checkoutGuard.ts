/**
 * A deletion request is a durable tombstone for checkout and entitlement writes.
 * There is currently no cancellation workflow, so any stored request must fail
 * closed. This prevents delayed payment webhooks and still-valid Auth tokens from
 * recreating account state after an administrator starts deletion.
 */
export function accountDeletionRequestBlocksCheckout(raw: unknown): boolean {
  return raw !== undefined && raw !== null;
}

export const ACCOUNT_DELETION_CHECKOUT_MESSAGE =
  "This account has an active or completed deletion request and cannot accept purchases.";
