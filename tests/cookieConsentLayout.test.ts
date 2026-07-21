import { describe, expect, it } from 'vitest';
import { COOKIE_CONSENT_LAYER_Z_INDEX, getCookieConsentBottomSpaceCss } from '../components/CookieConsent';

describe('cookie consent layout reserve', () => {
  it('stays actionable above the candidate auth backdrop', () => {
    expect(COOKIE_CONSENT_LAYER_Z_INDEX).toBeGreaterThan(100);
  });

  it('reserves banner height, bottom offset, gap, and safe-area when bottom positioned', () => {
    expect(getCookieConsentBottomSpaceCss({
      height: 96.2,
      bottomPositioned: true,
      bottomOffsetPx: 12,
    })).toBe('calc(121px + env(safe-area-inset-bottom))');
  });

  it('does not reserve bottom space when the banner is top-positioned', () => {
    expect(getCookieConsentBottomSpaceCss({
      height: 96,
      bottomPositioned: false,
      bottomOffsetPx: 12,
    })).toBe('0px');
  });

  it('supports the larger desktop marketing bottom offset', () => {
    expect(getCookieConsentBottomSpaceCss({
      height: 120,
      bottomPositioned: true,
      bottomOffsetPx: 24,
    })).toBe('calc(156px + env(safe-area-inset-bottom))');
  });
});
