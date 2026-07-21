/**
 * generateCoverLetter — HTTPS Callable Cloud Function.
 *
 * Server-side port of geminiService.generateCoverLetter().
 * Flow: verify auth → deduct credits → call LLM → return result
 *
 * Frontend integration:
 *   const fn = httpsCallable(getFunctions(), "generateCoverLetter");
 *   const result = await fn({ resumeText, jobDescription, marketName });
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Type } from "@google/genai";
import { requireAuth } from "../middleware/auth";
import { resolveProvider } from "../llm/models";
import { claimMeteredToolRun, refundCredits } from "../credits/deductCredits";
import { TOOL_CREDIT_COSTS } from "../credits/schema";
import { buildPrompt } from "../llm/prompts";
import { coverLetterLanguageProtocol } from "../llm/languageProtocol";
import { correctiveInstruction, coverLetterDraftIssues } from "../llm/draftQuality";
import { ensurePlatformCaches } from "../config/env";
import { requireStructuredResult } from "../llm/structuredResult";
import {
  MAX_COVER_LETTER_JOB_DESCRIPTION_CHARS,
  MAX_OUTPUT_LANGUAGE_CHARS,
  MAX_RESUME_TEXT_CHARS,
} from "../utils/runtimeLimits";

interface GenerateCoverLetterRequest {
  resumeText: string;
  jobDescription: string;
  marketName: string;
  /** UI/output language requested by the user, e.g. "zh", "en", "fr". */
  outputLanguage?: string;
  requestId?: string;
}

interface CoverLetter {
  letter: string;
}

export const COVER_LETTER_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    letter: { type: Type.STRING },
  },
  required: ["letter"],
};

export const generateCoverLetterFunction = onCall({ invoker: "public", timeoutSeconds: 180 }, async (request) => {
  const uid = requireAuth(request);

  const data = (request.data ?? {}) as Partial<GenerateCoverLetterRequest>;

  if (typeof data.resumeText !== "string" || !data.resumeText.trim()) {
    throw new HttpsError("invalid-argument", "resumeText is required.");
  }
  if (typeof data.jobDescription !== "string" || !data.jobDescription.trim()) {
    throw new HttpsError("invalid-argument", "jobDescription is required.");
  }
  if (typeof data.marketName !== "string" || !data.marketName.trim()) {
    throw new HttpsError("invalid-argument", "marketName is required.");
  }
  if (data.resumeText.length > MAX_RESUME_TEXT_CHARS) {
    throw new HttpsError(
      "invalid-argument",
      `resumeText exceeds the ${MAX_RESUME_TEXT_CHARS} character limit.`
    );
  }
  if (data.jobDescription.length > MAX_COVER_LETTER_JOB_DESCRIPTION_CHARS) {
    throw new HttpsError(
      "invalid-argument",
      `jobDescription exceeds the ${MAX_COVER_LETTER_JOB_DESCRIPTION_CHARS} character limit.`
    );
  }
  if (data.marketName.length > 120) {
    throw new HttpsError("invalid-argument", "marketName exceeds the 120 character limit.");
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

  const metered = await claimMeteredToolRun(uid, "cover-letter", TOOL_CREDIT_COSTS["cover-letter"], {
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

  // The letter's language follows the user's explicit choice (the product
  // keeps per-language versions); the shared protocol also covers reading
  // resumes/JDs written in any language and cross-language keyword mirroring.
  const outputLanguageInstruction = coverLetterLanguageProtocol({
    outputLanguage: data.outputLanguage,
    marketName: data.marketName,
  });

  const prompt = buildPrompt("handler_cover_letter", {
    marketName: data.marketName,
    resumeText: data.resumeText,
    jobDescription: data.jobDescription,
    outputLanguageInstruction,
  });

  try {
    // resolveProvider builds the provider (and reads the API key) — keep it inside
    // the try so a missing-key/build failure also triggers the refund below.
    const provider = await resolveProvider(uid, (request.data as { model?: string })?.model, "generateCoverLetter");
    const generationStartedAt = Date.now();
    let result = await provider.generate({
      prompt,
      responseSchema: COVER_LETTER_SCHEMA,
      maxOutputTokens: 2_048,
      thinkingLevel: "low",
    });

    // Internal second-pass review: if the draft would trip the client's export
    // gate (unfinished/placeholder/too short), retry ONCE with a corrective
    // instruction — same charged call, so the user isn't billed twice and
    // almost never sees "Fix this draft before exporting".
    const firstIssues = coverLetterDraftIssues((result.raw as CoverLetter | undefined)?.letter);
    if (firstIssues.length > 0 && Date.now() - generationStartedAt <= 25_000) {
      console.warn(`[coverLetter] draft failed review (${firstIssues.join(",")}) — retrying once`);
      try {
        const retry = await provider.generate({
          prompt: `${prompt}\n\n${correctiveInstruction(firstIssues)}`,
          responseSchema: COVER_LETTER_SCHEMA,
          maxOutputTokens: 2_048,
          thinkingLevel: "minimal",
          timeoutMs: 15_000,
        });
        const retryIssues = coverLetterDraftIssues((retry.raw as CoverLetter | undefined)?.letter);
        if (retryIssues.length < firstIssues.length) result = retry;
      } catch {
        // Keep the first draft; the client gate remains the final safety net.
      }
    }

    const parsed = requireStructuredResult<CoverLetter>(
      "generateCoverLetter",
      result,
      COVER_LETTER_SCHEMA,
      generationStartedAt
    );
    if (coverLetterDraftIssues(parsed.letter).length > 0) {
      throw new Error("The cover letter draft was incomplete. Please try again.");
    }
    return parsed;
  } catch (err) {
    await refundCredits(uid, metered);
    // A plain Error reaches the client as a bare "INTERNAL" with no detail. Wrap
    // it so the failure message survives (preserve a meaningful HttpsError code).
    if (err instanceof HttpsError) throw err;
    const message = err instanceof Error ? err.message : "Cover letter generation failed.";
    throw new HttpsError("internal", message);
  }
});
