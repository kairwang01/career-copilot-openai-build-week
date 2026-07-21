import React, { useState, useEffect, useRef } from 'react';
import { BriefcaseBusiness, Building2, CheckCircle2, CircleDollarSign, Mail, MessageSquareText, ShieldCheck, Target, TrendingUp, Wallet } from 'lucide-react';
import { generateSalaryNegotiationStrategy } from '../../services/aiClient';
import { safeHttpUrl } from '../../lib/safeUrl';
import type { SalaryNegotiationResult } from '../../types';
import StagedLoader from '../StagedLoader';
import { useCancellableLoading } from '../../hooks/useCancellableLoading';
import { SavedResultBar, ToolError } from './ToolUtils';
import { useToolResults } from '../../contexts/ToolResultsContext';
import {
  assessSalaryNegotiation,
  buildSalaryDownloadText,
  canExportSalaryNegotiation,
  SalaryCopyGate,
  SalaryExportGate,
  SalaryQualityNotice,
} from './SalaryActions';
import { buildEmailContextFromSalaryNegotiation, parseToolSalaryContext, type ToolSalaryContext } from '../../lib/toolPrefill';

type GroundingChunk = { web?: { uri?: string; title?: string } };
type SalaryResult = Partial<SalaryNegotiationResult> & {
  groundingChunks?: GroundingChunk[];
  jobTitle?: string;
  company?: string;
  offer?: string;
  currency?: string;
  market?: string;
};

const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'JPY', 'SGD', 'AED'];
const MAX_OFFER_AMOUNT = 1_000_000_000;
const MAX_SHORT_INPUT_LENGTH = 200;
const MAX_RESULT_TEXT_LENGTH = 8_000;

const SAMPLE_JOB_TITLE = 'Senior Software Engineer';
const SAMPLE_COMPANY = 'Shopify';
const SAMPLE_OFFER = '110000';
const SAMPLE_CURRENCY = 'CAD';

interface SalaryNegotiatorProps {
  resumeText: string;
  initialInput?: string;
  openTool?: (tool: string, input?: string) => void;
  market: string;
  t: (key: string) => string;
}

