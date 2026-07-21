import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { LinkedInOptimization } from '../types';
import {
  assessLinkedInOptimization,
  buildLinkedInDownloadText,
  canExportLinkedInOptimization,
  LinkedInExportGate,
  LinkedInQualityNotice,
} from '../components/tools/LinkedInActions';

const strongProfile: LinkedInOptimization = {
  headline: 'Product Operations Candidate | Technical Project Coordination | Agile Delivery and Customer Feedback',
  summary: `I connect technical delivery, customer feedback, and cross-functional execution. My background spans electrical and computer engineering, software project coordination, user research, and product operations work for AI-enabled career tools.

At Career CoPilot, I coordinated a 6-person engineering team that moved an AI career platform from MVP into a production-ready release. I translated customer feedback into Jira work, clarified delivery risks, and helped standardize sprint planning and review workflows across engineering and product conversations.

I am looking for product operations and technical project roles where I can combine structured execution, stakeholder communication, data-informed prioritization, and hands-on software fluency to help teams ship clearer, more reliable products.`,
  experienceSuggestions: [
    {
      title: 'Career CoPilot - Project Management Lead',
      suggestion: 'Coordinated a 6-person engineering team to move an AI career platform from MVP toward production readiness, translating customer feedback into product requirements, Jira tasks, risk reviews, and sprint planning routines.',
    },
  ],
};

const renderGate = (profile: LinkedInOptimization) => {
  const text = buildLinkedInDownloadText(profile, {
    headline: 'Headline',
    summary: 'Summary',
    experience: 'Experience',
  });
  return renderToStaticMarkup(
    React.createElement(LinkedInExportGate, {
      validation: assessLinkedInOptimization(profile),
      text,
      regenerateLabel: 'Generate profile',
      onRegenerate: vi.fn(),
    }),
  );
};

describe('LinkedIn optimization quality gate', () => {
  it('blocks export when placeholders or template instructions remain', () => {
    const profile: LinkedInOptimization = {
      headline: '[Current Role] | [relevant skill]',
      summary: 'Insert metric and specific achievement for the target role before publishing.',
      experienceSuggestions: [
        { title: '[Company Name]', suggestion: 'Add a specific achievement and measurable result.' },
      ],
    };
    const validation = assessLinkedInOptimization(profile);
    const markup = renderGate(profile);

    expect(validation.status).toBe('needs_regen');
    expect(validation.issues).toContain('placeholder');
    expect(validation.issues).toContain('template_language');
    expect(canExportLinkedInOptimization(validation)).toBe(false);
    expect(markup).toContain('linkedin-export-blocked-regenerate');
    expect(markup).toContain('Generate profile');
    expect(markup).not.toContain('Download');
  });

  it('allows export for a complete, specific optimization result', () => {
    const validation = assessLinkedInOptimization(strongProfile);
    const markup = renderGate(strongProfile);

    expect(validation.status).toBe('ok');
    expect(canExportLinkedInOptimization(validation)).toBe(true);
    expect(markup).toContain('Download');
    expect(markup).not.toContain('linkedin-export-blocked-regenerate');
  });

  it('shows a quality notice for structurally thin results', () => {
    const validation = assessLinkedInOptimization({
      headline: 'Engineer',
      summary: 'Experienced engineer',
      experienceSuggestions: [],
    });
    const markup = renderToStaticMarkup(
      React.createElement(LinkedInQualityNotice, { validation }),
    );

    expect(validation.status).toBe('needs_regen');
    expect(markup).toContain('linkedin-quality-notice');
    expect(markup).toContain('Fix this profile draft before exporting');
    expect(markup).toContain('Add at least one experience rewrite.');
  });
});
