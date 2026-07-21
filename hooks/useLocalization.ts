import { useState, useEffect, useCallback } from 'react';
import { getTranslations } from '../localization';
import { normalizeUiLanguage, resolveUiLanguagePreference } from '../lib/uiLanguage';

type Translations = { [key: string]: string };

const LANGUAGE_STORAGE_KEY = 'preferred_language';
const LANGUAGE_CHANGE_EVENT = 'career-copilot-language-change';

const readStoredLanguage = () => {
    if (typeof localStorage === 'undefined') return null;
    try {
        return localStorage.getItem(LANGUAGE_STORAGE_KEY);
    } catch {
        return null;
    }
};

const getBrowserLanguage = () => {
    if (typeof navigator === 'undefined') return null;
    return navigator.language || null;
};

const resolveInitialLanguage = (initialLanguage?: string) =>
    normalizeUiLanguage(initialLanguage) || resolveUiLanguagePreference(readStoredLanguage(), getBrowserLanguage());

export const useLocalization = (initialLanguage?: string) => {
    const [language, setLanguage] = useState(() => resolveInitialLanguage(initialLanguage));
    const [translations, setTranslations] = useState<Translations>({});
    // English is loaded once as a fallback so a key missing in the active language
    // shows English copy instead of the raw key (e.g. newly-added strings that
    // haven't been translated to de/fr/ja/vi yet).
    const [fallback, setFallback] = useState<Translations>({});
    const [isLoaded, setIsLoaded] = useState(false);

    const changeLanguage = useCallback((newLang: string) => {
        const normalizedLanguage = normalizeUiLanguage(newLang);
        if (!normalizedLanguage) return;
        setLanguage((current) => (current === normalizedLanguage ? current : normalizedLanguage));
        try {
            localStorage.setItem(LANGUAGE_STORAGE_KEY, normalizedLanguage);
        } catch {
            /* Preference persistence is non-critical; keep the in-memory switch. */
        }
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent(LANGUAGE_CHANGE_EVENT, { detail: { language: normalizedLanguage } }));
        }
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const handleLanguageEvent = (event: Event) => {
            const lang = (event as CustomEvent<{ language?: string }>).detail?.language;
            const normalizedLanguage = normalizeUiLanguage(lang);
            if (normalizedLanguage) {
                setLanguage((current) => (current === normalizedLanguage ? current : normalizedLanguage));
            }
        };
        const handleStorageEvent = (event: StorageEvent) => {
            const normalizedLanguage = event.key === LANGUAGE_STORAGE_KEY
                ? normalizeUiLanguage(event.newValue)
                : undefined;
            if (normalizedLanguage) {
                setLanguage((current) => (current === normalizedLanguage ? current : normalizedLanguage));
            }
        };

        window.addEventListener(LANGUAGE_CHANGE_EVENT, handleLanguageEvent);
        window.addEventListener('storage', handleStorageEvent);
        return () => {
            window.removeEventListener(LANGUAGE_CHANGE_EVENT, handleLanguageEvent);
            window.removeEventListener('storage', handleStorageEvent);
        };
    }, []);

    useEffect(() => {
        if (typeof document === 'undefined') return;
        const resolvedLanguage = language || 'en';
        document.documentElement.lang = resolvedLanguage;
        document.documentElement.dir = resolvedLanguage === 'ar' ? 'rtl' : 'ltr';
    }, [language]);

    useEffect(() => {
        let isMounted = true;
        const fetchTranslations = async () => {
            setIsLoaded(false);
            try {
                const loadedTranslations = await getTranslations(language);
                if (isMounted) setTranslations(loadedTranslations);
            } catch {
                // Non-fatal: the English fallback dict + key fallback still render.
                // Crucially, isLoaded MUST still settle below — otherwise every gate
                // that waits on it (the workspace/portal loading spinner) freezes forever.
            } finally {
                if (isMounted) setIsLoaded(true);
            }
        };
        fetchTranslations();
        return () => {
            isMounted = false;
        };
    }, [language]);

    // Load the English dictionary once as the universal fallback.
    useEffect(() => {
        let isMounted = true;
        getTranslations('en').then((en) => { if (isMounted) setFallback(en); });
        return () => { isMounted = false; };
    }, []);

    // IMPORTANT: t must be referentially stable. Many components put `t` in
    // useCallback/useEffect dependency arrays; an unmemoized `t` gets a new
    // identity on EVERY render of the consumer, which re-fires those effects.
    // In OpportunityFinder this chained into an auto-rerun of the credit-charging
    // AI search on every credits update (deduct → live snapshot → re-render →
    // new t → effect refires → deduct again …) — an infinite credit drain.
    const t = useCallback((key: string): string => {
        return translations[key] || fallback[key] || key; // active lang → English → key
    }, [translations, fallback]);

    return { t, isLoaded, currentLang: language, changeLanguage };
};
