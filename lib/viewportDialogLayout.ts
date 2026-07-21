export interface DialogViewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DialogAvoidRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface DialogUsableBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export function dialogUsableBounds({
  viewport,
  avoidTopRect,
  edgeGap = 16,
  avoidGap = 12,
}: {
  viewport: DialogViewport;
  avoidTopRect?: DialogAvoidRect | null;
  edgeGap?: number;
  avoidGap?: number;
}): DialogUsableBounds {
  const left = viewport.left + edgeGap;
  const right = Math.max(left, viewport.left + viewport.width - edgeGap);
  const bottom = viewport.top + viewport.height - edgeGap;
  let top = Math.min(bottom, viewport.top + edgeGap);

  const viewportRight = viewport.left + viewport.width;
  const viewportBottom = viewport.top + viewport.height;
  const avoidIsVisible = Boolean(
    avoidTopRect
      && avoidTopRect.right > viewport.left
      && avoidTopRect.left < viewportRight
      && avoidTopRect.bottom > viewport.top
      && avoidTopRect.top < viewportBottom,
  );

  if (avoidTopRect && avoidIsVisible) {
    top = Math.min(bottom, Math.max(top, avoidTopRect.bottom + avoidGap));
  }

  return {
    left,
    right,
    top,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}
