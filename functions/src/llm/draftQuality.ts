/**
 * Server-side draft quality review — the "second pass" between the model and
 * the user.
 *
 * The client blocks exporting drafts that look unfinished ("Fix this draft
 * before exporting"), which protects the user from sending broken artifacts
 * but leaves them holding a charged, unusable result they must manually
 * regenerate. These helpers let the SERVER detect the same blocking defects
 * and retry once with a corrective instruction INSIDE the same charged call,
 * so the user almost always receives a finished draft on the first click.
 *
 * Checks mirror the client gates (components/tools/*Actions.tsx) and must stay
 * language-aware: drafts are now generated in any UI language, so "complete"
 * cannot mean "ends with an ASCII period".
 */

const hasCjkText = (text: string): boolean => /[぀-ヿ㐀-鿿]/.test(text);

const countWords = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

type QualityRecord = Record<string, unknown>;

const asRecord = (value: unknown): QualityRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as QualityRecord
    : null;

const field = (value: unknown, key: string): unknown => asRecord(value)?.[key];

const normalizeText = (value: unknown): string =>
  (typeof value === "string" ? value : "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();

const records = (value: unknown): QualityRecord[] =>
  Array.isArray(value) ? value.map(asRecord).map((item) => item ?? {}) : [];

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(normalizeText).filter(Boolean) : [];

const unique = (issues: string[]): string[] => [...new Set(issues)];

/**
 * True when the text ends like a finished sentence in any supported script:
 * terminal punctuation (Latin, CJK, Arabic, Devanagari…) optionally followed
 * by closing quotes/brackets or markdown emphasis marks.
 */
export function hasFinishedEnding(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // Strip trailing closers: quotes, brackets, markdown bold/italic markers.
  const stripped = trimmed.replace(/["'”’»›」』〉》)\]}*_`\s]+$/u, "");
  return /[.!?。！？…؟۔।]$/u.test(stripped);
}

/** Email sign-offs naturally end in a name, not punctuation. */
function hasFinishedEmailBody(text: string): boolean {
  const lines = text.replace(/\r/g, "\n").split("\n");
  const signoff = /^(?:best(?: regards)?|kind regards|regards|sincerely|thank you|thanks|warmly|cordially|respectfully|cheers|merci|cordialement|bien à vous|saludos|atentamente)[,!]?$/i;
  const signoffIndex = lines.findIndex((line) => signoff.test(line.trim()));
  const prose = (signoffIndex >= 0 ? lines.slice(0, signoffIndex) : lines)
    .join("\n")
    .trim();
  return hasFinishedEnding(prose || text);
}

/** Placeholder / template-instruction artifacts that mean "not a final draft". */
export function hasPlaceholderText(text: string): boolean {
  if (/\[[^\]\n]{2,}\]|\{\{[^}]+\}\}|<[^>\n]{2,}>/.test(text)) return true;
  if (/\b(?:Your Name|Your Address|Your Email|Your Phone Number|Company Name|Job Title|Hiring Manager Name)\b/i.test(text)) return true;
  if (/specific (?:action|project|achievement|skill area|reason)|measurable or clear outcome|relevant skill area/i.test(text)) return true;
  return false;
}

export interface ProseCheckOptions {
  /** Minimum word count for non-CJK text (default 0 = no minimum). */
  minWords?: number;
  /** Minimum character count for CJK text (default 0 = no minimum). */
  minCjkChars?: number;
  /** Require a finished sentence ending (default true). */
  requireEnding?: boolean;
}

/**
 * Blocking defects in a prose draft. Empty array = ship it.
 * Issue slugs intentionally match the client gates.
 */
export function proseDraftIssues(text: string | undefined | null, opts: ProseCheckOptions = {}): string[] {
  const normalized = String(text ?? "").replace(/\r/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!normalized) return ["empty"];

  const issues: string[] = [];
  if (hasCjkText(normalized)) {
    if (opts.minCjkChars && normalized.length < opts.minCjkChars) issues.push("too_short");
  } else if (opts.minWords && countWords(normalized) < opts.minWords) {
    issues.push("too_short");
  }
  if (hasPlaceholderText(normalized)) issues.push("placeholder");
  if (opts.requireEnding !== false && !hasFinishedEnding(normalized)) issues.push("unfinished_ending");
  return issues;
}

/** Blocking subset of components/tools/CoverLetterActions.tsx. */
export function coverLetterDraftIssues(text: string | undefined | null): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return ["empty"];

  const issues: string[] = [];
  const paragraphs = normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  if (hasCjkText(normalized)) {
    if (normalized.length < 220) issues.push("too_short");
  } else if (countWords(normalized) < 90) {
    issues.push("too_short");
  }

  if (/\[[^\]]{2,}\]|\{\{[^}]+\}\}|<[^>\n]{2,}>/.test(normalized)) issues.push("placeholder");
  if (/\b(?:Your Name|Your Address|Your Email|Your Phone Number|Company Name|Job Title|Hiring Manager Name)\b/i.test(normalized)) {
    issues.push("placeholder");
  }
  if (/specific (?:action|project|achievement|skill area|reason)|measurable or clear outcome|relevant skill area/i.test(normalized)) {
    issues.push("template_language");
  }
  if (paragraphs.length < 3) issues.push("thin_structure");
  if (!hasFinishedEnding(normalized)) issues.push("unfinished_ending");
  // The client treats >520 non-CJK words as a warning, so it must not trigger
  // an internal paid repair attempt.
  return unique(issues);
}

