import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, CheckCircle2, FileText, Sparkles, Upload } from 'lucide-react';
import { data } from '../../lib/data';
import type { UserProfile } from '../../types';
import { parseFile } from '../../services/fileHelpers';
import { uploadResumeFile, deleteResumeFile } from '../../services/resumeStorage';
import { RESUME_FILE_ACCEPT } from '../../lib/resumeFileValidation';
import { createOnboardingCommitter } from '../../lib/onboardingCommit';
import { BrandMark } from '../BrandLogo';
import { loadJobPreferences, saveJobPreferences, type JobPreferences } from '../../hooks/useJobPreferences';
import {
  CAREER_FIELDS,
  loadBirthdayLocal,
  loadPendingOnboardingName,
  markOnboardingDone,
  saveBirthdayLocal,
  suggestCareerFields,
} from '../../lib/onboarding';

/**
 * Post-signup guided setup (Duolingo-style stepper).
 *
 * Collects name (required), birthday (optional), resume (optional) and target
 * career fields (optional), then asks for privacy consent BEFORE anything is
 * persisted — until the final step every answer lives only in component state.
 * Persistence stays inside existing channels: profile.full_name/birth_date,
 * the user-reviewed resume_text and JobPreferences.
 */

interface OnboardingFlowProps {
  uid: string;
  profile: UserProfile;
  t: (key: string) => string;
  /** Drives the brand mark's surface tint so it matches the themed onboarding chrome. */
  theme: 'light' | 'dark';
  /** skipped=true → nothing was persisted. resumeText flows into the workspace. */
  onComplete: (result: { skipped: boolean; resumeText?: string }) => void;
}

type Phase =
  | 'intro'
  | 'name'
  | 'transition1'
  | 'resume'
  | 'transition2'
  | 'interest'
  | 'consent'
  | 'finishing'
  | 'done';

const PROGRESS: Partial<Record<Phase, number>> = {
  name: 20,
  transition1: 30,
  resume: 45,
  transition2: 55,
  interest: 70,
  consent: 85,
  finishing: 95,
  done: 100,
};

const splitFullName = (value?: string | null): { firstName: string; lastName: string } => {
  const parts = (value ?? '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' '),
  };
};

const onboardingNameSource = (profile: UserProfile): string =>
  profile.full_name?.trim() || loadPendingOnboardingName();

const FIRESTORE_RESUME_TEXT_LIMIT = 200_000;

const reviewedResumeText = (text: string): string => text.trim().slice(0, FIRESTORE_RESUME_TEXT_LIMIT);

/** Spinner + line used by the intro and the two inter-step transitions. */
const TransitionScreen: React.FC<{ line: string }> = ({ line }) => (
  <div className="flex flex-col items-center justify-center gap-5 py-16 animate-fade-in" role="status">
    <div className="h-12 w-12 rounded-full border-4 border-blue-200 border-t-blue-700 animate-spin" aria-hidden="true" />
    <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{line}</p>
  </div>
);

