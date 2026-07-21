/**
 * Stripe billing integration.
 *
 * This is the real-payment path that completes the entitlement gate introduced in
 * setSubscriptionStatus: the Stripe webhook writes billing/{uid} with the canonical
 * active/status/plan/audience/mode contract, then the existing plan-selection logic
 * activates role/credits from that server entitlement. Clients never write billing
 * docs directly.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import { randomUUID } from "node:crypto";
import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import Stripe from "stripe";
import { requireAnyAuth } from "../middleware/auth";
import { USERS_COLLECTION, USER_FIELDS, CREDIT_PACK_CREDITS } from "../credits/schema";
import { applySubscriptionSelection, assertPlanAllowedForRole } from "./setSubscriptionStatus";
import { ensurePlatformCaches, getAppBaseUrl } from "../admin/platformConfig";
import { billingPlanContractFor } from "../billing/entitlement";
import type { BillingAudience, BillingMode, BillingPlanContract } from "../billing/entitlement";
import {
  JOB_POSTING_PURCHASE_UNAVAILABLE_MESSAGE,
  isLegacyJobPostingPurchasePlan,
} from "../billing/jobPostingPurchases";
import { ACCOUNT_DELETION_REQUESTS_COLLECTION } from "../accountDeletion/plan";
import {
  ACCOUNT_DELETION_CHECKOUT_MESSAGE,
  accountDeletionRequestBlocksCheckout,
} from "../accountDeletion/checkoutGuard";
import {
  CheckoutIntentConflictError,
  CheckoutIntentPendingError,
  checkoutIntentDocumentId,
  checkoutIntentFingerprint,
  checkoutStripeIdempotencyKey,
  decideCheckoutIntent,
  executeCheckoutIntent,
  normalizeCheckoutOperationId,
  type CheckoutIntentStore,
  type CheckoutUiMode,
  type StoredCheckoutSessionResult,
} from "../billing/checkoutIntent";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const BILLING_COLLECTION = "billing";
const CHECKOUT_INTENTS_COLLECTION = "billing_checkout_intents";
const STRIPE_WEBHOOK_EVENTS_COLLECTION = "stripe_webhook_events";
const BILLING_FULFILLMENT_REVIEWS_COLLECTION = "billing_fulfillment_reviews";
export const STRIPE_CHECKOUT_FALLBACK_MIN_ATTEMPTS = 5;
export const STRIPE_CHECKOUT_FALLBACK_MIN_AGE_MS = 30 * 60_000;
// Server-only ledger of completed one-off credit-pack purchases, keyed by the Stripe
// (or simulated) checkout session id. Its sole job is idempotency: a webhook retry or
// a double-confirm of the SAME session must never grant a pack's credits twice.
const CREDIT_PURCHASES_COLLECTION = "credit_purchases";

/**
 * One-off credit packs. `credits` mirrors functions/src/credits/schema.ts
 * (CANONICAL: frontend config/credits.ts). `priceEnv` is the Stripe Price id env
 * var used for real (non-simulated) checkout. Packs use mode "payment" — they grant
 * credits once and never change the buyer's role or subscription plan.
 */
const CREDIT_PACK_PLANS: Record<string, { credits: number; priceEnv: string }> = {
  pack_100: { credits: CREDIT_PACK_CREDITS.pack_100, priceEnv: "STRIPE_PRICE_PACK_100" },
  pack_500: { credits: CREDIT_PACK_CREDITS.pack_500, priceEnv: "STRIPE_PRICE_PACK_500" },
  pack_1000: { credits: CREDIT_PACK_CREDITS.pack_1000, priceEnv: "STRIPE_PRICE_PACK_1000" },
};

function isCreditPackKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(CREDIT_PACK_PLANS, key);
}

export interface CreditPackResult {
  status: "active";
  subscription_status: string;
  role: string;
  credits: number;
  credits_added: number;
  pack_key: string;
  grant_source: "paid";
}

/**
 * Grants a one-off credit pack to `uid`. Idempotent on `checkoutSessionId`: the first
 * call for a session increments the balance and records a ledger doc; any later call
 * for the same session is a no-op that returns the current balance. This is the
 * payment-mode analogue of activateStripeEntitlement and is shared by both the Stripe
 * webhook (checkout.session.completed, mode=payment) and the simulated confirm path.
 */
export async function activateCreditPackEntitlement(input: {
  uid: string;
  packKey: string;
  checkoutSessionId: string;
}): Promise<CreditPackResult> {
  const pack = CREDIT_PACK_PLANS[input.packKey];
  if (!input.uid || !pack || !input.checkoutSessionId) {
    throw new HttpsError("invalid-argument", "Invalid credit-pack entitlement payload.");
  }
  const userRef = db.collection(USERS_COLLECTION).doc(input.uid);
  const ledgerRef = db.collection(CREDIT_PURCHASES_COLLECTION).doc(input.checkoutSessionId);
  const deletionRef = db.collection(ACCOUNT_DELETION_REQUESTS_COLLECTION).doc(input.uid);
  const now = FieldValue.serverTimestamp();

  return db.runTransaction(async (tx) => {
    const [userSnap, ledgerSnap, deletionSnap] = await tx.getAll(userRef, ledgerRef, deletionRef);
    if (accountDeletionRequestBlocksCheckout(deletionSnap.data())) {
      throw new HttpsError("failed-precondition", ACCOUNT_DELETION_CHECKOUT_MESSAGE);
    }
    if (!userSnap.exists) {
      throw new HttpsError("failed-precondition", "No user account to credit.");
    }
    const rawBase = userSnap.get(USER_FIELDS.credits);
    const baseCredits = Number.isFinite(Number(rawBase)) ? Number(rawBase) : 0;
    const subscriptionStatus = (userSnap.get(USER_FIELDS.subscriptionStatus) as string) ?? "free";
    const role = (userSnap.get(USER_FIELDS.role) as string) ?? "candidate";

    // Already granted for this checkout session — return the balance unchanged.
    if (ledgerSnap.exists) {
      return {
        status: "active",
        subscription_status: subscriptionStatus,
        role,
        credits: baseCredits,
        credits_added: 0,
        pack_key: input.packKey,
        grant_source: "paid",
      };
    }

    const newCredits = baseCredits + pack.credits;
    tx.set(
      userRef,
      { [USER_FIELDS.credits]: newCredits, [USER_FIELDS.updatedAt]: now },
      { merge: true },
    );
    tx.set(ledgerRef, {
      uid: input.uid,
      pack_key: input.packKey,
      credits_added: pack.credits,
      checkout_session_id: input.checkoutSessionId,
      provider: "stripe",
      created_at: now,
    });
    return {
      status: "active",
      subscription_status: subscriptionStatus,
      role,
      credits: newCredits,
      credits_added: pack.credits,
      pack_key: input.packKey,
      grant_source: "paid",
    };
  });
}
const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");

