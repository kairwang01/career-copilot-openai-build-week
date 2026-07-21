import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { lockBodyScroll, pushModalLayer, removeModalLayer, isTopModalLayer } from '../hooks/modalEnvironment';
import { dialogUsableBounds } from '../lib/viewportDialogLayout';

type DialogStrategy = 'center' | 'anchor-or-center';

interface ViewportAwareDialogProps {
  open: boolean;
  anchorRef?: React.RefObject<HTMLElement | null>;
  strategy?: DialogStrategy;
  labelledBy?: string;
  describedBy?: string;
  ariaLabel?: string;
  className?: string;
  maxWidth?: number;
  zIndex?: number;
  avoidTopSelector?: string;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  onClose?: () => void;
  children: React.ReactNode;
}

type DialogPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: 'center' | 'above' | 'below';
};

const EDGE_GAP = 16;
const ANCHOR_GAP = 12;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const getViewport = () => {
  const vv = window.visualViewport;
  return {
    left: vv?.offsetLeft ?? 0,
    top: vv?.offsetTop ?? 0,
    width: vv?.width ?? window.innerWidth,
    height: vv?.height ?? window.innerHeight,
  };
};

const nearlyEqual = (a: DialogPosition | null, b: DialogPosition) => {
  if (!a) return false;
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.maxHeight - b.maxHeight) < 0.5 &&
    a.placement === b.placement
  );
};

