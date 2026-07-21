import React from 'react';
import { MailCheck } from 'lucide-react';
import {
  BlockedRegenerateButton,
  canExportQualityGate,
  QualityGateNotice,
  type QualityCopyFn,
  type QualityValidationStatus,
  useQualityGateCopy,
  hasFinishedEnding,
} from './QualityGate';
import { CopyButton, DownloadButtons } from './ToolUtils';

export type EmailValidationStatus = QualityValidationStatus;

export interface EmailValidation {
  status: EmailValidationStatus;
  issues: string[];
}

const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const hasCjkText = (text: string) => /[\u3040-\u30ff\u3400-\u9fff]/.test(text);

export const assessEmailDraft = (subject: string, body: string): EmailValidation => {
  const normalizedSubject = subject.replace(/[ \t]+/g, ' ').trim();
  const normalizedBody = body.replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').trim();
  const combined = `${normalizedSubject}\n\n${normalizedBody}`.trim();

  if (!normalizedSubject && !normalizedBody) return { status: 'needs_regen', issues: ['empty'] };

  const issues: string[] = [];
  const bodyWordCount = countWords(normalizedBody);

  if (!normalizedSubject) issues.push('missing_subject');
  if (!normalizedBody) issues.push('missing_body');

  if (normalizedSubject.length > 120) issues.push('long_subject');
  if (hasCjkText(normalizedBody)) {
    if (normalizedBody.length < 80) issues.push('too_short');
  } else if (bodyWordCount < 45) {
    issues.push('too_short');
  }

  if (/\[[^\]]{2,}\]|\{\{[^}]+\}\}|<[^>\n]{2,}>/.test(combined)) {
    issues.push('placeholder');
  }

  if (/\b(?:Your Name|Recipient Name|Company Name|Job Title|Hiring Manager|Interviewer Name|Contact Person)\b/i.test(combined)) {
    issues.push('placeholder');
  }

  if (/specific (?:detail|reason|achievement|next step|action)|measurable or clear outcome|insert (?:detail|context|name)|customize this/i.test(combined)) {
    issues.push('template_language');
  }

  if (normalizedBody && !hasFinishedEnding(normalizedBody)) issues.push('unfinished_ending');
  if (!hasCjkText(normalizedBody) && bodyWordCount > 260) issues.push('too_long');

  const uniqueIssues = Array.from(new Set(issues));
  const blockingIssues = uniqueIssues.filter((issue) => !['long_subject', 'too_long'].includes(issue));
  if (blockingIssues.length > 0) return { status: 'needs_regen', issues: uniqueIssues };
  if (uniqueIssues.length > 0) return { status: 'warn', issues: uniqueIssues };
  return { status: 'ok', issues: [] };
};

export const canExportEmail = (validation: EmailValidation): boolean =>
  canExportQualityGate(validation);

export const emailIssueLabel = (issue: string, copy?: QualityCopyFn): string => {
  const labels: Record<string, { key: string; fallback: string }> = {
    empty: { key: 'quality_email_empty', fallback: 'No email draft was generated.' },
    missing_subject: { key: 'quality_email_missing_subject', fallback: 'Add a specific subject line.' },
    missing_body: { key: 'quality_email_missing_body', fallback: 'Add an email body.' },
    too_short: { key: 'quality_email_too_short', fallback: 'The draft is too short to send.' },
    placeholder: { key: 'quality_issue_placeholder', fallback: 'Placeholders are still present.' },
    template_language: { key: 'quality_issue_template_language', fallback: 'Template instructions are still visible.' },
    unfinished_ending: { key: 'quality_email_unfinished_ending', fallback: 'The draft appears unfinished.' },
    long_subject: { key: 'quality_email_long_subject', fallback: 'The subject is long; trim it before sending.' },
    too_long: { key: 'quality_email_too_long', fallback: 'The email is long; trim it before sending.' },
  };
  const label = labels[issue];
  if (!label) return issue.replace(/_/g, ' ');
  return copy ? copy(label.key, label.fallback) : label.fallback;
};

interface EmailExportGateProps {
  validation: EmailValidation;
  text: string;
  copyLabel: string;
  copiedLabel: string;
  regenerateLabel: string;
  onRegenerate: () => void;
}

export const EmailExportGate: React.FC<EmailExportGateProps> = ({
  validation,
  text,
  copyLabel,
  copiedLabel,
  regenerateLabel,
  onRegenerate,
}) => {
  if (!canExportEmail(validation)) {
    return (
      <BlockedRegenerateButton
        label={regenerateLabel}
        onClick={onRegenerate}
        dataQa="email-export-blocked-regenerate"
      />
    );
  }

  return (
    <>
      <CopyButton text={text} label={copyLabel} copiedLabel={copiedLabel} />
      <DownloadButtons textContent={text} baseFilename="email_draft" />
    </>
  );
};

interface EmailQualityNoticeProps {
  validation: EmailValidation;
}

export const EmailQualityNotice: React.FC<EmailQualityNoticeProps> = ({ validation }) => {
  const copy = useQualityGateCopy();
  return (
    <QualityGateNotice
      validation={validation}
      dataQa="email-quality-notice"
      statusDataAttribute="data-qa-email-quality"
      blockingTitle={copy('quality_draft_blocking_title', 'Fix this draft before exporting')}
      warningTitle={copy('quality_draft_warning_title', 'Review before sending')}
      issueLabel={(issue) => emailIssueLabel(issue, copy)}
      warningIcon={MailCheck}
    />
  );
};
