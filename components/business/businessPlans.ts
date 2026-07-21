export type BusinessPlanId = 'free' | 'starter' | 'growth' | 'pro';

export interface BusinessPlanDef {
  id: BusinessPlanId;
  nameKey: string;
  price: number;
  highlight: 'popular' | null;
  featured: boolean;
  featureKeys: string[];
}

export const businessPlanDefs: BusinessPlanDef[] = [
  {
    id: 'free',
    nameKey: 'business_page_plan_free_name',
    price: 0,
    highlight: null,
    featured: false,
    featureKeys: [
      'business_page_plan_free_feature_1',
      'business_page_plan_free_feature_2',
      'business_page_plan_free_feature_3',
      'business_page_plan_free_feature_4',
    ],
  },
  {
    id: 'starter',
    nameKey: 'site_plan_emp_starter_name',
    price: 79,
    highlight: 'popular',
    featured: true,
    featureKeys: [
      'business_page_plan_starter_feature_1',
      'business_page_plan_starter_feature_2',
      'business_page_plan_starter_feature_3',
      'site_plan_emp_starter_f4',
    ],
  },
  {
    id: 'growth',
    nameKey: 'site_plan_emp_growth_name',
    price: 199,
    highlight: null,
    featured: false,
    featureKeys: [
      'business_page_plan_growth_feature_1',
      'business_page_plan_growth_feature_2',
      'business_page_plan_growth_feature_3',
      'site_plan_emp_growth_f4',
    ],
  },
  {
    id: 'pro',
    nameKey: 'business_page_plan_pro_name',
    price: 499,
    highlight: null,
    featured: false,
    featureKeys: [
      'business_page_plan_pro_feature_1',
      'business_page_plan_pro_feature_2',
      'business_page_plan_pro_feature_3',
      'site_plan_emp_team_f4',
    ],
  },
];
