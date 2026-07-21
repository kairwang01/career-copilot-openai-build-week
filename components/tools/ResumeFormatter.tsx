
import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Globe2, Info, Link2 } from 'lucide-react';
import { convertResumeFormat } from '../../services/aiClient';
import type { FormattedResume } from '../../types';
import StagedLoader from '../StagedLoader';
import { useCancellableLoading } from '../../hooks/useCancellableLoading';
import { SavedResultBar, ToolError } from './ToolUtils';
import { useToolResults } from '../../contexts/ToolResultsContext';
import { SUPPORTED_MARKETS } from '../../config';
import ResumePreview from '../ResumePreview';
import { assessFormattedResume, cleanResumeDisplay, getResumeMarketStyle } from '../../lib/resumePreview';
import { getMarketForLocalLanguage, getMarketLocalLanguage, marketDefaultLanguage, resolveOutputLanguageName, type OutputLanguageChoice } from '../../lib/resumeLanguage';
import { ResumeFormatterDownloadGate } from './ResumeFormatterActions';
import { buildLinkedInContextFromFormattedResume } from '../../lib/toolPrefill';
import { LanguageSyncBanner } from '../LanguageSyncBanner';
import { useLocalization } from '../../hooks/useLocalization';
import { TOOL_CREDIT_COSTS } from '../../config/credits';
import {
  getResumeVersionDisplayLabel,
  getPreferredResumeFormatterVersion,
  getResumeFormatterVersions,
  getSavedResumeFormatterVersion,
  normalizeResumeVersionKey,
  removeResumeFormatterVersion,
  type ResumeFormatterSavedResult,
  upsertResumeFormatterVersion,
} from '../../lib/resumeFormatterVersions';

const MARKET_HINT_KEY: Record<string, string> = {
  'Canada':         'resume_market_hint_canada',
  'United States':  'resume_market_hint_united_states',
  'United Kingdom': 'resume_market_hint_united_kingdom',
  'Germany':        'resume_market_hint_germany',
  'France':         'resume_market_hint_france',
  'Japan':          'resume_market_hint_japan',
  'China':          'resume_market_hint_china',
  'Vietnam':        'resume_market_hint_vietnam',
  'Singapore':      'resume_market_hint_singapore',
  'Australia':      'resume_market_hint_australia',
};

// Maps the fixed English language NAME used by resumeLanguage.ts to the 2-letter
// code used by SUPPORTED_LANGUAGES (the language-sync UI codes).
const RESUME_LANG_NAME_TO_CODE: Record<string, string> = {
  German: 'de',
  French: 'fr',
  Japanese: 'ja',
  'Simplified Chinese': 'zh',
  Vietnamese: 'vi',
  Arabic: 'ar',
};

// The content language code of a stored/displayed version: English unless the
// version was generated in its market's distinct local language.
const resumeContentLangCode = (
  market: string | null | undefined,
  outputLanguage?: FormattedResume['outputLanguage'] | null,
): string => {
  if (outputLanguage === 'local') {
    const local = getMarketLocalLanguage(market ?? '');
    if (local) return RESUME_LANG_NAME_TO_CODE[local.name] ?? 'en';
  }
  return 'en';
};

// Reverse lookup: the market whose local language equals a UI language code
// (data-driven from resumeLanguage.ts so it stays in sync with the markets).
// Keeps `preferredMarket` when it already speaks the language, and otherwise
// prefers markets where the language is the professional norm over
// bilingual-but-English-first ones (e.g. 'fr' targets France, not Canada).
const marketForLocalLangCode = (code: string, preferredMarket?: string): string | null => {
  const languageName = Object.entries(RESUME_LANG_NAME_TO_CODE)
    .find(([, languageCode]) => languageCode === code)?.[0];
  return languageName ? getMarketForLocalLanguage(languageName, preferredMarket) : null;
};

// (b) sample cover letter — does NOT touch resumeText
const SAMPLE_COVER_LETTER =
  'Dear Hiring Manager,\n\nI am excited to apply for the Software Engineer role at Acme Corp. ' +
  'With 4 years of experience building scalable web applications using React and Node.js, ' +
  'I am confident I can contribute from day one.\n\nThank you for your consideration.\n\nSincerely,\nAlex Chen';

type ReadinessSeverity = 'pass' | 'review' | 'block';

