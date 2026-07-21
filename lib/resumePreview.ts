export type ResumeSection = { title: string; content: string };

export type ParsedResumeHeader = { name: string; contacts: string[]; summary: string };

export type ResumeMarketRegion = 'north-america' | 'europe' | 'apac' | 'japan' | 'vietnam';

export type ResumeMarketStyle = {
  region: ResumeMarketRegion;
  labelKey: string;
  pageSize: 'letter' | 'a4';
  density: 'compact' | 'balanced' | 'cv';
  documentWidthClass: string;
  documentClassName: string;
  headerClassName: string;
  nameClassName: string;
  contactsClassName: string;
  summaryClassName: string;
  sectionClassName: string;
  sectionHeadingClassName: string;
  leadLineClassName: string;
  bodyClassName: string;
  bulletListClassName: string;
  principleKeys: string[];
};

const BASE_STYLE = {
  documentClassName: 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200 dark:bg-slate-950 dark:text-slate-50 dark:ring-slate-700',
  leadLineClassName: 'font-semibold text-slate-950 dark:text-white',
  bodyClassName: 'text-slate-700 dark:text-slate-300',
};

const RESUME_MARKET_STYLES: Record<ResumeMarketRegion, ResumeMarketStyle> = {
  'north-america': {
    region: 'north-america',
    labelKey: 'resume_market_label_north_america',
    pageSize: 'letter',
    density: 'compact',
    documentWidthClass: 'max-w-[816px]',
    documentClassName: BASE_STYLE.documentClassName,
    headerClassName: 'mb-4 border-b border-slate-900 pb-3 text-left dark:border-slate-600',
    nameClassName: 'text-[24px] font-semibold leading-tight tracking-normal text-slate-950 dark:text-white',
    contactsClassName: 'mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11.5px] leading-5 text-slate-600 dark:text-slate-300',
    summaryClassName: 'mt-2 max-w-none text-[12.5px] leading-[1.55] text-slate-700 dark:text-slate-300',
    sectionClassName: 'mb-3.5 break-inside-avoid',
    sectionHeadingClassName: 'mb-1.5 border-b border-slate-300 pb-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-950 dark:border-slate-700 dark:text-slate-100',
    leadLineClassName: BASE_STYLE.leadLineClassName,
    bodyClassName: BASE_STYLE.bodyClassName,
    bulletListClassName: 'my-1.5 list-disc space-y-0.5 pl-4 text-[12.5px] leading-[1.45] text-slate-700 dark:text-slate-300',
    principleKeys: ['resume_market_principle_north_america_1', 'resume_market_principle_north_america_2', 'resume_market_principle_north_america_3'],
  },
  europe: {
    region: 'europe',
    labelKey: 'resume_market_label_europe',
    pageSize: 'a4',
    density: 'cv',
    documentWidthClass: 'max-w-[794px]',
    documentClassName: BASE_STYLE.documentClassName,
    headerClassName: 'mb-5 border-b-2 border-slate-800 pb-4 text-left dark:border-slate-500',
    nameClassName: 'text-[23px] font-semibold leading-tight tracking-normal text-slate-950 dark:text-white',
    contactsClassName: 'mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11.5px] leading-5 text-slate-600 dark:text-slate-300',
    summaryClassName: 'mt-3 max-w-none text-[12.5px] leading-[1.6] text-slate-700 dark:text-slate-300',
    sectionClassName: 'mb-4 break-inside-avoid',
    sectionHeadingClassName: 'mb-1.5 border-b border-slate-300 pb-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-950 dark:border-slate-700 dark:text-slate-100',
    leadLineClassName: BASE_STYLE.leadLineClassName,
    bodyClassName: BASE_STYLE.bodyClassName,
    bulletListClassName: 'my-2 list-disc space-y-0.5 pl-4 text-[12.5px] leading-[1.5] text-slate-700 dark:text-slate-300',
    principleKeys: ['resume_market_principle_europe_1', 'resume_market_principle_europe_2', 'resume_market_principle_europe_3'],
  },
  apac: {
    region: 'apac',
    labelKey: 'resume_market_label_apac',
    pageSize: 'a4',
    density: 'balanced',
    documentWidthClass: 'max-w-[794px]',
    documentClassName: BASE_STYLE.documentClassName,
    headerClassName: 'mb-4 border-b border-slate-300 pb-3 text-left dark:border-slate-700',
    nameClassName: 'text-[23px] font-semibold leading-tight tracking-normal text-slate-950 dark:text-white',
    contactsClassName: 'mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11.5px] leading-5 text-slate-600 dark:text-slate-300',
    summaryClassName: 'mt-2.5 max-w-none text-[12.5px] leading-[1.55] text-slate-700 dark:text-slate-300',
    sectionClassName: 'mb-3.5 break-inside-avoid',
    sectionHeadingClassName: 'mb-1.5 border-b border-slate-300 pb-0.5 text-[11px] font-bold uppercase tracking-[0.13em] text-slate-950 dark:border-slate-700 dark:text-slate-100',
    leadLineClassName: BASE_STYLE.leadLineClassName,
    bodyClassName: BASE_STYLE.bodyClassName,
    bulletListClassName: 'my-1.5 list-disc space-y-0.5 pl-4 text-[12.5px] leading-[1.48] text-slate-700 dark:text-slate-300',
    principleKeys: ['resume_market_principle_apac_1', 'resume_market_principle_apac_2', 'resume_market_principle_apac_3'],
  },
  japan: {
    region: 'japan',
    labelKey: 'resume_market_label_japan',
    pageSize: 'a4',
    density: 'cv',
    documentWidthClass: 'max-w-[794px]',
    documentClassName: BASE_STYLE.documentClassName,
    headerClassName: 'mb-5 border-b border-slate-900 pb-4 text-left dark:border-slate-600',
    nameClassName: 'text-[22px] font-semibold leading-tight tracking-normal text-slate-950 dark:text-white',
    contactsClassName: 'mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11.5px] leading-5 text-slate-600 dark:text-slate-300',
    summaryClassName: 'mt-3 max-w-none text-[12.5px] leading-[1.65] text-slate-700 dark:text-slate-300',
    sectionClassName: 'mb-4 break-inside-avoid',
    sectionHeadingClassName: 'mb-1.5 border-b border-slate-400 pb-1 text-[11px] font-bold tracking-[0.08em] text-slate-950 dark:border-slate-700 dark:text-slate-100',
    leadLineClassName: BASE_STYLE.leadLineClassName,
    bodyClassName: BASE_STYLE.bodyClassName,
    bulletListClassName: 'my-2 list-disc space-y-0.5 pl-4 text-[12.5px] leading-[1.6] text-slate-700 dark:text-slate-300',
    principleKeys: ['resume_market_principle_japan_1', 'resume_market_principle_japan_2', 'resume_market_principle_japan_3'],
  },
  vietnam: {
    region: 'vietnam',
    labelKey: 'resume_market_label_vietnam',
    pageSize: 'a4',
    density: 'balanced',
    documentWidthClass: 'max-w-[794px]',
    documentClassName: BASE_STYLE.documentClassName,
    headerClassName: 'mb-4 border-b border-slate-300 pb-3 text-left dark:border-slate-700',
    nameClassName: 'text-[23px] font-semibold leading-tight tracking-normal text-slate-950 dark:text-white',
    contactsClassName: 'mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11.5px] leading-5 text-slate-600 dark:text-slate-300',
    summaryClassName: 'mt-2.5 max-w-none text-[12.5px] leading-[1.55] text-slate-700 dark:text-slate-300',
    sectionClassName: 'mb-3.5 break-inside-avoid',
    sectionHeadingClassName: 'mb-1.5 border-b border-slate-300 pb-0.5 text-[11px] font-bold uppercase tracking-[0.13em] text-slate-950 dark:border-slate-700 dark:text-slate-100',
    leadLineClassName: BASE_STYLE.leadLineClassName,
    bodyClassName: BASE_STYLE.bodyClassName,
    bulletListClassName: 'my-1.5 list-disc space-y-0.5 pl-4 text-[12.5px] leading-[1.48] text-slate-700 dark:text-slate-300',
    principleKeys: ['resume_market_principle_vietnam_1', 'resume_market_principle_vietnam_2', 'resume_market_principle_vietnam_3'],
  },
};

