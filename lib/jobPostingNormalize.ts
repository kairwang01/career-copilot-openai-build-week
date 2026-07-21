import type { JobPosting, ScreenerQuestion } from './recruitingData';

const trimString = (value: unknown, max = 500): string => (
  typeof value === 'string' ? value.trim().slice(0, max) : ''
);

const nullableString = (value: unknown, max = 500): string | null => {
  const trimmed = trimString(value, max);
  return trimmed || null;
};

export function cleanStringArray(value: unknown, maxItems = 40, maxLength = 120): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const trimmed = trimString(item, maxLength);
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= maxItems) break;
  }
  return out;
}

export function normalizeScreenerQuestions(value: unknown): ScreenerQuestion[] {
  if (!Array.isArray(value)) return [];
  const out: ScreenerQuestion[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const raw = item as Record<string, unknown>;
    const prompt = trimString(raw.prompt, 300);
    if (!prompt) continue;
    const type = raw.type === 'yes_no' || raw.type === 'short_text' ? raw.type : 'short_text';
    const expectedRaw = trimString(raw.expected, 12).toLowerCase();
    out.push({
      id: trimString(raw.id, 80) || `q${out.length + 1}`,
      prompt,
      type,
      required: raw.required === true,
      expected: type === 'yes_no' && (expectedRaw === 'yes' || expectedRaw === 'no') ? expectedRaw : null,
    });
    if (out.length >= 8) break;
  }
  return out;
}

export function normalizeJobPostingForClient(job: JobPosting): JobPosting {
  const raw = job as unknown as Record<string, unknown>;
  return {
    ...job,
    id: trimString(raw.id, 160),
    employer_id: trimString(raw.employer_id, 160),
    title: trimString(raw.title, 180),
    company_name: nullableString(raw.company_name, 180),
    organization_verification: raw.organization_verification === 'verified'
      ? 'verified'
      : 'unverified_self_reported',
    company_size: nullableString(raw.company_size, 120),
    industry: nullableString(raw.industry, 120),
    founded_year: nullableString(raw.founded_year, 40),
    location: nullableString(raw.location, 180),
    description: nullableString(raw.description, 20000),
    salary_range: nullableString(raw.salary_range, 120),
    is_active: raw.is_active !== false,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : new Date().toISOString(),
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : null,
    work_mode: nullableString(raw.work_mode, 80),
    employment_type: nullableString(raw.employment_type, 80),
    experience_level: nullableString(raw.experience_level, 80),
    department: nullableString(raw.department, 120),
    responsibilities: nullableString(raw.responsibilities, 8000),
    required_qualifications: nullableString(raw.required_qualifications, 8000),
    nice_to_have_qualifications: nullableString(raw.nice_to_have_qualifications, 8000),
    required_skills: cleanStringArray(raw.required_skills, 30, 80),
    preferred_skills: cleanStringArray(raw.preferred_skills, 30, 80),
    application_deadline: nullableString(raw.application_deadline, 40),
    headcount: typeof raw.headcount === 'number' && Number.isFinite(raw.headcount) ? raw.headcount : null,
    visa_sponsorship: raw.visa_sponsorship === true,
    relocation: raw.relocation === true,
    language_requirement: nullableString(raw.language_requirement, 200),
    interview_process: nullableString(raw.interview_process, 4000),
    campus_new_grad: raw.campus_new_grad === true,
    screener_questions: normalizeScreenerQuestions(raw.screener_questions),
  };
}
