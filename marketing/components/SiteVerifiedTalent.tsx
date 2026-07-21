import React from 'react';

interface SiteVerifiedTalentProps {
  t: (key: string) => string;
}

const candidateItems: readonly (readonly [string, string])[] = [
  ['site_vt_js_benefit1_title', 'site_vt_js_benefit1_desc'],
  ['site_vt_js_benefit2_title', 'site_vt_js_benefit2_desc'],
  ['site_vt_js_benefit3_title', 'site_vt_js_benefit3_desc'],
];

const employerItems: readonly (readonly [string, string])[] = [
  ['site_vt_emp_benefit1_title', 'site_vt_emp_benefit1_desc'],
  ['site_vt_emp_benefit2_title', 'site_vt_emp_benefit2_desc'],
  ['site_vt_emp_benefit3_title', 'site_vt_emp_benefit3_desc'],
];

const BenefitList: React.FC<{ items: readonly (readonly [string, string])[]; t: (key: string) => string }> = ({
  items,
  t,
}) => (
  <div className="space-y-4">
    {items.map(([titleKey, descKey]) => (
      <div key={titleKey} className="border-t border-[var(--site-border)] pt-4 first:border-t-0 first:pt-0">
        <h4 className="text-sm font-semibold text-[var(--site-text)]">{t(titleKey)}</h4>
        <p className="mt-1 text-sm text-[var(--site-text-muted)] leading-relaxed">{t(descKey)}</p>
      </div>
    ))}
  </div>
);

export const SiteVerifiedTalent: React.FC<SiteVerifiedTalentProps> = ({ t }) => (
  <section className="py-12 sm:py-[var(--site-section)] bg-[var(--site-surface-muted)]">
    <div className="max-w-6xl mx-auto px-4 sm:px-6">
      <div className="max-w-3xl mb-8">
        <p className="text-sm font-medium text-[var(--site-action)] mb-3">{t('site_tool_verified')}</p>
        <h2 className="text-xl sm:text-2xl font-semibold">{t('site_vt_title')}</h2>
        <p className="mt-3 text-[var(--site-text-muted)]">{t('site_vt_subtitle')}</p>
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <article className="rounded-[var(--site-radius)] border border-[var(--site-border)] bg-[var(--site-surface)] p-5 sm:p-6">
          <h3 className="font-semibold mb-5">{t('site_vt_js_section_title')}</h3>
          <BenefitList items={candidateItems} t={t} />
        </article>
        <article className="rounded-[var(--site-radius)] border border-[var(--site-border)] bg-[var(--site-surface)] p-5 sm:p-6">
          <h3 className="font-semibold mb-5">{t('site_vt_emp_section_title')}</h3>
          <BenefitList items={employerItems} t={t} />
        </article>
      </div>
    </div>
  </section>
);