type CheckoutMode = BillingMode;

export interface CheckoutPlan extends BillingPlanContract {
  plan: string;
  priceEnv: string;
}

const CHECKOUT_PRICE_ENVS: Record<string, string> = {
  essentials: "STRIPE_PRICE_ESSENTIALS",
  accelerator: "STRIPE_PRICE_ACCELERATOR",
  executive: "STRIPE_PRICE_EXECUTIVE",
  starter: "STRIPE_PRICE_STARTER",
  growth: "STRIPE_PRICE_GROWTH",
  pro: "STRIPE_PRICE_PRO",
  single_post: "STRIPE_PRICE_SINGLE_POST",
  job_pack: "STRIPE_PRICE_JOB_PACK",
};

function secretOrEnv(secret: ReturnType<typeof defineSecret>, envName: string): string | undefined {
  try {
    const value = secret.value();
    if (value) return value;
  } catch {
    // Secret Manager values are unavailable in direct unit tests and some
    // emulator paths; fall back to process.env for local test fixtures.
  }
  return process.env[envName];
}

function getStripeSecretKey(): string | undefined {
  return secretOrEnv(STRIPE_SECRET_KEY, "STRIPE_SECRET_KEY");
}

function getStripeWebhookSecret(): string | undefined {
  return secretOrEnv(STRIPE_WEBHOOK_SECRET, "STRIPE_WEBHOOK_SECRET");
}

function getStripe(): Stripe {
  const key = getStripeSecretKey();
  if (!key) {
    throw new HttpsError("failed-precondition", "Stripe is not configured.");
  }
  // The installed Stripe SDK pins its matching API version. Keeping the SDK on
  // the current release avoids a stale, hand-written version override.
  return new Stripe(key);
}

/**
 * Demo/test billing switch. When BILLING_SIMULATION=true, checkout is simulated by an
 * in-app fake-payment page (no Stripe keys / price ids needed) that flows through the
 * SAME entitlement path as the real Stripe webhook. Non-secret flag — enable ONLY in
 * demo/staging; in production it stays off and the real Stripe path is used.
 */
function billingSimulationEnabled(): boolean {
  return process.env.BILLING_SIMULATION === "true";
}

function appBaseUrl(): string {
  const value = getAppBaseUrl()
    || process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL || process.env.WEB_APP_URL;
  if (!value) {
    throw new HttpsError("failed-precondition", "APP_BASE_URL is not configured.");
  }
  return value.replace(/\/$/, "");
}

/**
 * Hosts we trust as Stripe redirect targets. Building this from config (not the
 * raw request) is what keeps origin-based redirects from becoming an open
 * redirect: the configured canonical domain, this project's Firebase hosting
 * domains, and any extra custom domains in ALLOWED_REDIRECT_ORIGINS.
 */
function allowedRedirectHosts(): Set<string> {
  const hosts = new Set<string>();
  const canonical = getAppBaseUrl()
    || process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL || process.env.WEB_APP_URL;
  if (canonical) {
    try { hosts.add(new URL(canonical).host); } catch { /* ignore malformed config */ }
  }
  const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
  if (project) {
    hosts.add(`${project}.web.app`);
    hosts.add(`${project}.firebaseapp.com`);
  }
  for (const extra of (process.env.ALLOWED_REDIRECT_ORIGINS || "").split(",")) {
    const trimmed = extra.trim();
    if (!trimmed) continue;
    try { hosts.add(new URL(trimmed).host); } catch { hosts.add(trimmed); }
  }
  return hosts;
}

function originFromRequest(rawRequest?: { headers?: Record<string, string | string[] | undefined> }): string | null {
  const headers = rawRequest?.headers ?? {};
  const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const origin = pick(headers.origin);
  if (origin) return origin;
  // Some callable transports omit Origin; recover it from Referer.
  const referer = pick(headers.referer ?? headers.referrer);
  if (referer) {
    try { return new URL(referer).origin; } catch { /* ignore */ }
  }
  return null;
}

/**
 * Base URL for Stripe success/cancel/return links. Prefer the origin the user
 * actually started from — so they come back to *that* site, not a fixed domain —
 * but only when it's an allow-listed host (or localhost in dev). Otherwise fall
 * back to the configured canonical APP_BASE_URL.
 */
export function resolveAppBaseUrl(rawRequest?: { headers?: Record<string, string | string[] | undefined> }): string {
  const origin = originFromRequest(rawRequest);
  if (origin) {
    try {
      const url = new URL(origin);
      const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      if (isLocalhost || allowedRedirectHosts().has(url.host)) {
        return origin.replace(/\/$/, "");
      }
    } catch { /* fall through to canonical */ }
  }
  return appBaseUrl();
}

export function billingPortalReturnPathForAudience(audience: unknown): string {
  return audience === "business" ? "/portal?billing=return" : "/workspace/billing";
}

function normalizeCheckoutPlan(raw: unknown): CheckoutPlan {
  const key = typeof raw === "string" ? raw.trim().replace(/^pending_biz_/, "").replace(/^pending_/, "") : "";
  if (isLegacyJobPostingPurchasePlan(key)) {
    throw new HttpsError("failed-precondition", JOB_POSTING_PURCHASE_UNAVAILABLE_MESSAGE);
  }
  const contract = billingPlanContractFor(key);
  const priceEnv = CHECKOUT_PRICE_ENVS[key];
  if (!key || !contract || !priceEnv) {
    throw new HttpsError("invalid-argument", "Unsupported paid plan.");
  }
  return { plan: key, ...contract, priceEnv };
}