/** Blocking subset of components/tools/EmailActions.tsx. */
export function emailDraftIssues(subject: unknown, body: unknown): string[] {
  const normalizedSubject = normalizeText(subject);
  const normalizedBody = normalizeText(body);
  const combined = `${normalizedSubject}\n\n${normalizedBody}`.trim();
  if (!normalizedSubject && !normalizedBody) return ["empty"];

  const issues: string[] = [];
  if (!normalizedSubject) issues.push("missing_subject");
  if (!normalizedBody) issues.push("missing_body");
  if (hasCjkText(normalizedBody)) {
    if (normalizedBody.length < 80) issues.push("too_short");
  } else if (countWords(normalizedBody) < 45) {
    issues.push("too_short");
  }
  if (/\[[^\]]{2,}\]|\{\{[^}]+\}\}|<[^>\n]{2,}>/.test(combined)) issues.push("placeholder");
  if (/\b(?:Your Name|Recipient Name|Company Name|Job Title|Hiring Manager Name|Interviewer Name|Contact Person)\b/i.test(combined)) {
    issues.push("placeholder");
  }
  if (/specific (?:detail|reason|achievement|next step|action)|measurable or clear outcome|insert (?:detail|context|name)|customize this/i.test(combined)) {
    issues.push("template_language");
  }
  if (normalizedBody && !hasFinishedEmailBody(normalizedBody)) issues.push("unfinished_ending");
  return unique(issues);
}

/** Blocking subset of components/tools/LinkedInActions.tsx. */
export function linkedInOptimizationIssues(result: unknown): string[] {
  const record = asRecord(result);
  if (!record) return ["empty"];

  const headline = normalizeText(record.headline);
  const summary = normalizeText(record.summary);
  const suggestions = records(record.experienceSuggestions);
  const suggestionBodies = suggestions.map((item) => normalizeText(item.suggestion)).filter(Boolean);
  const combined = [
    headline,
    summary,
    ...suggestions.flatMap((item) => [normalizeText(item.title), normalizeText(item.suggestion)]),
  ].join("\n");
  if (!headline && !summary && suggestionBodies.length === 0) return ["empty"];

  const issues: string[] = [];
  if (!headline) issues.push("missing_headline");
  if (!summary) issues.push("missing_summary");
  if (suggestionBodies.length === 0) issues.push("missing_experience_suggestions");
  if (headline && headline.length < 24) issues.push("thin_headline");
  if (summary) {
    if (hasCjkText(summary)) {
      if (summary.length < 140) issues.push("thin_summary");
    } else if (countWords(summary) < 55) {
      issues.push("thin_summary");
    }
    if (!hasFinishedEnding(summary)) issues.push("unfinished_summary");
  }
  if (suggestionBodies.some((suggestion) => (
    hasCjkText(suggestion) ? suggestion.length < 60 : countWords(suggestion) < 18
  ))) {
    issues.push("thin_experience_suggestions");
  }
  if (/\[[^\]]{2,}\]|\{\{[^}]+\}\}|<[^>\n]{2,}>/.test(combined)
    || /\b(?:Your Name|Current Role|Target Role|Company Name|Job Title|Employer Name|specific achievement|relevant skill)\b/i.test(combined)) {
    issues.push("placeholder");
  }
  if (/specific (?:achievement|metric|result|skill|keyword|role)|insert (?:metric|achievement|keyword|role)|measurable result|customize this/i.test(combined)) {
    issues.push("template_language");
  }
  return unique(issues);
}

