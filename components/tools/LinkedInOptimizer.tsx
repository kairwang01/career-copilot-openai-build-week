import React, { useState, useEffect, useRef } from 'react';
import { ArrowRight, CheckCircle2, FileText, Link2, UserRound } from 'lucide-react';
import { optimizeLinkedInProfile, optimizeLinkedInProfileFromText } from '../../services/aiClient';
import { safeHttpUrl } from '../../lib/safeUrl';
import { MAX_RESUME_TEXT_CHARS } from '../../lib/resumeFileValidation';
import type { LinkedInOptimization } from '../../types';
import StagedLoader from '../StagedLoader';
import { useCancellableLoading } from '../../hooks/useCancellableLoading';
import { SavedResultBar, ToolError } from './ToolUtils';
import { useToolResults } from '../../contexts/ToolResultsContext';
import {
  assessLinkedInOptimization,
  buildLinkedInDownloadText,
  canExportLinkedInOptimization,
  LinkedInExportGate,
  LinkedInQualityNotice,
} from './LinkedInActions';
import { parseToolLinkedInResumeContext } from '../../lib/toolPrefill';

// (b) sample constant — profile-text tab only (never touches resumeText)
const SAMPLE_PROFILE_TEXT =
  'Software Engineer at Shopify | 5 years exp in Ruby on Rails, React, PostgreSQL. ' +
  'Led migration of monolith to microservices. Open-source contributor. B.Sc. Computer Science, uOttawa.';
const MAX_PROFILE_TEXT_LENGTH = 20_000;
const MAX_CUSTOM_PROMPT_LENGTH = 2_000;
const MAX_REFERENCE_URL_LENGTH = 2_048;
const MAX_RESULT_TEXT_LENGTH = 8_000;

const boundedText = (value: unknown, maxLength = MAX_RESULT_TEXT_LENGTH) =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const normalizeLinkedInResult = (value: unknown): LinkedInOptimization | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const experienceSuggestions = Array.isArray(raw.experienceSuggestions)
    ? raw.experienceSuggestions
      .slice(0, 20)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const title = boundedText((item as Record<string, unknown>).title, 500);
        const suggestion = boundedText((item as Record<string, unknown>).suggestion);
        return title || suggestion ? { title, suggestion } : null;
      })
      .filter((item): item is { title: string; suggestion: string } => item !== null)
    : [];
  const result: LinkedInOptimization = {
    headline: boundedText(raw.headline, 500),
    summary: boundedText(raw.summary),
    experienceSuggestions,
  };
  return result.headline || result.summary || result.experienceSuggestions.length ? result : null;
};

interface LinkedInOptimizerProps {
  resumeText: string;
  initialInput?: string;
  market: string;
  t: (key: string) => string;
}