function planKeyForSelection(plan: string, audience: BillingAudience): string {
  return audience === "business" ? `pending_biz_${plan}` : `pending_${plan}`;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export interface StripeEntitlementInput {
  uid: string;
  plan: string;
  audience: BillingAudience;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  checkoutSessionId?: string | null;
  checkoutMode?: CheckoutMode | null;
}

function assertEntitlementInput(input: StripeEntitlementInput): CheckoutPlan {
  const expected = billingPlanContractFor(input.plan);
  const priceEnv = CHECKOUT_PRICE_ENVS[input.plan];
  if (
    !input.uid ||
    !expected ||
    !priceEnv ||
    expected.audience !== input.audience ||
    (input.checkoutMode != null && input.checkoutMode !== expected.mode)
  ) {
    throw new HttpsError("invalid-argument", "Invalid Stripe entitlement payload.");
  }
  return { plan: input.plan, ...expected, priceEnv };
}

async function assertCheckoutAllowedForAccount(uid: string, plan?: CheckoutPlan): Promise<void> {
  const userRef = db.collection(USERS_COLLECTION).doc(uid);
  const deletionRef = db.collection(ACCOUNT_DELETION_REQUESTS_COLLECTION).doc(uid);
  const [snap, deletionSnap] = await db.getAll(userRef, deletionRef);
  if (accountDeletionRequestBlocksCheckout(deletionSnap.data())) {
    throw new HttpsError("failed-precondition", ACCOUNT_DELETION_CHECKOUT_MESSAGE);
  }
  if (!plan) return;
  if (!snap.exists) return;
  const role = (snap.get(USER_FIELDS.role) as string | undefined) ?? "candidate";
  if (plan.audience === "business" && role !== "employer") {
    throw new HttpsError(
      "failed-precondition",
      "Candidate accounts cannot buy employer plans. Register a separate employer account."
    );
  }
  assertPlanAllowedForRole(role, plan.plan);
}

export async function activateStripeEntitlement(input: StripeEntitlementInput) {
  const plan = assertEntitlementInput(input);
  await assertCheckoutAllowedForAccount(input.uid, plan);
  const now = FieldValue.serverTimestamp();
  const billingRef = db.collection(BILLING_COLLECTION).doc(input.uid);
  const userRef = db.collection(USERS_COLLECTION).doc(input.uid);
  const deletionRef = db.collection(ACCOUNT_DELETION_REQUESTS_COLLECTION).doc(input.uid);
  await db.runTransaction(async (tx) => {
    const [deletionSnap, userSnap] = await tx.getAll(deletionRef, userRef);
    if (accountDeletionRequestBlocksCheckout(deletionSnap.data())) {
      throw new HttpsError("failed-precondition", ACCOUNT_DELETION_CHECKOUT_MESSAGE);
    }
    tx.set(billingRef, {
      active: true,
      plan: plan.plan,
      audience: plan.audience,
      mode: plan.mode,
      provider: "stripe",
      payment_status: "current",
      payment_failure: FieldValue.delete(),
      payment_failed_at: FieldValue.delete(),
      stripe_customer_id: input.stripeCustomerId ?? null,
      stripe_subscription_id: input.stripeSubscriptionId ?? null,
      checkout_session_id: input.checkoutSessionId ?? null,
      status: "active",
      pending_plan: FieldValue.delete(),
      pending_audience: FieldValue.delete(),
      activated_at: now,
      updated_at: now,
    }, { merge: true });
    if (plan.audience === "business" && userSnap.exists && !userSnap.get(USER_FIELDS.roleProvenance)) {
      const provenancePatch: Record<string, unknown> = {
        [USER_FIELDS.roleProvenance]: "stripe_checkout_webhook",
        [USER_FIELDS.roleProvisionedAt]: now,
      };
      if (userSnap.get(USER_FIELDS.organizationVerified) == null) {
        provenancePatch[USER_FIELDS.organizationVerified] = false;
      }
      tx.set(userRef, provenancePatch, { merge: true });
    }
  });

  return applySubscriptionSelection(input.uid, planKeyForSelection(plan.plan, plan.audience));
}

export function shouldDeactivateStripeSubscription(
  billing: Record<string, unknown> | undefined,
  deletedSubscriptionId: unknown,
): boolean {
  return billing?.active === true &&
    billing.mode === "subscription" &&
    typeof deletedSubscriptionId === "string" &&
    deletedSubscriptionId.length > 0 &&
    billing.stripe_subscription_id === deletedSubscriptionId;
}

export async function deactivateStripeEntitlement(input: {
  uid: string;
  audience: BillingAudience;
  stripeSubscriptionId?: string | null;
  reason?: string;
}) {
  const now = FieldValue.serverTimestamp();
  return db.runTransaction(async (tx) => {
    const billingRef = db.collection(BILLING_COLLECTION).doc(input.uid);
    const userRef = db.collection(USERS_COLLECTION).doc(input.uid);
    const [billingSnap, userSnap] = await tx.getAll(billingRef, userRef);
    const billing = billingSnap.data();
    if (!shouldDeactivateStripeSubscription(billing, input.stripeSubscriptionId)) {
      return { deactivated: false as const };
    }
    const currentAudience = billing?.audience;
    if (currentAudience !== "candidate" && currentAudience !== "business") {
      return { deactivated: false as const };
    }
    tx.set(
      billingRef,
      {
        active: false,
        status: input.reason ?? "inactive",
        payment_status: "inactive",
        payment_failure: FieldValue.delete(),
        payment_failed_at: FieldValue.delete(),
        stripe_subscription_id: input.stripeSubscriptionId ?? FieldValue.delete(),
        cancelled_at: now,
        updated_at: now,
      },
      { merge: true },
    );
    const userPatch: Record<string, unknown> = {
      [USER_FIELDS.subscriptionStatus]: "free",
      [USER_FIELDS.role]: currentAudience === "business" ? "employer" : "candidate",
      [USER_FIELDS.updatedAt]: now,
    };
    if (currentAudience === "business" && !userSnap.get(USER_FIELDS.roleProvenance)) {
      userPatch[USER_FIELDS.roleProvenance] = "stripe_checkout_webhook";
      userPatch[USER_FIELDS.roleProvisionedAt] = now;
      if (userSnap.get(USER_FIELDS.organizationVerified) == null) {
        userPatch[USER_FIELDS.organizationVerified] = false;
      }
    }
    tx.set(userRef, userPatch, { merge: true });
    return { deactivated: true as const };
  });
}

async function findBillingBySubscription(stripeSubscriptionId: string): Promise<{
  uid: string;
  audience: BillingAudience;
} | null> {
  const snap = await db
    .collection(BILLING_COLLECTION)
    .where("stripe_subscription_id", "==", stripeSubscriptionId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  const audience = doc.get("audience");
  if (audience !== "candidate" && audience !== "business") return null;
  return { uid: doc.id, audience };
}

export function stripeInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const subscription = invoice.parent?.subscription_details?.subscription;
  if (typeof subscription === "string") return stringOrNull(subscription);
  if (subscription && typeof subscription === "object") return stringOrNull(subscription.id);
  return null;
}

export function invoicePaymentFailureState(invoice: Stripe.Invoice) {
  return {
    payment_status: "payment_failed" as const,
    payment_failure: {
      invoice_id: invoice.id,
      attempt_count: Number.isInteger(invoice.attempt_count) && invoice.attempt_count >= 0
        ? invoice.attempt_count
        : 0,
      next_payment_attempt_unix: typeof invoice.next_payment_attempt === "number"
        ? invoice.next_payment_attempt
        : null,
      grace_policy: "retain_entitlement_during_stripe_retries" as const,
      entitlement_action: "deactivate_only_on_matching_subscription_deleted" as const,
    },
  };
}

export type StripeWebhookEventDecision =
  | { action: "claim" }
  | { action: "duplicate" }
  | { action: "pending" }
  | { action: "conflict" };

export function decideStripeWebhookEvent(
  current: Record<string, unknown> | undefined,
  expectedType: string,
  nowMs: number,
): StripeWebhookEventDecision {
  if (!current) return { action: "claim" };
  if (current.event_type !== expectedType) return { action: "conflict" };
  if (current.status === "completed") return { action: "duplicate" };
  if (
    current.status === "processing" &&
    typeof current.lease_expires_at_ms === "number" &&
    current.lease_expires_at_ms > nowMs
  ) {
    return { action: "pending" };
  }
  return { action: "claim" };
}

export interface CreateCheckoutRequest {
  planKey: unknown;
  uiMode?: unknown;
  operationId?: unknown;
}

export type CheckoutSessionResult = StoredCheckoutSessionResult;

export type StripeCheckoutSessionCreator = (
  params: Stripe.Checkout.SessionCreateParams,
  options: Stripe.RequestOptions,
) => Promise<{ id: string; url: string | null; client_secret: string | null }>;

function normalizeCheckoutUiMode(raw: unknown): CheckoutUiMode {
  if (raw == null || raw === "hosted") return "hosted";
  if (raw === "embedded") return "embedded";
  throw new HttpsError("invalid-argument", "Unsupported checkout UI mode.");
}

function createFirestoreCheckoutIntentStore(input: {
  uid: string;
  operationId: string;
  itemKey: string;
  uiMode: CheckoutUiMode;
}): CheckoutIntentStore<CheckoutSessionResult> {
  const ref = db.collection(CHECKOUT_INTENTS_COLLECTION).doc(
    checkoutIntentDocumentId(input.uid, input.operationId),
  );
  return {
    claim: async (claim) => db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists
        ? (snap.data() as Record<string, unknown> & { result?: CheckoutSessionResult })
        : undefined;
      const decision = decideCheckoutIntent(current, claim.fingerprint, claim.nowMs);
      if (decision.action === "claim") {
        const patch: Record<string, unknown> = {
          uid: input.uid,
          operation_id: input.operationId,
          item_key: input.itemKey,
          ui_mode: input.uiMode,
          fingerprint: claim.fingerprint,
          status: "creating",
          owner_token: claim.ownerToken,
          lease_expires_at_ms: claim.leaseExpiresAtMs,
          attempts: FieldValue.increment(1),
          updated_at: FieldValue.serverTimestamp(),
        };
        if (!snap.exists) patch.created_at = FieldValue.serverTimestamp();
        tx.set(ref, patch, { merge: true });
      }
      return decision;
    }),
    complete: async (ownerToken, result) => db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (
        !snap.exists ||
        snap.get("status") !== "creating" ||
        snap.get("owner_token") !== ownerToken
      ) {
        return false;
      }
      tx.set(ref, {
        status: "completed",
        result,
        lease_expires_at_ms: 0,
        completed_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      return true;
    }),
    release: async (ownerToken) => db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (
        !snap.exists ||
        snap.get("status") !== "creating" ||
        snap.get("owner_token") !== ownerToken
      ) {
        return;
      }
      tx.set(ref, {
        status: "retryable",
        lease_expires_at_ms: 0,
        last_failed_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
    }),
  };
}

