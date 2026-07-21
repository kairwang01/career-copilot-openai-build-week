/**
 * Talent Profile — the reusable, structured candidate profile a job seeker fills
 * once and attaches when applying to a specific job. Filtered from a campus/intern
 * application framework for a North-American, English-first audience: NO referral
 * codes, NO government-ID / emergency-contact fields (sensitive PII not collected
 * in an application), references shown as "available on request".
 *
 * Stored at talent_profiles/{uid} (owner-only read/write; employers see it only
 * via the server-side Discover Talent / applicant flow). This is the same
 * "standardized Talent Profile" the Talent Pool consumes.
 *
 * The SCHEMA below is the single source of truth that drives the form renderer,
 * so adding a field is a one-line change. Labels are English-first.
 */

export type FieldType = "text" | "textarea" | "select" | "date" | "chips" | "switch";

export interface FieldConfig {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  options?: string[]; // for select
  suggestions?: string[]; // for chips
  full?: boolean; // span the full row
  optional?: boolean;
  help?: string;
}

export interface ObjectSection {
  id: string;
  title: string;
  kind: "object";
  fields: FieldConfig[];
}

export interface ListSection {
  id: string;
  title: string;
  kind: "list";
  itemLabel: string; // e.g. "education entry"
  itemTitleKey: string; // which item field to show as the card header
  fields: FieldConfig[];
}

export interface SkillsSection {
  id: string;
  title: string;
  kind: "skills";
  groups: { key: string; label: string; suggestions: string[] }[];
}

export type Section = ObjectSection | ListSection | SkillsSection;

// ── Option/suggestion vocabularies ──────────────────────────────────────────
const ROLE_CATEGORIES = ["Product", "Project Management", "Operations", "Engineering", "Data", "Design", "Other"];
const WORK_MODES = ["On-site", "Remote", "Hybrid"];
const DEGREES = ["High School", "Associate", "Bachelor's", "Master's", "PhD", "Other"];
const PROJECT_STATUS = ["In progress", "Completed", "Launched", "Demo", "Research"];
const YES_NO = ["Yes", "No"];
const DURATIONS = ["1–2 months", "3 months", "3–6 months", "6+ months", "Flexible"];
const WEEKLY_DAYS = ["1 day", "2 days", "3 days", "4 days", "5 days", "Flexible"];

