import React from 'react';
import { Wallet } from 'lucide-react';
import type { SalaryNegotiationResult } from '../../types';
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

export type SalaryValidationStatus = QualityValidationStatus;

export interface SalaryValidation {
  status: SalaryValidationStatus;
  issues: string[];
}

type SalaryDraft = Partial<SalaryNegotiationResult>;

const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const hasCjkText = (text: string) => /[\u3040-\u30ff\u3400-\u9fff]/.test(text);
const normalize = (text: string | undefined) =>
  (text || '').replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').trim();

const hasPlaceholder = (text: string) => (
  /\[[^\]]{2,}\]|\{\{[^}]+\}\}|<[^>\n]{2,}>/.test(text) ||
  /\b(?:Your Name|Hiring Manager Name|Company Name|Job Title|Desired Salary|specific reason|relevant achievement)\b/i.test(text)
);

const hasTemplateLanguage = (text: string) =>
  /specific (?:reason|achievement|metric|number|range|ask)|insert (?:salary|range|detail|number)|customize this|measurable result/i.test(text);

export const buildSalaryDownloadText = (
  result: SalaryDraft,
  labels: {
    title: string;
    offer: string;
    marketAnalysis: string;
    recommendedRange: string;
    keyStrengths: string;
    strategy: string;
    emailDraft: string;
    objections: string;
  },
  context: { job: string; employer: string; offerLabel: string; rangeLabel: string },
) => {
  const strengths = Array.isArray(result.keyStrengths) ? result.keyStrengths : [];
  const steps = Array.isArray(result.negotiationStrategy) ? result.negotiationStrategy : [];
  const objections = Array.isArray(result.objectionHandlers) ? result.objectionHandlers : [];
  const rangeExplanation = result.recommendedRange?.explanation || '';

  return [
    `${labels.title}: ${context.job} at ${context.employer}`,
    `${labels.offer}: ${context.offerLabel}`,
    `${labels.marketAnalysis}\n${result.marketAnalysisSummary || ''}`,
    `\n${labels.recommendedRange}\n${context.rangeLabel}\n${rangeExplanation}`,
    `\n${labels.keyStrengths}\n${strengths.map((strength) => `- ${strength}`).join('\n')}`,
    `\n${labels.strategy}\n${steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`,
    `\n${labels.emailDraft}\n${result.counterOfferEmailDraft || ''}`,
    `\n${labels.objections}\n${objections.map((item) => `- ${item.objection || ''}: ${item.response || ''}`).join('\n')}`,
  ].join('\n\n');
};

export const assessSalaryNegotiation = (result: SalaryDraft | null | undefined): SalaryValidation => {
  if (!result) return { status: 'needs_regen', issues: ['empty'] };

  const marketAnalysis = normalize(result.marketAnalysisSummary);
  const range = result.recommendedRange;
  const strengths = Array.isArray(result.keyStrengths) ? result.keyStrengths.map(normalize).filter(Boolean) : [];
  const strategy = Array.isArray(result.negotiationStrategy) ? result.negotiationStrategy.map(normalize).filter(Boolean) : [];
  const email = normalize(result.counterOfferEmailDraft);
  const objections = Array.isArray(result.objectionHandlers) ? result.objectionHandlers : [];
  const objectionTexts = objections.flatMap((item) => [normalize(item?.objection), normalize(item?.response)]).filter(Boolean);
  const combined = [
    marketAnalysis,
    range?.explanation || '',
    ...strengths,
    ...strategy,
    email,
    ...objectionTexts,
  ].join('\n');

  if (!combined.trim() && !range) return { status: 'needs_regen', issues: ['empty'] };

  const issues: string[] = [];
  if (!marketAnalysis) issues.push('missing_market_analysis');
  if (!range) issues.push('missing_range');
  if (range) {
    const min = Number(range.baseMin);
    const max = Number(range.baseMax);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0 || min > max) {
      issues.push('invalid_range');
    }
    if (!normalize(range.currency)) issues.push('missing_currency');
    if (!normalize(range.explanation)) issues.push('missing_range_explanation');
  }

  if (strengths.length === 0) issues.push('missing_strengths');
  if (strategy.length < 2) issues.push('thin_strategy');
  if (!email) issues.push('missing_email');
  if (objections.length === 0) issues.push('missing_objections');

  if (marketAnalysis) {
    if (hasCjkText(marketAnalysis)) {
      if (marketAnalysis.length < 90) issues.push('thin_market_analysis');
    } else if (countWords(marketAnalysis) < 30) {
      issues.push('thin_market_analysis');
    }
    if (!hasFinishedEnding(marketAnalysis)) issues.push('unfinished_market_analysis');
  }

  strategy.forEach((step) => {
    if (hasCjkText(step)) {
      if (step.length < 35) issues.push('thin_strategy_step');
    } else if (countWords(step) < 10) {
      issues.push('thin_strategy_step');
    }
  });

  if (email) {
    const emailWords = countWords(email);
    if (hasCjkText(email)) {
      if (email.length < 120) issues.push('thin_email');
    } else if (emailWords < 55) {
      issues.push('thin_email');
    }
    if (!hasFinishedEnding(email)) issues.push('unfinished_email');
    if (!hasCjkText(email) && emailWords > 320) issues.push('long_email');
  }

  objections.forEach((item) => {
    const objection = normalize(item?.objection);
    const response = normalize(item?.response);
    if (!objection || !response) issues.push('incomplete_objection');
    if (response) {
      if (hasCjkText(response)) {
        if (response.length < 45) issues.push('thin_objection_response');
      } else if (countWords(response) < 14) {
        issues.push('thin_objection_response');
      }
    }
  });

  if (hasPlaceholder(combined)) issues.push('placeholder');
  if (hasTemplateLanguage(combined)) issues.push('template_language');

  const uniqueIssues = Array.from(new Set(issues));
  const blockingIssues = uniqueIssues.filter((issue) => issue !== 'long_email');
  if (blockingIssues.length > 0) return { status: 'needs_regen', issues: uniqueIssues };
  if (uniqueIssues.length > 0) return { status: 'warn', issues: uniqueIssues };
  return { status: 'ok', issues: [] };
};

