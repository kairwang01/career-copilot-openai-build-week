
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { startObservabilityWhenConsented } from './lib/observability';
import ErrorBoundary from './components/ErrorBoundary';

// Optional monitoring starts only after the persisted or current-session choice.
startObservabilityWhenConsented();

// After a deploy, a returning tab may hold stale lazy-chunk URLs; importing one
// 404s and React throws a blank-screen "Failed to fetch dynamically imported
// module". Vite raises `vite:preloadError` for exactly this — recover by doing a
// one-time hard reload (guarded against a reload loop) to fetch the new chunks.
// This MUST live in the entry (not a lazy chunk): the very first import below is
// the SiteApp chunk, so a handler registered inside SiteApp would never run when
// SiteApp itself is the chunk that 404s. Registering here covers every chunk,
// including the app shell.
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', () => {
    const KEY = 'cc_preload_reloaded_at';
    const last = Number(sessionStorage.getItem(KEY) || '0');
    if (Date.now() - last > 10_000) {
      sessionStorage.setItem(KEY, String(Date.now()));
      window.location.reload();
    }
  });
}

const SiteApp = React.lazy(() => import('./marketing/SiteApp'));

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    {/* Root boundary above Suspense: if the SiteApp chunk fails to load or throws
        while evaluating (the in-SiteApp boundary hasn't mounted yet), this shows
        the friendly reload screen instead of an unrecoverable blank page. */}
    <ErrorBoundary>
      <React.Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center text-gray-500">Loading…</div>
        }
      >
        <SiteApp />
      </React.Suspense>
    </ErrorBoundary>
  </React.StrictMode>
);
