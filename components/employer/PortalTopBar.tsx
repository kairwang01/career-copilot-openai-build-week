
import React from 'react';
import { Menu } from 'lucide-react';
import type { UserProfile } from '../../types';
import { usePortalAccountMenu } from './PortalAccountMenuContext';

interface AccountMenuProps {
  profile: UserProfile | null;
  email: string;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onAccount: () => void;
  onSignOut: () => void;
  t: (key: string) => string;
}

interface PortalTopBarProps {
  title: string;
  darkMode?: boolean;
  /**
   * Explicit account-menu config. If omitted, PortalTopBar falls back to
   * the nearest PortalAccountMenuContext (provided by EmployerPortal).
   */
  accountMenuProps?: AccountMenuProps;
}

export function PortalTopBar({ title, darkMode = false, accountMenuProps }: PortalTopBarProps) {
  // Fall back to context when no explicit props were passed
  const ctxMenu = usePortalAccountMenu();
  const menuConfig = accountMenuProps ?? ctxMenu ?? null;
  const onOpenMobileNav = ctxMenu?.onOpenMobileNav;
  const t = menuConfig?.t ?? ((key: string) => key);

  return (
    <div
      className={`h-[63px] border-b flex items-center px-4 sm:px-8 flex-shrink-0 ${
        darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
      }`}
    >
      {onOpenMobileNav && (
        <button
          type="button"
          onClick={onOpenMobileNav}
          data-qa="employer-mobile-nav-open"
          className={`lg:hidden p-2 -ml-2 mr-2 rounded-lg ${
            darkMode ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-600 hover:bg-gray-100'
          }`}
          aria-label={t('portal_open_navigation')}
        >
          <Menu className="h-5 w-5" />
        </button>
      )}
      <h1 className={`min-w-0 flex-1 truncate text-left text-lg font-semibold sm:text-center sm:text-xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
        {title}
      </h1>
      {/* Account access is consolidated into the portal sidebar "My Profile"
          block (bottom-left) — no duplicate top-right account menu. */}
    </div>
  );
}
