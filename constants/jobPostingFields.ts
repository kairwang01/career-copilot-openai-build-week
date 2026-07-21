/**
 * Structured job-posting field schema — the single front-end source of truth for
 * the enum option sets and their i18n label keys. The server (functions/src/
 * handlers/jobPostings.ts) keeps a mirror of the enum values for validation;
 * if you change an enum here, change it there too.
 *
 * These structured fields turn a free-text posting into filterable, matchable,
 * packet-ready data for Apply Review / Applicant Packet / AI matching.
 */
export const WORK_MODES = ['remote', 'hybrid', 'onsite'] as const;
export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'internship', 'contract', 'co_op'] as const;
export const EXPERIENCE_LEVELS = ['internship', 'entry', 'junior', 'mid', 'senior'] as const;

export type WorkMode = (typeof WORK_MODES)[number];
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

/** i18n label key for an enum option, e.g. job_field_work_mode_remote. */
export const workModeLabelKey = (v: string): string => `job_field_work_mode_${v}`;
export const employmentTypeLabelKey = (v: string): string => `job_field_employment_type_${v}`;
export const experienceLevelLabelKey = (v: string): string => `job_field_experience_level_${v}`;

/** Structured fields carried on a job posting (server-validated). All optional on
 *  the read type because legacy postings predate them. */
export interface StructuredJobFields {
  work_mode: WorkMode | null;
  employment_type: EmploymentType | null;
  experience_level: ExperienceLevel | null;
  department: string | null;
  responsibilities: string | null;
  required_qualifications: string | null;
  nice_to_have_qualifications: string | null;
  required_skills: string[];
  preferred_skills: string[];
  application_deadline: string | null;
  headcount: number | null;
  // optional
  visa_sponsorship: boolean;
  relocation: boolean;
  language_requirement: string | null;
  interview_process: string | null;
  campus_new_grad: boolean;
}
