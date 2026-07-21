import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { SITE_ROUTES } from '../../config/site';
import { useMarketingI18n } from '../hooks/useMarketingI18n';
import { SiteLanguageSwitcher } from './SiteLanguageSwitcher';
import BrandLogo from '../../components/BrandLogo';

export const SiteFooter: React.FC = () => {
  const { t } = useMarketingI18n();
  const { pathname } = useLocation();
  const onHome = pathname === SITE_ROUTES.home;

  const scrollTo = (id: string) => {
    if (!onHome) return;
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <footer className="border-t border-[var(--site-border)] bg-[var(--site-surface-muted)]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div className="col-span-2 md:col-span-1">
            <Link to={SITE_ROUTES.home} className="inline-flex">
              <BrandLogo size="sm" />
            </Link>
            <p className="mt-2 text-sm text-[var(--site-text-muted)]">{t('site_footer_tagline')}</p>
          </div>

          <div>
            <h6 className="font-semibold text-[var(--site-text)] mb-2 text-sm">{t('footer_toolkit')}</h6>
            <ul className="space-y-1 text-sm">
              <li>
                <Link to={SITE_ROUTES.sampleReport} className="text-[var(--site-text-muted)] hover:text-[var(--site-text)]">
                  {t('site_tool_resume_report')}
                </Link>
              </li>
              <li>
                <Link to={SITE_ROUTES.sampleReport} className="text-[var(--site-text-muted)] hover:text-[var(--site-text)]">
                  {t('site_tool_interview')}
                </Link>
              </li>
              <li>
                {onHome ? (
                  <button
                    type="button"
                    onClick={() => scrollTo('workflow')}
                    className="text-[var(--site-text-muted)] hover:text-[var(--site-text)]"
                  >
                    {t('site_tool_career_path')}
                  </button>
                ) : (
                  <Link to={`${SITE_ROUTES.home}#workflow`} className="text-[var(--site-text-muted)] hover:text-[var(--site-text)]">
                    {t('site_tool_career_path')}
                  </Link>
                )}
              </li>
              <li>
                <Link to={SITE_ROUTES.pricing} className="text-[var(--site-text-muted)] hover:text-[var(--site-text)]">
                  {t('site_nav_pricing')}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h6 className="font-semibold text-[var(--site-text)] mb-2 text-sm">{t('footer_company')}</h6>
            <ul className="space-y-1 text-sm">
              <li>
                {onHome ? (
                  <button
                    type="button"
                    onClick={() => scrollTo('audience-section')}
                    className="text-[var(--site-text-muted)] hover:text-[var(--site-text)]"
                  >
                    {t('footer_success_stories')}
                  </button>
                ) : (
                  <Link to={`${SITE_ROUTES.home}#audience-section`} className="text-[var(--site-text-muted)] hover:text-[var(--site-text)]">
                    {t('footer_success_stories')}
                  </Link>
                )}
              </li>
              <li>
                {onHome ? (
                  <button
                    type="button"
                    onClick={() => scrollTo('cases-section')}
                    className="text-[var(--site-text-muted)] hover:text-[var(--site-text)]"
                  >
                    {t('site_cases_title')}
                  </button>
                ) : (
                  <Link to={`${SITE_ROUTES.home}#cases-section`} className="text-[var(--site-text-muted)] hover:text-[var(--site-text)]">
                    {t('site_cases_title')}
                  </Link>
                )}
              </li>
              <li>
                {onHome ? (
                  <button
                    type="button"
                    onClick={() => scrollTo('faq-section')}
                    className="text-[var(--site-text-muted)] hover:text-[var(--site-text)]"
                  >
                    {t('faq_title')}
                  </button>
                ) : (
                  <Link to={`${SITE_ROUTES.home}#faq-section`} className="text-[var(--site-text-muted)] hover:text-[var(--site-text)]">
                    {t('faq_title')}
                  </Link>
                )}
              </li>
              <li>
                <a
                  href="/privacy.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--site-text-muted)] hover:text-[var(--site-text)]"
                >
                  {t('footer_privacy')}
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h6 className="font-semibold text-[var(--site-text)] mb-2 text-sm">{t('footer_contact')}</h6>
            <ul className="space-y-1 text-sm">
              <li>
                <a href="mailto:support@careercopilot.ai" className="text-[var(--site-text-muted)] hover:text-[var(--site-text)]">
                  support@careercopilot.ai
                </a>
              </li>
              <li className="text-[var(--site-text-muted)]">{t('footer_location')}</li>
              <li>
                <Link to={SITE_ROUTES.employers} className="text-[var(--site-text-muted)] hover:text-[var(--site-text)]">
                  {t('site_footer_employers')}
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 pt-8 border-t border-[var(--site-border)] flex flex-col-reverse sm:flex-row items-center justify-between gap-4 text-sm text-[var(--site-text-muted)]">
          <p>
            &copy; {new Date().getFullYear()} Career CoPilot. {t('footer_copyright_end')}
          </p>
          <SiteLanguageSwitcher variant="header" />
        </div>

      </div>
    </footer>
  );
};
