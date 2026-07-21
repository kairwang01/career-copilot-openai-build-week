import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ResumeValidation } from '../lib/resumePreview';
import { canDownloadFormattedResume, ResumeFormatterDownloadGate } from '../components/tools/ResumeFormatterActions';

const t = (key: string) => ({
  tool_resume_formatter_regen_cta: 'Regenerate draft',
}[key] || key);

const renderGate = (validation: ResumeValidation) => (
  renderToStaticMarkup(
    React.createElement(ResumeFormatterDownloadGate, {
      validation,
      formattedText: 'Kai Wang\nSUMMARY\nProduct operations candidate.',
      generatedMarket: 'Japan',
      loading: false,
      onRegenerate: vi.fn(),
      t,
    }),
  )
);

describe('ResumeFormatterDownloadGate', () => {
  it('blocks download actions for failed resume format checks', () => {
    const validation: ResumeValidation = { status: 'needs_regen', issues: ['garbled_header'] };
    const markup = renderGate(validation);

    expect(canDownloadFormattedResume(validation)).toBe(false);
    expect(markup).toContain('data-qa="resume-formatter-download-blocked-regenerate"');
    expect(markup).toContain('Regenerate draft');
    expect(markup).not.toContain('Download');
  });

  it('shows the export menu for resume drafts that pass the quality gate', () => {
    const validation: ResumeValidation = { status: 'ok', issues: [] };
    const markup = renderGate(validation);

    expect(canDownloadFormattedResume(validation)).toBe(true);
    expect(markup).toContain('Download');
    expect(markup).not.toContain('resume-formatter-download-blocked-regenerate');
  });
});
