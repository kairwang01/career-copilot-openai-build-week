import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

export type TalentValue = string | string[];
export type TalentRecord = Record<string, TalentValue>;

export interface TalentProfileSnapshot {
  status: "draft" | "complete";
  discoverable: boolean;
  updated_at?: string;
  basic: TalentRecord;
  intention: TalentRecord;
  education: TalentRecord[];
  experience: TalentRecord[];
  projects: TalentRecord[];
  skills: Record<string, string[]>;
  awards: TalentRecord[];
  portfolio: TalentRecord[];
  references: TalentRecord[];
  additional: TalentRecord;
}

const MAX_STRING = 2000;
const MAX_ITEMS = 8;
const MAX_CHIPS = 24;

const SECTION_KEYS = {
  basic: ["name", "preferredName", "email", "phone", "country", "city"],
  intention: [
    "targetRole",
    "roleCategory",
    "targetCities",
    "businessInterests",
    "acceptRelocation",
    "acceptRemoteInterview",
    "availableStartDate",
    "internshipDuration",
    "weeklyAvailability",
  ],
  education: [
    "degree",
    "school",
    "location",
    "faculty",
    "major",
    "startDate",
    "endDate",
    "gpa",
    "gpaScale",
    "ranking",
    "researchDirection",
    "relevantCourses",
    "thesis",
  ],
  experience: [
    "company",
    "role",
    "location",
    "category",
    "workMode",
    "startDate",
    "endDate",
    "workContent",
    "collaboration",
    "tools",
    "outcome",
    "metrics",
  ],
  projects: [
    "name",
    "role",
    "type",
    "teamSize",
    "status",
    "startDate",
    "endDate",
    "link",
    "background",
    "responsibilities",
    "process",
    "result",
    "metrics",
  ],
  awards: ["name", "type", "date", "organization", "description"],
  portfolio: ["name", "type", "url", "description"],
  references: ["identity", "relationship", "organization"],
  additional: ["careerDirection", "overallStrengths", "aiToolExperience"],
};

const SKILL_GROUPS = ["projectManagement", "product", "tools", "technical", "ai", "languages"];

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_STRING) : "";
}

function cleanArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 160))
    .slice(0, MAX_CHIPS);
}

function cleanValue(value: unknown): TalentValue | undefined {
  if (Array.isArray(value)) {
    const arr = cleanArray(value);
    return arr.length ? arr : undefined;
  }
  const str = cleanString(value);
  return str ? str : undefined;
}

function cleanRecord(value: unknown, keys: string[]): TalentRecord {
  const src = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const out: TalentRecord = {};
  for (const key of keys) {
    const clean = cleanValue(src[key]);
    if (clean !== undefined) out[key] = clean;
  }
  return out;
}

function cleanList(value: unknown, keys: string[]): TalentRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanRecord(item, keys))
    .filter((item) => Object.keys(item).length > 0)
    .slice(0, MAX_ITEMS);
}

function cleanSkills(value: unknown): Record<string, string[]> {
  const src = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const out: Record<string, string[]> = {};
  for (const key of SKILL_GROUPS) {
    const arr = cleanArray(src[key]);
    if (arr.length) out[key] = arr;
  }
  return out;
}

function toIso(value: unknown): string | undefined {
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as Timestamp).toDate().toISOString();
  }
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : undefined;
}

function hasRecordContent(record: TalentRecord): boolean {
  return Object.keys(record).length > 0;
}

function hasProfileContent(profile: TalentProfileSnapshot): boolean {
  return (
    hasRecordContent(profile.basic) ||
    hasRecordContent(profile.intention) ||
    profile.education.length > 0 ||
    profile.experience.length > 0 ||
    profile.projects.length > 0 ||
    Object.keys(profile.skills).length > 0 ||
    profile.awards.length > 0 ||
    profile.portfolio.length > 0 ||
    profile.references.length > 0 ||
    hasRecordContent(profile.additional)
  );
}