/** Blocking subset of components/tools/NetworkingActions.tsx. */
export function networkingStrategyIssues(result: unknown): string[] {
  const record = asRecord(result);
  if (!record) return ["empty"];

  const strategy = normalizeText(record.strategySummary);
  const contacts = records(record.contactSuggestions);
  const combined = [
    strategy,
    ...contacts.flatMap((item) => [
      normalizeText(item.contactType),
      normalizeText(item.reason),
      normalizeText(item.outreachMessage),
    ]),
  ].join("\n");
  if (!strategy && contacts.length === 0) return ["empty"];

  const issues: string[] = [];
  if (!strategy) issues.push("missing_strategy");
  if (contacts.length === 0) issues.push("missing_contacts");
  if (strategy) {
    if (hasCjkText(strategy)) {
      if (strategy.length < 100) issues.push("thin_strategy");
    } else if (countWords(strategy) < 35) {
      issues.push("thin_strategy");
    }
    if (!hasFinishedEnding(strategy)) issues.push("unfinished_strategy");
  }

  contacts.forEach((contact) => {
    const contactType = normalizeText(contact.contactType);
    const reason = normalizeText(contact.reason);
    const message = normalizeText(contact.outreachMessage);
    if (!contactType) issues.push("missing_contact_type");
    if (!reason) issues.push("missing_reason");
    if (!message) issues.push("missing_outreach");
    if (reason) {
      if (hasCjkText(reason)) {
        if (reason.length < 35) issues.push("thin_reason");
      } else if (countWords(reason) < 12) {
        issues.push("thin_reason");
      }
    }
    if (message) {
      if (hasCjkText(message)) {
        if (message.length < 70) issues.push("thin_outreach");
      } else if (countWords(message) < 30) {
        issues.push("thin_outreach");
      }
      if (!hasFinishedEnding(message)) issues.push("unfinished_outreach");
    }
  });

  if (/\[[^\]]{2,}\]|\{\{[^}]+\}\}|<[^>\n]{2,}>/.test(combined)
    || /\b(?:Contact Name|Recipient Name|Company Name|Target Company|Target Role|Job Title|Your Name|specific reason|relevant skill)\b/i.test(combined)) {
    issues.push("placeholder");
  }
  if (/specific (?:reason|detail|skill|achievement|question|next step)|insert (?:reason|detail|name|company)|customize this|low-friction ask/i.test(combined)) {
    issues.push("template_language");
  }
  // `few_contacts` and `long_outreach` are client warnings, not blockers.
  return unique(issues);
}