// ── The schema (drives the whole form) ──────────────────────────────────────
export const TALENT_PROFILE_SCHEMA: Section[] = [
  {
    id: "basic",
    title: "Basic information",
    kind: "object",
    fields: [
      { key: "name", label: "Full name", type: "text", placeholder: "Jane Doe" },
      { key: "preferredName", label: "Preferred / English name", type: "text", optional: true },
      { key: "email", label: "Email", type: "text", placeholder: "you@example.com" },
      { key: "phone", label: "Phone", type: "text", optional: true },
      { key: "country", label: "Country / region", type: "text", placeholder: "Canada" },
      { key: "city", label: "Current city", type: "text", placeholder: "Ottawa, ON" },
    ],
  },
  {
    id: "intention",
    title: "Job intention",
    kind: "object",
    fields: [
      { key: "targetRole", label: "Target role", type: "text", placeholder: "Product Manager Intern" },
      { key: "roleCategory", label: "Role category", type: "select", options: ROLE_CATEGORIES },
      { key: "targetCities", label: "Preferred cities", type: "chips", placeholder: "Add a city", full: true, optional: true },
      { key: "businessInterests", label: "Areas of interest", type: "chips", placeholder: "e.g. AI, FinTech", full: true, optional: true },
      { key: "acceptRelocation", label: "Open to relocation", type: "select", options: YES_NO, optional: true },
      { key: "acceptRemoteInterview", label: "Open to remote interview", type: "select", options: YES_NO, optional: true },
      { key: "availableStartDate", label: "Earliest start date", type: "date", optional: true },
      { key: "internshipDuration", label: "Available duration", type: "select", options: DURATIONS, optional: true },
      { key: "weeklyAvailability", label: "Days per week available", type: "select", options: WEEKLY_DAYS, optional: true },
    ],
  },
  {
    id: "education",
    title: "Education",
    kind: "list",
    itemLabel: "education entry",
    itemTitleKey: "school",
    fields: [
      { key: "degree", label: "Degree", type: "select", options: DEGREES },
      { key: "school", label: "School", type: "text", placeholder: "University of Ottawa" },
      { key: "location", label: "Location", type: "text", optional: true },
      { key: "faculty", label: "Faculty / department", type: "text", optional: true },
      { key: "major", label: "Major", type: "text", placeholder: "Computer Science" },
      { key: "startDate", label: "Start date", type: "date", optional: true },
      { key: "endDate", label: "End date (or expected)", type: "date", optional: true },
      { key: "gpa", label: "GPA", type: "text", optional: true },
      { key: "gpaScale", label: "GPA scale", type: "text", placeholder: "4.0 / 10", optional: true },
      { key: "ranking", label: "Class ranking", type: "text", placeholder: "Top 5%", optional: true },
      { key: "researchDirection", label: "Research direction", type: "text", optional: true },
      { key: "relevantCourses", label: "Relevant courses", type: "chips", placeholder: "Add a course", full: true, optional: true },
      { key: "thesis", label: "Thesis / research project", type: "textarea", full: true, optional: true },
    ],
  },
  {
    id: "experience",
    title: "Internships & work experience",
    kind: "list",
    itemLabel: "experience entry",
    itemTitleKey: "company",
    fields: [
      { key: "company", label: "Company / organization", type: "text" },
      { key: "role", label: "Title", type: "text", placeholder: "Product Management Intern" },
      { key: "location", label: "Location", type: "text", optional: true },
      { key: "category", label: "Function", type: "select", options: ROLE_CATEGORIES, optional: true },
      { key: "workMode", label: "Work mode", type: "select", options: WORK_MODES, optional: true },
      { key: "startDate", label: "Start date", type: "date", optional: true },
      { key: "endDate", label: "End date", type: "date", optional: true },
      { key: "workContent", label: "What you worked on", type: "textarea", full: true, help: "The business, project, or system you worked on and your specific role." },
      { key: "collaboration", label: "How you collaborated", type: "textarea", full: true, optional: true, help: "How you worked with product, dev, design, QA, business, or clients." },
      { key: "tools", label: "Tools used", type: "chips", placeholder: "Jira, Figma, …", full: true, optional: true },
      { key: "outcome", label: "Results", type: "textarea", full: true, optional: true, help: "Outcomes you drove — efficiency gains, issues closed, delivery." },
      { key: "metrics", label: "Quantified impact", type: "chips", placeholder: "e.g. +30% efficiency", full: true, optional: true },
    ],
  },
  {
    id: "projects",
    title: "Projects",
    kind: "list",
    itemLabel: "project",
    itemTitleKey: "name",
    fields: [
      { key: "name", label: "Project name", type: "text" },
      { key: "role", label: "Your role", type: "text", placeholder: "Project Lead" },
      { key: "type", label: "Project type", type: "text", placeholder: "AI Product", optional: true },
      { key: "teamSize", label: "Team size", type: "text", optional: true },
      { key: "status", label: "Status", type: "select", options: PROJECT_STATUS, optional: true },
      { key: "startDate", label: "Start date", type: "date", optional: true },
      { key: "endDate", label: "End date", type: "date", optional: true },
      { key: "link", label: "Project link", type: "text", placeholder: "https://…", full: true, optional: true },
      { key: "background", label: "Background", type: "textarea", full: true, help: "Who it's for, the problem it solves, and why." },
      { key: "responsibilities", label: "Your responsibilities", type: "textarea", full: true, optional: true },
      { key: "process", label: "How you drove it", type: "textarea", full: true, optional: true, help: "Requirements, sprint planning, tracking, risk, reviews." },
      { key: "result", label: "Result", type: "textarea", full: true, optional: true },
      { key: "metrics", label: "Quantified metrics", type: "chips", placeholder: "e.g. 5-week cycle, 200 users", full: true, optional: true },
    ],
  },
  {
    id: "skills",
    title: "Skills",
    kind: "skills",
    groups: [
      { key: "projectManagement", label: "Project management", suggestions: ["Agile", "Scrum", "Sprint Planning", "Requirement Breakdown", "Risk Management", "Stakeholder Communication", "Progress Tracking", "Delivery Review"] },
      { key: "product", label: "Product", suggestions: ["User Research", "Product Analysis", "PRD Writing", "Feature Prioritization", "Competitive Analysis", "UX Review", "Data-Driven Iteration"] },
      { key: "tools", label: "Tools", suggestions: ["Jira", "Confluence", "Trello", "Notion", "Slack", "Figma", "Google Analytics", "GitHub"] },
      { key: "technical", label: "Technical", suggestions: ["Python", "JavaScript", "SQL", "API Basics", "Data Visualization", "Cloud Basics"] },
      { key: "ai", label: "AI", suggestions: ["LLM Workflow Design", "Prompt Engineering", "AI-Assisted Documentation", "AI-Assisted Project Management", "AI-Assisted Product Design", "AI-Assisted Code Review"] },
      { key: "languages", label: "Languages", suggestions: ["English (Native)", "French", "Mandarin", "Spanish"] },
    ],
  },
  {
    id: "awards",
    title: "Awards & honors",
    kind: "list",
    itemLabel: "award",
    itemTitleKey: "name",
    fields: [
      { key: "name", label: "Award name", type: "text" },
      { key: "type", label: "Type", type: "text", placeholder: "Scholarship, Competition, …", optional: true },
      { key: "date", label: "Year", type: "text", placeholder: "2025", optional: true },
      { key: "organization", label: "Awarding body", type: "text", optional: true },
      { key: "description", label: "Description", type: "textarea", full: true, optional: true },
    ],
  },
  {
    id: "portfolio",
    title: "Work & links",
    kind: "list",
    itemLabel: "link",
    itemTitleKey: "name",
    fields: [
      { key: "name", label: "Title", type: "text", placeholder: "Personal site, GitHub, …" },
      { key: "type", label: "Type", type: "text", placeholder: "Product Demo, GitHub, Portfolio…", optional: true },
      { key: "url", label: "Link", type: "text", placeholder: "https://…", full: true },
      { key: "description", label: "Description", type: "textarea", full: true, optional: true },
    ],
  },
  {
    id: "references",
    title: "References",
    kind: "list",
    itemLabel: "reference",
    itemTitleKey: "organization",
    fields: [
      { key: "identity", label: "Reference role", type: "text", placeholder: "Manager, Advisor, …", optional: true },
      { key: "relationship", label: "Relationship", type: "text", optional: true },
      { key: "organization", label: "Organization", type: "text", optional: true },
    ],
  },
  {
    id: "additional",
    title: "Summary",
    kind: "object",
    fields: [
      { key: "careerDirection", label: "Career direction", type: "textarea", full: true, optional: true, help: "Your target direction — PM, product, operations, AI product, etc." },
      { key: "overallStrengths", label: "Overall strengths", type: "textarea", full: true, optional: true },
      { key: "aiToolExperience", label: "How you use AI tools", type: "textarea", full: true, optional: true },
    ],
  },
];