export const ViewportAwareDialog: React.FC<ViewportAwareDialogProps> = ({
  open,
  anchorRef,
  strategy = 'center',
  labelledBy,
  describedBy,
  ariaLabel,
  className = '',
  maxWidth = 560,
  zIndex = 95,
  avoidTopSelector,
  closeOnBackdrop = false,
  closeOnEscape = true,
  onClose,
  children,
}) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const layerIdRef = useRef<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<DialogPosition | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    return lockBodyScroll();
  }, [open]);

  // Register this dialog as a modal layer so only the topmost one handles Esc / Tab.
  useEffect(() => {
    if (!open) return undefined;
    const id = pushModalLayer();
    layerIdRef.current = id;
    return () => {
      removeModalLayer(id);
      layerIdRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const focusableSelector =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const onKeyDown = (event: KeyboardEvent) => {
      // Only the topmost stacked dialog responds — so one Esc doesn't close every
      // layer and nested focus traps don't fight over Tab.
      if (layerIdRef.current === null || !isTopModalLayer(layerIdRef.current)) return;
      if (event.key === 'Escape' && closeOnEscape) {
        onClose?.();
        return;
      }
      // Trap Tab within the panel — the a11y contract for aria-modal.
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (el) => el.offsetParent !== null,
      );
      if (focusables.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeOnEscape, onClose, open]);

  // Move focus into the dialog on open and restore it to the trigger on close.
  useEffect(() => {
    if (!open || !mounted) return undefined;
    previouslyFocused.current = (document.activeElement as HTMLElement | null) ?? null;
    // Focus the panel itself (tabIndex=-1) rather than a control, so opening doesn't
    // pre-arm an action (e.g. the close button) but focus is still inside the dialog.
    panelRef.current?.focus();
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [open, mounted]);

  useLayoutEffect(() => {
    if (!open || !mounted) return undefined;

    const calculate = () => {
      rafRef.current = null;
      const panel = panelRef.current;
      if (!panel) return;

      const viewport = getViewport();
      let avoidTopRect: DOMRect | null = null;
      if (avoidTopSelector) {
        try {
          avoidTopRect = document.querySelector<HTMLElement>(avoidTopSelector)?.getBoundingClientRect() ?? null;
        } catch {
          // Ignore an invalid optional selector; the dialog keeps its normal bounds.
        }
      }
      const usable = dialogUsableBounds({ viewport, avoidTopRect });
      const width = Math.min(maxWidth, usable.width);
      const maxHeight = Math.max(1, usable.height);

      const panelRect = panel.getBoundingClientRect();
      const contentHeight = Math.min(Math.max(panelRect.height || 0, panel.scrollHeight || 0, 1), maxHeight);
      const panelHeight = Math.min(contentHeight, maxHeight);
      const centerTop = usable.top + (usable.height - panelHeight) / 2;
      const centerLeft = usable.left + (usable.width - width) / 2;

      let next: DialogPosition = {
        top: clamp(centerTop, usable.top, Math.max(usable.top, usable.bottom - panelHeight)),
        left: clamp(centerLeft, usable.left, Math.max(usable.left, usable.right - width)),
        width,
        maxHeight,
        placement: 'center',
      };

      const anchor = anchorRef?.current;
      if (strategy === 'anchor-or-center' && anchor) {
        const anchorRect = anchor.getBoundingClientRect();
        const anchorVisible =
          anchorRect.bottom >= usable.top &&
          anchorRect.top <= usable.bottom &&
          anchorRect.right >= usable.left &&
          anchorRect.left <= usable.right;

        if (anchorVisible) {
          const spaceBelow = usable.bottom - anchorRect.bottom - ANCHOR_GAP;
          const spaceAbove = anchorRect.top - usable.top - ANCHOR_GAP;
          const canFitBelow = spaceBelow >= panelHeight;
          const canFitAbove = spaceAbove >= panelHeight;
          const useBelow = canFitBelow || spaceBelow >= spaceAbove;
          const availableSpace = useBelow ? spaceBelow : spaceAbove;
          const partialAnchorMinHeight = Math.min(Math.max(contentHeight * 0.65, 240), 360);
          const anchoredMaxHeight = Math.min(maxHeight, Math.max(availableSpace, 0));
          const anchoredHeight = Math.min(contentHeight, anchoredMaxHeight);
          const anchoredTop = useBelow
            ? anchorRect.bottom + ANCHOR_GAP
            : anchorRect.top - ANCHOR_GAP - anchoredHeight;

          if (canFitBelow || canFitAbove || availableSpace >= partialAnchorMinHeight) {
            next = {
              top: anchoredTop,
              left: clamp(
                anchorRect.left + anchorRect.width / 2 - width / 2,
                usable.left,
                Math.max(usable.left, usable.right - width),
              ),
              width,
              maxHeight: anchoredMaxHeight,
              placement: useBelow ? 'below' : 'above',
            };
          }
        }
      }

      setPosition((current) => (nearlyEqual(current, next) ? current : next));
    };

    const schedule = () => {
      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(calculate);
    };

    const scrollOptions: AddEventListenerOptions = { capture: true, passive: true };
    const visualViewportOptions: AddEventListenerOptions = { passive: true };

    calculate();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, scrollOptions);
    window.visualViewport?.addEventListener('resize', schedule, visualViewportOptions);
    window.visualViewport?.addEventListener('scroll', schedule, visualViewportOptions);

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    if (panelRef.current && observer) observer.observe(panelRef.current);
    const observeAvoidTop = () => {
      if (!avoidTopSelector || !observer) return;
      try {
        const element = document.querySelector<HTMLElement>(avoidTopSelector);
        if (element) observer.observe(element);
      } catch {
        // Invalid optional selectors fall back to normal dialog positioning.
      }
    };
    observeAvoidTop();

    const mutationObserver = avoidTopSelector && typeof MutationObserver !== 'undefined'
      ? new MutationObserver(() => {
          observeAvoidTop();
          schedule();
        })
      : null;
    if (mutationObserver && document.body) {
      mutationObserver.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, scrollOptions);
      window.visualViewport?.removeEventListener('resize', schedule, visualViewportOptions);
      window.visualViewport?.removeEventListener('scroll', schedule, visualViewportOptions);
      observer?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [anchorRef, avoidTopSelector, maxWidth, mounted, open, strategy]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="viewport-aware-dialog-overlay"
      role="presentation"
      style={{ zIndex }}
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-label={ariaLabel}
        tabIndex={-1}
        data-qa="viewport-aware-dialog"
        data-placement={position?.placement ?? 'measuring'}
        className={`viewport-aware-dialog-panel ${className}`}
        style={{
          top: position?.top ?? '50%',
          left: position?.left ?? '50%',
          width: position?.width ?? `min(${maxWidth}px, calc(100vw - ${EDGE_GAP * 2}px))`,
          maxHeight: position?.maxHeight ?? `calc(100dvh - ${EDGE_GAP * 2}px)`,
          opacity: position ? 1 : 0,
          transform: position ? undefined : 'translate(-50%, -50%)',
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
};
