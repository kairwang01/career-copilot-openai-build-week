import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Briefcase, FileText, GraduationCap, CheckCircle2, AlertCircle, Loader2, X, ShieldCheck, Target } from 'lucide-react';
import { ViewportAwareDialog } from './ViewportAwareDialog';
import { loadTalentProfile } from '../services/talentProfile';
import { isTalentProfileReady, hasMeaningfulEntry, type TalentProfile } from '../lib/talentProfile';
import { collectCandidateSkills, matchSkills } from '../lib/skillMatch';
import { data } from '../lib/data';
import type { ScreenerQuestion } from '../lib/recruitingData';

export interface ApplyReviewJob {
  id: string;
  title: string;
  company?: string;
  /** Structured requirements (when known) so the candidate sees their fit pre-submit. */
  requiredSkills?: string[];
  experienceLevel?: string | null;
  workMode?: string | null;
  /** Indeed/LinkedIn-style screener questions the candidate answers before submitting. */
  screenerQuestions?: ScreenerQuestion[];
}

interface ApplyReviewModalProps {
  open: boolean;
  job: ApplyReviewJob | null;
  uid: string;
  t: (key: string) => string;
  /** Performs the real submission (createJobApplication) with the screener answers. */
  onConfirm: (answers: { questionId: string; answer: string }[]) => Promise<void>;
  onClose: () => void;
  /** Optional: jump to the Talent Profile editor (used when info is incomplete). */
  onEditProfile?: () => void;
}

const countMeaningful = (list: Record<string, string | string[]>[] | undefined): number =>
  Array.isArray(list) ? list.filter(hasMeaningfulEntry).length : 0;

const countSkills = (profile: TalentProfile | null): number =>
  profile ? Object.values(profile.skills ?? {}).reduce((sum, group) => sum + (group?.length ?? 0), 0) : 0;

/**
 * Pre-submit confirmation: before a candidate's application is actually created,
 * they re-review exactly what the employer will receive (name, resume, structured
 * Talent Profile) and explicitly confirm. Used by every apply entry point so the
 * "review then submit" step is consistent across the product.
 */
