import { describe, expect, it } from 'vitest';
import { TOOL_REGISTRY } from '../functions/src/llm/toolRegistry';
import {
  schemaDefinitionIssues,
  validateAgainstSchema,
} from '../functions/src/llm/schemaValidation';
import {
  TOOL_PAYLOAD_CONTRACTS,
  toolPayloadIssues,
} from '../functions/src/llm/toolPayloadValidation';

const resumeText = [
  'Jordan Lee | Ottawa, ON | jordan@example.com',
  'Frontend Developer with 5 years of React and TypeScript experience.',
  'Example Co — Frontend Developer — 2021–Present',
  'Reduced page load time by 20% and built WCAG 2.2 accessible interfaces.',
  'Skills: React, TypeScript, Jest, Playwright, CSS, Git.',
].join('\n');

const jobDescription = [
  'Frontend Developer in Ottawa, Canada.',
  'Build accessible React and TypeScript interfaces, write automated tests,',
  'and collaborate with product and design teams.',
].join(' ');

const TOOL_PAYLOADS: Record<string, Record<string, unknown>> = {
  extractTalentProfile: { resumeText, targetLanguage: 'en' },
  applyResumeImprovements: {
    resumeText,
    improvements: [{ area: 'Impact', suggestion: 'Keep and clarify the existing 20% metric.' }],
  },
  convertResumeFormat: { resumeText, marketName: 'Canada', outputLanguage: 'English', jobDescription },
  calculateCompatibility: { resumeText, jobDescription },
  findOpportunities: { resumeText, marketName: 'Canada' },
  optimizeLinkedInProfile: { resumeText, marketName: 'Canada' },
  optimizeLinkedInProfileFromText: {
    profileText: 'Frontend Developer focused on accessible React products.',
    resumeText,
    marketName: 'Canada',
    customPrompt: '',
  },
  generateSkillBridgeProject: { resumeText, desiredRole: 'Senior Frontend Developer', skill: 'Web accessibility' },
  generateAgilePracticeTest: { agileRole: 'Scrum Master', agileCertification: 'PSM I' },
  generateSalaryNegotiationStrategy: {
    resumeText,
    jobTitle: 'Frontend Developer',
    company: 'Example Co',
    location: 'Ottawa',
    currentOffer: '90000',
    currency: 'CAD',
  },
  analyzeEnglishProficiency: {
    emailText: 'Hello, thank you for the interview. I look forward to hearing from you.',
    nativeLanguage: 'French',
    targetIeltsBand: '7',
  },
  generateSpeakingTopics: { targetIeltsBand: '7' },
  analyzeSpokenEnglish: {
    transcript: 'I improved the application performance by measuring and fixing slow rendering.',
    durationSeconds: 45,
    targetIeltsBand: '7',
  },
  generateReadingPracticePassage: { targetIeltsBand: '7' },
  analyzeEnglishReading: {
    textToAnalyze: 'Accessible software helps people complete important tasks independently.',
    targetIeltsBand: '7',
  },
  evaluateReadingComprehension: {
    originalText: 'Accessible software helps people complete tasks independently.',
    questionsAndAnswers: [{ question: 'What does accessible software help people do?', answer: 'Complete tasks independently.' }],
    userAnswers: ['Complete tasks independently.'],
  },
  analyzeEnglishListening: {
    originalText: 'The team released the accessible interface on Friday.',
    userTranscription: 'The team released the accessible interface on Friday.',
    targetIeltsBand: '7',
  },
  generateVocabularyFlashcards: { targetIeltsBand: '7' },
  generateProfessionalEmail: {
    resumeText,
    scenario: 'Interview follow-up',
    details: { recipient: 'Hiring manager', context: 'Frontend Developer interview' },
    marketName: 'Canada',
    tone: 50,
    style: 50,
    confidence: 50,
  },
  generateOutreachEmail: {
    candidateResumeText: resumeText,
    jobDescription,
    employerProfile: { company_name: 'Example Co' },
    marketName: 'Canada',
  },
  generatePortfolioWebsite: { resumeText },
  generateWeeklySummary: { data: { applications: 3, interviews: 1, offers: 0 } },
  generateJobDescription: {
    jobTitle: 'Frontend Developer',
    keyResponsibilities: 'Build accessible React interfaces and tests.',
    companyName: 'Example Co',
    companyDescription: 'A Canadian SaaS company.',
  },
  analyzeSalary: { jobTitle: 'Frontend Developer', location: 'Ottawa', jobDescription },
  checkInclusivity: { jobDescription },
  formatJobDescription: { jobDescription },
  analyzeCandidateMatch: { resumeText, jobDescription },
  generateNetworkingStrategy: {
    resumeText,
    targetCompany: 'Example Co',
    targetRole: 'Frontend Developer',
    targetLocation: 'Ottawa',
    marketName: 'Canada',
  },
  generatePerformanceReviewPrep: {
    resumeText,
    userAccomplishments: 'Reduced load time by 20% and improved accessibility.',
    jobTitle: 'Frontend Developer',
  },
  generateLearningPlan: { resumeText, skillToLearn: 'Web accessibility', marketName: 'Canada' },
  findIndustryEvents: { fieldOfInterest: 'Frontend engineering', location: 'Ottawa' },
  anonymizeResume: { resumeText, agencyName: 'Example Talent' },
  generateClientPitchEmail: { candidateResumeText: resumeText, candidateName: 'Jordan Lee', jobDescription },
  generateCandidatePrepKit: {
    resumeText,
    jobDescription,
    targetRole: 'Frontend Developer',
    marketName: 'Canada',
    sourceNotes: 'Interviewers often ask about accessibility trade-offs.',
  },
};

