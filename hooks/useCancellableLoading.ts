import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useCancellableLoading — a near drop-in replacement for
 * `const [loading, setLoading] = useState(false)` that adds user-cancellable
 * AI generations.
 *
 * Firebase callables cannot be truly aborted mid-flight, so "cancel" here means:
 * hide the loader immediately and DISCARD the in-flight result when it eventually
 * resolves (so a stale response never pops into the UI after the user backed out).
 *
 * Usage:
 *   const { loading, begin, end, cancel } = useCancellableLoading();
 *
 *   const handleGenerate = async () => {
 *     const alive = begin();              // shows loader, starts a run
 *     setError(null);
 *     try {
 *       const res = await someAiClientFn(...);
 *       if (!alive()) return;             // cancelled/superseded → drop result
 *       setResult(res);
 *     } catch (err) {
 *       if (alive()) setError(err instanceof Error ? err.message : 'An error occurred.');
 *     } finally {
 *       if (alive()) end();               // only the current run clears loading
 *     }
 *   };
 *
 *   // render:
 *   {loading && <StagedLoader steps={[...]} onCancel={cancel} />}
 *
 * Calling begin() again supersedes any earlier in-flight run (its alive() flips
 * to false), so rapid re-submits never race to setResult.
 */
export function useCancellableLoading(initial = false) {
  const [loading, setLoading] = useState(initial);
  const runRef = useRef(0);

  // On unmount, supersede any in-flight run so its alive() returns false — stops a
  // late-resolving callable from calling setState (or, in tools like EnglishPro,
  // writing the profile) on a component the user has already navigated away from.
  useEffect(() => () => { runRef.current++; }, []);

  /** Start a run. Returns alive() — false once this run is cancelled/superseded. */
  const begin = useCallback((): (() => boolean) => {
    const id = ++runRef.current;
    setLoading(true);
    return () => id === runRef.current;
  }, []);

  /** Clear the loading flag (call from the current run only — guard with alive()). */
  const end = useCallback((): void => {
    setLoading(false);
  }, []);

  /** Cancel the current run: hide the loader and invalidate any in-flight alive(). */
  const cancel = useCallback((): void => {
    runRef.current++;
    setLoading(false);
  }, []);

  return { loading, begin, end, cancel } as const;
}

export default useCancellableLoading;