export function normalizeTalentProfile(data: admin.firestore.DocumentData | undefined): TalentProfileSnapshot | null {
  if (!data) return null;
  const profile: TalentProfileSnapshot = {
    status: data.status === "complete" ? "complete" : "draft",
    discoverable: data.discoverable === true,
    updated_at: toIso(data.updated_at),
    basic: cleanRecord(data.basic, SECTION_KEYS.basic),
    intention: cleanRecord(data.intention, SECTION_KEYS.intention),
    education: cleanList(data.education, SECTION_KEYS.education),
    experience: cleanList(data.experience, SECTION_KEYS.experience),
    projects: cleanList(data.projects, SECTION_KEYS.projects),
    skills: cleanSkills(data.skills),
    awards: cleanList(data.awards, SECTION_KEYS.awards),
    portfolio: cleanList(data.portfolio, SECTION_KEYS.portfolio),
    references: cleanList(data.references, SECTION_KEYS.references),
    additional: cleanRecord(data.additional, SECTION_KEYS.additional),
  };
  return hasProfileContent(profile) ? profile : null;
}

function formatValue(value: TalentValue): string {
  return Array.isArray(value) ? value.join(", ") : value;
}

function pushRecord(lines: string[], title: string, record: TalentRecord, excludedKeys = new Set<string>()) {
  const values = Object.entries(record)
    .filter(([key]) => !excludedKeys.has(key))
    .map(([key, value]) => `${key}: ${formatValue(value)}`);
  if (values.length) lines.push(`${title}: ${values.join("; ")}`);
}

function pushList(lines: string[], title: string, list: TalentRecord[]) {
  list.forEach((item, index) => {
    const values = Object.entries(item).map(([key, value]) => `${key}: ${formatValue(value)}`);
    if (values.length) lines.push(`${title} ${index + 1}: ${values.join("; ")}`);
  });
}

export function talentProfileToMatchText(profile: TalentProfileSnapshot | null): string {
  if (!profile) return "";
  const lines: string[] = [];
  pushRecord(lines, "Job intention", profile.intention);
  pushRecord(lines, "Basic profile", profile.basic, new Set(["email", "phone"]));
  pushList(lines, "Education", profile.education);
  pushList(lines, "Experience", profile.experience);
  pushList(lines, "Project", profile.projects);
  for (const [group, values] of Object.entries(profile.skills)) {
    if (values.length) lines.push(`Skills ${group}: ${values.join(", ")}`);
  }
  pushList(lines, "Award", profile.awards);
  pushList(lines, "Portfolio", profile.portfolio);
  pushRecord(lines, "Summary", profile.additional);
  return lines.join("\n").slice(0, 20_000);
}

const DISCOVERY_INTENTION_KEYS = new Set([
  "targetRole", "roleCategory", "businessInterests", "acceptRelocation",
  "acceptRemoteInterview", "internshipDuration", "weeklyAvailability",
]);
const DISCOVERY_EDUCATION_KEYS = new Set([
  "degree", "faculty", "major", "researchDirection", "relevantCourses", "thesis",
]);
const DISCOVERY_EXPERIENCE_KEYS = new Set([
  "role", "category", "workMode", "workContent", "collaboration", "tools", "outcome", "metrics",
]);
const DISCOVERY_PROJECT_KEYS = new Set([
  "role", "type", "teamSize", "status", "background", "responsibilities", "process", "result", "metrics",
]);

export interface TalentDiscoveryContext {
  text: string;
  /** Exact candidate-supplied identifiers removed again from model output. */
  sensitiveTerms: string[];
}

function selectedRecord(record: TalentRecord, allowed: Set<string>): TalentRecord {
  return Object.fromEntries(Object.entries(record).filter(([key]) => allowed.has(key)));
}

function pushSensitiveValue(target: Set<string>, value: TalentValue | undefined): void {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  for (const entry of values) {
    const trimmed = entry.trim();
    // Short names are common in several supported languages. Dropping one- or
    // two-character identifiers (for example, a Chinese name) makes exact
    // redaction silently fail, so retain every non-empty candidate value.
    if (trimmed) target.add(trimmed.slice(0, 300));
  }
}

