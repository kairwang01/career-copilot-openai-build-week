import React from 'react';
import { useMarketingI18n } from '../hooks/useMarketingI18n';
import { MARKETING_SUPPORTED_LANGUAGES } from '../config/locales';

interface SiteLanguageSwitcherProps {
  variant?: 'header' | 'mobile';
}

/**
 * Reuses the same `preferred_language` persistence and localization pipeline
 * as the MVP LanguageSwitcher, but scoped to locales with full beta_* coverage.
 */
export const SiteLanguageSwitcher: React.FC<SiteLanguageSwitcherProps> = ({ variant = 'header' }) => {
  const { currentLang, changeLanguage } = useMarketingI18n();
  const value = MARKETING_SUPPORTED_LANGUAGES.some((l) => l.code === currentLang) ? currentLang : 'en';

  const base =
    'rounded-[var(--site-radius)] border border-[var(--site-border)] bg-[var(--site-surface)] text-[var(--site-text)] focus:outline-none focus:ring-2 focus:ring-[var(--site-action)]/40';

  return (
    <select
      aria-label="Language"
      value={value}
      onChange={(e) => changeLanguage(e.target.value)}
      className={
        variant === 'mobile'
          ? `${base} w-full px-3 py-2.5 min-h-[44px] text-sm mt-2`
          : `${base} px-2 py-1.5 text-sm`
      }
    >
      {MARKETING_SUPPORTED_LANGUAGES.map((lang) => (
        <option key={lang.code} value={lang.code}>
          {lang.name}
        </option>
      ))}
    </select>
  );
};
