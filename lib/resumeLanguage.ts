// Maps a target market to its single distinct local resume language. Only markets
// whose professional norm differs from English appear here; everything else returns
// null (the UI shows no language toggle and output stays English).
const MARKET_LOCAL_LANGUAGE: Record<string, { name: string; labelKey: string; defaultToEnglish?: boolean }> = {
  // Canada is bilingual: French resumes are the norm for Québec roles, but most
  // Canadian hiring is English-first, so the toggle exists while English stays
  // the default (unlike single-language markets below, which default to local).
  Canada:   { name: 'French',     labelKey: 'resume_lang_french', defaultToEnglish: true },
  Germany:  { name: 'German',     labelKey: 'resume_lang_german' },
  France:   { name: 'French',     labelKey: 'resume_lang_french' },
  Japan:    { name: 'Japanese',   labelKey: 'resume_lang_japanese' },
  China:    { name: 'Simplified Chinese', labelKey: 'resume_lang_chinese' },
  Vietnam:  { name: 'Vietnamese', labelKey: 'resume_lang_vietnamese' },
  'United Arab Emirates': { name: 'Arabic', labelKey: 'resume_lang_arabic' },
};

export type OutputLanguageChoice = 'en' | 'local';

// `name` is the fixed English identifier sent to the model; `labelKey` is the i18n
// key for the UI label. Returns null when the market has no distinct local language.
export const getMarketLocalLanguage = (
  market: string,
): { name: string; labelKey: string; defaultToEnglish?: boolean } | null => MARKET_LOCAL_LANGUAGE[market] ?? null;

// The language choice a market starts on: 'local' for single-language markets
// (a Chinese resume is the norm in China), 'en' when the market has no local
// option or is bilingual-but-English-first (Canada).
export const marketDefaultLanguage = (market: string): OutputLanguageChoice => {
  const local = getMarketLocalLanguage(market);
  return local && !local.defaultToEnglish ? 'local' : 'en';
};

// Reverse lookup used by language-sync actions. Keep a compatible current market,
// otherwise prefer a market where that language is the default professional norm.
// This prevents bilingual English-first Canada from winning French over France just
// because Canada appears first in the market list.
export const getMarketForLocalLanguage = (
  languageName: string,
  preferredMarket?: string,
): string | null => {
  if (preferredMarket && MARKET_LOCAL_LANGUAGE[preferredMarket]?.name === languageName) {
    return preferredMarket;
  }
  let bilingualFallback: string | null = null;
  for (const [market, local] of Object.entries(MARKET_LOCAL_LANGUAGE)) {
    if (local.name !== languageName) continue;
    if (!local.defaultToEnglish) return market;
    if (bilingualFallback === null) bilingualFallback = market;
  }
  return bilingualFallback;
};

// Resolves the user's choice into the concrete language name handed to the prompt.
export const resolveOutputLanguageName = (
  market: string,
  choice: OutputLanguageChoice,
): string => {
  if (choice === 'local') {
    const local = getMarketLocalLanguage(market);
    if (local) return local.name;
  }
  return 'English';
};
