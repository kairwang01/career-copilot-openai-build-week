import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  assessEmailDraft,
  canExportEmail,
  EmailExportGate,
  EmailQualityNotice,
} from '../components/tools/EmailActions';

const strongSubject = 'Thank you for the Product Operations interview';
const strongBody = `Hi Sarah,

Thank you for taking the time to speak with me about the Product Operations role today. I appreciated learning more about how your team connects customer feedback, roadmap planning, and delivery execution across product and engineering.

Our conversation reinforced my interest in the role because it matches the work I have done translating user feedback into product requirements, coordinating sprint priorities, and keeping cross-functional teams aligned through ambiguous delivery moments.

I would welcome the opportunity to continue the conversation and share more detail on how my technical background and product coordination experience could support the team.`;

const renderGate = (subject: string, body: string) => (
  renderToStaticMarkup(
    React.createElement(EmailExportGate, {
      validation: assessEmailDraft(subject, body),
      text: `Subject: ${subject}\n\n${body}`,
      copyLabel: 'Copy email',
      copiedLabel: 'Copied',
      regenerateLabel: 'Generate email',
      onRegenerate: vi.fn(),
    }),
  )
);

describe('email draft quality gate', () => {
  it('blocks export when placeholders or template instructions remain', () => {
    const subject = '[Job Title] follow-up';
    const body = `Dear [Recipient Name],

I am writing about the [Job Title] role at [Company Name]. Please insert detail about specific reason and relevant skill area before sending.`;
    const validation = assessEmailDraft(subject, body);
    const markup = renderGate(subject, body);

    expect(validation.status).toBe('needs_regen');
    expect(validation.issues).toContain('placeholder');
    expect(canExportEmail(validation)).toBe(false);
    expect(markup).toContain('email-export-blocked-regenerate');
    expect(markup).toContain('Generate email');
    expect(markup).not.toContain('Download');
    expect(markup).not.toContain('Copy email');
  });

  it('allows export for a specific, complete email draft', () => {
    const validation = assessEmailDraft(strongSubject, strongBody);
    const markup = renderGate(strongSubject, strongBody);

    expect(validation.status).toBe('ok');
    expect(canExportEmail(validation)).toBe(true);
    expect(markup).toContain('Copy email');
    expect(markup).toContain('Download');
    expect(markup).not.toContain('email-export-blocked-regenerate');
  });

  it('shows a quality notice for blocked email drafts', () => {
    const validation = assessEmailDraft('', '[Company Name]');
    const markup = renderToStaticMarkup(
      React.createElement(EmailQualityNotice, { validation }),
    );

    expect(markup).toContain('email-quality-notice');
    expect(markup).toContain('Fix this draft before exporting');
    expect(markup).toContain('Add a specific subject line.');
    expect(markup).toContain('Placeholders are still present.');
  });
});
