export const ACCOUNT_DELETION_REQUESTS_COLLECTION = "account_deletion_requests";

export type AccountDeletionCleanupCategory =
  | "firestore_user_subcollection"
  | "firestore_shared_record"
  | "firestore_financial_record"
  | "storage_prefix"
  | "stripe_record";

export interface AccountDeletionPendingCleanup {
  category: AccountDeletionCleanupCategory;
  resource: string;
  selector: string;
  disposition: "retain_pending_policy" | "external_action_required";
  reason: string;
}

export interface AccountDeletionResult {
  uid: string;
  email: string | null;
  deleted_auth: boolean;
  deleted_profile: boolean;
  deleted_private_credentials: boolean;
  auth_absent: boolean;
  profile_absent: boolean;
  pending_cleanup: AccountDeletionPendingCleanup[];
  already_deleted?: boolean;
}

export interface AccountDeletionBillingBlocker {
  code: "active_or_unresolved_recurring_billing";
  provider: string;
  subscription_reference_present: boolean;
  payment_status: string | null;
}

const CLOSED_BILLING_STATUSES = new Set(["cancelled", "cancelled_simulated", "inactive"]);

export function accountDeletionBillingBlocker(raw: unknown): AccountDeletionBillingBlocker | null {
  if (!raw || typeof raw !== "object") return null;
  const billing = raw as Record<string, unknown>;
  const active = billing.active === true;
  const mode = typeof billing.mode === "string" ? billing.mode : null;
  const status = typeof billing.status === "string" ? billing.status : null;
  const subscriptionId = typeof billing.stripe_subscription_id === "string"
    ? billing.stripe_subscription_id
    : "";
  const hasSubscriptionReference = subscriptionId.startsWith("sub_") || subscriptionId.startsWith("sim_sub_");
  const looksRecurring = mode === "subscription" || hasSubscriptionReference;
  const explicitlyClosed = billing.active === false && status !== null && CLOSED_BILLING_STATUSES.has(status);
  const activeAmbiguousBilling = active && mode !== "payment";

  if ((!looksRecurring || explicitlyClosed) && !activeAmbiguousBilling) return null;
  return {
    code: "active_or_unresolved_recurring_billing",
    provider: typeof billing.provider === "string" ? billing.provider : "unknown",
    subscription_reference_present: hasSubscriptionReference,
    payment_status: typeof billing.payment_status === "string" ? billing.payment_status : null,
  };
}

export type AccountDeletionClaimDecision<TResult = AccountDeletionResult> =
  | { action: "claim" }
  | { action: "pending" }
  | { action: "completed"; result: TResult };

export function decideAccountDeletionClaim<TResult>(
  current: Record<string, unknown> & { result?: TResult } | undefined,
  nowMs: number,
): AccountDeletionClaimDecision<TResult> {
  if (current?.status === "completed" && current.result !== undefined) {
    return { action: "completed", result: current.result };
  }
  if (
    current?.status === "deleting" &&
    typeof current.lease_expires_at_ms === "number" &&
    current.lease_expires_at_ms > nowMs
  ) {
    return { action: "pending" };
  }
  return { action: "claim" };
}

/** Reopens legacy completed tombstones once so newly private credentials are scrubbed. */
export function completedAccountDeletionRequiresCredentialCleanup(
  current: (Record<string, unknown> & { result?: Partial<AccountDeletionResult> }) | undefined,
): boolean {
  return current?.status === "completed" && current.result?.deleted_private_credentials !== true;
}

const SHARED_RECORDS: ReadonlyArray<[resource: string, selector: (uid: string) => string]> = [
  ["talent_profiles", (uid) => `document id == ${uid}`],
  ["portfolio_drafts", (uid) => `document id == ${uid}`],
  ["job_postings", (uid) => `employer_id == ${uid}`],
  ["job_posting_events", (uid) => `employer_id == ${uid}`],
  ["job_applications", (uid) => `candidate_id == ${uid} OR employer_id == ${uid}`],
  ["application_snapshots", (uid) => `candidate_id == ${uid} OR employer_id == ${uid}`],
  ["application_status_events", (uid) => `candidate_id == ${uid} OR employer_id == ${uid}`],
  ["application_interviews", (uid) => `candidate_id == ${uid} OR employer_id == ${uid}`],
  ["application_scorecards", (uid) => `candidate_id == ${uid} OR employer_id == ${uid}`],
  ["application_messages", (uid) => `candidate_id == ${uid} OR employer_id == ${uid} OR sender_uid == ${uid}`],
  ["company_reviews", (uid) => `author_uid == ${uid} OR employer_id == ${uid}`],
  ["sourcing_outreach", (uid) => `candidate_id == ${uid} OR employer_id == ${uid}`],
  ["sourcing_candidate_packets", (uid) => `candidate_id == ${uid} OR employer_id == ${uid}`],
  ["sourcing_outreach_pair_guards", (uid) => `candidate_id == ${uid} OR employer_id == ${uid}`],
  ["sourcing_outreach_daily_quotas", (uid) => `employer_id == ${uid} (TTL also applies)`],
  ["active_job_counters", (uid) => `document id == ${uid}`],
  ["employer_responsiveness", (uid) => `document id == ${uid}`],
  ["employer_rating", (uid) => `document id == ${uid}`],
  ["mail", () => "account email (not uid-addressable; policy lookup required)"],
];

