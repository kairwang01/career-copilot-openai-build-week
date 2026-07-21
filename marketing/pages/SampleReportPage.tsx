import React, { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { SiteLayout } from '../components/SiteLayout';
import { ReportPreview } from '../components/ReportPreview';
import { InterviewFeedbackPreview } from '../components/InterviewFeedbackPreview';
import { SiteButton } from '../components/SiteButton';
import { sampleReport } from '../mock/sampleReport';
import { SITE_ROUTES } from '../../config/site';
import { useMarketingI18n } from '../hooks/useMarketingI18n';

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--site-text-muted)] mb-2">
    {children}
  </p>
);

const scoreTone = (score: number) => {
  if (score >= 75) return 'text-[var(--site-ready)] bg-[var(--site-ready-bg)] border-[var(--site-ready)]/20';
  if (score >= 55) return 'text-[var(--site-gap)] bg-[var(--site-gap-bg)] border-[var(--site-gap)]/20';
  return 'text-[var(--site-risk)] bg-[var(--site-risk-bg)] border-[var(--site-risk)]/20';
};

const GENERATION_STEP_KEYS = [
  'site_sample_generation_step_1',
  'site_sample_generation_step_2',
  'site_sample_generation_step_3',
  'site_sample_generation_step_4',
] as const;

