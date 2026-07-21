let lockDepth = 0;
let previousOverflow = '';
let previousPaddingRight = '';
let previousOverscrollBehavior = '';

// ── Modal layer stack ──────────────────────────────────────────────────────────
// Only the TOPMOST open dialog should react to Escape / trap Tab. Without this,
// stacked dialogs (e.g. an outreach composer over a candidate card, or a confirm
// over a form) would all close on a single Esc and their focus traps would fight.
// Each dialog registers a layer on open and removes it on close.
let modalStack: number[] = [];
let nextModalLayerId = 1;

export function pushModalLayer(): number {
  const id = nextModalLayerId++;
  modalStack.push(id);
  return id;
}

export function removeModalLayer(id: number): void {
  modalStack = modalStack.filter((layer) => layer !== id);
}

export function isTopModalLayer(id: number): boolean {
  return modalStack.length > 0 && modalStack[modalStack.length - 1] === id;
}

export function lockBodyScroll() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }

  if (lockDepth === 0) {
    previousOverflow = document.body.style.overflow;
    previousPaddingRight = document.body.style.paddingRight;
    previousOverscrollBehavior = document.documentElement.style.overscrollBehavior;

    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overscrollBehavior = 'contain';
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
  }

  lockDepth += 1;
  let released = false;

  return () => {
    if (released) return;
    released = true;
    lockDepth = Math.max(0, lockDepth - 1);

    if (lockDepth === 0) {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      document.documentElement.style.overscrollBehavior = previousOverscrollBehavior;
    }
  };
}
