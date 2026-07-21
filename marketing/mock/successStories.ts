/** Illustrative audience workflows and their supporting tools. */
export interface AudienceScenario {
  id: string;
  roleKey: string;
  summaryKey: string;
  toolKeys: [string, string, string];
}

export const audienceScenarios: AudienceScenario[] = [
  {
    id: 'ana',
    roleKey: 'audience_story_ana_role',
    summaryKey: 'audience_story_ana_quote',
    toolKeys: ['audience_story_ana_tool_1', 'audience_story_ana_tool_2', 'audience_story_ana_tool_3'],
  },
  {
    id: 'ben',
    roleKey: 'audience_story_ben_role',
    summaryKey: 'audience_story_ben_quote',
    toolKeys: ['audience_story_ben_tool_1', 'audience_story_ben_tool_2', 'audience_story_ben_tool_3'],
  },
  {
    id: 'chloe',
    roleKey: 'audience_story_chloe_role',
    summaryKey: 'audience_story_chloe_quote',
    toolKeys: ['audience_story_chloe_tool_1', 'audience_story_chloe_tool_2', 'audience_story_chloe_tool_3'],
  },
  {
    id: 'david',
    roleKey: 'audience_story_david_role',
    summaryKey: 'audience_story_david_quote',
    toolKeys: ['audience_story_david_tool_1', 'audience_story_david_tool_2', 'audience_story_david_tool_3'],
  },
];
