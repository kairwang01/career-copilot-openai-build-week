import React, { useEffect, useRef, useState } from 'react';
import { BriefcaseBusiness, CheckCircle2, ClipboardList, Mail, MessageSquareReply, SlidersHorizontal, Sparkles, Wand2 } from 'lucide-react';
import { generateProfessionalEmail } from '../../services/aiClient';
import type { ProfessionalEmailResult } from '../../types';
import StagedLoader from '../StagedLoader';
import { useCancellableLoading } from '../../hooks/useCancellableLoading';
import { SavedResultBar, ToolError } from './ToolUtils';
import { useToolResults } from '../../contexts/ToolResultsContext';
import { useRecentApplications } from '../../hooks/useRecentApplications';
import type { AppSession as Session } from '../../lib/data';
import { parseToolEmailContext, parseToolJobContext } from '../../lib/toolPrefill';
import {
  assessEmailDraft,
  canExportEmail,
  EmailExportGate,
  EmailQualityNotice,
} from './EmailActions';

const EMAIL_SCENARIOS = {
  'Thank You': 'Post-Interview Thank You',
  'Follow-up': 'Application Follow-up',
  Networking: 'Networking Outreach',
  Application: 'Job Application Submission',
  Salary: 'Salary Counter-Offer',
} as const;
const EMAIL_SCENARIO_VALUES = new Set<string>(Object.values(EMAIL_SCENARIOS));

const DATE_FIELDS = new Set(['Date of Application']);
const SAMPLE_SCENARIO = 'Post-Interview Thank You';
const SAMPLE_DETAILS: Record<string, string> = {
  'Interviewer Name': 'Sarah Chen',
  'Job Title': 'Frontend Software Engineer',
};
const MAX_SHORT_DETAIL_LENGTH = 500;
const MAX_LONG_DETAIL_LENGTH = 8_000;
const MAX_REPLY_LENGTH = 20_000;
const MAX_EMAIL_BODY_LENGTH = 20_000;

const boundedInput = (value: unknown, maxLength: number) =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const normalizeEmailResult = (value: unknown): EmailResult | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const subject = boundedInput(source.subject, MAX_SHORT_DETAIL_LENGTH);
  const body = boundedInput(source.body, MAX_EMAIL_BODY_LENGTH);
  if (!subject || !body) return null;
  const scenario = boundedInput(source.scenario, MAX_SHORT_DETAIL_LENGTH);
  const resultMarket = boundedInput(source.market, MAX_SHORT_DETAIL_LENGTH);
  const mode = source.mode === 'reply' ? 'reply' : source.mode === 'draft' ? 'draft' : undefined;
  const generatedAt = typeof source.generatedAt === 'number' && Number.isFinite(source.generatedAt)
    ? source.generatedAt
    : undefined;
  return {
    subject,
    body,
    ...(scenario ? { scenario } : {}),
    ...(mode ? { mode } : {}),
    ...(resultMarket ? { market: resultMarket } : {}),
    ...(generatedAt ? { generatedAt } : {}),
  };
};

const SCENARIO_DETAILS: Record<string, string[]> = {
  'Thank You': ['Interviewer Name', 'Job Title'],
  'Follow-up': ['Company Name', 'Job Title', 'Date of Application'],
  Networking: ['Recipient Name (optional)', 'Recipient Title', 'Recipient Company', 'Message Context (optional)'],
  Application: ['Company Name', 'Job Title', 'Contact Person (optional)'],
  Salary: ['Company Name', 'Job Title', 'Current Offer', 'Target Range', 'Message Context (optional)'],
};

interface EmailCrafterProps {
  resumeText: string;
  market: string;
  initialInput?: string;
  t: (key: string) => string;
  session: Session | null;
}

type EmailResult = ProfessionalEmailResult & {
  scenario?: string;
  mode?: 'draft' | 'reply';
  market?: string;
  generatedAt?: number;
};

