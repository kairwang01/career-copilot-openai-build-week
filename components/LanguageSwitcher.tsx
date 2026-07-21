import React from 'react';
import { ChevronDown, Languages } from 'lucide-react';

import { useLocalization } from '../hooks/useLocalization';

export const SUPPORTED_LANGUAGES = [
    { code: 'en', name: 'English' },
    { code: 'fr', name: 'Français' },
    { code: 'zh', name: '中文' },
    { code: 'ja', name: '日本語' },
    { code: 'de', name: 'Deutsch' },
    { code: 'vi', name: 'Tiếng Việt' },
    { code: 'ar', name: 'العربية' },
];

interface LanguageSwitcherProps {
    onLanguageChange: (langCode: string) => void;
    currentLang: string;
    variant?: 'default' | 'footer';
}

const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ onLanguageChange, currentLang, variant = 'default' }) => {
    const selectId = React.useId();
    const { t } = useLocalization(currentLang);
    const currentLanguage = SUPPORTED_LANGUAGES.find((lang) => lang.code === currentLang) ?? SUPPORTED_LANGUAGES[0];

    const options = SUPPORTED_LANGUAGES.map((lang) => (
        <option key={lang.code} value={lang.code} lang={lang.code} dir={lang.code === 'ar' ? 'rtl' : 'ltr'}>
            {lang.name}
        </option>
    ));

    if (variant === 'footer') {
        return (
            <div className="flex min-w-0 items-center gap-3 border-t border-gray-200/50 px-2 py-3 dark:border-slate-800/50">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                    <Languages className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                    <label htmlFor={selectId} className="block text-[10px] font-bold uppercase text-gray-400 dark:text-slate-500">
                        {t('language_switcher_label')}
                    </label>
                    <div className="relative mt-1 min-w-0">
                        <select
                            id={selectId}
                            value={currentLanguage.code}
                            onChange={(event) => onLanguageChange(event.target.value)}
                            dir="auto"
                            className="min-h-11 w-full min-w-0 appearance-none rounded-xl border border-gray-200 bg-white py-1.5 ps-3 pe-9 text-start text-xs font-semibold text-gray-800 outline-none transition-colors focus:border-slate-400 focus:ring-2 focus:ring-slate-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-500 dark:focus:ring-slate-700"
                        >
                            {options}
                        </select>
                        <ChevronDown className="pointer-events-none absolute end-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" aria-hidden="true" />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="border-t border-gray-100 px-4 py-2 text-sm text-gray-700 dark:border-slate-600 dark:text-gray-200">
            <label htmlFor={selectId} className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
                {t('language_switcher_label')}
            </label>
            <select
                id={selectId}
                onChange={(event) => onLanguageChange(event.target.value)}
                className="min-h-11 w-full min-w-0 rounded-md border border-gray-200 bg-white p-1.5 text-start text-sm text-gray-800 focus:border-blue-500 focus:ring-blue-500 dark:border-slate-500 dark:bg-slate-600 dark:text-gray-100"
                value={currentLanguage.code}
                dir="auto"
            >
                {options}
            </select>
        </div>
    );
};

export default LanguageSwitcher;
