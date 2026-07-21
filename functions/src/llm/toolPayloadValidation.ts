/** Request contracts for every generic AI tool. */

import { MAX_RESUME_TEXT_CHARS } from "../utils/runtimeLimits";

type PayloadType = "array" | "number" | "object" | "string" | "string-or-number";

interface ToolPayloadContract {
  required: Record<string, PayloadType>;
  optional?: Record<string, PayloadType>;
  atLeastOne?: string[];
}
export const TOOL_PAYLOAD_CONTRACTS: Record<string, ToolPayloadContract> = {
  extractTalentProfile: { required: { resumeText: "string" }, optional: { targetLanguage: "string" } },
  applyResumeImprovements: { required: { resumeText: "string", improvements: "array" } },
  convertResumeFormat: {
    required: { resumeText: "string", marketName: "string" },
    optional: { outputLanguage: "string", jobDescription: "string", coverLetterText: "string" },
  },
  calculateCompatibility: { required: { resumeText: "string", jobDescription: "string" } },
  findOpportunities: { required: { resumeText: "string", marketName: "string" } },
  optimizeLinkedInProfile: { required: { resumeText: "string", marketName: "string" } },
  optimizeLinkedInProfileFromText: {
    required: { profileText: "string", marketName: "string" },
    optional: { resumeText: "string", customPrompt: "string", additionalUrl: "string" },
  },
  generateSkillBridgeProject: { required: { resumeText: "string", desiredRole: "string", skill: "string" } },
  generateAgilePracticeTest: { required: { agileRole: "string", agileCertification: "string" } },
  generateSalaryNegotiationStrategy: {
    required: {
      resumeText: "string",
      jobTitle: "string",
      company: "string",
      location: "string",
      currentOffer: "string-or-number",
      currency: "string",
    },
  },
  analyzeEnglishProficiency: { required: { emailText: "string", nativeLanguage: "string", targetIeltsBand: "string-or-number" } },
  generateSpeakingTopics: { required: { targetIeltsBand: "string-or-number" } },
  analyzeSpokenEnglish: { required: { transcript: "string", durationSeconds: "number", targetIeltsBand: "string-or-number" } },
  generateReadingPracticePassage: { required: { targetIeltsBand: "string-or-number" } },
  analyzeEnglishReading: { required: { textToAnalyze: "string", targetIeltsBand: "string-or-number" } },
  evaluateReadingComprehension: { required: { originalText: "string", questionsAndAnswers: "array", userAnswers: "array" } },
  analyzeEnglishListening: { required: { originalText: "string", userTranscription: "string", targetIeltsBand: "string-or-number" } },
  generateVocabularyFlashcards: { required: { targetIeltsBand: "string-or-number" } },
  generateProfessionalEmail: {
    required: {
      resumeText: "string",
      scenario: "string",
      details: "object",
      marketName: "string",
      tone: "number",
      style: "number",
      confidence: "number",
    },
  },
  generateOutreachEmail: {
    required: { candidateResumeText: "string", jobDescription: "string", employerProfile: "object", marketName: "string" },
  },
  generatePortfolioWebsite: { required: { resumeText: "string" } },
  generateWeeklySummary: { required: { data: "object" } },
  generateJobDescription: {
    required: { jobTitle: "string", keyResponsibilities: "string", companyName: "string" },
    optional: { companyDescription: "string" },
  },
  analyzeSalary: { required: { jobTitle: "string", location: "string" }, optional: { jobDescription: "string" } },
  checkInclusivity: { required: { jobDescription: "string" } },
  formatJobDescription: { required: { jobDescription: "string" } },
  analyzeCandidateMatch: { required: { resumeText: "string", jobDescription: "string" } },
  generateNetworkingStrategy: {
    required: { resumeText: "string", targetCompany: "string", targetRole: "string", targetLocation: "string", marketName: "string" },
  },
  generatePerformanceReviewPrep: { required: { resumeText: "string", userAccomplishments: "string", jobTitle: "string" } },
  generateLearningPlan: { required: { resumeText: "string", skillToLearn: "string" }, optional: { marketName: "string" } },
  findIndustryEvents: { required: { fieldOfInterest: "string", location: "string" } },
  anonymizeResume: { required: { resumeText: "string" }, optional: { agencyName: "string" } },
  generateClientPitchEmail: {
    required: { candidateResumeText: "string", candidateName: "string" },
    optional: { jobDescription: "string" },
  },
  generateCandidatePrepKit: {
    required: { resumeText: "string" },
    optional: { jobDescription: "string", targetRole: "string", marketName: "string", sourceNotes: "string" },
    atLeastOne: ["jobDescription", "targetRole"],
  },
};

export function toolPayloadIssues(tool: string, payload: unknown): string[] {
  const contract = TOOL_PAYLOAD_CONTRACTS[tool];
  if (!contract) return ["tool has no payload contract"];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return ["payload must be an object"];
  }
  const record = payload as Record<string, unknown>;
  const issues: string[] = [];
  for (const [field, type] of Object.entries(contract.required)) {
    const issue = valueIssue(record[field], type, true);
    if (issue) issues.push(`${field} ${issue}`);
  }
  for (const [field, type] of Object.entries(contract.optional ?? {})) {
    if (record[field] === undefined || record[field] === null || record[field] === "") continue;
    const issue = valueIssue(record[field], type, false);
    if (issue) issues.push(`${field} ${issue}`);
  }
  if (contract.atLeastOne && !contract.atLeastOne.some((field) => isNonEmptyString(record[field]))) {
    issues.push(`one of ${contract.atLeastOne.join(", ")} is required`);
  }

  for (const field of ["resumeText", "candidateResumeText"] as const) {
    const value = record[field];
    if (typeof value === "string" && value.length > MAX_RESUME_TEXT_CHARS) {
      issues.push(`${field} exceeds the ${MAX_RESUME_TEXT_CHARS} character limit`);
    }
  }

  if (tool === "applyResumeImprovements" && Array.isArray(record.improvements)) {
    record.improvements.forEach((item, index) => {
      if (!item || typeof item !== "object" ||
          !isNonEmptyString((item as Record<string, unknown>).area) ||
          !isNonEmptyString((item as Record<string, unknown>).suggestion)) {
        issues.push(`improvements[${index}] must contain non-empty area and suggestion strings`);
      }
    });
  }
  if (tool === "evaluateReadingComprehension" &&
      Array.isArray(record.questionsAndAnswers) && Array.isArray(record.userAnswers) &&
      record.questionsAndAnswers.length !== record.userAnswers.length) {
    issues.push("questionsAndAnswers and userAnswers must have the same length");
  }
  return issues;
}

function valueIssue(value: unknown, type: PayloadType, required: boolean): string | undefined {
  if (type === "string") {
    return isNonEmptyString(value) ? undefined : required ? "must be a non-empty string" : "must be a string";
  }
  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value) ? undefined : "must be a finite number";
  }
  if (type === "string-or-number") {
    return isNonEmptyString(value) || (typeof value === "number" && Number.isFinite(value))
      ? undefined
      : "must be a non-empty string or finite number";
  }
  if (type === "array") {
    return Array.isArray(value) && (!required || value.length > 0) ? undefined : "must be a non-empty array";
  }
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? undefined
    : "must be an object";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
