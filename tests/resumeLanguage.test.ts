import { describe, expect, it } from 'vitest';
import { getMarketForLocalLanguage, getMarketLocalLanguage, marketDefaultLanguage, resolveOutputLanguageName } from '../lib/resumeLanguage';

describe('resumeLanguage', () => {
  it('returns a local language for DE/FR/JP/VN/UAE', () => {
    expect(getMarketLocalLanguage('Germany')).toEqual({ name: 'German', labelKey: 'resume_lang_german' });
    expect(getMarketLocalLanguage('France')).toEqual({ name: 'French', labelKey: 'resume_lang_french' });
    expect(getMarketLocalLanguage('Japan')).toEqual({ name: 'Japanese', labelKey: 'resume_lang_japanese' });
    expect(getMarketLocalLanguage('Vietnam')).toEqual({ name: 'Vietnamese', labelKey: 'resume_lang_vietnamese' });
    expect(getMarketLocalLanguage('United Arab Emirates')).toEqual({ name: 'Arabic', labelKey: 'resume_lang_arabic' });
  });

  it('returns null for English-native / multi-language markets', () => {
    for (const m of ['Singapore', 'United States', 'Australia', 'United Kingdom']) {
      expect(getMarketLocalLanguage(m)).toBeNull();
    }
  });

  // Canada is bilingual: the French toggle exists (Québec roles) but English
  // stays the starting choice, unlike single-language markets.
  it('offers French for Canada while defaulting to English', () => {
    expect(getMarketLocalLanguage('Canada')).toEqual({
      name: 'French',
      labelKey: 'resume_lang_french',
      defaultToEnglish: true,
    });
    expect(marketDefaultLanguage('Canada')).toBe('en');
    expect(marketDefaultLanguage('Japan')).toBe('local');
    expect(resolveOutputLanguageName('Canada', 'local')).toBe('French');
    expect(resolveOutputLanguageName('Canada', 'en')).toBe('English');
  });

  it('routes a French regeneration to France unless the current market is already French-compatible', () => {
    expect(getMarketForLocalLanguage('French')).toBe('France');
    expect(getMarketForLocalLanguage('French', 'United States')).toBe('France');
    expect(getMarketForLocalLanguage('French', 'France')).toBe('France');
    expect(getMarketForLocalLanguage('French', 'Canada')).toBe('Canada');
  });

  it('resolves the language name passed to the model', () => {
    expect(resolveOutputLanguageName('Japan', 'local')).toBe('Japanese');
    expect(resolveOutputLanguageName('United Arab Emirates', 'local')).toBe('Arabic');
    expect(resolveOutputLanguageName('Japan', 'en')).toBe('English');
    expect(resolveOutputLanguageName('United States', 'local')).toBe('English'); // no local language → English
  });

  // Regression: China used to be missing here, so localizing to China stayed in
  // English (reported: "company/school always English"). It must map to Chinese.
  it('localizes China to Simplified Chinese', () => {
    expect(getMarketLocalLanguage('China')).toEqual({ name: 'Simplified Chinese', labelKey: 'resume_lang_chinese' });
    expect(resolveOutputLanguageName('China', 'local')).toBe('Simplified Chinese');
    expect(resolveOutputLanguageName('China', 'en')).toBe('English');
  });
});