// ── Types (shapes mirror the schema) ────────────────────────────────────────
export type SkillGroups = Record<string, string[]>;
export interface TalentProfile {
  status: "draft" | "complete";
  /** Explicit, reversible consent for de-identified employer discovery. */
  discoverable: boolean;
  updated_at?: string;
  basic: Record<string, string>;
  intention: Record<string, string | string[]>;
  education: Record<string, string | string[]>[];
  experience: Record<string, string | string[]>[];
  projects: Record<string, string | string[]>[];
  skills: SkillGroups;
  awards: Record<string, string | string[]>[];
  portfolio: Record<string, string | string[]>[];
  references: Record<string, string>[];
  additional: Record<string, string>;
}

export const emptyTalentProfile = (): TalentProfile => ({
  status: "draft",
  discoverable: false,
  basic: {},
  intention: {},
  education: [],
  experience: [],
  projects: [],
  skills: { projectManagement: [], product: [], tools: [], technical: [], ai: [], languages: [] },
  awards: [],
  portfolio: [],
  references: [],
  additional: {},
});

const hasMeaningfulValue = (value: unknown): boolean => {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasMeaningfulValue);
  return false;
};

export const hasMeaningfulEntry = (entry: Record<string, string | string[]>): boolean =>
  Object.values(entry).some(hasMeaningfulValue);

/**
 * Minimum bar to consider the profile "ready to apply": a name, a target role,
 * and at least one non-empty education OR experience entry. Kept deliberately
 * light so a candidate isn't blocked from applying by optional sections.
 */
