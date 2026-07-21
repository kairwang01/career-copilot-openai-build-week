export type TimelineStatus = 'done' | 'in_progress' | 'pending';

export interface TimelineStep {
  id: string;
  label: string;
  status: TimelineStatus;
  detail?: string;
}

export interface CareerPathPlan {
  currentRole: string;
  targetRole: string;
  bridgeRole: string;
  timeline: TimelineStep[];
  skillGaps: { skill: string; priority: 'high' | 'medium'; progress: number }[];
  fourWeekPlan: { week: number; focus: string; tasks: string[]; status: TimelineStatus }[];
}

export const careerPathPlan: CareerPathPlan = {
  currentRole: 'Software Developer',
  targetRole: 'Product Manager',
  bridgeRole: 'Technical Product Owner',
  timeline: [
    { id: 't1', label: 'Current role baseline', status: 'done', detail: 'Resume uploaded · gaps identified' },
    { id: 't2', label: 'Bridge role readiness', status: 'in_progress', detail: '2 of 4 skill gaps addressed' },
    { id: 't3', label: 'Bridge applications', status: 'pending', detail: 'Starts week 3' },
    { id: 't4', label: 'Target role transition', status: 'pending', detail: 'Estimated month 4–6' },
  ],
  skillGaps: [
    { skill: 'User interview synthesis', priority: 'high', progress: 40 },
    { skill: 'Roadmap prioritization frameworks', priority: 'high', progress: 25 },
    { skill: 'Stakeholder communication', priority: 'medium', progress: 60 },
    { skill: 'Pricing & packaging basics', priority: 'medium', progress: 10 },
  ],
  fourWeekPlan: [
    {
      week: 1,
      focus: 'Evidence collection',
      tasks: ['Shadow 2 PM customer calls', 'Document 3 problems your team solved this quarter'],
      status: 'done',
    },
    {
      week: 2,
      focus: 'Portfolio bullets',
      tasks: ['Rewrite 4 resume bullets in STAR format', 'Add one discovery → delivery story'],
      status: 'in_progress',
    },
    {
      week: 3,
      focus: 'Bridge role applications',
      tasks: ['Apply to 5 Technical PO roles', 'Tailor keywords per job description'],
      status: 'pending',
    },
    {
      week: 4,
      focus: 'Interview prep',
      tasks: ['2 product sense drills', '1 mock stakeholder alignment scenario'],
      status: 'pending',
    },
  ],
};
