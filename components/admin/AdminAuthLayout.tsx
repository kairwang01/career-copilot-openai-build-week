import React from 'react';
import { Link } from 'react-router-dom';
import { SITE_ROUTES } from '../../config/site';
import BrandLogo from '../BrandLogo';

interface AdminAuthLayoutProps {
  /** Right-panel heading (e.g. "Sign in", "Access denied"). */
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

/**
 * Enterprise admin auth shell — split brand rail + form column.
 * Light, neutral palette (Okta / Stripe Dashboard / GCP Console pattern).
 */
const AdminAuthLayout: React.FC<AdminAuthLayoutProps> = ({ title, subtitle, children }) => (
  <div className="min-h-screen bg-[#f0f2f5] flex flex-col lg:flex-row">
    {/* Brand rail */}
    <aside
      className="lg:w-[420px] xl:w-[460px] shrink-0 bg-[#0f2744] text-white flex flex-col justify-between px-6 py-5 sm:px-8 sm:py-6 lg:px-10 lg:py-12"
      aria-hidden={false}
    >
      <div>
        <BrandLogo size="md" surface="dark" subtitle="Administration Console" />

        <p className="hidden lg:block mt-10 text-sm leading-relaxed text-blue-100/90 max-w-sm">
          Internal operations portal for platform configuration, usage monitoring, and user support.
        </p>

        <ul className="hidden lg:block mt-8 space-y-3 text-sm text-blue-100/75">
          {[
            'API keys and model configuration',
            'Usage quotas and daily limits',
            'User accounts, credits, and audit trail',
          ].map((item) => (
            <li key={item} className="flex items-start gap-2.5">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-300 shrink-0" aria-hidden />
              {item}
            </li>
          ))}
        </ul>
      </div>

      <p className="hidden lg:block text-[11px] text-blue-200/50 mt-10">
        © {new Date().getFullYear()} Career CoPilot · Internal use only
      </p>
    </aside>

    {/* Form column */}
    <main className="flex-1 flex flex-col min-h-0" data-admin-light>
      <div className="flex-1 flex items-start lg:items-center justify-center p-5 sm:p-8 lg:p-10">
        <div className="w-full max-w-[400px]">
          <header className="mb-6 sm:mb-8">
            <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">{title}</h1>
            {subtitle && <p className="mt-2 text-sm text-gray-600 leading-relaxed">{subtitle}</p>}
          </header>
          {children}
        </div>
      </div>

      <footer className="px-6 sm:px-10 py-5 border-t border-gray-200/80 bg-white/60 text-center sm:text-left">
        <p className="text-xs text-gray-500">
          Authorized personnel only. Activity may be monitored and recorded.
        </p>
        <p className="mt-1.5 text-xs">
          <Link
            to={SITE_ROUTES.home}
            className="rounded-sm text-blue-700 hover:text-blue-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            Return to public site
          </Link>
        </p>
      </footer>
    </main>
  </div>
);

export default AdminAuthLayout;
