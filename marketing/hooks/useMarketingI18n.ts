import { useMarketingI18nContext } from '../contexts/MarketingI18nContext';

/**
 * Public pages share one localization state via MarketingI18nProvider.
 * Marketing-specific keys use the `site_` prefix in localization/*.json.
 */
export const useMarketingI18n = () => useMarketingI18nContext();
