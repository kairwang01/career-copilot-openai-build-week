/**
 * planCredits — authoritative map of subscription plan → monthly AI credit grant.
 *
 * MODEL (decided 2026-06-17): paid plans grant their allotment EVERY month and the
 * balance ACCUMULATES (unused credits never expire — matches the pricing-page copy
 * "Unused credits never expire"). The grant is applied:
 *   1. immediately when a user selects/changes a plan (setSubscriptionStatus), and
 *   2. once per calendar month thereafter by the grantMonthlyCredits scheduled fn.
 *
 * Idempotency is tracked OUTSIDE the users/{uid} doc — in a server-only
 * `credit_renewals/{uid}` doc — so we never add a field to users/{uid} that the
 * client-side firestore.rules `validUser` allowlist would reject on the next
 * profile update.
 *
 * The numbers mirror the frontend pricing copy (localization en.json + marketing/
 * config/pricingPlans.ts). If a plan's advertised credits change, update BOTH.
 *
 *   Candidate:  free 30 · essentials 300 · accelerator 1000 · executive 3000
 *               ($19/$39/$79 CAD mo for paid candidate plans)
 *   Business:   starter 3000 · growth 8000 · pro 20000             ($79/$199/$499 mo)
 *
 * `free` has a small monthly refill; signup still gets a larger one-time
 * 150-credit grant at onUserCreated. The one-time add-on
 * SKUs (single_post, job_pack) are job-posting purchases, NOT AI credits, so they
 * grant nothing here.
 */

import { getMonthlyCreditGrant } from "../config/env";
import { DEFAULT_PLAN_QUOTAS, PLAN_KEYS } from "../admin/quotaDefaults";

/** Default recurring monthly AI-credit allotment per plan key (bare key, prefixes stripped). */
export const PLAN_MONTHLY_CREDITS: Record<string, number> = {
  ...Object.fromEntries(PLAN_KEYS.map((key) => [key, DEFAULT_PLAN_QUOTAS[key].monthly_credit_grant])),
};

/** Monthly allotment for a plan, 0 if the plan grants no recurring credits. */
export function monthlyCreditsFor(plan: string): number {
  return getMonthlyCreditGrant(plan);
}

/** Current grant period as "YYYY-MM" (UTC). One grant per plan per period. */
export function currentCreditPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Server-only collection tracking the last monthly grant per user. */
export const CREDIT_RENEWALS_COLLECTION = "credit_renewals";
