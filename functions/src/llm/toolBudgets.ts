const VERY_LONG_OUTPUT_TOOLS = new Set([
  "extractTalentProfile",
  "applyResumeImprovements",
  "convertResumeFormat",
  "generatePortfolioWebsite",
  "anonymizeResume",
  "generateCandidatePrepKit",
]);

const LONG_OUTPUT_TOOLS = new Set([
  "findOpportunities",
  "generateAgilePracticeTest",
  "generateReadingPracticePassage",
  "analyzeEnglishReading",
  "generateVocabularyFlashcards",
  "formatJobDescription",
  "generateNetworkingStrategy",
  "generatePerformanceReviewPrep",
  "generateLearningPlan",
]);

const SHORT_OUTPUT_TOOLS = new Set([
  "calculateCompatibility",
  "generateSpeakingTopics",
  "evaluateReadingComprehension",
  "generateWeeklySummary",
  "checkInclusivity",
]);

export function outputTokenBudgetForTool(tool: string): number {
  if (VERY_LONG_OUTPUT_TOOLS.has(tool)) return 8_192;
  if (LONG_OUTPUT_TOOLS.has(tool)) return 4_096;
  if (SHORT_OUTPUT_TOOLS.has(tool)) return 1_024;
  return 2_048;
}

/**
 * Deterministic document reformatting does not benefit from extended reasoning.
 * Keep other tools on low thinking because they make evaluative or creative
 * decisions where the extra quality margin remains useful.
 */
export function thinkingLevelForTool(tool: string): "minimal" | "low" {
  return tool === "convertResumeFormat" ? "minimal" : "low";
}
