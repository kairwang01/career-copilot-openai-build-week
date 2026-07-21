
import React from 'react';
import {
  LayoutDashboard,
  Wrench,
  FileText,
  IdCard,
  Globe,
  CreditCard,
  CalendarCheck,
  ChevronRight,
  User as UserIcon,
  MessageSquare,
  ChevronDown,
  ShieldCheck,
  Briefcase,
  ClipboardList,
  Settings,
  LogOut,
  Sun,
  Moon,
  X,
} from 'lucide-react';
import type { UserProfile } from '../types';
import { ALL_TOOLS_CONFIG } from '../constants/tools';
import LanguageSwitcher from './LanguageSwitcher';
import { isWeb3Enabled, onWeb3FlagChange, refreshWeb3Enabled } from '../config/featureFlags';
import BrandLogo from './BrandLogo';

type SidebarView = 'dashboard' | 'toolkit' | 'resume' | 'talent_profile' | 'jobs' | 'applications' | 'interview' | 'plan' | 'portfolio' | 'billing' | 'account' | 'credentials';

interface SidebarProps {
  activeView: SidebarView;
  onViewChange: (view: SidebarView) => void;
  profile: UserProfile | null;
  credits: number;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onLogout: () => void;
  activeTool: string | null;
  onToolSelect: (tool: string | null) => void;
  t: (key: string) => string;
  currentLang: string;
  onLanguageChange: (lang: string) => void;
  /** Returns to the public homepage from inside the workspace. */
  onHome?: () => void;
  /** Rendered inside the mobile drawer overlay (always visible, fills the drawer height). */
  mobile?: boolean;
  onCloseMobile?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  activeView,
  onViewChange,
  profile,
  credits,
  theme,
  onToggleTheme,
  onLogout,
  activeTool,
  onToolSelect,
  t,
  currentLang,
  onLanguageChange,
  onHome,
  mobile = false,
  onCloseMobile,
}) => {
  // Default collapsed: the full tool list is long, so the sidebar leads with a single
  // "Browse all tools" entry (the dedicated gallery) and keeps the quick-list one tap away.
  const [isToolkitExpanded, setIsToolkitExpanded] = React.useState(false);
  // Identity & Wallet is part of the experimental Web3 module — hidden when the flag is off.
  const [web3Enabled, setWeb3Enabled] = React.useState(isWeb3Enabled());
  React.useEffect(() => {
    let cancelled = false;
    const unsubscribe = onWeb3FlagChange(setWeb3Enabled);
    refreshWeb3Enabled()
      .then((enabled) => { if (!cancelled) setWeb3Enabled(enabled); })
      .catch(() => { /* keep cached fallback */ });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const allWorkspaceItems: { id: SidebarView; label: string; icon: React.ElementType }[] = [
    { id: 'dashboard', label: t('ws_nav_dashboard'), icon: LayoutDashboard },
    { id: 'resume', label: t('ws_nav_resume'), icon: FileText },
    { id: 'talent_profile', label: t('ws_nav_talent_profile'), icon: IdCard },
    { id: 'jobs', label: t('ws_nav_jobs'), icon: Briefcase },
    { id: 'applications', label: t('ws_nav_applications'), icon: ClipboardList },
    { id: 'interview', label: t('ws_nav_interview'), icon: MessageSquare },
    { id: 'plan', label: t('ws_nav_plan'), icon: CalendarCheck },
    { id: 'portfolio', label: t('ws_nav_portfolio'), icon: Globe },
    { id: 'billing', label: t('ws_nav_billing'), icon: CreditCard },
    { id: 'credentials', label: t('ws_nav_credentials'), icon: ShieldCheck },
  ];
  const workspaceItems = web3Enabled
    ? allWorkspaceItems
    : allWorkspaceItems.filter((item) => item.id !== 'credentials');

  // Turn a raw subscription_status (e.g. "pending_essentials") into a readable label.
  const formatPlanStatus = (status?: string | null): string => {
    if (!status || status === 'free') return t('ws_plan_free');
    const pending = status.startsWith('pending_');
    const planKey = status.replace('pending_biz_', '').replace('pending_', '');
    const name = planKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return pending ? t('ws_plan_pending').replace('{plan}', name) : name;
  };

  return (
    <aside
      data-qa={mobile ? 'candidate-mobile-sidebar' : 'candidate-sidebar'}
      className={`${
        mobile ? 'flex w-72 max-w-[85vw] h-full' : 'hidden lg:flex w-64 h-dvh sticky top-0'
      } relative flex-shrink-0 bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-800 flex-col`}
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
      {/* Brand — a single product name; clicking it returns to the public homepage. */}
      <div className="p-6 border-b border-gray-100 dark:border-slate-800">
        <button
          type="button"
          onClick={onHome}
          className="flex items-center gap-3 w-full text-left group"
          aria-label={t('ws_nav_home')}
        >
          <BrandLogo size="lg" surface={theme === 'dark' ? 'dark' : 'light'} subtitle="Career Studio" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-slate-800">
        
        {/* Workspace Section */}
        <div className="space-y-1">
            <h3 className="mb-2 px-4 text-[10px] font-bold uppercase tracking-widest text-gray-600 dark:text-slate-400">{t('ws_section_workspace')}</h3>
            {workspaceItems.map((item) => {
                const isActive = activeView === item.id;
                return (
                    <button type="button"
                        key={item.id}
                        data-qa={`candidate-nav-${item.id}`}
                        data-tour={`nav-${item.id}`}
                        onClick={() => {
                            onViewChange(item.id);
                            onToolSelect(null);
                        }}
                        aria-current={isActive ? 'page' : undefined}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium group ${
                        isActive
                            ? 'bg-slate-100 text-slate-950 shadow-sm dark:bg-slate-800 dark:text-white'
                            : 'text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-950 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100'
                        }`}
                    >
                        <item.icon className={`h-4.5 w-4.5 ${isActive ? 'text-slate-900 dark:text-white' : 'text-gray-400 dark:text-slate-500'}`} />
                        <span className="flex-1 text-left">{item.label}</span>
                        {isActive && <ChevronRight className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />}
                    </button>
                );
            })}
        </div>
        {/* AI Toolkit Section */}
        <div className="space-y-1">
            <div className="flex items-center justify-between px-4 mb-2">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-600 dark:text-slate-400">{t('ws_section_tools')} <span className="text-gray-500 dark:text-slate-400">· {ALL_TOOLS_CONFIG.length}</span></h3>
                <button type="button"
                    onClick={() => setIsToolkitExpanded(!isToolkitExpanded)}
                    aria-expanded={isToolkitExpanded}
                    aria-controls="sidebar-tool-list"
                    aria-label={isToolkitExpanded ? t('ws_tools_collapse') : t('ws_tools_expand')}
                    className="p-1 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-md transition-colors"
                >
                    <ChevronDown className={`h-3 w-3 text-gray-400 transition-transform duration-200 ${isToolkitExpanded ? 'rotate-180' : ''}`} />
                </button>
            </div>
            
            {/* Dedicated tools gallery — declutters the sidebar; the quick-list stays
                one tap away via the chevron above. */}
            <button type="button"
                data-qa="candidate-nav-toolkit"
                data-tour="nav-toolkit"
                onClick={() => { onViewChange('toolkit'); onToolSelect(null); }}
                aria-current={activeView === 'toolkit' ? 'page' : undefined}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium group ${
                    activeView === 'toolkit'
                        ? 'bg-slate-100 text-slate-950 shadow-sm dark:bg-slate-800 dark:text-white'
                        : 'text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-950 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100'
                }`}
            >
                <Wrench className={`h-4.5 w-4.5 ${activeView === 'toolkit' ? 'text-slate-900 dark:text-white' : 'text-gray-400 dark:text-slate-500'}`} />
                <span className="flex-1 text-left">{t('ws_browse_all_tools')}</span>
                {activeView === 'toolkit' && <ChevronRight className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />}
            </button>

            {isToolkitExpanded && (
                <div id="sidebar-tool-list" className="space-y-0.5 animate-panel-expand">
                    {ALL_TOOLS_CONFIG.map((tool) => {
                        const isToolActive = activeTool === tool.key;

                        return (
                            <button type="button"
                                key={tool.key}
                                data-qa={`candidate-tool-${tool.key}`}
                                onClick={() => {
                                    onViewChange('toolkit');
                                    onToolSelect(tool.key);
                                }}
                                aria-current={isToolActive ? 'page' : undefined}
                                className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg text-[11px] font-medium ${
                                    isToolActive
                                        ? 'bg-slate-100 text-slate-950 dark:bg-slate-800 dark:text-white'
                                        : 'text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800 dark:text-slate-500 dark:hover:bg-slate-800/40 dark:hover:text-slate-300'
                                }`}
                            >
                                <div className="flex-shrink-0">
                                    {React.cloneElement(tool.icon, { className: 'h-3.5 w-3.5' })}
                                </div>
                                <span className="truncate">{t(`tool_${tool.key.replace(/-/g, '_')}_title`)}</span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>

      </nav>

      {/* Credits & Footer */}
      <div className="p-4 border-t border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50">
        <div className="flex items-center gap-3 mb-4 px-2" data-tour="credits">
            <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
                <CreditCard className="h-4 w-4" />
            </div>
            <div>
                <p className="text-[10px] font-bold uppercase text-gray-600 dark:text-slate-400">{t('ws_credits_label')}</p>
                <p className="text-xs font-bold text-gray-900 dark:text-white tracking-tight">
                    {credits.toLocaleString()} CR
                </p>
            </div>
        </div>
        <LanguageSwitcher onLanguageChange={onLanguageChange} currentLang={currentLang} variant="footer" />

        {/* My Profile — the single profile access point (the old top-right account
            menu was removed). Opens Account Settings; theme + sign-out sit below. */}
        <div className="mt-1 pt-3 border-t border-gray-200/50 dark:border-slate-800/50" data-tour="account-menu">
            <button
                type="button"
                data-qa="candidate-nav-account"
                onClick={() => { onViewChange('account'); onToolSelect(null); }}
                aria-current={activeView === 'account' ? 'page' : undefined}
                className={`w-full flex items-center gap-3 rounded-lg p-1.5 text-left ${
                    activeView === 'account'
                        ? 'bg-slate-100 shadow-sm dark:bg-slate-800'
                        : 'transition-colors hover:bg-gray-100 dark:hover:bg-slate-800/50'
                }`}
            >
                {profile?.avatar_url ? (
                    <img src={profile.avatar_url} alt={t('ws_profile_avatar_alt')} className="h-7 w-7 rounded-lg object-cover" />
                ) : (
                    <div className="h-7 w-7 rounded-lg bg-gray-200 dark:bg-slate-800 flex items-center justify-center">
                        <UserIcon className="h-3.5 w-3.5 text-gray-500" />
                    </div>
                )}
                <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold text-gray-900 dark:text-white truncate">
                        {profile?.full_name || profile?.company_name || t('ws_profile_fallback')}
                    </p>
                    <p className="text-[9px] text-gray-400 truncate uppercase tracking-tight">
                        {t('menu_account_settings')}
                    </p>
                </div>
                <Settings className="h-3.5 w-3.5 shrink-0 text-gray-400" />
            </button>
            <div className="mt-2 grid grid-cols-2 gap-1">
                <button
                    type="button"
                    onClick={onToggleTheme}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-gray-600 transition-colors hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800/50"
                >
                    {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                    {theme === 'dark' ? t('menu_light_mode') : t('menu_dark_mode')}
                </button>
                <button
                    type="button"
                    onClick={onLogout}
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
};

export default Sidebar;