export const getResumeMarketStyle = (market: string): ResumeMarketStyle => {
  const normalized = market.toLowerCase();
  if (/(canada|united states|usa|u\.s\.|north america)/.test(normalized)) return RESUME_MARKET_STYLES['north-america'];
  if (/(germany|france|united kingdom|\buk\b|europe|netherlands|spain|italy|ireland|switzerland)/.test(normalized)) return RESUME_MARKET_STYLES.europe;
  if (/(vietnam|viet nam|việt nam)/.test(normalized)) return RESUME_MARKET_STYLES.vietnam;
  if (/(japan|日本)/.test(normalized)) return RESUME_MARKET_STYLES.japan;
  return RESUME_MARKET_STYLES.apac;
};

const CJK_SECTION_LABELS = [
  '综合能力概述', '个人概述', '个人简介', '自我评价', '职业概述',
  '教育背景', '教育经历',
  '工作经历', '工作经验', '职业经历', '实习经历',
  '项目经历', '项目经验',
  '专业技能', '技术能力', '核心技能', '技能特长',
  '证书', '资格证书', '荣誉奖项', '获奖经历', '语言能力',
  '職務要約', '職務経歴', '職歴', '学歴', 'スキル', '技術スキル', '保有スキル',
  '資格', '語学', '自己PR', '志望動機', 'プロジェクト経験',
  'Profil', 'Expérience professionnelle', 'Formation', 'Compétences', 'Certifications', 'Langues',
  'Profil professionnel', 'Expérience', 'Projets',
  'Berufserfahrung', 'Ausbildung', 'Studium', 'Kenntnisse', 'Fähigkeiten',
  'Zertifikate', 'Sprachen', 'Profil', 'Projekte',
];

