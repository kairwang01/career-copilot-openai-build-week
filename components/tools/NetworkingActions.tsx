import React from 'react';
import { Network } from 'lucide-react';
import type { NetworkingStrategyResult } from '../../types';
import {
  BlockedCopyBadge,
  BlockedRegenerateButton,
  canExportQualityGate,
  QualityGateNotice,
  type QualityCopyFn,
  type QualityValidationStatus,
  useQualityGateCopy,
  hasFinishedEnding,
} from './QualityGate';
import { CopyButton, DownloadButtons } from './ToolUtils';

export type NetworkingValidationStatus = QualityValidationStatus;

export interface NetworkingValidation {
  status: NetworkingValidationStatus;
  issues: string[];
}

type SavedNetworkingStrategy = Partial<NetworkingStrategyResult> & {
  targetCompany?: string;
  targetRole?: string;
  targetLocation?: string;
};

const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const hasCjkText = (text: string) => /[\u3040-\u30ff\u3400-\u9fff]/.test(text);
const normalize = (text: string | undefined) =>
  (text || '').replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').trim();

const hasPlaceholder = (text: string) => (
  /\[[^\]]{2,}\]|\{\{[^}]+\}\}|<[^>\n]{2,}>/.test(text) ||
  /\b(?:Contact Name|Recipient Name|Company Name|Target Company|Target Role|Job Title|Your Name|specific reason|relevant skill)\b/i.test(text)
);

const hasTemplateLanguage = (text: string) =>
  /specific (?:reason|detail|skill|achievement|question|next step)|insert (?:reason|detail|name|company)|customize this|low-friction ask/i.test(text);

export const buildNetworkingDownloadText = (
  result: SavedNetworkingStrategy,
  labels: { strategy: string; contacts: string; why: string; outreach: string },
  fallback: { company: string; role: string; location: string },
) => {
  const company = result.targetCompany || fallback.company;
  const role = result.targetRole || fallback.role;
  const location = result.targetLocation || fallback.location;
  const contacts = Array.isArray(result.contactSuggestions) ? result.contactSuggestions : [];
  let content = `# Networking Strategy: ${role} at ${company} (${location})\n\n`;
  content += `## ${labels.strategy}\n${result.strategySummary || ''}\n\n`;
  content += `## ${labels.contacts}\n`;
  contacts.forEach((suggestion, index) => {
    content += `### Contact ${index + 1}: ${suggestion.contactType || ''}\n`;
    content += `**${labels.why}:** ${suggestion.reason || ''}\n\n`;
    content += `**${labels.outreach}:**\n${suggestion.outreachMessage || ''}\n\n`;
  });
  return content;
};

export const assessNetworkingStrategy = (result: SavedNetworkingStrategy | null | undefined): NetworkingValidation => {
  if (!result) return { status: 'needs_regen', issues: ['empty'] };

  const strategy = normalize(result.strategySummary);
  const contacts = Array.isArray(result.contactSuggestions) ? result.contactSuggestions : [];
  const combined = [
    strategy,
    ...contacts.flatMap((item) => [
      normalize(item?.contactType),
      normalize(item?.reason),
      normalize(item?.outreachMessage),
    ]),
  ].join('\n');

  if (!strategy && contacts.length === 0) return { status: 'needs_regen', issues: ['empty'] };

  const issues: string[] = [];
  if (!strategy) issues.push('missing_strategy');
  if (contacts.length === 0) issues.push('missing_contacts');
  if (contacts.length > 0 && contacts.length < 3) issues.push('few_contacts');

  if (strategy) {
    if (hasCjkText(strategy)) {
      if (strategy.length < 100) issues.push('thin_strategy');
    } else if (countWords(strategy) < 35) {
      issues.push('thin_strategy');
    }
    if (!hasFinishedEnding(strategy)) issues.push('unfinished_strategy');
  }

  contacts.forEach((contact) => {
    const contactType = normalize(contact?.contactType);
    const reason = normalize(contact?.reason);
    const message = normalize(contact?.outreachMessage);
    if (!contactType) issues.push('missing_contact_type');
    if (!reason) issues.push('missing_reason');
    if (!message) issues.push('missing_outreach');

    if (reason) {
      if (hasCjkText(reason)) {
        if (reason.length < 35) issues.push('thin_reason');
      } else if (countWords(reason) < 12) {
        issues.push('thin_reason');
      }
    }

    if (message) {
      const messageWords = countWords(message);
      if (hasCjkText(message)) {
        if (message.length < 70) issues.push('thin_outreach');
      } else if (messageWords < 30) {
        issues.push('thin_outreach');
      }
      if (!hasCjkText(message) && messageWords > 130) issues.push('long_outreach');
      if (!hasFinishedEnding(message)) issues.push('unfinished_outreach');
    }
  });

  if (hasPlaceholder(combined)) issues.push('placeholder');
  if (hasTemplateLanguage(combined)) issues.push('template_language');

  const uniqueIssues = Array.from(new Set(issues));
  const blockingIssues = uniqueIssues.filter((issue) => !['few_contacts', 'long_outreach'].includes(issue));
  if (blockingIssues.length > 0) return { status: 'needs_regen', issues: uniqueIssues };
  if (uniqueIssues.length > 0) return { status: 'warn', issues: uniqueIssues };
  return { status: 'ok', issues: [] };
};

