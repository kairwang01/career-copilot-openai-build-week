import React, { useState, useEffect, useRef, useMemo } from 'react';
import { CircleX, Lightbulb } from 'lucide-react';
import { getShuffledHiringTips } from './hiringTips';

/** Named accent palettes — each tool passes one for a visually distinct loader. */
export type LoaderAccent =
  | 'blue' | 'emerald' | 'sky' | 'violet' | 'indigo' | 'amber'
  | 'cyan' | 'teal' | 'orange' | 'rose' | 'fuchsia' | 'purple' | 'pink' | 'lime';

interface AccentClasses {
  ring: string;      // static spinner track
  arc: string;       // spinning arc (top border)
  dot: string;       // centre dot + active step dot
  pastDot: string;   // completed step dots
  bar: string;       // progress bar fill
  icon: string;      // tool glyph tint
}

/**
 * Full LITERAL Tailwind class strings (no `${}` interpolation) so the JIT
 * compiler statically sees and generates every utility. Do not refactor these
 * into template literals — that would silently drop the colors at build time.
 */
const ACCENTS: Record<LoaderAccent, AccentClasses> = {
  blue:    { ring: 'border-blue-100 dark:border-blue-900/40',       arc: 'border-t-blue-600 dark:border-t-blue-400',       dot: 'bg-blue-600 dark:bg-blue-400',       pastDot: 'bg-blue-400 dark:bg-blue-500',       bar: 'bg-blue-500 dark:bg-blue-400',       icon: 'text-blue-600 dark:text-blue-400' },
  emerald: { ring: 'border-emerald-100 dark:border-emerald-900/40', arc: 'border-t-emerald-600 dark:border-t-emerald-400', dot: 'bg-emerald-600 dark:bg-emerald-400', pastDot: 'bg-emerald-400 dark:bg-emerald-500', bar: 'bg-emerald-500 dark:bg-emerald-400', icon: 'text-emerald-600 dark:text-emerald-400' },
  sky:     { ring: 'border-sky-100 dark:border-sky-900/40',         arc: 'border-t-sky-600 dark:border-t-sky-400',         dot: 'bg-sky-600 dark:bg-sky-400',         pastDot: 'bg-sky-400 dark:bg-sky-500',         bar: 'bg-sky-500 dark:bg-sky-400',         icon: 'text-sky-600 dark:text-sky-400' },
  violet:  { ring: 'border-violet-100 dark:border-violet-900/40',   arc: 'border-t-violet-600 dark:border-t-violet-400',   dot: 'bg-violet-600 dark:bg-violet-400',   pastDot: 'bg-violet-400 dark:bg-violet-500',   bar: 'bg-violet-500 dark:bg-violet-400',   icon: 'text-violet-600 dark:text-violet-400' },
  indigo:  { ring: 'border-indigo-100 dark:border-indigo-900/40',   arc: 'border-t-indigo-600 dark:border-t-indigo-400',   dot: 'bg-indigo-600 dark:bg-indigo-400',   pastDot: 'bg-indigo-400 dark:bg-indigo-500',   bar: 'bg-indigo-500 dark:bg-indigo-400',   icon: 'text-indigo-600 dark:text-indigo-400' },
  amber:   { ring: 'border-amber-100 dark:border-amber-900/40',     arc: 'border-t-amber-500 dark:border-t-amber-400',     dot: 'bg-amber-500 dark:bg-amber-400',     pastDot: 'bg-amber-400 dark:bg-amber-500',     bar: 'bg-amber-500 dark:bg-amber-400',     icon: 'text-amber-600 dark:text-amber-400' },
  cyan:    { ring: 'border-cyan-100 dark:border-cyan-900/40',       arc: 'border-t-cyan-600 dark:border-t-cyan-400',       dot: 'bg-cyan-600 dark:bg-cyan-400',       pastDot: 'bg-cyan-400 dark:bg-cyan-500',       bar: 'bg-cyan-500 dark:bg-cyan-400',       icon: 'text-cyan-600 dark:text-cyan-400' },
  teal:    { ring: 'border-teal-100 dark:border-teal-900/40',       arc: 'border-t-teal-600 dark:border-t-teal-400',       dot: 'bg-teal-600 dark:bg-teal-400',       pastDot: 'bg-teal-400 dark:bg-teal-500',       bar: 'bg-teal-500 dark:bg-teal-400',       icon: 'text-teal-600 dark:text-teal-400' },
  orange:  { ring: 'border-orange-100 dark:border-orange-900/40',   arc: 'border-t-orange-500 dark:border-t-orange-400',   dot: 'bg-orange-500 dark:bg-orange-400',   pastDot: 'bg-orange-400 dark:bg-orange-500',   bar: 'bg-orange-500 dark:bg-orange-400',   icon: 'text-orange-600 dark:text-orange-400' },
  rose:    { ring: 'border-rose-100 dark:border-rose-900/40',       arc: 'border-t-rose-600 dark:border-t-rose-400',       dot: 'bg-rose-600 dark:bg-rose-400',       pastDot: 'bg-rose-400 dark:bg-rose-500',       bar: 'bg-rose-500 dark:bg-rose-400',       icon: 'text-rose-600 dark:text-rose-400' },
  fuchsia: { ring: 'border-fuchsia-100 dark:border-fuchsia-900/40', arc: 'border-t-fuchsia-600 dark:border-t-fuchsia-400', dot: 'bg-fuchsia-600 dark:bg-fuchsia-400', pastDot: 'bg-fuchsia-400 dark:bg-fuchsia-500', bar: 'bg-fuchsia-500 dark:bg-fuchsia-400', icon: 'text-fuchsia-600 dark:text-fuchsia-400' },
  purple:  { ring: 'border-purple-100 dark:border-purple-900/40',   arc: 'border-t-purple-600 dark:border-t-purple-400',   dot: 'bg-purple-600 dark:bg-purple-400',   pastDot: 'bg-purple-400 dark:bg-purple-500',   bar: 'bg-purple-500 dark:bg-purple-400',   icon: 'text-purple-600 dark:text-purple-400' },
  pink:    { ring: 'border-pink-100 dark:border-pink-900/40',       arc: 'border-t-pink-600 dark:border-t-pink-400',       dot: 'bg-pink-600 dark:bg-pink-400',       pastDot: 'bg-pink-400 dark:bg-pink-500',       bar: 'bg-pink-500 dark:bg-pink-400',       icon: 'text-pink-600 dark:text-pink-400' },
  lime:    { ring: 'border-lime-100 dark:border-lime-900/40',       arc: 'border-t-lime-500 dark:border-t-lime-400',       dot: 'bg-lime-500 dark:bg-lime-400',       pastDot: 'bg-lime-400 dark:bg-lime-500',       bar: 'bg-lime-500 dark:bg-lime-400',       icon: 'text-lime-600 dark:text-lime-400' },
};

