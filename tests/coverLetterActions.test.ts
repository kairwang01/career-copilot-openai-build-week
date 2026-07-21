import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  assessCoverLetterDraft,
  canExportCoverLetter,
  CoverLetterExportGate,
  CoverLetterQualityNotice,
} from '../components/tools/CoverLetterActions';

const strongLetter = `Dear Hiring Team,

I am excited to apply for the Product Operations role because the position calls for someone who can connect technical delivery, customer feedback, and cross-functional execution. My engineering background and recent product work align closely with that need.

At Career CoPilot, I coordinated a 6-person engineering team and helped move an AI career platform from MVP into a production-ready release. I translated customer feedback into product requirements, organized sprint work in Jira, and reduced ambiguity across engineering, design, and delivery conversations.

I would welcome the chance to discuss how this mix of product judgment, technical fluency, and delivery ownership could support your team. Thank you for your consideration.`;

const t = (key: string) => ({
  copy: 'Copy letter',
  copied: 'Copied',
  regen: 'Regenerate draft',
}[key] || key);

const renderGate = (text: string) => (
  renderToStaticMarkup(
    React.createElement(CoverLetterExportGate, {
      validation: assessCoverLetterDraft(text),
      text,
      copyLabel: t('copy'),
      copiedLabel: t('copied'),
      regenerateLabel: t('regen'),
      onRegenerate: vi.fn(),
    }),
  )
);

describe('cover letter quality gate', () => {
  it('blocks export when placeholders or template instructions remain', () => {
    const draft = `[Your Name]

Dear Hiring Manager,

I am writing to apply for the [Job Title] role at [Company Name]. My background in [relevant skill area] aligns with this position.`;
    const validation = assessCoverLetterDraft(draft);
    const markup = renderGate(draft);

    expect(validation.status).toBe('needs_regen');
    expect(validation.issues).toContain('placeholder');
    expect(canExportCoverLetter(validation)).toBe(false);
    expect(markup).toContain('cover-letter-export-blocked-regenerate');
    expect(markup).toContain('Regenerate draft');
    expect(markup).not.toContain('Download');
    expect(markup).not.toContain('Copy letter');
  });

  it('allows export for a specific, complete cover letter draft', () => {
    const validation = assessCoverLetterDraft(strongLetter);
    const markup = renderGate(strongLetter);

    expect(validation.status).toBe('ok');
    expect(canExportCoverLetter(validation)).toBe(true);
    expect(markup).toContain('Copy letter');
    expect(markup).toContain('Download');
    expect(markup).not.toContain('cover-letter-export-blocked-regenerate');
  });

  it('shows an actionable quality notice for blocked drafts', () => {
    const validation = assessCoverLetterDraft('Dear Hiring Manager,\n\n[Company Name]');
    const markup = renderToStaticMarkup(
      React.createElement(CoverLetterQualityNotice, { validation }),
    );

    expect(markup).toContain('cover-letter-quality-notice');
    expect(markup).toContain('Fix this draft before exporting');
    expect(markup).toContain('Placeholders are still present.');
  });
});
