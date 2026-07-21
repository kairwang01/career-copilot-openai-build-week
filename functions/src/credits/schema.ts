/**
 * Firestore schema constants.
 *
 * ALL Firestore field names and collection paths live here.
 * If the schema ever changes, only this file needs updating —
 * deductCredits.ts and every handler stay untouched.
 *
 * users/{uid} shape:
 *   credits:             number   — current balance (M9 transaction target)
 *   role:                string   — "candidate" | "employer" | "agency"
 *   subscription_status: string   — "free" | "pro" | ...
 *   full_name:           string | null
 *   avatar_url:          string | null
 *   created_at:          string   — ISO timestamp
 *   updated_at:          string   — ISO timestamp
 *
 * Field names use snake_case to match the frontend UserProfile type (types.ts).
 */

/** Top-level collection for user documents. */
export const USERS_COLLECTION = "users";

/** Initial one-time balance for a newly provisioned account. */
export const INITIAL_CREDITS = 150;

/** Field names on the users/{uid} document. */
export const USER_FIELDS = {
  credits: "credits",
  role: "role",
  subscriptionStatus: "subscription_status",
  fullName: "full_name",
  companyName: "company_name",
  organizationVerified: "organization_verified",
  roleProvenance: "role_provenance",
  roleProvisionedAt: "role_provisioned_at",
  avatarUrl: "avatar_url",
  createdAt: "created_at",
  updatedAt: "updated_at",
} as const;

/**
 * Per-tool credit costs.
 *
 * CANONICAL SOURCE: the frontend `config/credits.ts` TOOL_CREDIT_COSTS table.
 * This is a deliberate mirror — the two TypeScript projects (Vite app vs Firebase
 * Functions) build separately and a repo-root shared module is NOT bundled into the
 * deployed function, so the table is duplicated here on purpose. If a price changes,
 * update BOTH `config/credits.ts` (canonical) and this file together.
 *
 * Values reconciled to the frontend numbers on 2026-06-08 (prior server values had
 * drifted: mock-interview 20→150, career-path 15→100, cover-letter 10→20,
 * opportunity-finder 10→50, english-pro 5→15).
 */
export const TOOL_CREDIT_COSTS: Record<string, number> = {
  "resume-analysis": 10,
  "resume-formatter": 20,
  "opportunity-finder": 50,
  "linkedin-optimizer": 20,
  "cover-letter": 20,
  // Pricing rule: every tool must be affordable on a fresh account's initial
  // grant (INITIAL_CREDITS = 150), so new users can try the full toolbox.
  // mock-interview was 150 and website-builder 250 — new free users could
  // literally never use them (live audit 2026-06-10).
  "mock-interview": 50,
  "career-path": 100,
  "agile-coach": 25,
  "salary-negotiation": 75,
  "english-pro": 15,
  "email-crafter": 5,
  "website-builder": 90,
  "networking-assistant": 40,
  "performance-review-prep": 40,
  "skill-learning-plan": 50,
  "industry-event-scout": 50,
} as const;

/**
 * One-off credit packs (separate from subscription plans).
 *
 * CANONICAL SOURCE: the frontend `config/credits.ts` CREDIT_PACKS table. This is a
 * deliberate mirror (the two TypeScript projects build separately — see the note on
 * TOOL_CREDIT_COSTS above). If a pack's credit amount changes, update BOTH files.
 * Buying a pack grants these credits one time; it does NOT change role or plan.
 */
export const CREDIT_PACK_CREDITS: Record<string, number> = {
  pack_100: 150,
  pack_500: 600,
  pack_1000: 1200,
} as const;
