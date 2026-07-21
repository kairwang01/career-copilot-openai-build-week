/**
 * ToolResultsContext — exposes the active tool's saved-result API to whichever
 * tool ToolRunner is rendering, so individual tools don't each need session /
 * profile props threaded in. The provider (mounted once per active tool) owns
 * the load/persist/clear lifecycle; tools call useToolResults<T>() to hydrate
 * their result on open and persist it after a run.
 *
 * Tier gating: only candidate paid plans can save (canSave). Free users get a
 * no-op persist and never load anything — the real enforcement is in
 * firestore.rules; canSave just drives UX (badges / upgrade hints / skip write).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import {
  canSaveResults,
  clearToolResult,
  loadToolResult,
  saveToolResult,
  type SavedToolResult,
} from '../services/toolResults';

interface ToolResultsValue {
  toolKey: string;
  /** True when the current user's plan may persist results (candidate paid tiers). */
  canSave: boolean;
  /** The saved result for this tool, or null. Untyped here; consumers cast via the generic hook. */
  saved: SavedToolResult | null;
  /** False until the initial load attempt has resolved (so tools don't flash the form first). */
  savedLoaded: boolean;
  /** Best-effort write lifecycle used by shared tool result chrome. */
  saveState: ToolSaveState;
  /** Persist a fresh result (no-op for free tier or signed-out). */
  persist: (result: unknown) => void;
  /** Discard the saved result (local + cloud). */
  clear: () => void;
}

const ToolResultsContext = createContext<ToolResultsValue | null>(null);

export type ToolSaveState = 'idle' | 'saving' | 'saved' | 'failed';

/** Typed accessor. Outside a provider it returns an inert default so a tool can
 *  be rendered standalone without crashing. */
export function useToolResults<T = unknown>(): {
  toolKey: string;
  canSave: boolean;
  saved: SavedToolResult<T> | null;
  savedLoaded: boolean;
  saveState: ToolSaveState;
  persist: (result: T) => void;
  clear: () => void;
} {
  const ctx = useContext(ToolResultsContext);
  if (!ctx) {
    return { toolKey: '', canSave: false, saved: null, savedLoaded: true, saveState: 'idle', persist: () => {}, clear: () => {} };
  }
  return {
    toolKey: ctx.toolKey,
    canSave: ctx.canSave,
    saved: ctx.saved as SavedToolResult<T> | null,
    savedLoaded: ctx.savedLoaded,
    saveState: ctx.saveState,
    persist: ctx.persist as (result: T) => void,
    clear: ctx.clear,
  };
}

interface ProviderProps {
  toolKey: string;
  uid: string | null;
  subscriptionStatus: string | null;
  loadingTitle?: string;
  loadingDescription?: string;
  children: ReactNode;
}

export const ToolResultsHydrationFallback: React.FC<{ title: string; description: string }> = ({ title, description }) => (
  <div
    data-qa="tool-saved-result-loading"
    className="flex min-h-[260px] items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-10 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900"
    role="status"
    aria-label={title}
  >
    <div className="w-full max-w-sm">
      <Loader2 className="mx-auto h-7 w-7 animate-spin text-blue-600 dark:text-blue-400" aria-hidden="true" />
      <p className="mt-4 text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</p>
      <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>
      <div className="mt-5 space-y-2" aria-hidden="true">
        <div className="mx-auto h-2.5 w-10/12 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
        <div className="mx-auto h-2.5 w-7/12 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
      </div>
    </div>
  </div>
);

export const ToolResultsProvider: React.FC<ProviderProps> = ({
  toolKey,
  uid,
  subscriptionStatus,
  loadingTitle = 'Checking saved result',
  loadingDescription = 'Looking for your latest saved output before opening the tool.',
  children,
}) => {
  const canSave = canSaveResults(subscriptionStatus) && !!uid;
  const [saved, setSaved] = useState<SavedToolResult | null>(null);
  const [savedLoaded, setSavedLoaded] = useState(false);
  const [saveState, setSaveState] = useState<ToolSaveState>('idle');
  const saveAttemptRef = useRef(0);

  // Load the saved result when the tool (or user) changes. Free users skip the
  // read entirely (nothing to load) and resolve immediately.
  useEffect(() => {
    let alive = true;
    setSaved(null);
    setSavedLoaded(false);
    setSaveState('idle');
    if (!uid || !canSave || !toolKey) {
      setSavedLoaded(true);
      return () => { alive = false; };
    }
    loadToolResult(uid, toolKey)
      .then((r) => {
        if (!alive) return;
        setSaved(r);
        setSaveState(r ? 'saved' : 'idle');
        setSavedLoaded(true);
      })
      .catch(() => {
        if (!alive) return;
        setSaved(null);
        setSaveState('idle');
        setSavedLoaded(true);
      });
    return () => { alive = false; };
  }, [uid, toolKey, canSave]);

  const persist = useCallback((result: unknown) => {
    if (!uid || !canSave || !toolKey) return;
    const attempt = saveAttemptRef.current + 1;
    saveAttemptRef.current = attempt;
    setSaveState('saving');
    // Optimistically reflect the save so the badge updates immediately.
    setSaved({ result, savedAt: Date.now() });
    void saveToolResult(uid, toolKey, result).then((ok) => {
      if (saveAttemptRef.current !== attempt) return;
      if (!ok) {
        setSaved(null);
        setSaveState('failed');
        return;
      }
      setSaveState('saved');
    });
  }, [uid, toolKey, canSave]);

  const clear = useCallback(() => {
    saveAttemptRef.current += 1;
    setSaved(null);
    setSaveState('idle');
    if (uid && toolKey) void clearToolResult(uid, toolKey);
  }, [uid, toolKey]);

  const value = useMemo<ToolResultsValue>(
    () => ({ toolKey, canSave, saved, savedLoaded, saveState, persist, clear }),
    [toolKey, canSave, saved, savedLoaded, saveState, persist, clear],
  );

  // For a paid user, hold the tool's first paint until we know whether a saved
  // result exists — otherwise the input form flashes before the cached result
  // hydrates. Free users (canSave=false) render immediately.
  if (canSave && !savedLoaded) {
    return (
      <ToolResultsHydrationFallback title={loadingTitle} description={loadingDescription} />
    );
  }

  return <ToolResultsContext.Provider value={value}>{children}</ToolResultsContext.Provider>;
};
