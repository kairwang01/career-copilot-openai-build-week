import { describe, expect, it } from 'vitest';
import { normalizeUiLanguage, resolveUiLanguagePreference } from '../lib/uiLanguage';

describe('UI language resolution', () => {
  it('uses a supported stored preference before the browser language', () => {
    expect(resolveUiLanguagePreference('fr', 'zh-CN')).toBe('fr');
  });

  it('uses the browser language on a first visit without a stored preference', () => {
    expect(resolveUiLanguagePreference(null, 'zh-CN')).toBe('zh');
  });

  it('normalizes locale variants and rejects unsupported languages', () => {
    expect(normalizeUiLanguage('JA_jp')).toBe('ja');
    expect(normalizeUiLanguage('es-MX')).toBeUndefined();
    expect(resolveUiLanguagePreference(null, 'es-MX')).toBe('en');
  });
});
