export interface CaseSnapshot {
  id: string;
  tagKey: string;
  titleKey: string;
  outcomeKey: string;
  metricKey: string;
}

export const caseSnapshots: CaseSnapshot[] = [
  {
    id: 'cs1',
    tagKey: 'site_case_tag_switcher',
    titleKey: 'site_case_switcher_title',
    outcomeKey: 'site_case_switcher_outcome',
    metricKey: 'site_case_switcher_metric',
  },
  {
    id: 'cs2',
    tagKey: 'site_case_tag_newcomer',
    titleKey: 'site_case_newcomer_title',
    outcomeKey: 'site_case_newcomer_outcome',
    metricKey: 'site_case_newcomer_metric',
  },
  {
    id: 'cs3',
    tagKey: 'site_case_tag_employer',
    titleKey: 'site_case_employer_title',
    outcomeKey: 'site_case_employer_outcome',
    metricKey: 'site_case_employer_metric',
  },
];
