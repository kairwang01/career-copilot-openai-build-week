import React from 'react';
import type { ResumeValidation } from '../../lib/resumePreview';
import { BlockedRegenerateButton, canExportQualityGate } from './QualityGate';
import { DownloadButtons } from './ToolUtils';

export const canDownloadFormattedResume = (validation: ResumeValidation): boolean =>
  canExportQualityGate(validation);

interface ResumeFormatterDownloadGateProps {
  validation: ResumeValidation;
  formattedText: string;
  generatedMarket: string;
  loading: boolean;
  onRegenerate: () => void;
  t: (key: string) => string;
}

export const ResumeFormatterDownloadGate: React.FC<ResumeFormatterDownloadGateProps> = ({
  validation,
  formattedText,
  generatedMarket,
  loading,
  onRegenerate,
  t,
}) => {
  if (!canDownloadFormattedResume(validation)) {
    return (
      <BlockedRegenerateButton
        label={t('tool_resume_formatter_regen_cta')}
        onClick={onRegenerate}
        disabled={loading}
        dataQa="resume-formatter-download-blocked-regenerate"
      />
    );
  }

  return (
    <DownloadButtons
      textContent={formattedText}
      baseFilename={`${generatedMarket.toLowerCase().replace(/\s/g, '_')}_resume`}
    />
  );
};
