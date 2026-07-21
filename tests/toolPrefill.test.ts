import { describe, expect, it } from 'vitest';
import {
  buildCoverLetterContextFromOpportunity,
  buildEmailContextFromIndustryEvent,
  buildEmailContextFromNetworkingSuggestion,
  buildEmailContextFromSalaryNegotiation,
  buildInterviewSeedContext,
  buildJobContextFromOpportunity,
  buildLearningPlanContextFromSkillGap,
  buildLinkedInContextFromFormattedResume,
  buildSalaryContextFromOpportunity,
  parseToolEmailContext,
  parseToolInterviewSeed,
  parseToolJobContext,
  parseToolLearningContext,
  parseToolLinkedInResumeContext,
  parseToolSalaryContext,
} from '../lib/toolPrefill';

describe('tool prefill handoffs', () => {
  it('builds cover-letter context from an opportunity without template placeholders', () => {
    const context = buildCoverLetterContextFromOpportunity({
      jobTitle: 'Frontend Engineer',
      company: 'Northstar Labs',
      location: 'Ottawa, ON',
      url: 'https://example.com/jobs/frontend',
      summary: 'Build accessible React workflows for hiring teams.\n\nOwn TypeScript quality and release readiness.',
    });

    expect(context).toContain('Job Title: Frontend Engineer');
    expect(context).toContain('Company: Northstar Labs');
    expect(context).toContain('Location: Ottawa, ON');
    expect(context).toContain('Posting summary:');
    expect(context).toContain('Build accessible React workflows');
    expect(context).not.toMatch(/\[[^\]]*(paste|job description|company name|job title)[^\]]*\]/i);
  });

  it('omits empty fields without inventing missing posting content', () => {
    const context = buildCoverLetterContextFromOpportunity({
      jobTitle: 'Product Analyst',
      company: '',
      location: '',
      url: '#internal-job-1',
      summary: '',
    });

    expect(context).toBe('Job Title: Product Analyst');
    expect(context).not.toContain('Company:');
    expect(context).not.toContain('Location:');
    expect(context).not.toContain('Posting summary:');
    expect(context).not.toContain('Paste');
  });

  it('parses shared job context for downstream tools', () => {
    const context = buildJobContextFromOpportunity({
      jobTitle: 'Frontend Engineer',
      company: 'Seed Test Co',
      location: 'Toronto, ON',
      url: '#internal-job-seed',
      summary: 'Build accessible React workflows.\nOwn TypeScript quality.',
    });

    expect(parseToolJobContext(`${context}\n\nResponsibilities:\nShip candidate workflows\nRequired qualifications:\nproduction React`)).toEqual({
      jobTitle: 'Frontend Engineer',
      company: 'Seed Test Co',
      location: 'Toronto, ON',
      summary: 'Build accessible React workflows.\nOwn TypeScript quality.',
      responsibilities: 'Ship candidate workflows',
      requiredQualifications: 'production React',
    });
  });

  it('builds and parses salary context from an opportunity salary range', () => {
    const context = buildSalaryContextFromOpportunity(
      {
        jobTitle: 'Frontend Engineer',
        company: 'Seed Test Co',
        location: 'Toronto, ON',
        url: '#internal-job-seed',
        summary: 'Build accessible React workflows.',
      },
      '$110k\u2013140k CAD',
      'CAD',
    );

    expect(context).toContain('Job Title: Frontend Engineer');
    expect(context).toContain('Company: Seed Test Co');
    expect(context).toContain('Offer: 125000');
    expect(context).toContain('Currency: CAD');
    expect(context).toContain('Salary range: $110k\u2013140k CAD');
    expect(parseToolSalaryContext(context)).toEqual({
      jobTitle: 'Frontend Engineer',
      company: 'Seed Test Co',
      offer: '125000',
      currency: 'CAD',
      salaryRange: '$110k\u2013140k CAD',
    });
  });

  it('builds and parses career-path skill gap context for learning-plan handoff', () => {
    const context = buildLearningPlanContextFromSkillGap(
      {
        skill: 'Data storytelling',
        reason: 'The target role needs clearer metric-led product narratives.',
      },
      'Senior Product Manager',
    );

    expect(context).toContain('Skill: Data storytelling');
    expect(context).toContain('Target role: Senior Product Manager');
    expect(context).toContain('Reason: The target role needs clearer metric-led product narratives.');
    expect(parseToolLearningContext(context)).toEqual({
      skill: 'Data storytelling',
      targetRole: 'Senior Product Manager',
      reason: 'The target role needs clearer metric-led product narratives.',
    });
  });

  it('builds and parses networking outreach context for email handoff', () => {
    const context = buildEmailContextFromNetworkingSuggestion({
      contactType: 'Engineering Manager',
      company: 'Northstar Labs',
      role: 'Frontend Engineer',
      location: 'Ottawa, ON',
      reason: 'Likely owns the candidate-facing accessibility roadmap.',
      outreachMessage: 'I noticed your team is building accessible hiring workflows and would value a short conversation.',
    });

    expect(context).toContain('Email Scenario: Networking Outreach');
    expect(context).toContain('Recipient Title: Engineering Manager');
    expect(context).toContain('Recipient Company: Northstar Labs');
    expect(context).toContain('Target role: Frontend Engineer');
    expect(context).toContain('Message context:');
    expect(parseToolEmailContext(context)).toEqual({
      scenario: 'Networking Outreach',
      recipientTitle: 'Engineering Manager',
      recipientCompany: 'Northstar Labs',
      targetRole: 'Frontend Engineer',
      targetLocation: 'Ottawa, ON',
      reason: 'Likely owns the candidate-facing accessibility roadmap.',
      messageContext: 'I noticed your team is building accessible hiring workflows and would value a short conversation.',
    });
  });

  it('builds and parses industry event context for email handoff', () => {
    const context = buildEmailContextFromIndustryEvent(
      {
        eventName: 'Toronto AI Hiring Night',
        date: 'July 18, 2026',
        location: 'Toronto, ON',
        url: 'https://example.com/events/ai-hiring',
        summary: 'Meet local AI teams and recruiters hiring product-focused engineers.',
        eventType: 'job_fair',
      },
      'Artificial Intelligence',
    );

    expect(context).toContain('Email Scenario: Networking Outreach');
    expect(context).toContain('Recipient Title: Event organizer or relevant attendee');
    expect(context).toContain('Recipient Company: Toronto AI Hiring Night');
    expect(context).toContain('Target role: Artificial Intelligence networking');
    expect(context).toContain('Message context:');
    expect(parseToolEmailContext(context)).toEqual({
      scenario: 'Networking Outreach',
      recipientTitle: 'Event organizer or relevant attendee',
      recipientCompany: 'Toronto AI Hiring Night',
      targetRole: 'Artificial Intelligence networking',
      targetLocation: 'Toronto, ON',
      reason: 'Interested in Artificial Intelligence conversations connected to this event.',
      messageContext: 'Date: July 18, 2026\nLocation: Toronto, ON\nMeet local AI teams and recruiters hiring product-focused engineers.\nEvent page: https://example.com/events/ai-hiring',
    });
  });

  it('builds and parses salary negotiation context for email handoff', () => {
    const context = buildEmailContextFromSalaryNegotiation({
      jobTitle: 'Frontend Engineer',
      company: 'Seed Test Co',
      offerLabel: 'CAD 125,000',
      targetRangeLabel: 'CAD 135,000 - CAD 145,000',
      counterOfferEmailDraft: 'Thank you for the offer. I would like to discuss the base salary range.',
      marketAnalysisSummary: 'Toronto frontend roles with React ownership support a higher band.',
    });

    expect(context).toContain('Email Source: Salary Negotiator');
    expect(context).toContain('Email Scenario: Salary Counter-Offer');
    expect(context).toContain('Company: Seed Test Co');
    expect(context).toContain('Current offer: CAD 125,000');
    expect(context).toContain('Target range: CAD 135,000 - CAD 145,000');
    expect(parseToolEmailContext(context)).toEqual({
      source: 'Salary Negotiator',
      scenario: 'Salary Counter-Offer',
      company: 'Seed Test Co',
      jobTitle: 'Frontend Engineer',
      currentOffer: 'CAD 125,000',
      targetRange: 'CAD 135,000 - CAD 145,000',
      messageContext: 'Market analysis: Toronto frontend roles with React ownership support a higher band.\n\nExisting draft:\nThank you for the offer. I would like to discuss the base salary range.',
    });
  });

  it('builds and parses formatted resume context for linkedin handoff', () => {
    const context = buildLinkedInContextFromFormattedResume({
      formattedText: 'Alex Chen\nSoftware Engineer\n\nExperience\nBuilt React workflows for hiring teams.',
      targetMarket: 'Canada',
      outputLanguage: 'en',
    });

    expect(context).toContain('LinkedIn Source: Resume Formatter');
    expect(context).toContain('Target market: Canada');
    expect(context).toContain('Formatted resume:');
    expect(parseToolLinkedInResumeContext(context)).toEqual({
      source: 'Resume Formatter',
      targetMarket: 'Canada',
      formattedResume: 'Alex Chen\nSoftware Engineer\n\nExperience\nBuilt React workflows for hiring teams.',
    });
  });

  it('builds an interview seed payload the mock interview can parse for both job and seed questions', () => {
    const context = buildInterviewSeedContext({
      targetRole: 'Machine Learning Engineer',
      company: 'Seed Test Co',
      jobSummary: 'Own retrieval-augmented generation pipelines.\nShip evaluation harnesses.',
      questions: [
        { question: 'Walk me through your RAG pipeline architecture.', category: 'Technical' },
        { question: 'Tell me about a time you owned an ambiguous project.', category: 'Behavioural' },
        { question: 'How would you design an eval: offline vs. online?', category: 'System Design' },
      ],
    });

    // The job-context parser must recover the role/company/summary and must NOT
    // absorb the seed-question block into the posting summary.
    expect(parseToolJobContext(context)).toEqual({
      jobTitle: 'Machine Learning Engineer',
      company: 'Seed Test Co',
      summary: 'Own retrieval-augmented generation pipelines.\nShip evaluation harnesses.',
    });

    // The seed parser recovers each question with its category, preserving a
    // colon inside the question text.
    expect(parseToolInterviewSeed(context)).toEqual([
      { category: 'Technical', question: 'Walk me through your RAG pipeline architecture.' },
      { category: 'Behavioural', question: 'Tell me about a time you owned an ambiguous project.' },
      { category: 'System Design', question: 'How would you design an eval: offline vs. online?' },
    ]);
  });

  it('handles an interview seed payload with no job summary (seed block runs to end of input)', () => {
    const context = buildInterviewSeedContext({
      targetRole: 'Product Analyst',
      questions: [
        { question: 'How do you prioritize conflicting metrics?' },
        { question: 'Describe a dashboard you shipped.', category: 'Behavioural' },
      ],
    });

    expect(parseToolJobContext(context)).toEqual({ jobTitle: 'Product Analyst' });
    expect(parseToolInterviewSeed(context)).toEqual([
      { category: 'General', question: 'How do you prioritize conflicting metrics?' },
      { category: 'Behavioural', question: 'Describe a dashboard you shipped.' },
    ]);
  });

  it('does not truncate seed questions whose text starts with a job-context label', () => {
    const context = buildInterviewSeedContext({
      targetRole: 'Engineering Manager',
      jobSummary: 'Lead a platform team.',
      questions: [
        { question: 'Location: where do you see this team in two years?', category: 'Behavioural' },
        { question: 'Posting summary: walk me through how you scope a roadmap.', category: 'System Design' },
        { question: 'How do you handle a missed deadline?' },
      ],
    });

    // The seed lines contain colons and even verbatim job-context labels, but the
    // bracketed prefix keeps them from being mistaken for the posting-summary
    // boundary — all three survive, and the real summary is still recovered.
    expect(parseToolInterviewSeed(context)).toEqual([
      { category: 'Behavioural', question: 'Location: where do you see this team in two years?' },
      { category: 'System Design', question: 'Posting summary: walk me through how you scope a roadmap.' },
      { category: 'General', question: 'How do you handle a missed deadline?' },
    ]);
    expect(parseToolJobContext(context)).toEqual({
      jobTitle: 'Engineering Manager',
      summary: 'Lead a platform team.',
    });
  });

  it('returns no seed questions for a plain job context (no seed block)', () => {
    const context = buildJobContextFromOpportunity({
      jobTitle: 'Frontend Engineer',
      company: 'Seed Test Co',
      location: 'Toronto, ON',
      url: '#internal-job-seed',
      summary: 'Build accessible React workflows.',
    });

    expect(parseToolInterviewSeed(context)).toEqual([]);
  });
});