const hasMeaningfulEmailResult = (value: Partial<ProfessionalEmailResult> | null | undefined) =>
  Boolean(value?.subject?.trim() && value?.body?.trim());

const toLocaleKeySegment = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const scenarioLabelKey = (key: string) => `tool_email_crafter_scenario_${toLocaleKeySegment(key)}`;
const scenarioDescKey = (key: string) => `tool_email_crafter_scenario_${toLocaleKeySegment(key)}_desc`;
const detailLabelKey = (detail: string) => `tool_email_crafter_detail_${toLocaleKeySegment(detail)}`;
const isOptionalDetail = (detail: string) => /\(optional\)/i.test(detail);
const isLongDetail = (detail: string) => /context|notes|message/i.test(detail);
const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const hasCjkText = (text: string) => /[\u3040-\u30ff\u3400-\u9fff]/.test(text);
const describeTextLength = (text: string, useChineseUnit = false) => {
  const trimmed = text.trim();
  if (!trimmed) return useChineseUnit ? '0 词' : '0 words';
  if (hasCjkText(trimmed)) return `${trimmed.length.toLocaleString()} ${useChineseUnit ? '字' : 'chars'}`;
  return `${countWords(trimmed).toLocaleString()} ${useChineseUnit ? '词' : 'words'}`;
};
const toDateInputValue = (value: string) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
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

const SliderControl: React.FC<{
  label: string;
  minLabel: string;
  maxLabel: string;
  value: number;
  onChange: (value: number) => void;
}> = ({ label, minLabel, maxLabel, value, onChange }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
    <div className="flex items-center justify-between gap-3">
      <label className="text-sm font-semibold text-slate-800 dark:text-slate-200">{label}</label>
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{value}</span>
    </div>
    <input
      type="range"
      min="0"
      max="100"
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="mt-3 h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-blue-700 dark:bg-slate-700"
      aria-label={label}
    />
    <div className="mt-2 flex justify-between text-xs text-slate-500 dark:text-slate-400">
      <span>{minLabel}</span>
      <span>{maxLabel}</span>
    </div>
  </div>
);

