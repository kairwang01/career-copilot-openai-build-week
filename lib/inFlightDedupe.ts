/**
 * withInFlightDedupe — collapses concurrent identical async calls onto a SINGLE
 * in-flight promise: while one call with a given key is pending, any further call with
 * the same key returns the same promise instead of starting new work. Once it settles
 * the key is released, so a later (sequential) call runs fresh.
 *
 * This is the double-charge guard for charged AI callables. A Firebase callable cannot
 * be aborted mid-flight and a fresh-per-call requestId can't dedup two distinct
 * invocations, so a double-click / rapid re-submit would otherwise fire two network
 * calls and bill twice server-side. Collapsing them client-side means one network call
 * and one charge. Used by both the aiProxy and the dedicated-callable paths.
 */
export async function withInFlightDedupe<T>(
  map: Map<string, Promise<unknown>>,
  key: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  if (key) {
    const existing = map.get(key);
    if (existing) return existing as Promise<T>;
  }
  const promise = run();
  if (!key) return promise;
  map.set(key, promise);
  try {
    return await promise;
  } finally {
    // Only clear if it's still ours — a later call may have already replaced it.
    if (map.get(key) === promise) {
      map.delete(key);
    }
  }
}
