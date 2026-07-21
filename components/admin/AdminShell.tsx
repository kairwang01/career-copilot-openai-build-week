import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleHelp, RefreshCw } from 'lucide-react';
import { SITE_ROUTES } from '../../config/site';
import BrandLogo from '../BrandLogo';

export type AdminNavHelp = {
  description: string;
  roles?: Partial<Record<'super' | 'admin' | 'reviewer', string>>;
};

export interface AdminNavItem {
  id: string;
  label: string;
  superOnly?: boolean;
  help?: AdminNavHelp;
}

interface AdminShellProps {
  activeTab: string;
  tabs: AdminNavItem[];
  onTabChange: (id: string) => void;
  userEmail?: string | null;
  userName?: string | null;
  userAvatarUrl?: string | null;
  adminRole?: string | null;
  lastRefreshed?: Date | null;
  loading?: boolean;
  onAccountOpen: () => void;
  onRefresh: () => void;
  onSignOut: () => void;
  children: React.ReactNode;
}

const initialsFor = (value?: string | null) => (
  (value ?? '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'A'
);

const UserAvatar: React.FC<{ src?: string | null; label: string; className?: string }> = ({ src, label, className = '' }) => (
  <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-100 text-xs font-semibold text-blue-800 ${className}`}>
    {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : initialsFor(label)}
  </span>
);

const AdminShell: React.FC<AdminShellProps> = ({
  activeTab,
  tabs,
  onTabChange,
  userEmail,
  userName,
  userAvatarUrl,
  adminRole,
  lastRefreshed,
  loading,
  onAccountOpen,
  onRefresh,
  onSignOut,
  children,
}) => {
  const [helpOpen, setHelpOpen] = useState(false);
  const helpRef = useRef<HTMLDivElement | null>(null);
  const activeItem = tabs.find((t) => t.id === activeTab);
  const activeLabel = activeItem?.label ?? 'Console';
  const activeHelp = activeItem?.help;
  const displayName = userName || userEmail || 'Admin';
  const roleLabel = adminRole ? adminRole.replace(/^\w/, (c) => c.toUpperCase()) : 'Admin';

  useEffect(() => {
    setHelpOpen(false);
  }, [activeTab]);

  useEffect(() => {
    if (!helpOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!helpRef.current?.contains(event.target as Node)) setHelpOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [helpOpen]);

  return (
    <div className="flex h-dvh overflow-hidden bg-[#f0f2f5]" data-qa-shell="admin" data-qa-admin-tab={activeTab}>
      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col bg-[#0f2744] text-white md:flex lg:w-64">
        <div className="px-5 py-6 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <BrandLogo size="sm" surface="dark" subtitle="Admin Console" />
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto" aria-label="Admin navigation">
          {tabs.map((tb) => {
            const active = tb.id === activeTab;
            return (
              <button
                key={tb.id}
                type="button"
                onClick={() => onTabChange(tb.id)}
                data-qa={`admin-nav-${tb.id}`}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-white/30 ${
                  active
                    ? 'bg-white/15 text-white'
                    : 'text-blue-100/80 hover:bg-white/10 hover:text-white'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                <span className="truncate">{tb.label}</span>
                {adminRole === 'super' && tb.superOnly && (
                  <span className="shrink-0 rounded bg-amber-300/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-100 ring-1 ring-amber-200/30">
                    Super
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={onAccountOpen}
          className="mx-3 mb-3 flex items-center gap-3 rounded-md border-t border-white/10 px-2 py-3 text-left text-blue-100/90 transition-colors hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/30"
        >
          <UserAvatar src={userAvatarUrl} label={displayName} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-white">{displayName}</span>
            <span className="mt-0.5 inline-flex rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-100">
              {roleLabel}
            </span>
          </span>
        </button>
      </aside>

      {/* Main column */}
      <div className="flex h-dvh min-w-0 flex-1 flex-col overflow-hidden" data-admin-light>
        {/* Top bar */}
        <header className="sticky top-0 z-40 bg-white border-b border-gray-200 shadow-sm">
          <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
            <div ref={helpRef} className="relative min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate text-base font-semibold text-gray-900">{activeLabel}</h1>
                {activeHelp && (
                  <button
                    type="button"
                    onClick={() => setHelpOpen((open) => !open)}
                    className="shrink-0 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    aria-label={`${activeLabel} help`}
                    aria-expanded={helpOpen}
                  >
                    <CircleHelp className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              {helpOpen && activeHelp && (
                <div className="absolute left-0 top-full z-50 mt-2 w-[min(88vw,24rem)] rounded-lg border border-gray-200 bg-white p-4 text-sm shadow-lg">
                  <p className="font-medium text-gray-900">{activeHelp.description}</p>
                  {activeHelp.roles && (
                    <dl className="mt-3 space-y-2">
                      {(['super', 'admin', 'reviewer'] as const).map((role) => (
                        activeHelp.roles?.[role] ? (
                          <div key={role}>
                            <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{role}</dt>
                            <dd className="mt-0.5 text-gray-700">{activeHelp.roles[role]}</dd>
                          </div>
                        ) : null
                      ))}
                    </dl>
                  )}
                </div>
              )}
              {lastRefreshed && (
                <p className="text-[11px] text-gray-500 mt-0.5 hidden sm:block">
                  Last updated {lastRefreshed.toLocaleTimeString()}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              {/* Mobile nav */}
              <select
                data-qa="admin-mobile-section-select"
                className="md:hidden text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white text-gray-700"
                value={activeTab}
                onChange={(e) => onTabChange(e.target.value)}
                aria-label="Section"
              >
                {tabs.map((tb) => (
                  <option key={tb.id} value={tb.id}>
                    {tb.label}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={onRefresh}
                disabled={loading}
                title="Refresh"
                aria-label="Refresh"
                className="p-2 rounded-md text-gray-500 hover:text-gray-800 hover:bg-gray-100 disabled:opacity-40 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={onAccountOpen}
                className="hidden border-l border-gray-200 pl-3 text-left text-xs text-gray-600 transition-colors hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-600 sm:block"
                title={userEmail ?? ''}
              >
                <span className="block max-w-[min(48vw,24rem)] truncate">{userEmail}</span>
              </button>

              <button
                type="button"
                onClick={onSignOut}
                className="text-xs font-medium text-gray-600 hover:text-gray-900 px-2.5 py-1.5 rounded-md hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 overflow-auto">
          <div className="max-w-6xl mx-auto space-y-6">{children}</div>
        </main>

        <footer className="px-6 py-3 border-t border-gray-200 bg-white text-xs text-gray-500 flex flex-wrap items-center justify-between gap-2">
          <span>Authorized personnel only</span>
          <Link to={SITE_ROUTES.home} className="text-blue-700 hover:underline">
            Public site
          </Link>
        </footer>
      </div>
    </div>
  );
};

export default AdminShell;
