import { useEffect, type RefObject } from 'react';
import {
  isTopModalLayer,
  lockBodyScroll,
  pushModalLayer,
  removeModalLayer,
} from './modalEnvironment';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared behavior for hand-rolled modal overlays: closes on Escape and locks
 * body scroll while open. Components that always render open can omit `enabled`;
 * components gated by an `isOpen` prop pass it through.
 *
 * `lockScroll` (default true) lets NON-modal surfaces — e.g. a desktop-docked
 * panel that deliberately leaves the page usable — keep Escape-to-close without
 * hijacking the page's scroll.
 */
export function useModalBehavior(
  onClose: () => void,
  enabled: boolean = true,
  lockScroll: boolean = true,
  dialogRef?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!enabled) return;

    const layerId = pushModalLayer();
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusFrame = dialogRef
      ? window.requestAnimationFrame(() => dialogRef.current?.focus())
      : null;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isTopModalLayer(layerId)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef?.current) return;

      const dialog = dialogRef.current;
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((element) => element.offsetParent !== null);
      if (focusables.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !dialog.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    const releaseScrollLock = lockScroll ? lockBodyScroll() : null;

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (focusFrame !== null) window.cancelAnimationFrame(focusFrame);
      removeModalLayer(layerId);
      releaseScrollLock?.();
      if (dialogRef && previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [onClose, enabled, lockScroll, dialogRef]);
}
