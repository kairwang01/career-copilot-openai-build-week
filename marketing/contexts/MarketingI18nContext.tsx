import React, { createContext, useContext } from 'react';
import { useLocalization } from '../../hooks/useLocalization';

interface MarketingI18nValue {
  t: (key: string) => string;
  isLoaded: boolean;
  currentLang: string;
  changeLanguage: (lang: string) => void;
}

const MarketingI18nContext = createContext<MarketingI18nValue | null>(null);

// One localization state for all marketing pages. Reuses useLocalization and preferred_language.
export const MarketingI18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t, isLoaded, currentLang, changeLanguage } = useLocalization();

  const setLanguage = (lang: string) => {
    changeLanguage(lang);
  };

  return (
    <MarketingI18nContext.Provider value={{ t, isLoaded, currentLang, changeLanguage: setLanguage }}>
      {children}
    </MarketingI18nContext.Provider>
  );
};

export const useMarketingI18nContext = (): MarketingI18nValue => {
  const ctx = useContext(MarketingI18nContext);
  if (!ctx) {
    throw new Error('useMarketingI18nContext must be used within a MarketingI18nProvider');
  }
  return ctx;
};
