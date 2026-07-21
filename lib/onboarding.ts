/**
 * Onboarding state + helpers for the post-signup guided setup.
 *
 * Persistence is deliberately split to stay inside the Firestore field
 * allowlist (firestore.rules validUser — adding fields there requires a rules
 * deploy):
 *  - full_name  → users/{uid} profile (allowlisted)
 *  - resume     → users/{uid}.resume_text after user review/import; workspace
 *                 edits continue to auto-save from CareerApp
 *  - interest   → JobPreferences (localStorage) — feeds the AI job search and
 *                 the Browse-jobs goal banner that already exist
 *  - birthday  → users/{uid}.birth_date (YYYY-MM-DD, optional)
 *  - completion flag → per-uid localStorage
 */

const PENDING_KEY = 'onboarding_pending';
const PENDING_NAME_KEY = 'onboarding_pending_full_name';
const doneKey = (uid: string) => `onboarding_done_${uid}`;
const birthdayKey = (uid: string) => `onboarding_birthday_${uid}`;
const tourDoneKey = (uid: string) => `workspace_tour_done_${uid}`;

const safeGet = (key: string): string | null => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const safeSet = (key: string, value: string): void => {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
};
const safeRemove = (key: string): void => {
  try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
};

/** Set right after a successful candidate sign-up (Auth.tsx). */
export const markOnboardingPending = (fullName?: string): void => {
  safeSet(PENDING_KEY, '1');
  const trimmedName = fullName?.trim();
  if (trimmedName) safeSet(PENDING_NAME_KEY, trimmedName);
};

/** Best-effort bridge for the first workspace mount while the profile doc catches up. */
export const loadPendingOnboardingName = (): string => safeGet(PENDING_NAME_KEY)?.trim() ?? '';

/** True only for the freshly-registered user who hasn't finished or skipped. */
export const isOnboardingDue = (uid: string): boolean =>
  safeGet(PENDING_KEY) === '1' && safeGet(doneKey(uid)) !== '1';

export const markOnboardingDone = (uid: string): void => {
  safeSet(doneKey(uid), '1');
  safeRemove(PENDING_KEY);
  safeRemove(PENDING_NAME_KEY);
};

export const saveBirthdayLocal = (uid: string, isoDate: string): void => {
  if (isoDate) safeSet(birthdayKey(uid), isoDate);
  else safeRemove(birthdayKey(uid));
};

/** Backward-compatible read for users who completed onboarding before birth_date existed. */
export const loadBirthdayLocal = (uid: string): string => safeGet(birthdayKey(uid))?.trim() ?? '';

export const isTourDone = (uid: string): boolean => safeGet(tourDoneKey(uid)) === '1';
export const markTourDone = (uid: string): void => safeSet(tourDoneKey(uid), '1');

// ─── career-field suggestion (client-side heuristic) ─────────────────────────
// Instant, free and offline; swap for an LLM call once a server tool spec
// exists for it. Canonical ids map to i18n labels (ob_field_<id>) and to the
// English role text written into JobPreferences (AI prompts are English).

export interface CareerField {
  id: string;
  /** English role text saved into JobPreferences.roles. */
  roleText: string;
}

export const CAREER_FIELDS: CareerField[] = [
  { id: 'it', roleText: 'Software & IT' },
  { id: 'data', roleText: 'Data & Analytics' },
  { id: 'product', roleText: 'Product Management' },
  { id: 'design', roleText: 'Design & UX' },
  { id: 'marketing', roleText: 'Marketing' },
  { id: 'sales', roleText: 'Sales & Business Development' },
  { id: 'hr', roleText: 'Human Resources' },
  { id: 'finance', roleText: 'Finance & Accounting' },
  { id: 'operations', roleText: 'Operations' },
  { id: 'other', roleText: '' },
];

const FIELD_KEYWORDS: Record<string, string[]> = {
  it: ['software', 'developer', 'engineer', 'react', 'python', 'java', 'typescript', 'frontend', 'backend', 'full-stack', 'fullstack', 'devops', 'cloud', 'api', 'kubernetes'],
  data: ['data analyst', 'data scien', 'machine learning', 'analytics', 'tableau', 'power bi', 'pandas', 'statistic', 'etl', 'sql'],
  product: ['product manager', 'product owner', 'roadmap', 'user research', 'backlog', 'stakeholder', 'a/b test'],
  design: ['designer', 'ux', 'ui design', 'figma', 'photoshop', 'illustrator', 'prototype', 'wireframe'],
  marketing: ['marketing', 'seo', 'sem', 'content strategy', 'social media', 'brand', 'campaign', 'growth'],
  sales: ['sales', 'business development', 'account executive', 'account manager', 'crm', 'quota', 'pipeline'],
  hr: ['recruit', 'human resources', 'talent acquisition', 'hrbp', 'employee relations', 'compensation'],
  finance: ['accounting', 'financial', 'finance', 'audit', 'cpa', 'cfa', 'bookkeep', 'tax'],
  operations: ['operations', 'supply chain', 'logistics', 'procurement', 'process improvement'],
};

/** Top (≤2) field ids whose keywords appear in the resume; [] when no signal. */
export const suggestCareerFields = (resumeText: string): string[] => {
  const text = resumeText.toLowerCase();
  if (text.trim().length < 40) return [];
  const scores = Object.entries(FIELD_KEYWORDS)
    .map(([id, words]) => ({ id, score: words.filter((w) => text.includes(w)).length }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scores.slice(0, 2).map((s) => s.id);
};