type ReadinessItem = {
  id: string;
  label: string;
  description: string;
  severity: ReadinessSeverity;
};

const localizedCopy = (t: (key: string) => string, key: string, fallback: string): string => {
  const value = t(key);
  return value === key ? fallback : value;
};

const RESUME_FORMAT_ISSUE_LABELS: Record<string, { key: string; fallback: string }> = {
  empty: { key: 'quality_resume_empty', fallback: 'No resume content was generated.' },
  photo_placeholder: { key: 'quality_resume_photo_placeholder', fallback: 'A photo placeholder is still present.' },
  pipe_table: { key: 'quality_resume_pipe_table', fallback: 'A table-like layout is still present.' },
  no_sections: { key: 'quality_resume_no_sections', fallback: 'The resume did not split into clear sections.' },
  overlong_header: { key: 'quality_resume_overlong_header', fallback: 'The header area is still too dense.' },
  garbled_header: { key: 'quality_resume_garbled_header', fallback: 'Contact details are still mixed into the name/header.' },
  language_mismatch: { key: 'quality_resume_language_mismatch', fallback: 'The draft still contains too much content outside the selected output language.' },
};

const readinessRank: Record<ReadinessSeverity, number> = {
  pass: 0,
  review: 1,
  block: 2,
};

const getReadinessState = (items: ReadinessItem[]): 'ready' | 'review' | 'regenerate' => {
  const maxSeverity = items.reduce<ReadinessSeverity>((current, item) => (
    readinessRank[item.severity] > readinessRank[current] ? item.severity : current
  ), 'pass');
  if (maxSeverity === 'block') return 'regenerate';
  if (maxSeverity === 'review') return 'review';
  return 'ready';
};

const resumeIssueLabel = (issue: string, t: (key: string) => string): string => {
  const label = RESUME_FORMAT_ISSUE_LABELS[issue];
  if (!label) return issue.replace(/_/g, ' ');
  return localizedCopy(t, label.key, label.fallback);
};

const getBlockingIssueSummary = (issues: string[], t: (key: string) => string): string => {
  const blocking = issues.filter((issue) => issue !== 'sensitive_fields');
  if (blocking.length === 0) return localizedCopy(t, 'quality_resume_standard_sections', 'Standard sections and readable line breaks detected.');
  return blocking.map((issue) => resumeIssueLabel(issue, t)).join(' ');
};

const buildReadinessItems = (
  validation: ReturnType<typeof assessFormattedResume>,
  generatedMarket: string,
  targetMarket: string,
  marketStyle: ReturnType<typeof getResumeMarketStyle>,
  t: (key: string) => string,
): ReadinessItem[] => {
  const blockingIssues = validation.issues.filter((issue) => issue !== 'sensitive_fields');
  return [
    {
      id: 'market-style',
      label: localizedCopy(t, 'tool_resume_readiness_market_style', 'Market style'),
      description: `${t(marketStyle.labelKey)} · ${marketStyle.pageSize.toUpperCase()}`,
      severity: 'pass',
    },
    {
      id: 'structure',
      label: localizedCopy(t, 'tool_resume_readiness_structure', 'Document structure'),
      description: getBlockingIssueSummary(validation.issues, t),
      severity: blockingIssues.length > 0 ? 'block' : 'pass',
    },
    {
      id: 'privacy',
      label: localizedCopy(t, 'tool_resume_readiness_privacy', 'Privacy check'),
      description: validation.issues.includes('sensitive_fields')
        ? localizedCopy(t, 'tool_resume_readiness_privacy_review', 'Review personal fields such as birth date, nationality, gender, or visa status before sending.')
        : localizedCopy(t, 'tool_resume_readiness_privacy_pass', 'No obvious protected personal fields detected.'),
      severity: validation.issues.includes('sensitive_fields') ? 'review' : 'pass',
    },
    {
      id: 'target-market',
      label: localizedCopy(t, 'tool_resume_readiness_target', 'Current target'),
      description: targetMarket === generatedMarket
        ? localizedCopy(t, 'tool_resume_readiness_target_match', 'Download will match the generated {market} version.').replace('{market}', generatedMarket)
        : localizedCopy(t, 'tool_resume_readiness_target_mismatch', 'Preview is still {generatedMarket}. Generate again before downloading a {targetMarket} version.')
          .replace('{generatedMarket}', generatedMarket)
          .replace('{targetMarket}', targetMarket),
      severity: targetMarket === generatedMarket ? 'pass' : 'review',
    },
  ];
};

