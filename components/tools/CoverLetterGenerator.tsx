import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BriefcaseBusiness, CheckCircle2, ClipboardList, FileText, PenLine, ShieldCheck, Sparkles, Wand2 } from 'lucide-react';
import { generateCoverLetter } from '../../services/aiClient';
import type { CoverLetter } from '../../types';
import StagedLoader from '../StagedLoader';
import { DownloadButtons, SavedResultBar, ToolError } from './ToolUtils';
import { useToolResults } from '../../contexts/ToolResultsContext';
import { useCancellableLoading } from '../../hooks/useCancellableLoading';
import { useRecentApplications, type RecentApplication } from '../../hooks/useRecentApplications';
import type { AppSession as Session } from '../../lib/data';
import {
  assessCoverLetterDraft,
  canExportCoverLetter,
  CoverLetterExportGate,
  CoverLetterQualityNotice,
} from './CoverLetterActions';
import { useLocalization } from '../../hooks/useLocalization';
import { TOOL_CREDIT_COSTS } from '../../config/credits';
import { LanguageSyncBanner } from '../LanguageSyncBanner';
import {
  adoptBareResult,
  getActiveLanguageVersion,
  getLanguageVersion,
  isLanguageVersionLibrary,
  listVersionLanguages,
  upsertLanguageVersion,
  type LanguageVersionLibrary,
} from '../../lib/languageVersions';

interface CoverLetterGeneratorProps {
  resumeText: string;
  market: string;
  initialInput: string;
  openTool: (tool: string, input?: string) => void;
  t: (key: string) => string;
  session: Session | null;
}

type CoverLetterResult = CoverLetter & {
  jobDescription?: string;
  market?: string;
  generatedAt?: number;
};

const COVER_LETTER_TEMPLATE = `[Your Name]
[Your Address] | [Your Email] | [Your Phone Number]

[Date]

[Hiring Manager Name]
[Company Name]

Dear Hiring Manager,

I am writing to apply for the [Job Title] role at [Company Name]. My background in [relevant skill area] and experience with [specific project or achievement] align with the responsibilities in this position.

In my recent work, I [specific action] which led to [measurable or clear outcome]. I would bring the same combination of ownership, communication, and practical execution to your team.

I am especially interested in this role because [company or role-specific reason]. Thank you for considering my application. I would welcome the opportunity to discuss how my experience can contribute to your team.

Sincerely,
[Your Name]`;

const SAMPLE_JOB_DESC = `Job Title: Frontend Software Engineer
Company: Shopify
Location: Ottawa, ON (Remote-friendly)

We are looking for a Frontend Software Engineer to join our team. You will build accessible React and TypeScript product surfaces, collaborate with product and design, and improve reliability for merchant-facing workflows.

Requirements:
- 2+ years of React and TypeScript experience
- Strong web accessibility and performance fundamentals
- Comfortable working with REST or GraphQL APIs
- Clear written communication and ownership in cross-functional teams`;

const MAX_JOB_DESCRIPTION_LENGTH = 20_000;
const MAX_COVER_LETTER_LENGTH = 20_000;
const MAX_LANGUAGE_VERSIONS = 12;

const boundedText = (value: unknown, maxLength: number) =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const normalizeCoverLetterResult = (value: unknown): CoverLetterResult | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const letter = boundedText(source.letter, MAX_COVER_LETTER_LENGTH);
  if (!letter) return null;

  const jobDescription = boundedText(source.jobDescription, MAX_JOB_DESCRIPTION_LENGTH);
  const resultMarket = boundedText(source.market, 200);
  const generatedAt = typeof source.generatedAt === 'number' && Number.isFinite(source.generatedAt)
    ? source.generatedAt
    : undefined;
  return {
    letter,
    ...(jobDescription ? { jobDescription } : {}),
    ...(resultMarket ? { market: resultMarket } : {}),
    ...(generatedAt ? { generatedAt } : {}),
  };
};