function collectSensitiveTerms(profile: TalentProfileSnapshot): string[] {
  const terms = new Set<string>();
  for (const value of Object.values(profile.basic)) pushSensitiveValue(terms, value);
  for (const row of profile.education) {
    for (const key of ["school", "location", "gpa", "gpaScale", "ranking"]) pushSensitiveValue(terms, row[key]);
  }
  for (const row of profile.experience) {
    for (const key of ["company", "location"]) pushSensitiveValue(terms, row[key]);
  }
  for (const row of profile.projects) {
    for (const key of ["name", "link"]) pushSensitiveValue(terms, row[key]);
  }
  for (const row of profile.awards) {
    for (const value of Object.values(row)) pushSensitiveValue(terms, value);
  }
  for (const row of [...profile.portfolio, ...profile.references]) {
    for (const value of Object.values(row)) pushSensitiveValue(terms, value);
  }
  // The normalized profile already bounds every section and field. Keeping the
  // complete identifier set avoids leaking whichever values happened to fall
  // beyond an unrelated global slice while remaining computationally bounded.
  return [...terms].sort((a, b) => b.length - a.length);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Removes general contact patterns plus candidate-specific identifiers. */
export function redactTalentDiscoveryText(value: string, sensitiveTerms: string[] = []): string {
  let out = value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[redacted-link]")
    .replace(/(?:\+?\d[\d() .-]{7,}\d)/g, "[redacted-phone]");
  for (const term of sensitiveTerms) {
    if (!term) continue;
    const escaped = escapeRegExp(term);
    // For very short ASCII identifiers, redact only the standalone token so a
    // name such as "Al" does not corrupt unrelated words such as "Algolia".
    // Non-ASCII names do not have reliable JavaScript word boundaries, so they
    // remain exact literal matches.
    const pattern = term.length < 3 && /^[A-Za-z0-9]+$/.test(term)
      ? `(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`
      : escaped;
    out = out.replace(new RegExp(pattern, "gi"), "[redacted]");
  }
  return out.slice(0, 20_000);
}

/**
 * Builds the only context allowed to leave the database during passive employer
 * discovery. Contact fields, resume text, exact organizations/schools, dates,
 * links, awards and references are excluded; candidate-specific terms are also
 * redacted from narrative fields and later from model output.
 */
export function talentProfileToDiscoveryContext(profile: TalentProfileSnapshot | null): TalentDiscoveryContext {
  if (!profile || profile.discoverable !== true || profile.status !== "complete") {
    return { text: "", sensitiveTerms: [] };
  }
  const sensitiveTerms = collectSensitiveTerms(profile);
  const lines: string[] = [];
  pushRecord(lines, "Job intention", selectedRecord(profile.intention, DISCOVERY_INTENTION_KEYS));
  profile.education.forEach((row, index) =>
    pushRecord(lines, `Education ${index + 1}`, selectedRecord(row, DISCOVERY_EDUCATION_KEYS)));
  profile.experience.forEach((row, index) =>
    pushRecord(lines, `Experience ${index + 1}`, selectedRecord(row, DISCOVERY_EXPERIENCE_KEYS)));
  profile.projects.forEach((row, index) =>
    pushRecord(lines, `Project ${index + 1}`, selectedRecord(row, DISCOVERY_PROJECT_KEYS)));
  for (const [group, values] of Object.entries(profile.skills)) {
    if (values.length) lines.push(`Skills ${group}: ${values.join(", ")}`);
  }
  pushRecord(lines, "Summary", profile.additional);
  return {
    text: redactTalentDiscoveryText(lines.join("\n"), sensitiveTerms),
    sensitiveTerms,
  };
}

/** Combined ceiling on the per-candidate context handed to the match LLM. The
 *  resume (write-capped at 200k) and the structured profile (≤20k) were being
 *  concatenated with no joint cap → up to ~220k chars/candidate × the parallel
 *  match fan-out. A match judgement does not need 200k chars of resume. */
export const MAX_MATCH_CONTEXT_CHARS = 30_000;

/** Combine resume text + structured-profile match text into one capped context.
 *  The structured profile is preserved in full; the resume is truncated to fit. */
export function buildCandidateMatchContext(resumeText: string, profileText: string): string {
  const profilePart = profileText ? `Structured Talent Profile:\n${profileText}` : "";
  const resumeBudget = Math.max(0, MAX_MATCH_CONTEXT_CHARS - profilePart.length - 2);
  return [resumeText.trim().slice(0, resumeBudget), profilePart].filter(Boolean).join("\n\n");
}
