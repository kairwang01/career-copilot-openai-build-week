/**
 * generateHeadshot — HTTPS Callable Cloud Function.
 *
 * Server-side port of geminiService.generateProfessionalHeadshot().
 * Uses the Gemini image model directly (not the text LLMProvider) and returns
 * base64-encoded image variations. The API key stays server-side.
 *
 * Frontend integration (services/aiClient.ts):
 *   const fn = httpsCallable(getFunctions(), "generateHeadshot");
 *   const { data } = await fn({ imageBase64 });  // → { images: string[] }
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { GoogleGenAI } from "@google/genai";
import { requireAuth } from "../middleware/auth";
import { recordObservedToolRun } from "../admin/usageLog";
import { claimFreeToolRun } from "../credits/deductCredits";
import { ensurePlatformCaches, getGeminiApiKey } from "../config/env";

interface GenerateHeadshotRequest {
  imageBase64: string;
  requestId?: string;
}

// ~6MB of base64 (≈4.5MB raw) upper bound to keep request size / cost sane.
const MAX_IMAGE_BASE64_LEN = 8_000_000;

export function extractImageVariants(parts: unknown): Array<{ data: string; mimeType: string }> {
  if (!Array.isArray(parts)) return [];
  const images: Array<{ data: string; mimeType: string }> = [];
  for (const part of parts) {
    if (!part || typeof part !== "object" || (part as { thought?: unknown }).thought === true) continue;
    const inlineData = (part as { inlineData?: { data?: unknown; mimeType?: unknown } }).inlineData;
    if (typeof inlineData?.data !== "string" || !inlineData.data) continue;
    images.push({
      data: inlineData.data,
      mimeType: typeof inlineData.mimeType === "string" && inlineData.mimeType
        ? inlineData.mimeType
        : "image/png",
    });
  }
  return images;
}

export const generateHeadshotFunction = onCall({ invoker: "public", timeoutSeconds: 60 }, async (request) => {
  const uid = requireAuth(request);

  const { imageBase64, requestId } = (request.data ?? {}) as GenerateHeadshotRequest;
  if (!imageBase64 || typeof imageBase64 !== "string") {
    throw new HttpsError("invalid-argument", "imageBase64 is required.");
  }
  if (imageBase64.length > MAX_IMAGE_BASE64_LEN) {
    throw new HttpsError("invalid-argument", "Image is too large.");
  }

  // Observability only — uncharged tool, never capped (see recordObservedToolRun).
  await claimFreeToolRun(uid, "generate-headshot", { requestId });
  void recordObservedToolRun(uid, "generate-headshot");

  // Warm the platform-config cache so the key getter reads the admin-configured
  // Firestore value (this handler reads the key directly, not via resolveProvider).
  await ensurePlatformCaches();
  const ai = new GoogleGenAI({ apiKey: getGeminiApiKey() });
  let response;
  try {
    response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: {
        parts: [
          { inlineData: { data: imageBase64, mimeType: "image/jpeg" } },
          {
            text:
              "Generate one polished professional corporate headshot from this image. " +
              "Maintain the person's identity. Provide a neutral, soft-focus background. " +
              "Ensure a professional and polished look.",
          },
        ],
      },
      config: {
        httpOptions: { timeout: 45_000, retryOptions: { attempts: 1 } },
      },
    });
  } catch (err) {
    // Preserve the underlying SDK/API error in Cloud Logging. Without this every
    // distinct failure (bad/missing key, billing disabled, network, malformed
    // image) collapses into the same opaque message and the feature becomes
    // undebuggable in production.
    console.error("generateHeadshot failed", err);
    // The image-generation model has no free-tier quota (limit 0) — without
    // billing enabled on the Gemini key every call 429s. The SDK carries the 429
    // on err.status/err.code at least as often as in the message, so mirror the
    // structured check used by isQuotaError() elsewhere. Surface a clear message
    // instead of a bare 500 INTERNAL so the UI can explain it.
    const e = (err ?? {}) as { message?: string; status?: number; code?: number | string };
    const msg = (e.message ?? "").toLowerCase();
    if (
      e.status === 429 ||
      e.code === 429 ||
      e.code === "resource-exhausted" ||
      msg.includes("429") ||
      msg.includes("quota") ||
      msg.includes("resource_exhausted")
    ) {
      throw new HttpsError(
        "resource-exhausted",
        "AI avatar generation is temporarily unavailable (image-generation quota reached). Please try again later.",
      );
    }
    throw new HttpsError(
      "internal",
      "Couldn't generate avatars from this photo. Try a clearer, front-facing image.",
    );
  }

  const images = extractImageVariants(response.candidates?.[0]?.content?.parts);
  if (images.length === 0) {
    throw new HttpsError("internal", "The AI did not return any images.");
  }
  return { images };
});
