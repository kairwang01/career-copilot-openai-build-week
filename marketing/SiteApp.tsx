import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { ApiStatusProvider } from '../contexts/ApiStatusContext';
import { CreditsProvider } from '../contexts/CreditsContext';
import { SessionProvider } from '../contexts/SessionContext';
import { SiteRouter } from './SiteRouter';
import { MarketingI18nProvider } from './contexts/MarketingI18nContext';
import ErrorBoundary from '../components/ErrorBoundary';
import { ToastProvider } from '../components/Toast';
import { SubscriptionCheckoutProvider } from '../contexts/SubscriptionCheckoutContext';

// The `vite:preloadError` self-heal for stale post-deploy chunks is registered
// in the entry (`index.tsx`) so it also covers this SiteApp chunk itself — a
// handler registered here could not fire when SiteApp is the chunk that 404s.

/** Public marketing shell at /; resume tools lazy-load at /workspace. */
const SiteApp: React.FC = () => (
  <ErrorBoundary>
    <ApiStatusProvider>
      <CreditsProvider>
        <MarketingI18nProvider>
          <ToastProvider>
            <SubscriptionCheckoutProvider>
              <BrowserRouter>
                <SessionProvider>
                  <SiteRouter />
                </SessionProvider>
              </BrowserRouter>
            </SubscriptionCheckoutProvider>
          </ToastProvider>
        </MarketingI18nProvider>
      </CreditsProvider>
    </ApiStatusProvider>
  </ErrorBoundary>
);

export default SiteApp;
