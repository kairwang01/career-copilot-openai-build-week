
// CANONICAL per-tool credit prices. The server mirrors these in
// functions/src/credits/schema.ts (separate build, not a shared import) — when a
// price changes here, update that file too.
export const TOOL_CREDIT_COSTS = {
    'resume-analysis': 10,
    'resume-formatter': 20,
    'opportunity-finder': 50,
    'linkedin-optimizer': 20,
    'cover-letter': 20,
    // Pricing rule: every tool must be affordable on a fresh account's initial
    // grant (150 credits server-side), so new users can try the full toolbox.
    // mock-interview was 150 and website-builder 250 — new free users could
    // literally never use them (live audit 2026-06-10).
    'mock-interview': 50,
    'career-path': 100,
    'agile-coach': 25,
    'salary-negotiation': 75,
    'english-pro': 15,
    'email-crafter': 5,
    'website-builder': 90,
    'networking-assistant': 40,
    'performance-review-prep': 40,
    'skill-learning-plan': 50,
    'industry-event-scout': 50,
};

// Initial grants or monthly allowances for subscription plans
export const PLAN_CREDITS = {
    free: 150,       // One-time grant for new sign-ups
    essentials: 300,
    accelerator: 1000,
    executive: 3000,
};

export const PLAN_MONTHLY_CREDITS = {
    free: 30,
    essentials: 300,
    accelerator: 1000,
    executive: 3000,
};

export const BUSINESS_PLAN_CREDITS = {
    single_post: 0,
    job_pack: 0,
};

export const INITIAL_USER_CREDITS = 150;

export const CREDIT_PACKS = [
    {
        key: 'pack_100',
        name: 'Starter Pack',
        credits: 150,
        price: '$3',
        priceDescription: 'one-time purchase',
    },
    {
        key: 'pack_500',
        name: 'Booster Pack',
        credits: 600,
        price: '$9',
        priceDescription: 'one-time purchase (25% off)',
    },
    {
        key: 'pack_1000',
        name: 'Pro Pack',
        credits: 1200,
        price: '$15',
        priceDescription: 'one-time purchase (38% off)',
    },
];

export const ENGLISH_PRO_PRACTICE_REWARD = 5;