const EmailCrafter: React.FC<EmailCrafterProps> = ({ resumeText, market, initialInput = '', t, session }) => {
  const { loading, begin, end, cancel } = useCancellableLoading();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EmailResult | null>(null);
  const { canSave, saved, saveState, persist, clear } = useToolResults<EmailResult>();
  const [fromSaved, setFromSaved] = useState(false);
  const [editableSubject, setEditableSubject] = useState('');
  const [editableResult, setEditableResult] = useState('');
  const [craftingMode, setCraftingMode] = useState<'draft' | 'reply'>('draft');
  const [receivedEmailText, setReceivedEmailText] = useState('');
  const [tone, setTone] = useState(50);
  const [style, setStyle] = useState(50);
  const [confidence, setConfidence] = useState(50);
  const [emailScenario, setEmailScenario] = useState<string>('');
  const [emailDetails, setEmailDetails] = useState<Record<string, string>>({});
  const [prefillSource, setPrefillSource] = useState<'opportunity' | 'networking' | 'salary' | null>(null);
  const { applications } = useRecentApplications(session);
  const consumedInitialInputRef = useRef('');

  const isChineseUi = /[\u3400-\u9fff]/.test(t('tool_email_crafter_generate_button'));
  const ui = {
    mode: isChineseUi ? '模式' : 'Mode',
    setup: isChineseUi ? '邮件设置' : 'Email setup',
    style: isChineseUi ? '语气控制' : 'Tone controls',
    context: isChineseUi ? '上下文' : 'Context',
    quality: isChineseUi ? '输入质量' : 'Input quality',
    length: isChineseUi ? '长度' : 'Length',
    selected: isChineseUi ? '已选择' : 'Selected',
    notSelected: isChineseUi ? '未选择' : 'Not selected',
    readyChecks: isChineseUi ? '发送前要点' : 'Before sending',
    reviewSubject: isChineseUi ? '确认主题是否具体。' : 'Confirm the subject is specific.',
    reviewNames: isChineseUi ? '检查姓名、岗位、公司是否准确。' : 'Check names, role, and company details.',
    reviewTone: isChineseUi ? '按关系远近调整正式程度。' : 'Tune formality to the relationship.',
    subject: isChineseUi ? '主题' : 'Subject',
    body: isChineseUi ? '正文' : 'Body',
    editableDraft: isChineseUi ? '可编辑草稿' : 'Editable draft',
    copyEmail: isChineseUi ? '复制邮件' : 'Copy email',
    copied: isChineseUi ? '已复制' : 'Copied',
    draftContext: isChineseUi ? '草稿上下文' : 'Draft context',
  };

  useEffect(() => {
    const value = initialInput.trim().slice(0, MAX_REPLY_LENGTH);
    if (!value || consumedInitialInputRef.current === value) return;
    const emailContext = parseToolEmailContext(value);
    if (emailContext.source === 'Salary Negotiator') {
      consumedInitialInputRef.current = value;
      setCraftingMode('draft');
      setEmailScenario(emailContext.scenario && EMAIL_SCENARIO_VALUES.has(emailContext.scenario)
        ? emailContext.scenario
        : EMAIL_SCENARIOS.Salary);
      setEmailDetails((prev) => ({
        ...prev,
        ...(emailContext.company ? { 'Company Name': boundedInput(emailContext.company, MAX_SHORT_DETAIL_LENGTH) } : {}),
        ...(emailContext.jobTitle ? { 'Job Title': boundedInput(emailContext.jobTitle, MAX_SHORT_DETAIL_LENGTH) } : {}),
        ...(emailContext.currentOffer ? { 'Current Offer': boundedInput(emailContext.currentOffer, MAX_SHORT_DETAIL_LENGTH) } : {}),
        ...(emailContext.targetRange ? { 'Target Range': boundedInput(emailContext.targetRange, MAX_SHORT_DETAIL_LENGTH) } : {}),
        ...(emailContext.messageContext ? { 'Message Context (optional)': boundedInput(emailContext.messageContext, MAX_LONG_DETAIL_LENGTH) } : {}),
      }));
      setPrefillSource('salary');
      setResult(null);
      setEditableSubject('');
      setEditableResult('');
      setFromSaved(false);
      setError(null);
      return;
    }

    if (emailContext.scenario || emailContext.recipientCompany || emailContext.recipientTitle || emailContext.messageContext) {
      consumedInitialInputRef.current = value;
      setCraftingMode('draft');
      setEmailScenario(emailContext.scenario && EMAIL_SCENARIO_VALUES.has(emailContext.scenario)
        ? emailContext.scenario
        : EMAIL_SCENARIOS.Networking);
      setEmailDetails((prev) => ({
        ...prev,
        ...(emailContext.recipientName ? { 'Recipient Name (optional)': boundedInput(emailContext.recipientName, MAX_SHORT_DETAIL_LENGTH) } : {}),
        ...(emailContext.recipientTitle ? { 'Recipient Title': boundedInput(emailContext.recipientTitle, MAX_SHORT_DETAIL_LENGTH) } : {}),
        ...(emailContext.recipientCompany ? { 'Recipient Company': boundedInput(emailContext.recipientCompany, MAX_SHORT_DETAIL_LENGTH) } : {}),
        ...(emailContext.messageContext || emailContext.reason || emailContext.targetRole || emailContext.targetLocation ? {
          'Message Context (optional)': boundedInput([
            emailContext.targetRole ? `Target role: ${emailContext.targetRole}` : '',
            emailContext.targetLocation ? `Target location: ${emailContext.targetLocation}` : '',
            emailContext.reason ? `Reason: ${emailContext.reason}` : '',
            emailContext.messageContext || '',
          ].filter(Boolean).join('\n\n'), MAX_LONG_DETAIL_LENGTH),
        } : {}),
      }));
      setPrefillSource('networking');
      setResult(null);
      setEditableSubject('');
      setEditableResult('');
      setFromSaved(false);
      setError(null);
      return;
    }

    const context = parseToolJobContext(value);
    if (!context.jobTitle && !context.company) return;

    consumedInitialInputRef.current = value;
    setCraftingMode('draft');
    setEmailScenario(EMAIL_SCENARIOS.Application);
    setEmailDetails((prev) => ({
      ...prev,
      ...(context.company ? { 'Company Name': boundedInput(context.company, MAX_SHORT_DETAIL_LENGTH) } : {}),
      ...(context.jobTitle ? { 'Job Title': boundedInput(context.jobTitle, MAX_SHORT_DETAIL_LENGTH) } : {}),
    }));
    setPrefillSource('opportunity');
    setResult(null);
    setEditableSubject('');
    setEditableResult('');
    setFromSaved(false);
    setError(null);
  }, [initialInput]);

  useEffect(() => {
    if (initialInput.trim()) return;
    const nextResult = normalizeEmailResult(saved?.result);
    if (nextResult && !result && canExportEmail(assessEmailDraft(nextResult.subject, nextResult.body))) {
      setResult(nextResult);
      setEditableSubject(nextResult.subject);
      setEditableResult(nextResult.body);
      setFromSaved(true);
    }
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetResult = () => {
    setResult(null);
    setEditableSubject('');
    setEditableResult('');
    setFromSaved(false);
    setError(null);
  };

  const selectedScenarioKey = Object.keys(EMAIL_SCENARIOS).find((key) => EMAIL_SCENARIOS[key as keyof typeof EMAIL_SCENARIOS] === emailScenario) || '';
  const requiredDetails = SCENARIO_DETAILS[selectedScenarioKey] || [];
  const completedDetailCount = requiredDetails.filter((detail) => isOptionalDetail(detail) || emailDetails[detail]?.trim()).length;

  const handleTryExample = () => {
    setEmailScenario(SAMPLE_SCENARIO);
    setEmailDetails(SAMPLE_DETAILS);
    setCraftingMode('draft');
    setPrefillSource(null);
    setError(null);
  };

  const handleSelectRecentApp = (appId: string) => {
    if (!appId) return;
    const app = applications.find((application) => application.id === appId);
    if (!app) return;
    setEmailDetails((prev) => ({
      ...prev,
      'Job Title': boundedInput(app.job_title, MAX_SHORT_DETAIL_LENGTH),
      ...(app.company_name ? { 'Company Name': boundedInput(app.company_name, MAX_SHORT_DETAIL_LENGTH) } : {}),
      ...(app.application_date ? { 'Date of Application': toDateInputValue(app.application_date) } : {}),
    }));
    setPrefillSource(null);
    setError(null);
  };

  const handleScenarioSelect = (value: string) => {
    setEmailScenario(value);
    setPrefillSource(null);
    setError(null);
  };

  const handleDetailChange = (key: string, value: string) => {
    const maxLength = isLongDetail(key) ? MAX_LONG_DETAIL_LENGTH : MAX_SHORT_DETAIL_LENGTH;
    setEmailDetails((prev) => ({ ...prev, [key]: value.slice(0, maxLength) }));
    setPrefillSource(null);
  };

  const runTool = async () => {
    if (!resumeText.trim()) {
      setError(t('tool_resume_required_error'));
      return;
    }
    let scenarioForApi = '';
    let detailsForApi: Record<string, string> = {};

    if (craftingMode === 'reply') {
      const received = boundedInput(receivedEmailText, MAX_REPLY_LENGTH);
      if (!received) {
        setError(t('tool_email_crafter_error_required_reply'));
        return;
      }
      scenarioForApi = 'Reply Assistant';
      detailsForApi = { receivedEmailText: received };
    } else {
      if (!emailScenario) {
        setError(t('tool_email_crafter_error_required_scenario'));
        return;
      }
      const missing = requiredDetails.filter((detail) => !isOptionalDetail(detail) && !emailDetails[detail]?.trim());
      if (missing.length > 0) {
        setError(t('tool_email_crafter_error_required_detail').replace('{field}', t(detailLabelKey(missing[0]))));
        return;
      }
      scenarioForApi = emailScenario;
      // Only send fields visible for the active scenario. Keeping stale values
      // from an earlier scenario in React state must not leak hidden PII into a
      // later paid generation request.
      detailsForApi = Object.fromEntries(requiredDetails.map((detail) => [
        detail,
        boundedInput(
          emailDetails[detail],
          isLongDetail(detail) ? MAX_LONG_DETAIL_LENGTH : MAX_SHORT_DETAIL_LENGTH,
        ),
      ]));
    }

    const alive = begin();
    setError(null);
    setResult(null);
    try {

      const apiResult = normalizeEmailResult(
        await generateProfessionalEmail(resumeText, scenarioForApi, detailsForApi, market, tone, style, confidence),
      );
      if (!alive()) return;
      if (!apiResult || !hasMeaningfulEmailResult(apiResult)) throw new Error(t('ai_error_empty_response'));
      const validation = assessEmailDraft(apiResult.subject, apiResult.body);
      const nextResult: EmailResult = {
        ...apiResult,
        scenario: scenarioForApi,
        mode: craftingMode,
        market,
        generatedAt: Date.now(),
      };
      setResult(nextResult);
      setEditableSubject(nextResult.subject);
      setEditableResult(nextResult.body);
      setFromSaved(false);
      if (canExportEmail(validation)) {
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
    void runTool();
  };

  const renderInput = () => (
    <div data-qa="email-crafter-tool" data-qa-tool-state="input" className="mx-auto max-w-6xl space-y-5">
      <CardShell className="overflow-hidden">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_380px]">
          <form onSubmit={handleSubmit} className="min-w-0 p-5 sm:p-6 lg:p-8">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-blue-700 dark:text-blue-300">
              <Mail className="h-4 w-4" />
              {t('tool_email_crafter_title')}
            </div>
            <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100 sm:text-3xl">
              {t('tool_email_crafter_intro_title')}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              {t('tool_email_crafter_intro_desc')}
            </p>

            <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-950">
              <div className="grid grid-cols-2 gap-1" role="tablist" aria-label={ui.mode}>
                <button
                  type="button"
                  role="tab"
                  id="email-crafter-tab-draft"
                  aria-controls="email-crafter-panel-draft"
                  onClick={() => { setCraftingMode('draft'); setPrefillSource(null); setError(null); }}
                  aria-selected={craftingMode === 'draft'}
                  className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                    craftingMode === 'draft'
                      ? 'bg-white text-blue-700 shadow-sm dark:bg-slate-800 dark:text-blue-300'
                      : 'text-slate-600 hover:bg-white/70 dark:text-slate-400 dark:hover:bg-slate-800/70'
                  }`}
                >
                  <Mail className="h-4 w-4" />
                  {t('tool_email_crafter_mode_draft')}
                </button>
                <button
                  type="button"
                  role="tab"
                  id="email-crafter-tab-reply"
                  aria-controls="email-crafter-panel-reply"
                  onClick={() => { setCraftingMode('reply'); setPrefillSource(null); setError(null); }}
                  aria-selected={craftingMode === 'reply'}
                  className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                    craftingMode === 'reply'
                      ? 'bg-white text-blue-700 shadow-sm dark:bg-slate-800 dark:text-blue-300'
                      : 'text-slate-600 hover:bg-white/70 dark:text-slate-400 dark:hover:bg-slate-800/70'
                  }`}
                >
                  <MessageSquareReply className="h-4 w-4" />
                  {t('tool_email_crafter_mode_reply')}
                </button>
              </div>
            </div>

            {craftingMode === 'draft' ? (
              <div
                id="email-crafter-panel-draft"
                role="tabpanel"
                aria-labelledby="email-crafter-tab-draft"
                className="mt-6 space-y-5 animate-fade-in"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">{t('tool_email_crafter_draft_desc')}</p>
                  <button
                    type="button"
                    onClick={handleTryExample}
                    data-qa="email-crafter-try-example"
                    className="inline-flex min-h-11 w-fit items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
                  >
                    <Sparkles className="h-4 w-4" />
                    {t('tool_email_crafter_try_example')}
                  </button>
                </div>

                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{t('tool_email_crafter_scenario_label')}</p>
                  {prefillSource && (
                    <p
                      data-qa="email-crafter-prefill-note"
                      className="mt-1 text-xs font-semibold text-blue-700 dark:text-blue-300"
                    >
                      {t(
                        prefillSource === 'salary'
                          ? 'tool_email_crafter_prefill_salary_label'
                          : prefillSource === 'networking'
                            ? 'tool_email_crafter_prefill_networking_label'
                            : 'tool_email_crafter_prefill_opportunity_label',
                      )}
                    </p>
                  )}
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    {Object.entries(EMAIL_SCENARIOS).map(([key, value]) => (
                      <button
                        type="button"
                        key={key}
                        data-qa={`email-crafter-scenario-${toLocaleKeySegment(key)}`}
                        onClick={() => handleScenarioSelect(value)}
                        aria-pressed={emailScenario === value}
                        className={`min-h-[76px] rounded-xl border p-4 text-left transition ${
                          emailScenario === value
                            ? 'border-blue-500 bg-blue-50 text-blue-800 shadow-sm dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-200'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                        }`}
                      >
                        <span className="block text-sm font-semibold">{t(scenarioLabelKey(key))}</span>
                        <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{t(scenarioDescKey(key))}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {emailScenario && (
                  <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/50 sm:grid-cols-2">
                    {applications.length > 0 && (
                      <label className="sm:col-span-2">
                        <span className="mb-1 block text-sm font-semibold text-slate-800 dark:text-slate-200">{t('tool_email_crafter_recent_apps_label')}</span>
                        <select
                          data-qa="email-crafter-recent-apps"
                          defaultValue=""
                          onChange={(event) => handleSelectRecentApp(event.target.value)}
                          className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        >
                          <option value="" disabled>{t('tool_email_crafter_recent_apps_placeholder')}</option>
                          {applications.map((app) => (
                            <option key={app.id} value={app.id}>
                              {app.job_title}{app.status ? ` - ${app.status}` : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}

                    {requiredDetails.map((detail) => {
                      const isLong = isLongDetail(detail);
                      return (
                        <label key={detail} className={isLong ? 'sm:col-span-2' : undefined}>
                          <span className="mb-1 block text-sm font-semibold text-slate-800 dark:text-slate-200">{t(detailLabelKey(detail))}</span>
                          {isLong ? (
                            <textarea
                              data-qa={`email-detail-${toLocaleKeySegment(detail)}`}
                              rows={4}
                              value={emailDetails[detail] || ''}
                              onChange={(event) => handleDetailChange(detail, event.target.value)}
                              maxLength={MAX_LONG_DETAIL_LENGTH}
                              required={!isOptionalDetail(detail)}
                              className="min-h-[112px] w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-950 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                            />
                          ) : (
                            <input
                              data-qa={`email-detail-${toLocaleKeySegment(detail)}`}
                              type={DATE_FIELDS.has(detail) ? 'date' : 'text'}
                              value={emailDetails[detail] || ''}
                              onChange={(event) => handleDetailChange(detail, event.target.value)}
                              maxLength={MAX_SHORT_DETAIL_LENGTH}
                              required={!isOptionalDetail(detail)}
                              className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                            />
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div
                id="email-crafter-panel-reply"
                role="tabpanel"
                aria-labelledby="email-crafter-tab-reply"
                className="mt-6 animate-fade-in"
              >
                <label htmlFor="email-reply-source" className="mb-2 block text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {t('tool_email_crafter_reply_label')}
                </label>
                <textarea
                  id="email-reply-source"
                  value={receivedEmailText}
                  onChange={(event) => setReceivedEmailText(event.target.value.slice(0, MAX_REPLY_LENGTH))}
                  maxLength={MAX_REPLY_LENGTH}
                  rows={10}
                  className="min-h-[260px] w-full resize-y rounded-xl border border-slate-300 bg-white p-4 text-sm leading-6 text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                  placeholder={t('tool_email_crafter_reply_placeholder')}
                />
              </div>
            )}

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <SliderControl label={t('tool_email_crafter_tone_label')} minLabel={t('tool_email_crafter_tone_min')} maxLabel={t('tool_email_crafter_tone_max')} value={tone} onChange={setTone} />
              <SliderControl label={t('tool_email_crafter_style_label')} minLabel={t('tool_email_crafter_style_min')} maxLabel={t('tool_email_crafter_style_max')} value={style} onChange={setStyle} />
              <SliderControl label={t('tool_email_crafter_confidence_label')} minLabel={t('tool_email_crafter_confidence_min')} maxLabel={t('tool_email_crafter_confidence_max')} value={confidence} onChange={setConfidence} />
            </div>

            {error && (
              <div className="mt-4">
                <ToolError message={error} onRetry={() => void runTool()} retryLabel={t('tool_email_crafter_retry')} />
              </div>
            )}

            <button
              type="submit"
              data-qa="email-crafter-generate"
              disabled={loading}
              className="mt-5 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-blue-400"
            >
              <Wand2 className="h-4 w-4" />
              {loading ? t('tool_email_crafter_drafting_button') : t('tool_email_crafter_generate_button')}
            </button>
          </form>

          <aside className="border-t border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950/50 lg:border-l lg:border-t-0 lg:p-6">
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                  <ClipboardList className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-950 dark:text-slate-100">{ui.setup}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{market}</p>
                </div>
              </div>
              <dl className="mt-4 grid gap-3">
                <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                  <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{ui.mode}</dt>
                  <dd className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-100">
                    {craftingMode === 'draft' ? t('tool_email_crafter_mode_draft') : t('tool_email_crafter_mode_reply')}
                  </dd>
                </div>
                <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                  <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{ui.selected}</dt>
                  <dd className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-100">
                    {craftingMode === 'reply' ? describeTextLength(receivedEmailText, isChineseUi) : (emailScenario || ui.notSelected)}
                  </dd>
                </div>
                {craftingMode === 'draft' && emailScenario && (
                  <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                    <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{ui.quality}</dt>
                    <dd className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-100">{completedDetailCount}/{requiredDetails.length}</dd>
                  </div>
                )}
              </dl>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                <p className="text-sm font-semibold text-slate-950 dark:text-slate-100">{ui.style}</p>
              </div>
              <ul className="mt-4 space-y-3">
                <ChecklistItem>{ui.reviewSubject}</ChecklistItem>
                <ChecklistItem>{ui.reviewNames}</ChecklistItem>
                <ChecklistItem>{ui.reviewTone}</ChecklistItem>
              </ul>
            </div>
          </aside>
        </div>
      </CardShell>
    </div>
  );

  const renderResult = () => {
    if (!result) return null;
    const exportText = `${ui.subject}: ${editableSubject}\n\n${editableResult}`;
    const lengthLabel = describeTextLength(editableResult, isChineseUi);
    const validation = assessEmailDraft(editableSubject, editableResult);

    return (
      <div data-qa="email-crafter-tool" data-qa-tool-state="result" className="mx-auto max-w-6xl space-y-5 break-words animate-fade-in">
        {canExportEmail(validation) && (
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
        <EmailQualityNotice validation={validation} />

        <CardShell className="overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-5 dark:border-slate-800 dark:bg-slate-950/50 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-blue-700 dark:text-blue-300">
                  <Mail className="h-4 w-4" />
                  {t('tool_email_crafter_results_title')}
                </div>
                <h2 className="mt-2 break-words text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100 sm:text-3xl">
                  {editableSubject || t('tool_email_crafter_subject_label')}
                </h2>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  {result.mode === 'reply' ? t('tool_email_crafter_mode_reply') : (result.scenario || t('tool_email_crafter_mode_draft'))} · {lengthLabel}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <EmailExportGate
                  validation={validation}
                  text={exportText}
                  copyLabel={ui.copyEmail}
                  copiedLabel={ui.copied}
                  regenerateLabel={t('tool_email_crafter_generate_button')}
                  onRegenerate={() => void runTool()}
                />
              </div>
            </div>
          </div>

          <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-5 p-5 sm:p-6 lg:p-8">
              <label htmlFor="email-subject-result" className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
                {ui.subject}
              </label>
              <input
                id="email-subject-result"
                data-qa="email-crafter-result-subject"
                value={editableSubject}
                onChange={(event) => setEditableSubject(event.target.value.slice(0, MAX_SHORT_DETAIL_LENGTH))}
                maxLength={MAX_SHORT_DETAIL_LENGTH}
                className="min-h-[48px] w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base font-semibold text-slate-950 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />

              <label htmlFor="email-body-result" className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
                {ui.editableDraft}
              </label>
              <textarea
                id="email-body-result"
                data-qa="email-crafter-result-body"
                value={editableResult}
                onChange={(event) => setEditableResult(event.target.value.slice(0, MAX_EMAIL_BODY_LENGTH))}
                maxLength={MAX_EMAIL_BODY_LENGTH}
                className="min-h-[520px] w-full resize-y rounded-xl border border-slate-200 bg-white p-5 text-base leading-8 text-slate-950 shadow-inner outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <aside className="border-t border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950/50 lg:border-l lg:border-t-0 lg:p-6">
              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                    <BriefcaseBusiness className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-slate-950 dark:text-slate-100">{ui.draftContext}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{result.market || market}</p>
                  </div>
                </div>
                <dl className="mt-4 space-y-3">
                  <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                    <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{ui.mode}</dt>
                    <dd className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-100">
                      {result.mode === 'reply' ? t('tool_email_crafter_mode_reply') : t('tool_email_crafter_mode_draft')}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                    <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{ui.length}</dt>
                    <dd className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-100">{lengthLabel}</dd>
                  </div>
                </dl>
              </div>

              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-sm font-semibold text-slate-950 dark:text-slate-100">{ui.readyChecks}</p>
                <ul className="mt-4 space-y-3">
                  <ChecklistItem>{ui.reviewSubject}</ChecklistItem>
                  <ChecklistItem>{ui.reviewNames}</ChecklistItem>
                  <ChecklistItem>{ui.reviewTone}</ChecklistItem>
                </ul>
              </div>

              <button
                type="button"
                onClick={resetResult}
                className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border-2 border-dashed border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {t('tool_email_crafter_back_button')}
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
        title={t('tool_email_crafter_drafting_button')}
        steps={[
          t('tool_email_crafter_loader_step1'),
          t('tool_email_crafter_loader_step2'),
          t('tool_email_crafter_loader_step3'),
        ]}
        onCancel={cancel}
        cancelLabel={t('tool_loader_hide_button')}
        cancelHint={t('tool_loader_hide_hint')}
        icon={<Mail />}
        accent="rose"
      />
    );
  }

  return result ? renderResult() : renderInput();
};

export default EmailCrafter;
