import { describe, expect, it } from 'vitest';
import { assessCoverLetterDraft } from '../components/tools/CoverLetterActions';
import { assessEmailDraft } from '../components/tools/EmailActions';
import { assessLinkedInOptimization } from '../components/tools/LinkedInActions';
import { assessNetworkingStrategy } from '../components/tools/NetworkingActions';
import { assessSalaryNegotiation } from '../components/tools/SalaryActions';
import {
  coverLetterDraftIssues,
  emailDraftIssues,
  formattedResumeIssues,
  linkedInOptimizationIssues,
  networkingStrategyIssues,
  salaryNegotiationIssues,
} from '../functions/src/llm/draftQuality';
import { assessFormattedResume } from '../lib/resumePreview';

const words = (value: string, count: number, ending = '.'): string =>
  `${Array.from({ length: count }, () => value).join(' ')}${ending}`;

describe('server/client blocking quality parity', () => {
  it('repairs a long cover letter that still lacks opening/body/close paragraphs', () => {
    const oneParagraph = words('relevant delivery evidence', 35);
    expect(assessCoverLetterDraft(oneParagraph)).toMatchObject({
      status: 'needs_regen',
      issues: expect.arrayContaining(['thin_structure']),
    });
    expect(coverLetterDraftIssues(oneParagraph)).toContain('thin_structure');
  });

  it('uses the client email minimum and template-language checks', () => {
    const shortBody = words('specific detail evidence', 14);
    const client = assessEmailDraft('Following up on the role', shortBody);
    const server = emailDraftIssues('Following up on the role', shortBody);
    expect(client.status).toBe('needs_regen');
    expect(client.issues).toContain('too_short');
    expect(server).toEqual(expect.arrayContaining(['too_short', 'template_language']));
  });

  it('checks LinkedIn experience rewrites, not only headline and summary', () => {
    const result = {
      headline: 'Senior product engineer connecting delivery and customer outcomes',
      summary: words('I connect product research engineering delivery and measurable customer outcomes', 7),
      experienceSuggestions: [],
    };
    expect(assessLinkedInOptimization(result)).toMatchObject({
      status: 'needs_regen',
      issues: expect.arrayContaining(['missing_experience_suggestions']),
    });
    expect(linkedInOptimizationIssues(result)).toContain('missing_experience_suggestions');
  });

  it('checks every networking contact while leaving few_contacts as a warning', () => {
    const result = {
      strategySummary: words('Build focused peer conversations around relevant product and engineering delivery evidence', 5),
      contactSuggestions: [{
        contactType: 'Product operations peer',
        reason: 'Relevant peer.',
        outreachMessage: words('I would value your perspective on product operations and engineering delivery', 4, ''),
      }],
    };
    const client = assessNetworkingStrategy(result);
    const server = networkingStrategyIssues(result);
    expect(client.status).toBe('needs_regen');
    expect(client.issues).toEqual(expect.arrayContaining(['few_contacts', 'thin_reason', 'unfinished_outreach']));
    expect(server).toEqual(expect.arrayContaining(['thin_reason', 'unfinished_outreach']));
    expect(server).not.toContain('few_contacts');
  });

  it('checks salary range, steps, and objection handlers field by field', () => {
    const result = {
      marketAnalysisSummary: words('The local market supports an evidence based counter grounded in role scope and delivery impact', 3),
      recommendedRange: { baseMin: 130000, baseMax: 120000, currency: '', explanation: '' },
      keyStrengths: ['Cross-functional delivery leadership'],
      negotiationStrategy: ['Ask politely.'],
      counterOfferEmailDraft: words('Thank you for the offer and the opportunity to discuss a compensation range aligned with this role', 7),
      objectionHandlers: [{ objection: 'The band is fixed.', response: 'Understood.' }],
    };
    const client = assessSalaryNegotiation(result);
    const server = salaryNegotiationIssues(result);
    expect(client.status).toBe('needs_regen');
    expect(client.issues).toEqual(expect.arrayContaining([
      'invalid_range',
      'missing_currency',
      'missing_range_explanation',
      'thin_strategy',
      'thin_strategy_step',
      'thin_objection_response',
    ]));
    expect(server).toEqual(expect.arrayContaining([
      'invalid_range',
      'missing_currency',
      'missing_range_explanation',
      'thin_strategy',
      'thin_strategy_step',
      'thin_objection_response',
    ]));
  });

  it('detects English resume body text behind localized French headings', () => {
    const resume = [
      'Jean Dupont',
      'jean@example.com',
      '',
      'PROFIL',
      words('Experienced product engineer who led software teams and delivered measurable customer outcomes', 8),
      '',
      'EXPÉRIENCE PROFESSIONNELLE',
      words('Built software products with research teams and improved the user experience across projects', 8),
    ].join('\n');
    expect(assessFormattedResume(resume, { outputLanguage: 'French' })).toMatchObject({
      status: 'needs_regen',
      issues: expect.arrayContaining(['language_mismatch']),
    });
    expect(formattedResumeIssues(resume, 'French')).toContain('language_mismatch');
  });

  it('detects the formatter structure failures that block the client', () => {
    const blob = words('Delivered measurable software product outcomes across several cross functional teams', 45);
    expect(assessFormattedResume(blob)).toMatchObject({
      status: 'needs_regen',
      issues: expect.arrayContaining(['no_sections']),
    });
    expect(formattedResumeIssues(blob)).toContain('no_sections');
  });
});
