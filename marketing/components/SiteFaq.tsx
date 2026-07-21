import React, { useState } from 'react';

const FAQ_KEYS = ['faq_1', 'faq_2', 'faq_3', 'faq_4', 'faq_5'] as const;

interface SiteFaqProps {
  t: (key: string) => string;
}

// Some answers embed an inline numbered list like "...you get: (1) a score,
// (2) mock interviews, and (3) a roadmap." Rendered as one run-on paragraph
// that reads as a wall of text. When we detect two or more "(n)" markers we
// split the answer into an intro line + real bullet items; otherwise the
// answer is shown verbatim as a single paragraph.
const parseAnswer = (answer: string): { intro: string; items: string[] } => {
  const markers = answer.match(/\(\d+\)/g);
  if (!markers || markers.length < 2) {
    return { intro: answer, items: [] };
  }

  const firstMarker = answer.indexOf('(1)');
  if (firstMarker === -1) {
    return { intro: answer, items: [] };
  }

  let intro = answer.slice(0, firstMarker).trim();
  const rest = answer.slice(firstMarker);

  const items = rest
    .split(/\s*\(\d+\)\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => segment.replace(/^and\s+/i, '').replace(/^[,;]\s*/, '').trim())
    .map((segment) => segment.replace(/[,;]\s*$/, '').trim())
    .filter(Boolean);

  // Drop a dangling "and" left hanging at the end of the intro lead-in.
  intro = intro.replace(/[,;]?\s+and$/i, '').trim();

  if (items.length < 2) {
    return { intro: answer, items: [] };
  }

  return { intro, items };
};

export const SiteFaq: React.FC<SiteFaqProps> = ({ t }) => {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq-section" className="py-12 sm:py-[var(--site-section)] bg-[var(--site-surface-muted)]">
      <div className="max-w-2xl mx-auto px-4 sm:px-6">
        <h2 className="text-xl sm:text-2xl font-semibold mb-2">{t('faq_title')}</h2>
        <p className="text-[var(--site-text-muted)] mb-6">{t('faq_subtitle')}</p>
        <div className="space-y-2">
          {FAQ_KEYS.map((key, index) => {
            const isOpen = openIndex === index;
            const { intro, items } = parseAnswer(t(`${key}_a`));
            return (
              <div
                key={key}
                className="border border-[var(--site-border)] rounded-[var(--site-radius)] bg-[var(--site-surface)]"
              >
                <button
                  type="button"
                  onClick={() => setOpenIndex(isOpen ? null : index)}
                  className="w-full flex justify-between items-start gap-4 text-left p-4 sm:p-5 focus:outline-none focus:ring-2 focus:ring-[var(--site-action)]/40 rounded-[var(--site-radius)]"
                  aria-expanded={isOpen}
                >
                  <span className="font-medium text-[var(--site-text)]">{t(`${key}_q`)}</span>
                  <span className="text-[var(--site-text-muted)] shrink-0" aria-hidden="true">
                    {isOpen ? '−' : '+'}
                  </span>
                </button>
                {isOpen && (
                  <div className="px-4 sm:px-5 pb-4 sm:pb-5 text-sm text-[var(--site-text-muted)] leading-relaxed">
                    {intro && <p>{intro}</p>}
                    {items.length > 0 && (
                      <ul className="mt-2 space-y-1.5">
                        {items.map((item, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--site-action)]" aria-hidden="true" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