const readinessPanelTone = (state: ReturnType<typeof getReadinessState>): string => {
  if (state === 'regenerate') return 'border-amber-300 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-950/30';
  if (state === 'review') return 'border-blue-200 bg-blue-50/70 dark:border-blue-900/60 dark:bg-blue-950/30';
  return 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/25';
};

const readinessBadgeTone = (state: ReturnType<typeof getReadinessState>): string => {
  if (state === 'regenerate') return 'border-amber-200 bg-amber-100 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100';
  if (state === 'review') return 'border-blue-200 bg-blue-100 text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100';
  return 'border-emerald-200 bg-emerald-100 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100';
};

const readinessItemTone = (severity: ReadinessSeverity): string => {
  if (severity === 'block') return 'border-amber-200 bg-white text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100';
  if (severity === 'review') return 'border-blue-200 bg-white text-blue-900 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-100';
  return 'border-emerald-200 bg-white text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100';
};

interface ResumeFormatterProps {
  resumeText: string;
  initialInput?: string;
  market: string;
  onClose: () => void;
  openTool: (tool: string, input?: string) => void;
  t: (key: string) => string;
}

const ResumeFormatter: React.FC<ResumeFormatterProps> = ({ resumeText, initialInput = '', market, openTool, t }) => {
  const { currentLang } = useLocalization();
  const { loading, begin, end, cancel } = useCancellableLoading();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FormattedResume | null>(null);
  const { canSave, saved, saveState, persist, clear } = useToolResults<ResumeFormatterSavedResult>();
  const [fromSaved, setFromSaved] = useState(false);
  const [includeCoverLetter, setIncludeCoverLetter] = useState(false);
  const [coverLetterForFormatting, setCoverLetterForFormatting] = useState('');
  const [targetMarket, setTargetMarket] = useState<string>(market);
  const [outputLanguage, setOutputLanguage] = useState<OutputLanguageChoice>(
    () => marketDefaultLanguage(market),
  );
  const [coverLetterPrefillActive, setCoverLetterPrefillActive] = useState(false);
  const [langSyncDismissed, setLangSyncDismissed] = useState<string | null>(null);
  const consumedInitialInputRef = useRef('');
  const savedHydratedRef = useRef(false);

  const changeTargetMarket = (next: string) => {
    const nextLanguage = marketDefaultLanguage(next);
    setTargetMarket(next);
    setOutputLanguage(nextLanguage);
    const savedVersion = getSavedResumeFormatterVersion(saved?.result, next, nextLanguage);
    if (savedVersion) {
      setResult(savedVersion);
      setFromSaved(true);
      setError(null);
    }
  };

  const changeOutputLanguage = (next: OutputLanguageChoice) => {
    setOutputLanguage(next);
    const savedVersion = getSavedResumeFormatterVersion(saved?.result, targetMarket, next);
    if (savedVersion) {
      setResult(savedVersion);
      setFromSaved(true);
      setError(null);
    } else if (result) {
      setResult(null);
      setFromSaved(false);
    }
  };

  const hasResume = resumeText.trim().length > 0;

  useEffect(() => {
    if (initialInput.trim()) return;
    if (savedHydratedRef.current) return;
    if (!saved || result) return;
    const savedVersion = getPreferredResumeFormatterVersion(saved.result, targetMarket, outputLanguage);
    if (!savedVersion) {
      savedHydratedRef.current = true;
      return;
    }
    if (savedVersion.targetMarket) setTargetMarket(savedVersion.targetMarket);
    if (savedVersion.outputLanguage) setOutputLanguage(savedVersion.outputLanguage);
    setResult(savedVersion);
    setFromSaved(true);
    savedHydratedRef.current = true;
  }, [saved, result, initialInput, targetMarket]);

  useEffect(() => {
    const value = initialInput.trim();
    if (!value || consumedInitialInputRef.current === value) return;

    consumedInitialInputRef.current = value;
    setIncludeCoverLetter(true);
    setCoverLetterForFormatting(value);
    setCoverLetterPrefillActive(true);
    setResult(null);
    setFromSaved(false);
    setError(null);
  }, [initialInput]);

  const runTool = async (options: { coverLetter?: string; market?: string; outputLanguage?: OutputLanguageChoice } = {}) => {
    if (!resumeText?.trim()) {
      setError(t('tool_resume_required_error'));
      return;
    }
    // Overrides let the language-sync banner regenerate in a specific market/
    // language without waiting on async setState; default to the selected values.
    const runMarket = options.market ?? targetMarket;
    const runLanguage = options.outputLanguage ?? outputLanguage;
    const alive = begin();
    setError(null);
    setResult(null);
    setLangSyncDismissed(null);
    if (runMarket !== targetMarket) setTargetMarket(runMarket);
    if (runLanguage !== outputLanguage) setOutputLanguage(runLanguage);
    try {
      const languageName = resolveOutputLanguageName(runMarket, runLanguage);
      const apiResult = await convertResumeFormat(resumeText, runMarket, options.coverLetter, languageName);
      if (!alive()) return;
      const formattedText = cleanResumeDisplay(apiResult.formattedText);
      const normalizedResult = {
        ...apiResult,
        formattedText,
        targetMarket: runMarket,
        outputLanguage: runLanguage,
      };
      setResult(normalizedResult);
      setFromSaved(false);
      // Always persist: the run was charged, so even a draft the quality gate
      // flags must not be lost (the gate still shows its regenerate warning).
      persist(upsertResumeFormatterVersion(saved?.result, normalizedResult));
    } catch (err) {
      if (alive()) setError(err instanceof Error ? err.message : t('unexpected_error'));
    } finally {
      if (alive()) end();
    }
  };

  const renderLanguageToggle = (idSuffix: string) => {
    const localLang = getMarketLocalLanguage(targetMarket);
    if (!localLang) return null;
    return (
      <div className="mt-3">
        <label htmlFor={`output-language-${idSuffix}`} className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
          {t('resume_output_language_label')}
        </label>
        <select
          id={`output-language-${idSuffix}`}
          value={outputLanguage}
          onChange={(e) => changeOutputLanguage(e.target.value as OutputLanguageChoice)}
          className="mt-2 block min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-500 dark:focus:ring-blue-900/40"
          data-qa="resume-formatter-output-language"
          data-qa-output-language={outputLanguage}
        >
          <option value="local">{t(localLang.labelKey)}</option>
          <option value="en">{t('resume_lang_english')}</option>
        </select>
      </div>
    );
  };

  const renderInput = () => {
    const marketStyle = getResumeMarketStyle(targetMarket);
    return (
      <div className="animate-fade-in space-y-5">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-blue-700 dark:text-blue-300">
                <Globe2 className="h-4 w-4" aria-hidden="true" />
                {t('tool_resume_formatter_intro_title')}
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                {t('tool_resume_formatter_intro_desc')}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
              <FileText className="h-4 w-4 text-slate-400" aria-hidden="true" />
              {hasResume
                ? t('ob_resume_chars').replace('{n}', resumeText.trim().length.toLocaleString())
                : t('tool_resume_required_error')}
            </div>
          </div>
        </div>

        {!hasResume && (
          <ToolError message={t('tool_resume_required_error')} />
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300">
                <span className="text-sm font-bold">1</span>
              </div>
              <div className="min-w-0 flex-1">
                <label htmlFor="target-market" className="block text-sm font-semibold text-slate-950 dark:text-slate-100">
                  {t('tool_resume_formatter_target_market_label')}
                </label>
                <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                  {t('tool_resume_formatter_target_market_desc')}
                </p>
                <select
                  id="target-market"
                  value={targetMarket}
                  onChange={(e) => changeTargetMarket(e.target.value)}
                  className="mt-3 block min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-500 dark:focus:ring-blue-900/40"
                >
                  {SUPPORTED_MARKETS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                {renderLanguageToggle('input')}
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/70 p-3 dark:border-blue-900/50 dark:bg-blue-950/30">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-blue-700 dark:text-blue-300">
                <span>{t(marketStyle.labelKey)}</span>
                <span aria-hidden="true">·</span>
                <span>{marketStyle.pageSize.toUpperCase()}</span>
              </div>
              {MARKET_HINT_KEY[targetMarket] && (
                <p className="mt-2 text-sm leading-6 text-blue-950 dark:text-blue-100">{t(MARKET_HINT_KEY[targetMarket])}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {marketStyle.principleKeys.slice(0, 3).map((key) => (
                  <span key={key} className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-xs font-semibold text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
                    {t(key)}
                  </span>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <span className="text-sm font-bold">2</span>
              </div>
              <div className="min-w-0 flex-1">
                <label htmlFor="include-cover-letter" className="block text-sm font-semibold text-slate-950 dark:text-slate-100">
                  {t('tool_resume_formatter_include_cover_letter_label')}
                </label>
                <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                  {t('tool_resume_formatter_include_cover_letter_desc')}
                </p>
              </div>
              <input
                id="include-cover-letter"
                type="checkbox"
                checked={includeCoverLetter}
                onChange={(e) => setIncludeCoverLetter(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600"
              />
            </div>

            {includeCoverLetter ? (
              <div className="mt-4 animate-fade-in space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <label htmlFor="cover-letter-text" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      {t('tool_resume_formatter_cover_letter_label')}
                    </label>
                    {coverLetterPrefillActive && (
                      <p
                        data-qa="resume-formatter-prefill-note"
                        className="mt-1 text-xs font-medium text-blue-700 dark:text-blue-300"
                      >
                        {localizedCopy(t, 'tool_resume_formatter_prefill_label', 'Imported from Cover Letter')}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCoverLetterForFormatting(SAMPLE_COVER_LETTER);
                      setCoverLetterPrefillActive(false);
                    }}
                    className="shrink-0 text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {t('tool_try_example')}
                  </button>
                </div>
                <textarea
                  id="cover-letter-text"
                  data-qa="resume-formatter-cover-letter"
                  rows={8}
                  className="block w-full resize-y rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500 dark:focus:ring-blue-900/40"
                  placeholder={t('tool_resume_formatter_cover_letter_placeholder')}
                  value={coverLetterForFormatting}
                  onChange={(e) => {
                    setCoverLetterForFormatting(e.target.value);
                    setCoverLetterPrefillActive(false);
                  }}
                />
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
                {t('tool_resume_formatter_intro_desc')}
              </div>
            )}
          </section>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:flex sm:items-center sm:justify-between sm:gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <CheckCircle2 className={`h-4 w-4 ${hasResume ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-300 dark:text-slate-600'}`} aria-hidden="true" />
              {t('tool_resume_formatter_intro_title')}
            </div>
            <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">
              {MARKET_HINT_KEY[targetMarket] ? t(MARKET_HINT_KEY[targetMarket]) : t('tool_resume_formatter_target_market_desc')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => runTool({ coverLetter: includeCoverLetter ? coverLetterForFormatting : undefined })}
            data-qa="resume-formatter-generate"
            disabled={loading || !hasResume}
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-blue-300 disabled:text-white/90 dark:disabled:bg-blue-900/60 sm:mt-0 sm:w-auto"
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            {loading ? t('tool_resume_formatter_formatting_button') : t('tool_resume_formatter_format_button')}
          </button>
        </div>
      </div>
    );
  };

  const renderResult = () => {
    // (c) StagedLoader already has onCancel + icon + accent — preserved as-is
    if (loading) return (
      <StagedLoader
        title={localizedCopy(t, 'tool_resume_formatter_loader_title', 'Reformatting your resume')}
        steps={[
          localizedCopy(t, 'tool_resume_formatter_loader_step1', 'Reading your resume...'),
          localizedCopy(t, 'tool_resume_formatter_loader_step2', 'Reformatting the layout...'),
          localizedCopy(t, 'tool_resume_formatter_loader_step3', 'Polishing the final document...'),
        ]}
        onCancel={cancel}
        icon={<FileText />}
        accent="blue"
      />
    );

    // (e) ERROR RETRY
    if (error) return (
      <ToolError
        message={error}
        onRetry={() => runTool({ coverLetter: includeCoverLetter ? coverLetterForFormatting : undefined })}
        retryLabel={t('tool_try_again')}
      />
    );

    if (!result) return null;

    const formattedText = cleanResumeDisplay(result.formattedText);
    const generatedMarket = result.targetMarket || targetMarket;
    const marketStyle = getResumeMarketStyle(generatedMarket);
    const validation = assessFormattedResume(formattedText, { outputLanguage: resolveOutputLanguageName(generatedMarket, result.outputLanguage ?? outputLanguage) });
    const savedVersions = getResumeFormatterVersions(saved?.result, generatedMarket);
    const savedMarketNames = Array.from(new Set(Object.keys(savedVersions).map(getResumeVersionDisplayLabel)));
    const currentVersionKey = normalizeResumeVersionKey(generatedMarket, result.outputLanguage ?? outputLanguage);
    const currentVersionSaved = Boolean(savedVersions[currentVersionKey] ?? savedVersions[generatedMarket]);
    const readinessItems = buildReadinessItems(validation, generatedMarket, targetMarket, marketStyle, t);
    const readinessState = getReadinessState(readinessItems);
    const readinessHeadline = readinessState === 'ready'
      ? localizedCopy(t, 'tool_resume_readiness_ready_title', 'Ready to download')
      : readinessState === 'review'
        ? localizedCopy(t, 'tool_resume_readiness_review_title', 'Review before downloading')
        : localizedCopy(t, 'tool_resume_readiness_regenerate_title', 'Regenerate before downloading');
    const readinessBadge = readinessState === 'ready'
      ? localizedCopy(t, 'tool_resume_readiness_badge_ready', 'Ready')
      : readinessState === 'review'
        ? localizedCopy(t, 'tool_resume_readiness_badge_review', 'Review')
        : localizedCopy(t, 'tool_resume_readiness_badge_regenerate', 'Regenerate');

    // Language-sync nudge: the resume stays market-driven, but if the shown
    // version's content language differs from the UI language, offer to switch to
    // an already-stored version (free) or regenerate in the UI language (paid).
    const contentLang = resumeContentLangCode(generatedMarket, result.outputLanguage ?? outputLanguage);
    const availableLangs = Array.from(new Set(
      Object.values(getResumeFormatterVersions(saved?.result)).map((v) => resumeContentLangCode(v.targetMarket, v.outputLanguage)),
    ));
    const currentCoverLetter = includeCoverLetter ? coverLetterForFormatting : undefined;
    const switchToStoredLang = (lang: string) => {
      const matches = Object.values(getResumeFormatterVersions(saved?.result))
        .filter((v) => resumeContentLangCode(v.targetMarket, v.outputLanguage) === lang);
      const chosen = matches.find((v) => v.targetMarket === generatedMarket) ?? matches[0];
      if (!chosen) return;
      setResult(chosen);
      setFromSaved(true);
      setTargetMarket(chosen.targetMarket || targetMarket);
      setOutputLanguage(chosen.outputLanguage || marketDefaultLanguage(chosen.targetMarket || targetMarket));
      setError(null);
      setLangSyncDismissed(null);
    };
    const regenerateInLang = (lang: string) => {
      if (lang === 'en') {
        void runTool({ coverLetter: currentCoverLetter, market: generatedMarket, outputLanguage: 'en' });
        return;
      }
      const localMarket = marketForLocalLangCode(lang, generatedMarket);
      if (localMarket) void runTool({ coverLetter: currentCoverLetter, market: localMarket, outputLanguage: 'local' });
    };
    return (
      <div className="space-y-4 animate-fade-in">
        {langSyncDismissed !== currentLang && (
          <LanguageSyncBanner
            contentLang={contentLang}
            uiLang={currentLang}
            availableLangs={availableLangs}
            creditCost={TOOL_CREDIT_COSTS['resume-formatter']}
            canPersist={canSave}
            busy={loading}
            t={t}
            onSwitch={switchToStoredLang}
            onRegenerate={regenerateInLang}
            onDismiss={() => setLangSyncDismissed(currentLang)}
          />
        )}
        {validation.status !== 'needs_regen' && (
          <SavedResultBar
            t={t}
            canSave={canSave}
            isSaved={fromSaved}
            savedAt={saved?.savedAt ?? null}
            saveState={saveState}
            onTryNext={() => { setResult(null); setFromSaved(false); setError(null); }}
            onClearSaved={currentVersionSaved ? () => {
              const nextLibrary = removeResumeFormatterVersion(saved?.result, generatedMarket, result.outputLanguage ?? outputLanguage);
              if (!nextLibrary) {
                clear();
                setResult(null);
                setFromSaved(false);
                return;
              }
              persist(nextLibrary);
              const nextVersion = getPreferredResumeFormatterVersion(nextLibrary, targetMarket, outputLanguage);
              if (nextVersion) {
                setTargetMarket(nextVersion.targetMarket || targetMarket);
                setOutputLanguage(nextVersion.outputLanguage || marketDefaultLanguage(nextVersion.targetMarket || targetMarket));
                setResult(nextVersion);
                setFromSaved(true);
              } else {
                setResult(null);
                setFromSaved(false);
              }
            } : undefined}
          />
        )}

        {/* Post-generation validator gate: don't present a garbled/blob output as final. */}
        {validation.status === 'needs_regen' && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800/60 dark:bg-amber-950/30" role="alert">
            <div className="flex items-start gap-3">
              <Info className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">{t('tool_resume_formatter_regen_title')}</p>
                <p className="mt-0.5 text-sm leading-6 text-amber-800 dark:text-amber-200">{t('tool_resume_formatter_regen_desc')}</p>
                <button type="button"
                  onClick={() => runTool({ coverLetter: includeCoverLetter ? coverLetterForFormatting : undefined })}
                  disabled={loading}
                  className="mt-2 inline-flex min-h-9 items-center rounded-md bg-amber-600 px-3 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:opacity-50"
                >
                  {t('tool_resume_formatter_regen_cta')}
                </button>
              </div>
            </div>
          </div>
        )}
        {validation.status === 'warn' && validation.issues.includes('sensitive_fields') && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/20 dark:text-amber-200" role="note">
            {t('tool_resume_formatter_sensitive_note')}
          </p>
        )}

        {/* (d) DownloadButtons already present; "format for another market" button already present — preserved */}
        <div className="flex flex-wrap justify-between items-center gap-2">
          <div>
            <h4 className="text-lg font-bold dark:text-gray-100">{t('tool_resume_formatter_results_title')} {t('tool_resume_formatter_results_for').replace('{market}', generatedMarket)}</h4>
            {targetMarket !== generatedMarket && (
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {localizedCopy(t, 'tool_resume_formatter_preview_mismatch', 'Current preview is still the {generatedMarket} version. Generate again to create a {targetMarket} version.')
                  .replace('{generatedMarket}', generatedMarket)
                  .replace('{targetMarket}', targetMarket)}
              </p>
            )}
            {savedMarketNames.length > 1 && (
              <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                {localizedCopy(t, 'tool_resume_formatter_saved_versions', 'Saved versions: {markets}')
                  .replace('{markets}', savedMarketNames.join(', '))}
              </p>
            )}
          </div>
          <ResumeFormatterDownloadGate
            validation={validation}
            formattedText={formattedText}
            generatedMarket={generatedMarket}
            loading={loading}
            onRegenerate={() => runTool({ coverLetter: includeCoverLetter ? coverLetterForFormatting : undefined })}
            t={t}
          />
          <button
            type="button"
            data-qa="resume-formatter-open-linkedin"
            disabled={validation.status === 'needs_regen'}
            onClick={() => openTool('linkedin-optimizer', buildLinkedInContextFromFormattedResume({
              ...result,
              formattedText,
              targetMarket: generatedMarket,
            }, generatedMarket))}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Link2 className="h-4 w-4" aria-hidden="true" />
            {localizedCopy(t, 'tool_resume_formatter_open_linkedin_button', 'Optimize LinkedIn')}
          </button>
        </div>

        <section
          className={`rounded-xl border p-3 shadow-sm ${readinessPanelTone(readinessState)}`}
          data-qa="resume-formatter-readiness"
          data-qa-readiness-state={readinessState}
          aria-label={localizedCopy(t, 'tool_resume_readiness_aria', 'Resume download readiness')}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {readinessState === 'regenerate' ? (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
                ) : readinessState === 'review' ? (
                  <Info className="h-4 w-4 shrink-0 text-blue-700 dark:text-blue-300" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
                )}
                <p className="text-sm font-semibold text-slate-950 dark:text-slate-100">{readinessHeadline}</p>
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {readinessState === 'ready'
                  ? localizedCopy(t, 'tool_resume_readiness_ready_desc', 'This draft passed the format checks we can verify automatically.')
                  : localizedCopy(t, 'tool_resume_readiness_flagged_desc', 'The preview stays available, but resolve the flagged items before sending it to employers.')}
              </p>
            </div>
            <span className={`inline-flex w-fit shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${readinessBadgeTone(readinessState)}`}>
              {readinessBadge}
            </span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {readinessItems.map((item) => (
              <div
                key={item.id}
                className={`rounded-lg border px-3 py-2 ${readinessItemTone(item.severity)}`}
                data-qa="resume-formatter-readiness-item"
                data-qa-readiness-item={item.id}
                data-qa-readiness-severity={item.severity}
              >
                <div className="flex items-center gap-2">
                  {item.severity === 'block' ? (
                    <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  ) : item.severity === 'review' ? (
                    <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  )}
                  <p className="text-sm font-semibold">{item.label}</p>
                </div>
                <p className="mt-1 text-xs leading-5 opacity-80">{item.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Localization audit trail — each note maps one edit to the market
            convention it satisfies (returned by the model; absent on old saves). */}
        {result.changeNotes && result.changeNotes.length > 0 && (
          <details
            className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900"
            data-qa="resume-formatter-change-notes"
          >
            <summary className="cursor-pointer select-none text-sm font-semibold text-slate-800 dark:text-slate-200">
              {localizedCopy(t, 'tool_resume_formatter_change_notes_title', 'Localization notes — what was adapted for {market}')
                .replace('{market}', generatedMarket)}
            </summary>
            <ul className="mt-2 space-y-1.5">
              {result.changeNotes.map((note, i) => (
                <li key={i} className="flex items-start gap-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  <CheckCircle2 className="mt-1 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
          <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-3 dark:border-blue-900/60 dark:bg-blue-950/30">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-blue-700 dark:text-blue-300">
              <span>{t(marketStyle.labelKey)}</span>
              <span aria-hidden="true">·</span>
              <span>{marketStyle.pageSize.toUpperCase()}</span>
            </div>
            {MARKET_HINT_KEY[generatedMarket] && (
              <p className="mt-1 text-sm leading-6 text-blue-900 dark:text-blue-100">{t(MARKET_HINT_KEY[generatedMarket])}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {marketStyle.principleKeys.map((key) => (
                <span key={key} className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-xs font-medium text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
                  {t(key)}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <label htmlFor="result-target-market" className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
              {t('tool_resume_formatter_target_market_label')}
            </label>
            <select
              id="result-target-market"
              value={targetMarket}
              onChange={(e) => changeTargetMarket(e.target.value)}
              className="mt-2 block min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-500 dark:focus:ring-blue-900/40"
              data-qa="resume-formatter-result-market-select"
            >
              {SUPPORTED_MARKETS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            {renderLanguageToggle('result')}
            {getSavedResumeFormatterVersion(saved?.result, targetMarket, outputLanguage) && targetMarket !== generatedMarket && (
              <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-200">
                {localizedCopy(t, 'tool_resume_formatter_saved_market_hint', 'A saved {market} version is available and will load automatically.')
                  .replace('{market}', targetMarket)}
              </p>
            )}
            <button
              type="button"
              onClick={() => runTool({ coverLetter: includeCoverLetter ? coverLetterForFormatting : undefined })}
              disabled={loading || targetMarket === generatedMarket}
              className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 dark:disabled:bg-slate-800 dark:disabled:text-slate-400"
              data-qa="resume-formatter-regenerate-market"
            >
              {targetMarket === generatedMarket ? 'Current version' : `${t('tool_resume_formatter_format_button')} · ${targetMarket}`}
            </button>
            <button
              type="button"
              onClick={() => setResult(null)}
              className="mt-2 w-full rounded-lg border border-dashed border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              &larr; {t('tool_resume_formatter_localize_again')}
            </button>
          </div>
        </div>

        <ResumePreview resumeText={formattedText} market={generatedMarket} t={t} heightClassName="h-[560px] max-h-[72vh]" />
      </div>
    );
  };

  return (
    <div
      data-qa="resume-formatter"
      data-qa-resume-formatter-state={result ? 'result' : 'input'}
      data-qa-resume-formatter-market={targetMarket}
      data-qa-resume-formatter-generated-market={result?.targetMarket || ''}
    >
      {result ? renderResult() : renderInput()}
    </div>
  );
};

export default ResumeFormatter;