export function buildCheckoutSessionParams(input: {
  uid: string;
  plan: CheckoutPlan;
  price: string;
  baseUrl: string;
  email?: string | null;
  customerId?: string | null;
  useEmbeddedCheckout: boolean;
}): Stripe.Checkout.SessionCreateParams {
  const baseSessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: input.plan.mode,
    customer: input.customerId ?? undefined,
    customer_email: input.customerId ? undefined : input.email ?? undefined,
    client_reference_id: input.uid,
    line_items: [{ price: input.price, quantity: 1 }],
    metadata: {
      uid: input.uid,
      plan_key: input.plan.plan,
      audience: input.plan.audience,
    },
    ...(input.plan.mode === "subscription"
      ? {
          subscription_data: {
            metadata: {
              uid: input.uid,
              plan_key: input.plan.plan,
              audience: input.plan.audience,
            },
          },
        }
      : {}),
  };

  if (input.useEmbeddedCheckout) {
    const returnPath = input.plan.audience === "business"
      ? "/portal?checkout=return&session_id={CHECKOUT_SESSION_ID}"
      : "/workspace/billing?checkout=return&session_id={CHECKOUT_SESSION_ID}";
    return {
      ...baseSessionParams,
      ui_mode: "embedded_page",
      // Keep the normal card flow inside the app: Stripe calls the embedded
      // Checkout onComplete callback instead of navigating the whole window.
      // We start with card-only Checkout to avoid redirect-based payment methods
      // opening a global return flow.
      payment_method_types: ["card"],
      redirect_on_completion: "if_required",
      return_url: `${input.baseUrl}${returnPath}`,
    };
  }

  const successPath = input.plan.audience === "business" ? "/portal?checkout=success" : "/workspace/billing?checkout=success";
  const cancelPath = input.plan.audience === "business" ? "/pricing?audience=employer&checkout=cancel" : "/pricing?checkout=cancel";
  return {
    ...baseSessionParams,
    ui_mode: "hosted_page",
    success_url: `${input.baseUrl}${successPath}`,
    cancel_url: `${input.baseUrl}${cancelPath}`,
  };
}