const INLINE_FIELD_LABELS = [
  '氏名', '名前', '電話番号', '電話', 'メールアドレス', 'メール', '所在地', '住所',
  'ウェブサイト', 'Webサイト', '写真',
  'Name', 'Full Name', 'Phone', 'Mobile', 'Tel', 'Email', 'E-mail', 'Location', 'Address',
  'Website', 'Portfolio', 'LinkedIn', 'GitHub',
  '姓名', '电话', '手机', '邮箱', '个人网站', '网站',
];

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const CONTACT_REGEX = /(?:电话|手机|Phone|Mobile|Tel|電話番号|電話)\s*[:：]?\s*[+\d][+\d\s().-]{6,}|(?:Email|邮箱|E-mail|メールアドレス|メール)\s*[:：]?\s*[\w.+-]+@[\w.-]+\.\w+|(?:个人网站|网站|Website|Portfolio|LinkedIn|GitHub|ウェブサイト|Webサイト)\s*[:：]?\s*(?:https?:\/\/)?[^\s•|，,]+/gi;
const CONTACT_LABEL_REGEX = /^(?:电话|手机|Phone|Mobile|Tel|電話番号|電話|Email|邮箱|E-mail|メールアドレス|メール|个人网站|网站|Website|Portfolio|LinkedIn|GitHub|ウェブサイト|Webサイト)\s*[:：]?\s*/i;
const NAME_LABEL_REGEX = /^(?:氏名|名前|Name|Full Name|姓名)\s*[:：]\s*/i;
const LOCATION_LABEL_REGEX = /^(?:所在地|住所|Location|Address)\s*[:：]?\s*/i;
const PHOTO_PLACEHOLDER_REGEX = /^(?:写真|Photo|顔写真)\s*[:：]?\s*(?:\[.*?\]|［.*?］|（.*?）|\(.*?\)|ここに.*?(?:貼付|貼る)|証明写真.*?)/i;

const CONTACT_FIELD_LABELS = [
  '电话', '手机', 'Phone', 'Mobile', 'Tel', '電話番号', '電話',
  'Email', '邮箱', 'E-mail', 'メールアドレス', 'メール',
  '个人网站', '网站', 'Website', 'Portfolio', 'LinkedIn', 'GitHub', 'ウェブサイト', 'Webサイト',
];
const LOCATION_FIELD_LABELS = ['所在地', '住所', 'Location', 'Address'];
const PHOTO_FIELD_LABELS = ['写真', 'Photo', '顔写真'];
const HEADER_STOP_FIELD_LABELS = [...CONTACT_FIELD_LABELS, ...LOCATION_FIELD_LABELS, ...PHOTO_FIELD_LABELS]
  .sort((a, b) => b.length - a.length);
const HEADER_STOP_FIELD_REGEX = new RegExp(`(?:${HEADER_STOP_FIELD_LABELS.map(escapeRegex).join('|')})\\s*[:：]`, 'i');
const HEADER_FIELD_IN_NAME_REGEX = new RegExp(
  `(?:${[
    ...CONTACT_FIELD_LABELS.filter((label) => !['Mobile', 'Portfolio'].includes(label)),
    ...LOCATION_FIELD_LABELS,
    ...PHOTO_FIELD_LABELS,
  ].map(escapeRegex).join('|')})\\s*(?:[:：]|[+\\d\\w@])`,
  'i',
);
const LOCATION_VALUE_REGEX = new RegExp(
  `(?:${LOCATION_FIELD_LABELS.map(escapeRegex).join('|')})\\s*[:：]?\\s*(.*?)(?=(?:${HEADER_STOP_FIELD_LABELS.map(escapeRegex).join('|')})\\s*[:：]|$)`,
  'gi',
);

