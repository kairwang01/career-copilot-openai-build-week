import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useLocalization } from '../../hooks/useLocalization';

/**
 * Finished-sentence check that works across output languages: terminal
 * punctuation (Latin, CJK, Arabic, Devanagari…) optionally followed by closing
 * quotes/brackets or markdown emphasis. Mirrors functions/src/llm/draftQuality.ts.
 */
export const hasFinishedEnding = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const stripped = trimmed.replace(/["'\u201d\u2019\u00bb\u203a\u300d\u300f\u3009\u300b)\]}*_`\s]+$/u, '');
  return /[.!?\u3002\uff01\uff1f\u2026\u061f\u06d4\u0964]$/u.test(stripped);
};

export type QualityValidationStatus = 'ok' | 'warn' | 'needs_regen';

export interface QualityValidationLike {
  status: QualityValidationStatus;
  issues: string[];
}

export const canExportQualityGate = (validation: QualityValidationLike): boolean =>
  validation.status !== 'needs_regen';

export type QualityCopyFn = (key: string, fallback: string) => string;

export const formatQualityCopy = (t: (key: string) => string, key: string, fallback: string): string => {
  const value = t(key);
  return value === key ? fallback : value;
};

export const useQualityGateCopy = (): QualityCopyFn => {
  const { t } = useLocalization();
  return (key, fallback) => formatQualityCopy(t, key, fallback);
};

interface BlockedRegenerateButtonProps {
  label: string;
  onClick: () => void;
  dataQa: string;
  disabled?: boolean;
}

export const BlockedRegenerateButton: React.FC<BlockedRegenerateButtonProps> = ({
  label,
  onClick,
  dataQa,
  disabled = false,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
    data-qa={dataQa}
  >
    <AlertTriangle className="h-4 w-4" aria-hidden="true" />
    {label}
  </button>
);

interface BlockedCopyBadgeProps {
  dataQa: string;
  label?: string;
}

export const BlockedCopyBadge: React.FC<BlockedCopyBadgeProps> = ({
  dataQa,
  label,
}) => {
  const copy = useQualityGateCopy();
  const displayLabel = label ?? copy('quality_review_needed', 'Review needed');

  return (
    <span
      className="inline-flex min-h-9 items-center rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100"
      data-qa={dataQa}
    >
      {displayLabel}
    </span>
  );
};

interface QualityGateNoticeProps {
  validation: QualityValidationLike;
  dataQa: string;
  statusDataAttribute: string;
  blockingTitle: string;
  warningTitle: string;
  issueLabel: (issue: string) => string;
  warningIcon: LucideIcon;
}

export const QualityGateNotice: React.FC<QualityGateNoticeProps> = ({
  validation,
  dataQa,
  statusDataAttribute,
  blockingTitle,
  warningTitle,
  issueLabel,
  warningIcon: WarningIcon,
}) => {
  if (validation.status === 'ok') return null;

  const isBlocking = validation.status === 'needs_regen';
  const statusAttribute = { [statusDataAttribute]: validation.status };

  return (
    <div
      className={`rounded-xl border p-4 ${
        isBlocking
          ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100'
          : 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-100'
      }`}
      role={isBlocking ? 'alert' : 'note'}
      data-qa={dataQa}
      {...statusAttribute}
    >
      <div className="flex items-start gap-3">
        {isBlocking ? (
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        ) : (
          <WarningIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        )}
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {isBlocking ? blockingTitle : warningTitle}
          </p>
          <p className="mt-1 text-sm leading-6 opacity-85">
            {validation.issues.map(issueLabel).join(' ')}
          </p>
        </div>
      </div>
    </div>
  );
};