export const canExportSalaryNegotiation = (validation: SalaryValidation): boolean =>
  canExportQualityGate(validation);

export const salaryIssueLabel = (issue: string, copy?: QualityCopyFn): string => {
  const labels: Record<string, { key: string; fallback: string }> = {
    empty: { key: 'quality_salary_empty', fallback: 'No salary negotiation plan was generated.' },
    missing_market_analysis: { key: 'quality_salary_missing_market_analysis', fallback: 'Add market analysis.' },
    missing_range: { key: 'quality_salary_missing_range', fallback: 'Add a recommended salary range.' },
    invalid_range: { key: 'quality_salary_invalid_range', fallback: 'Fix the recommended salary range.' },
    missing_currency: { key: 'quality_salary_missing_currency', fallback: 'Add the range currency.' },
    missing_range_explanation: { key: 'quality_salary_missing_range_explanation', fallback: 'Explain the salary range.' },
    missing_strengths: { key: 'quality_salary_missing_strengths', fallback: 'Add negotiation strengths.' },
    thin_strategy: { key: 'quality_salary_thin_strategy', fallback: 'Add more negotiation steps.' },
    thin_strategy_step: { key: 'quality_salary_thin_strategy_step', fallback: 'A negotiation step needs more detail.' },
    missing_email: { key: 'quality_salary_missing_email', fallback: 'Add a counter-offer email draft.' },
    thin_email: { key: 'quality_salary_thin_email', fallback: 'The counter-offer email is too short to send.' },
    unfinished_email: { key: 'quality_salary_unfinished_email', fallback: 'The counter-offer email appears unfinished.' },
    long_email: { key: 'quality_salary_long_email', fallback: 'The counter-offer email is long; trim it before sending.' },
    missing_objections: { key: 'quality_salary_missing_objections', fallback: 'Add objection handlers.' },
    incomplete_objection: { key: 'quality_salary_incomplete_objection', fallback: 'Complete each objection and response.' },
    thin_objection_response: { key: 'quality_salary_thin_objection_response', fallback: 'An objection response needs more usable detail.' },
    thin_market_analysis: { key: 'quality_salary_thin_market_analysis', fallback: 'The market analysis needs more substance.' },
    unfinished_market_analysis: { key: 'quality_salary_unfinished_market_analysis', fallback: 'The market analysis appears unfinished.' },
    placeholder: { key: 'quality_issue_placeholder', fallback: 'Placeholders are still present.' },
    template_language: { key: 'quality_issue_template_language', fallback: 'Template instructions are still visible.' },
  };
  const label = labels[issue];
  if (!label) return issue.replace(/_/g, ' ');
  return copy ? copy(label.key, label.fallback) : label.fallback;
};

interface SalaryExportGateProps {
  validation: SalaryValidation;
  text: string;
  baseFilename: string;
  regenerateLabel: string;
  onRegenerate: () => void;
}

export const SalaryExportGate: React.FC<SalaryExportGateProps> = ({
  validation,
  text,
  baseFilename,
  regenerateLabel,
  onRegenerate,
}) => {
  if (!canExportSalaryNegotiation(validation)) {
    return (
      <BlockedRegenerateButton
        label={regenerateLabel}
        onClick={onRegenerate}
        dataQa="salary-export-blocked-regenerate"
      />
    );
  }

  return <DownloadButtons textContent={text} baseFilename={baseFilename} />;
};

interface SalaryCopyGateProps {
  validation: SalaryValidation;
  text: string;
  label: string;
}

export const SalaryCopyGate: React.FC<SalaryCopyGateProps> = ({ validation, text, label }) => {
  if (!canExportSalaryNegotiation(validation)) {
    return <BlockedCopyBadge dataQa="salary-copy-blocked" />;
  }

  return <CopyButton text={text} label={label} />;
};

interface SalaryQualityNoticeProps {
  validation: SalaryValidation;
}

export const SalaryQualityNotice: React.FC<SalaryQualityNoticeProps> = ({ validation }) => {
  const copy = useQualityGateCopy();
  return (
    <QualityGateNotice
      validation={validation}
      dataQa="salary-quality-notice"
      statusDataAttribute="data-qa-salary-quality"
      blockingTitle={copy('quality_salary_blocking_title', 'Fix this negotiation plan before exporting')}
      warningTitle={copy('quality_review_before_using', 'Review before using')}
      issueLabel={(issue) => salaryIssueLabel(issue, copy)}
      warningIcon={Wallet}
    />
  );
};