/** Blocking subset of components/tools/SalaryActions.tsx. */
export function salaryNegotiationIssues(result: unknown): string[] {
  const record = asRecord(result);
  if (!record) return ["empty"];

  const marketAnalysis = normalizeText(record.marketAnalysisSummary);
  const rangeValue = record.recommendedRange;
  const range = asRecord(rangeValue);
  const strengths = strings(record.keyStrengths);
  const strategy = strings(record.negotiationStrategy);
  const email = normalizeText(record.counterOfferEmailDraft);
  const objections = records(record.objectionHandlers);
  const objectionTexts = objections
    .flatMap((item) => [normalizeText(item.objection), normalizeText(item.response)])
    .filter(Boolean);
  const combined = [
    marketAnalysis,
    normalizeText(range?.explanation),
    ...strengths,
    ...strategy,
    email,
    ...objectionTexts,
  ].join("\n");
  if (!combined.trim() && !rangeValue) return ["empty"];

  const issues: string[] = [];
  if (!marketAnalysis) issues.push("missing_market_analysis");
  if (!rangeValue) issues.push("missing_range");
  if (rangeValue) {
    const min = Number(range?.baseMin);
    const max = Number(range?.baseMax);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0 || min > max) {
      issues.push("invalid_range");
    }
    if (!normalizeText(range?.currency)) issues.push("missing_currency");
    if (!normalizeText(range?.explanation)) issues.push("missing_range_explanation");
  }
  if (strengths.length === 0) issues.push("missing_strengths");
  if (strategy.length < 2) issues.push("thin_strategy");
  if (!email) issues.push("missing_email");
  if (objections.length === 0) issues.push("missing_objections");

  if (marketAnalysis) {
    if (hasCjkText(marketAnalysis)) {
      if (marketAnalysis.length < 90) issues.push("thin_market_analysis");
    } else if (countWords(marketAnalysis) < 30) {
      issues.push("thin_market_analysis");
    }
    if (!hasFinishedEnding(marketAnalysis)) issues.push("unfinished_market_analysis");
  }
  strategy.forEach((step) => {
    if (hasCjkText(step)) {
      if (step.length < 35) issues.push("thin_strategy_step");
    } else if (countWords(step) < 10) {
      issues.push("thin_strategy_step");
    }
  });
  if (email) {
    if (hasCjkText(email)) {
      if (email.length < 120) issues.push("thin_email");
    } else if (countWords(email) < 55) {
      issues.push("thin_email");
    }
    if (!hasFinishedEmailBody(email)) issues.push("unfinished_email");
  }
  objections.forEach((item) => {
    const objection = normalizeText(item.objection);
    const response = normalizeText(item.response);
    if (!objection || !response) issues.push("incomplete_objection");
    if (response) {
      if (hasCjkText(response)) {
        if (response.length < 45) issues.push("thin_objection_response");
      } else if (countWords(response) < 14) {
        issues.push("thin_objection_response");
      }
    }
  });
  if (/\[[^\]]{2,}\]|\{\{[^}]+\}\}|<[^>\n]{2,}>/.test(combined)
    || /\b(?:Your Name|Hiring Manager Name|Company Name|Job Title|Desired Salary|specific reason|relevant achievement)\b/i.test(combined)) {
    issues.push("placeholder");
  }
  if (/specific (?:reason|achievement|metric|number|range|ask)|insert (?:salary|range|detail|number)|customize this|measurable result/i.test(combined)) {
    issues.push("template_language");
  }
  // `long_email` is a client warning, not a blocker.
  return unique(issues);
}

