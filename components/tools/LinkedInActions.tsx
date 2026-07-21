import React from 'react';
import { Link2 } from 'lucide-react';
import type { LinkedInOptimization } from '../../types';
import {
  BlockedRegenerateButton,
  canExportQualityGate,
  QualityGateNotice,
  type QualityCopyFn,
  type QualityValidationStatus,
  useQualityGateCopy,
  hasFinishedEnding,
} from './QualityGate';
import { DownloadButtons } from './ToolUtils';

export type LinkedInValidationStatus = QualityValidationStatus;

export interface LinkedInValidation {
  status: LinkedInValidationStatus;
  issues: string[];
}

const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const hasCjkText = (text: string) => /[\u3040-\u30ff\u3400-\u9fff]/.test(text);

const normalize = (text: string | undefined) =>
  (text || '').replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').trim();

const hasPlaceholder = (text: string) => (
  /\[[^\]]{2,}\]|\{\{[^}]+\}\}|<[^>\n]{2,}>/.test(text) ||
  /\b(?:Your Name|Current Role|Target Role|Company Name|Job Title|Employer Name|specific achievement|relevant skill)\b/i.test(text)
);

const hasTemplateLanguage = (text: string) =>
  /specific (?:achievement|metric|result|skill|keyword|role)|insert (?:metric|achievement|keyword|role)|measurable result|customize this/i.test(text);

export const buildLinkedInDownloadText = (
  result: LinkedInOptimization,
  labels: { headline: string; summary: string; experience: string },
) => [
  `## ${labels.headline}\n${result.headline || ''}`,
  `\n## ${labels.summary}\n${result.summary || ''}`,
  `\n## ${labels.experience}`,
  ...(Array.isArray(result.experienceSuggestions)
    ? result.experienceSuggestions.map((item) => `\n**${item.title || ''}**\n${item.suggestion || ''}`)
    : []),
].join('\n');

export const assessLinkedInOptimization = (result: Partial<LinkedInOptimization> | null | undefined): LinkedInValidation => {
  if (!result) return { status: 'needs_regen', issues: ['empty'] };

  const headline = normalize(result.headline);
  const summary = normalize(result.summary);
  const suggestions = Array.isArray(result.experienceSuggestions) ? result.experienceSuggestions : [];
  const suggestionBodies = suggestions.map((item) => normalize(item?.suggestion)).filter(Boolean);
  const combined = [
    headline,
    summary,
    ...suggestions.flatMap((item) => [normalize(item?.title), normalize(item?.suggestion)]),
  ].join('\n');

  if (!headline && !summary && suggestionBodies.length === 0) return { status: 'needs_regen', issues: ['empty'] };

  const issues: string[] = [];
  if (!headline) issues.push('missing_headline');
  if (!summary) issues.push('missing_summary');
  if (suggestionBodies.length === 0) issues.push('missing_experience_suggestions');

  if (headline && headline.length < 24) issues.push('thin_headline');
  if (headline.length > 240) issues.push('long_headline');

  if (summary) {
    if (hasCjkText(summary)) {
      if (summary.length < 140) issues.push('thin_summary');
    } else if (countWords(summary) < 55) {
      issues.push('thin_summary');
    }
    if (!hasFinishedEnding(summary)) issues.push('unfinished_summary');
  }

  if (suggestionBodies.length > 0) {
    const thinSuggestion = suggestionBodies.some((suggestion) => (
      hasCjkText(suggestion) ? suggestion.length < 60 : countWords(suggestion) < 18
    ));
    if (thinSuggestion) issues.push('thin_experience_suggestions');
  }

  if (hasPlaceholder(combined)) issues.push('placeholder');
  if (hasTemplateLanguage(combined)) issues.push('template_language');

  const uniqueIssues = Array.from(new Set(issues));
  const blockingIssues = uniqueIssues.filter((issue) => !['long_headline'].includes(issue));
  if (blockingIssues.length > 0) return { status: 'needs_regen', issues: uniqueIssues };
  if (uniqueIssues.length > 0) return { status: 'warn', issues: uniqueIssues };
  return { status: 'ok', issues: [] };
};

export const canExportLinkedInOptimization = (validation: LinkedInValidation): boolean =>
  canExportQualityGate(validation);

export const linkedInIssueLabel = (issue: string, copy?: QualityCopyFn): string => {
  const labels: Record<string, { key: string; fallback: string }> = {
    empty: { key: 'quality_linkedin_empty', fallback: 'No LinkedIn optimization was generated.' },
    missing_headline: { key: 'quality_linkedin_missing_headline', fallback: 'Add a specific headline.' },
    missing_summary: { key: 'quality_linkedin_missing_summary', fallback: 'Add a profile summary.' },
    missing_experience_suggestions: { key: 'quality_linkedin_missing_experience_suggestions', fallback: 'Add at least one experience rewrite.' },
    thin_headline: { key: 'quality_linkedin_thin_headline', fallback: 'The headline is too thin to use.' },
    thin_summary: { key: 'quality_linkedin_thin_summary', fallback: 'The summary needs more substance.' },
    thin_experience_suggestions: { key: 'quality_linkedin_thin_experience_suggestions', fallback: 'Experience suggestions need more usable detail.' },
    unfinished_summary: { key: 'quality_linkedin_unfinished_summary', fallback: 'The summary appears unfinished.' },
    placeholder: { key: 'quality_issue_placeholder', fallback: 'Placeholders are still present.' },
    template_language: { key: 'quality_issue_template_language', fallback: 'Template instructions are still visible.' },
    long_headline: { key: 'quality_linkedin_long_headline', fallback: 'The headline is long; trim it before using.' },
  };
  const label = labels[issue];
  if (!label) return issue.replace(/_/g, ' ');
  return copy ? copy(label.key, label.fallback) : label.fallback;
};

interface LinkedInExportGateProps {
  validation: LinkedInValidation;
  text: string;
  regenerateLabel: string;
  onRegenerate: () => void;
}

export const LinkedInExportGate: React.FC<LinkedInExportGateProps> = ({
  validation,
  text,
  regenerateLabel,
  onRegenerate,
}) => {
  if (!canExportLinkedInOptimization(validation)) {
    return (
      <BlockedRegenerateButton
        label={regenerateLabel}
        onClick={onRegenerate}
        dataQa="linkedin-export-blocked-regenerate"
      />
    );
  }

  return <DownloadButtons textContent={text} baseFilename="linkedin_optimization" />;
};

interface LinkedInQualityNoticeProps {
  validation: LinkedInValidation;
}

export const LinkedInQualityNotice: React.FC<LinkedInQualityNoticeProps> = ({ validation }) => {
  const copy = useQualityGateCopy();
  return (
    <QualityGateNotice
      validation={validation}
      dataQa="linkedin-quality-notice"
      statusDataAttribute="data-qa-linkedin-quality"
      blockingTitle={copy('quality_profile_blocking_title', 'Fix this profile draft before exporting')}
      warningTitle={copy('quality_review_before_using', 'Review before using')}
      issueLabel={(issue) => linkedInIssueLabel(issue, copy)}
      warningIcon={Link2}
    />
  );
};
