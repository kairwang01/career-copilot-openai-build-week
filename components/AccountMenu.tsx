
import React, { useState, useRef, useEffect } from 'react';
import { Settings, LogOut, Sun, Moon, ChevronDown, User as UserIcon } from 'lucide-react';
import type { UserProfile } from '../types';

interface AccountMenuProps {
  profile: UserProfile | null;
  email: string;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onAccount: () => void;
  onSignOut: () => void;
  t: (key: string) => string;
}

/** Formats a raw subscription_status into a readable plan label. */
function formatPlan(status: string | null | undefined, t: (key: string) => string): string {
  if (!status || status === 'free') return t('ws_plan_free');
  const pending = status.startsWith('pending_');
  const key = status.replace('pending_biz_', '').replace('pending_', '');
  const name = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return pending ? t('ws_plan_pending').replace('{plan}', name) : name;
}

const AccountMenu: React.FC<AccountMenuProps> = ({
  profile,
  email,
  theme,
  onToggleTheme,
  onAccount,
  onSignOut,
  t,
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click-outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const displayName =
    profile?.full_name || profile?.company_name || email;

  const initials = displayName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

  const isDark = theme === 'dark';

  return (
    <div ref={containerRef} className="relative">
      {/* Avatar trigger button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
          isDark
            ? 'hover:bg-slate-800 focus:ring-offset-slate-900'
            : 'hover:bg-gray-100 focus:ring-offset-white'
        }`}
        aria-label={t('menu_account_menu')}
        aria-expanded={open}
        aria-haspopup="true"
      >
        {/* Avatar */}
        {profile?.avatar_url ? (
          <img
            src={profile.avatar_url}
            alt={displayName}
            className="h-8 w-8 rounded-full object-cover ring-2 ring-blue-500/30"
          />
        ) : (
          <div
            className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold ring-2 ring-blue-500/30 select-none ${
              isDark
                ? 'bg-blue-900/40 text-blue-300'
                : 'bg-blue-100 text-blue-700'
            }`}
          >
            {initials || <UserIcon className="h-4 w-4" />}
          </div>
        )}

        {/* Caret */}
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          } ${isDark ? 'text-slate-400' : 'text-gray-400'}`}
        />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className={`absolute right-0 top-full mt-2 w-64 rounded-2xl border shadow-xl z-50 overflow-hidden animate-fade-scale ${
            isDark
              ? 'bg-slate-900 border-slate-700 shadow-black/40'
              : 'bg-white border-gray-200 shadow-gray-200/80'
          }`}
        >
          {/* Header: name + email + plan */}
          <div
            className={`px-4 py-3.5 border-b ${
              isDark ? 'border-slate-800' : 'border-gray-100'
            }`}
          >
            <div
              className={`text-sm font-semibold truncate ${
                isDark ? 'text-white' : 'text-gray-900'
              }`}
            >
              {displayName}
            </div>
            <div
              className={`text-xs truncate mt-0.5 ${
                isDark ? 'text-slate-400' : 'text-gray-500'
              }`}
            >
              {email}
            </div>
            <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5">
              <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                {formatPlan(profile?.subscription_status, t)}
              </span>
            </div>
          </div>

          {/* Menu items */}
          <div className="py-1.5">
            {/* Account Settings */}
            <button
              type="button"
              onClick={() => { setOpen(false); onAccount(); }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors text-left ${
                isDark
                  ? 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <Settings className="h-4 w-4 flex-shrink-0 text-gray-400" />
              {t('menu_account_settings')}
            </button>

            {/* Theme toggle */}
            <button
              type="button"
              onClick={() => { onToggleTheme(); }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors text-left ${
                isDark
                  ? 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              {isDark ? (
                <Sun className="h-4 w-4 flex-shrink-0 text-amber-400" />
              ) : (
                <Moon className="h-4 w-4 flex-shrink-0 text-gray-400" />
              )}
              {isDark ? t('menu_light_mode') : t('menu_dark_mode')}
            </button>
          </div>

          {/* Divider */}
          <div className={`border-t ${isDark ? 'border-slate-800' : 'border-gray-100'}`} />

          {/* Sign out */}
          <div className="py-1.5">
            <button
              type="button"
              onClick={() => { setOpen(false); onSignOut(); }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors text-left ${
                isDark
                  ? 'text-red-400 hover:bg-red-900/20 hover:text-red-300'
                  : 'text-red-600 hover:bg-red-50 hover:text-red-700'
              }`}
            >
              <LogOut className="h-4 w-4 flex-shrink-0" />
              {t('menu_sign_out')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AccountMenu;
