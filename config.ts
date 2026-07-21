
import type { Plan } from './types';

export const DEFAULT_MARKET = 'Canada';

export const SUPPORTED_MARKETS = [
  'Canada',
  'United States',
  'United Kingdom',
  'Germany',
  'France',
  'Japan',
  'China',
  'Vietnam',
  'United Arab Emirates',
  'Singapore',
  'Australia',
];

export const ALL_PLANS: { [key: string]: Plan & { key: string } } = {
  free: {
    key: 'free',
    name: 'Free',
    price: '$0',
    priceDescription: 'per month',
    features: [
      '150 starter credits',
      '30 credits monthly',
      'Access to all AI tools',
      '10 tool runs per day',
    ],
    analysisLimit: 1, // Kept for legacy free analysis check
    creditsPerMonth: 30,
  },
  essentials: {
    key: 'essentials',
    name: 'Basic',
    price: '$19',
    priceDescription: 'CAD per month',
    features: [
      '300 credits included monthly',
      'Access to all AI tools',
      'PDF and Word exports',
      'Unused credits never expire',
    ],
    analysisLimit: Infinity,
    creditsPerMonth: 300,
  },
  accelerator: {
    key: 'accelerator',
    name: 'Pro',
    price: '$39',
    priceDescription: 'CAD per month',
    features: [
      '1000 credits included monthly',
      'Best value for an active job search',
      'Access to all AI tools',
      'Unused credits never expire',
    ],
    analysisLimit: Infinity,
    creditsPerMonth: 1000,
  },
  executive: {
    key: 'executive',
    name: 'Premium',
    price: '$79',
    priceDescription: 'CAD per month',
    features: [
      '3000 credits included monthly',
      'For intensive search and interview prep',
      'Access to all AI tools',
      'Priority support',
    ],
    analysisLimit: Infinity,
    creditsPerMonth: 3000,
  },
};

export const BUSINESS_PLANS: { [key: string]: Plan & { key: string } } = {
  starter: {
    key: 'starter',
    name: 'Starter',
    price: '$79',
    priceDescription: 'CAD per month',
    features: ['8 active job posts', 'AI job description generator', 'Basic candidate matching', 'Custom AI endpoint'],
    analysisLimit: 0,
    creditsPerMonth: 0,
  },
  growth: {
    key: 'growth',
    name: 'Growth',
    price: '$199',
    priceDescription: 'CAD per month',
    features: ['20 active job posts', 'Advanced candidate matching', 'Candidate pipeline management', 'Custom AI endpoint'],
    analysisLimit: 0,
    creditsPerMonth: 0,
  },
  pro: {
    key: 'pro',
    name: 'Pro / Enterprise',
    price: '$499',
    priceDescription: 'CAD per month',
    features: ['100 active job posts', 'Verified talent access', 'Applicant funnel and outreach tools', 'Custom AI endpoint'],
    analysisLimit: 0,
    creditsPerMonth: 0,
  },
};


// For legacy compatibility where only free/premium existed
export const PRICING_PLANS = {
    free: ALL_PLANS.free,
    premium: ALL_PLANS.executive, // Mapping old 'premium' to the highest tier for any lingering checks
};

export const PLAN_HIERARCHY: { [key: string]: number } = {
  free: 0,
  essentials: 1,
  accelerator: 2,
  executive: 3,
};

export const TOOL_ACCESS: { [key: string]: string } = {
    'resume-formatter': 'essentials',
    'cover-letter': 'essentials',
    'linkedin-optimizer': 'essentials',
    'email-crafter': 'essentials',
    'opportunity-finder': 'accelerator',
    'mock-interview': 'accelerator',
    'english-pro': 'accelerator',
    'agile-coach': 'accelerator',
    'performance-review-prep': 'accelerator',
    'career-path': 'executive',
    'salary-negotiation': 'executive',
    'website-builder': 'executive',
    'networking-assistant': 'executive',
    'skill-learning-plan': 'executive',
    'industry-event-scout': 'executive',
};

// This function is now less relevant with the credit system but can be kept for future feature gating.
export const hasAccess = (userPlan: string, requiredPlan: string): boolean => {
    const userLevel = PLAN_HIERARCHY[userPlan] ?? 0;
    const requiredLevel = PLAN_HIERARCHY[requiredPlan] ?? 99;
    return userLevel >= requiredLevel;
};
