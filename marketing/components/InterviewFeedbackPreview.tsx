import React from 'react';
import { interviewFeedback } from '../mock/interviewFeedback';
import { ToolPanelChrome } from './ToolPanelChrome';
import { ScoreBar } from './ScoreBar';

interface InterviewFeedbackPreviewProps {
  t: (key: string) => string;
}

export const InterviewFeedbackPreview: React.FC<InterviewFeedbackPreviewProps> = ({ t }) => {
  const f = interviewFeedback;
  const starRows = [
    { key: 'S', label: t('site_interview_star_s'), text: t('site_interview_sample_situation') },
    { key: 'T', label: t('site_interview_star_t'), text: t('site_interview_sample_task') },
    { key: 'A', label: t('site_interview_star_a'), text: t('site_interview_sample_action') },
    { key: 'R', label: t('site_interview_star_r'), text: t('site_interview_sample_result') },
  ];

  return (
    <ToolPanelChrome title={t('site_tool_interview')} subtitle={t('site_interview_session_subtitle')}>
      <p className="mb-4 text-sm font-medium">{t('site_interview_sample_question')}</p>
      <p className="mb-4 border-s-2 border-[var(--site-border)] ps-3 text-xs text-[var(--site-text-muted)]">
        {t('site_interview_sample_answer')}
      </p>
      <div className="grid sm:grid-cols-2 gap-2 mb-4">
        {starRows.map((row) => (
          <div key={row.key} className="text-xs p-2 rounded border border-[var(--site-border)] bg-[var(--site-surface-muted)]">
            <span className="font-semibold text-[var(--site-action)]">{row.label}</span>
            <span className="ms-1 text-[var(--site-text-muted)]">— {row.text}</span>
          </div>
        ))}
      </div>
      <div className="mb-3 p-3 rounded border border-[var(--site-gap)]/30 bg-[var(--site-gap-bg)] text-sm">
        <span className="font-medium text-[var(--site-gap)]">{t('site_interview_gap')}: </span>
        {t('site_interview_sample_missing')}
      </div>
      <ScoreBar label={t('site_interview_clarity')} value={f.clarityScore} tone="gap" />
      <p className="mt-3 text-xs text-[var(--site-text-muted)]">{t('site_interview_next')}: {t('site_interview_sample_next')}</p>
    </ToolPanelChrome>
  );
};
