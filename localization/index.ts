const fetchTranslation = async (langFile: string, fallbackToEnglish = true): Promise<{ [key: string]: string }> => {
    try {
        const response = await fetch(`/localization/${langFile}`);
        if (!response.ok) {
            console.error(`Could not load ${langFile}, falling back to English.`);
            // If the requested language file is not found, try fetching the English one as a fallback.
            if (fallbackToEnglish && langFile !== 'en.json') {
                return fetchTranslation('en.json', false);
            }
            return {};
        }
        return response.json();
    } catch (error) {
        console.error('Error fetching translation file, falling back to English', error);
        // If there's a network error or even English fails, return an empty object to prevent app crash.
        if (fallbackToEnglish && langFile !== 'en.json') {
            return fetchTranslation('en.json', false);
        }
        return {};
    }
};

export const getTranslations = async (lang: string): Promise<{ [key: string]: string }> => {
    const langFileMap: { [key: string]: string } = {
        ja: 'ja.json',
        vi: 'vi.json',
        de: 'de.json',
        fr: 'fr.json',
        zh: 'zh.json',
        ar: 'ar.json',
    };
    const fileName = langFileMap[lang] || 'en.json';
    if (fileName === 'en.json') {
        return fetchTranslation('en.json', false);
    }
    const [english, localized] = await Promise.all([
        fetchTranslation('en.json', false),
        fetchTranslation(fileName, false),
    ]);
    return { ...english, ...localized };
};
