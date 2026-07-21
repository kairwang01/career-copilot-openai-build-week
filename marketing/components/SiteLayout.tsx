import React from 'react';
import '../site-theme.css';
import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';
import { useMarketingI18n } from '../hooks/useMarketingI18n';

interface SiteLayoutProps {
  children: React.ReactNode;
  /** Stable identifier asserted by the QA harness (locale-independent). */
  pageId: string;
  /** Marketing routes expose the QA marker; /workspace omits it (isolated tool shell). */
  marketingShell?: boolean;
}

export const SiteLayout: React.FC<SiteLayoutProps> = ({
  children,
  pageId,
  marketingShell = true,
}) => {
  const { isLoaded } = useMarketingI18n();

  const shellAttrs = marketingShell
    ? { 'data-beta-app': 'true' as const, 'data-beta-page': pageId }
    : { 'data-site-workspace': 'true' as const };

  if (!isLoaded) {
    return (
      <div
        {...shellAttrs}
        data-beta-loading={marketingShell ? 'true' : undefined}
        className="beta-root min-h-screen flex items-center justify-center text-[var(--site-text-muted)]"
      >
        Loading…
      </div>
    );
  }

  return (
    <div {...shellAttrs} className="beta-root min-h-screen flex flex-col overflow-x-hidden">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
};
