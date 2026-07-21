import { LLMResult } from "./LLMProvider";
import { validateAgainstSchema } from "./schemaValidation";

/** Validate and observe a structured result without logging user content. */
export function requireStructuredResult<T>(
  tool: string,
  result: LLMResult,
  schema: object,
  generationStartedAt: number
): T {
  const issues = validateAgainstSchema(result.raw, schema);
  const generationMs = Date.now() - generationStartedAt;
  console.info(JSON.stringify({
    event: "ai_structured_result",
    tool,
    outcome: issues.length === 0 ? "success" : "contract_error",
    modelUsed: result.model,
    providerUsed: result.provider ?? null,
    finishReason: result.finishReason ?? null,
    generationMs,
    inputTokens: result.usage?.inputTokens ?? null,
    outputTokens: result.usage?.outputTokens ?? null,
    contractIssueCount: issues.length,
  }));
  if (issues.length > 0) {
    console.error(
      `[${tool}] invalid structured response: ` +
        issues.slice(0, 8).map((issue) => `${issue.path} ${issue.message}`).join("; ")
    );
    throw new Error("The AI response was incomplete. Please try again.");
  }
  return result.raw as T;
}