const EN_SECTION_KEYWORDS = [
  'summary', 'objective', 'profile',
  'personal statement', 'professional summary', 'career profile',
  'experience', 'work experience', 'professional experience', 'employment history',
  'career history', 'work history',
  'education',
  'skills', 'key skills', 'technical skills', 'professional skills', 'core competencies',
  'projects',
  'certifications', 'licenses',
  'awards', 'honors', 'achievements',
  'publications', 'volunteer experience',
  'languages', 'interests', 'additional information',
];

const INLINE_SECTION_LABELS = [
  ...EN_SECTION_KEYWORDS,
  ...CJK_SECTION_LABELS,
  'profil', 'profil professionnel', 'expérience', 'expérience professionnelle',
  'formation', 'compétences', 'projets', 'certifications', 'langues',
  'berufserfahrung', 'ausbildung', 'studium', 'kenntnisse', 'fähigkeiten',
  'zertifikate', 'sprachen', 'projekte',
].sort((a, b) => b.length - a.length);

const INLINE_SECTION_REGEX = new RegExp(
  `([^\\n])\\s+(${INLINE_SECTION_LABELS.map(escapeRegex).join('|')})\\s*(?=[:：\\n]|[A-ZÀ-ÖØ-Þ\\u3040-\\u30ff\\u3400-\\u9fff])`,
  'gi',
);

// PDF text extraction often inserts a space between every CJK glyph and leaves
// runs of stray whitespace. Collapse those for the on-screen PREVIEW only (the
// stored resume_text is untouched) so a Chinese/Japanese resume reads cleanly.
const CJKISH = '\\u3000-\\u303f\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef';
const CJK_SENTENCE_REGEX = new RegExp(`[${CJKISH}]`);
const MAX_PREVIEW_PARAGRAPH_CHARS = 220;

const splitLongPreviewLine = (line: string): string[] => {
  if (line.length <= MAX_PREVIEW_PARAGRAPH_CHARS) return [line];

  const cjkLine = CJK_SENTENCE_REGEX.test(line);
  const parts = cjkLine
    ? (line.match(/[^。！？；]+[。！？；]?/g) ?? [line])
    : line.split(/(?<=[.!?])\s+/);

  return parts.reduce<string[]>((acc, part) => {
    const sentence = part.trim();
    if (!sentence) return acc;

    const last = acc[acc.length - 1] ?? '';
    const joiner = cjkLine ? '' : ' ';
    const candidate = last ? `${last}${joiner}${sentence}` : sentence;
    if (!last || candidate.length > MAX_PREVIEW_PARAGRAPH_CHARS) {
      acc.push(sentence);
    } else {
      acc[acc.length - 1] = candidate;
    }
    return acc;
  }, []);
};

export const splitResumePreviewParagraphs = (content: string): string[] =>
  content
    .split(/\n+/)
    .map((line) => line.trim())
    .flatMap(splitLongPreviewLine)
    .map((line) => line.trim())
    .filter(Boolean);

const cleanHeaderValue = (value: string): string =>
  value
    .replace(/\s+/g, ' ')
    .replace(/^[•|｜，,\s]+|[•|｜，,\s]+$/g, '')
    .trim();

const repairInlineSectionBreaks = (value: string): string => (
  value
    .split('\n')
    .map((line, index) => {
      // The recurrent formatter failure is a dense header line where contact
      // info is followed immediately by PROFILE/SUMMARY/etc. Limit this repair
      // to the resume header area so body prose is never reflowed accidentally.
      if (index > 5 && !hasContactField(line)) return line;
      return line.replace(INLINE_SECTION_REGEX, (_match, before: string, label: string) => {
        const compactLabel = cleanHeaderValue(label);
        return `${before}\n${compactLabel}\n`;
      });
    })
    .join('\n')
);

const cutAtNextHeaderField = (value: string): string => {
  const match = HEADER_STOP_FIELD_REGEX.exec(value);
  return cleanHeaderValue(match && match.index > 0 ? value.slice(0, match.index) : value);
};

const hasContactField = (value: string): boolean => {
  CONTACT_REGEX.lastIndex = 0;
  const result = CONTACT_REGEX.test(value);
  CONTACT_REGEX.lastIndex = 0;
  return result;
};

