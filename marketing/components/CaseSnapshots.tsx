import React from 'react';
import { caseSnapshots } from '../mock/caseSnapshots';

interface CaseSnapshotsProps {
  t: (key: string) => string;
}

export const CaseSnapshots: React.FC<CaseSnapshotsProps> = ({ t }) => (
  <section id="cases-section" className="py-[var(--site-section)] bg-[var(--site-surface-muted)]">
    <div className="max-w-6xl mx-auto px-4 sm:px-6">
      <h2 className="text-2xl font-semibold mb-2">{t('site_cases_title')}</h2>
      <p className="mb-2 max-w-2xl text-[var(--site-text-muted)]">{t('site_cases_subtitle')}</p>
      <p className="mb-8 max-w-2xl text-xs font-medium text-[var(--site-text-muted)]">
        {t('site_cases_disclaimer')}
      </p>
      <div className="grid md:grid-cols-3 gap-4">
        {caseSnapshots.map((c) => (
          <article
            key={c.id}
            className="border border-[var(--site-border)] rounded-[var(--site-radius)] p-5 bg-[var(--site-surface)]"
          >
            <span className="text-xs font-medium text-[var(--site-action)]">{t(c.tagKey)}</span>
            <h3 className="font-semibold mt-2 mb-2">{t(c.titleKey)}</h3>
            <p className="text-sm text-[var(--site-text-muted)] mb-4">{t(c.outcomeKey)}</p>
            <p className="text-sm font-medium border-t border-[var(--site-border)] pt-3">
              {t(c.metricKey)}
            </p>
          </article>
        ))}
      </div>
    </div>
  </section>
);
