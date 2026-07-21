export const SUPPORTED_UI_LANGUAGES = ['en', 'fr', 'zh', 'ja', 'de', 'vi', 'ar'] as const;

const supportedLanguageSet = new Set<string>(SUPPORTED_UI_LANGUAGES);

export const normalizeUiLanguage = (value: string | null | undefined): string | undefined => {
  const baseLanguage = value?.trim().toLowerCase().replace('_', '-').split('-')[0];
  return baseLanguage && supportedLanguageSet.has(baseLanguage) ? baseLanguage : undefined;
};

export const resolveUiLanguagePreference = (
  storedLanguage: string | null | undefined,
  browserLanguage: string | null | undefined,
): string => normalizeUiLanguage(storedLanguage) ?? normalizeUiLanguage(browserLanguage) ?? 'en';