interface StagedLoaderProps {
  /** Ordered, tool-specific status messages. The component cycles through them
   *  and HOLDS on the last one — the parent unmounts it when the result lands. */
  steps: string[];
  /**
   * REAL progress mode: when provided, the timer is disabled and `steps` become
   * actual milestones — the parent advances this index as each real phase
   * completes (upload done, parse done, …). Only in this mode does the loader
   * show a truthful "Step x of y" counter and a proportional progress bar.
   * Without it (single opaque AI call), the loader shows honest signals only:
   * rotating activity text, an indeterminate bar, and a live elapsed clock —
   * never a fake step count or fake percentage.
   */
  activeStep?: number;
  /** Optional heading shown above the current step text. */
  title?: string;
  /** Extra Tailwind classes applied to the outermost container. */
  className?: string;
  /** Milliseconds between step advances (default 1800). */
  intervalMs?: number;
  /** Label for the live elapsed clock (default "Elapsed"). */
  elapsedLabel?: string;
  /** When provided, renders a Cancel button that calls this. */
  onCancel?: () => void;
  /** Label for the cancel button (default "Cancel"). */
  cancelLabel?: string;
  /** Optional helper copy shown under the cancel button. */
  cancelHint?: string;
  /** Appended as the final held step for a consistent finish across all tools.
   *  Default "Almost done…". Pass null to disable. */
  finalStep?: string | null;
  /** Show the rotating "Did you know?" hiring-tips ticker (default true). */
  showTips?: boolean;
  /** Milliseconds between tip rotations (default 5000). */
  tipIntervalMs?: number;
  /** Tool glyph rendered in the spinner centre (e.g. an emoji or small SVG). */
  icon?: React.ReactNode;
  /** Color theme for this tool's loader (default "blue"). */
  accent?: LoaderAccent;
}

