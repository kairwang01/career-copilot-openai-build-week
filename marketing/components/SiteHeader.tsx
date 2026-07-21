import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { SITE_ROUTES } from '../../config/site';
import { useMarketingI18n } from '../hooks/useMarketingI18n';
import { SiteMobileNav } from './SiteMobileNav';
import { SiteLanguageSwitcher } from './SiteLanguageSwitcher';
import { useSiteSession } from '../hooks/useSiteSession';
import BrandLogo from '../../components/BrandLogo';
import { businessPortalNavPath } from '../../lib/access/navigationDecisions';

export const SiteHeader: React.FC = () => {
  const { pathname } = useLocation();
  const isEmployerSurface = pathname.startsWith(SITE_ROUTES.employers) || pathname.startsWith(SITE_ROUTES.portal);
  const { t } = useMarketingI18n();
  const { session, isAdmin, isBusiness } = useSiteSession();
  const workspaceHref = SITE_ROUTES.workspace;
  const workspaceLabel = t('site_nav_workspace');
  const businessHref = businessPortalNavPath(isBusiness);
  const workflowHref = isEmployerSurface ? `${SITE_ROUTES.employers}#workflow` : `${SITE_ROUTES.home}#workflow`;
  const signInHref = isEmployerSurface ? `${SITE_ROUTES.portal}?auth=signin` : `${SITE_ROUTES.workspace}?auth=signin`;
  const primaryCtaHref = isEmployerSurface ? `${SITE_ROUTES.portal}?auth=signup` : `${SITE_ROUTES.workspace}?auth=signup`;

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--site-border)] bg-[var(--site-surface)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--site-surface)]/85">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 lg:h-[72px] flex items-center justify-between gap-4">
        {/* Audience lockup: the logo itself says WHICH surface you are on, so the
            nav never needs a self-referential "Business" item (the old nav showed
            "Business" while already ON the business surface — confusing). The
            logo keeps you on your current surface. */}
        <Link
          to={isEmployerSurface ? SITE_ROUTES.employers : SITE_ROUTES.home}
          className="flex min-w-0 shrink-0 items-center gap-2"
        >
          <BrandLogo size="md" />
          {isEmployerSurface && (
            <span className="ml-2 rounded-md bg-[var(--site-action)]/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--site-action)]">
              {t('site_badge_business')}
            </span>
          )}
        </Link>

        <nav className="hidden lg:flex items-center gap-7 text-sm font-medium">
          <Link to={workflowHref} className="text-[var(--site-text-muted)] hover:text-[var(--site-text)]">
            {t('site_nav_how_it_works')}
          </Link>
          {!isEmployerSurface && (
            <Link to={SITE_ROUTES.workspace} className="text-[var(--site-text-muted)] hover:text-[var(--site-text)]">
              {t('site_nav_job_search')}
            </Link>
          )}
          {isEmployerSurface && (
            <Link to={SITE_ROUTES.portal} className="text-[var(--site-text-muted)] hover:text-[var(--site-text)]">
              {t('site_nav_discover_talent')}
            </Link>
          )}
          <Link
            to={isEmployerSurface ? `${SITE_ROUTES.pricing}?audience=employer` : SITE_ROUTES.pricing}
            className="text-[var(--site-text-muted)] hover:text-[var(--site-text)]"
          >
            {t('site_nav_pricing')}
          </Link>
          {/* ONE audience switch per surface, visually separated from content nav —
              switching audience is a mode change, not another page. */}
          <span className="h-4 w-px bg-[var(--site-border)]" aria-hidden="true" />
          {isEmployerSurface ? (
            <Link to={SITE_ROUTES.home} className="text-[var(--site-text-muted)] hover:text-[var(--site-text)]">
              {t('site_switch_jobseekers')} →
            </Link>
          ) : (
            <Link to={SITE_ROUTES.employers} className="text-[var(--site-text-muted)] hover:text-[var(--site-text)]">
              {t('site_switch_business')} →
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="hidden md:block">
            <SiteLanguageSwitcher />
          </div>
          {session ? (
            <>
              {isBusiness ? (
                <Link
                  to={businessHref}
                  className="hidden sm:inline-flex min-h-[38px] items-center text-sm font-medium text-[var(--site-text-muted)] hover:text-[var(--site-text)] whitespace-nowrap"
                >
                  {t('site_nav_business_portal')}
                </Link>
              ) : (
                <Link
                  to={businessHref}
                  className="hidden sm:inline-flex min-h-[38px] items-center text-sm font-medium text-[var(--site-text-muted)] hover:text-[var(--site-text)] whitespace-nowrap"
                >
                  {t('site_nav_join_business')}
                </Link>
              )}
              {isAdmin && (
                <Link
                  to={SITE_ROUTES.admin}
                  className="hidden sm:inline-flex min-h-[38px] items-center text-sm font-medium text-[var(--site-text-muted)] hover:text-[var(--site-text)] whitespace-nowrap"
                >
                  {t('site_nav_admin_portal')}
                </Link>
              )}
              <Link
                to={workspaceHref}
                className="hidden sm:inline-flex min-h-[40px] items-center justify-center rounded-[var(--site-radius)] bg-[var(--site-action)] px-4 text-sm font-semibold text-white hover:bg-[var(--site-action-hover)] whitespace-nowrap"
              >
                {workspaceLabel}
              </Link>
            </>
          ) : (
            <>
              <Link
                to={signInHref}
                className="hidden sm:inline-flex min-h-[38px] items-center text-sm font-medium text-[var(--site-text-muted)] hover:text-[var(--site-text)] whitespace-nowrap"
              >
                {t('site_nav_sign_in')}
              </Link>
              <Link
                to={primaryCtaHref}
                className="hidden sm:inline-flex min-h-[40px] items-center justify-center rounded-[var(--site-radius)] bg-[var(--site-action)] px-4 text-sm font-semibold text-white hover:bg-[var(--site-action-hover)] whitespace-nowrap"
              >
                {t('business_hero_get_started_button')}
              </Link>
            </>
          )}
          <SiteMobileNav />
        </div>
      </div>
    </header>
  );
};
