import type { FormattedResume, IndustryEvent, Opportunity, SkillGap } from '../types';

const normalizeLine = (value: string | null | undefined): string => (
  (value ?? '').replace(/\s+/g, ' ').trim()
);

export type ToolJobContext = {
  jobTitle?: string;
  company?: string;
  location?: string;
  summary?: string;
  responsibilities?: string;
  requiredQualifications?: string;
};

export type ToolLearningContext = {
  skill?: string;
  targetRole?: string;
  reason?: string;
};

export type ToolEmailContext = {
  source?: string;
  scenario?: string;
  jobTitle?: string;
  company?: string;
  currentOffer?: string;
  targetRange?: string;
  recipientName?: string;
  recipientTitle?: string;
  recipientCompany?: string;
  targetRole?: string;
  targetLocation?: string;
  reason?: string;
  messageContext?: string;
};

export type ToolLinkedInResumeContext = {
  source?: string;
  targetMarket?: string;
  formattedResume?: string;
};

export type ToolSalaryContext = {
  jobTitle?: string;
  company?: string;
  offer?: string;
  currency?: string;
  salaryRange?: string;
};

export type ToolInterviewSeedQuestion = {
  question: string;
  /** Free-text category (e.g. "Behavioural"); empty when none was supplied. */
  category: string;
};

const JOB_SECTION_LABELS: Record<string, keyof ToolJobContext> = {
  'Posting summary': 'summary',
  Responsibilities: 'responsibilities',
  'Required qualifications': 'requiredQualifications',
};

const JOB_FIELD_LABELS: Record<string, keyof ToolJobContext> = {
  'Job Title': 'jobTitle',
  Company: 'company',
  Location: 'location',
};

const LEARNING_FIELD_LABELS: Record<string, keyof ToolLearningContext> = {
  Skill: 'skill',
  'Target role': 'targetRole',
  Reason: 'reason',
};

const EMAIL_FIELD_LABELS: Record<string, keyof ToolEmailContext> = {
  'Email Source': 'source',
  'Email Scenario': 'scenario',
  'Job Title': 'jobTitle',
  Company: 'company',
  'Current offer': 'currentOffer',
  'Target range': 'targetRange',
  'Recipient Name': 'recipientName',
  'Recipient Title': 'recipientTitle',
  'Recipient Company': 'recipientCompany',
  'Target role': 'targetRole',
  'Target location': 'targetLocation',
  Reason: 'reason',
};

const EMAIL_SECTION_LABELS: Record<string, keyof ToolEmailContext> = {
  'Message context': 'messageContext',
};

const LINKEDIN_RESUME_FIELD_LABELS: Record<string, keyof ToolLinkedInResumeContext> = {
  'LinkedIn Source': 'source',
  'Target market': 'targetMarket',
};

const LINKEDIN_RESUME_SECTION_LABELS: Record<string, keyof ToolLinkedInResumeContext> = {
  'Formatted resume': 'formattedResume',
};

const SALARY_FIELD_LABELS: Record<string, keyof ToolSalaryContext> = {
  'Job Title': 'jobTitle',
  Company: 'company',
  Offer: 'offer',
  Currency: 'currency',
  'Salary range': 'salaryRange',
};

const appendSection = (lines: string[], label: string, value: string | null | undefined) => {
  const text = value?.trim();
  if (text) lines.push('', `${label}:`, text);
};

const inferCurrencyFromSalaryRange = (value: string | null | undefined): string => {
  const text = normalizeLine(value).toUpperCase();
  if (!text) return '';
  if (/\bCAD\b|C\$/.test(text)) return 'CAD';
  if (/\bUSD\b|US\$/.test(text)) return 'USD';
  if (/\bGBP\b|£/.test(text)) return 'GBP';
  if (/\bEUR\b|€/.test(text)) return 'EUR';
  if (/\bAUD\b|A\$/.test(text)) return 'AUD';
  if (/\bJPY\b|¥/.test(text)) return 'JPY';
  if (/\bSGD\b|S\$/.test(text)) return 'SGD';
  if (/\bAED\b/.test(text)) return 'AED';
  if (/\$/.test(text)) return 'USD';
  return '';
};

const parseSalaryNumber = (value: string): number | null => {
  const normalized = value.replace(/,/g, '').trim();
  const match = normalized.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  if (!Number.isFinite(number)) return null;
  return /k\b/i.test(normalized) ? number * 1000 : number;
};

