/** Builds the callable payload without duplicating a structured result as text. */
export function buildToolResponse(
  data: unknown,
  text: string,
  groundingChunks: unknown,
  meta: Record<string, unknown>
): Record<string, unknown> {
  return {
    data,
    ...(data === undefined ? { text } : {}),
    groundingChunks,
    meta,
  };
}
