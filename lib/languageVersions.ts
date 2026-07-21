/**
 * languageVersions — a generic "one result per language" store for AI-tool
 * outputs that are language-specific (resume analysis, cover letter, talent
 * profile, …). Persisted via services/toolResults as the tool's `result`.
 *
 * When the UI language differs from the language a stored result was generated
 * in, the UI offers to either switch to a stored version (free) or regenerate
 * one in the new language (costs credits). This module is the storage/lookup
 * primitive behind that decision; the switch-vs-regenerate UX lives in
 * components/LanguageSyncBanner + each tool's view.
 */

export interface LanguageVersion<T = unknown> {
  /** BCP-47-ish language code the result was generated in (e.g. 'en','fr','ar'). */
  lang: string;
  result: T;
  /** epoch millis this version was generated. */
  savedAt: number;
}

export interface LanguageVersionLibrary<T = unknown> {
  kind: 'lang-versions';
  version: 1;
  /** the language of the version last viewed/generated. */
  activeLang: string;
  /** keyed by language code. */
  versions: Record<string, LanguageVersion<T>>;
}

export const isLanguageVersionLibrary = <T = unknown>(value: unknown): value is LanguageVersionLibrary<T> => (
  Boolean(value)
  && typeof value === 'object'
  && (value as { kind?: unknown }).kind === 'lang-versions'
  && Boolean((value as { versions?: unknown }).versions)
  && typeof (value as { versions?: unknown }).versions === 'object'
);

const normalizeLang = (lang: string | null | undefined): string => (lang ?? '').trim().toLowerCase() || 'en';

/** Read a stored version for a language, or null. */
export const getLanguageVersion = <T>(
  lib: LanguageVersionLibrary<T> | null | undefined,
  lang: string,
): LanguageVersion<T> | null => {
  if (!isLanguageVersionLibrary<T>(lib)) return null;
  return lib.versions[normalizeLang(lang)] ?? null;
};

export const hasLanguageVersion = (
  lib: LanguageVersionLibrary | null | undefined,
  lang: string,
): boolean => Boolean(getLanguageVersion(lib, lang));

/** Languages that currently have a stored version, most-recent first. */
export const listVersionLanguages = (lib: LanguageVersionLibrary | null | undefined): string[] => {
  if (!isLanguageVersionLibrary(lib)) return [];
  return Object.values(lib.versions)
    .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))
    .map((v) => v.lang);
};

/** The active (last-viewed/generated) version, or the most recent one. */
export const getActiveLanguageVersion = <T>(
  lib: LanguageVersionLibrary<T> | null | undefined,
): LanguageVersion<T> | null => {
  if (!isLanguageVersionLibrary<T>(lib)) return null;
  return getLanguageVersion(lib, lib.activeLang)
    ?? Object.values(lib.versions).sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))[0]
    ?? null;
};

/** Insert/replace the version for a language and mark it active. Pure. */
export const upsertLanguageVersion = <T>(
  lib: LanguageVersionLibrary<T> | null | undefined,
  lang: string,
  result: T,
  nowMillis: number,
): LanguageVersionLibrary<T> => {
  const key = normalizeLang(lang);
  const base = isLanguageVersionLibrary<T>(lib) ? lib.versions : {};
  return {
    kind: 'lang-versions',
    version: 1,
    activeLang: key,
    versions: { ...base, [key]: { lang: key, result, savedAt: nowMillis } },
  };
};

/** Mark a language active without changing its stored result. Pure. */
export const setActiveLanguage = <T>(
  lib: LanguageVersionLibrary<T>,
  lang: string,
): LanguageVersionLibrary<T> => ({ ...lib, activeLang: normalizeLang(lang) });

/**
 * Wrap a bare (pre-versioning) result as a single-language library, so results
 * saved before this feature keep working. `lang` is the best guess for the old
 * result's language (usually the user's current UI language at load time).
 */
export const adoptBareResult = <T>(result: T, lang: string, nowMillis: number): LanguageVersionLibrary<T> =>
  upsertLanguageVersion<T>(null, lang, result, nowMillis);