const normalizeCoverLetterLibrary = (value: unknown): LanguageVersionLibrary<CoverLetterResult> | null => {
  if (!isLanguageVersionLibrary(value)) return null;
  const versions: LanguageVersionLibrary<CoverLetterResult>['versions'] = {};
  Object.entries(value.versions)
    .slice(0, MAX_LANGUAGE_VERSIONS)
    .forEach(([key, version]) => {
      if (!version || typeof version !== 'object' || Array.isArray(version)) return;
      const source = version as unknown as Record<string, unknown>;
      const result = normalizeCoverLetterResult(source.result);
      if (!result) return;
      const lang = boundedText(source.lang, 24).toLowerCase() || boundedText(key, 24).toLowerCase();
      if (!lang) return;
      versions[lang] = {
        lang,
        result,
        savedAt: typeof source.savedAt === 'number' && Number.isFinite(source.savedAt) ? source.savedAt : 0,
      };
    });

  const languages = Object.keys(versions);
  if (languages.length === 0) return null;
  const requestedActive = boundedText(value.activeLang, 24).toLowerCase();
  return {
    kind: 'lang-versions',
    version: 1,
    activeLang: requestedActive && versions[requestedActive] ? requestedActive : languages[0],
    versions,
  };
};

const hasMeaningfulCoverLetter = (value: Partial<CoverLetter> | null | undefined) =>
  Boolean(value?.letter?.trim());

const extractJobTitle = (text: string) => {
  const match = text.match(/(?:^|\n)\s*(?:job\s*title|role|position)\s*:\s*(.+)/i);
  return match?.[1]?.trim() || '';
};

const extractCompany = (text: string) => {
  const match = text.match(/(?:^|\n)\s*(?:company|organization|employer)\s*:\s*(.+)/i);
  return match?.[1]?.trim() || '';
};

const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const hasCjkText = (text: string) => /[\u3040-\u30ff\u3400-\u9fff]/.test(text);
const describeTextLength = (text: string, useChineseUnit = false) => {
  const trimmed = text.trim();
  if (!trimmed) return useChineseUnit ? '0 词' : '0 words';
  if (hasCjkText(trimmed)) return `${trimmed.length.toLocaleString()} ${useChineseUnit ? '字' : 'chars'}`;
  return `${countWords(trimmed).toLocaleString()} ${useChineseUnit ? '词' : 'words'}`;
};

const buildRecentApplicationContext = (app: RecentApplication) => {
  const lines = [
    `Job Title: ${app.job_title}`,
    app.company_name ? `Company: ${app.company_name}` : '',
    app.location ? `Location: ${app.location}` : '',
    app.description ? `Posting summary:\n${app.description}` : '',
    app.responsibilities ? `Responsibilities:\n${app.responsibilities}` : '',
    app.required_qualifications ? `Required qualifications:\n${app.required_qualifications}` : '',
  ].filter(Boolean);
  return lines.join('\n\n');
};

