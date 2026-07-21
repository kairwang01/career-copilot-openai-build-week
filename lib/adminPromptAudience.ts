export type AdminPromptAudience =
  | 'candidate'
  | 'employer'
  | 'agency'
  | 'admin'
  | 'shared'
  | 'legacy';

const SHARED_PROMPT_KEYS = new Set([
  'handler_career_coach_base',
  'generateCandidatePrepKit',
  'calculateCompatibility',
  'handler_resume_analysis',
]);

const hasAudienceWord = (value: string, words: readonly string[]) => {
  const normalized = value.toLowerCase();
  return words.some((word) => new RegExp(`(^|[^a-z])${word}([^a-z]|$)`).test(normalized));
};

/** Classifies prompt ownership for the admin prompt inventory and filters. */
export const getAdminPromptAudience = (
  key: string,
  module: string,
): AdminPromptAudience => {
  if (key === 'generateOutreachEmail') return 'legacy';
  if (SHARED_PROMPT_KEYS.has(key)) return 'shared';

  if (
    hasAudienceWord(module, ['admin', 'internal']) ||
    hasAudienceWord(key, ['admin', 'internal'])
  ) return 'admin';

  if (hasAudienceWord(module, ['agency'])) return 'agency';

  if (
    module.startsWith('Employer') ||
    module === 'Applicant Funnel' ||
    key === 'handler_career_coach_employer'
  ) return 'employer';

  return 'candidate';
};
