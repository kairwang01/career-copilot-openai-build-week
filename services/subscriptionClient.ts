import { httpsCallable } from 'firebase/functions';
import { firebaseFunctions } from '../lib/firebaseClient';
import { createSecureRandomId } from '../lib/secureRandomId';

export interface SubscriptionUpdateResult {
  status?: 'active' | 'pending_payment';
  subscription_status: string;
  credits: number;
  role?: 'candidate' | 'employer' | 'agency';
  pending_plan?: string;
  grant_source?: 'paid' | 'demo_preview' | 'self_service';
}

export interface CheckoutSessionResult {
  id: string;
  mode?: 'hosted' | 'embedded';
  url?: string;
  clientSecret?: string;
  simulated?: boolean;
}

const setSubscriptionStatusCallable = httpsCallable<
  { planKey: string; fullName?: string; companyName?: string },
  SubscriptionUpdateResult
>(firebaseFunctions, 'setSubscriptionStatus');

const createCheckoutSessionCallable = httpsCallable<
  { planKey: string; uiMode: 'hosted' | 'embedded'; operationId: string },
  CheckoutSessionResult
>(firebaseFunctions, 'createCheckoutSession');

const confirmSimulatedCheckoutCallable = httpsCallable<
  { planKey: string; sessionId?: string },
  SubscriptionUpdateResult
>(firebaseFunctions, 'confirmSimulatedCheckout');

/**
 * Sets the caller's subscription_status via the server-only callable.
 *
 * Pass `profile` at signup to have the name/organization written server-side
 * at the same time the user doc is created — this is race-free, unlike a
 * separate client profiles.upsert, which Firestore rules can reject when it
 * runs before the doc exists.
 */
export async function setUserSubscription(
  planKey: string,
  profile?: { fullName?: string; companyName?: string },
): Promise<SubscriptionUpdateResult> {
  const result = await setSubscriptionStatusCallable({ planKey, ...(profile ?? {}) });
  return result.data;
}

export function createCheckoutOperationId(): string {
  return createSecureRandomId('checkout');
}

export async function createSubscriptionCheckout(
  planKey: string,
  operationId: string = createCheckoutOperationId(),
): Promise<CheckoutSessionResult> {
  const result = await createCheckoutSessionCallable({ planKey, uiMode: 'hosted', operationId });
  return result.data;
}

export async function createEmbeddedSubscriptionCheckout(
  planKey: string,
  uiMode: 'hosted' | 'embedded' = 'embedded',
  operationId: string = createCheckoutOperationId(),
): Promise<CheckoutSessionResult> {
  const result = await createCheckoutSessionCallable({ planKey, uiMode, operationId });
  return result.data;
}

/**
 * Confirms a SIMULATED (demo/test) checkout — only works when the backend has
 * BILLING_SIMULATION enabled. Runs the same entitlement activation a real Stripe
 * webhook would, so the resulting plan/role/credits are identical. `sessionId` is the
 * simulated checkout session id (used for credit-pack purchase idempotency).
 */
export async function confirmSimulatedCheckout(planKey: string, sessionId?: string): Promise<SubscriptionUpdateResult> {
  const result = await confirmSimulatedCheckoutCallable({ planKey, ...(sessionId ? { sessionId } : {}) });
  return result.data;
}

/**
 * Starts an embedded checkout for a one-off credit pack. Same callable as the
 * subscription path — the backend routes by pack key to a payment-mode session that
 * grants credits without changing the buyer's plan or role.
 */
export async function createEmbeddedCreditPackCheckout(
  packKey: string,
  uiMode: 'hosted' | 'embedded' = 'embedded',
  operationId: string = createCheckoutOperationId(),
): Promise<CheckoutSessionResult> {
  const result = await createCheckoutSessionCallable({ planKey: packKey, uiMode, operationId });
  return result.data;
}

/** Confirms a SIMULATED credit-pack purchase (demo/test only). `sessionId` dedupes repeat confirms. */
export async function confirmSimulatedCreditPack(packKey: string, sessionId?: string): Promise<SubscriptionUpdateResult> {
  return confirmSimulatedCheckout(packKey, sessionId);
}

const createBillingPortalSessionCallable = httpsCallable<
  Record<string, never>,
  { url: string; simulated?: boolean }
>(firebaseFunctions, 'createBillingPortalSession');

const cancelSubscriptionSimulatedCallable = httpsCallable<
  Record<string, never>,
  { status: string; subscription_status: string }
>(firebaseFunctions, 'cancelSubscriptionSimulated');

/** Returns a URL to manage the subscription (Stripe Portal, or the in-app sim page). */
export async function createBillingPortalSession(): Promise<{ url: string; simulated?: boolean }> {
  const result = await createBillingPortalSessionCallable({});
  return result.data;
}

/** Simulated cancel (demo/test only — backend must have BILLING_SIMULATION enabled). */
export async function cancelSubscriptionSimulated(): Promise<{ status: string; subscription_status: string }> {
  const result = await cancelSubscriptionSimulatedCallable({});
  return result.data;
}