const FORMATTER_ENGLISH_SECTION_LINE = /^\s*(?:SUMMARY|PROFILE|OBJECTIVE|PERSONAL STATEMENT|EXPERIENCE|WORK EXPERIENCE|PROFESSIONAL EXPERIENCE|EMPLOYMENT HISTORY|PROJECTS|EDUCATION|SKILLS|CERTIFICATIONS|LANGUAGES)\s*$/im;
const FORMATTER_LATIN_WORD = /\b[A-Za-z][A-Za-z'-]{2,}\b/g;
const FORMATTER_UNICODE_WORD = /\p{L}[\p{L}'’-]{1,}/gu;
const FORMATTER_CJK_CHAR = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/g;
const FORMATTER_KANA_CHAR = /[\u3040-\u30ff]/g;
const FORMATTER_TECHNICAL_WORDS = new Set([
  "api", "apis", "ats", "ai", "llm", "mvp", "gpa", "sql", "python", "javascript", "typescript",
  "react", "vue", "node", "jira", "scrum", "agile", "github", "git", "figma", "cloud", "aws",
  "azure", "html", "css", "ux", "ui", "crm", "erp", "saas", "kpi", "okr",
  "linkedin", "career", "copilot", "university", "ottawa", "alberta",
]);
const FORMATTER_ENGLISH_SIGNALS = new Set([
  "and", "with", "for", "from", "that", "this", "the", "into", "across", "between",
  "candidate", "experience", "experienced", "management", "managed", "project", "product",
  "development", "developed", "software", "team", "teams", "user", "users", "research",
  "analysis", "collaboration", "professional", "summary", "education", "skills",
  "responsible", "improved", "supported", "delivered", "created", "built", "led",
]);
const FORMATTER_TARGET_SIGNALS: Record<string, Set<string>> = {
  french: new Set([
    "et", "avec", "pour", "dans", "des", "les", "une", "un", "du", "de", "la", "le",
    "profil", "expérience", "expériences", "compétences", "formation", "projets",
    "professionnelle", "professionnel", "gestion", "gestionnaire", "développement",
    "équipe", "équipes", "ingénieur", "ingénieurs", "données", "analyse", "collaboration",
    "interfonctionnelle", "réalisations", "certifications", "langues",
  ]),
  german: new Set([
    "und", "mit", "für", "der", "die", "das", "den", "dem", "ein", "eine", "einer",
    "im", "in", "von", "zu", "als", "profil", "berufserfahrung", "erfahrung",
    "kenntnisse", "fähigkeiten", "ausbildung", "projekte", "zertifikate",
    "projektmanagement", "entwicklung", "team", "teams", "datenanalyse",
    "zusammenarbeit", "softwareentwicklung",
  ]),
  vietnamese: new Set([
    "và", "với", "cho", "trong", "của", "các", "một", "những", "đã", "từ",
    "kinh", "nghiệm", "kỹ", "năng", "học", "vấn", "dự", "án", "chuyên",
    "nghiệp", "phát", "triển", "quản", "lý", "đội", "nhóm", "dữ", "liệu",
    "phân", "tích", "hợp", "tác", "chứng", "chỉ", "ngôn", "ngữ",
  ]),
};

const FORMATTER_SECTION_LABELS = [
  "summary", "objective", "profile", "personal statement", "professional summary", "career profile",
  "experience", "work experience", "professional experience", "employment history", "career history", "work history",
  "education", "skills", "key skills", "technical skills", "professional skills", "core competencies",
  "projects", "certifications", "licenses", "awards", "honors", "achievements", "publications",
  "volunteer experience", "languages", "interests", "additional information",
  "综合能力概述", "个人概述", "个人简介", "自我评价", "职业概述", "教育背景", "教育经历",
  "工作经历", "工作经验", "职业经历", "实习经历", "项目经历", "项目经验", "专业技能",
  "技术能力", "核心技能", "技能特长", "证书", "资格证书", "荣誉奖项", "获奖经历", "语言能力",
  "職務要約", "職務経歴", "職歴", "学歴", "スキル", "技術スキル", "保有スキル", "資格",
  "語学", "自己PR", "志望動機", "プロジェクト経験", "profil", "profil professionnel",
  "expérience", "expérience professionnelle", "formation", "compétences", "projets", "langues",
  "berufserfahrung", "ausbildung", "studium", "kenntnisse", "fähigkeiten", "zertifikate", "sprachen", "projekte",
];
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const FORMATTER_SECTION_LINE = new RegExp(
  `^[\\s•·\\-–—]*(${FORMATTER_SECTION_LABELS.map(escapeRegex).join("|")})[\\s:：]*$`,
  "i"
);

const formatterLanguageMismatch = (cleaned: string, expectedLanguage?: string): boolean => {
  const language = (expectedLanguage ?? "").toLowerCase();
  if (!language || language === "english" || language.includes("same language")) return false;
  if (FORMATTER_ENGLISH_SECTION_LINE.test(cleaned)) return true;

  const sanitized = cleaned
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[\w.+-]+@[\w.-]+\.\w+/g, " ")
    .replace(/[+\d][+\d\s().-]{6,}/g, " ");
  const latinMatches: string[] = sanitized.match(FORMATTER_LATIN_WORD) ?? [];
  const latinSignalWords = latinMatches
    .filter((word) => !FORMATTER_TECHNICAL_WORDS.has(word.toLowerCase()))
    .length;
  const cjkChars = (cleaned.match(FORMATTER_CJK_CHAR) ?? []).length;

  if (language.includes("chinese")) {
    return cjkChars < 80 || latinSignalWords > Math.max(18, cjkChars * 0.18);
  }
  if (language.includes("japanese")) {
    const kanaChars = (cleaned.match(FORMATTER_KANA_CHAR) ?? []).length;
    return cjkChars < 80 || kanaChars < 8 || latinSignalWords > Math.max(22, cjkChars * 0.22);
  }

  const targetKey = language.includes("french")
    ? "french"
    : language.includes("german")
      ? "german"
      : language.includes("vietnamese")
        ? "vietnamese"
        : "";
  if (!targetKey) return false;

  const words = (cleaned.match(FORMATTER_UNICODE_WORD) ?? [])
    .map((word) => word.toLowerCase())
    .filter((word) => !FORMATTER_TECHNICAL_WORDS.has(word));
  const englishHits = words.reduce((count, word) => count + (FORMATTER_ENGLISH_SIGNALS.has(word) ? 1 : 0), 0);
  const targetHits = words.reduce((count, word) => count + (FORMATTER_TARGET_SIGNALS[targetKey].has(word) ? 1 : 0), 0);
  return (
    (words.length >= 45 && targetHits < 5 && englishHits >= 8)
    || (englishHits >= 14 && targetHits > 0 && englishHits >= targetHits * 2.5)
  );
};

/** Blocking subset of lib/resumePreview.ts#assessFormattedResume. */
export function formattedResumeIssues(text: string | undefined | null, expectedLanguage?: string): string[] {
  const cleaned = String(text ?? "")
    .replace(/\r/g, "\n")
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .trim();
  if (!cleaned) return ["empty"];

  const issues: string[] = [];
  if (/写真|証明写真|顔写真|\[\s*(?:photo|写真|画像|image)\s*\]/i.test(cleaned)) issues.push("photo_placeholder");

  let consecutivePipeRows = 0;
  for (const line of cleaned.split("\n")) {
    if ((line.match(/[|｜]/g) || []).length >= 2) {
      consecutivePipeRows += 1;
      if (consecutivePipeRows >= 2) { issues.push("pipe_table"); break; }
    } else {
      consecutivePipeRows = 0;
    }
  }

  const lines = cleaned.split("\n");
  const firstSectionIndex = lines.findIndex((line) => FORMATTER_SECTION_LINE.test(line.trim()) && line.trim().length < 50);
  if (firstSectionIndex < 0 && cleaned.length > 400) {
    issues.push("no_sections");
  } else if (firstSectionIndex > 0) {
    const header = lines.slice(0, firstSectionIndex).join("\n").trim();
    if (header.length > 900) issues.push("overlong_header");

    const compactHeader = header.replace(/\s+/g, " ");
    const firstContact = compactHeader.search(/[\w.+-]+@[\w.-]+\.\w+|https?:\/\/|(?:Phone|Mobile|Tel|Email|E-mail|Location|Address|Website|Portfolio|LinkedIn|GitHub|电话|手机|邮箱|所在地|住所|メール|電話)\s*[:：]/i);
    const labelledName = compactHeader.match(/^(?:Name|Full Name|姓名|氏名|名前)\s*[:：]\s*(.*?)(?=(?:Phone|Mobile|Tel|Email|E-mail|Location|Address|Website|Portfolio|LinkedIn|GitHub|电话|手机|邮箱|所在地|住所|メール|電話)\s*[:：]|$)/i)?.[1];
    const name = (labelledName ?? (firstContact > 0 ? compactHeader.slice(0, firstContact) : "")).trim();
    if (name.length > 90 || /[\w.+-]+@[\w.-]+\.\w+|https?:\/\//i.test(name)) issues.push("garbled_header");
  }

  if (formatterLanguageMismatch(cleaned, expectedLanguage)) issues.push("language_mismatch");
  return unique(issues);
}

/**
 * Corrective addendum for the retry attempt. Appended to the ORIGINAL prompt
 * so all original context and rules still apply.
 */
export function correctiveInstruction(issues: string[]): string {
  // Issues may be prefixed with the failing field ("summary:unfinished_ending").
  const slugs = issues.map((issue) => issue.slice(issue.lastIndexOf(":") + 1));
  const has = (slug: string) => slugs.includes(slug);
  const hasPrefix = (prefix: string) => slugs.some((slug) => slug.startsWith(prefix));
  const fields = [...new Set(issues.filter((i) => i.includes(":")).map((i) => i.split(":")[0]))];
  const fixes: string[] = [];
  if (fields.length > 0) fixes.push(`the failing parts were: ${fields.join(", ")}`);
  if (has("empty")) fixes.push("your previous attempt produced no usable text");
  if (has("too_short")) fixes.push("the draft was far too short to be usable");
  if (has("placeholder")) {
    fixes.push('placeholders or template instructions were left in (e.g. "[Company Name]", "{{...}}", "specific achievement") — replace every one with real content drawn from the provided context, or a natural neutral phrasing when a detail is unknown');
  }
  if (has("template_language")) {
    fixes.push("template-writing instructions leaked into the result — replace them with specific, ready-to-use content grounded in the supplied context");
  }
  if (has("unfinished_ending")) {
    fixes.push("the draft was cut off mid-sentence — the final version must end with a complete closing sentence; if length is a concern, shorten the body rather than truncating the end");
  }
  if (hasPrefix("missing_")) {
    const missing = slugs
      .filter((slug) => slug.startsWith("missing_"))
      .map((slug) => slug.slice("missing_".length).replace(/_/g, " "));
    fixes.push(`required content was missing: ${[...new Set(missing)].join(", ")} — return every required field with substantive content`);
  }
  if (has("thin_structure")) {
    fixes.push("the cover letter had fewer than three paragraphs — return a clear opening, evidence body, and closing as separate paragraphs");
  }
  if (hasPrefix("thin_") && !has("thin_structure")) {
    fixes.push("one or more required sections were too thin — expand every short section with specific, usable detail while preserving the response schema");
  }
  if (slugs.some((slug) => slug.startsWith("unfinished_"))) {
    fixes.push("one or more sections ended mid-thought — complete every sentence and every required section");
  }
  if (has("invalid_range")) {
    fixes.push("the recommended salary range was invalid — provide positive numeric minimum and maximum values with minimum no greater than maximum");
  }
  if (has("pii_remaining")) {
    fixes.push("personal identifiers from the source remain in the result — remove names, email addresses, phone numbers, profile URLs, and other direct identifiers before returning it");
  }
  if (has("incomplete_objection")) {
    fixes.push("an objection handler was incomplete — every item needs both a realistic objection and a substantive response");
  }
  if (has("photo_placeholder")) {
    fixes.push("a photo/image placeholder was left in — remove it entirely (plain-text resumes cannot carry images)");
  }
  if (has("pipe_table")) {
    fixes.push("markdown pipe tables were used — rewrite tabular content as plain lines or simple bullets; never emit | tables");
  }
  if (has("language_mismatch")) {
    fixes.push("part or all of the document was NOT written in the requested output language — rewrite the ENTIRE document, including every section header, in the requested language (keep proper nouns and technical terms as-is)");
  }
  if (has("no_sections") || has("overlong_header") || has("garbled_header")) {
    fixes.push("the resume structure was not parseable — use short standalone section headings, keep the contact header compact, and place body content under its correct section");
  }
  if (fixes.length === 0) fixes.push(`the result failed these required checks: ${slugs.join(", ")}`);
  return (
    "QUALITY REVIEW — your previous draft FAILED final review: " +
    fixes.join("; ") +
    ". Regenerate the COMPLETE, final, ready-to-use version now. " +
    "Every requirement above still applies. Return the full draft, not a diff or an apology."
  );
}