const ReportGenerationState: React.FC<{
  activeStep: number;
  onSkip: () => void;
  t: (key: string) => string;
}> = ({ activeStep, onSkip, t }) => {
  const generationSteps = GENERATION_STEP_KEYS.map((key) => t(key));
  const progress = Math.min(100, Math.round(((activeStep + 1) / generationSteps.length) * 100));

  return (
    <div className="rounded-[calc(var(--site-radius)*2)] border border-[var(--site-border)] bg-white p-5 sm:p-6 shadow-sm">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <SectionLabel>{t('site_sample_generating_label')}</SectionLabel>
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-[var(--site-border)] border-t-[var(--site-action)]" aria-hidden="true" />
            <h2 className="text-xl font-bold tracking-[-0.035em] text-[var(--site-text)] sm:text-2xl" role="status" aria-live="polite">
              {generationSteps[activeStep]}
            </h2>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--site-text-muted)]">
            {t('site_sample_generation_flow_desc')}
          </p>
        </div>
        <button
          type="button"
          onClick={onSkip}
          className="self-start rounded-[var(--site-radius)] border border-[var(--site-border)] px-3 py-2 text-sm font-semibold text-[var(--site-text-muted)] hover:bg-[var(--site-surface-muted)] hover:text-[var(--site-text)]"
        >
          {t('site_sample_show_report')}
        </button>
      </div>

      <div
        className="mt-6 h-2 overflow-hidden rounded-full bg-[var(--site-surface-muted)]"
        role="progressbar"
        aria-label={t('site_sample_generating_label')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <div
          className="h-full rounded-full bg-[var(--site-action)] transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        {generationSteps.map((step, index) => {
          const isDone = index < activeStep;
          const isActive = index === activeStep;

          return (
            <div
              key={step}
              className={`rounded-[var(--site-radius)] border p-3 text-sm ${
                isActive
                  ? 'border-[var(--site-action)] bg-blue-50 text-[var(--site-text)]'
                  : isDone
                    ? 'border-[var(--site-ready)]/20 bg-[var(--site-ready-bg)] text-[var(--site-text)]'
                    : 'border-[var(--site-border)] bg-[var(--site-surface-muted)] text-[var(--site-text-muted)]'
              }`}
            >
              <div className="flex items-center gap-2">
                {isDone ? (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-[var(--site-ready)]">
                    <Check className="h-3 w-3" aria-hidden="true" strokeWidth={2.5} />
                  </span>
                ) : isActive ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--site-border)] border-t-[var(--site-action)]" aria-hidden="true" />
                ) : (
                  <span className="h-4 w-4 rounded-full border border-[var(--site-border)] bg-white" />
                )}
                <span className="font-medium">{step}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-[var(--site-radius)] border border-[var(--site-border)] bg-[var(--site-surface-muted)] p-5">
          <div className="h-3 w-32 rounded-full bg-slate-200" />
          <div className="mt-5 space-y-3">
            <div className="h-3 w-full rounded-full bg-slate-200" />
            <div className="h-3 w-11/12 rounded-full bg-slate-200" />
            <div className="h-3 w-9/12 rounded-full bg-slate-200" />
          </div>
        </div>
        <div className="rounded-[var(--site-radius)] border border-[var(--site-border)] bg-[var(--site-surface-muted)] p-5">
          <div className="h-3 w-28 rounded-full bg-slate-200" />
          <div className="mt-5 grid grid-cols-[5rem_1fr] gap-4">
            <div className="h-20 rounded-[var(--site-radius)] bg-slate-200" />
            <div className="space-y-3">
              <div className="h-3 w-full rounded-full bg-slate-200" />
              <div className="h-3 w-10/12 rounded-full bg-slate-200" />
              <div className="h-3 w-7/12 rounded-full bg-slate-200" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const SampleReportPage: React.FC = () => {
  const { t } = useMarketingI18n();
  const [activeStep, setActiveStep] = useState(0);
  const [reportReady, setReportReady] = useState(false);
  const generationSteps = GENERATION_STEP_KEYS.map((key) => t(key));
  const targetRole = t('site_sample_target_role');
  const intro = t('site_sample_intro')
    .replace('{name}', sampleReport.candidateName)
    .replace('{role}', targetRole);
  // Report copy is localized; the illustrative sample RESUME body stays fixed
  // demo content (a real English-market resume is part of the demonstration).
  const analysisSummary = t('site_sample_analysis_summary');
  const strengths = [
    t('site_sample_strength_1'),
    t('site_sample_strength_2'),
    t('site_sample_strength_3'),
  ];
  const improvements = [
    { area: t('site_sample_improve_1_area'), suggestion: t('site_sample_improve_1_tip') },
    { area: t('site_sample_improve_2_area'), suggestion: t('site_sample_improve_2_tip') },
    { area: t('site_sample_improve_3_area'), suggestion: t('site_sample_improve_3_tip') },
  ];

  useEffect(() => {
    if (reportReady) return;

    const timers = GENERATION_STEP_KEYS.map((_, index) =>
      window.setTimeout(() => {
        setActiveStep(index);
      }, index * 750),
    );
    const readyTimer = window.setTimeout(() => {
      setReportReady(true);
    }, GENERATION_STEP_KEYS.length * 750 + 350);

    return () => {
      timers.forEach(window.clearTimeout);
      window.clearTimeout(readyTimer);
    };
  }, [reportReady]);

  return (
    <SiteLayout pageId="sample-report">
      <section className="bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_52%,#f8fafc_100%)] py-10 sm:py-16 lg:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-8 sm:mb-12">
          <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
            <div>
              <p className="inline-flex rounded-full border border-[var(--site-border)] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--site-text-muted)]">
                {t('site_sample_simulated_submission')}
              </p>
              <h1 className="mt-5 max-w-3xl text-balance text-[clamp(2rem,4vw,3.5rem)] font-bold leading-[1.08] tracking-[-0.045em] text-[var(--site-text)]">
                {t('site_sample_title')}
              </h1>
              <p className="mt-4 max-w-2xl text-base sm:text-lg leading-8 text-[var(--site-text-muted)]">{intro}</p>
            </div>
            <div className="rounded-[calc(var(--site-radius)*2)] border border-[var(--site-border)] bg-white p-5 shadow-sm">
              <SectionLabel>{t('site_sample_submission_label')}</SectionLabel>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-[var(--site-text-muted)]">{t('site_sample_candidate_label')}</p>
                  <p className="mt-1 font-semibold text-[var(--site-text)]">{sampleReport.candidateName}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--site-text-muted)]">{t('site_sample_target_role_label')}</p>
                  <p className="mt-1 font-semibold text-[var(--site-text)]">{targetRole}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--site-text-muted)]">{t('site_sample_status_label')}</p>
                  <p className={`mt-1 font-semibold ${reportReady ? 'text-[var(--site-ready)]' : 'text-[var(--site-action)]'}`}>
                    {reportReady ? t('site_sample_analysis_complete') : generationSteps[activeStep]}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
          {!reportReady ? (
            <ReportGenerationState activeStep={activeStep} onSkip={() => setReportReady(true)} t={t} />
          ) : (
          <>
          <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr] animate-fade-in">
            <div className="rounded-[calc(var(--site-radius)*2)] border border-[var(--site-border)] bg-white p-5 sm:p-6 shadow-sm">
              <SectionLabel>{t('site_sample_resume_excerpt_label')}</SectionLabel>
              <p className="mb-4 text-xs leading-5 text-[var(--site-text-muted)]">
                {t('site_sample_english_market_note')}
              </p>
              <div className="space-y-4 text-sm leading-7 text-[var(--site-text-muted)]">
                <div>
                  <p className="font-semibold text-[var(--site-text)]">Software Developer</p>
                  <p>Led billing workflow redesign with engineering and design partners; built internal tooling for support operations.</p>
                </div>
                <div>
                  <p className="font-semibold text-[var(--site-text)]">Selected achievements</p>
                  <ul className="mt-2 list-disc space-y-1 ps-5">
                    <li>Worked cross-functionally across product, design, and customer support.</li>
                    <li>Used SQL and Jira to track workflow blockers and release readiness.</li>
                    <li>Reduced support tickets after launching billing improvements.</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="rounded-[calc(var(--site-radius)*2)] border border-[var(--site-border)] bg-white p-5 sm:p-6 shadow-sm">
              <SectionLabel>{t('analysis_results_title')}</SectionLabel>
              <div className="grid gap-5 sm:grid-cols-[12rem_1fr] sm:items-center">
                <div className={`rounded-[calc(var(--site-radius)*2)] border p-5 text-center ${scoreTone(sampleReport.atsReadiness)}`}>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em]">{t('site_sample_overall_score')}</p>
                  <p className="mt-2 text-6xl font-bold tracking-[-0.06em]">{sampleReport.atsReadiness}</p>
                  <p className="text-xs font-medium">{t('analysis_score_subtitle')}</p>
                </div>
                <div>
                  <h2 className="text-2xl font-bold tracking-[-0.035em] text-[var(--site-text)]">
                    {t('site_sample_fit_headline')}
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-[var(--site-text-muted)]">{analysisSummary}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {sampleReport.bridgeRoles.map((role) => (
                      <span key={role} className="rounded-full border border-[var(--site-border)] bg-[var(--site-surface-muted)] px-3 py-1 text-xs font-medium text-[var(--site-text)]">
                        {role}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <ReportPreview t={t} />

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-[calc(var(--site-radius)*2)] border border-[var(--site-ready)]/25 bg-[var(--site-ready-bg)] p-5 sm:p-6">
              <SectionLabel>{t('analysis_strengths_title')}</SectionLabel>
              <ul className="space-y-3 text-sm leading-6 text-[var(--site-text)]">
                {strengths.map((item) => (
                  <li key={item} className="flex gap-3">
                    <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[var(--site-ready)]">
                      <Check className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={2.5} />
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-[calc(var(--site-radius)*2)] border border-[var(--site-gap)]/25 bg-[var(--site-gap-bg)] p-5 sm:p-6">
              <SectionLabel>{t('analysis_improvements_title')}</SectionLabel>
              <ul className="space-y-3 text-sm leading-6 text-[var(--site-text)]">
                {improvements.map((item) => (
                  <li key={item.area}>
                    <span className="font-semibold">{item.area}: </span>
                    {item.suggestion}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div>
            <SectionLabel>{t('site_sample_rewrite')}</SectionLabel>
            <div className="border border-[var(--site-border)] rounded-[calc(var(--site-radius)*2)] p-5 sm:p-6 bg-white shadow-sm">
              <p className="text-sm leading-relaxed">{t('site_sample_rewrite_example')}</p>
            </div>
          </div>

          <InterviewFeedbackPreview t={t} />

          <div className="rounded-[calc(var(--site-radius)*2)] border border-[var(--site-border)] bg-[var(--site-text)] p-6 text-center text-white">
            <h2 className="text-2xl font-bold tracking-[-0.035em]">{t('site_sample_cta_title')}</h2>
            <p className="mt-2 text-sm text-white/70">{t('site_sample_cta_desc')}</p>
            <SiteButton href={SITE_ROUTES.workspace} className="mt-5 w-full sm:w-auto sm:mx-auto sm:flex justify-center">
              {t('site_cta_upload_resume')}
            </SiteButton>
          </div>
          </>
          )}
        </div>
      </section>
    </SiteLayout>
  );
};
