import React from 'react';
import { cleanResumeDisplay, getResumeMarketStyle, parseResumeHeader, parseResumeSections, splitResumePreviewParagraphs } from '../lib/resumePreview';
import type { ResumeMarketStyle } from '../lib/resumePreview';

interface ResumePreviewProps {
  resumeText: string;
  market: string;
  t: (key: string) => string;
  heightClassName?: string;
}

const splitBullets = (line: string): string[] => {
    const trimmed = line.trim();
    const withoutMarker = trimmed.replace(/^[•*\-–—]\s*/, '').trim();
    if (trimmed.includes('•')) {
        return trimmed
            .split(/\s*•\s*/)
            .map((item) => item.trim())
            .filter((item) => item.length > 0);
    }
    if (/^[•*\-–—]\s+/.test(trimmed)) return [withoutMarker];
    return [];
};

const renderResumeBody = (content: string, style: ResumeMarketStyle) => {
    const blocks: React.ReactNode[] = [];
    let bullets: string[] = [];
    const flushBullets = () => {
        if (!bullets.length) return;
        blocks.push(
            <ul key={`list-${blocks.length}`} className={style.bulletListClassName}>
                {bullets.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
            </ul>,
        );
        bullets = [];
    };

    splitResumePreviewParagraphs(content).forEach((paragraph, index) => {
        const bulletItems = splitBullets(paragraph);
        if (bulletItems.length) {
            bullets.push(...bulletItems);
            return;
        }

        flushBullets();
        const isLeadLine = index === 0 && paragraph.length <= 120 && /(?:\d{4}|GPA|大学|University|College|Engineer|Manager|Developer|Intern|负责人|实习|项目)/i.test(paragraph);
        blocks.push(
            <p
                key={`p-${index}`}
                className={`${isLeadLine ? style.leadLineClassName : style.bodyClassName} mb-1 text-[12.5px] leading-[1.55]`}
            >
                {paragraph}
            </p>,
        );
    });

    flushBullets();
    return blocks;
};

const sectionTitle = (title: string): string => title === 'Resume Content' ? 'Resume' : title;

const ResumePreview: React.FC<ResumePreviewProps> = ({ resumeText, market, t, heightClassName = 'h-[420px] sm:h-[520px]' }) => {
  const style = getResumeMarketStyle(market);
  const cleaned = cleanResumeDisplay(resumeText);
  const sections = parseResumeSections(cleaned);
  const header = parseResumeHeader(sections.find((s) => s.title === 'Header')?.content ?? '');
  const contentSections = sections.filter((section) => section.title !== 'Header');

  return (
    <div
      className={`${heightClassName} overflow-y-auto rounded-xl border border-slate-200 bg-slate-100 p-3 shadow-inner dark:border-slate-700 dark:bg-slate-950`}
      data-qa="resume-preview-shell"
      data-qa-resume-region={style.region}
      data-qa-resume-page-size={style.pageSize}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
        <span data-qa="resume-preview-style-label">{t(style.labelKey)}</span>
        <span data-qa="resume-preview-style-meta">{style.pageSize.toUpperCase()} · {style.density}</span>
      </div>
      <div
        className={`mx-auto min-h-full w-full ${style.documentWidthClass} ${style.documentClassName} px-7 py-7 sm:px-10 sm:py-9`}
        role="document"
        data-qa="resume-preview-document"
        aria-label={header.name ? `${header.name} resume preview` : t('resume_preview_placeholder')}
      >
        {resumeText.trim() ? (
          <div className="font-sans text-slate-800 dark:text-slate-100">
            {(header.name || header.contacts.length > 0 || header.summary) && (
              <header className={style.headerClassName}>
                {header.name && (
                  <div className={style.nameClassName}>
                    {header.name}
                  </div>
                )}
                {header.contacts.length > 0 && (
                  <div className={style.contactsClassName}>
                    {header.contacts.map((item, index) => (
                      <React.Fragment key={item}>
                        {index > 0 && <span aria-hidden="true">|</span>}
                        <span>{item}</span>
                      </React.Fragment>
                    ))}
                  </div>
                )}
                {header.summary && (
                  <p className={style.summaryClassName}>
                    {header.summary}
                  </p>
                )}
              </header>
            )}

            {contentSections.map((section, index) => (
              <section
                key={`${section.title}-${index}`}
                className={style.sectionClassName}
                data-qa="resume-preview-section"
                data-qa-section-title={sectionTitle(section.title)}
              >
                <div className={style.sectionHeadingClassName} data-qa="resume-preview-section-title">
                  {sectionTitle(section.title)}
                </div>
                <div className="space-y-1">
                  {renderResumeBody(section.content, style)}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-center text-gray-400 dark:text-gray-500 font-sans">
            <p>{t('resume_preview_placeholder')}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ResumePreview;