const hasHeaderFieldInsideName = (value: string): boolean => {
  if (!value) return false;
  return HEADER_FIELD_IN_NAME_REGEX.test(value) || /[\w.+-]+@[\w.-]+\.\w+/.test(value) || /https?:\/\//i.test(value);
};

export const parseResumeHeader = (content: string): ParsedResumeHeader => {
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
  const compact = content.replace(/\s+/g, ' ').trim();
  if (!compact) return { name: '', contacts: [], summary: '' };

  const contactSet = new Set<string>();
  const consumedLines = new Set<number>();

  lines.forEach((line, index) => {
    if (PHOTO_PLACEHOLDER_REGEX.test(line)) {
      consumedLines.add(index);
      return;
    }

    CONTACT_REGEX.lastIndex = 0;
    const matches = Array.from(line.matchAll(CONTACT_REGEX));
    if (matches.length) {
      matches
        .map((match) => cleanHeaderValue(match[0].replace(CONTACT_LABEL_REGEX, '')))
        .filter(Boolean)
        .forEach((match) => contactSet.add(match));
      consumedLines.add(index);
    }

    LOCATION_VALUE_REGEX.lastIndex = 0;
    const locationMatches = Array.from(line.matchAll(LOCATION_VALUE_REGEX));
    if (locationMatches.length) {
      locationMatches
        .map((match) => cleanHeaderValue(match[1] ?? ''))
        .filter(Boolean)
        .forEach((location) => contactSet.add(location));
      consumedLines.add(index);
    }
  });

  let name = '';
  const labelledNameIndex = lines.findIndex((line) => NAME_LABEL_REGEX.test(line));
  if (labelledNameIndex >= 0) {
    name = cutAtNextHeaderField(lines[labelledNameIndex].replace(NAME_LABEL_REGEX, ''));
    consumedLines.add(labelledNameIndex);
  }

  CONTACT_REGEX.lastIndex = 0;
  const contactMatches = Array.from(compact.matchAll(CONTACT_REGEX));
  const firstContactIndex = contactMatches[0]?.index ?? -1;
  const firstLine = lines.find((line, index) => !consumedLines.has(index)) ?? '';

  if (!name && firstContactIndex > 0) {
    name = cutAtNextHeaderField(compact.slice(0, firstContactIndex).replace(NAME_LABEL_REGEX, ''));
  } else if (!name && firstLine.length <= 42) {
    CONTACT_REGEX.lastIndex = 0;
    if (!CONTACT_REGEX.test(firstLine) && !LOCATION_LABEL_REGEX.test(firstLine) && !PHOTO_PLACEHOLDER_REGEX.test(firstLine)) {
      name = cutAtNextHeaderField(firstLine.replace(NAME_LABEL_REGEX, ''));
      const firstLineIndex = lines.indexOf(firstLine);
      if (firstLineIndex >= 0) consumedLines.add(firstLineIndex);
    }
  }
  CONTACT_REGEX.lastIndex = 0;

  contactMatches
    .map((match) => cleanHeaderValue(match[0].replace(CONTACT_LABEL_REGEX, '')))
    .filter(Boolean)
    .forEach((contact) => contactSet.add(contact));

  LOCATION_VALUE_REGEX.lastIndex = 0;
  Array.from(compact.matchAll(LOCATION_VALUE_REGEX))
    .map((match) => cleanHeaderValue(match[1] ?? ''))
    .filter(Boolean)
    .forEach((location) => contactSet.add(location));
  LOCATION_VALUE_REGEX.lastIndex = 0;

  const contacts = Array.from(contactSet);
  const summary = lines
    .filter((line, index) => !consumedLines.has(index) && !PHOTO_PLACEHOLDER_REGEX.test(line) && !hasContactField(line) && !LOCATION_LABEL_REGEX.test(line))
    .join(' ')
    .replace(/^[•|，,\s]+|[•|，,\s]+$/g, '')
    .replace(/\s*•\s*/g, ' • ')
    .trim();

  return { name, contacts, summary };
};