export const canExportNetworkingStrategy = (validation: NetworkingValidation): boolean =>
  canExportQualityGate(validation);

export const networkingIssueLabel = (issue: string, copy?: QualityCopyFn): string => {
  const labels: Record<string, { key: string; fallback: string }> = {
    empty: { key: 'quality_networking_empty', fallback: 'No networking strategy was generated.' },
    missing_strategy: { key: 'quality_networking_missing_strategy', fallback: 'Add a strategy summary.' },
    missing_contacts: { key: 'quality_networking_missing_contacts', fallback: 'Add contact suggestions.' },
    few_contacts: { key: 'quality_networking_few_contacts', fallback: 'The plan has fewer than three contact ideas.' },
    thin_strategy: { key: 'quality_networking_thin_strategy', fallback: 'The strategy summary needs more substance.' },
    unfinished_strategy: { key: 'quality_networking_unfinished_strategy', fallback: 'The strategy summary appears unfinished.' },
    missing_contact_type: { key: 'quality_networking_missing_contact_type', fallback: 'A contact suggestion is missing its persona.' },
    missing_reason: { key: 'quality_networking_missing_reason', fallback: 'A contact suggestion is missing the reason to reach out.' },
    missing_outreach: { key: 'quality_networking_missing_outreach', fallback: 'A contact suggestion is missing its outreach message.' },
    thin_reason: { key: 'quality_networking_thin_reason', fallback: 'A contact reason is too thin.' },
    thin_outreach: { key: 'quality_networking_thin_outreach', fallback: 'An outreach message is too short to send.' },
    long_outreach: { key: 'quality_networking_long_outreach', fallback: 'An outreach message is long; trim it before sending.' },
    unfinished_outreach: { key: 'quality_networking_unfinished_outreach', fallback: 'An outreach message appears unfinished.' },
    placeholder: { key: 'quality_issue_placeholder', fallback: 'Placeholders are still present.' },
    template_language: { key: 'quality_issue_template_language', fallback: 'Template instructions are still visible.' },
  };
  const label = labels[issue];
  if (!label) return issue.replace(/_/g, ' ');
  return copy ? copy(label.key, label.fallback) : label.fallback;
};

interface NetworkingExportGateProps {
  validation: NetworkingValidation;
  text: string;
  baseFilename: string;
  regenerateLabel: string;
  onRegenerate: () => void;
}

export const NetworkingExportGate: React.FC<NetworkingExportGateProps> = ({
  validation,
  text,
  baseFilename,
  regenerateLabel,
  onRegenerate,
}) => {
  if (!canExportNetworkingStrategy(validation)) {
    return (
      <BlockedRegenerateButton
        label={regenerateLabel}
        onClick={onRegenerate}
        dataQa="networking-export-blocked-regenerate"
      />
    );
  }

  return <DownloadButtons textContent={text} baseFilename={baseFilename} />;
};

interface NetworkingCopyGateProps {
  validation: NetworkingValidation;
  text: string;
  label: string;
}

export const NetworkingCopyGate: React.FC<NetworkingCopyGateProps> = ({ validation, text, label }) => {
  if (!canExportNetworkingStrategy(validation)) {
    return <BlockedCopyBadge dataQa="networking-copy-blocked" />;
  }

  return <CopyButton text={text} label={label} />;
};

interface NetworkingQualityNoticeProps {
  validation: NetworkingValidation;
}

export const NetworkingQualityNotice: React.FC<NetworkingQualityNoticeProps> = ({ validation }) => {
  const copy = useQualityGateCopy();
  return (
    <QualityGateNotice
      validation={validation}
      dataQa="networking-quality-notice"
      statusDataAttribute="data-qa-networking-quality"
      blockingTitle={copy('quality_networking_blocking_title', 'Fix this networking plan before exporting')}
      warningTitle={copy('quality_review_before_using', 'Review before using')}
      issueLabel={(issue) => networkingIssueLabel(issue, copy)}
      warningIcon={Network}
    />
  );
};
