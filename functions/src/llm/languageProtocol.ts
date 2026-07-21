/**
 * Shared multilingual instructions for every AI tool.
 *
 * Three realities these blocks encode:
 *   1. The USER reads the product in their UI language (outputLanguage) —
 *      coaching, feedback, and explanations must be written in it.
 *   2. The DOCUMENTS (resume, job description, chat history) may be in any
 *      language, including a different one per document — the model must read
 *      them natively and never let a language mismatch degrade the analysis.
 *   3. The TARGET MARKET has its own hiring language — ATS keywords and
 *      resume-facing rewrite text must live in that language even when the
 *      commentary around them does not (a Chinese-speaking candidate applying
 *      in Canada needs English keywords with Chinese coaching).
 *
 * Handlers pass the result into prompt templates as
 * {{outputLanguageInstruction}} / {{languageInstruction}}; aiProxy appends the
 * analysis block to tools that have no dedicated language plumbing. Keeping
 * the text in ONE place means every persona (candidate and employer) gets the
 * same, consistent cross-language behaviour.
 */

/** Human-readable language name from a UI code ("zh", "fr-CA", …). */
export function languageNameFromCode(value?: string): string | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.startsWith("zh")) return "Simplified Chinese";
  if (normalized.startsWith("fr")) return "French";
  if (normalized.startsWith("de")) return "German";
  if (normalized.startsWith("ja")) return "Japanese";
  if (normalized.startsWith("vi")) return "Vietnamese";
  if (normalized.startsWith("ar")) return "Arabic";
  if (normalized.startsWith("es")) return "Spanish";
  if (normalized.startsWith("ko")) return "Korean";
  if (normalized.startsWith("pt")) return "Portuguese";
  if (normalized.startsWith("hi")) return "Hindi";
  if (normalized.startsWith("en")) return "English";
  return null;
}

/** Rules for reading source documents that apply to every variant. */
const READ_ANY_LANGUAGE =
  "The resume, job description, and any other source documents may be written in ANY language " +
  "(including a different language per document, or mixed languages such as Chinese with English " +
  "technical terms). Read them natively and analyze them at full quality — never refuse, never ask " +
  "for a translation, and never let the document's language lower your scoring, matching, or depth " +
  "of feedback.";

const QUOTING_AND_NOUNS =
  "When you quote an exact line from a document written in a different language than your output, " +
  "keep the original wording and add a translation in the output language in parentheses. Keep " +
  "personal names, employer/school names, product names, certifications, URLs, and technical terms " +
  "(programming languages, frameworks, standards) in their original form; transliterate or gloss " +
  "them only when the reader could not otherwise understand.";

/**
 * For candidate-facing STRUCTURED tools (resume analysis, career path,
 * compatibility, rewrites…): commentary in the output language, resume-facing
 * artifacts in the market's hiring language.
 */
export function candidateAnalysisLanguageProtocol(opts: {
  outputLanguage?: string;
  marketName?: string;
}): string {
  const outName = languageNameFromCode(opts.outputLanguage);
  const market = opts.marketName?.trim();
  const outputRule = outName
    ? `Write every user-visible prose field (summaries, explanations, strengths, improvement suggestions, tips, reasons) in ${outName}.`
    : "Write every user-visible prose field in the dominant language of the user's input (fall back to the resume's language).";
  const marketRule = market
    ? `ATS keywords, suggested resume wording, and any text meant to be pasted INTO the resume or application must be in the primary hiring language of the ${market} job market — that is what recruiters and ATS screens there match on — even when your commentary around them is in another language. If the resume's language does not match that hiring language, call it out explicitly as a top improvement (recommend a translated/localized resume) instead of silently ignoring it.`
    : "Keywords and any text meant to be pasted into the resume must be in the hiring language of the candidate's target market when it is known; otherwise match the resume's language.";
  return [
    "LANGUAGE PROTOCOL:",
    `- ${outputRule}`,
    `- ${READ_ANY_LANGUAGE}`,
    `- ${marketRule}`,
    `- ${QUOTING_AND_NOUNS}`,
  ].join("\n");
}

