#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const projectArg = process.argv.find((arg) => arg.startsWith('--project='));
const project = projectArg?.slice('--project='.length) || process.env.FIREBASE_PROJECT_ID;

async function resolveApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  if (!project) throw new Error('Set GEMINI_API_KEY or pass --project=<firebase-project>.');
  const token = execFileSync('gcloud', ['auth', 'print-access-token'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  const url = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/platform_config/llm`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Could not read Gemini config (${response.status}).`);
  const document = await response.json();
  const key = document.fields?.gemini_api_key?.stringValue;
  if (!key) throw new Error('Firestore Gemini key is missing.');
  return key;
}

process.env.GEMINI_API_KEY = await resolveApiKey();
process.env.GEMINI_MODEL = 'gemini-3.5-flash';
process.env.OPPORTUNITY_USE_GOOGLE_SEARCH = 'true';

const { GeminiProvider } = require('../functions/lib/llm/providers/geminiProvider.js');
const { TOOL_REGISTRY } = require('../functions/lib/llm/toolRegistry.js');
const { outputTokenBudgetForTool, thinkingLevelForTool } = require('../functions/lib/llm/toolBudgets.js');
const { validateAgainstSchema } = require('../functions/lib/llm/schemaValidation.js');

const resumeText = [
  'Jordan Lee | Ottawa, ON | jordan@example.com | +1 613 555 0100',
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

const payloads = {
  extractTalentProfile: { resumeText, targetLanguage: 'en' },
  applyResumeImprovements: { resumeText, improvements: [{ area: 'Impact', suggestion: 'Clarify the existing 20% metric.' }] },
  convertResumeFormat: { resumeText, marketName: 'Canada', outputLanguage: 'English', jobDescription },
  calculateCompatibility: { resumeText, jobDescription },
  findOpportunities: { resumeText, marketName: 'Canada' },
  optimizeLinkedInProfile: { resumeText, marketName: 'Canada' },
  optimizeLinkedInProfileFromText: { profileText: 'Frontend Developer focused on accessible React products.', resumeText, marketName: 'Canada', customPrompt: '', additionalUrl: 'https://example.com/profile' },
  generateSkillBridgeProject: { resumeText, desiredRole: 'Senior Frontend Developer', skill: 'Web accessibility' },
  generateAgilePracticeTest: { agileRole: 'Scrum Master', agileCertification: 'PSM I' },
  generateSalaryNegotiationStrategy: { resumeText, jobTitle: 'Frontend Developer', company: 'Example Co', location: 'Ottawa', currentOffer: '90000', currency: 'CAD' },
  analyzeEnglishProficiency: { emailText: 'Hello, thank you for the interview. I look forward to hearing from you.', nativeLanguage: 'French', targetIeltsBand: '7' },
  generateSpeakingTopics: { targetIeltsBand: '7' },
  analyzeSpokenEnglish: { transcript: 'I improved performance by measuring and fixing slow rendering.', durationSeconds: 45, targetIeltsBand: '7' },
  generateReadingPracticePassage: { targetIeltsBand: '7' },
  analyzeEnglishReading: { textToAnalyze: 'Accessible software helps people complete important tasks independently.', targetIeltsBand: '7' },
  evaluateReadingComprehension: { originalText: 'Accessible software helps people complete tasks independently.', questionsAndAnswers: [{ question: 'What does it help people do?', answer: 'Complete tasks independently.' }], userAnswers: ['Complete tasks independently.'] },
  analyzeEnglishListening: { originalText: 'The team released the accessible interface on Friday.', userTranscription: 'The team released the accessible interface on Friday.', targetIeltsBand: '7' },
  generateVocabularyFlashcards: { targetIeltsBand: '7' },
  generateProfessionalEmail: { resumeText, scenario: 'Interview follow-up', details: { recipient: 'Hiring manager' }, marketName: 'Canada', tone: 50, style: 50, confidence: 50 },
  generateOutreachEmail: { candidateResumeText: resumeText, jobDescription, employerProfile: { full_name: 'Morgan Recruiter', company_name: 'Example Co', company_description: 'A Canadian SaaS company.', birth_date: 'private', credits: 999 }, marketName: 'Canada' },
  generatePortfolioWebsite: { resumeText },
  generateWeeklySummary: { data: { applications: 3, interviews: 1, offers: 0 } },
  generateJobDescription: { jobTitle: 'Frontend Developer', keyResponsibilities: 'Build accessible React interfaces and tests.', companyName: 'Example Co', companyDescription: 'A Canadian SaaS company.' },
  analyzeSalary: { jobTitle: 'Frontend Developer', location: 'Ottawa', jobDescription },
  checkInclusivity: { jobDescription },
  formatJobDescription: { jobDescription },
  analyzeCandidateMatch: { resumeText, jobDescription },
  generateNetworkingStrategy: { resumeText, targetCompany: 'Example Co', targetRole: 'Frontend Developer', targetLocation: 'Ottawa', marketName: 'Canada' },
  generatePerformanceReviewPrep: { resumeText, userAccomplishments: 'Reduced load time by 20% and improved accessibility.', jobTitle: 'Frontend Developer' },
  generateLearningPlan: { resumeText, skillToLearn: 'Web accessibility', marketName: 'Canada' },
  findIndustryEvents: { fieldOfInterest: 'Frontend engineering', location: 'Ottawa' },
  anonymizeResume: { resumeText, agencyName: 'Example Talent' },
  generateClientPitchEmail: { candidateResumeText: resumeText, candidateName: 'Jordan Lee', jobDescription },
  generateCandidatePrepKit: { resumeText, jobDescription, targetRole: 'Frontend Developer', marketName: 'Canada', sourceNotes: 'Interviewers often ask about accessibility trade-offs.' },
};

const provider = new GeminiProvider('gemini-3.5-flash');

async function auditTool(tool) {
  const spec = TOOL_REGISTRY[tool];
  const request = spec.build(payloads[tool]);
  request.maxOutputTokens = outputTokenBudgetForTool(tool);
  request.thinkingLevel = thinkingLevelForTool(tool);
  request.timeoutMs = 60_000;
  const startedAt = Date.now();
  try {
    const result = await provider.generate(request);
    const contractIssues = validateAgainstSchema(result.raw, request.responseSchema);
    const qualityIssues = spec.qualityCheck ? spec.qualityCheck(result.raw, payloads[tool]) : [];
    return {
      tool,
      ok: contractIssues.length === 0 && (!spec.blockOnQualityFailure || qualityIssues.length === 0),
      elapsedMs: Date.now() - startedAt,
      search: request.useGoogleSearch === true,
      outputTokens: result.usage?.outputTokens ?? null,
      responseChars: result.text.length,
      contractIssues: contractIssues.map((issue) => `${issue.path} ${issue.message}`).slice(0, 8),
      qualityIssues,
      groundingChunks: Array.isArray(result.groundingChunks) ? result.groundingChunks.length : 0,
    };
  } catch (error) {
    return {
      tool,
      ok: false,
      elapsedMs: Date.now() - startedAt,
      search: request.useGoogleSearch === true,
      error: String(error?.message ?? error).slice(0, 300),
    };
  }
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
      process.stderr.write(`${results[index].ok ? 'PASS' : 'FAIL'} ${items[index]} ${results[index].elapsedMs}ms\n`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

const allTools = Object.keys(TOOL_REGISTRY);
if (allTools.length !== 34 || Object.keys(payloads).length !== allTools.length) {
  throw new Error(`Fixture coverage mismatch: registry=${allTools.length}, fixtures=${Object.keys(payloads).length}.`);
}
const toolsArg = process.argv.find((arg) => arg.startsWith('--tools='));
const tools = toolsArg
  ? toolsArg.slice('--tools='.length).split(',').map((tool) => tool.trim()).filter(Boolean)
  : allTools;
for (const tool of tools) {
  if (!TOOL_REGISTRY[tool]) throw new Error(`Unknown tool in --tools: ${tool}`);
}
const results = await mapWithConcurrency(tools, 2, auditTool);
const elapsed = results.map((item) => item.elapsedMs).sort((a, b) => a - b);
const percentile = (p) => elapsed[Math.min(elapsed.length - 1, Math.floor(elapsed.length * p))];
console.log(JSON.stringify({
  model: 'gemini-3.5-flash',
  sdk: require('../functions/node_modules/@google/genai/package.json').version,
  total: results.length,
  passed: results.filter((item) => item.ok).length,
  failed: results.filter((item) => !item.ok).length,
  p50Ms: percentile(0.5),
  p95Ms: percentile(0.95),
  results,
}, null, 2));

process.exitCode = results.some((item) => !item.ok) ? 1 : 0;
