import { createHash } from "node:crypto";

export type CheckoutUiMode = "hosted" | "embedded";

export type StoredCheckoutSessionResult =
  | { mode: "hosted"; url: string; id: string; simulated?: boolean }
  | { mode: "embedded"; clientSecret: string; id: string };

export interface CheckoutIntentIdentity {
  uid: string;
  itemKey: string;
  uiMode: CheckoutUiMode;
}

export interface CheckoutIntentRecord<TResult = StoredCheckoutSessionResult> {
  status?: unknown;
  fingerprint?: unknown;
  lease_expires_at_ms?: unknown;
  result?: TResult;
}

export type CheckoutIntentDecision<TResult = StoredCheckoutSessionResult> =
  | { action: "claim" }
  | { action: "wait" }
  | { action: "reuse"; result: TResult }
  | { action: "conflict" };

export interface CheckoutIntentClaim {
  fingerprint: string;
  ownerToken: string;
  nowMs: number;
  leaseExpiresAtMs: number;
}

export interface CheckoutIntentStore<TResult = StoredCheckoutSessionResult> {
  claim(claim: CheckoutIntentClaim): Promise<CheckoutIntentDecision<TResult>>;
  complete(ownerToken: string, result: TResult): Promise<boolean>;
  release(ownerToken: string): Promise<void>;
}

export class CheckoutIntentConflictError extends Error {
  constructor() {
    super("The checkout operation id is already bound to different parameters.");
    this.name = "CheckoutIntentConflictError";
  }
}

export class CheckoutIntentPendingError extends Error {
  constructor() {
    super("Checkout creation is still in progress. Retry with the same operation id.");
    this.name = "CheckoutIntentPendingError";
  }
}

const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;

function opaqueHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

export function normalizeCheckoutOperationId(raw: unknown): string | null {
  return typeof raw === "string" && OPERATION_ID_PATTERN.test(raw) ? raw : null;
}

export function checkoutIntentDocumentId(uid: string, operationId: string): string {
  return `checkout_${opaqueHash(`${uid}\0${operationId}`)}`;
}

export function checkoutStripeIdempotencyKey(uid: string, operationId: string): string {
  return `checkout_${opaqueHash(`${uid}\0${operationId}`)}`;
}

export function checkoutIntentFingerprint(input: CheckoutIntentIdentity): string {
  return opaqueHash(JSON.stringify([input.uid, input.itemKey, input.uiMode]));
}

export function decideCheckoutIntent<TResult>(
  current: CheckoutIntentRecord<TResult> | undefined,
  expectedFingerprint: string,
  nowMs: number,
): CheckoutIntentDecision<TResult> {
  if (!current) return { action: "claim" };
  if (current.fingerprint !== expectedFingerprint) return { action: "conflict" };
  if (current.status === "completed" && current.result !== undefined) {
    return { action: "reuse", result: current.result };
  }
  if (
    current.status === "creating" &&
    typeof current.lease_expires_at_ms === "number" &&
    current.lease_expires_at_ms > nowMs
  ) {
    return { action: "wait" };
  }
  return { action: "claim" };
}

const defaultWait = () => new Promise<void>((resolve) => setTimeout(resolve, 100));

export async function executeCheckoutIntent<TResult>(input: {
  store: CheckoutIntentStore<TResult>;
  fingerprint: string;
  ownerToken: string;
  create: () => Promise<TResult>;
  now?: () => number;
  wait?: () => Promise<void>;
  leaseMs?: number;
  waitTimeoutMs?: number;
}): Promise<TResult> {
  const now = input.now ?? Date.now;
  const wait = input.wait ?? defaultWait;
  const leaseMs = input.leaseMs ?? 30_000;
  const waitTimeoutMs = input.waitTimeoutMs ?? 10_000;
  const startedAtMs = now();

  for (;;) {
    const nowMs = now();
    const decision = await input.store.claim({
      fingerprint: input.fingerprint,
      ownerToken: input.ownerToken,
      nowMs,
      leaseExpiresAtMs: nowMs + leaseMs,
    });
    if (decision.action === "conflict") throw new CheckoutIntentConflictError();
    if (decision.action === "reuse") return decision.result;
    if (nowMs - startedAtMs > waitTimeoutMs) throw new CheckoutIntentPendingError();
    if (decision.action === "wait") {
      await wait();
      continue;
    }

    try {
      const result = await input.create();
      if (await input.store.complete(input.ownerToken, result)) return result;
    } catch (error) {
      await input.store.release(input.ownerToken);
      throw error;
    }
  }
}