const inferOfferFromSalaryRange = (value: string | null | undefined): string => {
  const numbers = Array.from(normalizeLine(value).matchAll(/\d[\d,]*(?:\.\d+)?\s*k\b|\d[\d,]*(?:\.\d+)?/gi))
    .map((match) => parseSalaryNumber(match[0]))
    .filter((number): number is number => number !== null && number > 0);
  if (!numbers.length) return '';
  const estimate = numbers.length >= 2 ? (numbers[0] + numbers[1]) / 2 : numbers[0];
  return String(Math.round(estimate));
};

/**
 * Builds the handoff text used when an opportunity card opens Cover Letter.
 * Keep it grounded in the selected card and never inject bracket placeholders,
 * because Cover Letter auto-runs when it receives initial input.
 */
export function buildCoverLetterContextFromOpportunity(job: Opportunity): string {
  const lines = [
    ['Job Title', normalizeLine(job.jobTitle)],
    ['Company', normalizeLine(job.company)],
    ['Location', normalizeLine(job.location)],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`);

  const summary = job.summary?.trim();
  if (summary) {
    lines.push('', 'Posting summary:', summary);
  }

  return lines.join('\n').trim();
}

export function buildJobContextFromOpportunity(job: Opportunity): string {
  const lines = [
    ['Job Title', normalizeLine(job.jobTitle)],
    ['Company', normalizeLine(job.company)],
    ['Location', normalizeLine(job.location)],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`);

  appendSection(lines, 'Posting summary', job.summary);

  return lines.join('\n').trim();
}

export function buildSalaryContextFromOpportunity(job: Opportunity, salaryRange?: string, fallbackCurrency = 'USD'): string {
  const range = normalizeLine(salaryRange);
  const lines = [
    ['Job Title', normalizeLine(job.jobTitle)],
    ['Company', normalizeLine(job.company)],
    ['Offer', inferOfferFromSalaryRange(range)],
    ['Currency', inferCurrencyFromSalaryRange(range) || normalizeLine(fallbackCurrency)],
    ['Salary range', range],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`);

  return lines.join('\n').trim();
}

export function buildLearningPlanContextFromSkillGap(gap: SkillGap, targetRole?: string): string {
  const lines = [
    ['Skill', normalizeLine(gap.skill)],
    ['Target role', normalizeLine(targetRole)],
    ['Reason', normalizeLine(gap.reason)],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`);

  return lines.join('\n').trim();
}

export function buildEmailContextFromNetworkingSuggestion(input: {
  contactType?: string;
  company?: string;
  role?: string;
  location?: string;
  reason?: string;
  outreachMessage?: string;
}): string {
  const lines = [
    ['Email Scenario', 'Networking Outreach'],
    ['Recipient Title', normalizeLine(input.contactType)],
    ['Recipient Company', normalizeLine(input.company)],
    ['Target role', normalizeLine(input.role)],
    ['Target location', normalizeLine(input.location)],
    ['Reason', normalizeLine(input.reason)],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`);

  appendSection(lines, 'Message context', input.outreachMessage);

  return lines.join('\n').trim();
}

export function buildEmailContextFromIndustryEvent(event: IndustryEvent, field?: string): string {
  const focus = normalizeLine(field);
  const lines = [
    ['Email Scenario', 'Networking Outreach'],
    ['Recipient Title', 'Event organizer or relevant attendee'],
    ['Recipient Company', normalizeLine(event.eventName)],
    ['Target role', focus ? `${focus} networking` : 'Professional networking'],
    ['Target location', normalizeLine(event.location)],
    [
      'Reason',
      focus
        ? `Interested in ${focus} conversations connected to this event.`
        : 'Interested in relevant career conversations connected to this event.',
    ],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`);

  appendSection(lines, 'Message context', [
    event.date ? `Date: ${event.date}` : '',
    event.location ? `Location: ${event.location}` : '',
    event.summary?.trim() || '',
    event.url ? `Event page: ${event.url}` : '',
  ].filter(Boolean).join('\n'));

  return lines.join('\n').trim();
}

