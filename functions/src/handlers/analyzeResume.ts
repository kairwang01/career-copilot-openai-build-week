/**
 * analyzeResume — HTTPS Callable Cloud Function.
 *
 * Secure replacement for the client-side geminiService.analyzeResume().
 * The Gemini API key never leaves the server.
 *
 * Flow: verify auth → atomically claim the metered run → call LLM → return result.
 * Failed provider calls refund the claimed credits through the shared ledger.
 *
 * Frontend integration:
 *   import { getFunctions, httpsCallable } from "firebase/functions";
 *   const fn = httpsCallable(getFunctions(), "analyzeResume");
 *   const result = await fn({ resumeText, marketName });
 *
 * Request shape: AnalyzeResumeRequest (see below)
 * Response shape: AnalysisResult (mirrors types.ts in the repo root)
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

// ---------------------------------------------------------------------------
// Request / Response types
// (These mirror the types in the repo root types.ts.
//  If the frontend types change, update these in sync.)
// ---------------------------------------------------------------------------

interface ResumeImage {
  mimeType: string;
  data: string; // base64 encoded
}

interface AnalyzeResumeRequest {
  /** Plain text content of the resume. Provide this OR resumeImages — not both. */
  resumeText?: string;
  /** Base64-encoded resume images for multimodal analysis. */
  resumeImages?: ResumeImage[];
  /** Target job market, e.g. "Canada", "United States". Required. */
  marketName: string;
  /** UI/output language requested by the user, e.g. "zh", "en", "fr". */
  outputLanguage?: string;
  /** Client-generated idempotency key for one user action. */
  requestId?: string;
}

interface Improvement {
  area: string;
  suggestion: string;
}

interface AnalysisResult {
  score: number;
  summary: string;
  strengths: string[];
  improvements: Improvement[];
  keywords: string[];
  extractedText?: string;
}

// ---------------------------------------------------------------------------
// Gemini response schema — mirrors the schema in the frontend geminiService.ts
// ---------------------------------------------------------------------------
export const ANALYSIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    score: { type: Type.INTEGER, minimum: 0, maximum: 100 },
    summary: { type: Type.STRING },
    strengths: { type: Type.ARRAY, items: { type: Type.STRING }, minItems: "4", maxItems: "6" },
    improvements: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          area: { type: Type.STRING },
          suggestion: { type: Type.STRING },
        },
        required: ["area", "suggestion"],
      },
      minItems: "4",
      maxItems: "6",
    },
    keywords: { type: Type.ARRAY, items: { type: Type.STRING }, minItems: "8", maxItems: "15" },
    extractedText: { type: Type.STRING },
  },
  required: ["score", "summary", "strengths", "improvements", "keywords"],
};

