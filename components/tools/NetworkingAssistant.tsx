import React, { useState, useMemo, useEffect, useRef } from 'react';
import { BriefcaseBusiness, Building2, Mail, MapPin, MessageSquareText, Target, Users } from 'lucide-react';
import { generateNetworkingStrategy } from '../../services/aiClient';
import type { NetworkingStrategyResult } from '../../types';
import StagedLoader from '../StagedLoader';
import { useCancellableLoading } from '../../hooks/useCancellableLoading';
import { SavedResultBar, ToolError } from './ToolUtils';
import { useToolResults } from '../../contexts/ToolResultsContext';
import { deriveSmartSuggestions, SmartSuggestChips } from '../SmartSuggest';
import { buildEmailContextFromNetworkingSuggestion, parseToolJobContext } from '../../lib/toolPrefill';
import {
  assessNetworkingStrategy,
  buildNetworkingDownloadText,
  canExportNetworkingStrategy,
  NetworkingCopyGate,
  NetworkingExportGate,
  NetworkingQualityNotice,
} from './NetworkingActions';

interface NetworkingAssistantProps {
  resumeText: string;
  initialInput?: string;
  openTool: (tool: string, input?: string) => void;
  market: string;
  t: (key: string) => string;
}

type SavedNetworkingStrategyResult = NetworkingStrategyResult & {
  targetCompany?: string;
  targetRole?: string;
  targetLocation?: string;
};

const SAMPLE_COMPANY = 'Shopify';
const SAMPLE_ROLE = 'Senior Software Engineer';
const SAMPLE_LOCATION = 'Ottawa, ON';
const MAX_TARGET_INPUT_LENGTH = 200;
const MAX_RESULT_TEXT_LENGTH = 8_000;

const boundedText = (value: unknown, maxLength = MAX_RESULT_TEXT_LENGTH) =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const normalizeNetworkingResult = (value: unknown): NetworkingStrategyResult | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const contactSuggestions = Array.isArray(raw.contactSuggestions)
    ? raw.contactSuggestions
      .slice(0, 20)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const contactType = boundedText((item as Record<string, unknown>).contactType, 500);
        const reason = boundedText((item as Record<string, unknown>).reason);
        const outreachMessage = boundedText((item as Record<string, unknown>).outreachMessage);
        return contactType || reason || outreachMessage ? { contactType, reason, outreachMessage } : null;
      })
      .filter((item): item is NetworkingStrategyResult['contactSuggestions'][number] => item !== null)
    : [];
  const result: NetworkingStrategyResult = {
    strategySummary: boundedText(raw.strategySummary),
    contactSuggestions,
  };
  return result.strategySummary || result.contactSuggestions.length ? result : null;
};

const localizedCopy = (t: (key: string) => string, key: string, fallback: string): string => {
  const value = t(key);
  return value === key ? fallback : value;
};

