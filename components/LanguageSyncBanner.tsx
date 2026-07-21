import React from 'react';
import { Languages, ArrowRight, Coins } from 'lucide-react';
import { SUPPORTED_LANGUAGES } from './LanguageSwitcher';

const langName = (code: string | null | undefined): string =>
  SUPPORTED_LANGUAGES.find((l) => l.code === code)?.name ?? (code ?? '').toUpperCase();

interface LanguageSyncBannerProps {
  /** language the currently-shown artifact was generated in. */
  contentLang: string | null | undefined;
  /** current UI language. */
  uiLang: string;
  /** language codes that already have a stored version (free to switch to). */
  availableLangs: string[];
  /** credit cost to regenerate in a new language. */
  creditCost: number;
  /** whether this tier can persist versions (affects the copy shown). */
  canPersist: boolean;
  busy?: boolean;
  onSwitch: (lang: string) => void;
  onRegenerate: (lang: string) => void;
  onDismiss: () => void;
  t: (key: string) => string;
}

/**
 * Dismissible nudge shown above a language-specific AI artifact when the UI
 * language differs from the artifact's language. Offers a free switch to a
 * stored version, or a paid regeneration when none exists. Never auto-acts.
 */
export const LanguageSyncBanner: React.FC<LanguageSyncBannerProps> = ({
  contentLang, uiLang, availableLangs, creditCost, canPersist, busy, onSwitch, onRegenerate, onDismiss, t,
}) => {
  const content = (contentLang ?? '').trim();
  if (!content || content === uiLang) return null;

  const canSwitch = availableLangs.includes(uiLang);
  const target = langName(uiLang);
  const current = langName(content);
  const fill = (key: string) => t(key).replace('{target}', target).replace('{content}', current).replace('{credits}', String(creditCost));

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-blue-900/50 dark:bg-blue-950/40">
      <div className="flex items-start gap-2.5">
        <Languages className="mt-0.5 h-4.5 w-4.5 flex-shrink-0 text-blue-600 dark:text-blue-300" aria-hidden="true" />
        <div className="text-sm text-blue-900 dark:text-blue-100">
          <p className="font-semibold">{fill(canSwitch ? 'lang_sync_switch_title' : 'lang_sync_regen_title')}</p>
          <p className="mt-0.5 text-xs text-blue-700/90 dark:text-blue-200/80">
            {canSwitch
              ? t('lang_sync_free_note')
              : creditCost <= 0
                ? fill('lang_sync_regen_note_nocost')
                : (canPersist ? fill('lang_sync_regen_note') : t('lang_sync_regen_note_free_tier'))}
          </p>
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2 sm:flex-col-reverse sm:items-stretch md:flex-row md:items-center">
        <button
          type="button"
          onClick={onDismiss}
          disabled={busy}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 disabled:opacity-60 dark:text-blue-200 dark:hover:bg-blue-900/50"
        >
          {fill('lang_sync_dismiss')}
        </button>
        {canSwitch ? (
          <button
            type="button"
            onClick={() => onSwitch(uiLang)}
            disabled={busy}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {fill('lang_sync_switch_cta')}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onRegenerate(uiLang)}
            disabled={busy}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {fill('lang_sync_regen_cta')}
            {creditCost > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded bg-blue-500/60 px-1.5 py-0.5 text-[10px] font-semibold">
                <Coins className="h-3 w-3" aria-hidden="true" />{creditCost}
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  );
};