export async function createCheckoutSessionImpl(input: {
  uid: string;
  data: CreateCheckoutRequest;
  email?: unknown;
  rawRequest?: { headers?: Record<string, string | string[] | undefined> };
  createStripeSession?: StripeCheckoutSessionCreator;
}): Promise<CheckoutSessionResult> {
  const operationId = normalizeCheckoutOperationId(input.data.operationId);
  if (!operationId) {
    throw new HttpsError("invalid-argument", "A valid checkout operation id is required.");
  }
  const uiMode = normalizeCheckoutUiMode(input.data.uiMode);
  const useEmbeddedCheckout = uiMode === "embedded";
  const requestedKey = typeof input.data.planKey === "string" ? input.data.planKey.trim() : "";
  const pack = isCreditPackKey(requestedKey) ? CREDIT_PACK_PLANS[requestedKey] : null;
  const plan = pack ? null : normalizeCheckoutPlan(input.data.planKey);
  const itemKey = plan ? plan.plan : requestedKey;
  await assertCheckoutAllowedForAccount(input.uid, plan ?? undefined);

  const fingerprint = checkoutIntentFingerprint({ uid: input.uid, itemKey, uiMode });
  const idempotencyKey = checkoutStripeIdempotencyKey(input.uid, operationId);
  const store = createFirestoreCheckoutIntentStore({
    uid: input.uid,
    operationId,
    itemKey,
    uiMode,
  });
  const createStripeSession = async (params: Stripe.Checkout.SessionCreateParams) => {
    const options: Stripe.RequestOptions = { idempotencyKey };
    if (input.createStripeSession) return input.createStripeSession(params, options);
    const session = await getStripe().checkout.sessions.create(params, options);
    return { id: session.id, url: session.url, client_secret: session.client_secret };
  };

  try {
    return await executeCheckoutIntent({
      store,
      fingerprint,
      ownerToken: randomUUID(),
      create: async () => {
        const simId = `sim_${checkoutIntentDocumentId(input.uid, operationId).replace(/^checkout_/, "")}`;
        if (billingSimulationEnabled()) {
          if (pack) {
            const params = new URLSearchParams({
              pack: requestedKey,
              kind: "credit_pack",
              sim: simId,
            });
            return {
              mode: "hosted",
              url: `/billing/checkout?${params.toString()}`,
              id: simId,
              simulated: true,
            };
          }
          if (!plan) throw new HttpsError("internal", "Checkout plan resolution failed.");
          const params = new URLSearchParams({ plan: plan.plan, audience: plan.audience, sim: simId });
          return {
            mode: "hosted",
            url: `/billing/checkout?${params.toString()}`,
            id: simId,
            simulated: true,
          };
        }

        const baseUrl = resolveAppBaseUrl(input.rawRequest);
        const email = stringOrNull(input.email);
        if (pack) {
          const packPrice = process.env[pack.priceEnv];
          if (!packPrice) {
            throw new HttpsError("failed-precondition", `${pack.priceEnv} is not configured.`);
          }
          const packSessionParams: Stripe.Checkout.SessionCreateParams = {
            mode: "payment",
            customer_email: email ?? undefined,
            client_reference_id: input.uid,
            line_items: [{ price: packPrice, quantity: 1 }],
            metadata: {
              uid: input.uid,
              kind: "credit_pack",
              pack_key: requestedKey,
              audience: "candidate",
            },
            ...(useEmbeddedCheckout
              ? {
                  ui_mode: "embedded_page" as const,
                  payment_method_types: ["card"] as const,
                  redirect_on_completion: "if_required" as const,
                  return_url: `${baseUrl}/workspace/billing?checkout=return&session_id={CHECKOUT_SESSION_ID}`,
                }
              : {
                  ui_mode: "hosted_page" as const,
                  success_url: `${baseUrl}/workspace/billing?checkout=success`,
                  cancel_url: `${baseUrl}/workspace/billing?checkout=cancel`,
                }),
          };
          const packSession = await createStripeSession(packSessionParams);
          if (useEmbeddedCheckout) {
            if (!packSession.client_secret) {
              throw new HttpsError("internal", "Stripe did not return an embedded Checkout client secret.");
            }
            return { mode: "embedded", clientSecret: packSession.client_secret, id: packSession.id };
          }
          if (!packSession.url) {
            throw new HttpsError("internal", "Stripe did not return a Checkout URL.");
          }
          return { mode: "hosted", url: packSession.url, id: packSession.id };
        }

        if (!plan) throw new HttpsError("internal", "Checkout plan resolution failed.");
        const price = process.env[plan.priceEnv];
        if (!price) {
          throw new HttpsError("failed-precondition", `${plan.priceEnv} is not configured.`);
        }
        const billingSnap = await db.collection(BILLING_COLLECTION).doc(input.uid).get();
        const customerId = stringOrNull(billingSnap.get("stripe_customer_id"));
        const subscriptionId = stringOrNull(billingSnap.get("stripe_subscription_id"));
        if (billingSnap.get("active") === true && subscriptionId?.startsWith("sub_")) {
          throw new HttpsError(
            "failed-precondition",
            "You already have an active Stripe subscription. Use Manage billing to change or cancel it.",
          );
        }
        const sessionParams = buildCheckoutSessionParams({
          uid: input.uid,
          plan,
          price,
          baseUrl,
          email,
          customerId: customerId?.startsWith("cus_") ? customerId : null,
          useEmbeddedCheckout,
        });
        const session = await createStripeSession(sessionParams);
        if (useEmbeddedCheckout) {
          if (!session.client_secret) {
            throw new HttpsError("internal", "Stripe did not return an embedded Checkout client secret.");
          }
          return { mode: "embedded", clientSecret: session.client_secret, id: session.id };
        }
        if (!session.url) {
          throw new HttpsError("internal", "Stripe did not return a Checkout URL.");
        }
        return { mode: "hosted", url: session.url, id: session.id };
      },
    });
  } catch (error) {
    if (error instanceof CheckoutIntentConflictError) {
      throw new HttpsError("invalid-argument", error.message);
    }
    if (error instanceof CheckoutIntentPendingError) {
      throw new HttpsError("aborted", error.message);
    }
    throw error;
  }
}

export const createCheckoutSessionFunction = onCall(
  { secrets: [STRIPE_SECRET_KEY] },
  async (request): Promise<CheckoutSessionResult> => {
    await ensurePlatformCaches();
    const uid = requireAnyAuth(request);
    return createCheckoutSessionImpl({
      uid,
      data: (request.data ?? {}) as CreateCheckoutRequest,
      email: request.auth?.token.email,
      rawRequest: request.rawRequest,
    });
  },
);

interface ConfirmSimulatedCheckoutRequest {
  planKey: string;
  /**
   * The simulated checkout session id returned by createCheckoutSession. Used only
   * for credit packs, as the idempotency key so confirming the same pack checkout
   * twice grants once. (Subscriptions are idempotent via credit_renewals.)
   */
  sessionId?: string;
}

/**
 * Simulated-payment confirmation (demo/test only). Mirrors the Stripe webhook's
 * checkout.session.completed → activateStripeEntitlement path, so the billing
 * entitlement record AND the plan/role/credit activation are IDENTICAL to a real
 * payment. Gated by BILLING_SIMULATION so it can never self-grant in production.
 */
