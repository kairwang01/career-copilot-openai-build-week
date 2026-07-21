import React, { useEffect, useState } from 'react';
import { useMarketingI18n } from '../hooks/useMarketingI18n';

interface Step {
  title: string;
  description: string;
}

/**
 * Badge tone is an explicit field: preview copy is fully localized, so the
 * colour can no longer be inferred from the (English) status word.
 */
export type WorkflowPreviewTone = 'good' | 'warn' | 'bad';

export interface WorkflowPreviewRow {
  label: string;
  detail: string;
  status: string;
  tone: WorkflowPreviewTone;
}

export interface WorkflowPreview {
  label: string;
  scoreLabel: string;
  score: number;
  rows: WorkflowPreviewRow[];
}

interface WorkflowStepsProps {
  steps: Step[];
  /** Audience-specific preview panels, one per step. Defaults to the jobseeker
   *  set so the home page keeps working unchanged; the employer landing page
   *  passes its own set (otherwise employer steps showed candidate previews). */
  previews?: WorkflowPreview[];
}

type TFn = (key: string) => string;

export const workflowPreviewRow = (
  t: TFn,
  keyBase: string,
  tone: WorkflowPreviewTone,
): WorkflowPreviewRow => ({
  label: t(`${keyBase}_k`),
  detail: t(`${keyBase}_v`),
  status: t(`${keyBase}_s`),
  tone,
});

const jobseekerPreviews = (t: TFn): WorkflowPreview[] => [
  {
    label: t('site_wf_js_p1_label'),
    scoreLabel: t('site_wf_js_p1_score'),
    score: 72,
    rows: [
      workflowPreviewRow(t, 'site_wf_js_p1_r1', 'bad'),
      workflowPreviewRow(t, 'site_wf_js_p1_r2', 'warn'),
      workflowPreviewRow(t, 'site_wf_js_p1_r3', 'good'),
    ],
  },
  {
    label: t('site_wf_js_p2_label'),
    scoreLabel: t('site_wf_js_p2_score'),
    score: 84,
    rows: [
      workflowPreviewRow(t, 'site_wf_js_p2_r1', 'good'),
      workflowPreviewRow(t, 'site_wf_js_p2_r2', 'warn'),
      workflowPreviewRow(t, 'site_wf_js_p2_r3', 'good'),
    ],
  },
  {
    label: t('site_wf_js_p3_label'),
    scoreLabel: t('site_wf_js_p3_score'),
    score: 71,
    rows: [
      workflowPreviewRow(t, 'site_wf_js_p3_r1', 'good'),
      workflowPreviewRow(t, 'site_wf_js_p3_r2', 'bad'),
      workflowPreviewRow(t, 'site_wf_js_p3_r3', 'warn'),
    ],
  },
  {
    label: t('site_wf_js_p4_label'),
    scoreLabel: t('site_wf_js_p4_score'),
    score: 40,
    rows: [
      workflowPreviewRow(t, 'site_wf_js_p4_r1', 'good'),
      workflowPreviewRow(t, 'site_wf_js_p4_r2', 'bad'),
      workflowPreviewRow(t, 'site_wf_js_p4_r3', 'warn'),
    ],
  },
];

const TONE_CLASSES: Record<WorkflowPreviewTone, string> = {
  bad: 'border-red-200 bg-red-50 text-red-700',
  warn: 'border-amber-200 bg-amber-50 text-amber-700',
  good: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

export const WorkflowSteps: React.FC<WorkflowStepsProps> = ({ steps, previews }) => {
  const { t } = useMarketingI18n();
  const resolvedPreviews = previews ?? jobseekerPreviews(t);
  const [active, setActive] = useState(0);
  const preview = resolvedPreviews[active] ?? resolvedPreviews[0];

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActive((current) => (current + 1) % steps.length);
    }, 4200);

    return () => window.clearInterval(timer);
  }, [steps.length]);

  return (
    <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        {steps.map((step, i) => {
          const isActive = active === i;
          return (
            <button
              key={step.title}
              type="button"
              onClick={() => setActive(i)}
              className={`rounded-[var(--site-radius)] border p-4 text-left transition-colors ${
                isActive
                  ? 'border-[var(--site-action)] bg-[var(--site-surface)] shadow-sm'
                  : 'border-[var(--site-border)] bg-transparent hover:bg-[var(--site-surface)]'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="text-xs font-medium text-[var(--site-action)]">
                    {t('site_wf_step_n').replace('{n}', String(i + 1))}
                  </span>
                  <h3 className="font-semibold mt-1 mb-2">{step.title}</h3>
                </div>
                <span
                  className={`mt-1 h-2.5 w-2.5 rounded-full ${
                    isActive ? 'bg-[var(--site-action)]' : 'bg-[var(--site-border)]'
                  }`}
                  aria-hidden="true"
                />
              </div>
              <p className="text-sm text-[var(--site-text-muted)]">{step.description}</p>
            </button>
          );
        })}
      </div>

      <div className="rounded-[var(--site-radius)] border border-[var(--site-border)] bg-[var(--site-surface)] p-4 sm:p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium text-[var(--site-action)]">{preview.label}</p>
            <h3 className="mt-1 text-lg font-semibold">{steps[active]?.title}</h3>
          </div>
          <div className="rounded-[var(--site-radius)] border border-[var(--site-border)] bg-[var(--site-surface-muted)] px-4 py-3 min-w-32">
            <p className="text-xs text-[var(--site-text-muted)]">{preview.scoreLabel}</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-[var(--site-text)]">{preview.score}</p>
          </div>
        </div>

        <div className="mt-5 h-2 rounded-full bg-[var(--site-surface-muted)] overflow-hidden">
          <div className="h-full rounded-full bg-[var(--site-action)]" style={{ width: `${preview.score}%` }} />
        </div>

        <div className="mt-5 overflow-hidden rounded-[var(--site-radius)] border border-[var(--site-border)]">
          {preview.rows.map((row) => (
            <div key={`${row.label}-${row.detail}`} className="grid gap-2 border-b border-[var(--site-border)] p-3 last:border-b-0 sm:grid-cols-[0.35fr_1fr_auto] sm:items-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--site-text-muted)]">{row.label}</p>
              <p className="text-sm text-[var(--site-text)]">{row.detail}</p>
              <span className={`w-fit rounded border px-2 py-1 text-xs font-medium ${TONE_CLASSES[row.tone]}`}>
                {row.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