/**
 * StagedLoader — an honest progress indicator for long AI operations.
 *
 * Two modes, both truthful about what they know:
 * - Uncontrolled (single opaque AI call — the common case): `steps` rotate as
 *   activity descriptions, the bar is INDETERMINATE, and a live elapsed clock
 *   ticks every second. No fake step counter, no fake percentage — the model
 *   call is atomic, so the only real signal we have is time.
 * - Controlled (`activeStep` provided): the parent advances the index on REAL
 *   milestones, so "Step x of y" and the proportional bar are actually true.
 *
 * Each tool passes a distinct `icon` + `accent`; rotating "Did you know?"
 * hiring tips keep the wait informative.
 */
const StagedLoader: React.FC<StagedLoaderProps> = ({
  steps,
  activeStep,
  title,
  className = '',
  intervalMs = 1800,
  elapsedLabel = 'Elapsed',
  onCancel,
  cancelLabel = 'Cancel',
  cancelHint,
  finalStep = 'Almost done…',
  showTips = true,
  tipIntervalMs = 5000,
  icon,
  accent = 'blue',
}) => {
  const a = ACCENTS[accent] ?? ACCENTS.blue;
  const controlled = activeStep !== undefined;

  // Build displayed steps. The shared "Almost done…" finale only makes sense in
  // the uncontrolled rotation — in controlled mode the steps ARE the milestones.
  const displaySteps = useMemo(() => {
    const base = steps.length ? steps : ['Working…'];
    if (!controlled && finalStep && base[base.length - 1] !== finalStep) return [...base, finalStep];
    return base;
  }, [steps, finalStep, controlled]);

  const [timerStepIndex, setTimerStepIndex] = useState(0);
  const stepIndex = controlled
    ? Math.min(Math.max(activeStep, 0), displaySteps.length - 1)
    : timerStepIndex;
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live elapsed clock — the one signal that is ALWAYS real.
  const startedAtRef = useRef<number>(Date.now());
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    const id = setInterval(
      () => setElapsedSec(Math.floor((Date.now() - startedAtRef.current) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, []);
  const elapsedText = `${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, '0')}`;

  // Tips: shuffle once per mount, then rotate.
  const tipsRef = useRef<string[] | null>(null);
  if (tipsRef.current === null) tipsRef.current = getShuffledHiringTips();
  const tips = tipsRef.current;
  const [tipIndex, setTipIndex] = useState(0);
  const [tipVisible, setTipVisible] = useState(true);
  const tipFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Inject fade keyframes once.
  useEffect(() => {
    const id = 'staged-loader-keyframes';
    if (!document.getElementById(id)) {
      const style = document.createElement('style');
      style.id = id;
      style.textContent = `
        @keyframes sl-fade-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes sl-progress-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.7; }
        }
        @keyframes sl-indeterminate {
          0%   { left: -35%; }
          100% { left: 105%; }
        }
        .sl-fade-in { animation: sl-fade-in 0.35s ease-out both; }
        .sl-progress-pulse { animation: sl-progress-pulse 2s ease-in-out infinite; }
        .sl-indeterminate { animation: sl-indeterminate 1.6s ease-in-out infinite; }
      `;
      document.head.appendChild(style);
    }
  }, []);

  // Uncontrolled: rotate the activity text on a timer (description, not progress).
  // Controlled: the parent drives stepIndex from real milestones — no timer.
  useEffect(() => {
    if (controlled) return;
    if (timerStepIndex >= displaySteps.length - 1) return; // Hold on last step.
    timerRef.current = setTimeout(() => {
      setVisible(false);
      fadeTimerRef.current = setTimeout(() => {
        setTimerStepIndex((i) => Math.min(i + 1, displaySteps.length - 1));
        setVisible(true);
      }, 200); // matches fade-out duration
    }, intervalMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, [controlled, timerStepIndex, displaySteps.length, intervalMs]);

  // Rotate the "Did you know?" tip.
  useEffect(() => {
    if (!showTips || tips.length <= 1) return;
    const id = setInterval(() => {
      setTipVisible(false);
      tipFadeTimerRef.current = setTimeout(() => {
        setTipIndex((i) => (i + 1) % tips.length);
        setTipVisible(true);
      }, 250);
    }, tipIntervalMs);
    return () => {
      clearInterval(id);
      if (tipFadeTimerRef.current) clearTimeout(tipFadeTimerRef.current);
    };
  }, [showTips, tipIntervalMs, tips.length]);

  // Controlled mode only: a REAL proportional bar (milestones completed / total).
  // Uncontrolled mode renders an indeterminate bar instead — a single opaque AI
  // call has no measurable progress, and pretending otherwise misleads users.
  const progressPct = displaySteps.length <= 1
    ? 0
    : Math.round((stepIndex / (displaySteps.length - 1)) * 95);

  const currentStep = displaySteps[stepIndex] ?? '';
  const dotCount = displaySteps.length;
  const currentTip = tips[tipIndex] ?? '';

  return (
    <div
      className={`flex flex-col items-center justify-center space-y-6 my-24 animate-fade-in ${className}`}
      role="status"
      aria-live="polite"
      aria-label={title ?? 'Loading'}
    >
      {/* Spinner */}
      <div className="relative w-20 h-20">
        {/* Outer ring — static track */}
        <div className={`absolute inset-0 rounded-full border-4 ${a.ring}`} />
        {/* Inner spinning arc */}
        <div className={`absolute inset-0 rounded-full border-4 border-transparent ${a.arc} animate-spin`} />
        {/* Centre — tool glyph if provided, else a pulsing dot */}
        <div className="absolute inset-0 flex items-center justify-center">
          {icon ? (
            <span
              className={`inline-flex items-center justify-center ${a.icon} sl-progress-pulse [&>svg]:w-8 [&>svg]:h-8`}
              aria-hidden="true"
            >
              {icon}
            </span>
          ) : (
            <div className={`w-3 h-3 rounded-full ${a.dot} sl-progress-pulse`} />
          )}
        </div>
      </div>

      {/* Title */}
      {title && (
        <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 tracking-tight text-center">
          {title}
        </h2>
      )}

      {/* Step label with fade transition */}
      <div className="h-7 flex items-center justify-center px-4">
        <p
          key={stepIndex}
          className={`text-base font-medium text-gray-600 dark:text-gray-300 text-center transition-opacity duration-200 sl-fade-in ${
            visible ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {currentStep}
        </p>
      </div>

      {/* Milestone dots — only in controlled mode, where completion is real */}
      {controlled && dotCount > 1 && (
        <div className="flex items-center gap-2" aria-hidden="true">
          {Array.from({ length: dotCount }).map((_, i) => (
            <span
              key={i}
              className={`block rounded-full transition-all duration-300 ${
                i < stepIndex
                  ? `w-2 h-2 ${a.pastDot} opacity-70`
                  : i === stepIndex
                  ? `w-3 h-3 ${a.dot}`
                  : 'w-2 h-2 bg-gray-200 dark:bg-slate-600'
              }`}
            />
          ))}
        </div>
      )}

      {/* Progress bar: proportional when milestones are real, indeterminate otherwise */}
      <div className="relative w-64 sm:w-80 h-1.5 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
        {controlled ? (
          <div
            className={`h-full ${a.bar} rounded-full transition-all duration-500 ease-out`}
            style={{ width: `${progressPct}%` }}
            aria-hidden="true"
          />
        ) : (
          <div
            className={`absolute top-0 h-full w-1/3 ${a.bar} rounded-full sl-indeterminate`}
            aria-hidden="true"
          />
        )}
      </div>

      {/* Controlled: truthful milestone counter. Uncontrolled: live elapsed clock —
          the only honest number a single opaque AI call can show. */}
      {controlled ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 font-medium tabular-nums">
          Step {stepIndex + 1} of {dotCount}
        </p>
      ) : (
        <p className="text-xs text-gray-400 dark:text-gray-500 font-medium tabular-nums">
          {elapsedLabel} {elapsedText}
        </p>
      )}

      {/* Rotating "Did you know?" hiring tip */}
      {showTips && currentTip && (
        <div className="max-w-md px-6 min-h-[2.5rem] flex items-center justify-center gap-2">
          <Lightbulb
            className={`w-4 h-4 flex-shrink-0 text-amber-500 dark:text-amber-400 transition-opacity duration-300 ${
              tipVisible ? 'opacity-100' : 'opacity-0'
            }`}
            aria-hidden="true"
          />
          <p
            className={`text-sm text-center transition-opacity duration-300 ${
              tipVisible ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <span className="font-semibold text-gray-600 dark:text-gray-300">Did you know?</span>{' '}
            <span className="text-gray-500 dark:text-gray-400">{currentTip}</span>
          </p>
        </div>
      )}

      {/* Cancel / exit affordance */}
      {onCancel && (
        <div className="mt-1 flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 dark:border-slate-600 px-4 py-1.5 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-slate-500 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400/50"
            aria-label={cancelLabel}
          >
            <CircleX className="w-3.5 h-3.5" aria-hidden="true" />
            {cancelLabel}
          </button>
          {cancelHint && (
            <p className="max-w-xs text-center text-xs leading-relaxed text-gray-400 dark:text-gray-500">
              {cancelHint}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default StagedLoader;