export function isTalentProfileReady(p: TalentProfile | null | undefined): boolean {
  if (!p) return false;
  const hasName = !!(p.basic?.name && p.basic.name.trim());
  const hasTarget = !!(p.intention?.targetRole && String(p.intention.targetRole).trim());
  const hasHistory =
    (p.education ?? []).some(hasMeaningfulEntry) ||
    (p.experience ?? []).some(hasMeaningfulEntry);
  return hasName && hasTarget && hasHistory;
}

// ── Resume-extraction sanitizer ─────────────────────────────────────────────
// Coerces the raw AI output against the schema so the form fields populate
// correctly: dates → YYYY-MM-DD, select values snapped to a valid option,
// chips → clean string[]. This is what makes auto-fill "correct".

function isValidYMD(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function coerceDate(s: string): string {
  // Validate the calendar — a malformed value (2024-13, 2024-02-30) would be
  // silently blanked by <input type=date> yet persisted as garbage. Emit '' instead.
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (ymd) return isValidYMD(+ymd[1], +ymd[2], +ymd[3]) ? s : '';
  const ym = /^(\d{4})-(\d{2})$/.exec(s);
  if (ym) return isValidYMD(+ym[1], +ym[2], 1) ? `${s}-01` : '';
  if (/^\d{4}$/.test(s)) return `${s}-01-01`;
  const t = Date.parse(s);
  return Number.isNaN(t) ? '' : new Date(t).toISOString().slice(0, 10);
}

function normalizeDegree(s: string): string {
  const l = s.toLowerCase();
  if (l.includes('phd') || l.includes('doctor')) return "PhD";
  if (l.includes('master') || /\bm\.?s\.?\b|msc|m\.?eng|mba/.test(l)) return "Master's";
  if (l.includes('bachelor') || /\bb\.?s\.?\b|bsc|b\.?eng|b\.?a\.?\b|undergrad/.test(l)) return "Bachelor's";
  if (l.includes('associate')) return "Associate";
  if (l.includes('high school') || l.includes('secondary') || l.includes('diploma')) return "High School";
  return s ? "Other" : "";
}

function coerceField(field: FieldConfig, v: unknown): string | string[] {
  if (field.type === 'chips') {
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim());
    return typeof v === 'string' && v.trim() ? [v.trim()] : [];
  }
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return '';
  if (field.type === 'date') return coerceDate(s);
  if (field.type === 'select') {
    const exact = (field.options ?? []).find((o) => o.toLowerCase() === s.toLowerCase());
    if (exact) return exact;
    if (field.key === 'degree') return normalizeDegree(s);
    return ''; // unknown select value → leave blank rather than break the <select>
  }
  return s;
}

function coerceEntry(fields: FieldConfig[], raw: unknown): Record<string, string | string[]> {
  const src = (raw ?? {}) as Record<string, unknown>;
  const out: Record<string, string | string[]> = {};
  for (const f of fields) {
    const c = coerceField(f, src[f.key]);
    if ((typeof c === 'string' && c) || (Array.isArray(c) && c.length)) out[f.key] = c;
  }
  return out;
}

/** Turn raw AI extraction output into a schema-correct partial profile. */
export function sanitizeExtractedProfile(raw: unknown): Partial<TalentProfile> {
  const src = (raw ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const section of TALENT_PROFILE_SCHEMA) {
    const data = src[section.id];
    if (data == null) continue;
    if (section.kind === 'object') {
      const e = coerceEntry(section.fields, data);
      if (Object.keys(e).length) out[section.id] = e;
    } else if (section.kind === 'list' && Array.isArray(data)) {
      const entries = (data as unknown[]).map((it) => coerceEntry(section.fields, it)).filter((e) => Object.keys(e).length);
      if (entries.length) out[section.id] = entries;
    } else if (section.kind === 'skills' && data && typeof data === 'object' && !Array.isArray(data)) {
      const skills: Record<string, string[]> = {};
      for (const g of section.groups) {
        const arr = (data as Record<string, unknown>)[g.key];
        if (Array.isArray(arr)) {
          const clean = arr.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim());
          if (clean.length) skills[g.key] = clean;
        }
      }
      if (Object.keys(skills).length) out.skills = skills;
    }
  }
  return out as Partial<TalentProfile>;
}