export const cleanResumeDisplay = (text: string): string => {
  let cleaned = text
    .replace(/\r/g, '\n')
    .replace(/^#{1,3}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/(?:^|\n)\s*(?:写真|Photo|顔写真)\s*[:：]?\s*(?:[[［（(〔].*?[\]］）)〕]|ここに.*?(?:貼付|貼る)|証明写真.*?)/gi, '\n')
    .replace(/[|｜]{2,}/g, '\n')
    .replace(/\s*[|｜]\s*-{2,}\s*[|｜]?\s*/g, '\n')
    // Drop spaces sitting between two CJK / full-width characters (run twice
    // to catch the fully space-separated "字 字 字" case).
    .replace(new RegExp(`([${CJKISH}])[ \\t]+(?=[${CJKISH}])`, 'g'), '$1')
    .replace(new RegExp(`([${CJKISH}])[ \\t]+(?=[${CJKISH}])`, 'g'), '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[●▪◦■◆◇]/g, '•');

  cleaned = repairInlineSectionBreaks(cleaned);

  const fieldLabelsByLength = [...INLINE_FIELD_LABELS].sort((a, b) => b.length - a.length);
  for (const label of fieldLabelsByLength) {
    cleaned = cleaned.replace(
      new RegExp(`\\s+(${escapeRegex(label)})\\s*[:：]`, 'gi'),
      '\n$1: ',
    );
  }

  for (const label of fieldLabelsByLength) {
    cleaned = cleaned.replace(
      new RegExp(`([^\\n])(${escapeRegex(label)})\\s*[:：]`, 'gi'),
      '$1\n$2: ',
    );
  }

  cleaned = cleaned.replace(/(?:^|\n)\s*(?:写真|Photo|顔写真)\s*[:：]?\s*(?:[[［（(〔].*?[\]］）)〕]|ここに.*?(?:貼付|貼る)|証明写真.*?)/gi, '\n');

  // OCR/PDF extraction often removes section line breaks, producing strings
  // like "教育背景渥太华大学..." Insert preview-only line breaks so the parser
  // can recover a resume structure without mutating the stored resume text.
  for (const label of CJK_SECTION_LABELS) {
    cleaned = cleaned.replace(
      new RegExp(`[\\s•·\\-–—]*(${escapeRegex(label)})(?:\\s*[:：])?\\s*`, 'gi'),
      '\n$1\n',
    );
  }

  cleaned = cleaned
    .split('\n')
    .flatMap((line) => {
      const pipeParts = line.split(/\s*[|｜]\s*/).map((part) => part.trim()).filter(Boolean);
      return pipeParts.length >= 4 ? pipeParts : [line];
    })
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed === '•') return false;
      return !/^(年月|学校名|専攻|成績|期間|組織名|内容|Year|Date|School|Major|Grade)$/i.test(trimmed);
    })
    .join('\n');

  return cleaned
    .replace(/:\s{2,}/g, ': ')
    .replace(/\s+•\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

// A heuristic-based parser to identify sections in a plain-text resume.
export const parseResumeSections = (text: string): ResumeSection[] => {
  if (!text || !text.trim()) return [];

  const lines = text.split('\n');
  const sections: ResumeSection[] = [];
  let currentSection: { title: string; content: string[] } = { title: 'Header', content: [] };

  const headerRegex = new RegExp(`^\\s*[^a-zA-Z0-9]*(${EN_SECTION_KEYWORDS.map(escapeRegex).join('|')})[^a-zA-Z0-9]*\\s*$`, 'i');
  const cjkHeaderRegex = new RegExp(`^[\\s•·\\-—]*(${CJK_SECTION_LABELS.map(escapeRegex).join('|')})[\\s:：]*$`, 'i');

  let contentStarted = false;

  for (const line of lines) {
    const trimmedLine = line.trim();
    const isLikelyHeader = (headerRegex.test(trimmedLine) || cjkHeaderRegex.test(trimmedLine)) && trimmedLine.length < 50;

    if (isLikelyHeader) {
      contentStarted = true;
      if (currentSection.content.join('').trim()) {
        sections.push({ ...currentSection, content: currentSection.content.join('\n').trim() });
      }
      currentSection = { title: trimmedLine.replace(/^[\s•·\-–—]+/, '').replace(/[:：]/g, '').trim(), content: [] };
    } else {
      if (!contentStarted && trimmedLine) {
        currentSection.title = 'Header';
      }
      currentSection.content.push(line);
    }
  }

  if (currentSection.content.join('').trim()) {
    sections.push({ ...currentSection, content: currentSection.content.join('\n').trim() });
  }

  if (sections.length === 0 && text.trim()) {
    return [{ title: 'Resume Content', content: text }];
  }

  return sections;
};

export type ResumeValidationStatus = 'ok' | 'warn' | 'needs_regen';

export interface ResumeValidation {
  status: ResumeValidationStatus;
  issues: string[];
}

export interface ResumeValidationOptions {
  outputLanguage?: string | null;
}

const ENGLISH_SECTION_LINE_REGEX = /^\s*(?:SUMMARY|PROFILE|OBJECTIVE|PERSONAL STATEMENT|EXPERIENCE|WORK EXPERIENCE|PROFESSIONAL EXPERIENCE|EMPLOYMENT HISTORY|PROJECTS|EDUCATION|SKILLS|CERTIFICATIONS|LANGUAGES)\s*$/im;
const LATIN_WORD_REGEX = /\b[A-Za-z][A-Za-z'-]{2,}\b/g;
const UNICODE_WORD_REGEX = /\p{L}[\p{L}'’-]{1,}/gu;
const CJK_CHAR_REGEX = new RegExp(`[${CJKISH}]`, 'g');
const KANA_CHAR_REGEX = /[\u3040-\u30ff]/g;
const TECHNICAL_LATIN_ALLOWLIST = new Set([
  'api', 'apis', 'ats', 'ai', 'llm', 'mvp', 'gpa', 'sql', 'python', 'javascript', 'typescript',
  'react', 'vue', 'node', 'jira', 'scrum', 'agile', 'github', 'git', 'figma', 'cloud', 'aws',
  'azure', 'html', 'css', 'ux', 'ui', 'crm', 'erp', 'saas', 'kpi', 'okr',
  'linkedin', 'career', 'copilot', 'university', 'ottawa', 'alberta',
]);

const ENGLISH_PROSE_SIGNALS = new Set([
  'and', 'with', 'for', 'from', 'that', 'this', 'the', 'into', 'across', 'between',
  'candidate', 'experience', 'experienced', 'management', 'managed', 'project', 'product',
  'development', 'developed', 'software', 'team', 'teams', 'user', 'users', 'research',
  'analysis', 'collaboration', 'professional', 'summary', 'education', 'skills',
  'responsible', 'improved', 'supported', 'delivered', 'created', 'built', 'led',
]);

const TARGET_LANGUAGE_SIGNALS: Record<string, Set<string>> = {
  french: new Set([
    'et', 'avec', 'pour', 'dans', 'des', 'les', 'une', 'un', 'du', 'de', 'la', 'le',
    'profil', 'expérience', 'expériences', 'compétences', 'formation', 'projets',
    'professionnelle', 'professionnel', 'gestion', 'gestionnaire', 'développement',
    'équipe', 'équipes', 'ingénieur', 'ingénieurs', 'données', 'analyse', 'collaboration',
    'interfonctionnelle', 'réalisations', 'certifications', 'langues',
  ]),
  german: new Set([
    'und', 'mit', 'für', 'der', 'die', 'das', 'den', 'dem', 'ein', 'eine', 'einer',
    'im', 'in', 'von', 'zu', 'als', 'profil', 'berufserfahrung', 'erfahrung',
    'kenntnisse', 'fähigkeiten', 'ausbildung', 'projekte', 'zertifikate',
    'projektmanagement', 'entwicklung', 'team', 'teams', 'datenanalyse',
    'zusammenarbeit', 'softwareentwicklung',
  ]),
  vietnamese: new Set([
    'và', 'với', 'cho', 'trong', 'của', 'các', 'một', 'những', 'đã', 'từ',
    'kinh', 'nghiệm', 'kỹ', 'năng', 'học', 'vấn', 'dự', 'án', 'chuyên',
    'nghiệp', 'phát', 'triển', 'quản', 'lý', 'đội', 'nhóm', 'dữ', 'liệu',
    'phân', 'tích', 'hợp', 'tác', 'chứng', 'chỉ', 'ngôn', 'ngữ',
  ]),
};

const extractLanguageWords = (text: string): string[] => (
  (text.match(UNICODE_WORD_REGEX) ?? [])
    .map((word) => word.toLowerCase())
    .filter((word) => !TECHNICAL_LATIN_ALLOWLIST.has(word))
);

const countSetHits = (words: string[], set: Set<string>): number => (
  words.reduce((count, word) => count + (set.has(word) ? 1 : 0), 0)
);

const countLanguageSignalWords = (text: string): number => {
  const sanitized = text
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[\w.+-]+@[\w.-]+\.\w+/g, ' ')
    .replace(/[+\d][+\d\s().-]{6,}/g, ' ');
  const words: string[] = sanitized.match(LATIN_WORD_REGEX) ?? [];
  return words
    .filter((word) => !TECHNICAL_LATIN_ALLOWLIST.has(word.toLowerCase()))
    .length;
};

const hasTargetLanguageMismatch = (cleaned: string, outputLanguage?: string | null): boolean => {
  const language = (outputLanguage ?? '').toLowerCase();
  if (!language || language === 'english' || language.includes('same language')) return false;

  if (ENGLISH_SECTION_LINE_REGEX.test(cleaned)) return true;

  const latinSignalWords = countLanguageSignalWords(cleaned);
  const cjkChars = (cleaned.match(CJK_CHAR_REGEX) ?? []).length;

  if (language.includes('chinese')) {
    return cjkChars < 80 || latinSignalWords > Math.max(18, cjkChars * 0.18);
  }

  if (language.includes('japanese')) {
    const kanaChars = (cleaned.match(KANA_CHAR_REGEX) ?? []).length;
    return cjkChars < 80 || kanaChars < 8 || latinSignalWords > Math.max(22, cjkChars * 0.22);
  }

  const targetKey = language.includes('french')
    ? 'french'
    : language.includes('german')
      ? 'german'
      : language.includes('vietnamese')
        ? 'vietnamese'
        : '';

  if (targetKey) {
    const words = extractLanguageWords(cleaned);
    const englishHits = countSetHits(words, ENGLISH_PROSE_SIGNALS);
    const targetHits = countSetHits(words, TARGET_LANGUAGE_SIGNALS[targetKey]);
    const meaningfulWords = words.length;

    // High-confidence failure: a long Latin-script draft with almost no target
    // language signal but many English prose/function words. Proper nouns and
    // technical terms are removed above, so this targets model failures like a
    // France/Germany/Vietnam resume that kept English paragraphs.
    return (
      (meaningfulWords >= 45 && targetHits < 5 && englishHits >= 8)
      || (englishHits >= 14 && targetHits > 0 && englishHits >= targetHits * 2.5)
    );
  }

  return false;
};

// Post-generation gate for the resume formatter. The prompt is a *request* not to emit
// tables / photo placeholders / fabricated personal fields; this is the *enforcement*.
// Run on the (already display-cleaned) output: if it is still a garbled blob — no
// parseable sections, a surviving photo placeholder, or a multi-row pipe table — return
// `needs_regen` so the UI offers a clean re-run instead of presenting broken output as
// final. Source-plausible personal fields downgrade to a non-blocking `warn`.
export const assessFormattedResume = (text: string, options: ResumeValidationOptions = {}): ResumeValidation => {
  const cleaned = cleanResumeDisplay(text || '');
  if (!cleaned.trim()) return { status: 'needs_regen', issues: ['empty'] };

  const issues: string[] = [];
  const lines = cleaned.split('\n');

  // Photo / image placeholder survived cleaning.
  if (/写真|証明写真|顔写真|\[\s*(?:photo|写真|画像|image)\s*\]/i.test(cleaned)) issues.push('photo_placeholder');

  // A real (multi-row) pipe table survived. A single "React | Node | SQL" skills line
  // is NOT a table (one row), and cleaning already splits ≥4-cell rows — so require
  // 2+ consecutive rows that each carry ≥2 separators.
  let consec = 0;
  for (const line of lines) {
    if ((line.match(/[|｜]/g) || []).length >= 2) { consec += 1; if (consec >= 2) { issues.push('pipe_table'); break; } }
    else consec = 0;
  }

  // Structure: did it parse into real sections, or is it one undifferentiated blob?
  const sections = parseResumeSections(cleaned);
  const contentSections = sections.filter((s) => s.title !== 'Header' && s.title !== 'Resume Content');
  const topBlock = sections.find((s) => s.title === 'Header' || s.title === 'Resume Content');
  if (contentSections.length === 0 && cleaned.trim().length > 400) issues.push('no_sections');
  else if ((topBlock?.content?.length ?? 0) > 900) issues.push('overlong_header');

  const parsedHeader = parseResumeHeader(topBlock?.content ?? '');
  if (parsedHeader.name.length > 90 || hasHeaderFieldInsideName(parsedHeader.name)) {
    issues.push('garbled_header');
  }

  if (hasTargetLanguageMismatch(cleaned, options.outputLanguage)) {
    issues.push('language_mismatch');
  }

  // Protected / sensitive fields the formatter must not fabricate (soft — the source
  // resume may legitimately carry them, so warn rather than block).
  if (/(生年月日|date of birth|\bd\.?o\.?b\.?\b|国籍|nationality|婚姻|marital status|性別\s*[:：]|gender\s*[:：]|ビザ|visa status)/i.test(cleaned)) {
    issues.push('sensitive_fields');
  }

  const blocking = issues.filter((i) => i !== 'sensitive_fields');
  if (blocking.length > 0) return { status: 'needs_regen', issues };
  if (issues.length > 0) return { status: 'warn', issues };
  return { status: 'ok', issues: [] };
};
