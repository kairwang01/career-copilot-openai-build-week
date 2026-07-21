import React from 'react';
import { careerPathPlan, type TimelineStatus } from '../mock/careerPath';
import { ToolPanelChrome } from './ToolPanelChrome';
import { ScoreBar } from './ScoreBar';

interface CareerPathPreviewProps {
  t: (key: string) => string;
  compact?: boolean;
}

const statusLabel = (t: (k: string) => string, status: TimelineStatus) => {
  if (status === 'done') return t('site_timeline_done');
  if (status === 'in_progress') return t('site_timeline_in_progress');
  return t('site_timeline_pending');
};

const statusDot = (status: TimelineStatus) => {
  if (status === 'done') return 'bg-[var(--site-ready)]';
  if (status === 'in_progress') return 'bg-[var(--site-action)] ring-4 ring-[var(--site-action)]/20';
  return 'bg-[var(--site-border)]';
};

export const CareerPathPreview: React.FC<CareerPathPreviewProps> = ({ t, compact }) => {
  const plan = careerPathPlan;

  return (
    <ToolPanelChrome
      title={t('site_tool_career_path')}
      subtitle={`${plan.currentRole} → ${plan.targetRole}`}
    >
      <div className="mb-6">
        <p className="text-xs font-medium text-[var(--site-text-muted)] mb-3">{t('site_career_timeline')}</p>
        <div className="space-y-0">
          {plan.timeline.map((step, i) => (
            <div key={step.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className={`w-3 h-3 rounded-full shrink-0 mt-1 ${statusDot(step.status)}`} />
                {i < plan.timeline.length - 1 && (
                  <div className="w-px flex-1 min-h-[2rem] bg-[var(--site-border)] my-1" />
                )}
              </div>
              <div className="pb-4 min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{step.label}</p>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--site-surface-muted)] text-[var(--site-text-muted)]">
                    {statusLabel(t, step.status)}
                  </span>
                </div>
                {step.detail && (
                  <p className="text-xs text-[var(--site-text-muted)] mt-0.5">{step.detail}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4 mb-5">
        {plan.skillGaps.map((g) => (
          <ScoreBar
            key={g.skill}
            label={g.skill}
            value={g.progress}
            tone={g.priority === 'high' ? 'gap' : 'neutral'}
          />
        ))}
      </div>

      {!compact && (
        <div className="border-t border-[var(--site-border)] pt-4">
          <p className="text-xs font-medium text-[var(--site-text-muted)] mb-3">
            {t('site_career_four_week_plan')}
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            {plan.fourWeekPlan.map((w) => (
              <div
                key={w.week}
                className={`border rounded-[var(--site-radius)] p-3 ${
                  w.status === 'in_progress'
                    ? 'border-[var(--site-action)] bg-[var(--site-surface-muted)]'
                    : 'border-[var(--site-border)]'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-[var(--site-action)] text-white text-xs flex items-center justify-center font-medium shrink-0">
                      {w.week}
                    </span>
                    <span className="text-sm font-medium">{w.focus}</span>
                  </div>
                  <span className="text-[10px] text-[var(--site-text-muted)] shrink-0">
                    {statusLabel(t, w.status)}
                  </span>
                </div>
                <ul className="mt-2 space-y-1 text-xs text-[var(--site-text-muted)]">
                  {w.tasks.map((task) => (
                    <li key={task}>· {task}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </ToolPanelChrome>
  );
};
