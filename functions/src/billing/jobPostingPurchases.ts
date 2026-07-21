/**
 * One-time posting SKUs remain readable for legacy entitlement fulfillment, but
 * new purchases are closed until a consumable-credit ledger and listing expiry
 * are enforced server-side.
 */
const LEGACY_JOB_POSTING_PURCHASE_PLANS = new Set(["single_post", "job_pack"]);

export const JOB_POSTING_PURCHASE_UNAVAILABLE_MESSAGE =
  "One-time job-post purchases are unavailable until posting credits and listing expiry are enforced.";

export function isLegacyJobPostingPurchasePlan(value: unknown): boolean {
  return typeof value === "string" && LEGACY_JOB_POSTING_PURCHASE_PLANS.has(value.trim());
}