const OnboardingFlow: React.FC<OnboardingFlowProps> = ({ uid, profile, t, theme, onComplete }) => {
  const [phase, setPhase] = useState<Phase>('intro');

  // ── collected answers (in memory until consent) ───────────────────────────
  const initialName = splitFullName(onboardingNameSource(profile));
  const [firstName, setFirstName] = useState(initialName.firstName);
  const [lastName, setLastName] = useState(initialName.lastName);
  const [birthday, setBirthday] = useState(profile.birth_date || loadBirthdayLocal(uid));
  const [resumeDraft, setResumeDraft] = useState('');
  const [resumeSource, setResumeSource] = useState<string | null>(null); // filename or 'paste'
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [consented, setConsented] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameTouchedRef = useRef(false);
  const finishingRef = useRef(false);
  // A new signed-in user receives a fresh stage/latch even if React reuses the
  // same component position during an account switch.
  const onboardingCommitter = useMemo(() => createOnboardingCommitter({
    uploadResume: uploadResumeFile,
    deleteResume: deleteResumeFile,
    saveProfile: async (userId, patch) => {
      const { error } = await data.profiles.update(userId, patch);
      if (error) throw new Error(error.message);
    },
  }), [uid]);

  // Profile creation and subscription setup can finish after the workspace has
  // mounted. Backfill the sign-up name only while the user has not typed here.
  useEffect(() => {
    if (nameTouchedRef.current || firstName.trim() || lastName.trim()) return;
    const nextName = splitFullName(onboardingNameSource(profile));
    if (!nextName.firstName && !nextName.lastName) return;
    setFirstName(nextName.firstName);
    setLastName(nextName.lastName);
  }, [profile.full_name, firstName, lastName]);

  // Auto-advance the intro and the two transition screens.
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (phase === 'intro') timerRef.current = setTimeout(() => setPhase('name'), 1500);
    if (phase === 'transition1') timerRef.current = setTimeout(() => setPhase('resume'), 1200);
    if (phase === 'transition2') timerRef.current = setTimeout(() => setPhase('interest'), 1200);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [phase]);

  // Suggested fields from the resume — computed once per draft, pre-selected.
  // Pre-select the suggestions exactly once, when the interest step opens —
  // the deliberate phase-only dependency keeps later manual deselects intact.
  const suggested = useMemo(() => suggestCareerFields(resumeDraft), [resumeDraft]);
  const suggestedRef = useRef(suggested);
  suggestedRef.current = suggested;
  // False once unmounted — guards setState if the user clicks "Skip all" (or leaves)
  // while a resume parse/upload is still in flight.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      onboardingCommitter.discardResume();
    };
  }, [onboardingCommitter]);
  useEffect(() => {
    if (phase === 'interest') {
      setSelectedFields((prev) => (prev.length === 0 ? suggestedRef.current : prev));
    }
  }, [phase]);

  const toggleField = (id: string) => {
    setSelectedFields((prev) =>
      prev.includes(id) ? prev.filter((f) => f !== id) : prev.length >= 3 ? prev : [...prev, id],
    );
  };

  const handleFile = async (file: File) => {
    setParsing(true);
    setParseError(false);
    try {
      const parsed = await parseFile(file);
      if (!mountedRef.current) return;
      if (parsed.text.trim()) {
        setResumeDraft(parsed.text);
        setResumeSource(file.name);
        setShowPaste(false);
        // Keep the original file in memory until the user explicitly consents
        // and finishes onboarding. Parsing/selecting alone must never write PII.
        onboardingCommitter.stageResume(file);
      } else {
        setParseError(true);
      }
    } catch {
      if (mountedRef.current) setParseError(true);
    } finally {
      if (mountedRef.current) setParsing(false);
    }
  };

  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

  const finish = async () => {
    if (!consented || finishingRef.current) return;
    finishingRef.current = true;
    setPhase('finishing');
    setSaveError(false);
    try {
      const roleTexts = selectedFields
        .map((id) => CAREER_FIELDS.find((f) => f.id === id)?.roleText ?? '')
        .filter(Boolean);
      const existing = loadJobPreferences();
      const onboardingJobPreferences: JobPreferences | null = roleTexts.length > 0
        ? {
            status: existing?.status ?? 'active',
            roles: roleTexts.join(', '),
            locations: existing?.locations ?? '',
            salaryMin: existing?.salaryMin ?? '',
            availability: existing?.availability ?? '',
          }
        : null;

      // Name + reviewed resume → profile in ONE write. Splitting it risked a partial
      // save (name persisted, resume lost) if the second call failed; a single update
      // keeps it atomic. The resume text must be saved before leaving onboarding —
      // relying on the workspace debounce lets getProfile() reload an empty
      // resume_text and wipe the just-imported draft from local state.
      const resumeTextToSave = resumeSource ? reviewedResumeText(resumeDraft) : '';
      const result = await onboardingCommitter.commit({
        uid,
        consented,
        profilePatch: {
          full_name: fullName,
          birth_date: birthday || null,
          ...(resumeTextToSave ? { resume_text: resumeTextToSave } : {}),
          ...(onboardingJobPreferences ? { job_preferences: onboardingJobPreferences } : {}),
          updated_at: new Date().toISOString(),
        },
      });
      if (result.resumeUploadError) {
        console.warn('Could not save original resume file during onboarding:', result.resumeUploadError);
      }

      // 2) Career fields → existing JobPreferences (drives AI search + job goals).
      if (onboardingJobPreferences) saveJobPreferences(onboardingJobPreferences);

      // 3) Optional birthday → also mirror locally for old-client compatibility.
      saveBirthdayLocal(uid, birthday);

      // Onboarding is complete the moment the data is saved — mark it done now so
      // closing the tab on the celebration screen (before "enter workspace") can't
      // re-trigger onboarding next visit. enterWorkspace() also calls it (idempotent).
      markOnboardingDone(uid);

      setPhase('done');
    } catch (error) {
      finishingRef.current = false;
      console.error('Onboarding completion failed:', error);
      setSaveError(true);
      setPhase('consent');
    }
  };

  const skipAll = () => {
    onboardingCommitter.discardResume();
    markOnboardingDone(uid);
    onComplete({ skipped: true });
  };

  const progress = PROGRESS[phase] ?? 0;
  const showSkip = phase === 'name' || phase === 'resume' || phase === 'interest' || phase === 'consent';

  const primaryBtn =
    'inline-flex min-h-[46px] w-full items-center justify-center rounded-xl bg-blue-700 px-5 text-sm font-bold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-blue-300 dark:disabled:bg-blue-900/50';
  const inputCls =
    'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-blue-500 dark:focus:ring-blue-900/40';

  const enterWorkspace = () => {
    markOnboardingDone(uid);
    onComplete({ skipped: false, resumeText: resumeSource ? reviewedResumeText(resumeDraft) : undefined });
  };

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-slate-50 dark:bg-slate-950 overflow-y-auto">
      {/* Top bar: brand + progress + skip */}
      <header className="sticky top-0 z-10 bg-slate-50/95 dark:bg-slate-950/95 backdrop-blur px-4 pt-4 pb-3 sm:px-8">
        <div className="mx-auto flex w-full max-w-lg items-center gap-3">
          <BrandMark surface={theme === 'dark' ? 'dark' : 'light'} className="h-8 w-8 shrink-0" />
          <div
            className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
            role="progressbar"
            aria-label={t('ob_progress_label')}
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          {showSkip ? (
            <button
              type="button"
              onClick={skipAll}
              className="shrink-0 text-xs font-semibold text-slate-400 transition-colors hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
            >
              {t('ob_skip_all')}
            </button>
          ) : (
            <span className="w-8" aria-hidden="true" />
          )}
        </div>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 py-6 sm:items-center sm:px-8">
        <div className="w-full max-w-lg">

          {phase === 'intro' && <TransitionScreen line={t('ob_intro_line')} />}
          {phase === 'transition1' && <TransitionScreen line={t('ob_transition_resume')} />}
          {phase === 'transition2' && <TransitionScreen line={t('ob_transition_interest')} />}

          {/* ── STEP: name + birthday ── */}
          {phase === 'name' && (
            <div key="name" className="animate-view-fade">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{t('ob_name_title')}</h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{t('ob_name_desc')}</p>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="ob-first" className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-300">
                    {t('ob_first_name')} <span className="text-red-500" aria-hidden="true">*</span>
                  </label>
                  <input
                    id="ob-first"
                    type="text"
                    value={firstName}
                    required
                    maxLength={60}
                    autoComplete="given-name"
                    onChange={(e) => {
                      nameTouchedRef.current = true;
                      setFirstName(e.target.value);
                    }}
                    className={inputCls}
                    autoFocus
                  />
                </div>
                <div>
                  <label htmlFor="ob-last" className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-300">
                    {t('ob_last_name')} <span className="text-red-500" aria-hidden="true">*</span>
                  </label>
                  <input
                    id="ob-last"
                    type="text"
                    value={lastName}
                    required
                    maxLength={60}
                    autoComplete="family-name"
                    onChange={(e) => {
                      nameTouchedRef.current = true;
                      setLastName(e.target.value);
                    }}
                    className={inputCls}
                  />
                </div>
              </div>
              <div className="mt-4">
                <label htmlFor="ob-birthday" className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-300">
                  <CalendarDays className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  {t('ob_birthday')} <span className="font-normal text-slate-400">({t('ob_optional')})</span>
                </label>
                <input
                  id="ob-birthday"
                  type="date"
                  value={birthday}
                  max={new Date().toISOString().slice(0, 10)}
                  autoComplete="bday"
                  aria-describedby="ob-birthday-hint"
                  onChange={(e) => setBirthday(e.target.value)}
                  className={inputCls}
                />
                <p id="ob-birthday-hint" className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">{t('ob_birthday_hint')}</p>
              </div>
              <button
                type="button"
                onClick={() => setPhase('transition1')}
                disabled={!firstName.trim() || !lastName.trim()}
                className={`${primaryBtn} mt-8`}
              >
                {t('ob_continue')}
              </button>
            </div>
          )}

          {/* ── STEP: resume (optional) ── */}
          {phase === 'resume' && (
            <div key="resume" className="animate-view-fade">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{t('ob_resume_title')}</h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{t('ob_resume_desc')}</p>

              <input
                ref={fileInputRef}
                type="file"
                accept={RESUME_FILE_ACCEPT}
                className="hidden"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
              />

              {resumeSource ? (
                <div className="mt-6 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800/50 dark:bg-emerald-900/20 animate-panel-expand">
                  <FileText className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p role="status" className="truncate text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                      {resumeSource === 'paste' ? t('ob_resume_pasted') : resumeSource}
                    </p>
                    <p className="text-xs text-emerald-700 dark:text-emerald-400">
                      {t('ob_resume_chars').replace('{n}', String(resumeDraft.length))}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setResumeDraft('');
                      setResumeSource(null);
                      onboardingCommitter.discardResume();
                    }}
                    className="shrink-0 text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-300"
                  >
                    {t('ob_resume_remove')}
                  </button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={parsing}
                    aria-busy={parsing}
                    className="mt-6 flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-white px-4 py-8 text-center transition hover:border-blue-300 hover:bg-blue-50/40 disabled:cursor-wait dark:border-slate-700 dark:bg-slate-900 dark:hover:border-blue-700 dark:hover:bg-blue-900/10"
                  >
                    {parsing ? (
                      <span className="h-7 w-7 rounded-full border-[3px] border-blue-200 border-t-blue-700 animate-spin" aria-hidden="true" />
                    ) : (
                      <Upload className="h-7 w-7 text-slate-400 dark:text-slate-500" aria-hidden="true" />
                    )}
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                      {parsing ? t('ob_resume_parsing') : t('ob_resume_upload')}
                    </span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">PDF · Word · TXT</span>
                  </button>

                  {parseError && (
                    <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-300 animate-panel-expand">
                      {t('ob_resume_parse_error')}
                    </p>
                  )}

                  {showPaste ? (
                    <div className="mt-4 animate-panel-expand">
                      <label htmlFor="ob-resume-paste" className="sr-only">
                        {t('ob_resume_paste_link')}
                      </label>
                      <textarea
                        id="ob-resume-paste"
                        value={resumeDraft}
                        onChange={(e) => setResumeDraft(e.target.value)}
                        rows={6}
                        placeholder={t('ob_resume_paste_ph')}
                        className={`${inputCls} resize-none font-mono text-xs`}
                      />
                      {resumeDraft.trim().length > 0 && (
                        <button
                          type="button"
                          onClick={() => setResumeSource('paste')}
                          className="mt-2 text-sm font-semibold text-blue-700 hover:underline dark:text-blue-400"
                        >
                          {t('ob_resume_use_pasted')}
                        </button>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowPaste(true)}
                      className="mt-3 text-sm font-semibold text-blue-700 hover:underline dark:text-blue-400"
                    >
                      {t('ob_resume_paste_link')}
                    </button>
                  )}
                </>
              )}

              <div className="mt-8 space-y-3">
                <button type="button" onClick={() => setPhase('transition2')} className={primaryBtn}>
                  {resumeSource ? t('ob_continue') : t('ob_resume_continue_without')}
                </button>
                {!resumeSource && (
                  <p className="text-center text-xs text-slate-400 dark:text-slate-500">{t('ob_resume_later_hint')}</p>
                )}
              </div>
            </div>
          )}

          {/* ── STEP: career interest ── */}
          {phase === 'interest' && (
            <div key="interest" className="animate-view-fade">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{t('ob_interest_title')}</h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                {suggested.length > 0 ? t('ob_interest_desc_suggested') : t('ob_interest_desc')}
              </p>
              <div className="mt-6 flex flex-wrap gap-2.5">
                {CAREER_FIELDS.map((field) => {
                  const active = selectedFields.includes(field.id);
                  const isSuggested = suggested.includes(field.id);
                  return (
                    <button
                      key={field.id}
                      type="button"
                      onClick={() => toggleField(field.id)}
                      aria-pressed={active}
                      className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors ${
                        active
                          ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-900/30 dark:text-blue-300'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-blue-800 dark:hover:bg-blue-900/20'
                      }`}
                    >
                      {isSuggested && <Sparkles className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />}
                      {t(`ob_field_${field.id}`)}
                    </button>
                  );
                })}
              </div>
              {suggested.length > 0 && (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('ob_interest_suggested_note')}
                </p>
              )}
              <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">{t('ob_interest_max_note')}</p>
              <button type="button" onClick={() => setPhase('consent')} className={`${primaryBtn} mt-8`}>
                {t('ob_continue')}
              </button>
            </div>
          )}

          {/* ── STEP: privacy consent (required before any persistence) ── */}
          {phase === 'consent' && (
            <div key="consent" className="animate-view-fade">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{t('ob_consent_title')}</h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{t('ob_consent_desc')}</p>

              {/* Summary of what will be saved */}
              <ul className="mt-6 space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-900">
                <li className="flex justify-between gap-3">
                  <span className="text-slate-500 dark:text-slate-400">{t('ob_summary_name')}</span>
                  <span className="min-w-0 break-words text-end font-semibold text-slate-900 dark:text-slate-100">{fullName}</span>
                </li>
                <li className="flex justify-between gap-3">
                  <span className="text-slate-500 dark:text-slate-400">{t('ob_summary_resume')}</span>
                  <span className="min-w-0 break-words text-end font-semibold text-slate-900 dark:text-slate-100">
                    {resumeSource ? t('ob_summary_provided') : t('ob_summary_skipped')}
                  </span>
                </li>
                <li className="flex justify-between gap-3">
                  <span className="text-slate-500 dark:text-slate-400">{t('ob_summary_interest')}</span>
                  <span className="min-w-0 break-words text-end font-semibold text-slate-900 dark:text-slate-100">
                    {selectedFields.length > 0
                      ? selectedFields.map((id) => t(`ob_field_${id}`)).join(' · ')
                      : t('ob_summary_skipped')}
                  </span>
                </li>
              </ul>

              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-100/60 p-4 text-xs leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400">
                {t('ob_ai_notice')}
              </div>

              <label className="mt-4 flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={consented}
                  required
                  onChange={(e) => setConsented(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                  {t('ob_consent_checkbox')}{' '}
                  <a href="/privacy.html" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 hover:underline dark:text-blue-400">
                    {t('ob_consent_policy_link')}
                  </a>
                </span>
              </label>

              {saveError && (
                <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-300 animate-panel-expand">
                  {t('ob_save_error')}
                </p>
              )}

              <button type="button" onClick={finish} disabled={!consented} className={`${primaryBtn} mt-6`}>
                {saveError ? t('ob_retry') : t('ob_finish')}
              </button>
            </div>
          )}

          {phase === 'finishing' && <TransitionScreen line={t('ob_finishing')} />}

          {/* ── DONE: completion state ── */}
          {phase === 'done' && (
            <div key="done" className="flex flex-col items-center py-12 text-center animate-fade-in">
              <div className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-emerald-100 bg-emerald-50 shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/40" aria-hidden="true">
                <CheckCircle2 className="h-14 w-14 text-emerald-600 dark:text-emerald-300" />
              </div>
              <h1 className="mt-6 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{t('ob_done_title')}</h1>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-500 dark:text-slate-400">{t('ob_done_desc')}</p>
              <button
                type="button"
                onClick={enterWorkspace}
                className={`${primaryBtn} mt-8 max-w-xs`}
              >
                {t('ob_enter_workspace')}
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default OnboardingFlow;
