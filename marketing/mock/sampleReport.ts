export interface SampleReport {
  candidateName: string;
  atsReadiness: number;
  roleFit: number;
  missingKeywords: string[];
  matchedKeywords: string[];
  bridgeRoles: string[];
}

export const sampleReport: SampleReport = {
  candidateName: 'Alex Chen',
  atsReadiness: 72,
  roleFit: 68,
  missingKeywords: ['roadmap prioritization', 'stakeholder alignment', 'OKRs', 'user research synthesis'],
  matchedKeywords: ['cross-functional', 'Agile', 'SQL', 'A/B testing', 'Jira'],
  bridgeRoles: ['Technical Product Owner', 'Associate PM (B2B SaaS)'],
};
