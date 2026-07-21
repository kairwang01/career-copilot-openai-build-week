import React from 'react';
import { Copy } from 'lucide-react';
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

export type CoverLetterValidationStatus = QualityValidationStatus;

export interface CoverLetterValidation {
  status: CoverLetterValidationStatus;
  issues: string[];
}

const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const hasCjkText = (text: string) => /[\u3040-\u30ff\u3400-\u9fff]/.test(text);

export const assessCoverLetterDraft = (text: string): CoverLetterValidation => {
  const normalized = text.replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').trim();
  if (!normalized) return { status: 'needs_regen', issues: ['empty'] };

  const issues: string[] = [];
  const paragraphs = normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const wordCount = countWords(normalized);

  if (hasCjkText(normalized)) {
    if (normalized.length < 220) issues.push('too_short');
  } else if (wordCount < 90) {
    issues.push('too_short');
  }

  if (/\[[^\]]{2,}\]|\{\{[^}]+\}\}|<[^>\n]{2,}>/.test(normalized)) {
    issues.push('placeholder');
  }

  if (/\b(?:Your Name|Your Address|Your Email|Your Phone Number|Company Name|Job Title|Hiring Manager Name)\b/i.test(normalized)) {
    issues.push('placeholder');
  }

  if (/specific (?:action|project|achievement|skill area|reason)|measurable or clear outcome|relevant skill area/i.test(normalized)) {
    issues.push('template_language');
  }

  if (paragraphs.length < 3) issues.push('thin_structure');
  if (!hasFinishedEnding(normalized)) issues.push('unfinished_ending');
  if (!hasCjkText(normalized) && wordCount > 520) issues.push('too_long');

  const blockingIssues = issues.filter((issue) => issue !== 'too_long');
  if (blockingIssues.length > 0) return { status: 'needs_regen', issues: Array.from(new Set(issues)) };
  if (issues.length > 0) return { status: 'warn', issues: Array.from(new Set(issues)) };
  return { status: 'ok', issues: [] };
};

export const canExportCoverLetter = (validation: CoverLetterValidation): boolean =>
  canExportQualityGate(validation);

export const coverLetterIssueLabel = (issue: string, copy?: QualityCopyFn): string => {
  const labels: Record<string, { key: string; fallback: string }> = {
    empty: { key: 'quality_cover_letter_empty', fallback: 'No cover letter text was generated.' },
    too_short: { key: 'quality_cover_letter_too_short', fallback: 'The draft is too short to send.' },
    placeholder: { key: 'quality_issue_placeholder', fallback: 'Placeholders are still present.' },
    template_language: { key: 'quality_issue_template_language', fallback: 'Template instructions are still visible.' },
    thin_structure: { key: 'quality_cover_letter_thin_structure', fallback: 'The draft needs a clearer opening, body, and close.' },
    unfinished_ending: { key: 'quality_cover_letter_unfinished_ending', fallback: 'The draft appears unfinished.' },
    too_long: { key: 'quality_cover_letter_too_long', fallback: 'The draft is long; trim it before sending.' },
  };
  const label = labels[issue];
  if (!label) return issue.replace(/_/g, ' ');
  return copy ? copy(label.key, label.fallback) : label.fallback;
};

interface CoverLetterExportGateProps {
  validation: CoverLetterValidation;
  text: string;
  copyLabel: string;
  copiedLabel: string;
  regenerateLabel: string;
  onRegenerate: () => void;
}

export const CoverLetterExportGate: React.FC<CoverLetterExportGateProps> = ({
  validation,
  text,
  copyLabel,
  copiedLabel,
  regenerateLabel,
  onRegenerate,
}) => {
  if (!canExportCoverLetter(validation)) {
    return (
      <BlockedRegenerateButton
        label={regenerateLabel}
        onClick={onRegenerate}
        dataQa="cover-letter-export-blocked-regenerate"
      />
    );
  }

  return (
    <>
      <CopyButton text={text} label={copyLabel} copiedLabel={copiedLabel} />
      <DownloadButtons textContent={text} baseFilename="cover_letter" />
    </>
  );
};

interface CoverLetterQualityNoticeProps {
  validation: CoverLetterValidation;
}

export const CoverLetterQualityNotice: React.FC<CoverLetterQualityNoticeProps> = ({ validation }) => {
  const copy = useQualityGateCopy();
  return (
    <QualityGateNotice
      validation={validation}
      dataQa="cover-letter-quality-notice"
      statusDataAttribute="data-qa-cover-letter-quality"
      blockingTitle={copy('quality_draft_blocking_title', 'Fix this draft before exporting')}
      warningTitle={copy('quality_draft_warning_title', 'Review before sending')}
      issueLabel={(issue) => coverLetterIssueLabel(issue, copy)}
      warningIcon={Copy}
    />
  );
};
