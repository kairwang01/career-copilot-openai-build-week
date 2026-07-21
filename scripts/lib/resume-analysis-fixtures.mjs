/**
 * Builds the single schema-valid resume analysis used by Web3 QA fixtures.
 * Keep this aligned with ANALYSIS_SCHEMA in functions/src/handlers/analyzeResume.ts.
 */
export function buildWeb3EligibleAnalysis({ createdAt, summary } = {}) {
  if (
    !createdAt ||
    typeof createdAt !== 'object' ||
    typeof createdAt.toMillis !== 'function' ||
    !Number.isFinite(createdAt.toMillis())
  ) {
    throw new TypeError('createdAt must be a valid Firestore Timestamp.');
  }

  return {
    score: 90,
    market_name: 'Canada',
    summary: summary ?? 'Strong frontend profile with clear, measurable technical impact.',
    strengths: [
      'Clear role progression',
      'Strong React and TypeScript depth',
      'Accessible interface delivery',
      'Evidence of cross-functional ownership',
    ],
    improvements: [
      { area: 'Impact', suggestion: 'Quantify delivery outcomes with business or user metrics.' },
      { area: 'Scope', suggestion: 'State the scale of the systems, teams, or audiences supported.' },
      { area: 'Leadership', suggestion: 'Add a concise example of technical or project leadership.' },
      { area: 'Keywords', suggestion: 'Mirror relevant role terminology where the experience supports it.' },
    ],
    keywords: [
      'React',
      'TypeScript',
      'Accessibility',
      'Frontend Engineering',
      'Design Systems',
      'Testing',
      'Performance',
      'Collaboration',
    ],
    created_at: createdAt,
  };
}
