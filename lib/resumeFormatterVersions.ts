import type { FormattedResume } from '../types';

export interface ResumeFormatterVersionLibrary {
  version: 2;
  activeMarket?: string;
  versions: Record<string, FormattedResume>;
}

export type ResumeFormatterSavedResult = FormattedResume | ResumeFormatterVersionLibrary;

const hasFormattedText = (value: unknown): value is FormattedResume => (
  Boolean(value)
  && typeof value === 'object'
  && typeof (value as { formattedText?: unknown }).formattedText === 'string'
);

export const normalizeResumeMarketKey = (market: string | null | undefined): string => (
  (market ?? '').trim() || 'General'
);

export const normalizeResumeLanguageKey = (outputLanguage: FormattedResume['outputLanguage'] | null | undefined): 'en' | 'local' | 'default' => {
  if (outputLanguage === 'en' || outputLanguage === 'local') return outputLanguage;
  return 'default';
};

export const normalizeResumeVersionKey = (
  market: string | null | undefined,
  outputLanguage?: FormattedResume['outputLanguage'] | null,
): string => {
  const marketKey = normalizeResumeMarketKey(market);
  const languageKey = normalizeResumeLanguageKey(outputLanguage);
  return languageKey === 'default' ? marketKey : `${marketKey}::${languageKey}`;
};

export const getResumeVersionDisplayLabel = (key: string): string => key.split('::')[0] || key;

const versionMatchesLanguage = (
  version: FormattedResume | undefined,
  outputLanguage?: FormattedResume['outputLanguage'] | null,
): version is FormattedResume => {
  if (!version) return false;
  if (outputLanguage == null) return true;
  return version.outputLanguage == null || version.outputLanguage === outputLanguage;
};

export const isResumeFormatterVersionLibrary = (value: unknown): value is ResumeFormatterVersionLibrary => (
  Boolean(value)
  && typeof value === 'object'
  && (value as { version?: unknown }).version === 2
  && Boolean((value as { versions?: unknown }).versions)
  && typeof (value as { versions?: unknown }).versions === 'object'
);

export const getResumeFormatterVersions = (
  savedResult: ResumeFormatterSavedResult | null | undefined,
  fallbackMarket = 'General',
): Record<string, FormattedResume> => {
  if (!savedResult) return {};

  if (isResumeFormatterVersionLibrary(savedResult)) {
    return Object.entries(savedResult.versions ?? {}).reduce<Record<string, FormattedResume>>((acc, [market, version]) => {
      if (!hasFormattedText(version)) return acc;
      const key = market.includes('::')
        ? market
        : normalizeResumeVersionKey(version.targetMarket || market, version.outputLanguage);
      acc[key] = {
        ...version,
        targetMarket: version.targetMarket || getResumeVersionDisplayLabel(key),
      };
      return acc;
    }, {});
  }

  if (!hasFormattedText(savedResult)) return {};
  const key = normalizeResumeMarketKey(savedResult.targetMarket || fallbackMarket);
  return {
    [key]: {
      ...savedResult,
      targetMarket: savedResult.targetMarket || key,
    },
  };
};

export const getSavedResumeFormatterVersion = (
  savedResult: ResumeFormatterSavedResult | null | undefined,
  targetMarket: string,
  outputLanguage?: FormattedResume['outputLanguage'] | null,
): FormattedResume | null => {
  const versions = getResumeFormatterVersions(savedResult, targetMarket);
  const versionKey = normalizeResumeVersionKey(targetMarket, outputLanguage);
  const marketKey = normalizeResumeMarketKey(targetMarket);
  return versions[versionKey]
    ?? (versionMatchesLanguage(versions[marketKey], outputLanguage) ? versions[marketKey] : undefined)
    ?? Object.entries(versions).find(([key, version]) => (
      getResumeVersionDisplayLabel(key) === marketKey
      && versionMatchesLanguage(version, outputLanguage)
    ))?.[1]
    ?? null;
};

export const getPreferredResumeFormatterVersion = (
  savedResult: ResumeFormatterSavedResult | null | undefined,
  targetMarket: string,
  outputLanguage?: FormattedResume['outputLanguage'] | null,
): FormattedResume | null => {
  const versions = getResumeFormatterVersions(savedResult, targetMarket);
  const marketKey = normalizeResumeMarketKey(targetMarket);
  const target = versions[normalizeResumeVersionKey(targetMarket, outputLanguage)]
    ?? (versionMatchesLanguage(versions[marketKey], outputLanguage) ? versions[marketKey] : undefined)
    ?? Object.entries(versions).find(([key, version]) => (
      getResumeVersionDisplayLabel(key) === marketKey
      && versionMatchesLanguage(version, outputLanguage)
    ))?.[1];
  if (target) return target;

  if (isResumeFormatterVersionLibrary(savedResult) && savedResult.activeMarket) {
    const active = versions[normalizeResumeMarketKey(savedResult.activeMarket)];
    if (versionMatchesLanguage(active, outputLanguage)) return active;
  }

  return Object.values(versions).find((version) => versionMatchesLanguage(version, outputLanguage)) ?? null;
};

export const upsertResumeFormatterVersion = (
  savedResult: ResumeFormatterSavedResult | null | undefined,
  version: FormattedResume,
): ResumeFormatterVersionLibrary => {
  const key = normalizeResumeVersionKey(version.targetMarket, version.outputLanguage);
  const marketKey = normalizeResumeMarketKey(version.targetMarket);
  return {
    version: 2,
    activeMarket: key,
    versions: {
      ...getResumeFormatterVersions(savedResult, marketKey),
      [key]: {
        ...version,
        targetMarket: marketKey,
      },
    },
  };
};

export const removeResumeFormatterVersion = (
  savedResult: ResumeFormatterSavedResult | null | undefined,
  targetMarket: string,
  outputLanguage?: FormattedResume['outputLanguage'] | null,
): ResumeFormatterVersionLibrary | null => {
  const key = normalizeResumeVersionKey(targetMarket, outputLanguage);
  const versions = { ...getResumeFormatterVersions(savedResult, key) };
  delete versions[key];
  if (outputLanguage == null) {
    delete versions[normalizeResumeMarketKey(targetMarket)];
  }
  const activeMarket = Object.keys(versions)[0];
  if (!activeMarket) return null;
  return {
    version: 2,
    activeMarket,
    versions,
  };
};
