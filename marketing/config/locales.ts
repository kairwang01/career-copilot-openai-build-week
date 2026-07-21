import { SUPPORTED_LANGUAGES } from '../../components/LanguageSwitcher';

/** All product locales — marketing pages share the same localization pipeline as the app. */
export const MARKETING_SUPPORTED_LANGUAGES = SUPPORTED_LANGUAGES;

export type MarketingLangCode = (typeof MARKETING_SUPPORTED_LANGUAGES)[number]['code'];
