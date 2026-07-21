import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dialogUsableBounds } from '../lib/viewportDialogLayout';

describe('viewport dialog usable bounds', () => {
  const phoneViewport = { left: 0, top: 0, width: 320, height: 568 };

  it('places a dialog below a visible top consent banner', () => {
    const bounds = dialogUsableBounds({
      viewport: phoneViewport,
      avoidTopRect: { left: 0, right: 320, top: 72, bottom: 174 },
    });

    expect(bounds).toEqual({
      left: 16,
      right: 304,
      top: 186,
      bottom: 552,
      width: 288,
      height: 366,
    });
  });

  it('keeps the normal edge gaps when no avoid element is visible', () => {
    expect(dialogUsableBounds({ viewport: phoneViewport })).toEqual({
      left: 16,
      right: 304,
      top: 16,
      bottom: 552,
      width: 288,
      height: 536,
    });
  });

  it('never produces negative space when the avoid element fills the viewport', () => {
    const bounds = dialogUsableBounds({
      viewport: phoneViewport,
      avoidTopRect: { left: 0, right: 320, top: 0, bottom: 560 },
    });

    expect(bounds.top).toBe(bounds.bottom);
    expect(bounds.height).toBe(0);
  });

  it('wires Auth to the consent banner without changing every dialog', () => {
    const source = readFileSync(new URL('../components/Auth.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
    expect(source).toContain('avoidTopSelector=\'[data-qa="cookie-consent-banner"]\'');
    expect(styles).not.toMatch(/\.viewport-aware-dialog-panel\s*\{[^}]*transition:\s*top/s);
  });
});