export function buildEmailContextFromSalaryNegotiation(input: {
  jobTitle?: string;
  company?: string;
  offerLabel?: string;
  targetRangeLabel?: string;
  counterOfferEmailDraft?: string;
  marketAnalysisSummary?: string;
}): string {
  const lines = [
    ['Email Source', 'Salary Negotiator'],
    ['Email Scenario', 'Salary Counter-Offer'],
    ['Company', normalizeLine(input.company)],
    ['Job Title', normalizeLine(input.jobTitle)],
    ['Current offer', normalizeLine(input.offerLabel)],
    ['Target range', normalizeLine(input.targetRangeLabel)],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`);

  appendSection(lines, 'Message context', [
    input.marketAnalysisSummary ? `Market analysis: ${input.marketAnalysisSummary.trim()}` : '',
    input.counterOfferEmailDraft ? `Existing draft:\n${input.counterOfferEmailDraft.trim()}` : '',
  ].filter(Boolean).join('\n\n'));

  return lines.join('\n').trim();
}

export function buildLinkedInContextFromFormattedResume(resume: FormattedResume, market?: string): string {
  const lines = [
    ['LinkedIn Source', 'Resume Formatter'],
    ['Target market', normalizeLine(resume.targetMarket || market)],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`);

  appendSection(lines, 'Formatted resume', resume.formattedText);

  return lines.join('\n').trim();
}

export function parseToolJobContext(input: string | null | undefined): ToolJobContext {
  const context: ToolJobContext = {};
  const lines = (input ?? '').split(/\r?\n/);
  let activeSection: keyof ToolJobContext | null = null;
  const sectionLines: string[] = [];

  const flushSection = () => {
    if (activeSection) {
      const text = sectionLines.join('\n').trim();
      if (text) context[activeSection] = text;
    }
    activeSection = null;
    sectionLines.length = 0;
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trimEnd();
    const fieldMatch = line.match(/^([^:]+):\s*(.*)$/);
    if (fieldMatch) {
      const label = fieldMatch[1].trim();
      const inlineValue = fieldMatch[2].trim();
      const field = JOB_FIELD_LABELS[label];
      const section = JOB_SECTION_LABELS[label];

      if (field) {
        flushSection();
        if (inlineValue) context[field] = inlineValue;
        return;
      }

      if (section) {
        flushSection();
        activeSection = section;
        if (inlineValue) sectionLines.push(inlineValue);
        return;
      }
    }

    if (activeSection) sectionLines.push(line);
  });

  flushSection();

  return context;
}

export function parseToolEmailContext(input: string | null | undefined): ToolEmailContext {
  const context: ToolEmailContext = {};
  const lines = (input ?? '').split(/\r?\n/);
  let activeSection: keyof ToolEmailContext | null = null;
  const sectionLines: string[] = [];

  const flushSection = () => {
    if (activeSection) {
      const text = sectionLines.join('\n').trim();
      if (text) context[activeSection] = text;
    }
    activeSection = null;
    sectionLines.length = 0;
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trimEnd();
    const fieldMatch = line.match(/^([^:]+):\s*(.*)$/);
    if (fieldMatch) {
      const label = fieldMatch[1].trim();
      const inlineValue = fieldMatch[2].trim();
      const field = EMAIL_FIELD_LABELS[label];
      const section = EMAIL_SECTION_LABELS[label];

      if (field) {
        flushSection();
        if (inlineValue) context[field] = inlineValue;
        return;
      }

      if (section) {
        flushSection();
        activeSection = section;
        if (inlineValue) sectionLines.push(inlineValue);
        return;
      }
    }

    if (activeSection) sectionLines.push(line);
  });

  flushSection();

  return context;
}

export function parseToolLinkedInResumeContext(input: string | null | undefined): ToolLinkedInResumeContext {
  const context: ToolLinkedInResumeContext = {};
  const lines = (input ?? '').split(/\r?\n/);
  let activeSection: keyof ToolLinkedInResumeContext | null = null;
  const sectionLines: string[] = [];

  const flushSection = () => {
    if (activeSection) {
      const text = sectionLines.join('\n').trim();
      if (text) context[activeSection] = text;
    }
    activeSection = null;
    sectionLines.length = 0;
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trimEnd();
    const fieldMatch = line.match(/^([^:]+):\s*(.*)$/);
    if (fieldMatch) {
      const label = fieldMatch[1].trim();
      const inlineValue = fieldMatch[2].trim();
      const field = LINKEDIN_RESUME_FIELD_LABELS[label];
      const section = LINKEDIN_RESUME_SECTION_LABELS[label];

      if (field) {
        flushSection();
        if (inlineValue) context[field] = inlineValue;
        return;
      }

      if (section) {
        flushSection();
        activeSection = section;
        if (inlineValue) sectionLines.push(inlineValue);
        return;
      }
    }

    if (activeSection) sectionLines.push(line);
  });

  flushSection();

  return context;
}

