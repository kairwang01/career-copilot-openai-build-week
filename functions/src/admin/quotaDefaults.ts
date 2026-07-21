import { TOOL_CREDIT_COSTS } from "../credits/schema";
import { PlanKey, PlanQuota, QuotasDoc, ToolQuota } from "./schema";

export const PLAN_KEYS: PlanKey[] = [
  "free",
  "essentials",
  "accelerator",
  "executive",
  "starter",
  "growth",
  "pro",
  "single_post",
  "job_pack",
];

const PLAN_KEY_SET = new Set<string>(PLAN_KEYS);

export const DEFAULT_PLAN_QUOTAS: Record<PlanKey, PlanQuota> = {
  free: {
    daily_run_limit: 10,
    daily_credit_limit: 0,
    monthly_credit_grant: 30,
    active_job_limit: 3,
  },
  essentials: {
    daily_run_limit: 0,
    daily_credit_limit: 0,
    monthly_credit_grant: 300,
    active_job_limit: 0,
  },
  accelerator: {
    daily_run_limit: 0,
    daily_credit_limit: 0,
    monthly_credit_grant: 1000,
    active_job_limit: 0,
  },
  executive: {
    daily_run_limit: 0,
    daily_credit_limit: 0,
    monthly_credit_grant: 3000,
    active_job_limit: 0,
  },
  starter: {
    daily_run_limit: 0,
    daily_credit_limit: 0,
    monthly_credit_grant: 3000,
    active_job_limit: 8,
  },
  growth: {
    daily_run_limit: 0,
    daily_credit_limit: 0,
    monthly_credit_grant: 8000,
    active_job_limit: 20,
  },
  pro: {
    daily_run_limit: 0,
    daily_credit_limit: 0,
    monthly_credit_grant: 20000,
    active_job_limit: 100,
  },
  single_post: {
    daily_run_limit: 0,
    daily_credit_limit: 0,
    monthly_credit_grant: 0,
    active_job_limit: 1,
  },
  job_pack: {
    daily_run_limit: 0,
    daily_credit_limit: 0,
    monthly_credit_grant: 0,
    active_job_limit: 5,
  },
};

export const USER_VISIBLE_TOOL_KEYS = Object.keys(TOOL_CREDIT_COSTS).sort();

export function normalizePlanKey(value: string | undefined | null): PlanKey {
  return PLAN_KEY_SET.has(value ?? "") ? (value as PlanKey) : "free";
}

function wholeNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

export function defaultToolQuota(tool: string): ToolQuota | null {
  const defaultCost = TOOL_CREDIT_COSTS[tool];
  if (typeof defaultCost !== "number") return null;
  return {
    enabled: true,
    credit_cost: defaultCost,
    allowed_plans: [...PLAN_KEYS],
  };
}

export function effectivePlanQuotas(doc: QuotasDoc | null | undefined): Record<PlanKey, PlanQuota> {
  const out = {} as Record<PlanKey, PlanQuota>;
  for (const key of PLAN_KEYS) {
    const defaults = DEFAULT_PLAN_QUOTAS[key];
    const override = doc?.plan_quotas?.[key] ?? {};
    out[key] = {
      daily_run_limit: wholeNumber(override.daily_run_limit, defaults.daily_run_limit),
      daily_credit_limit: wholeNumber(override.daily_credit_limit, defaults.daily_credit_limit),
      monthly_credit_grant: wholeNumber(override.monthly_credit_grant, defaults.monthly_credit_grant),
      active_job_limit: wholeNumber(override.active_job_limit, defaults.active_job_limit),
    };
  }
  return out;
}

export function effectivePlanQuota(
  doc: QuotasDoc | null | undefined,
  plan: string | undefined | null
): PlanQuota {
  return effectivePlanQuotas(doc)[normalizePlanKey(plan)];
}

export function effectiveToolQuota(
  doc: QuotasDoc | null | undefined,
  tool: string
): ToolQuota | null {
  const defaults = defaultToolQuota(tool);
  const override = doc?.tool_quotas?.[tool];
  if (!defaults && !override) return null;
  const allowedRaw = Array.isArray(override?.allowed_plans)
    ? override?.allowed_plans
    : defaults?.allowed_plans ?? [];
  const allowed_plans = allowedRaw
    .filter((p): p is PlanKey => PLAN_KEY_SET.has(String(p)))
    .filter((p, idx, arr) => arr.indexOf(p) === idx);
  return {
    enabled: override?.enabled ?? defaults?.enabled ?? true,
    credit_cost: wholeNumber(override?.credit_cost, defaults?.credit_cost ?? 0),
    allowed_plans,
  };
}

export function effectiveToolQuotas(doc: QuotasDoc | null | undefined): Record<string, ToolQuota> {
  const keys = new Set<string>([...USER_VISIBLE_TOOL_KEYS, ...Object.keys(doc?.tool_quotas ?? {})]);
  const out: Record<string, ToolQuota> = {};
  for (const key of Array.from(keys).sort()) {
    const quota = effectiveToolQuota(doc, key);
    if (quota) out[key] = quota;
  }
  return out;
}

export function effectiveQuotasDoc(doc: QuotasDoc | null | undefined): QuotasDoc {
  return {
    ...(doc ?? {}),
    enabled: doc?.enabled !== false,
    plan_quotas: effectivePlanQuotas(doc),
    tool_quotas: effectiveToolQuotas(doc),
  };
}