const REQUIRED_SCHEMA_FIELDS: Record<string, Array<[string, string[]]>> = {
  extractTalentProfile: [['$', ['basic', 'intention', 'education', 'experience', 'projects', 'skills', 'awards', 'portfolio', 'additional']]],
  optimizeLinkedInProfile: [['experienceSuggestions[]', ['title', 'suggestion']]],
  optimizeLinkedInProfileFromText: [['experienceSuggestions[]', ['title', 'suggestion']]],
  generateAgilePracticeTest: [['practiceQuestions[]', ['questionText', 'options', 'correctAnswerIndex', 'explanation']]],
  analyzeEnglishProficiency: [
    ['overallBand', ['level', 'description']],
    ['improvementAreas[]', ['category', 'originalText', 'suggestion', 'explanation']],
  ],
  analyzeSpokenEnglish: [['fillerWords[]', ['word', 'count']]],
  generateReadingPracticePassage: [['comprehensionQuestions[]', ['question', 'answer']]],
  analyzeEnglishReading: [
    ['vocabularyList[]', ['word', 'definition', 'example']],
    ['comprehensionQuestions[]', ['question', 'answer']],
  ],
  generateVocabularyFlashcards: [['cards[]', ['word', 'definition', 'distractors']]],
  generatePortfolioWebsite: [
    ['socials', ['linkedin', 'github', 'twitter']],
    ['skills[]', ['icon', 'category', 'description']],
    ['experience[]', ['date', 'title', 'company', 'description']],
    ['projects[]', ['title', 'description', 'url', 'category']],
  ],
  checkInclusivity: [['suggestions[]', ['originalText', 'suggestion', 'explanation']]],
  formatJobDescription: [['$', ['formattedDescription', 'jobTitle', 'location']]],
  generateNetworkingStrategy: [['contactSuggestions[]', ['contactType', 'reason', 'outreachMessage']]],
  generatePerformanceReviewPrep: [['talkingPoints[]', ['accomplishment', 'starMethodPoint']]],
  generateLearningPlan: [['learningPhases[]', ['phaseTitle', 'duration', 'keyActivities', 'milestone']]],
  findIndustryEvents: [
    ['$', ['events']],
    ['events[]', ['eventName', 'date', 'location', 'url', 'summary', 'eventType']],
  ],
};

function schemaNodeAt(schema: any, path: string): any {
  if (path === '$') return schema;
  return path.split('.').reduce((node, segment) => {
    const isArray = segment.endsWith('[]');
    const key = isArray ? segment.slice(0, -2) : segment;
    const child = node?.properties?.[key];
    return isArray ? child?.items : child;
  }, schema);
}

