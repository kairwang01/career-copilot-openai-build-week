/**
 * generateCareerPath — HTTPS Callable Cloud Function.
 *
 * Server-side port of geminiService.generateCareerPath().
 * Flow: verify auth → deduct credits → call LLM → return result
 *
 * Frontend integration:
 *   const fn = httpsCallable(getFunctions(), "generateCareerPath");
 *   const result = await fn({ resumeText, desiredRole, marketName });
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Type } from "@google/genai";
import { requireAuth } from "../middleware/auth";
import { resolveProvider } from "../llm/models";
import { claimMeteredToolRun, refundCredits } from "../credits/deductCredits";
import { TOOL_CREDIT_COSTS } from "../credits/schema";
import { buildPrompt } from "../llm/prompts";
import { candidateAnalysisLanguageProtocol } from "../llm/languageProtocol";
import { ensurePlatformCaches } from "../config/env";
import { requireStructuredResult } from "../llm/structuredResult";
import {
  MAX_OUTPUT_LANGUAGE_CHARS,
  MAX_RESUME_TEXT_CHARS,
} from "../utils/runtimeLimits";

// ---------------------------------------------------------------------------
// Request / Response types  (mirror types.ts in repo root)
// ---------------------------------------------------------------------------

interface GenerateCareerPathRequest {
  resumeText: string;
  desiredRole: string;
  marketName: string;
  /** UI/output language for user-visible prose, e.g. "zh", "en", "fr". */
  outputLanguage?: string;
  requestId?: string;
}

interface SkillGap {
  skill: string;
  reason: string;
}

interface ActionableStep {
  type: string;         // "course" | "certification" | "project" | "networking" | "self-study"
  description: string;
  resources: string[];
}

interface RoadmapPhase {
  phaseTitle: string;
  estimatedDuration: string;
  goal: string;
  actionableSteps: ActionableStep[];
  milestones: string[];
}

interface BridgeRole {
  title: string;
  reason: string;
}

interface CareerPathResult {
  summary: string;
  overallSkillGaps: SkillGap[];
  roadmap: RoadmapPhase[];
  bridgeRoles: BridgeRole[];
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const CAREER_PATH_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    overallSkillGaps: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          skill:  { type: Type.STRING },
          reason: { type: Type.STRING },
        },
        required: ["skill", "reason"],
      },
      minItems: "3",
      maxItems: "6",
    },
    roadmap: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          phaseTitle:         { type: Type.STRING },
          estimatedDuration:  { type: Type.STRING },
          goal:               { type: Type.STRING },
          actionableSteps: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                type: {
                  type: Type.STRING,
                  enum: ["course", "certification", "project", "networking", "self-study"],
                },
                description: { type: Type.STRING },
                resources:   { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ["type", "description", "resources"],
            },
          },
          milestones: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["phaseTitle", "estimatedDuration", "goal", "actionableSteps", "milestones"],
      },
      minItems: "2",
      maxItems: "4",
    },
    bridgeRoles: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title:  { type: Type.STRING },
          reason: { type: Type.STRING },
        },
        required: ["title", "reason"],
      },
      maxItems: "3",
    },
  },
  required: ["summary", "overallSkillGaps", "roadmap", "bridgeRoles"],
};

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------

export const generateCareerPathFunction = onCall({ invoker: "public", timeoutSeconds: 180 }, async (request) => {
  const uid = requireAuth(request);

  const data = (request.data ?? {}) as GenerateCareerPathRequest;

  if (typeof data.resumeText !== "string" || !data.resumeText.trim()) {
    throw new HttpsError("invalid-argument", "resumeText is required.");
  }
  if (typeof data.desiredRole !== "string" || !data.desiredRole.trim()) {
    throw new HttpsError("invalid-argument", "desiredRole is required.");
  }
  if (typeof data.marketName !== "string" || !data.marketName.trim()) {
    throw new HttpsError("invalid-argument", "marketName is required.");
  }
  if (data.resumeText.length > MAX_RESUME_TEXT_CHARS || data.desiredRole.length > 300 || data.marketName.length > 120) {
    throw new HttpsError("invalid-argument", "Career path input is too long.");
  }
  if (
    data.outputLanguage !== undefined &&
    (typeof data.outputLanguage !== "string" ||
      data.outputLanguage.length > MAX_OUTPUT_LANGUAGE_CHARS)
  ) {
    throw new HttpsError(
      "invalid-argument",
      `outputLanguage must be a string of at most ${MAX_OUTPUT_LANGUAGE_CHARS} characters.`
    );
  }

  const metered = await claimMeteredToolRun(uid, "career-path", TOOL_CREDIT_COSTS["career-path"], {
    requestId: data.requestId,
  });

  // Warm the cache so an admin prompt override applies even on a cold instance.
  try {
    await ensurePlatformCaches();
  } catch (err) {
    await refundCredits(uid, metered);
    throw err instanceof HttpsError
      ? err
      : new HttpsError("unavailable", "AI configuration is temporarily unavailable.");
  }

  const prompt = buildPrompt("handler_career_path", {
    marketName: data.marketName,
    desiredRole: data.desiredRole,
    resumeText: data.resumeText,
    outputLanguageInstruction: candidateAnalysisLanguageProtocol({
      outputLanguage: data.outputLanguage,
      marketName: data.marketName,
    }),
  });

  try {
    // resolveProvider builds the provider (and reads the API key) — keep it inside
    // the try so a missing-key/build failure also triggers the refund below.
    const provider = await resolveProvider(
      uid,
      (request.data as { model?: string })?.model,
      "generateCareerPath",
      { needsGoogleSearch: true }
    );
    const generationStartedAt = Date.now();
    const result = await provider.generate({
      prompt,
      responseSchema: CAREER_PATH_SCHEMA,
      useGoogleSearch: true,
      maxOutputTokens: 4_096,
      thinkingLevel: "low",
    });

    return requireStructuredResult<CareerPathResult>(
      "generateCareerPath",
      result,
      CAREER_PATH_SCHEMA,
      generationStartedAt
    );
  } catch (err) {
    await refundCredits(uid, metered);
    // A plain Error reaches the client as a bare "INTERNAL" with no detail. Wrap
    // it so the failure message survives (preserve a meaningful HttpsError code).
    if (err instanceof HttpsError) throw err;
    const message = err instanceof Error ? err.message : "Career path generation failed.";
    throw new HttpsError("internal", message);
  }
});