export async function confirmSimulatedCheckoutImpl(uid: string, data: ConfirmSimulatedCheckoutRequest) {
  if (!billingSimulationEnabled()) {
    throw new HttpsError("failed-precondition", "Billing simulation is not enabled.");
  }

  // Credit packs grant a one-off credit amount via the payment-mode entitlement path.
  const packKey = typeof data?.planKey === "string" ? data.planKey.trim() : "";
  if (isCreditPackKey(packKey)) {
    // Prefer the client-supplied checkout session id so a double-confirm of the same
    // checkout is deduped; fall back to a per-call id so a missing one still grants.
    const sessionId =
      stringOrNull(data?.sessionId) ?? `sim_${randomUUID()}`;
    return activateCreditPackEntitlement({ uid, packKey, checkoutSessionId: sessionId });
  }

  const plan = normalizeCheckoutPlan(data?.planKey);
  const simId = `sim_${randomUUID()}`;
  return activateStripeEntitlement({
    uid,
    plan: plan.plan,
    audience: plan.audience,
    stripeCustomerId: `sim_cus_${uid.slice(0, 12)}`,
    stripeSubscriptionId: plan.mode === "subscription" ? `sim_sub_${simId}` : null,
    checkoutSessionId: simId,
    checkoutMode: plan.mode,
  });
}

export const confirmSimulatedCheckoutFunction = onCall((request) =>
  confirmSimulatedCheckoutImpl(requireAnyAuth(request), (request.data ?? {}) as ConfirmSimulatedCheckoutRequest));

/**
 * Simulated subscription cancellation (demo/test only). Mirrors the Stripe
 * customer.subscription.deleted webhook's downgrade path — clearing billing.active
 * and resetting the user to free WITHOUT touching credits. Gated by
 * BILLING_SIMULATION so it can never bypass Stripe in production.
 */
export async function cancelSubscriptionSimulatedImpl(uid: string) {
  if (!billingSimulationEnabled()) {
    throw new HttpsError("failed-precondition", "Billing simulation is not enabled.");
  }
  const billingSnap = await db.collection(BILLING_COLLECTION).doc(uid).get();
  if (!billingSnap.exists || billingSnap.get("active") !== true) {
    return { status: "inactive" as const, subscription_status: "free" };
  }
  const audience = billingSnap.get("audience");
  const resolvedAudience: BillingAudience =
    audience === "business" ? "business" : "candidate";
  await deactivateStripeEntitlement({
    uid,
    audience: resolvedAudience,
    stripeSubscriptionId: billingSnap.get("stripe_subscription_id") ?? null,
    reason: "cancelled_simulated",
  });
  return { status: "cancelled" as const, subscription_status: "free" };
}

export const cancelSubscriptionSimulatedFunction = onCall((request) =>
  cancelSubscriptionSimulatedImpl(requireAnyAuth(request)));

/**
 * Creates a billing-management entry point for the signed-in user.
 *   - Simulation mode: returns the in-app fake manage page URL.
 *   - Real mode: creates a Stripe Customer Portal session (cancel / change card /
 *     invoices). The customer id is read ONLY from the user's own billing doc —
 *     never accepted from the client — to prevent managing another user's billing.
 */
