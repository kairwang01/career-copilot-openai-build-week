import { describe, expect, it } from 'vitest';
import { assessFormattedResume, cleanResumeDisplay, getResumeMarketStyle, parseResumeHeader, parseResumeSections, splitResumePreviewParagraphs } from '../lib/resumePreview';

describe('ResumePreview parsing', () => {
  it('recovers CJK section breaks from a one-line extracted resume', () => {
    const raw = '王凯 电话：13022547015 • 个人网站：https://kairwang.cloud • Email: jackson@example.com 渥太华，加拿大综合能力概述项目管理候选人，具备跨团队协作经验。教育背景渥太华大学 09/2025 - 06/2027 项目经历Career CoPilot • 统筹 6 人工程团队 • 推进生产版本';
    const cleaned = cleanResumeDisplay(raw);
    const sections = parseResumeSections(cleaned);

    expect(sections.map((section) => section.title)).toContain('综合能力概述');
    expect(sections.map((section) => section.title)).toContain('教育背景');
    expect(sections.map((section) => section.title)).toContain('项目经历');
  });

  it('keeps ordinary free-text resumes renderable', () => {
    const sections = parseResumeSections(cleanResumeDisplay('Jane Doe\nEmail: jane@example.com\nExperience\nBuilt hiring workflows.'));
    expect(sections.map((section) => section.title)).toEqual(['Header', 'Experience']);
  });

  it('normalizes markdown section labels before parsing', () => {
    const sections = parseResumeSections(cleanResumeDisplay('Jane Doe\n**SUMMARY**\nBuilt hiring workflows.\n## Skills\nResearch, Jira, SQL'));
    expect(sections.map((section) => section.title)).toEqual(['Header', 'SUMMARY', 'Skills']);
  });

  it('maps resume preview style by target market', () => {
    expect(getResumeMarketStyle('Canada').region).toBe('north-america');
    expect(getResumeMarketStyle('Germany').pageSize).toBe('a4');
    expect(getResumeMarketStyle('Japan').region).toBe('japan');
    expect(getResumeMarketStyle('Singapore').region).toBe('apac');
    expect(getResumeMarketStyle('Australia').region).toBe('apac');
    expect(getResumeMarketStyle('Vietnam').region).toBe('vietnam');
  });

  it('exposes i18n keys (not literals) for label and principles', () => {
    const vn = getResumeMarketStyle('Vietnam');
    expect(vn.labelKey).toBe('resume_market_label_vietnam');
    expect(vn.principleKeys).toEqual([
      'resume_market_principle_vietnam_1',
      'resume_market_principle_vietnam_2',
      'resume_market_principle_vietnam_3',
    ]);
    // Vietnam 不再共用 APAC 的 work-rights 原则
    expect(vn.principleKeys).not.toContain('resume_market_principle_apac_3');
  });

  it('passes a clean sectioned resume (and does not mistake a pipe-separated skills line for a table)', () => {
    const clean = 'Jane Doe\nEmail: jane@example.com\nSUMMARY\nProduct manager with 6 years of experience.\nEXPERIENCE\nLed a team of 5 engineers.\nSKILLS\nReact | Node | SQL';
    expect(assessFormattedResume(clean).status).toBe('ok');
  });

  it('flags an unstructured blob as needs_regen', () => {
    const blob = 'Alex is a software engineer who has worked at several companies building web applications, leading teams, shipping products to production, mentoring engineers, improving processes, and collaborating across functions for many years. '.repeat(3);
    expect(assessFormattedResume(blob).status).toBe('needs_regen');
  });

  it('flags a surviving photo placeholder as needs_regen', () => {
    const withPhoto = 'Jane Doe\nEmail: jane@example.com\nSUMMARY\nProduct manager.\nEXPERIENCE\nLed teams.\n[Photo]';
    const result = assessFormattedResume(withPhoto);
    expect(result.status).toBe('needs_regen');
    expect(result.issues).toContain('photo_placeholder');
  });

  it('flags a header where contact fields are still mixed into the rendered name', () => {
    const garbled = 'Name: Kai Wang Phone 130-225-7015 Email kai@example.com\nSUMMARY\nProduct manager.\nEXPERIENCE\nLed teams.';
    const result = assessFormattedResume(garbled);
    expect(result.status).toBe('needs_regen');
    expect(result.issues).toContain('garbled_header');
  });

  it('warns (non-blocking) on fabricated-looking sensitive fields', () => {
    const withDob = 'Jane Doe\nEmail: jane@example.com\nSUMMARY\nProduct manager.\nEXPERIENCE\nLed teams.\nDate of Birth: 1990-01-01';
    expect(assessFormattedResume(withDob).status).toBe('warn');
  });

  it('repairs Japanese inline resume output before preview parsing', () => {
    const raw = '氏名：王铂凯（おうはくがい） 電話番号：130-2254-7015 メールアドレス：jackson@example.com 所在地：カナダ、オタワ ウェブサイト：https://kairwang.cloud 写真：[ここに証明写真を貼付] ■ 志望動機 プロジェクトマネジメント候補者として貢献したいです。 ■ 学歴 | 年月 | 学校名 | 専攻 | 成績 | 2025年09月〜2027年06月（予定） | オタワ大学 | 電気・コンピュータ工学 | GPA 4.0/4.0';
    const cleaned = cleanResumeDisplay(raw);
    const sections = parseResumeSections(cleaned);

    expect(cleaned).not.toContain('写真');
    expect(cleaned).not.toContain('ここに証明写真');
    expect(cleaned.split('\n')).not.toContain('•');
    expect(cleaned).toContain('\n電話番号: 130-2254-7015');
    expect(sections.map((section) => section.title)).toContain('志望動機');
    expect(sections.map((section) => section.title)).toContain('学歴');
  });

  it('splits long Japanese preview paragraphs without requiring spaces after punctuation', () => {
    const longParagraph = 'プロジェクトマネジメント候補者として、技術チームの進行管理と品質改善に貢献したいです。顧客フィードバックを整理し、要件変換とリスク識別を行いました。'.repeat(4);
    const paragraphs = splitResumePreviewParagraphs(longParagraph);

    expect(paragraphs.length).toBeGreaterThan(1);
    expect(paragraphs.every((paragraph) => paragraph.length <= 260)).toBe(true);
  });

  it('keeps Japanese inline contact fields out of the rendered name', () => {
    const header = parseResumeHeader('氏名: 王鉑凯（おうはくがい） 電話番号: 130-2254-7015 メールアドレス: jacksonkai0408@gmail.com 所在地: カナダ、オタワ ウェブサイト: https://kairwang.cloud 写真: [ここに証明写真を貼付]');

    expect(header.name).toBe('王鉑凯（おうはくがい）');
    expect(header.contacts).toContain('130-2254-7015');
    expect(header.contacts).toContain('jacksonkai0408@gmail.com');
    expect(header.contacts).toContain('カナダ、オタワ');
    expect(header.contacts).toContain('https://kairwang.cloud');
    expect(header.summary).toBe('');
  });

  it('repairs French formatter output when PROFILE is glued to the contact line', () => {
    const raw = '王铂凯\n13022547015 · jacksonkai0408@gmail.com · https://kairwang.cloud · Ottawa, Canada PROFIL Gestionnaire de projet / produit avec double compétence en informatique et génie électrique. Expérience en développement logiciel, recherche utilisateur et collaboration interfonctionnelle.\nFORMATION\nUniversité d’Ottawa — M.Eng., génie électrique et informatique\nEXPÉRIENCE\nCareer CoPilot — Responsable produit\n- A dirigé une équipe de 6 ingénieurs.';
    const cleaned = cleanResumeDisplay(raw);
    const sections = parseResumeSections(cleaned);
    const header = parseResumeHeader(sections.find((section) => section.title === 'Header')?.content ?? '');
    const result = assessFormattedResume(raw);

    expect(cleaned).toContain('\nPROFIL\n');
    expect(header.name).toBe('王铂凯');
    expect(sections.map((section) => section.title.toLowerCase())).toContain('profil');
    expect(result.status).not.toBe('needs_regen');
  });

  it('recovers Japanese inline header fields with ASCII colons before parsing sections', () => {
    const raw = '氏名: Kai Wang 電話番号: 130-2254-7015 メールアドレス: jackson@example.com 所在地: カナダ、オタワ ウェブサイト: https://kairwang.cloud 志望動機 プロジェクトマネジメント候補者として貢献したいです。 学歴 2025年09月〜2027年06月 オタワ大学';
    const cleaned = cleanResumeDisplay(raw);
    const sections = parseResumeSections(cleaned);

    expect(cleaned).toContain('\n電話番号: 130-2254-7015');
    expect(cleaned).toContain('\nメールアドレス: jackson@example.com');
    expect(sections.find((section) => section.title === 'Header')?.content).toContain('氏名: Kai Wang');
    expect(sections.map((section) => section.title)).toContain('志望動機');
    expect(sections.map((section) => section.title)).toContain('学歴');
  });

  it('strips an inline fullwidth-bracket photo placeholder', () => {
    const raw = '王凱 ウェブサイト：https://example.com 写真: ［ここに証明写真を貼付］ 志望動機 貢献したいです。';
    const cleaned = cleanResumeDisplay(raw);
    expect(cleaned).not.toContain('写真');
    expect(cleaned).not.toContain('証明写真');
  });

  it.each([
    {
      market: 'Canada',
      text: 'Kai Wang\nOttawa, ON | +1 302 254 7015 | kai@example.com | https://kairwang.cloud\nSUMMARY\nProduct operations candidate with engineering training and cross-functional delivery experience.\nEDUCATION\nUniversity of Ottawa — Ottawa, ON\nM.Eng., Electrical and Computer Engineering | GPA 4.0/4.0\nEXPERIENCE\nCareer CoPilot — Product Operations Lead\n• Coordinated a 6-person engineering team and standardized sprint delivery.',
    },
    {
      market: 'Germany',
      text: 'Kai Wang\nBerlin, Germany | kai@example.com | https://kairwang.cloud\nProfil\nProjektmanagement-Kandidat mit Erfahrung in Softwareentwicklung, Datenanalyse und funktionsübergreifender Zusammenarbeit.\nBerufserfahrung\nCareer CoPilot — Product Operations Lead\n• Koordinierte ein sechsköpfiges Engineering-Team und verbesserte Sprint-Prozesse.\nAusbildung\nUniversity of Ottawa — M.Eng. Electrical and Computer Engineering.',
    },
    {
      market: 'Singapore',
      text: 'Kai Wang\nSingapore | kai@example.com | https://kairwang.cloud\nSUMMARY\nProject management candidate with software engineering internship experience and strong stakeholder coordination.\nEXPERIENCE\nCareer CoPilot — Product Operations Lead\n• Improved delivery workflow across resume analysis, interview practice, and career planning modules.\nSKILLS\nProduct operations, Jira, SQL, Python',
    },
    {
      market: 'Japan',
      text: '氏名: Kai Wang\n電話番号: 130-2254-7015\nメールアドレス: kai@example.com\n所在地: カナダ、オタワ\n志望動機\nプロジェクトマネジメント候補者として、技術チームの進行管理と品質改善に貢献したいです。\n学歴\nオタワ大学 電気・コンピュータ工学\n職務経歴\nCareer CoPilot プロダクト運用リード',
    },
    {
      market: 'Vietnam',
      text: 'Kai Wang\nHo Chi Minh City | kai@example.com | https://kairwang.cloud\nProfil professionnel\nCandidate with engineering training, product operations experience, and bilingual stakeholder communication.\nExpérience professionnelle\nCareer CoPilot — Product Operations Lead\n• Led workflow improvements across AI career tools.\nCompétences\nProduct operations, data analysis, Jira, Python',
    },
  ])('keeps a $market regional formatted resume inside the quality gate', ({ market, text }) => {
    const style = getResumeMarketStyle(market);
    const result = assessFormattedResume(text);
    const sections = parseResumeSections(cleanResumeDisplay(text));
    const header = parseResumeHeader(sections.find((section) => section.title === 'Header')?.content ?? '');

    expect(result.status).not.toBe('needs_regen');
    expect(style.pageSize).toBe(market === 'Canada' ? 'letter' : 'a4');
    expect(header.name.length).toBeGreaterThan(0);
    expect(sections.filter((section) => section.title !== 'Header').length).toBeGreaterThanOrEqual(2);
  });

  it('blocks a Chinese-target resume that still reads mostly in English', () => {
    const text = '王铂凯\n13022547015 | jackson@example.com | https://kairwang.cloud\nSUMMARY\nProject management candidate with a background in computer science and electrical engineering. Experienced in agile development, user research, data analysis, and cross-functional collaboration.\nEDUCATION\nUniversity of Ottawa — M.Eng. Electrical and Computer Engineering.\nPROJECTS\nCareer CoPilot — Led product workflow improvements across AI career tools.';

    const result = assessFormattedResume(text, { outputLanguage: 'Simplified Chinese' });

    expect(result.status).toBe('needs_regen');
    expect(result.issues).toContain('language_mismatch');
  });

  it('allows Chinese resumes with standard technical proper nouns', () => {
    const text = '王铂凯\n渥太华，加拿大\n13022547015\njackson@example.com\nhttps://kairwang.cloud\n\n综合能力概述\n项目管理候选人，具备计算机科学与电气工程背景，熟悉 Agile、Jira、Python 和 SQL，在跨团队协作与数据分析中有实践经验。\n\n教育背景\n渥太华大学 (University of Ottawa)\n电气与计算机工程硕士\n\n项目经历\nCareer CoPilot\n- 协调产品、前端和数据工作，推动简历分析、模拟面试和职业规划模块迭代。';

    const result = assessFormattedResume(text, { outputLanguage: 'Simplified Chinese' });

    expect(result.status).not.toBe('needs_regen');
    expect(result.issues).not.toContain('language_mismatch');
  });

  it('blocks a French-target resume that keeps English prose', () => {
    const text = 'Kai Wang\nOttawa, Canada\nkai@example.com\n\nPROFIL\nProject management candidate with a background in computer science and electrical engineering. Experienced in software development, user research, data analysis, and cross-functional team collaboration.\n\nFORMATION\nUniversity of Ottawa — M.Eng. Electrical and Computer Engineering.\n\nEXPÉRIENCE\nCareer CoPilot — Product Operations Lead\n- Led a 6-person engineering team and improved delivery workflow across AI career tools.';

    const result = assessFormattedResume(text, { outputLanguage: 'French' });

    expect(result.status).toBe('needs_regen');
    expect(result.issues).toContain('language_mismatch');
  });

  it('allows French resumes with technical proper nouns', () => {
    const text = 'Kai Wang\nOttawa, Canada\nkai@example.com\n\nPROFIL\nCandidat en gestion de projet avec une double compétence en informatique et en génie électrique. Expérience en développement logiciel, recherche utilisateur, analyse de données et collaboration interfonctionnelle.\n\nFORMATION\nUniversité d’Ottawa (University of Ottawa) — M.Eng. en génie électrique et informatique.\n\nEXPÉRIENCE\nCareer CoPilot — Responsable produit\n- A coordonné une équipe de 6 ingénieurs et amélioré les processus de livraison avec Jira, Python et SQL.';

    const result = assessFormattedResume(text, { outputLanguage: 'French' });

    expect(result.status).not.toBe('needs_regen');
    expect(result.issues).not.toContain('language_mismatch');
  });
});