const CardShell: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <section className={`rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}>
    {children}
  </section>
);

const ChecklistItem: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <li className="flex gap-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
    <span>{children}</span>
  </li>
);

const CoverLetterGenerator: React.FC<CoverLetterGeneratorProps> = ({ resumeText, market, initialInput, openTool, t, session }) => {
  const { loading, begin, end, cancel } = useCancellableLoading();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CoverLetterResult | null>(null);
  const { canSave, saved, saveState, persist, clear } = useToolResults<LanguageVersionLibrary<CoverLetterResult>>();
  const [fromSaved, setFromSaved] = useState(false);
  const { currentLang } = useLocalization();
  // Per-language version library for the cover letter, the language of the
  // currently-shown draft, and the UI language the sync banner was dismissed for
  // (so we stop nagging). Powers the "switch vs regenerate" language banner.
  const [lib, setLib] = useState<LanguageVersionLibrary<CoverLetterResult> | null>(null);
  // Mirror of `lib` so the next library can be computed outside React's state
  // updater: persist() setStates in ToolResultsProvider, and updaters must stay
  // pure (calling it there is a setState-in-render error).
  const libRef = useRef<LanguageVersionLibrary<CoverLetterResult> | null>(null);
  const updateLib = useCallback((next: LanguageVersionLibrary<CoverLetterResult> | null) => {
    libRef.current = next;
    setLib(next);
  }, []);
  const [resultLang, setResultLang] = useState<string | null>(null);
  const [langSyncDismissed, setLangSyncDismissed] = useState<string | null>(null);
  const [jobDescription, setJobDescription] = useState(() => initialInput.slice(0, MAX_JOB_DESCRIPTION_LENGTH));
  const [editableResult, setEditableResult] = useState('');
  const [browserOffline, setBrowserOffline] = useState(
    () => typeof navigator !== 'undefined' && navigator.onLine === false,
  );
  const { applications } = useRecentApplications(session);
  const consumedInitialInputRef = useRef('');
  const isChineseUi = /[\u3400-\u9fff]/.test(t('tool_cover_letter_generate_button'));
  const ui = {
    editTemplate: isChineseUi ? '你可以先编辑这个模板并导出，稍后再尝试生成。' : 'You can edit this template now and export it while generation is unavailable.',
    checksTitle: isChineseUi ? '生成前会检查' : 'What this checks',
    inputQuality: isChineseUi ? '输入质量' : 'Input quality',
    length: isChineseUi ? '长度' : 'Length',
    role: isChineseUi ? '岗位' : 'Role',
    company: isChineseUi ? '公司' : 'Company',
    notDetected: isChineseUi ? '暂未识别' : 'Not detected yet',
    sourceResume: isChineseUi ? '以你的简历作为事实来源。' : 'Uses your resume as the evidence source.',
    adaptRole: isChineseUi ? '根据职位描述调整开头和正文重点。' : 'Adapts the opening and body to the pasted role.',
    editableBeforeDownload: isChineseUi ? '生成后仍可编辑，再下载发送。' : 'Keeps the draft editable before download.',
    copyLetter: isChineseUi ? '复制求职信' : 'Copy letter',
    copied: isChineseUi ? '已复制' : 'Copied',
    formatApplicationPacket: isChineseUi ? '整理申请包' : 'Format application packet',
    editableDraft: isChineseUi ? '可编辑草稿' : 'Editable draft',
    beforeSending: isChineseUi ? '发送前检查' : 'Before sending',
    reviewSpecifics: isChineseUi ? '确认细节后再发送' : 'Review the specifics',
    confirmManager: isChineseUi ? '如果知道招聘负责人姓名，请替换称呼。' : 'Confirm the hiring manager name if you know it.',
    replaceCompanyContext: isChineseUi ? '把泛泛的公司描述改成一个具体原因。' : 'Replace generic company context with one concrete reason.',
    keepOnePage: isChineseUi ? '导出前尽量保持在一页以内。' : 'Keep the final version to one page when exported.',
    draftContext: isChineseUi ? '草稿上下文' : 'Draft context',
    roleNotDetected: isChineseUi ? '未识别到岗位' : 'Role not detected',
  };

  useEffect(() => {
    const handleOnline = () => setBrowserOffline(false);
    const handleOffline = () => setBrowserOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (initialInput.trim() || !saved || result) return;
    const raw = saved.result as unknown;
    // New shape: a per-language version library — hydrate the active version and
    // keep the library so the sync banner can offer a free switch.
    const normalizedLib = normalizeCoverLetterLibrary(raw);
    if (normalizedLib) {
      const active = getActiveLanguageVersion(normalizedLib);
      if (active && hasMeaningfulCoverLetter(active.result) && canExportCoverLetter(assessCoverLetterDraft(active.result.letter))) {
        updateLib(normalizedLib);
        setResult(active.result);
        setEditableResult(active.result.letter);
        setJobDescription(active.result.jobDescription || '');
        setResultLang(active.lang);
        setFromSaved(true);
      }
      return;
    }
    // Backward-compat: a bare pre-versioning result. Adopt it as a single-language
    // library in the current UI language (so no banner nags on this one).
    const bare = normalizeCoverLetterResult(raw);
    if (bare && hasMeaningfulCoverLetter(bare) && canExportCoverLetter(assessCoverLetterDraft(bare.letter))) {
      updateLib(adoptBareResult(bare, currentLang, saved.savedAt || Date.now()));
      setResult(bare);
      setEditableResult(bare.letter);
      setJobDescription(bare.jobDescription || '');
      setResultLang(currentLang);
      setFromSaved(true);
    }
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const nextInput = initialInput.trim().slice(0, MAX_JOB_DESCRIPTION_LENGTH);
    if (!nextInput || consumedInitialInputRef.current === nextInput) return;
    consumedInitialInputRef.current = nextInput;
    cancel();
    setJobDescription(nextInput);
    setResult(null);
    setEditableResult('');
    setFromSaved(false);
    setError(null);
    setResultLang(null);
    setLangSyncDismissed(null);
  }, [initialInput, cancel]);

  const resetResult = () => {
    setResult(null);
    setEditableResult('');
    setFromSaved(false);
    setError(null);
    setResultLang(null);
    setLangSyncDismissed(null);
  };

  const handleTryExample = () => {
    setJobDescription(SAMPLE_JOB_DESC);
    setError(null);
  };

  const runTool = async (input: string) => {
    const nextInput = input.trim().slice(0, MAX_JOB_DESCRIPTION_LENGTH);
    if (browserOffline) {
      setError(t('tool_cover_letter_ai_unavailable_error'));
      return;
    }
    if (!resumeText?.trim()) {
      setError(t('tool_resume_required_error'));
      return;
    }
    if (!nextInput) {
      setError(t('tool_cover_letter_error_required'));
      return;
    }

    setJobDescription(nextInput);
    const alive = begin();
    setError(null);
    setResult(null);
    try {
      const apiResult = normalizeCoverLetterResult(
        await generateCoverLetter(resumeText, nextInput, market, currentLang),
      );
      if (!alive()) return;
      if (!apiResult || !hasMeaningfulCoverLetter(apiResult)) {
        throw new Error(t('ai_error_empty_response'));
      }
      const validation = assessCoverLetterDraft(apiResult.letter);
      const nextResult: CoverLetterResult = {
        ...apiResult,
        jobDescription: nextInput,
        market,
        generatedAt: Date.now(),
      };
      setResult(nextResult);
      setEditableResult(nextResult.letter);
      setFromSaved(false);
      // Track the draft's language and fold it into the per-language library, so a
      // later UI-language change can offer a free switch instead of a paid re-run.
      setResultLang(currentLang);
      setLangSyncDismissed(null);
      if (canExportCoverLetter(validation)) {
        const nextLib = upsertLanguageVersion(libRef.current, currentLang, nextResult, Date.now());
        updateLib(nextLib);
        persist(nextLib); // no-op for free tier / signed-out (gated in the provider)
      }
    } catch (err) {
      if (alive()) setError(err instanceof Error ? err.message : t('unexpected_error'));
    } finally {
      if (alive()) end();
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void runTool(jobDescription);
  };

  const handleSelectRecentApp = (appId: string) => {
    if (!appId) return;
    const app = applications.find((application) => application.id === appId);
    if (!app) return;
    setJobDescription(buildRecentApplicationContext(app).slice(0, MAX_JOB_DESCRIPTION_LENGTH));
    setError(null);
  };

  const renderFallback = () => (
    <div data-qa="cover-letter-tool" data-qa-tool-state="input" className="mx-auto max-w-6xl space-y-5">
      <CardShell className="overflow-hidden">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="p-5 sm:p-6 lg:p-8">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-amber-700 dark:text-amber-300">
              <PenLine className="h-4 w-4" />
              {t('tool_cover_letter_ai_unavailable_title')}
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
              {t('tool_cover_letter_results_title')}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              {t('tool_cover_letter_ai_unavailable_desc')}
            </p>
            <textarea
              value={editableResult || COVER_LETTER_TEMPLATE}
              onChange={(event) => setEditableResult(event.target.value.slice(0, MAX_COVER_LETTER_LENGTH))}
              maxLength={MAX_COVER_LETTER_LENGTH}
              className="mt-6 min-h-[520px] w-full resize-y rounded-xl border border-slate-200 bg-white p-5 font-serif text-base leading-8 text-slate-950 shadow-inner outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
          <aside className="border-t border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950/50 lg:border-l lg:border-t-0 lg:p-6">
            <p className="text-sm font-semibold text-slate-950 dark:text-slate-100">{t('tool_cover_letter_ai_unavailable_error')}</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              {ui.editTemplate}
            </p>
            <div className="mt-5">
              <DownloadButtons textContent={editableResult || COVER_LETTER_TEMPLATE} baseFilename="cover_letter_template" />
            </div>
          </aside>
        </div>
      </CardShell>
    </div>
  );

  const renderInput = () => (
    <div data-qa="cover-letter-tool" data-qa-tool-state="input" className="mx-auto max-w-6xl space-y-5">
      <CardShell className="overflow-hidden">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
          <form onSubmit={handleSubmit} className="min-w-0 p-5 sm:p-6 lg:p-8">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-blue-700 dark:text-blue-300">
              <PenLine className="h-4 w-4" />
              {t('tool_cover_letter_title')}
            </div>
            <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100 sm:text-3xl">
              {t('tool_cover_letter_intro_title')}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              {t('tool_cover_letter_intro_desc')}
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={handleTryExample}
                data-qa="cover-letter-try-example"
                className="inline-flex min-h-11 w-fit items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
              >
                <Sparkles className="h-4 w-4" />
                {t('tool_cover_letter_try_example')}
              </button>

              {applications.length > 0 && (
                <label className="min-w-0 sm:w-80">
                  <span className="sr-only">{t('tool_cover_letter_recent_apps_placeholder')}</span>
                  <select
                    data-qa="cover-letter-recent-apps"
                    defaultValue=""
                    onChange={(event) => handleSelectRecentApp(event.target.value)}
                    className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="" disabled>{t('tool_cover_letter_recent_apps_placeholder')}</option>
                    {applications.map((app) => (
                      <option key={app.id} value={app.id}>
                        {app.job_title}{app.status ? ` - ${app.status}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            <label htmlFor="cover-letter-job-description" className="mt-7 block text-sm font-semibold text-slate-800 dark:text-slate-200">
              {t('tool_cover_letter_placeholder')}
            </label>
            <textarea
              id="cover-letter-job-description"
              data-qa="cover-letter-job-description"
              className="mt-2 min-h-[280px] w-full resize-y rounded-xl border border-slate-300 bg-white p-4 text-sm leading-6 text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
              placeholder={t('tool_cover_letter_placeholder')}
              value={jobDescription}
              onChange={(event) => setJobDescription(event.target.value.slice(0, MAX_JOB_DESCRIPTION_LENGTH))}
              maxLength={MAX_JOB_DESCRIPTION_LENGTH}
              required
            />

            {error && (
              <div className="mt-4">
                <ToolError message={error} onRetry={() => void runTool(jobDescription)} retryLabel={t('tool_cover_letter_retry')} retryDisabled={loading} />
              </div>
            )}

            <button
              type="submit"
              data-qa="cover-letter-generate"
              disabled={loading}
              className="mt-5 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-blue-400"
            >
              <Wand2 className="h-4 w-4" />
              {loading ? t('tool_cover_letter_generating_button') : t('tool_cover_letter_generate_button')}
            </button>
          </form>

          <aside className="border-t border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950/50 lg:border-l lg:border-t-0 lg:p-6">
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                  <ClipboardList className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-950 dark:text-slate-100">{ui.checksTitle}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{market}</p>
                </div>
              </div>
              <ul className="mt-4 space-y-3">
                <ChecklistItem>{ui.sourceResume}</ChecklistItem>
                <ChecklistItem>{ui.adaptRole}</ChecklistItem>
                <ChecklistItem>{ui.editableBeforeDownload}</ChecklistItem>
              </ul>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-sm font-semibold text-slate-950 dark:text-slate-100">{ui.inputQuality}</p>
              <div className="mt-4 grid gap-3">
                <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{ui.length}</p>
                  <p className="mt-1 text-lg font-semibold text-slate-950 dark:text-slate-100">{describeTextLength(jobDescription, isChineseUi)}</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{ui.role}</p>
                  <p className="mt-1 truncate text-sm font-semibold text-slate-950 dark:text-slate-100">{extractJobTitle(jobDescription) || ui.notDetected}</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{ui.company}</p>
                  <p className="mt-1 truncate text-sm font-semibold text-slate-950 dark:text-slate-100">{extractCompany(jobDescription) || ui.notDetected}</p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </CardShell>
    </div>
  );

  const renderResult = () => {
    if (!result) return browserOffline ? renderFallback() : renderInput();
    const jobTitle = extractJobTitle(result.jobDescription || jobDescription);
    const company = extractCompany(result.jobDescription || jobDescription);
    const letterLength = describeTextLength(editableResult, isChineseUi);
    const validation = assessCoverLetterDraft(editableResult);

    return (
      <div data-qa="cover-letter-tool" data-qa-tool-state="result" className="mx-auto max-w-6xl space-y-5 break-words animate-fade-in">
        {resultLang && resultLang !== currentLang && langSyncDismissed !== currentLang && (
          <LanguageSyncBanner
            contentLang={resultLang}
            uiLang={currentLang}
            availableLangs={listVersionLanguages(lib)}
            creditCost={TOOL_CREDIT_COSTS['cover-letter']}
            canPersist={canSave}
            busy={loading}
            t={t}
            onSwitch={(lang) => {
              const v = getLanguageVersion(lib, lang);
              if (!v) return;
              setResult(v.result);
              setEditableResult(v.result.letter);
              setJobDescription(v.result.jobDescription || '');
              setResultLang(lang);
            }}
            onRegenerate={() => { void runTool(result.jobDescription || jobDescription); }}
            onDismiss={() => setLangSyncDismissed(currentLang)}
          />
        )}
        {canExportCoverLetter(validation) && (
          <SavedResultBar
            t={t}
            canSave={canSave}
            isSaved={fromSaved}
            savedAt={saved?.savedAt ?? null}
            saveState={saveState}
            onTryNext={resetResult}
            onClearSaved={() => { clear(); setFromSaved(false); updateLib(null); }}
          />
        )}
        <CoverLetterQualityNotice validation={validation} />

        <CardShell className="overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-5 dark:border-slate-800 dark:bg-slate-950/50 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-blue-700 dark:text-blue-300">
                  <FileText className="h-4 w-4" />
                  {t('tool_cover_letter_results_title')}
                </div>
                <h2 className="mt-2 break-words text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100 sm:text-3xl">
                  {jobTitle || t('tool_cover_letter_title')}
                </h2>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  {company || market} · {letterLength}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <CoverLetterExportGate
                  validation={validation}
                  text={editableResult}
                  copyLabel={ui.copyLetter}
                  copiedLabel={ui.copied}
                  regenerateLabel={t('tool_cover_letter_generate_button')}
                  onRegenerate={() => void runTool(result.jobDescription || jobDescription)}
                />
                <button
                  type="button"
                  data-qa="cover-letter-open-resume-formatter"
                  onClick={() => openTool('resume-formatter', editableResult)}
                  disabled={!editableResult.trim()}
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <FileText className="h-4 w-4" />
                  {ui.formatApplicationPacket}
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 p-5 sm:p-6 lg:p-8">
              <label htmlFor="cover-letter-result" className="mb-3 block text-sm font-semibold text-slate-800 dark:text-slate-200">
                {ui.editableDraft}
              </label>
              <textarea
                id="cover-letter-result"
                data-qa="cover-letter-result"
                value={editableResult}
                onChange={(event) => setEditableResult(event.target.value.slice(0, MAX_COVER_LETTER_LENGTH))}
                maxLength={MAX_COVER_LETTER_LENGTH}
                className="min-h-[620px] w-full resize-y rounded-xl border border-slate-200 bg-white p-5 font-serif text-base leading-8 text-slate-950 shadow-inner outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <aside className="border-t border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950/50 lg:border-l lg:border-t-0 lg:p-6">
              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                    <ShieldCheck className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-slate-950 dark:text-slate-100">{ui.beforeSending}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{ui.reviewSpecifics}</p>
                  </div>
                </div>
                <ul className="mt-4 space-y-3">
                  <ChecklistItem>{ui.confirmManager}</ChecklistItem>
                  <ChecklistItem>{ui.replaceCompanyContext}</ChecklistItem>
                  <ChecklistItem>{ui.keepOnePage}</ChecklistItem>
                </ul>
              </div>

              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-sm font-semibold text-slate-950 dark:text-slate-100">{ui.draftContext}</p>
                <div className="mt-4 space-y-3">
                  <div className="flex items-start gap-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                    <BriefcaseBusiness className="mt-0.5 h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{ui.role}</p>
                      <p className="mt-1 break-words text-sm font-semibold text-slate-950 dark:text-slate-100">{jobTitle || ui.roleNotDetected}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{isChineseUi ? '地区' : 'Market'}</p>
                      <p className="mt-1 break-words text-sm font-semibold text-slate-950 dark:text-slate-100">{result.market || market}</p>
                    </div>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={resetResult}
                className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border-2 border-dashed border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {t('tool_cover_letter_back_button')}
              </button>
            </aside>
          </div>
        </CardShell>
      </div>
    );
  };

  if (loading) {
    return (
      <StagedLoader
        title={t('tool_cover_letter_generating_button')}
        steps={[
          t('tool_cover_letter_loader_step1'),
          t('tool_cover_letter_loader_step2'),
          t('tool_cover_letter_loader_step3').replace('{market}', market),
          t('tool_cover_letter_loader_step4'),
        ]}
        intervalMs={1600}
        onCancel={cancel}
        cancelLabel={t('tool_loader_hide_button')}
        cancelHint={t('tool_loader_hide_hint')}
        icon={<PenLine />}
        accent="lime"
      />
    );
  }

  return result ? renderResult() : (browserOffline ? renderFallback() : renderInput());
};

export default CoverLetterGenerator;