const LinkedInOptimizer: React.FC<LinkedInOptimizerProps> = ({ resumeText, initialInput = '', market, t }) => {
  const { loading, begin, end, cancel } = useCancellableLoading();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LinkedInOptimization | null>(null);
  const { canSave, saved, saveState, persist, clear } = useToolResults<LinkedInOptimization>();
  const [fromSaved, setFromSaved] = useState(false);
  const [linkedinTab, setLinkedinTab] = useState<'resume' | 'profile'>('resume');
  const [linkedinProfileText, setLinkedinProfileText] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [additionalUrl, setAdditionalUrl] = useState('');
  const [resumeOverrideText, setResumeOverrideText] = useState('');
  const [resumeOverrideMarket, setResumeOverrideMarket] = useState('');
  const [resumePrefillActive, setResumePrefillActive] = useState(false);
  const consumedInitialInputRef = useRef('');

  // Track which mode was used so the error retry can call the right path
  const [lastMode, setLastMode] = useState<'resume' | 'profile'>('resume');
  const resumeSourceText = resumeOverrideText.trim() || resumeText;
  const resumeMarket = resumeOverrideMarket || market;
  const hasResume = resumeSourceText.trim().length > 0;
  const profileTextReady = linkedinProfileText.trim().length > 0;

  useEffect(() => {
    if (initialInput.trim()) return;
    const normalized = saved && !result ? normalizeLinkedInResult(saved.result) : null;
    if (normalized && canExportLinkedInOptimization(assessLinkedInOptimization(normalized))) {
      setResult(normalized);
      setFromSaved(true);
    }
  }, [saved, result, initialInput]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const value = initialInput.trim().slice(0, MAX_RESUME_TEXT_CHARS);
    if (!value || consumedInitialInputRef.current === value) return;

    const context = parseToolLinkedInResumeContext(value);
    if (!context.formattedResume) return;

    consumedInitialInputRef.current = value;
    setResumeOverrideText(context.formattedResume.slice(0, MAX_RESUME_TEXT_CHARS));
    setResumeOverrideMarket((context.targetMarket || '').slice(0, 200));
    setResumePrefillActive(true);
    setLinkedinTab('resume');
    setLastMode('resume');
    setResult(null);
    setFromSaved(false);
    setError(null);
  }, [initialInput]);

  const runTool = async (options: {
    mode?: 'resume' | 'profile';
    profileText?: string;
    customPrompt?: string;
    additionalUrl?: string;
  } = {}) => {
    const mode = options.mode ?? 'resume';
    if (loading) return;
    const profileText = options.profileText?.trim().slice(0, MAX_PROFILE_TEXT_LENGTH) ?? '';
    const prompt = options.customPrompt?.trim().slice(0, MAX_CUSTOM_PROMPT_LENGTH);
    const rawReferenceUrl = options.additionalUrl?.trim() ?? '';
    const referenceUrl = rawReferenceUrl ? safeHttpUrl(rawReferenceUrl) : '';
    if (mode === 'profile' && !profileText) {
      setError(t('tool_linkedin_optimizer_error_required'));
      return;
    }
    if (mode === 'profile' && rawReferenceUrl && (!/^https:\/\//i.test(rawReferenceUrl) || !referenceUrl)) {
      setError(t('account_custom_endpoint_base_url_error'));
      return;
    }
    if (mode === 'resume' && !hasResume) {
      setError(t('tool_resume_required_error'));
      return;
    }
    setLastMode(mode);
    const alive = begin();
    setError(null);
    setResult(null);
    try {
      let apiResult;
      if (mode === 'profile') {
        apiResult = await optimizeLinkedInProfileFromText(
            profileText,
            resumeSourceText,
            resumeMarket,
            prompt,
            referenceUrl || undefined,
        );
      } else {
        apiResult = await optimizeLinkedInProfile(resumeSourceText, resumeMarket);
      }
      if (!alive()) return;
      const normalized = normalizeLinkedInResult(apiResult);
      if (!normalized) throw new Error(t('ai_error_empty_response'));
      const validation = assessLinkedInOptimization(normalized);
      setResult(normalized);
      setFromSaved(false);
      if (canExportLinkedInOptimization(validation)) {
        persist(normalized);
      }
    } catch (err) {
      if (alive()) setError(err instanceof Error ? err.message : t('unexpected_error'));
    } finally {
      if (alive()) end();
    }
  };

  const handleProfileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runTool({
        profileText: linkedinProfileText,
        customPrompt: customPrompt,
        additionalUrl: additionalUrl,
        mode: 'profile'
    });
  };

  const handleResumeSubmit = (e: React.MouseEvent) => {
    e.preventDefault();
    runTool({ mode: 'resume' });
  };

  const handleRetry = () => {
    if (lastMode === 'profile') {
      runTool({ profileText: linkedinProfileText, customPrompt, additionalUrl, mode: 'profile' });
    } else {
      runTool({ mode: 'resume' });
    }
  };

  const renderInput = () => (
    <div data-qa="linkedin-optimizer-tool" data-qa-tool-state="input" className="animate-fade-in space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-blue-700 dark:text-blue-300">
              <Link2 className="h-4 w-4" aria-hidden="true" />
              {t('tool_linkedin_optimizer_intro_title')}
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
              {t('tool_linkedin_optimizer_intro_desc')}
            </p>
            {resumePrefillActive && (
              <p
                data-qa="linkedin-optimizer-prefill-note"
                className="mt-2 text-xs font-semibold text-blue-700 dark:text-blue-300"
              >
                {t('tool_linkedin_optimizer_prefill_resume_label')}
              </p>
            )}
          </div>
          <div className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${
            hasResume
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300'
              : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200'
          }`}>
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {hasResume
              ? t('ob_resume_chars').replace('{n}', resumeSourceText.trim().length.toLocaleString())
              : t('tool_resume_required_error')}
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:items-start">
        <aside className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="grid gap-2" role="tablist" aria-label={t('tool_linkedin_optimizer_intro_title')}>
            <button
              type="button"
              role="tab"
              id="linkedin-tab-resume"
              aria-controls="linkedin-panel-resume"
              aria-selected={linkedinTab === 'resume'}
              onClick={() => setLinkedinTab('resume')}
              className={`rounded-lg border p-3 text-left transition ${
                linkedinTab === 'resume'
                  ? 'border-blue-300 bg-blue-50 text-blue-900 ring-2 ring-blue-100 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-100 dark:ring-blue-900/50'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <FileText className="h-4 w-4" aria-hidden="true" />
                {t('tool_linkedin_optimizer_tab_resume')}
              </span>
              <span className="mt-1 block text-xs leading-5 opacity-80">{t('tool_linkedin_optimizer_resume_desc')}</span>
            </button>
            <button
              type="button"
              role="tab"
              id="linkedin-tab-profile"
              aria-controls="linkedin-panel-profile"
              aria-selected={linkedinTab === 'profile'}
              onClick={() => setLinkedinTab('profile')}
              className={`rounded-lg border p-3 text-left transition ${
                linkedinTab === 'profile'
                  ? 'border-blue-300 bg-blue-50 text-blue-900 ring-2 ring-blue-100 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-100 dark:ring-blue-900/50'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <UserRound className="h-4 w-4" aria-hidden="true" />
                {t('tool_linkedin_optimizer_tab_profile')}
              </span>
              <span className="mt-1 block text-xs leading-5 opacity-80">{t('tool_linkedin_optimizer_profile_desc')}</span>
            </button>
          </div>
        </aside>

        {linkedinTab === 'resume' ? (
          <section
            id="linkedin-panel-resume"
            role="tabpanel"
            aria-labelledby="linkedin-tab-resume"
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-5"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300">
                <FileText className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="text-base font-semibold text-slate-950 dark:text-slate-100">{t('tool_linkedin_optimizer_tab_resume')}</h4>
                <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">{t('tool_linkedin_optimizer_resume_desc')}</p>
              </div>
            </div>
            {!hasResume && (
              <div className="mt-4">
                <ToolError message={t('tool_resume_required_error')} />
              </div>
            )}
            <button
              type="button"
              onClick={handleResumeSubmit}
              data-qa="linkedin-optimizer-generate-resume"
              disabled={loading || !hasResume}
              className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-blue-300 disabled:text-white/90 dark:disabled:bg-blue-900/60 sm:w-auto"
            >
              {loading ? t('tool_linkedin_optimizer_optimizing_button') : t('tool_linkedin_optimizer_generate_button')}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </section>
        ) : (
          <section
            id="linkedin-panel-profile"
            role="tabpanel"
            aria-labelledby="linkedin-tab-profile"
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-5"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h4 className="text-base font-semibold text-slate-950 dark:text-slate-100">{t('tool_linkedin_optimizer_tab_profile')}</h4>
                <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">{t('tool_linkedin_optimizer_profile_desc')}</p>
              </div>
              <button
                type="button"
                onClick={() => setLinkedinProfileText(SAMPLE_PROFILE_TEXT)}
                data-qa="linkedin-optimizer-try-example"
                className="min-h-11 shrink-0 px-2 text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400"
              >
                {t('tool_try_example')}
              </button>
            </div>

            <form onSubmit={handleProfileSubmit} className="mt-4 space-y-4">
              <div>
                <label htmlFor="linkedin-profile-text" className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {t('tool_linkedin_optimizer_tab_profile')}
                </label>
                <textarea
                  id="linkedin-profile-text"
                  data-qa="linkedin-profile-text"
                  className="mt-2 block h-44 w-full resize-y rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500 dark:focus:ring-blue-900/40"
                  placeholder={t('tool_linkedin_optimizer_profile_placeholder')}
                  value={linkedinProfileText}
                  onChange={(e) => setLinkedinProfileText(e.target.value)}
                  maxLength={MAX_PROFILE_TEXT_LENGTH}
                  required
                />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="text-left text-sm text-slate-600 dark:text-slate-300">
                  <label htmlFor="custom-prompt" className="font-semibold text-slate-800 dark:text-slate-200">{t('tool_linkedin_optimizer_prompt_label')}</label>
                  <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{t('tool_linkedin_optimizer_prompt_desc')}</p>
                  <textarea
                    id="custom-prompt"
                    className="mt-2 block h-24 w-full resize-y rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500 dark:focus:ring-blue-900/40"
                    placeholder={t('tool_linkedin_optimizer_prompt_placeholder')}
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    maxLength={MAX_CUSTOM_PROMPT_LENGTH}
                  />
                </div>
                <div className="text-left text-sm text-slate-600 dark:text-slate-300">
                  <label htmlFor="additional-url" className="font-semibold text-slate-800 dark:text-slate-200">{t('tool_linkedin_optimizer_url_label')}</label>
                  <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{t('tool_linkedin_optimizer_url_desc')}</p>
                  <input
                    type="url"
                    id="additional-url"
                    className="mt-2 block min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500 dark:focus:ring-blue-900/40"
                    placeholder={t('tool_linkedin_optimizer_url_placeholder')}
                    value={additionalUrl}
                    onChange={(e) => setAdditionalUrl(e.target.value)}
                    maxLength={MAX_REFERENCE_URL_LENGTH}
                    pattern="https://.+"
                    title={t('account_custom_endpoint_base_url_error')}
                  />
                </div>
              </div>
              <button
                type="submit"
                data-qa="linkedin-optimizer-generate-profile"
                disabled={loading || !profileTextReady}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-blue-300 disabled:text-white/90 dark:disabled:bg-blue-900/60 sm:w-auto"
              >
                {loading ? t('tool_linkedin_optimizer_optimizing_button') : t('tool_linkedin_optimizer_generate_button')}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </form>
          </section>
        )}
      </div>
      {error && (
        <ToolError
          message={error}
          onRetry={handleRetry}
          retryLabel={t('tool_try_again')}
          retryDisabled={loading}
        />
      )}
    </div>
  );

  const renderResult = () => {
    if (loading) {
      return (
        <StagedLoader
          title={t('tool_linkedin_optimizer_loader_title')}
          steps={[
            t('tool_linkedin_optimizer_loader_step1'),
            t('tool_linkedin_optimizer_loader_step2'),
            t('tool_linkedin_optimizer_loader_step3'),
          ]}
          onCancel={cancel}
          icon={<Link2 />}
          accent="cyan"
        />
      );
    }

    if (!result) return null;

    const headline = result.headline || '';
    const summary = result.summary || '';
    const experienceSuggestions = Array.isArray(result.experienceSuggestions) ? result.experienceSuggestions : [];

    // Build downloadable text
    const downloadText = buildLinkedInDownloadText(result, {
      headline: t('tool_linkedin_optimizer_headline_label'),
      summary: t('tool_linkedin_optimizer_summary_label'),
      experience: t('tool_linkedin_optimizer_experience_label'),
    });
    const validation = assessLinkedInOptimization(result);

    return (
      <div data-qa="linkedin-optimizer-tool" data-qa-tool-state="result" className="space-y-6 break-words animate-fade-in">
        {canExportLinkedInOptimization(validation) && (
          <SavedResultBar
            t={t}
            canSave={canSave}
            isSaved={fromSaved}
            savedAt={saved?.savedAt ?? null}
            saveState={saveState}
            onTryNext={() => { setResult(null); setFromSaved(false); setError(null); }}
            onClearSaved={() => { clear(); setFromSaved(false); }}
          />
        )}
        <LinkedInQualityNotice validation={validation} />
        {/* (d) RESULT ACTIONS — download + start-over */}
        <div className="flex flex-wrap justify-between items-center gap-3">
          <h4 className="text-lg font-bold dark:text-gray-100">{t('tool_linkedin_optimizer_results_title')}</h4>
          <div className="flex items-center gap-2">
            <LinkedInExportGate
              validation={validation}
              text={downloadText}
              regenerateLabel={t('tool_linkedin_optimizer_generate_button')}
              onRegenerate={handleRetry}
            />
            <button
              type="button"
              onClick={() => setResult(null)}
              className="px-3 py-2 text-sm font-medium rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors"
            >
              {t('tool_start_over')}
            </button>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h5 className="text-sm font-bold text-gray-800 dark:text-gray-100">{t('tool_linkedin_optimizer_headline_label')}</h5>
          <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-800 break-words dark:bg-slate-800 dark:text-slate-200">{headline}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h5 className="text-sm font-bold text-gray-800 dark:text-gray-100">{t('tool_linkedin_optimizer_summary_label')}</h5>
          <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-800 whitespace-pre-wrap break-words dark:bg-slate-800 dark:text-slate-200">{summary}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h5 className="text-sm font-bold text-gray-800 dark:text-gray-100">{t('tool_linkedin_optimizer_experience_label')}</h5>
          <ul className="mt-2 space-y-3">
            {experienceSuggestions.map((item, i) => (
              <li key={i} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800">
                <strong className="block break-words font-semibold text-slate-900 [overflow-wrap:anywhere] dark:text-gray-200">{item.title}</strong>
                <p className="mt-1 break-words leading-6 text-slate-700 [overflow-wrap:anywhere] dark:text-gray-300">{item.suggestion}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  };

  return loading || result ? renderResult() : renderInput();
};

export default LinkedInOptimizer;
