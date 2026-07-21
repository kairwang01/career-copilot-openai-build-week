export type BillingAudience = "candidate" | "business";
export type BillingMode = "subscription" | "payment";

export interface BillingPlanContract {
  audience: BillingAudience;
  mode: BillingMode;
}

const PLAN_CONTRACT: Record<string, BillingPlanContract> = {
  essentials: { audience: "candidate", mode: "subscription" },
  accelerator: { audience: "candidate", mode: "subscription" },
  executive: { audience: "candidate", mode: "subscription" },
  starter: { audience: "business", mode: "subscription" },
  growth: { audience: "business", mode: "subscription" },
  pro: { audience: "business", mode: "subscription" },
  single_post: { audience: "business", mode: "payment" },
  job_pack: { audience: "business", mode: "payment" },
};

export function billingPlanContractFor(plan: string): BillingPlanContract | null {
  return PLAN_CONTRACT[plan] ?? null;
}

export function hasExactBillingEntitlement(
  data: Record<string, unknown> | undefined,
  requestedPlan: string,
  options: { subscriptionOnly?: boolean } = {},
): boolean {
  const contract = billingPlanContractFor(requestedPlan);
  if (!contract) return false;
  if (options.subscriptionOnly && contract.mode !== "subscription") return false;

  return data?.active === true &&
    data.status === "active" &&
    data.plan === requestedPlan &&
    data.audience === contract.audience &&
    data.mode === contract.mode;
}