const CardShell: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <section className={`rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}>
    {children}
  </section>
);

const MetricTile: React.FC<{ label: string; value: string | number; icon: React.ElementType }> = ({ label, value, icon: Icon }) => (
  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
    <div className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400">
      <Icon className="h-4 w-4 text-sky-700 dark:text-sky-300" />
      {label}
    </div>
    <p className="mt-3 break-words text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">{value}</p>
  </div>
);

const NetworkingAssistant: React.FC<NetworkingAssistantProps> = ({ resumeText, initialInput = '', openTool, market, t }) => {
  const { loading, begin, end, cancel } = useCancellableLoading();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SavedNetworkingStrategyResult | null>(null);
  const { canSave, saved, saveState, persist, clear } = useToolResults<SavedNetworkingStrategyResult>();
  const [fromSaved, setFromSaved] = useState(false);
  const [targetCompany, setTargetCompany] = useState('');
  const [targetRole, setTargetRole] = useState('');
  const [targetLocation, setTargetLocation] = useState('');
  const [prefillActive, setPrefillActive] = useState(false);
  const consumedInitialInputRef = useRef('');

  const suggestions = useMemo(() => deriveSmartSuggestions(resumeText), [resumeText]);

  useEffect(() => {
    if (initialInput.trim()) return;
    const normalized = saved && !result ? normalizeNetworkingResult(saved.result) : null;
    if (normalized && canExportNetworkingStrategy(assessNetworkingStrategy(normalized))) {
      const nextResult: SavedNetworkingStrategyResult = {
        ...normalized,
        targetCompany: boundedText(saved?.result.targetCompany, MAX_TARGET_INPUT_LENGTH),
        targetRole: boundedText(saved?.result.targetRole, MAX_TARGET_INPUT_LENGTH),
        targetLocation: boundedText(saved?.result.targetLocation, MAX_TARGET_INPUT_LENGTH),
      };
      setResult(nextResult);
      setFromSaved(true);
      if (nextResult.targetCompany) setTargetCompany(nextResult.targetCompany);
      if (nextResult.targetRole) setTargetRole(nextResult.targetRole);
      if (nextResult.targetLocation) setTargetLocation(nextResult.targetLocation);
    }
  }, [saved, result, initialInput]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const value = initialInput.trim().slice(0, 20_000);
    if (!value || consumedInitialInputRef.current === value) return;

    const context = parseToolJobContext(value);
    if (!context.jobTitle && !context.company && !context.location) return;

    consumedInitialInputRef.current = value;
    if (context.company) setTargetCompany(context.company.slice(0, MAX_TARGET_INPUT_LENGTH));
    if (context.jobTitle) setTargetRole(context.jobTitle.slice(0, MAX_TARGET_INPUT_LENGTH));
    if (context.location) setTargetLocation(context.location.slice(0, MAX_TARGET_INPUT_LENGTH));
    setPrefillActive(true);
    setResult(null);
    setFromSaved(false);
    setError(null);
  }, [initialInput]);

  const resetResult = () => {
    setResult(null);
    setFromSaved(false);
    setError(null);
  };

  const fillExample = () => {
    setTargetCompany(SAMPLE_COMPANY);
    setTargetRole(SAMPLE_ROLE);
    setTargetLocation(SAMPLE_LOCATION);
    setPrefillActive(false);
  };

  const runTool = async (companyInput: string, roleInput: string, locationInput: string) => {
    const company = companyInput.trim().slice(0, MAX_TARGET_INPUT_LENGTH);
    const role = roleInput.trim().slice(0, MAX_TARGET_INPUT_LENGTH);
    const location = locationInput.trim().slice(0, MAX_TARGET_INPUT_LENGTH);
    if (!company || !role || !location) {
      setError(t('tool_networking_assistant_error_required'));
      return;
    }
    if (!resumeText.trim()) {
      setError(t('tool_resume_required_error'));
      return;
    }

    setTargetCompany(company);
    setTargetRole(role);
    setTargetLocation(location);

    const alive = begin();
    setError(null);
    setResult(null);
    try {
      const apiResult = normalizeNetworkingResult(
        await generateNetworkingStrategy(resumeText, company, role, location, market),
      );
      if (!alive()) return;
      if (!apiResult) throw new Error(t('ai_error_empty_response'));
      const nextResult: SavedNetworkingStrategyResult = {
        ...apiResult,
        targetCompany: company,
        targetRole: role,
        targetLocation: location,
      };
      const validation = assessNetworkingStrategy(nextResult);
      setResult(nextResult);
      setFromSaved(false);
      if (canExportNetworkingStrategy(validation)) {
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
    void runTool(targetCompany, targetRole, targetLocation);
  };

  const formatForDownload = (res: SavedNetworkingStrategyResult): string => {
    return buildNetworkingDownloadText(
      res,
      {
        strategy: t('tool_networking_assistant_approach_label'),
        contacts: t('tool_networking_assistant_contact_label'),
        why: t('tool_networking_assistant_why_contact_label'),
        outreach: t('tool_networking_assistant_draft_label'),
      },
      {
        company: targetCompany || t('tool_networking_assistant_company_label'),
        role: targetRole || t('tool_networking_assistant_role_label'),
        location: targetLocation || t('tool_networking_assistant_location_label'),
      },
    );
  };

  const renderInput = () => (
    <div data-qa="networking-assistant-tool" data-qa-tool-state="input" className="mx-auto max-w-6xl space-y-5">
      <CardShell className="overflow-hidden">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_380px]">
          <form onSubmit={handleSubmit} className="min-w-0 p-5 sm:p-6 lg:p-8">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-sky-700 dark:text-sky-300">
              <Users className="h-4 w-4" />
              {t('tool_networking_assistant_title')}
            </div>
            <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100 sm:text-3xl">
              {t('tool_networking_intro_line1')}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              {t('tool_networking_intro_line2')}
            </p>

            <div className="mt-7 grid gap-4 sm:grid-cols-2">
              {prefillActive && (
                <div
                  data-qa="networking-assistant-prefill-note"
                  className="sm:col-span-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200"
                >
                  {localizedCopy(t, 'tool_networking_assistant_prefill_label', 'Imported from selected opportunity')}
                </div>
              )}

              <div className="sm:col-span-1">
                <label htmlFor="networking-target-company" className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {t('tool_networking_assistant_company_label')}
                </label>
                <div className="relative mt-2">
                  <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    id="networking-target-company"
                    data-qa="networking-target-company"
                    className="block min-h-[48px] w-full rounded-lg border border-slate-300 bg-white py-3 pl-10 pr-4 text-base text-slate-950 shadow-sm transition placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                    placeholder={t('tool_networking_assistant_company_placeholder')}
                    value={targetCompany}
                    onChange={(event) => {
                      setTargetCompany(event.target.value);
                      setPrefillActive(false);
                    }}
                    maxLength={MAX_TARGET_INPUT_LENGTH}
                    required
                  />
                </div>
              </div>

              <div className="sm:col-span-1">
                <label htmlFor="networking-target-location" className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {t('tool_networking_assistant_location_label')}
                </label>
                <div className="relative mt-2">
                  <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    id="networking-target-location"
                    data-qa="networking-target-location"
                    className="block min-h-[48px] w-full rounded-lg border border-slate-300 bg-white py-3 pl-10 pr-4 text-base text-slate-950 shadow-sm transition placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                    placeholder={t('tool_networking_assistant_location_placeholder')}
                    value={targetLocation}
                    onChange={(event) => {
                      setTargetLocation(event.target.value);
                      setPrefillActive(false);
                    }}
                    maxLength={MAX_TARGET_INPUT_LENGTH}
                    required
                  />
                </div>
              </div>

              <div className="sm:col-span-2">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label htmlFor="networking-target-role" className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {t('tool_networking_assistant_role_label')}
                  </label>
                  <button
                    type="button"
                    onClick={fillExample}
                    data-qa="networking-assistant-try-example"
                    className="min-h-11 px-2 text-sm font-semibold text-sky-700 transition hover:text-sky-800 dark:text-sky-300 dark:hover:text-sky-200"
                  >
                    {t('try_example')}
                  </button>
                </div>

                {resumeText && (
                  <div className="mb-3">
                    <SmartSuggestChips
                      items={suggestions.roles}
                      onPick={(value) => setTargetRole(value.slice(0, MAX_TARGET_INPUT_LENGTH))}
                      label={t('smart_suggest_target_roles')}
                    />
                  </div>
                )}

                <div className="relative">
                  <BriefcaseBusiness className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    id="networking-target-role"
                    data-qa="networking-target-role"
                    className="block min-h-[48px] w-full rounded-lg border border-slate-300 bg-white py-3 pl-10 pr-4 text-base text-slate-950 shadow-sm transition placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                    placeholder={t('tool_networking_assistant_role_placeholder')}
                    value={targetRole}
                    onChange={(event) => {
                      setTargetRole(event.target.value);
                      setPrefillActive(false);
                    }}
                    maxLength={MAX_TARGET_INPUT_LENGTH}
                    required
                  />
                </div>
              </div>
            </div>

            {error && (
              <div className="mt-5">
                <ToolError
                  message={error}
                  onRetry={() => void runTool(targetCompany, targetRole, targetLocation)}
                  retryLabel={t('try_again')}
                  retryDisabled={loading}
                />
              </div>
            )}

            <button
              type="submit"
              data-qa="networking-assistant-generate"
              disabled={loading}
              className="mt-5 inline-flex min-h-[48px] w-full items-center justify-center rounded-lg bg-sky-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-sky-400"
            >
              {loading ? t('tool_networking_assistant_generating_button') : t('tool_networking_assistant_generate_button')}
            </button>
          </form>

          <aside className="border-t border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950/40 sm:p-6 lg:border-l lg:border-t-0">
            <div className="rounded-lg border border-sky-100 bg-sky-50 p-4 text-sky-950 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-100">
              <div className="flex items-start gap-3">
                <Target className="mt-0.5 h-5 w-5 shrink-0" />
                <p className="text-sm font-semibold leading-relaxed">{t('tool_networking_assistant_setup_desc')}</p>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {[
                t('tool_networking_assistant_approach_label'),
                t('tool_networking_assistant_contact_label'),
                t('tool_networking_assistant_why_contact_label'),
                t('tool_networking_assistant_draft_label'),
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

    const company = result.targetCompany || targetCompany || t('tool_networking_assistant_company_label');
    const role = result.targetRole || targetRole || t('tool_networking_assistant_role_label');
    const location = result.targetLocation || targetLocation || t('tool_networking_assistant_location_label');
    const contacts = Array.isArray(result.contactSuggestions) ? result.contactSuggestions : [];
    const title = t('tool_networking_assistant_results_title')
      .replace('{company}', company)
      .replace('{location}', location);
    const downloadTitle = company.replace(/\s/g, '_');
    const validation = assessNetworkingStrategy(result);

    return (
      <div data-qa="networking-assistant-tool" data-qa-tool-state="result" className="mx-auto max-w-7xl space-y-5 break-words animate-fade-in">
        {canExportNetworkingStrategy(validation) && (
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
        <NetworkingQualityNotice validation={validation} />

        <CardShell className="overflow-hidden">
          <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 p-5 sm:p-6">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-sky-700 dark:text-sky-300">
                <Users className="h-4 w-4" />
                {t('tool_networking_assistant_title')}
              </div>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100 sm:text-3xl">
                {role}
              </h2>
              <p className="mt-4 max-w-4xl break-words text-base leading-relaxed text-slate-700 [overflow-wrap:anywhere] dark:text-slate-300">{result.strategySummary}</p>
            </div>
            <div className="border-t border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950/40 sm:p-6 xl:border-l xl:border-t-0">
              <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                <MetricTile label={t('tool_networking_assistant_company_label')} value={company} icon={Building2} />
                <MetricTile label={t('tool_networking_assistant_location_label')} value={location} icon={MapPin} />
                <MetricTile label={t('tool_networking_assistant_contact_label')} value={contacts.length} icon={MessageSquareText} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <NetworkingExportGate
                  validation={validation}
                  text={formatForDownload(result)}
                  baseFilename={`networking_strategy_${downloadTitle}`}
                  regenerateLabel={t('tool_networking_assistant_generate_button')}
                  onRegenerate={() => void runTool(company, role, location)}
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

        <div className="grid gap-5 lg:grid-cols-2">
          {contacts.map((suggestion, index) => (
            <article
              key={`${suggestion.contactType}-${index}`}
              data-qa="networking-contact-card"
              className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-700 text-sm font-semibold text-white">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{t('tool_networking_assistant_contact_label')}</p>
                  <h3 data-qa="networking-contact-type" className="mt-1 break-words text-lg font-semibold text-slate-950 dark:text-slate-100">{suggestion.contactType}</h3>
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
                <h4 className="text-sm font-semibold text-amber-950 dark:text-amber-200">{t('tool_networking_assistant_why_contact_label')}</h4>
                <p className="mt-2 break-words text-sm leading-relaxed text-amber-900 [overflow-wrap:anywhere] dark:text-amber-200">{suggestion.reason}</p>
              </div>

              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold text-slate-950 dark:text-slate-100">{t('tool_networking_assistant_draft_label')}</h4>
                  <NetworkingCopyGate
                    validation={validation}
                    text={suggestion.outreachMessage || ''}
                    label={t('tool_networking_assistant_copy_button')}
                  />
                  <button
                    type="button"
                    data-qa={`networking-open-email-${index}`}
                    disabled={!canExportNetworkingStrategy(validation)}
                    onClick={() => openTool('email-crafter', buildEmailContextFromNetworkingSuggestion({
                      contactType: suggestion.contactType,
                      company,
                      role,
                      location,
                      reason: suggestion.reason,
                      outreachMessage: suggestion.outreachMessage,
                    }))}
                    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    {t('tool_networking_assistant_draft_email_button')}
                  </button>
                </div>
                <p data-qa="networking-outreach-message" className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700 [overflow-wrap:anywhere] dark:text-slate-300">
                  {suggestion.outreachMessage}
                </p>
              </div>
            </article>
          ))}
        </div>

        <button
          type="button"
          onClick={resetResult}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {t('tool_networking_assistant_new_plan_button')}
        </button>
      </div>
    );
  };

  if (loading) {
    return (
      <StagedLoader
        title={t('tool_networking_loader_title')}
        steps={[t('tool_networking_step1'), t('tool_networking_step2'), t('tool_networking_step3')]}
        onCancel={cancel}
        cancelLabel={t('tool_loader_hide_button')}
        cancelHint={t('tool_loader_hide_hint')}
        icon={<Users />}
        accent="sky"
      />
    );
  }

  return result ? renderResult() : renderInput();
};

export default NetworkingAssistant;
