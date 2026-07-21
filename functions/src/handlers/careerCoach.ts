/**
 * careerCoach — HTTPS Callable Cloud Function.
 *
 * Server-side port of the CareerCoachBot chat. The client keeps the conversation
 * history and sends it back each turn; the server holds the Gemini key and the
 * role-specific system instruction. (Callables don't stream, so the reply is
 * returned whole rather than token-by-token.)
 *
 * No credit charge — this is a free support assistant.
 *
 * Frontend integration (services/aiClient.ts):
 *   const fn = httpsCallable(getFunctions(), "careerCoach");
 *   const { data } = await fn({ messages, role, resumeText, companyName, ... });
 *   // → { reply }
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { requireAuth } from "../middleware/auth";
import { recordObservedToolRun } from "../admin/usageLog";
import { claimFreeToolRun } from "../credits/deductCredits";
import { resolveProvider } from "../llm/models";
import { buildPrompt } from "../llm/prompts";
import { chatLanguageProtocol } from "../llm/languageProtocol";
import { ensurePlatformCaches } from "../config/env";
import { MAX_RESUME_TEXT_CHARS } from "../utils/runtimeLimits";

interface CoachMessage {
  role: "user" | "model";
  content: string;
}

interface CareerCoachRequest {
  messages: CoachMessage[];
  role?: "candidate" | "employer" | null;
  resumeText?: string;
  companyName?: string;
  companyWebsite?: string;
  companyDescription?: string;
  /** Optional model id (tier-gated server-side). */
  model?: string;
  /** UI language hint for ambiguous first messages, e.g. "zh", "en". */
  outputLanguage?: string;
  requestId?: string;
}

export const careerCoachFunction = onCall({ invoker: "public", timeoutSeconds: 180 }, async (request) => {
  const uid = requireAuth(request);

  const data = (request.data ?? {}) as CareerCoachRequest;
  if (!Array.isArray(data.messages) || data.messages.length === 0) {
    throw new HttpsError("invalid-argument", "messages is required.");
  }
  if (data.messages.length > 20) {
    throw new HttpsError("invalid-argument", "messages may contain at most 20 turns.");
  }
  if (data.resumeText !== undefined && typeof data.resumeText !== "string") {
    throw new HttpsError("invalid-argument", "resumeText must be a string.");
  }
  if (typeof data.resumeText === "string" && data.resumeText.length > MAX_RESUME_TEXT_CHARS) {
    throw new HttpsError(
      "invalid-argument",
      `resumeText exceeds the ${MAX_RESUME_TEXT_CHARS} character limit.`
    );
  }
  let transcriptChars = 0;
  for (const message of data.messages) {
    if (!message || (message.role !== "user" && message.role !== "model") ||
        typeof message.content !== "string" || !message.content.trim()) {
      throw new HttpsError("invalid-argument", "Each message needs a valid role and non-empty content.");
    }
    if (message.content.length > 8_000) {
      throw new HttpsError("invalid-argument", "A coach message is too long.");
    }
    transcriptChars += message.content.length;
  }
  if (transcriptChars > 50_000) {
    throw new HttpsError("invalid-argument", "Career coach context is too long.");
  }

  // Keep the existing observability event and apply the shared free-tool cap so
  // this authenticated endpoint cannot become an unmetered LLM faucet.
  await claimFreeToolRun(uid, "career-coach", { requestId: data.requestId });
  void recordObservedToolRun(uid, "career-coach");

  // Warm the cache so an admin prompt override applies even on a cold instance.
  await ensurePlatformCaches();

  let systemInstruction: string;
  if (data.role === "candidate") {
    systemInstruction = buildPrompt("handler_career_coach_candidate", {
      resumeText: data.resumeText ?? "",
    });
  } else if (data.role === "employer") {
    systemInstruction = buildPrompt("handler_career_coach_employer", {
      companyName: data.companyName || "N/A",
      companyWebsite: data.companyWebsite || "N/A",
      companyDescription: data.companyDescription || "N/A",
    });
  } else {
    systemInstruction = buildPrompt("handler_career_coach_base", {});
  }

  // Appended AFTER the (possibly admin-overridden) template so language
  // behaviour is consistent even when an override predates this protocol.
  systemInstruction += "\n\n" + chatLanguageProtocol({ outputLanguage: data.outputLanguage });

  // Keep the last 20 turns to bound prompt size.
  const transcript =
    data.messages
      .slice(-20)
      .map((m) => `${m.role === "user" ? "User" : "Alex"}: ${m.content}`)
      .join("\n") + "\nAlex:";

  const provider = await resolveProvider(uid, data.model, "careerCoach");
  const generationStartedAt = Date.now();
  const result = await provider.generate({
    system: systemInstruction,
    prompt: transcript,
    maxOutputTokens: 1_024,
    thinkingLevel: "minimal",
    timeoutMs: 20_000,
  });
  console.info(JSON.stringify({
    event: "ai_unstructured_result",
    tool: "careerCoach",
    modelUsed: result.model,
    providerUsed: result.provider ?? null,
    generationMs: Date.now() - generationStartedAt,
    inputTokens: result.usage?.inputTokens ?? null,
    outputTokens: result.usage?.outputTokens ?? null,
  }));
  if (!result.text.trim()) throw new HttpsError("unavailable", "The career coach returned an empty reply.");
  return { reply: result.text };
});