/**
 * For employer-facing STRUCTURED tools (candidate match, talent extraction,
 * JD tooling, outreach): the recruiter reads in outputLanguage, candidates
 * must be treated fairly whatever language their documents are in.
 */
export function employerAnalysisLanguageProtocol(opts: {
  outputLanguage?: string;
}): string {
  const outName = languageNameFromCode(opts.outputLanguage);
  const outputRule = outName
    ? `Write every user-visible prose field in ${outName}.`
    : "Write every user-visible prose field in the language of the employer's input (the job description or request).";
  return [
    "LANGUAGE PROTOCOL:",
    `- ${outputRule}`,
    `- ${READ_ANY_LANGUAGE}`,
    "- Judge candidates on evidence, not on the language their documents are written in. Only treat language itself as a factor when the role explicitly requires proficiency in a specific language — and then assess it from concrete evidence (stated proficiency, education, or work conducted in that language), never from the resume's language alone.",
    `- ${QUOTING_AND_NOUNS}`,
  ].join("\n");
}

/**
 * For LIVE CHAT (career coach): mirror the user, switch when they switch.
 * `outputLanguage` is only a hint for the first turn / ambiguous input.
 */
export function chatLanguageProtocol(opts: { outputLanguage?: string }): string {
  const outName = languageNameFromCode(opts.outputLanguage);
  const hint = outName
    ? ` If the user's language is ambiguous (e.g. a one-word first message), default to ${outName} — the language their app is set to.`
    : "";
  return [
    "LANGUAGE:",
    `- Always reply in the language of the user's most recent message, and switch immediately when they switch.${hint}`,
    `- ${READ_ANY_LANGUAGE} A user may chat in one language about a resume or job description written in another — that is normal; coach seamlessly across both.`,
    `- ${QUOTING_AND_NOUNS}`,
    "- Suggested resume lines, cover-letter snippets, or outreach copy must be written in the language of the document/market they are destined for (state which, when it differs from the chat language).",
  ].join("\n");
}

/**
 * For the cover-letter writer: the letter's language is the user's explicit
 * choice (the product keeps per-language versions and nudges on mismatch), but
 * source documents may be in any language and keyword mirroring must survive
 * translation.
 */
export function coverLetterLanguageProtocol(opts: {
  outputLanguage?: string;
  marketName?: string;
}): string {
  const outName = languageNameFromCode(opts.outputLanguage);
  const market = opts.marketName?.trim() ?? "target";
  const letterRule = outName
    ? `Write the cover letter entirely in ${outName}, regardless of the ${market} market's default business language (the user maintains per-language versions deliberately).`
    : `Honour the language, spelling conventions, and formality norms of the ${market} job market; if that market's primary business language is not English, write the letter in that language.`;
  return [
    letterRule,
    READ_ANY_LANGUAGE,
    "When the letter's language differs from the job description's, still mirror the JD's key requirements and vocabulary — translated naturally into the letter's language — while keeping exact technical terms, product names, and certifications in their original form so screening still matches them.",
    QUOTING_AND_NOUNS,
  ].join("\n");
}

/**
 * Interview realism for the mock-interview tools: questions belong to the
 * language the interview would actually be conducted in; coaching belongs to
 * the user.
 */
export function interviewLanguageProtocol(opts: {
  outputLanguage?: string;
}): string {
  const outName = languageNameFromCode(opts.outputLanguage);
  const coachingLang = outName
    ? `Write all coaching text (tips, feedback, strengths, improvements, summaries) in ${outName}.`
    : "Write all coaching text in the dominant language of the candidate's input.";
  return [
    "LANGUAGE PROTOCOL:",
    `- ${coachingLang}`,
    "- Ask the interview QUESTIONS (and write model answers) in the language the interview would realistically be conducted in: the job description's language. A candidate practicing for a job abroad must rehearse in that job's language — do not translate the interview itself into their UI language.",
    "- Evaluate answers in whatever language the candidate answered. Judge content, structure, and evidence — do not penalize grammar or accent artifacts of answering in a non-native language unless communication clarity is genuinely a requirement of the role, and say so explicitly when it is.",
    `- ${QUOTING_AND_NOUNS}`,
  ].join("\n");
}