const FINANCIAL_RECORDS: ReadonlyArray<[resource: (uid: string) => string, selector: (uid: string) => string]> = [
  [(uid) => `billing/${uid}`, () => "document id == uid"],
  [(uid) => `credit_renewals/${uid}`, () => "document id == uid"],
  [() => "usage_events", (uid) => `uid == ${uid}`],
  [() => "usage_counters", (uid) => `user counter document id encodes ${uid}`],
  [() => "credit_ledger", (uid) => `uid == ${uid}`],
  [() => "credit_purchases", (uid) => `uid == ${uid}`],
  [() => "billing_checkout_intents", (uid) => `uid == ${uid}`],
  [() => "billing_fulfillment_reviews", (uid) => `uid == ${uid}`],
  [() => "credit_refund_reviews", (uid) => `uid == ${uid}`],
  [() => "usage_counter_reconciliation_reviews", (uid) => `uid == ${uid}`],
  [() => "admin_audit_log", (uid) => `target_uid == ${uid} OR admin_uid == ${uid}`],
];

export function buildAccountDeletionPendingCleanup(input: {
  uid: string;
  userSubcollections: string[];
}): AccountDeletionPendingCleanup[] {
  const items: AccountDeletionPendingCleanup[] = [];
  for (const collectionId of [...new Set(input.userSubcollections)].sort()) {
    items.push({
      category: "firestore_user_subcollection",
      resource: `users/${input.uid}/${collectionId}`,
      selector: "all documents",
      disposition: "retain_pending_policy",
      reason: "User-owned data remains after deleting the parent profile; retention or erasure needs policy approval.",
    });
  }
  for (const [resource, selector] of SHARED_RECORDS) {
    items.push({
      category: "firestore_shared_record",
      resource,
      selector: selector(input.uid),
      disposition: "retain_pending_policy",
      reason: "The record may affect another user or hiring history and is not safe to erase without a retention rule.",
    });
  }
  for (const [resource, selector] of FINANCIAL_RECORDS) {
    items.push({
      category: "firestore_financial_record",
      resource: resource(input.uid),
      selector: selector(input.uid),
      disposition: "retain_pending_policy",
      reason: "Financial, metering, or audit data is retained until an approved retention/anonymization policy exists.",
    });
  }
  for (const prefix of [
    `avatars/${input.uid}/`,
    `company-logos/${input.uid}/`,
    `resumes/${input.uid}/`,
    `portfolio-sites/${input.uid}/`,
  ]) {
    items.push({
      category: "storage_prefix",
      resource: prefix,
      selector: "all objects under prefix",
      disposition: "retain_pending_policy",
      reason: "Object erasure is deferred because media/resume retention and shared-use policy is not defined.",
    });
  }
  items.push({
    category: "storage_prefix",
    resource: "application_resumes/{applicationId}/",
    selector: `applications where candidate_id == ${input.uid}`,
    disposition: "retain_pending_policy",
    reason: "Frozen application resumes are shared hiring records and require an explicit retention rule.",
  });
  items.push({
    category: "stripe_record",
    resource: "Stripe customer/subscriptions/invoices",
    selector: "billing.stripe_customer_id / billing.stripe_subscription_id when present",
    disposition: "external_action_required",
    reason: "Stripe records are not erased or cancelled implicitly; active or unresolved recurring billing blocks deletion.",
  });

  const unique = new Map<string, AccountDeletionPendingCleanup>();
  for (const item of items) unique.set(`${item.category}:${item.resource}:${item.selector}`, item);
  return [...unique.values()].sort((a, b) =>
    `${a.category}:${a.resource}:${a.selector}`.localeCompare(`${b.category}:${b.resource}:${b.selector}`));
}