export const ANALYSIS_IMAGE_SCHEMA = {
  ...ANALYSIS_SCHEMA,
  required: [...ANALYSIS_SCHEMA.required, "extractedText"],
};

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------
export const analyzeResumeFunction = onCall({ invoker: "public", timeoutSeconds: 180 }, async (request) => {
  // Step 1: Verify authentication
  // requireAuth throws HttpsError("unauthenticated") if the caller is not signed in.
  const uid = requireAuth(request);

  // Step 2: Validate input
  const data = request.data as AnalyzeResumeRequest;

  if (typeof data.marketName !== "string" || !data.marketName.trim() || data.marketName.length > 120) {
    throw new HttpsError("invalid-argument", "marketName is required.");
  }

  const hasText = Boolean(data.resumeText?.trim());
  const hasImages = Array.isArray(data.resumeImages) && data.resumeImages.length > 0;

  if (!hasText && !hasImages) {
    throw new HttpsError(
      "invalid-argument",
      "Provide either resumeText or resumeImages."
    );
  }

  // Step 2b: Bound the payload BEFORE charging or calling the model, so an
  // oversized request can't burn credits or hit the provider with a huge payload.
  const MAX_IMAGES = 8;
  const MAX_IMAGE_BASE64 = 8_000_000; // ~6MB decoded
  const MAX_RESUME_TEXT = 200_000;
  if (hasText && (data.resumeText?.length ?? 0) > MAX_RESUME_TEXT) {
    throw new HttpsError("invalid-argument", "resumeText is too long.");
  }
  if (hasImages) {
    const imgs = data.resumeImages as Array<{ data?: unknown; mimeType?: unknown }>;
    if (imgs.length > MAX_IMAGES) {
      throw new HttpsError("invalid-argument", `Too many images (max ${MAX_IMAGES}).`);
    }
    let totalImageChars = 0;
    const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
    for (const img of imgs) {
      if (typeof img?.data !== "string" || img.data.length === 0 || img.data.length > MAX_IMAGE_BASE64) {
        throw new HttpsError("invalid-argument", "An image is missing or too large.");
      }
      totalImageChars += img.data.length;
      if (typeof img?.mimeType !== "string" || !allowedMimeTypes.has(img.mimeType)) {
        throw new HttpsError("invalid-argument", "Unsupported image type.");
      }
    }
    if (totalImageChars > 20_000_000) {
      throw new HttpsError("invalid-argument", "The combined resume images are too large.");
    }
  }

  // Step 3: Deduct credits BEFORE the LLM call — atomic, server-side, un-bypassable.
  // If the user has insufficient credits, this throws and the LLM is never called.
  const metered = await claimMeteredToolRun(uid, "resume-analysis", TOOL_CREDIT_COSTS["resume-analysis"], {
    requestId: data.requestId,
  });

  // Warm the cache so an admin prompt override applies even on a cold instance.
  try {
    await ensurePlatformCaches();
  } catch (err) {
    await refundCredits(uid, metered);
    throw err;
  }

  // Step 4: Build the prompt
  let prompt: string;
  let parts: Array<{ inlineData: { mimeType: string; data: string } }> | undefined;
  const outputLanguageInstruction =
    candidateAnalysisLanguageProtocol({
      outputLanguage: data.outputLanguage ?? "en",
      marketName: data.marketName,
    }) +
    "\n- Prose fields here: summary, strengths, improvements.area, improvements.suggestion. Do not leave generic labels such as \"quantifying impact\", \"Weak\", \"Stronger\", or \"ATS keyword alignment\" in English unless English is the output language." +
    "\n- keywords: apply the market hiring-language rule above (these are ATS terms, not prose)." +
    "\n- extractedText (image path): transcribe the resume in its ORIGINAL language exactly as written — never translate the transcription.";

  if (hasImages) {
    // Multimodal: Gemini transcribes the images and analyzes
    prompt = buildPrompt("handler_resume_analysis_image", {
      marketName: data.marketName,
      outputLanguageInstruction,
    });
    parts = data.resumeImages!.map((img) => ({
      inlineData: { mimeType: img.mimeType, data: img.data },
    }));
  } else {
    // Text-only path: instruction template rendered, then resume appended exactly as before
    const basePrompt = buildPrompt("handler_resume_analysis", {
      marketName: data.marketName,
      outputLanguageInstruction,
    });
    prompt = `${basePrompt}\n\nResume:\n${data.resumeText}`;
  }

  // Step 5: Call the LLM through the router
  // Router returns GeminiProvider in Phase A; Phase B upgrades this to cascade routing.
  try {
    // resolveProvider builds the provider (and reads the API key) — keep it inside
    // the try so a missing-key/build failure also triggers the refund below.
    const provider = await resolveProvider(uid, (request.data as { model?: string })?.model, "analyzeResume", {
      // Image uploads may only route to multimodal models — a text-only pool
      // member would 404 with "No endpoints found that support image input".
      needsImageInput: hasImages,
    });
    const generationStartedAt = Date.now();
    const responseSchema = hasImages ? ANALYSIS_IMAGE_SCHEMA : ANALYSIS_SCHEMA;
    const result = await provider.generate({
      prompt,
      parts,
      responseSchema,
      maxOutputTokens: hasImages ? 8_192 : 4_096,
      thinkingLevel: "low",
    });

    // Step 6: Return the structured result
    return requireStructuredResult<AnalysisResult>(
      "analyzeResume",
      result,
      responseSchema,
      generationStartedAt
    );
  } catch (err) {
    // Model call failed after charging — refund so the user isn't billed for nothing.
    await refundCredits(uid, metered);
    const message = err instanceof Error ? err.message : "Resume analysis failed.";
    throw new HttpsError("internal", message);
  }
});
