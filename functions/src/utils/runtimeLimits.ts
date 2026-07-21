/**
 * Maximum resume text accepted by every browser and callable path.
 *
 * Keep this value authoritative here. Browser validation re-exports it from
 * lib/resumeFileValidation.ts so a resume accepted by the UI cannot hit a
 * smaller server-only limit later.
 */
export const MAX_RESUME_TEXT_CHARS = 200_000;

/** Dedicated cover-letter callers may provide a long pasted job description. */
export const MAX_COVER_LETTER_JOB_DESCRIPTION_CHARS = 100_000;

/** Human-readable locale labels are small even when clients do not send a code. */
export const MAX_OUTPUT_LANGUAGE_CHARS = 80;

/** Preserve the former non-resume abuse budget beside one valid resume. */
export const MAX_AI_TOOL_NON_RESUME_CONTENT_CHARS = 100_000;

/**
 * Semantic generic-tool envelope: one maximum resume plus bounded tool input.
 * This counts content characters, not JSON escape characters, because quotes
 * and line breaks do not consume extra model context after deserialization.
 */
export const MAX_AI_TOOL_PAYLOAD_CHARS =
  MAX_RESUME_TEXT_CHARS + MAX_AI_TOOL_NON_RESUME_CONTENT_CHARS;

/** Parses an integer runtime limit while preserving a safe lower and upper bound. */
export function boundedRuntimeInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const safeFallback = Math.min(maximum, Math.max(minimum, fallback));
  if (raw === undefined || raw.trim() === "") return safeFallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) return safeFallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

/**
 * Counts semantic characters in a JSON-compatible request without penalizing
 * JSON escaping. Unsupported values and object cycles fail closed.
 */
export function payloadContentCharacterCount(value: unknown): number {
  const pending: unknown[] = [value];
  const seen = new WeakSet<object>();
  let total = 0;

  const add = (amount: number): void => {
    total = Math.min(Number.MAX_SAFE_INTEGER, total + amount);
  };

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null) {
      add(4);
      continue;
    }
    if (current === undefined) return Number.MAX_SAFE_INTEGER;
    if (typeof current === "string") {
      add(current.length);
      continue;
    }
    if (typeof current === "boolean") {
      add(current ? 4 : 5);
      continue;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) return Number.MAX_SAFE_INTEGER;
      add(String(current).length);
      continue;
    }
    if (typeof current !== "object") return Number.MAX_SAFE_INTEGER;
    if (seen.has(current)) return Number.MAX_SAFE_INTEGER;
    seen.add(current);

    if (Array.isArray(current)) {
      add(current.length + 1);
      for (const nested of current) pending.push(nested);
      continue;
    }

    const entries = Object.entries(current as Record<string, unknown>);
    add(entries.length + 1);
    for (const [key, nested] of entries) {
      add(key.length);
      pending.push(nested);
    }
  }

  return total;
}