const ApplyReviewModal: React.FC<ApplyReviewModalProps> = ({ open, job, uid, t, onConfirm, onClose, onEditProfile }) => {
  const [profile, setProfile] = useState<TalentProfile | null>(null);
  const [resumeFileName, setResumeFileName] = useState<string | null>(null);
  const [hasResumeText, setHasResumeText] = useState(false);
  const [resumeSnippet, setResumeSnippet] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  // Keep the body-scroll lock for the whole time the modal is open (not just
  // while idle); only suppress Esc-to-close mid-submit via the guard.
  const handleModalClose = useCallback(() => { if (!submitting) onClose(); }, [submitting, onClose]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setLoadError(false);
    setProfile(null);
    setResumeFileName(null);
    setHasResumeText(false);
    setResumeSnippet('');
    setAnswers({});
    Promise.all([loadTalentProfile(uid), data.profiles.get(uid)])
      .then(([tp, profileRes]) => {
        if (!active) return;
        // data.profiles.get resolves with { error } instead of throwing — treat a
        // real read error as a load failure rather than silently showing "no resume".
        if (profileRes.error) { setLoadError(true); setLoading(false); return; }
        setProfile(tp);
        const user = profileRes.data;
        setResumeFileName(user?.resume_file_name ?? null);
        const text = (user?.resume_text ?? '').trim();
        setHasResumeText(text.length > 0);
        setResumeSnippet(text.length > 180 ? `${text.slice(0, 180).trim()}…` : text);
        setLoading(false);
      })
      .catch(() => {
        if (active) { setLoadError(true); setLoading(false); }
      });
    return () => { active = false; };
    // Keyed on job.id too: if the parent swaps the job while the modal stays open, the
    // screener answers must reset — otherwise the prior job's answers ride into the new one.
  }, [open, uid, job?.id]);

  const ready = useMemo(() => isTalentProfileReady(profile), [profile]);
  const hasResume = Boolean(resumeFileName) || hasResumeText;
  const screenerQuestions = job?.screenerQuestions ?? [];
  const requiredUnanswered = screenerQuestions.some((q) => q.required && !(answers[q.id] ?? '').trim());
  // A resume is required to apply — HR review depends on it (server re-enforces).
  const canSubmit = ready && hasResume && !requiredUnanswered;
  const name = profile?.basic?.name?.trim() || '';
  const targetRole = typeof profile?.intention?.targetRole === 'string' ? profile.intention.targetRole.trim() : '';
  const eduCount = countMeaningful(profile?.education);
  const expCount = countMeaningful(profile?.experience);
  const projCount = countMeaningful(profile?.projects);
  const skillCount = countSkills(profile);
  // Latest experience = first meaningful entry — shown as a real preview line.
  const topExp = (profile?.experience ?? []).find(hasMeaningfulEntry);
  const topExpLabel = topExp
    ? [topExp.role, topExp.company].map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean).join(' · ')
    : '';

  // Deterministic (no-AI) skill fit vs the job's required skills — same signal the
  // employer sees in the applicant packet, so the candidate isn't surprised later.
  const skillFit = useMemo(
    () => matchSkills(collectCandidateSkills(profile), job?.requiredSkills),
    [profile, job?.requiredSkills],
  );

  if (!open || !job) return null;

  const handleConfirm = async () => {
    if (submitting || !canSubmit) return;
    setSubmitting(true);
    try {
      await onConfirm(screenerQuestions.map((q) => ({ questionId: q.id, answer: (answers[q.id] ?? '').trim() })));
    } finally {
      // The parent closes the modal on success; reset so a re-open is clean.
      setSubmitting(false);
    }
  };

  const handleEdit = () => {
    onClose();
    onEditProfile?.();
  };

  const resumeStatus = resumeFileName
    ? resumeFileName
    : hasResumeText
      ? t('apply_review_resume_text_only')
      : t('apply_review_resume_none');
  const incompleteReasonId = 'apply-review-incomplete-reasons';

  return (
    <ViewportAwareDialog
      open={open}
      onClose={handleModalClose}
      closeOnBackdrop={!submitting}
      closeOnEscape={!submitting}
      labelledBy="apply-review-title"
      maxWidth={448}
      zIndex={95}
    >
      <div className="rounded-2xl bg-white shadow-2xl dark:bg-slate-800">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-700 px-5 py-4">
          <div className="min-w-0">
            <h2 id="apply-review-title" className="text-base font-bold text-slate-900 dark:text-slate-100">
              {t('apply_review_title')}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{t('apply_review_subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label={t('apply_review_cancel')}
            className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Job */}
        <div className="px-5 pt-4">
          <div className="flex items-center gap-2.5 rounded-xl bg-blue-50 px-3 py-2.5 dark:bg-blue-950/30">
            <Briefcase className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-300" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{job.title}</p>
              {job.company && <p className="truncate text-xs text-slate-500 dark:text-slate-400">{job.company}</p>}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500 dark:text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('apply_review_loading')}
            </div>
          ) : loadError ? (
            <div className="py-8 text-center">
              <AlertCircle className="mx-auto h-8 w-8 text-amber-500" />
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{t('apply_review_load_error')}</p>
            </div>
          ) : (
            <>
              {/* What the employer will receive */}
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {t('apply_review_section_profile')}
              </p>
              <dl className="space-y-2.5 rounded-xl border border-slate-200 p-3.5 dark:border-slate-700">
                <Row label={t('apply_review_name')} value={name || '—'} />
                <Row label={t('apply_review_target_role')} value={targetRole || '—'} />
                {topExpLabel && <Row label={t('apply_review_latest_experience')} value={topExpLabel} icon={<Briefcase className="h-3.5 w-3.5 text-slate-400" />} />}
                <Row
                  label={t('apply_review_resume')}
                  value={resumeStatus}
                  icon={<FileText className="h-3.5 w-3.5 text-slate-400" />}
                />
                {resumeSnippet && (
                  <p className="rounded-lg bg-slate-50 px-2.5 py-2 text-xs italic leading-5 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">“{resumeSnippet}”</p>
                )}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Stat icon={<GraduationCap className="h-3.5 w-3.5" />} label={t('apply_review_education')} count={eduCount} />
                  <Stat icon={<Briefcase className="h-3.5 w-3.5" />} label={t('apply_review_experience')} count={expCount} />
                  <Stat label={t('apply_review_projects')} count={projCount} />
                  <Stat label={t('apply_review_skills')} count={skillCount} />
                </div>
              </dl>

              {/* Structured fit vs this role's required skills (when the job has them) */}
              {skillFit.requiredCount > 0 && (
                <div className="mt-3 rounded-xl border border-slate-200 p-3.5 dark:border-slate-700">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    <Target className="h-3.5 w-3.5" />
                    {t('apply_review_match_title').replace('{matched}', String(skillFit.matchedCount)).replace('{total}', String(skillFit.requiredCount))}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {skillFit.matched.map((s) => (
                      <span key={`m-${s}`} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                        <CheckCircle2 className="h-3 w-3" />{s}
                      </span>
                    ))}
                    {skillFit.missing.map((s) => (
                      <span key={`x-${s}`} className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                        {s}
                      </span>
                    ))}
                  </div>
                  {skillFit.missing.length > 0 && (
                    <p className="mt-2 text-[11px] leading-4 text-slate-500 dark:text-slate-400">{t('apply_review_match_gap_hint')}</p>
                  )}
                </div>
              )}

              {/* Screener questions (Indeed/LinkedIn Easy-Apply style) */}
              {screenerQuestions.length > 0 && (
                <div className="mt-3 rounded-xl border border-slate-200 p-3.5 dark:border-slate-700">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    {t('apply_review_screener_title')}
                  </p>
                  <div className="mt-2 space-y-3">
                    {screenerQuestions.map((q) => {
                      const labelId = `apply-screener-label-${q.id}`;
                      const inputId = `apply-screener-answer-${q.id}`;
                      return (
                        <div key={q.id}>
                          {q.type === 'yes_no' ? (
                            <>
                              <p id={labelId} className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                                {q.prompt}{q.required && <span aria-hidden="true" className="text-red-500"> *</span>}
                              </p>
                              <div className="mt-1.5 flex gap-2" role="group" aria-labelledby={labelId} aria-required={q.required || undefined}>
                                {(['yes', 'no'] as const).map((opt) => (
                                  <button
                                    key={opt}
                                    type="button"
                                    onClick={() => setAnswers((a) => ({ ...a, [q.id]: opt }))}
                                    aria-pressed={answers[q.id] === opt}
                                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                                      answers[q.id] === opt
                                        ? 'border-blue-600 bg-blue-600 text-white'
                                        : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300'
                                    }`}
                                  >
                                    {t(opt === 'yes' ? 'apply_review_screener_yes' : 'apply_review_screener_no')}
                                  </button>
                                ))}
                              </div>
                            </>
                          ) : (
                            <>
                              <label id={labelId} htmlFor={inputId} className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                                {q.prompt}{q.required && <span aria-hidden="true" className="text-red-500"> *</span>}
                              </label>
                              <input
                                id={inputId}
                                type="text"
                                value={answers[q.id] ?? ''}
                                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                                aria-labelledby={labelId}
                                aria-required={q.required || undefined}
                                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                              />
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {!canSubmit && (
                <div id={incompleteReasonId} className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 dark:border-amber-900/50 dark:bg-amber-950/20">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-200">
                    <AlertCircle className="h-4 w-4" />
                    {t('apply_review_incomplete_title')}
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-amber-800/90 dark:text-amber-200/90">
                    {!name && <li>• {t('apply_review_need_name')}</li>}
                    {!targetRole && <li>• {t('apply_review_need_target')}</li>}
                    {eduCount === 0 && expCount === 0 && <li>• {t('apply_review_need_history')}</li>}
                    {!hasResume && <li>• {t('apply_review_need_resume')}</li>}
                    {requiredUnanswered && <li>• {t('apply_review_need_screener')}</li>}
                  </ul>
                  {!onEditProfile && (
                    <p className="mt-2 text-xs font-medium text-amber-800/90 dark:text-amber-200/90">{t('apply_review_sidebar_hint')}</p>
                  )}
                </div>
              )}

              <p className="mt-3 flex items-start gap-1.5 text-xs leading-5 text-slate-500 dark:text-slate-400">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                {t('apply_review_employer_note')}
              </p>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3.5 dark:border-slate-700">
          {!loading && !loadError && !canSubmit && onEditProfile && (
            <button
              type="button"
              onClick={handleEdit}
              className="mr-auto text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400"
            >
              {t('apply_review_edit_profile')}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            {t('apply_review_cancel')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting || loading || loadError || !canSubmit}
            aria-describedby={!canSubmit && !loading && !loadError ? incompleteReasonId : undefined}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-600"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('apply_review_submitting')}
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                {t('apply_review_confirm')}
              </>
            )}
          </button>
        </div>
      </div>
    </ViewportAwareDialog>
  );
};

const Row: React.FC<{ label: string; value: string; icon?: React.ReactNode }> = ({ label, value, icon }) => (
  <div className="flex items-center justify-between gap-3">
    <dt className="shrink-0 text-xs font-medium text-slate-400 dark:text-slate-500">{label}</dt>
    <dd className="flex min-w-0 items-center gap-1.5 truncate text-sm font-medium text-slate-800 dark:text-slate-200">
      {icon}
      <span className="truncate">{value}</span>
    </dd>
  </div>
);

const Stat: React.FC<{ label: string; count: number; icon?: React.ReactNode }> = ({ label, count, icon }) => (
  <span
    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
      count > 0
        ? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200'
        : 'bg-slate-50 text-slate-400 dark:bg-slate-800 dark:text-slate-500'
    }`}
  >
    {icon}
    {label}: {count}
  </span>
);

export default ApplyReviewModal;