const CardShell: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <section className={`rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}>
    {children}
  </section>
);

const MetricTile: React.FC<{ label: string; value: string | number; icon: React.ElementType }> = ({ label, value, icon: Icon }) => (
  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
    <div className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400">
      <Icon className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />
      {label}
    </div>
    <p className="mt-3 break-words text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">{value}</p>
  </div>
);

const formatMoney = (value: number, currencyCode: string) => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode, minimumFractionDigits: 0 }).format(value);
  } catch {
    return `${currencyCode} ${Math.round(value).toLocaleString()}`;
  }
};

const boundedText = (value: unknown, maxLength = MAX_RESULT_TEXT_LENGTH) =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const boundedTextArray = (value: unknown, maxItems = 20) =>
  Array.isArray(value)
    ? value.slice(0, maxItems).map((item) => boundedText(item)).filter(Boolean)
    : [];

const normalizeSalaryResult = (value: unknown): SalaryResult | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const rangeRaw = raw.recommendedRange && typeof raw.recommendedRange === 'object'
    ? raw.recommendedRange as Record<string, unknown>
    : null;
  const rangeMin = Number(rangeRaw?.baseMin);
  const rangeMax = Number(rangeRaw?.baseMax);
  const recommendedRange = rangeRaw
    && Number.isFinite(rangeMin)
    && Number.isFinite(rangeMax)
    && rangeMin > 0
    && rangeMax > 0
    && rangeMin <= rangeMax
    ? {
      baseMin: rangeMin,
      baseMax: rangeMax,
      currency: boundedText(rangeRaw.currency, 12),
      explanation: boundedText(rangeRaw.explanation),
    }
    : undefined;
  const objectionHandlers = Array.isArray(raw.objectionHandlers)
    ? raw.objectionHandlers
      .slice(0, 20)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const objection = boundedText((item as Record<string, unknown>).objection);
        const response = boundedText((item as Record<string, unknown>).response);
        return objection || response ? { objection, response } : null;
      })
      .filter((item): item is { objection: string; response: string } => item !== null)
    : [];
  const groundingChunks = Array.isArray(raw.groundingChunks)
    ? raw.groundingChunks
      .slice(0, 12)
      .map((item): GroundingChunk | null => {
        if (!item || typeof item !== 'object') return null;
        const web = (item as { web?: unknown }).web;
        if (!web || typeof web !== 'object') return null;
        const uri = safeHttpUrl(boundedText((web as Record<string, unknown>).uri, 2_048));
        if (!uri) return null;
        return { web: { uri, title: boundedText((web as Record<string, unknown>).title, 300) } };
      })
      .filter((item): item is GroundingChunk => item !== null)
    : [];
  const result: SalaryResult = {
    marketAnalysisSummary: boundedText(raw.marketAnalysisSummary),
    recommendedRange,
    keyStrengths: boundedTextArray(raw.keyStrengths),
    negotiationStrategy: boundedTextArray(raw.negotiationStrategy),
    counterOfferEmailDraft: boundedText(raw.counterOfferEmailDraft),
    objectionHandlers,
    groundingChunks,
    jobTitle: boundedText(raw.jobTitle, MAX_SHORT_INPUT_LENGTH),
    company: boundedText(raw.company, MAX_SHORT_INPUT_LENGTH),
    offer: boundedText(raw.offer, 40),
    currency: boundedText(raw.currency, 12),
    market: boundedText(raw.market, MAX_SHORT_INPUT_LENGTH),
  };
  return result.marketAnalysisSummary
    || result.recommendedRange
    || result.keyStrengths?.length
    || result.negotiationStrategy?.length
    || result.counterOfferEmailDraft
    || result.objectionHandlers?.length
    ? result
    : null;
};

const isSupportedCurrency = (value: string | undefined): value is string => Boolean(value && CURRENCIES.includes(value));

const SalaryNegotiator: React.FC<SalaryNegotiatorProps> = ({ resumeText, initialInput = '', openTool, market, t }) => {
  const { loading, begin, end, cancel } = useCancellableLoading();
  const { canSave, saved, saveState, persist, clear } = useToolResults<SalaryResult>();
  const consumedInitialInputRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SalaryResult | null>(null);
  const [fromSaved, setFromSaved] = useState(false);
  const [jobTitle, setJobTitle] = useState('');
  const [company, setCompany] = useState('');
  const [offer, setOffer] = useState('');
  const [currency, setCurrency] = useState(CURRENCIES[1]);
  const [prefillContext, setPrefillContext] = useState<ToolSalaryContext | null>(null);

  useEffect(() => {
    if (initialInput.trim()) return;
    const normalized = saved && !result ? normalizeSalaryResult(saved.result) : null;
    if (normalized && canExportSalaryNegotiation(assessSalaryNegotiation(normalized))) {
      setResult(normalized);
      setFromSaved(true);
      if (normalized.jobTitle) setJobTitle(normalized.jobTitle);
      if (normalized.company) setCompany(normalized.company);
      if (normalized.offer) setOffer(normalized.offer);
      if (isSupportedCurrency(normalized.currency)) setCurrency(normalized.currency);
    }
  }, [saved, initialInput]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const value = initialInput.trim().slice(0, 4_000);
    if (!value || consumedInitialInputRef.current === value) return;

    const context = parseToolSalaryContext(value);
    if (!context.jobTitle && !context.company && !context.offer && !context.currency) return;

    consumedInitialInputRef.current = value;
    if (context.jobTitle) setJobTitle(context.jobTitle.slice(0, MAX_SHORT_INPUT_LENGTH));
    if (context.company) setCompany(context.company.slice(0, MAX_SHORT_INPUT_LENGTH));
    if (context.offer) setOffer(context.offer.slice(0, 40));
    if (isSupportedCurrency(context.currency)) setCurrency(context.currency);
    setPrefillContext(context);
    setResult(null);
    setFromSaved(false);
    setError(null);
  }, [initialInput]);

  const resetResult = () => {
    setResult(null);
    setFromSaved(false);
    setError(null);
  };

  const handleTryExample = () => {
    setJobTitle(SAMPLE_JOB_TITLE);
    setCompany(SAMPLE_COMPANY);
    setOffer(SAMPLE_OFFER);
    setCurrency(SAMPLE_CURRENCY);
    setPrefillContext(null);
  };

  const runTool = async (input: { jobTitle: string; company: string; offer: string; currency: string }) => {
    const nextJobTitle = input.jobTitle.trim().slice(0, MAX_SHORT_INPUT_LENGTH);
    const nextCompany = input.company.trim().slice(0, MAX_SHORT_INPUT_LENGTH);
    const nextOffer = input.offer.trim().slice(0, 40);
    const nextCurrency = input.currency.trim();
    if (!nextJobTitle || !nextCompany || !nextOffer || !nextCurrency) {
      setError(t('tool_salary_negotiator_error_required'));
      return;
    }
    const offerAmount = Number(nextOffer);
    if (!Number.isFinite(offerAmount) || offerAmount <= 0 || offerAmount > MAX_OFFER_AMOUNT || !isSupportedCurrency(nextCurrency)) {
      setError(t('tool_salary_negotiator_error_required'));
      return;
    }
    if (!resumeText.trim()) {
      setError(t('tool_resume_required_error'));
      return;
    }

    setJobTitle(nextJobTitle);
    setCompany(nextCompany);
    setOffer(nextOffer);
    setCurrency(nextCurrency);

    const alive = begin();
    setError(null);
    setResult(null);
    try {
      const apiResult = normalizeSalaryResult(
        await generateSalaryNegotiationStrategy(resumeText, nextJobTitle, nextCompany, market, nextOffer, nextCurrency),
      );
      if (!alive()) return;
      if (!apiResult) {
        throw new Error(t('ai_error_empty_response'));
      }
      const nextResult: SalaryResult = {
        ...apiResult,
        jobTitle: nextJobTitle,
        company: nextCompany,
        offer: nextOffer,
        currency: nextCurrency,
        market,
      };
      const validation = assessSalaryNegotiation(nextResult);
      setResult(nextResult);
      setFromSaved(false);
      if (canExportSalaryNegotiation(validation)) {
        persist(nextResult);
      }
    } catch (err) {
      if (alive()) setError(err instanceof Error ? err.message : t('unexpected_error'));
    } finally {
      if (alive()) end();
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void runTool({ jobTitle, company, offer, currency });
  };

  const renderInput = () => (
    <div data-qa="salary-negotiator-tool" data-qa-tool-state="input" className="mx-auto max-w-6xl space-y-5">
      <CardShell className="overflow-hidden">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_380px]">
          <form onSubmit={handleSubmit} className="min-w-0 p-5 sm:p-6 lg:p-8">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700 dark:text-emerald-300">
              <Wallet className="h-4 w-4" />
              {t('tool_salary_negotiation_title')}
            </div>
            <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100 sm:text-3xl">
              {t('tool_salary_negotiator_intro_title')}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              {t('tool_salary_negotiator_intro_desc')}
            </p>

            {prefillContext && (
              <div
                data-qa="salary-negotiator-prefill-note"
                className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100"
              >
                <p className="font-semibold">{t('tool_salary_negotiator_prefill_label')}</p>
                {prefillContext.salaryRange && (
                  <p className="mt-1 leading-relaxed text-emerald-800 dark:text-emerald-200">
                    {t('tool_salary_negotiator_prefill_range').replace('{range}', prefillContext.salaryRange)}
                  </p>
                )}
              </div>
            )}

            <div className="mt-7 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="salary-job-title" className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {t('tool_salary_negotiator_job_title_label')}
                </label>
                <div className="relative mt-2">
                  <BriefcaseBusiness className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    data-qa="salary-job-title"
                    type="text"
                    id="salary-job-title"
                    value={jobTitle}
                    onChange={(event) => { setJobTitle(event.target.value); setPrefillContext(null); }}
                    maxLength={MAX_SHORT_INPUT_LENGTH}
                    required
                    className="block min-h-[48px] w-full rounded-lg border border-slate-300 bg-white py-3 pl-10 pr-4 text-base text-slate-950 shadow-sm transition placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label htmlFor="salary-company" className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {t('tool_salary_negotiator_company_label')}
                  </label>
                  <button
                    type="button"
                    data-qa="salary-negotiator-try-example"
                    onClick={handleTryExample}
                    className="min-h-11 px-2 text-sm font-semibold text-emerald-700 transition hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
                  >
                    {t('tool_try_example')}
                  </button>
                </div>
                <div className="relative">
                  <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    data-qa="salary-company"
                    type="text"
                    id="salary-company"
                    value={company}
                    onChange={(event) => { setCompany(event.target.value); setPrefillContext(null); }}
                    maxLength={MAX_SHORT_INPUT_LENGTH}
                    required
                    className="block min-h-[48px] w-full rounded-lg border border-slate-300 bg-white py-3 pl-10 pr-4 text-base text-slate-950 shadow-sm transition placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="salary-offer" className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {t('tool_salary_negotiator_offer_label')}
                </label>
                <div className="relative mt-2">
                  <CircleDollarSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    data-qa="salary-offer"
                    type="number"
                    id="salary-offer"
                    value={offer}
                    onChange={(event) => { setOffer(event.target.value); setPrefillContext(null); }}
                    min={1}
                    max={MAX_OFFER_AMOUNT}
                    step={1}
                    required
                    placeholder={t('tool_salary_negotiator_offer_placeholder')}
                    className="block min-h-[48px] w-full rounded-lg border border-slate-300 bg-white py-3 pl-10 pr-4 text-base text-slate-950 shadow-sm transition placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="salary-currency" className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {t('tool_salary_negotiator_currency_label')}
                </label>
                <select
                  data-qa="salary-currency"
                  id="salary-currency"
                  value={currency}
                  onChange={(event) => { setCurrency(event.target.value); setPrefillContext(null); }}
                  className="mt-2 block min-h-[48px] w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-950 shadow-sm transition focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  {CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
                </select>
              </div>
            </div>

            {error && (
              <div className="mt-5">
                <ToolError
                  message={error}
                  onRetry={() => void runTool({ jobTitle, company, offer, currency })}
                  retryLabel={t('tool_try_again')}
                  retryDisabled={loading}
                />
              </div>
            )}

            <button
              data-qa="salary-negotiator-generate"
              type="submit"
              disabled={loading}
              className="mt-5 inline-flex min-h-[48px] w-full items-center justify-center rounded-lg bg-emerald-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-400"
            >
              {loading ? t('tool_salary_negotiator_generating_button') : t('tool_salary_negotiator_generate_button')}
            </button>
          </form>

          <aside className="border-t border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950/40 sm:p-6 lg:border-l lg:border-t-0">
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4 text-emerald-950 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100">
              <div className="flex items-start gap-3">
                <Target className="mt-0.5 h-5 w-5 shrink-0" />
                <p className="text-sm font-semibold leading-relaxed">{t('tool_salary_negotiator_setup_desc')}</p>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {[
                t('tool_salary_negotiator_market_analysis'),
                t('tool_salary_negotiator_recommended_range'),
                t('tool_salary_negotiator_email_draft'),
                t('tool_salary_negotiator_objections'),
              ].map((label, index) => (
                <div key={label} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {index + 1}
                  </span>
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{label}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </CardShell>
    </div>
  );

  const renderResult = () => {
    if (!result) return null;

    const {
      marketAnalysisSummary = '',
      recommendedRange,
      keyStrengths = [],
      negotiationStrategy = [],
      counterOfferEmailDraft = '',
      objectionHandlers = [],
      groundingChunks,
    } = result;
    const strengths = Array.isArray(keyStrengths) ? keyStrengths : [];
    const strategySteps = Array.isArray(negotiationStrategy) ? negotiationStrategy : [];
    const objections = Array.isArray(objectionHandlers) ? objectionHandlers : [];

    const resultCurrency = result.currency || recommendedRange?.currency || currency;
    const resultOffer = result.offer || offer;
    const offerNumber = Number(resultOffer);
    const offerLabel = Number.isFinite(offerNumber) && offerNumber > 0
      ? formatMoney(offerNumber, resultCurrency)
      : `${resultCurrency} ${resultOffer || '-'}`;
    const rangeLabel = recommendedRange
      ? `${formatMoney(recommendedRange.baseMin, recommendedRange.currency || resultCurrency)} - ${formatMoney(recommendedRange.baseMax, recommendedRange.currency || resultCurrency)}`
      : '-';
    const job = result.jobTitle || jobTitle || t('tool_salary_negotiator_job_title_label');
    const employer = result.company || company || t('tool_salary_negotiator_company_label');
    const validation = assessSalaryNegotiation(result);

    const downloadText = buildSalaryDownloadText(
      result,
      {
        title: t('tool_salary_negotiator_results_title'),
        offer: t('tool_salary_negotiator_offer_label'),
        marketAnalysis: t('tool_salary_negotiator_market_analysis'),
        recommendedRange: t('tool_salary_negotiator_recommended_range'),
        keyStrengths: t('tool_salary_negotiator_key_strengths'),
        strategy: t('tool_salary_negotiator_strategy'),
        emailDraft: t('tool_salary_negotiator_email_draft'),
        objections: t('tool_salary_negotiator_objections'),
      },
      { job, employer, offerLabel, rangeLabel },
    );
    const emailHandoffContext = buildEmailContextFromSalaryNegotiation({
      jobTitle: job,
      company: employer,
      offerLabel,
      targetRangeLabel: rangeLabel,
      counterOfferEmailDraft,
      marketAnalysisSummary,
    });

    return (
      <div data-qa="salary-negotiator-tool" data-qa-tool-state="result" className="mx-auto max-w-7xl space-y-5 break-words animate-fade-in">
        {canExportSalaryNegotiation(validation) && (
          <SavedResultBar
            t={t}
            canSave={canSave}
            isSaved={fromSaved}
            savedAt={saved?.savedAt ?? null}
            saveState={saveState}
            onTryNext={resetResult}
            onClearSaved={() => { clear(); setFromSaved(false); }}
          />
        )}
        <SalaryQualityNotice validation={validation} />

        <CardShell className="overflow-hidden">
          <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-w-0 p-5 sm:p-6">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700 dark:text-emerald-300">
                <Wallet className="h-4 w-4" />
                {t('tool_salary_negotiator_results_title')}
              </div>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100 sm:text-3xl">
                {job}
              </h2>
              <p className="mt-2 text-sm font-medium text-slate-600 dark:text-slate-400">{employer}</p>
              <p className="mt-4 max-w-4xl text-base leading-relaxed text-slate-700 dark:text-slate-300">{marketAnalysisSummary}</p>
            </div>
            <div className="border-t border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950/40 sm:p-6 xl:border-l xl:border-t-0">
              <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                <MetricTile label={t('tool_salary_negotiator_offer_label')} value={offerLabel} icon={CircleDollarSign} />
                <MetricTile label={t('tool_salary_negotiator_recommended_range')} value={rangeLabel} icon={TrendingUp} />
                <MetricTile label={t('tool_salary_negotiator_strategy')} value={strategySteps.length} icon={ShieldCheck} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <SalaryExportGate
                  validation={validation}
                  text={downloadText}
                  baseFilename={`salary_negotiation_${employer.replace(/\s/g, '_')}`}
                  regenerateLabel={t('tool_salary_negotiator_generate_button')}
                  onRegenerate={() => void runTool({ jobTitle: job, company: employer, offer: resultOffer, currency: resultCurrency })}
                />
                <button
                  type="button"
                  onClick={resetResult}
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {t('tool_start_over')}
                </button>
              </div>
            </div>
          </div>
        </CardShell>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-5">
            {recommendedRange && (
              <CardShell className="p-5">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-emerald-700 dark:text-emerald-300" />
                  <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{t('tool_salary_negotiator_recommended_range')}</h3>
                </div>
                <p className="mt-4 break-words text-3xl font-semibold tracking-tight text-emerald-800 dark:text-emerald-200">{rangeLabel}</p>
                <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{recommendedRange.explanation}</p>
              </CardShell>
            )}

            <CardShell className="p-5">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-700 dark:text-emerald-300" />
                <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{t('tool_salary_negotiator_strategy')}</h3>
              </div>
              <div className="mt-4 space-y-3">
                {strategySteps.map((step, index) => (
                  <div key={index} className="flex gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-700 text-xs font-semibold text-white">
                      {index + 1}
                    </span>
                    <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{step}</p>
                  </div>
                ))}
              </div>
            </CardShell>

            <CardShell className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <MessageSquareText className="h-5 w-5 text-emerald-700 dark:text-emerald-300" />
                  <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{t('tool_salary_negotiator_email_draft')}</h3>
                </div>
                <SalaryCopyGate
                  validation={validation}
                  text={counterOfferEmailDraft}
                  label={t('tool_networking_assistant_copy_button')}
                />
                {openTool && counterOfferEmailDraft.trim() && (
                  <button
                    type="button"
                    data-qa="salary-open-email-crafter"
                    onClick={() => openTool('email-crafter', emailHandoffContext)}
                    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    <Mail className="h-4 w-4" aria-hidden="true" />
                    {t('tool_salary_negotiator_draft_email_button')}
                  </button>
                )}
              </div>
              <div className="mt-4 whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                {counterOfferEmailDraft}
              </div>
            </CardShell>
          </div>

          <div className="space-y-5">
            <CardShell className="p-5">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-700 dark:text-emerald-300" />
                <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{t('tool_salary_negotiator_key_strengths')}</h3>
              </div>
              <ul className="mt-4 space-y-3">
                {strengths.map((strength, index) => (
                  <li key={index} className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm leading-relaxed text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-200">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" />
                    <span>{strength}</span>
                  </li>
                ))}
              </ul>
            </CardShell>

            <CardShell className="p-5">
              <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{t('tool_salary_negotiator_objections')}</h3>
              <div className="mt-4 space-y-3">
                {objections.map((item, index) => (
                  <details key={index} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60" open={index === 0}>
                    <summary className="cursor-pointer text-sm font-semibold text-slate-900 dark:text-slate-100">{item.objection}</summary>
                    <p className="mt-3 border-l-2 border-emerald-300 pl-3 text-sm leading-relaxed text-slate-600 dark:border-emerald-700 dark:text-slate-300">{item.response}</p>
                  </details>
                ))}
              </div>
            </CardShell>

            {groundingChunks?.some((chunk) => chunk.web) && (
              <CardShell className="p-5">
                <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-100">{t('tool_salary_negotiator_sources')}</h3>
                <ul className="mt-3 space-y-2 text-sm">
                  {groundingChunks.filter((chunk) => chunk.web?.uri).map((chunk, index) => (
                    <li key={index}>
                      <a href={chunk.web?.uri} target="_blank" rel="noopener noreferrer" className="break-words text-emerald-700 hover:underline dark:text-emerald-300">
                        {chunk.web?.title || chunk.web?.uri}
                      </a>
                    </li>
                  ))}
                </ul>
              </CardShell>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={resetResult}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {t('tool_start_over')}
        </button>
      </div>
    );
  };

  if (loading) {
    return (
      <StagedLoader
        title={t('tool_salary_negotiator_generating_button')}
        steps={[
          t('tool_salary_negotiator_market_analysis'),
          t('tool_salary_negotiator_recommended_range'),
          t('tool_salary_negotiator_strategy'),
          t('tool_salary_negotiator_email_draft'),
        ]}
        onCancel={cancel}
        cancelLabel={t('tool_loader_hide_button')}
        cancelHint={t('tool_loader_hide_hint')}
        icon={<Wallet />}
        accent="emerald"
      />
    );
  }

  return result ? renderResult() : renderInput();
};

export default SalaryNegotiator;
