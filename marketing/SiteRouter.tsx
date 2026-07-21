import React, { Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { SITE_ROUTES } from '../config/site';
import { JobseekerHomePage } from './pages/JobseekerHomePage';
import { EmployerLandingPage } from './pages/EmployerLandingPage';
import { SampleReportPage } from './pages/SampleReportPage';
import { PricingPage } from './pages/PricingPage';
import SimulatedCheckoutPage from './pages/SimulatedCheckoutPage';
import SimulatedManagePage from './pages/SimulatedManagePage';
import { AuthActionPage } from './pages/AuthActionPage';
import SiteSeo from './components/SiteSeo';

const MvpApp = React.lazy(() => import('../CareerApp'));
const AdminPortal = React.lazy(() => import('../components/admin/AdminPortal'));

const MvpFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500 text-sm">
    Loading app…
  </div>
);

/**
 * React Router doesn't scroll on navigation: cross-page anchor links (e.g. the
 * footer's "/#faq-section" from /pricing) landed at the old scroll position.
 * Scroll to the hash target when present (retrying briefly while lazy content
 * mounts), otherwise reset to top on route change.
 */
const ScrollToHash: React.FC = () => {
  const { pathname, hash, key } = useLocation();

  useEffect(() => {
    if (!hash) {
      window.scrollTo(0, 0);
      return;
    }
    const id = hash.slice(1);
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tryScroll = () => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
      } else if (attempts++ < 10) {
        timer = setTimeout(tryScroll, 100);
      }
    };
    tryScroll();
    return () => clearTimeout(timer);
  }, [pathname, hash, key]);

  return null;
};

/**
 * Marketing routes stay lightweight; authenticated workspaces lazy-load the app shell.
 */
export const SiteRouter: React.FC = () => (
  <>
  <SiteSeo />
  <ScrollToHash />
  <Routes>
    <Route path="/app/*" element={<Navigate to="/workspace" replace />} />
    <Route
      path="/workspace/*"
      element={
        <Suspense fallback={<MvpFallback />}>
          <MvpApp />
        </Suspense>
      }
    />
    <Route path={SITE_ROUTES.home} element={<JobseekerHomePage />} />
    <Route path={SITE_ROUTES.employers} element={<EmployerLandingPage />} />
    <Route path={SITE_ROUTES.sampleReport} element={<SampleReportPage />} />
    <Route path={SITE_ROUTES.pricing} element={<PricingPage />} />
    <Route path={SITE_ROUTES.authAction} element={<AuthActionPage />} />
    <Route path="/__/auth/action" element={<AuthActionPage />} />
    <Route path="/billing/checkout" element={<SimulatedCheckoutPage />} />
    <Route path="/billing/manage" element={<SimulatedManagePage />} />
    <Route
      path={SITE_ROUTES.admin}
      element={
        <Suspense fallback={<MvpFallback />}>
          <AdminPortal />
        </Suspense>
      }
    />
    <Route
      path={`${SITE_ROUTES.portal}/*`}
      element={
        <Suspense fallback={<MvpFallback />}>
          <MvpApp entry="portal" />
        </Suspense>
      }
    />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
  </>
);
