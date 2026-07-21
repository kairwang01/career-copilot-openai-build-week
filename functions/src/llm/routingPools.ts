import type { ModelEntry, RoutingPool, RoutingPoolMember } from "../admin/schema";

export interface RoutingCandidate {
  member: RoutingPoolMember;
  model: ModelEntry;
}

export function routingPoolTiers(pool: RoutingPool): number[] {
  return [...new Set(pool.members
    .filter((m) => m.enabled && m.tier > 0 && m.weight > 0)
    .map((m) => m.tier))]
    .sort((a, b) => a - b);
}

export function routingPoolForRoute(
  routeKey: string | undefined,
  moduleRoutes: Record<string, string>,
  pools: RoutingPool[]
): RoutingPool | null {
  const poolId = routeKey ? moduleRoutes[routeKey] : undefined;
  return poolId ? pools.find((pool) => pool.id === poolId && pool.enabled) ?? null : null;
}

/** True for pools whose product contract prioritizes interactive latency. */
export function isLatencyPriorityPool(pool: Pick<RoutingPool, "id" | "label">): boolean {
  return /speed|fast|latency|quick|rapid|速度|快速|极速/i.test(`${pool.id} ${pool.label}`);
}

/** Chooses an attempt deadline without exceeding the route or caller budget. */
export function routingAttemptTimeoutMs(
  attemptBudgetMs: number,
  remainingRouteMs: number,
  requestTimeoutMs?: number
): number {
  return Math.max(
    1_000,
    Math.min(attemptBudgetMs, remainingRouteMs, requestTimeoutMs ?? attemptBudgetMs)
  );
}

export function candidatesForPoolTier(
  pool: RoutingPool,
  registry: ModelEntry[],
  allowedModelIds: Set<string>,
  tier: number
): RoutingCandidate[] {
  return pool.members.flatMap((member) => {
    if (!member.enabled || member.tier !== tier || member.weight <= 0) return [];
    const model = registry.find((m) => m.id === member.modelId && m.enabled);
    if (!model || !allowedModelIds.has(model.id)) return [];
    return [{ member, model }];
  });
}

export function selectWeightedCandidate<T extends { member: { weight: number } }>(
  candidates: T[],
  random = Math.random
): T | null {
  const total = candidates.reduce((sum, c) => sum + Math.max(0, c.member.weight), 0);
  if (total <= 0) return null;
  let pick = random() * total;
  for (const candidate of candidates) {
    pick -= Math.max(0, candidate.member.weight);
    if (pick < 0) return candidate;
  }
  return candidates[candidates.length - 1] ?? null;
}

export interface PinnableKey {
  key: string;
  source: "api_key" | "api_keys";
  /** Position within the runtime key pool (post-filter), NOT the raw stored array. */
  index: number;
}

/**
 * The saved keys a routing-pool member may pin via keyHash. MUST mirror the
 * runtime pool in models.ts#resolveKeyPool so that admin previews, pool
 * validation, and connectivity tests all describe keys the router will
 * actually use: gemini models expose none (their runtime pool is empty), a
 * non-empty api_keys pool shadows the legacy api_key entirely, and builtin
 * platform keys are excluded (they have no admin-visible preview; leave the
 * member unpinned to use them).
 */
export function pinnableKeysForModel(entry: ModelEntry): PinnableKey[] {
  if (entry.provider === "gemini") return [];
  const pooled = (entry.api_keys ?? []).filter((k) => k.trim().length > 0);
  if (pooled.length > 0) {
    return pooled.map((key, index) => ({ key, source: "api_keys" as const, index }));
  }
  if (entry.api_key && entry.api_key.trim()) {
    return [{ key: entry.api_key, source: "api_key" as const, index: 0 }];
  }
  return [];
}

export function implicitFallbackCandidates(
  allowedModels: ModelEntry[],
  chosenId: string,
  limit = 3
): ModelEntry[] {
  return allowedModels
    .filter((m) => m.id !== chosenId && m.id !== "custom" && m.enabled)
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
    .slice(0, limit);
}
