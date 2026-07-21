import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useModalBehavior } from '../../hooks/useModalBehavior';

/**
 * Spotlight tour over the candidate workspace, shown once after onboarding.
 *
 * Targets are resolved by [data-tour] attribute at runtime; steps whose target
 * is missing or hidden (e.g. the sidebar below the lg breakpoint) are skipped
 * automatically, so the tour works on mobile with the reduced step set. The
 * spotlight is a positioned ring + page-dimming box-shadow — no portal/library.
 */

interface TourStep {
  target: string;
  titleKey: string;
  bodyKey: string;
}

const STEPS: TourStep[] = [
  { target: '[data-tour="main"]', titleKey: 'tour_dashboard_title', bodyKey: 'tour_dashboard_body' },
  { target: '[data-tour="nav-resume"]', titleKey: 'tour_resume_title', bodyKey: 'tour_resume_body' },
  { target: '[data-tour="nav-jobs"]', titleKey: 'tour_jobs_title', bodyKey: 'tour_jobs_body' },
  { target: '[data-tour="nav-toolkit"]', titleKey: 'tour_toolkit_title', bodyKey: 'tour_toolkit_body' },
  { target: '[data-tour="credits"]', titleKey: 'tour_credits_title', bodyKey: 'tour_credits_body' },
  { target: '[data-tour="account-menu"]', titleKey: 'tour_account_title', bodyKey: 'tour_account_body' },
];

interface Rect { top: number; left: number; width: number; height: number }
interface ViewportRect { top: number; left: number; width: number; height: number }

const getViewport = (): ViewportRect => {
  const vv = window.visualViewport;
  return {
    top: vv?.offsetTop ?? 0,
    left: vv?.offsetLeft ?? 0,
    width: vv?.width ?? window.innerWidth,
    height: vv?.height ?? window.innerHeight,
  };
};

const isVisible = (el: Element): boolean => {
  const r = el.getBoundingClientRect();
  return r.width > 4 && r.height > 4;
};

const WorkspaceTour: React.FC<{ t: (key: string) => string; onClose: () => void }> = ({ t, onClose }) => {
  // Resolve which steps actually have a visible target right now.
  const steps = useMemo(
    () => STEPS.filter((s) => {
      const el = document.querySelector(s.target);
      return el !== null && isVisible(el);
    }),
    [],
  );

  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState<ViewportRect>(() => getViewport());
  const rafRef = useRef<number | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useModalBehavior(onClose, true, true, dialogRef);

  const measure = useCallback(() => {
    rafRef.current = null;
    const step = steps[index];
    if (!step) return;
    const el = document.querySelector(step.target);
    const nextViewport = getViewport();
    setViewport(nextViewport);
    if (!el || !isVisible(el)) { setRect(null); return; }
    el.scrollIntoView({ block: 'nearest', behavior: 'instant' as ScrollBehavior });
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [steps, index]);

  useEffect(() => {
    const schedule = () => {
      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.visualViewport?.addEventListener('resize', schedule, { passive: true });
    window.visualViewport?.addEventListener('scroll', schedule, { passive: true });
    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [measure]);

  // No resolvable targets (extreme viewport) — close via effect, not render.
  useEffect(() => {
    if (steps.length === 0) onClose();
  }, [steps.length, onClose]);

  if (steps.length === 0) return null;

  const step = steps[index];
  const isLast = index === steps.length - 1;
  const PAD = 8;

  // Card placement: below the spotlight when there's room, otherwise above;
  // clamped horizontally so it never leaves the viewport on mobile.
  const cardW = Math.min(340, viewport.width - 24);
  let cardTop = 0;
  let cardLeft = viewport.left + 12;
  if (rect) {
    const below = rect.top + rect.height + PAD + 12;
    const viewportBottom = viewport.top + viewport.height;
    const viewportRight = viewport.left + viewport.width;
    cardTop = below + 190 < viewportBottom ? below : Math.max(viewport.top + 12, rect.top - PAD - 200);
    cardLeft = Math.min(Math.max(viewport.left + 12, rect.left), viewportRight - cardW - 12);
  }

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-[85]"
      role="dialog"
      aria-modal="true"
      aria-label={t('tour_aria_label')}
    >
      {/* Click-away dim layer: clicking the backdrop ends the tour (consistent
          with the app's modal behaviour); the spotlight ring carries the dim
          shadow so the highlighted element stays bright. */}
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      {rect && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-xl border-2 border-blue-400 transition-all duration-300 ease-out"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.6)',
          }}
        />
      )}

      <div
        className="absolute w-[min(340px,calc(100vw-24px))] rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900 animate-fade-scale"
        style={rect ? { top: cardTop, left: cardLeft } : { top: '40%', left: '50%', transform: 'translateX(-50%)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[11px] font-bold uppercase tracking-widest text-blue-600 dark:text-blue-400">
          {`${index + 1} / ${steps.length}`}
        </p>
        <h2 className="mt-1.5 text-base font-bold text-slate-900 dark:text-slate-100">{t(step.titleKey)}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{t(step.bodyKey)}</p>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold text-slate-400 transition-colors hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
          >
            {t('tour_skip')}
          </button>
          <div className="ml-auto flex items-center gap-2">
            {index > 0 && (
              <button
                type="button"
                onClick={() => setIndex((i) => i - 1)}
                className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {t('tour_back')}
              </button>
            )}
            <button
              type="button"
              onClick={() => (isLast ? onClose() : setIndex((i) => i + 1))}
              className="inline-flex min-h-[36px] items-center justify-center rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white transition hover:bg-blue-800"
            >
              {isLast ? t('tour_finish') : t('tour_next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkspaceTour;