describe('generic AI tool contracts', () => {
  it('keeps a representative payload for every registered tool', () => {
    expect(Object.keys(TOOL_PAYLOADS).sort()).toEqual(Object.keys(TOOL_REGISTRY).sort());
    expect(Object.keys(TOOL_PAYLOAD_CONTRACTS).sort()).toEqual(Object.keys(TOOL_REGISTRY).sort());
    for (const tool of Object.keys(TOOL_REGISTRY)) {
      expect(toolPayloadIssues(tool, TOOL_PAYLOADS[tool]), tool).toEqual([]);
    }
  });

  it('rejects missing or malformed payload fields before a model call', () => {
    expect(toolPayloadIssues('calculateCompatibility', { resumeText })).toContain(
      'jobDescription must be a non-empty string',
    );
    expect(toolPayloadIssues('applyResumeImprovements', {
      resumeText,
      improvements: [{ area: 'Impact' }],
    })).toContain('improvements[0] must contain non-empty area and suggestion strings');
    expect(toolPayloadIssues('evaluateReadingComprehension', {
      originalText: 'Text',
      questionsAndAnswers: [{ question: 'Q', answer: 'A' }],
      userAnswers: [],
    })).toContain('userAnswers must be a non-empty array');
  });

  it('builds every prompt without unresolved placeholders and with a valid schema', () => {
    for (const [tool, spec] of Object.entries(TOOL_REGISTRY)) {
      const request = spec.build(TOOL_PAYLOADS[tool]);
      expect(request.prompt.trim(), `${tool} prompt`).not.toBe('');
      expect(request.prompt, `${tool} unresolved placeholder`).not.toMatch(/{{\s*[\w.]+\s*}}/);
      expect(request.responseSchema, `${tool} response schema`).toBeDefined();
      expect(schemaDefinitionIssues(request.responseSchema), `${tool} malformed schema`).toEqual([]);

      if (spec.quotaFallback) {
        const fallback = spec.quotaFallback(TOOL_PAYLOADS[tool]);
        expect(fallback.prompt.trim(), `${tool} fallback prompt`).not.toBe('');
        expect(schemaDefinitionIssues(fallback.responseSchema), `${tool} fallback schema`).toEqual([]);
      }
    }
  });

  it('never exposes a live-data tool without evidence or a declared safe fallback', () => {
    for (const [tool, spec] of Object.entries(TOOL_REGISTRY)) {
      if (!spec.requiresGrounding) continue;
      const request = spec.build(TOOL_PAYLOADS[tool]);
      expect(request.useGoogleSearch, `${tool} search`).toBe(true);
      expect(
        Boolean(spec.quotaFallback) || spec.ungroundedFallbackData !== undefined,
        `${tool} safe grounding fallback`,
      ).toBe(true);
    }
  });

  it('requires every nested field that frontend renderers consume directly', () => {
    for (const [tool, requirements] of Object.entries(REQUIRED_SCHEMA_FIELDS)) {
      const schema = TOOL_REGISTRY[tool].build(TOOL_PAYLOADS[tool]).responseSchema;
      for (const [path, fields] of requirements) {
        const node = schemaNodeAt(schema, path);
        expect(node, `${tool} ${path}`).toBeDefined();
        expect(node.required, `${tool} ${path} required`).toEqual(expect.arrayContaining(fields));
      }
    }
  });
});

describe('tool response schema validator', () => {
  const schema = {
    type: 'OBJECT',
    properties: {
      score: { type: 'NUMBER', minimum: 0, maximum: 100 },
      items: {
        type: 'ARRAY',
        minItems: 1,
        items: {
          type: 'OBJECT',
          properties: {
            label: { type: 'STRING', enum: ['a', 'b'] },
            count: { type: 'INTEGER' },
          },
          required: ['label', 'count'],
        },
      },
    },
    required: ['score', 'items'],
  };

  it('accepts a complete response', () => {
    expect(validateAgainstSchema({ score: 90, items: [{ label: 'a', count: 1 }] }, schema)).toEqual([]);
  });

  it('reports missing, wrong-type, enum, and range failures with paths', () => {
    const issues = validateAgainstSchema({ score: 101, items: [{ label: 'c' }] }, schema);
    expect(issues).toEqual(expect.arrayContaining([
      { path: '$.score', message: 'number is above maximum 100' },
      { path: '$.items[0].count', message: 'required field is missing' },
      { path: '$.items[0].label', message: 'value is not one of a, b' },
    ]));
  });
});