export function parseToolLearningContext(input: string | null | undefined): ToolLearningContext {
  const context: ToolLearningContext = {};

  (input ?? '').split(/\r?\n/).forEach((rawLine) => {
    const match = rawLine.match(/^([^:]+):\s*(.*)$/);
    if (!match) return;
    const label = match[1].trim();
    const field = LEARNING_FIELD_LABELS[label];
    const value = match[2].trim();
    if (field && value) context[field] = value;
  });

  return context;
}

export function parseToolSalaryContext(input: string | null | undefined): ToolSalaryContext {
  const context: ToolSalaryContext = {};

  (input ?? '').split(/\r?\n/).forEach((rawLine) => {
    const match = rawLine.match(/^([^:]+):\s*(.*)$/);
    if (!match) return;
    const label = match[1].trim();
    const field = SALARY_FIELD_LABELS[label];
    const value = match[2].trim();
    if (field && value) context[field] = value;
  });

  return context;
}

// ── Interview Prep → Mock Interview seed handoff ─────────────────────────────
// The Interview Prep tool hands its ranked questions to Mock Interview through
// the same string-based openTool() channel every other tool uses. The payload
// doubles as a normal job context (Job Title / Company / Posting summary, parsed
// by parseToolJobContext) PLUS a labelled seed-questions block consumed by
// parseToolInterviewSeed. The seed block is emitted BEFORE "Posting summary:" so
// the job parser's open section never absorbs the seed lines.
const INTERVIEW_SEED_LABEL = 'Seed interview questions';

const JOB_STOP_LABELS = new Set<string>([
  ...Object.keys(JOB_FIELD_LABELS),
  ...Object.keys(JOB_SECTION_LABELS),
]);

export function buildInterviewSeedContext(input: {
  targetRole?: string;
  company?: string;
  jobSummary?: string;
  questions: Array<{ question: string; category?: string }>;
}): string {
  const lines = [
    ['Job Title', normalizeLine(input.targetRole)],
    ['Company', normalizeLine(input.company)],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`);

  // Always emit a [Category] prefix (defaulting to "General"). The bracket makes
  // every seed line unambiguous to the parser: a question whose text happens to
  // start with a job-context label (e.g. "Location: where do you see yourself?")
  // can never be mistaken for the real "Posting summary:" boundary below.
  const seedLines = (input.questions ?? [])
    .map((q) => ({ question: normalizeLine(q.question), category: normalizeLine(q.category) || 'General' }))
    .filter((q) => q.question)
    .map((q) => `[${q.category}] ${q.question}`);

  if (seedLines.length) {
    lines.push('', `${INTERVIEW_SEED_LABEL}:`, ...seedLines);
  }

  // Posting summary goes LAST so the job-context parser's open section can never
  // swallow the seed block emitted above it.
  appendSection(lines, 'Posting summary', input.jobSummary);

  return lines.join('\n').trim();
}

export function parseToolInterviewSeed(input: string | null | undefined): ToolInterviewSeedQuestion[] {
  const lines = (input ?? '').split(/\r?\n/);
  const seeds: ToolInterviewSeedQuestion[] = [];
  let collecting = false;
  const headerPrefix = `${INTERVIEW_SEED_LABEL.toLowerCase()}:`;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!collecting) {
      if (line.toLowerCase().startsWith(headerPrefix)) collecting = true;
      continue;
    }
    if (!line) continue;
    const categoryMatch = line.match(/^\[([^\]]+)\]\s*(.+)$/);
    // Stop once another known job-context label appears (e.g. "Posting summary:").
    // A bracketed seed line is never a boundary, even if its text contains a colon.
    if (!categoryMatch) {
      const labelMatch = line.match(/^([^:]+):\s*(.*)$/);
      if (labelMatch && JOB_STOP_LABELS.has(labelMatch[1].trim())) break;
    }
    if (categoryMatch) {
      seeds.push({ category: categoryMatch[1].trim(), question: categoryMatch[2].trim() });
    } else {
      seeds.push({ category: '', question: line });
    }
  }

  return seeds;
}
