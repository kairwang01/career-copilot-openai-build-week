import React from 'react';
import {
  LayoutDashboard,
  Briefcase,
  FileText,
  Users,
  Building2,
  User,
  CreditCard,
  ChevronRight,
  BookmarkCheck,
  Settings,
  LogOut,
  Sun,
  Moon,
  X,
} from 'lucide-react';
import type { UserProfile } from '../../types';
import LanguageSwitcher from '../LanguageSwitcher';
import BrandLogo from '../BrandLogo';

export type PortalPage =
  | 'dashboard'
  | 'post-job'
  | 'job-listings'
  | 'talent-pool'
  | 'shortlist'
  | 'agency-hub'
  | 'company-profile'
  | 'account-settings'
  | 'billing';

interface PortalSidebarProps {
  currentPage: PortalPage;
  onNavigate: (page: PortalPage) => void;
  onGoHome: () => void;
  onSignOut: () => void;
  profile: UserProfile | null;
  darkMode: boolean;
  onToggleDark: () => void;
  currentLang: string;
  onLanguageChange: (lang: string) => void;
  t: (key: string) => string;
  /** Rendered inside the mobile drawer overlay (always visible, fills the drawer height). */
  mobile?: boolean;
  onCloseMobile?: () => void;
}

export function PortalSidebar({
  currentPage,
  onNavigate,
  onGoHome,
  onSignOut,
  profile,
  darkMode,
  onToggleDark,
  currentLang,
  onLanguageChange,
  t,
  mobile = false,
  onCloseMobile,
}: PortalSidebarProps) {
  const dm = darkMode;
  const navItem = (page: PortalPage, label: string, Icon: React.ElementType) => {
    const active = currentPage === page;
    return (
      <button type="button"
        key={page}
        data-qa={`employer-nav-${page}`}
        onClick={() => onNavigate(page)}
        aria-current={active ? 'page' : undefined}
        className={`group flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium ${
          active
            ? 'bg-slate-100 text-slate-950 shadow-sm dark:bg-slate-800 dark:text-white'
            : 'text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-950 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100'
        }`}
      >
        <Icon className={`h-4 w-4 flex-shrink-0 ${active ? 'text-slate-900 dark:text-white' : 'text-gray-400 dark:text-slate-500'}`} />
        <span className="flex-1 text-left">{label}</span>
        {active && <ChevronRight className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />}
      </button>
    );
  };

  return (
    <aside
      data-qa={mobile ? 'employer-mobile-sidebar' : 'employer-sidebar'}
      className={`${
        mobile ? 'flex h-full w-72 max-w-[85vw]' : 'hidden h-dvh w-64 lg:flex'
      } relative flex-shrink-0 flex-col border-r border-gray-200 bg-white dark:border-slate-800 dark:bg-slate-900`}
    >
      {mobile && onCloseMobile && (
        <button
          type="button"
          onClick={onCloseMobile}
          className="absolute right-3 top-3 z-10 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-slate-300 dark:hover:bg-slate-800"
          aria-label="Close navigation"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      )}
      <div className="border-b border-gray-100 p-6 dark:border-slate-800">
        <button type="button"
          onClick={onGoHome}
          className="group flex min-w-0 text-left transition-opacity hover:opacity-85"
          aria-label={t('portal_back_home_aria')}
        >
          <BrandLogo size="md" surface={dm ? 'dark' : 'light'} subtitle={t('portal_subtitle')} />
        </button>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-slate-800">
        <div className="space-y-1">
          <h3 className="mb-2 px-4 text-[10px] font-bold uppercase tracking-widest text-gray-600 dark:text-slate-400">
            {t('portal_nav_workspace_group')}
          </h3>
          {navItem('dashboard', t('portal_nav_dashboard'), LayoutDashboard)}
          {navItem('post-job', t('portal_nav_post_job'), Briefcase)}
          {navItem('job-listings', t('portal_nav_job_listings'), FileText)}
          {navItem('talent-pool', t('portal_nav_discover'), Users)}
          {navItem('shortlist', t('portal_nav_shortlist'), BookmarkCheck)}
          {navItem('agency-hub', t('portal_nav_agency_hub'), Building2)}
        </div>

        <div className="space-y-1">
          <h3 className="mb-2 px-4 text-[10px] font-bold uppercase tracking-widest text-gray-600 dark:text-slate-400">
            {t('portal_nav_settings_group')}
          </h3>
          {navItem('company-profile', t('portal_nav_org_profile'), User)}
          {navItem('billing', t('portal_nav_billing'), CreditCard)}
        </div>
      </nav>

      <div className="border-t border-gray-100 bg-gray-50/50 p-4 dark:border-slate-800 dark:bg-slate-900/50">
        <div className="mb-4 flex items-center gap-3 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
            <CreditCard className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase text-gray-600 dark:text-slate-400">{t('portal_credits_label')}</p>
            <p className="text-xs font-bold tracking-tight text-gray-900 dark:text-white">{(profile?.credits ?? 0).toLocaleString()} CR</p>
          </div>
        </div>

        <LanguageSwitcher onLanguageChange={onLanguageChange} currentLang={currentLang} variant="footer" />

        <div className="mt-1 border-t border-gray-200/50 pt-3 dark:border-slate-800/50">
          <button
            type="button"
            data-qa="employer-nav-account-settings"
            onClick={() => onNavigate('account-settings')}
            aria-current={currentPage === 'account-settings' ? 'page' : undefined}
            className={`w-full flex items-center gap-3 rounded-lg p-1.5 text-left ${
              currentPage === 'account-settings'
                ? 'bg-slate-100 shadow-sm dark:bg-slate-800'
                : 'transition-colors hover:bg-gray-100 dark:hover:bg-slate-800/50'
            }`}
          >
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="h-7 w-7 rounded-lg object-cover" />
            ) : (
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-200 dark:bg-slate-800">
                <User className="h-3.5 w-3.5 text-gray-500" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-bold text-gray-900 dark:text-white">
                {profile?.full_name || profile?.company_name || t('portal_business_fallback_name')}
              </p>
              <p className="truncate text-[9px] uppercase tracking-tight text-gray-400">{t('portal_nav_account')}</p>
            </div>
            <Settings className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          </button>
          <div className="mt-2 grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={onToggleDark}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-gray-600 transition-colors hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800/50"
            >
              {dm ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              {dm ? t('menu_light_mode') : t('menu_dark_mode')}
            </button>
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              <LogOut className="h-3.5 w-3.5" />
              {t('menu_sign_out')}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
