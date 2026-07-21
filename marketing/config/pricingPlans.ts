export interface PricingPlanConfig {
  id: string;
  featureCount: number;
  recommended: boolean;
  isCustomPrice?: boolean;
}

export const jobseekerPlans: PricingPlanConfig[] = [
  { id: 'js_free', featureCount: 3, recommended: false },
  { id: 'js_essentials', featureCount: 5, recommended: false },
  { id: 'js_accelerator', featureCount: 5, recommended: true },
  { id: 'js_executive', featureCount: 5, recommended: false },
];

export const employerPlans: PricingPlanConfig[] = [
  { id: 'emp_free', featureCount: 4, recommended: false },
  { id: 'emp_starter', featureCount: 4, recommended: true },
  { id: 'emp_growth', featureCount: 4, recommended: false },
  { id: 'emp_team', featureCount: 4, recommended: false },
];

export const planKey = (id: string, field: 'name' | 'price' | 'desc' | `f${number}`) =>
  `site_plan_${id}_${field}`;