export async function createBillingPortalSessionImpl(uid: string, baseUrl?: string): Promise<{ url: string; simulated?: boolean }> {
  if (billingSimulationEnabled()) {
    return { url: "/billing/manage", simulated: true };
  }
  const billingSnap = await db.collection(BILLING_COLLECTION).doc(uid).get();
  const customerId = billingSnap.get("stripe_customer_id");
  const audience = billingSnap.get("audience");
  if (!billingSnap.exists || billingSnap.get("active") !== true || typeof customerId !== "string" || !customerId) {
    throw new HttpsError("failed-precondition", "No active subscription to manage.");
  }
  const returnPath = billingPortalReturnPathForAudience(audience);
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${baseUrl ?? appBaseUrl()}${returnPath}`,
  });
  if (!session.url) {
    throw new HttpsError("internal", "Stripe did not return a Billing Portal URL.");
  }
  return { url: session.url };
}

export const createBillingPortalSessionFunction = onCall({ secrets: [STRIPE_SECRET_KEY] }, async (request) => {
  await ensurePlatformCaches();
  return createBillingPortalSessionImpl(requireAnyAuth(request), resolveAppBaseUrl(request.rawRequest));
});

export function checkoutSessionHasCompletedPayment(session: Pick<Stripe.Checkout.Session, "payment_status">): boolean {
  return session.payment_status === "paid" || session.payment_status === "no_payment_required";
}

export function isPermanentCheckoutEntitlementError(error: unknown): error is HttpsError {
  return error instanceof HttpsError &&
    (error.code === "failed-precondition" || error.code === "invalid-argument" || error.code === "not-found");
}

export interface BillingFulfillmentReviewEventContext {
  eventId: string;
  eventType: string;
}

export interface StripeCheckoutRetryContext {
  deliveryAttempt: number;
  firstSeenAtMs: number;
  nowMs: number;
}

export function shouldEscalateCheckoutFailure(
  context: StripeCheckoutRetryContext
): boolean {
  return Number.isSafeInteger(context.deliveryAttempt) &&
    Number.isSafeInteger(context.firstSeenAtMs) &&
    Number.isSafeInteger(context.nowMs) &&
    context.deliveryAttempt >= STRIPE_CHECKOUT_FALLBACK_MIN_ATTEMPTS &&
    context.nowMs >= context.firstSeenAtMs &&
    context.nowMs - context.firstSeenAtMs >= STRIPE_CHECKOUT_FALLBACK_MIN_AGE_MS;
}

function stripeExpandableId(value: { id?: unknown } | string | null | undefined): string | null {
  if (typeof value === "string") return stringOrNull(value);
  return value && typeof value === "object" ? stringOrNull(value.id) : null;
}

/**
 * Durably records a completed Checkout Session that could not be fulfilled.
 *
 * The Stripe session id is the reconciliation key. Webhook retries increment
 * `attempts`, while an operator-resolved review is never reopened automatically.
 * A rejected transaction is deliberately allowed to escape so the webhook event
 * ledger is released and Stripe can retry delivery.
 */
export async function recordBillingFulfillmentReview(input: {
  session: Stripe.Checkout.Session;
  event: BillingFulfillmentReviewEventContext;
  reasonCode: string;
  entitlementErrorCode?: string | null;
  retryContext?: StripeCheckoutRetryContext;
}): Promise<void> {
  const { session, event } = input;
  const ref = db.collection(BILLING_FULFILLMENT_REVIEWS_COLLECTION).doc(session.id);
  const uid = stringOrNull(session.metadata?.uid) ?? stringOrNull(session.client_reference_id);
  const context: Record<string, unknown> = {
    checkout_session_id: session.id,
    stripe_event_id: event.eventId,
    event_type: event.eventType,
    livemode: session.livemode === true,
    payment_status: session.payment_status,
    checkout_mode: session.mode,
    amount_total: typeof session.amount_total === "number" ? session.amount_total : null,
    currency: stringOrNull(session.currency),
    stripe_customer_id: stripeExpandableId(session.customer),
    stripe_payment_intent_id: stripeExpandableId(session.payment_intent),
    stripe_subscription_id: stripeExpandableId(session.subscription),
    uid,
    plan_key: stringOrNull(session.metadata?.plan_key),
    pack_key: stringOrNull(session.metadata?.pack_key),
    audience: stringOrNull(session.metadata?.audience),
    purchase_kind: stringOrNull(session.metadata?.kind) ?? "subscription_or_plan",
    reason_code: input.reasonCode,
    latest_reason_code: input.reasonCode,
    latest_entitlement_error_code: stringOrNull(input.entitlementErrorCode),
    ...(input.retryContext
      ? {
          webhook_delivery_attempt: input.retryContext.deliveryAttempt,
          webhook_first_seen_at: Timestamp.fromMillis(input.retryContext.firstSeenAtMs),
          webhook_escalated_at: Timestamp.fromMillis(input.retryContext.nowMs),
        }
      : {}),
  };

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const patch: Record<string, unknown> = {
      ...context,
      attempts: FieldValue.increment(1),
      last_seen_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    };
    if (!snap.exists) {
      patch.created_at = FieldValue.serverTimestamp();
      patch.first_reason_code = input.reasonCode;
    }
    if (snap.get("status") !== "resolved") {
      patch.status = "pending";
      patch.operator_action_required = true;
      patch.operator_action = "refund_or_cancel_review";
      patch.recommended_action = "refund_or_cancel_review";
    }
    tx.set(ref, patch, { merge: true });
  });
}

async function persistFulfillmentFailure(
  session: Stripe.Checkout.Session,
  event: BillingFulfillmentReviewEventContext,
  reasonCode: string,
  entitlementErrorCode?: string,
  retryContext?: StripeCheckoutRetryContext,
): Promise<void> {
  await recordBillingFulfillmentReview({
    session,
    event,
    reasonCode,
    entitlementErrorCode,
    retryContext,
  });
  logger.error("stripeWebhook: completed checkout requires refund or cancellation review", {
    session: session.id,
    event: event.eventId,
    eventType: event.eventType,
    reasonCode,
    entitlementErrorCode: entitlementErrorCode ?? null,
    operatorActionRequired: true,
  });
}

type CheckoutFulfillmentHandler = (
  session: Stripe.Checkout.Session,
  event: BillingFulfillmentReviewEventContext
) => Promise<void>;

/**
 * Gives ordinary infrastructure failures several Stripe deliveries and at least
 * thirty minutes to recover. After both thresholds, a paid checkout is parked in
 * the durable operator queue. If that queue write fails, the error still escapes
 * so the event ledger is released and Stripe retries delivery.
 */
export async function handleCheckoutCompletedWithRecovery(
  session: Stripe.Checkout.Session,
  event: BillingFulfillmentReviewEventContext,
  retryContext: StripeCheckoutRetryContext,
  fulfill: CheckoutFulfillmentHandler = handleCheckoutCompleted
): Promise<{ status: "fulfilled" | "review_queued" }> {
  try {
    await fulfill(session, event);
    return { status: "fulfilled" };
  } catch (error) {
    if (
      !checkoutSessionHasCompletedPayment(session) ||
      !shouldEscalateCheckoutFailure(retryContext)
    ) {
      throw error;
    }

    await persistFulfillmentFailure(
      session,
      event,
      "transient_entitlement_failure_retry_exhausted",
      "internal",
      retryContext
    );
    return { status: "review_queued" };
  }
}

export async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  event: BillingFulfillmentReviewEventContext,
): Promise<void> {
  if (!checkoutSessionHasCompletedPayment(session)) {
    logger.info("stripeWebhook: checkout completed before payment settled", {
      session: session.id,
      paymentStatus: session.payment_status,
    });
    return;
  }
  const uid = stringOrNull(session.metadata?.uid) ?? stringOrNull(session.client_reference_id);

  // One-off credit-pack purchase (mode=payment) — grant credits, no plan/role change.
  try {
    if (session.metadata?.kind === "credit_pack") {
      const packKey = stringOrNull(session.metadata?.pack_key);
      if (!uid || !packKey || !isCreditPackKey(packKey)) {
        await persistFulfillmentFailure(session, event, "credit_pack_invalid_metadata");
        return;
      }
      await activateCreditPackEntitlement({ uid, packKey, checkoutSessionId: session.id });
      return;
    }

    const plan = stringOrNull(session.metadata?.plan_key);
    const audience = session.metadata?.audience;
    if (!uid || !plan || (audience !== "candidate" && audience !== "business")) {
      await persistFulfillmentFailure(session, event, "checkout_invalid_entitlement_metadata");
      return;
    }

    await activateStripeEntitlement({
      uid,
      plan,
      audience,
      stripeCustomerId: typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
      stripeSubscriptionId: typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null,
      checkoutSessionId: session.id,
      checkoutMode: session.mode === "subscription" ? "subscription" : "payment",
    });
  } catch (error) {
    if (!isPermanentCheckoutEntitlementError(error)) throw error;
    await persistFulfillmentFailure(session, event, "permanent_entitlement_failure", error.code);
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const uid = stringOrNull(subscription.metadata?.uid);
  const audience = subscription.metadata?.audience;
  const fallback = !uid || (audience !== "candidate" && audience !== "business")
    ? await findBillingBySubscription(subscription.id)
    : null;
  const resolvedUid = uid ?? fallback?.uid;
  const resolvedAudience = audience === "candidate" || audience === "business" ? audience : fallback?.audience;
  if (!resolvedUid || !resolvedAudience) {
    logger.warn("stripeWebhook: subscription.deleted missing entitlement metadata", { subscription: subscription.id });
    return;
  }
  const result = await deactivateStripeEntitlement({
    uid: resolvedUid,
    audience: resolvedAudience,
    stripeSubscriptionId: subscription.id,
    reason: "cancelled",
  });
  if (!result.deactivated) {
    logger.info("stripeWebhook: ignored stale subscription.deleted", {
      uid: resolvedUid,
      subscription: subscription.id,
    });
  }
}

export async function recordInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const subscriptionId = stripeInvoiceSubscriptionId(invoice);
  if (!subscriptionId) return { recorded: false as const };
  const match = await findBillingBySubscription(subscriptionId);
  if (!match) return { recorded: false as const };

  return db.runTransaction(async (tx) => {
    const billingRef = db.collection(BILLING_COLLECTION).doc(match.uid);
    const billingSnap = await tx.get(billingRef);
    if (!shouldDeactivateStripeSubscription(billingSnap.data(), subscriptionId)) {
      return { recorded: false as const };
    }
    tx.set(billingRef, {
      ...invoicePaymentFailureState(invoice),
      payment_failed_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { recorded: true as const };
  });
}

export async function recordInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  const subscriptionId = stripeInvoiceSubscriptionId(invoice);
  if (!subscriptionId) return { recorded: false as const };
  const match = await findBillingBySubscription(subscriptionId);
  if (!match) return { recorded: false as const };

  return db.runTransaction(async (tx) => {
    const billingRef = db.collection(BILLING_COLLECTION).doc(match.uid);
    const billingSnap = await tx.get(billingRef);
    if (!shouldDeactivateStripeSubscription(billingSnap.data(), subscriptionId)) {
      return { recorded: false as const };
    }
    tx.set(billingRef, {
      payment_status: "current",
      payment_failure: FieldValue.delete(),
      payment_failed_at: FieldValue.delete(),
      payment_recovered_invoice_id: invoice.id,
      payment_recovered_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { recorded: true as const };
  });
}

async function claimStripeWebhookEvent(event: Stripe.Event, ownerToken: string) {
  const ref = db.collection(STRIPE_WEBHOOK_EVENTS_COLLECTION).doc(
    checkoutIntentDocumentId("stripe_webhook_event", event.id),
  );
  const nowMs = Date.now();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const decision = decideStripeWebhookEvent(snap.exists ? snap.data() : undefined, event.type, nowMs);
    const rawPriorAttempts = Number(snap.exists ? snap.get("attempts") : 0);
    const priorAttempts = Number.isSafeInteger(rawPriorAttempts) && rawPriorAttempts >= 0
      ? rawPriorAttempts
      : 0;
    const deliveryAttempt = priorAttempts + 1;
    const recordedFirstSeenAtMs = Number(
      snap.exists ? snap.get("first_seen_at_ms") : Number.NaN
    );
    const firstSeenAtMs = Number.isSafeInteger(recordedFirstSeenAtMs) &&
      recordedFirstSeenAtMs > 0 &&
      recordedFirstSeenAtMs <= nowMs
      ? recordedFirstSeenAtMs
      : nowMs;
    if (decision.action === "claim") {
      const patch: Record<string, unknown> = {
        stripe_event_id: event.id,
        event_type: event.type,
        livemode: event.livemode,
        status: "processing",
        owner_token: ownerToken,
        lease_expires_at_ms: nowMs + 5 * 60_000,
        attempts: FieldValue.increment(1),
        first_seen_at_ms: firstSeenAtMs,
        updated_at: FieldValue.serverTimestamp(),
      };
      if (!snap.exists) patch.created_at = FieldValue.serverTimestamp();
      tx.set(ref, patch, { merge: true });
    }
    return {
      decision,
      ref,
      retryContext: {
        deliveryAttempt,
        firstSeenAtMs,
        nowMs,
      } satisfies StripeCheckoutRetryContext,
    };
  });
}

async function completeStripeWebhookEvent(
  ref: FirebaseFirestore.DocumentReference,
  ownerToken: string,
): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.get("status") === "completed") return true;
    if (snap.get("status") !== "processing" || snap.get("owner_token") !== ownerToken) return false;
    tx.set(ref, {
      status: "completed",
      lease_expires_at_ms: 0,
      completed_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  });
}

async function releaseStripeWebhookEvent(
  ref: FirebaseFirestore.DocumentReference,
  ownerToken: string,
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.get("status") !== "processing" || snap.get("owner_token") !== ownerToken) return;
    tx.set(ref, {
      status: "retryable",
      lease_expires_at_ms: 0,
      last_failed_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

export const stripeWebhookFunction = onRequest({ secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET] }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const secret = getStripeWebhookSecret();
  if (!secret) {
    res.status(500).send("Stripe webhook is not configured.");
    return;
  }

  const signature = req.header("stripe-signature");
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!signature || !rawBody) {
    res.status(400).send("Missing Stripe signature or raw body.");
    return;
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (error) {
    logger.warn("stripeWebhook: signature verification failed", error);
    res.status(400).send("Invalid Stripe signature.");
    return;
  }

  const ownerToken = randomUUID();
  let ledger: Awaited<ReturnType<typeof claimStripeWebhookEvent>>;
  try {
    ledger = await claimStripeWebhookEvent(event, ownerToken);
  } catch (error) {
    logger.error("stripeWebhook: event ledger claim failed", error);
    res.status(500).send("Stripe webhook ledger unavailable.");
    return;
  }
  if (ledger.decision.action === "duplicate") {
    res.status(200).json({ received: true, duplicate: true });
    return;
  }
  if (ledger.decision.action === "pending") {
    res.status(409).send("Stripe webhook event is already processing.");
    return;
  }
  if (ledger.decision.action === "conflict") {
    logger.error("stripeWebhook: event ledger type conflict", {
      event: event.id,
      type: event.type,
    });
    res.status(500).send("Stripe webhook ledger conflict.");
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompletedWithRecovery(event.data.object as Stripe.Checkout.Session, {
          eventId: event.id,
          eventType: event.type,
        }, ledger.retryContext);
        break;
      case "checkout.session.async_payment_succeeded":
        await handleCheckoutCompletedWithRecovery(event.data.object as Stripe.Checkout.Session, {
          eventId: event.id,
          eventType: event.type,
        }, ledger.retryContext);
        break;
      case "checkout.session.async_payment_failed":
        logger.warn("stripeWebhook: asynchronous checkout payment failed", {
          session: (event.data.object as Stripe.Checkout.Session).id,
        });
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case "invoice.payment_failed":
        await recordInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      case "invoice.payment_succeeded":
        await recordInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;
      default:
        break;
    }
    if (!await completeStripeWebhookEvent(ledger.ref, ownerToken)) {
      throw new Error("Stripe webhook event lease was lost before completion.");
    }
    res.status(200).json({ received: true });
  } catch (error) {
    try {
      await releaseStripeWebhookEvent(ledger.ref, ownerToken);
    } catch (releaseError) {
      logger.error("stripeWebhook: event ledger release failed", releaseError);
    }
    logger.error("stripeWebhook: handler failed", error);
    res.status(500).send("Stripe webhook handler failed.");
  }
});
