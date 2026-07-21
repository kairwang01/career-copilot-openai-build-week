import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { SalaryNegotiationResult } from '../types';
import {
  assessSalaryNegotiation,
  buildSalaryDownloadText,
  canExportSalaryNegotiation,
  SalaryCopyGate,
  SalaryExportGate,
  SalaryQualityNotice,
} from '../components/tools/SalaryActions';

const strongPlan: SalaryNegotiationResult = {
  marketAnalysisSummary: 'The current offer is close to the lower-middle part of the local market for a senior software engineering role, so the negotiation should stay evidence-led rather than aggressive. The strongest approach is to anchor the counter around the candidate’s technical delivery scope, engineering leadership, and relevant platform experience while leaving room for total compensation trade-offs.',
  recommendedRange: {
    baseMin: 118000,
    baseMax: 128000,
    currency: 'CAD',
    explanation: 'This range keeps the ask above the current offer while remaining close enough to be defensible for the stated senior role and market.',
  },
  keyStrengths: [
    'Coordinated engineering delivery across a 6-person team and helped move a production-oriented AI platform forward.',
    'Can connect technical implementation, user feedback, risk tracking, and release planning in one conversation.',
  ],
  negotiationStrategy: [
    'Thank the employer first, then state that the role is a strong fit and that you would like to align compensation with the senior scope.',
    'Anchor the counter around a clear base range, then support it with two role-relevant strengths rather than a broad personal need.',
    'Keep one fallback option open, such as signing bonus, earlier review, or additional flexibility if base salary cannot move.',
  ],
  counterOfferEmailDraft: `Hi Sarah,

Thank you again for the offer for the Senior Software Engineer role. I am excited about the team and the scope of work, especially the chance to contribute across technical delivery and product-facing execution.

After reviewing the responsibilities and the local market for this level, I wanted to ask whether there is flexibility to bring the base salary closer to CAD 122,000 to CAD 128,000. My recent experience coordinating a 6-person engineering team, translating product feedback into delivery work, and supporting release readiness aligns closely with the role's expectations.

I remain enthusiastic about the opportunity and would be glad to discuss a structure that works for both sides. Thank you for considering it.`,
  objectionHandlers: [
    {
      objection: 'The salary band is fixed.',
      response: 'Acknowledge the constraint, then ask whether a signing bonus, earlier compensation review, or additional flexibility can help close the gap without changing the posted band.',
    },
    {
      objection: 'The offer is already competitive.',
      response: 'Reaffirm interest in the role and briefly restate the senior scope and evidence behind the counter range so the discussion stays grounded in fit and market alignment.',
    },
  ],
};

const labels = {
  title: 'Salary negotiation plan',
  offer: 'Current offer',
  marketAnalysis: 'Market analysis',
  recommendedRange: 'Recommended range',
  keyStrengths: 'Key strengths',
  strategy: 'Strategy',
  emailDraft: 'Email draft',
  objections: 'Objections',
};

const context = {
  job: 'Senior Software Engineer',
  employer: 'Shopify',
  offerLabel: 'CAD 110,000',
  rangeLabel: 'CAD 118,000 - CAD 128,000',
};

const renderExportGate = (plan: SalaryNegotiationResult) => {
  const text = buildSalaryDownloadText(plan, labels, context);
  return renderToStaticMarkup(
    React.createElement(SalaryExportGate, {
      validation: assessSalaryNegotiation(plan),
      text,
      baseFilename: 'salary_negotiation_shopify',
      regenerateLabel: 'Generate strategy',
      onRegenerate: vi.fn(),
    }),
  );
};

describe('salary negotiation quality gate', () => {
  it('blocks download and copy when placeholders or template instructions remain', () => {
    const weakPlan: SalaryNegotiationResult = {
      marketAnalysisSummary: 'Insert specific range and explain current offer',
      recommendedRange: {
        baseMin: 0,
        baseMax: 0,
        currency: '',
        explanation: '[specific reason]',
      },
      keyStrengths: [],
      negotiationStrategy: ['Ask for more money.'],
      counterOfferEmailDraft: 'Hi [Hiring Manager], I want [desired salary]',
      objectionHandlers: [{ objection: 'No budget', response: 'Add specific response.' }],
    };
    const validation = assessSalaryNegotiation(weakPlan);
    const exportMarkup = renderExportGate(weakPlan);
    const copyMarkup = renderToStaticMarkup(
      React.createElement(SalaryCopyGate, {
        validation,
        text: weakPlan.counterOfferEmailDraft,
        label: 'Copy email',
      }),
    );

    expect(validation.status).toBe('needs_regen');
    expect(validation.issues).toContain('placeholder');
    expect(validation.issues).toContain('invalid_range');
    expect(canExportSalaryNegotiation(validation)).toBe(false);
    expect(exportMarkup).toContain('salary-export-blocked-regenerate');
    expect(exportMarkup).not.toContain('Download');
    expect(copyMarkup).toContain('salary-copy-blocked');
    expect(copyMarkup).not.toContain('Copy email');
  });

  it('allows export for a complete, specific negotiation plan', () => {
    const validation = assessSalaryNegotiation(strongPlan);
    const exportMarkup = renderExportGate(strongPlan);
    const copyMarkup = renderToStaticMarkup(
      React.createElement(SalaryCopyGate, {
        validation,
        text: strongPlan.counterOfferEmailDraft,
        label: 'Copy email',
      }),
    );

    expect(validation.status).toBe('ok');
    expect(canExportSalaryNegotiation(validation)).toBe(true);
    expect(exportMarkup).toContain('Download');
    expect(exportMarkup).not.toContain('salary-export-blocked-regenerate');
    expect(copyMarkup).toContain('Copy email');
    expect(copyMarkup).not.toContain('salary-copy-blocked');
  });

  it('shows a quality notice for incomplete negotiation plans', () => {
    const validation = assessSalaryNegotiation({
      marketAnalysisSummary: 'Market is good.',
      negotiationStrategy: ['Ask politely.'],
    });
    const markup = renderToStaticMarkup(
      React.createElement(SalaryQualityNotice, { validation }),
    );

    expect(validation.status).toBe('needs_regen');
    expect(markup).toContain('salary-quality-notice');
    expect(markup).toContain('Fix this negotiation plan before exporting');
    expect(markup).toContain('Add a recommended salary range.');
  });
});
