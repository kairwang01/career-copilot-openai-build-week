import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { NetworkingStrategyResult } from '../types';
import {
  assessNetworkingStrategy,
  buildNetworkingDownloadText,
  canExportNetworkingStrategy,
  NetworkingCopyGate,
  NetworkingExportGate,
  NetworkingQualityNotice,
} from '../components/tools/NetworkingActions';

const strongStrategy: NetworkingStrategyResult = {
  strategySummary: 'Start with peer-level product operations and technical project contacts because they are most likely to understand the bridge from engineering delivery into product coordination. Lead with the candidate’s experience coordinating a 6-person engineering team, translating customer feedback into Jira work, and reducing ambiguity across product and engineering conversations. After two or three peer conversations, move to a team lead or recruiter with a more informed ask about role fit, hiring signals, and referral timing.',
  contactSuggestions: [
    {
      contactType: 'Product Operations Associate working with engineering delivery',
      reason: 'This contact can validate the day-to-day bridge between sprint coordination, customer feedback, and product operations. The candidate has a strong hook through engineering-team coordination and Jira-based workflow standardization.',
      outreachMessage: 'Hi, I’m exploring product operations roles that sit close to engineering delivery. I recently coordinated a 6-person engineering team on an AI career platform and helped turn customer feedback into Jira work and release priorities. Would you be open to a 15-minute chat about how product ops supports engineering teams at your company?',
    },
    {
      contactType: 'Recent graduate or career switcher in the target function',
      reason: 'A recent transition contact can explain what evidence helped them get interviews and which skills mattered most. The candidate can compare their technical project coordination background against a realistic market path.',
      outreachMessage: 'Hi, I noticed your path into product operations and would value your perspective. I’m coming from an engineering and project coordination background, including sprint planning, risk tracking, and customer-feedback translation for an AI career platform. Could I ask one or two questions about what helped you position that transition?',
    },
    {
      contactType: 'Team lead or hiring manager for product operations',
      reason: 'This contact is best approached after peer conversations because the candidate will have sharper questions. The resume hook is cross-functional delivery ownership across engineering, product feedback, and release readiness.',
      outreachMessage: 'Hi, I’m researching product operations roles where technical delivery and customer feedback connect. My recent work involved coordinating an engineering team, turning user feedback into requirements, and helping standardize release workflows. If you have 15 minutes, I’d appreciate one practical view on what signals make candidates stand out for your team.',
    },
  ],
};

const labels = {
  strategy: 'Strategy Summary',
  contacts: 'Contact Suggestions',
  why: 'Why',
  outreach: 'Outreach Message',
};

const fallback = {
  company: 'Shopify',
  role: 'Product Operations',
  location: 'Toronto',
};

const renderExportGate = (strategy: NetworkingStrategyResult) => {
  const text = buildNetworkingDownloadText(strategy, labels, fallback);
  return renderToStaticMarkup(
    React.createElement(NetworkingExportGate, {
      validation: assessNetworkingStrategy(strategy),
      text,
      baseFilename: 'networking_strategy_shopify',
      regenerateLabel: 'Generate strategy',
      onRegenerate: vi.fn(),
    }),
  );
};

describe('networking strategy quality gate', () => {
  it('blocks download and copy when placeholders or template instructions remain', () => {
    const weakStrategy: NetworkingStrategyResult = {
      strategySummary: 'Reach out to [Company Name] contacts and insert specific reason before sending',
      contactSuggestions: [
        {
          contactType: '[Contact Name]',
          reason: 'Add a specific reason.',
          outreachMessage: 'Hi [Recipient Name], insert detail about relevant skill before asking for a chat',
        },
      ],
    };
    const validation = assessNetworkingStrategy(weakStrategy);
    const exportMarkup = renderExportGate(weakStrategy);
    const copyMarkup = renderToStaticMarkup(
      React.createElement(NetworkingCopyGate, {
        validation,
        text: weakStrategy.contactSuggestions[0].outreachMessage,
        label: 'Copy message',
      }),
    );

    expect(validation.status).toBe('needs_regen');
    expect(validation.issues).toContain('placeholder');
    expect(validation.issues).toContain('template_language');
    expect(canExportNetworkingStrategy(validation)).toBe(false);
    expect(exportMarkup).toContain('networking-export-blocked-regenerate');
    expect(exportMarkup).not.toContain('Download');
    expect(copyMarkup).toContain('networking-copy-blocked');
    expect(copyMarkup).not.toContain('Copy message');
  });

  it('allows export for a complete, specific networking plan', () => {
    const validation = assessNetworkingStrategy(strongStrategy);
    const exportMarkup = renderExportGate(strongStrategy);
    const copyMarkup = renderToStaticMarkup(
      React.createElement(NetworkingCopyGate, {
        validation,
        text: strongStrategy.contactSuggestions[0].outreachMessage,
        label: 'Copy message',
      }),
    );

    expect(validation.status).toBe('ok');
    expect(canExportNetworkingStrategy(validation)).toBe(true);
    expect(exportMarkup).toContain('Download');
    expect(exportMarkup).not.toContain('networking-export-blocked-regenerate');
    expect(copyMarkup).toContain('Copy message');
    expect(copyMarkup).not.toContain('networking-copy-blocked');
  });

  it('shows a quality notice for incomplete networking plans', () => {
    const validation = assessNetworkingStrategy({
      strategySummary: 'Talk to people.',
      contactSuggestions: [],
    });
    const markup = renderToStaticMarkup(
      React.createElement(NetworkingQualityNotice, { validation }),
    );

    expect(validation.status).toBe('needs_regen');
    expect(markup).toContain('networking-quality-notice');
    expect(markup).toContain('Fix this networking plan before exporting');
    expect(markup).toContain('Add contact suggestions.');
  });
});
