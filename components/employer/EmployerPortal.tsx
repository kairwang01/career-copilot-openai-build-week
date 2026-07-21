import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { AppSession as Session } from '../../lib/data';
import type { UserProfile } from '../../types';
import { data } from '../../lib/data';
import { setUserSubscription } from '../../services/subscriptionClient';
import { useSubscriptionCheckout } from '../../contexts/SubscriptionCheckoutContext';
import { shouldRedirectBusinessPlanToCheckout } from '../../lib/access/businessEntryDecisions';
import AgencyHub from '../AgencyHub';
import ApplicantFunnel from '../ApplicantFunnel';
import RecoverableSectionBoundary from '../RecoverableSectionBoundary';
import { PortalSidebar, type PortalPage } from './PortalSidebar';
import { PortalTopBar } from './PortalTopBar';
import { PortalAccountMenuProvider } from './PortalAccountMenuContext';
import { PortalDashboard } from './pages/PortalDashboard';
import { PortalJobListings } from './pages/PortalJobListings';
import { PortalPostJob } from './pages/PortalPostJob';
import { PortalTalentPool } from './pages/PortalTalentPool';
import { PortalOrgProfile } from './pages/PortalOrgProfile';
import { PortalAccountSettings } from './pages/PortalAccountSettings';
import { PortalBilling } from './pages/PortalBilling';
import { PortalShortlist } from './pages/PortalShortlist';
import {
  listApplicationsForJobs,
  listEmployerJobsWithCounts,
  setJobPostingActive,
  type JobPosting,
  type JobPostingWithCount,
} from '../../lib/recruitingData';
import { useToast } from '../Toast';
import { useModalBehavior } from '../../hooks/useModalBehavior';

interface KpiData {
  activeJobs: number;
  totalApplicants: number;
  newApplicants: number;
  avgMatchScore: number;
}

interface EmployerPortalProps {
  session: Session;
  profile: UserProfile;
  refreshProfile: () => Promise<void>;
  navigateToBusinessPricing: () => void;
  onGoHome: () => void;
  onSignOut: () => void;
  t: (key: string) => string;
  initialPage?: PortalPage;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  currentLang: string;
  onLanguageChange: (lang: string) => void;
}

export const EmployerPortal: React.FC<EmployerPortalProps> = ({
  session,
  profile,
  refreshProfile,
  navigateToBusinessPricing,
  onGoHome,
  onSignOut,
  t,
  initialPage = 'dashboard',
  theme,
  onToggleTheme,
  currentLang,
  onLanguageChange,
}) => {
  const { startSubscriptionCheckout } = useSubscriptionCheckout();
  const [currentPage, setCurrentPage] = useState<PortalPage>(initialPage);
  const darkMode = theme === 'dark';

  const [jobPostings, setJobPostings] = useState<JobPostingWithCount[]>([]);
  const [kpiData, setKpiData] = useState<KpiData>({ activeJobs: 0, totalApplicants: 0, newApplicants: 0, avgMatchScore: 0 });
  const [actionQueue, setActionQueue] = useState<{ newThisWeek: number; topNewJobs: { id: string; title: string; newCount: number }[] }>({ newThisWeek: 0, topNewJobs: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // For edit-job flow: which job to edit, back to which page
  const [jobToEdit, setJobToEdit] = useState<JobPostingWithCount | null>(null);
  const [planSaving, setPlanSaving] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const mobileNavDialogRef = useRef<HTMLDivElement | null>(null);
  const [talentPoolInitialJobId, setTalentPoolInitialJobId] = useState<string | null>(null);
  const { addToast } = useToast();
  const mainRef = useRef<HTMLElement | null>(null);
  const mountedRef = useRef(true);
  // Ref latch: the planSaving state lags a render, so a synchronous double-click could
  // create two checkout sessions / two pending writes.
  const planSavingRef = useRef(false);
  // For applicant funnel
  const [jobForFunnel, setJobForFunnel] = useState<JobPosting | null>(null);
  // Previous page before entering post-job/funnel views
  const [prevPage, setPrevPage] = useState<PortalPage>('dashboard');
  const [accountBackPage, setAccountBackPage] = useState<PortalPage>('dashboard');
  const closeMobileNav = useCallback(() => setIsMobileNavOpen(false), []);
  useModalBehavior(closeMobileNav, isMobileNavOpen, true, mobileNavDialogRef);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Keep page in sync when initialPage changes (deep-link from homepage)
  useEffect(() => {
    setCurrentPage(initialPage);
  }, [initialPage]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const jobsWithCounts = await listEmployerJobsWithCounts(session.user.id);
      if (!mountedRef.current) return;

      if (jobsWithCounts.length === 0) {
        setJobPostings([]);
        setKpiData({ activeJobs: 0, totalApplicants: 0, newApplicants: 0, avgMatchScore: 0 });
        setActionQueue({ newThisWeek: 0, topNewJobs: [] });
        setLoading(false);
        return;
      }

      const formatted: JobPostingWithCount[] = jobsWithCounts;
      setJobPostings(formatted);

      // KPI details
      try {
        const jobIds = jobsWithCounts.map((j) => j.id);
        const allApps = await listApplicationsForJobs(jobIds, session.user.id);
        if (!mountedRef.current) return;

        const activeJobs = jobsWithCounts.filter((j) => j.is_active).length;
        const totalApplicants = allApps.length || 0;

        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 7);
        const newApplicants = allApps.filter((a) => new Date(a.application_date) >= cutoff).length || 0;

        const scored = allApps.filter((a) => a.compatibility_score !== null) || [];
        const avgMatchScore = scored.length > 0
          ? Math.round(scored.reduce((s, a) => s + (a.compatibility_score ?? 0), 0) / scored.length)
          : 0;

        setKpiData({ activeJobs, totalApplicants, newApplicants, avgMatchScore });

        // Action queue: which jobs got new applicants this week, so the dashboard can
        // point the recruiter straight at what to handle today (deep-links to that
        // job's pipeline). Derived from already-fetched data — no extra round-trip.
        const recentByJob = new Map<string, number>();
        for (const a of allApps) {
          if (new Date(a.application_date) >= cutoff) recentByJob.set(a.job_id, (recentByJob.get(a.job_id) ?? 0) + 1);
        }
        const topNewJobs = jobsWithCounts
          .map((j) => ({ id: j.id, title: j.title, newCount: recentByJob.get(j.id) ?? 0 }))
          .filter((j) => j.newCount > 0)
          .sort((a, b) => b.newCount - a.newCount)
          .slice(0, 4);
        setActionQueue({ newThisWeek: newApplicants, topNewJobs });
      } catch {
        if (!mountedRef.current) return;
        // KPI fetch failed — derive from job list
        const activeJobs = jobsWithCounts.filter((j) => j.is_active).length;
        const totalApplicants = formatted.reduce((s, j) => s + j.applicant_count, 0);
        setKpiData({ activeJobs, totalApplicants, newApplicants: 0, avgMatchScore: 0 });
        setActionQueue({ newThisWeek: 0, topNewJobs: [] });
      }
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : 'Failed to load data.');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [session.user.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [currentPage, jobForFunnel?.id]);

  const navigate = (page: PortalPage) => {
    // Clear edit/funnel state when navigating via sidebar
    if (page === 'account-settings' && currentPage !== 'account-settings') {
      setAccountBackPage(currentPage);
    }
    setJobToEdit(null);
    setJobForFunnel(null);
    setTalentPoolInitialJobId(null);
    setIsMobileNavOpen(false);
    setCurrentPage(page);
  };

  const handleEditJob = (job: JobPostingWithCount) => {
    setJobToEdit(job);
    setPrevPage(currentPage);
    setCurrentPage('post-job');
  };

  const handleSetJobActive = async (job: JobPostingWithCount, isActive: boolean) => {
    try {
      await setJobPostingActive(job.id, isActive);
      addToast(isActive ? t('portal_toast_job_reopened') : t('portal_toast_job_closed'), 'success');
      await fetchData();
    } catch (err) {
      addToast(t('portal_toast_job_status_failed').replace('{error}', err instanceof Error ? err.message : 'error'), 'error');
    }
  };

  const handleViewApplicants = (job: JobPostingWithCount) => {
    if (!job?.id || !job?.title) {
      addToast(t('applicant_funnel_load_error'), 'error');
      setCurrentPage('job-listings');
      return;
    }
    setJobForFunnel(job);
    setPrevPage(currentPage);
  };

  const handleSourceCandidates = (job: JobPostingWithCount) => {
    setJobToEdit(null);
    setJobForFunnel(null);
    setTalentPoolInitialJobId(job.id);
    setIsMobileNavOpen(false);
    setCurrentPage('talent-pool');
  };

  const handlePostJobSaved = async () => {
    addToast(jobToEdit ? t('portal_toast_job_updated') : t('portal_toast_job_posted'), 'success');
    await fetchData();
    setJobToEdit(null);
    navigate('job-listings');
  };

  const handlePostJobCancel = () => {
    setJobToEdit(null);
    setCurrentPage(prevPage);
  };

  const handleSelectPlan = async (planKey: string) => {
    if (planSaving || planSavingRef.current) return;
    planSavingRef.current = true;
    setPlanSaving(true);
    try {
      const pendingPlanKey = `pending_biz_${planKey}`;
      const result = await setUserSubscription(pendingPlanKey);
      if (shouldRedirectBusinessPlanToCheckout(planKey, result.status)) {
        await startSubscriptionCheckout(pendingPlanKey, { onComplete: refreshProfile });
        return;
      }
      await refreshProfile();
      addToast(t('portal_toast_plan_updated'), 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      addToast(t('portal_toast_plan_update_failed').replace('{error}', message), 'error');
    } finally {
      planSavingRef.current = false;
      setPlanSaving(false);
    }
  };

  const getPageTitle = () => {
    switch (currentPage) {
      case 'dashboard': return t('portal_nav_dashboard');
      case 'post-job': return jobToEdit ? t('portal_title_edit_job') : t('portal_nav_post_job');
      case 'job-listings': return t('portal_nav_job_listings');
      case 'talent-pool': return t('portal_nav_discover');
      case 'shortlist': return t('portal_nav_shortlist');
      case 'agency-hub': return t('portal_nav_agency_hub');
      case 'company-profile': return t('portal_nav_org_profile');
      case 'account-settings': return t('portal_nav_account');
      case 'billing': return t('portal_nav_billing');
      default: return t('portal_nav_dashboard');
    }
  };

  // Shared props for the AccountMenu rendered in every PortalTopBar
  const accountMenuProps = {
    profile,
    email: session.user.email ?? '',
    theme,
    onToggleTheme,
    onAccount: () => navigate('account-settings'),
    onSignOut,
    t,
    onOpenMobileNav: () => setIsMobileNavOpen(true),
  };

  const sidebarProps = {
    onNavigate: navigate,
    onGoHome,
    onSignOut,
    profile,
    darkMode,
    onToggleDark: onToggleTheme,
    currentLang,
    onLanguageChange,
    t,
  };

  // Slide-over nav for narrow screens — the sidebar itself is hidden below lg.
  const renderMobileNavDrawer = (page: PortalPage) =>
    isMobileNavOpen ? (
      <div
        ref={mobileNavDialogRef}
        className="fixed inset-0 z-50 lg:hidden"
        role="dialog"
        aria-modal="true"
        aria-label={t('portal_open_navigation')}
        tabIndex={-1}
        data-qa="employer-mobile-nav-drawer"
      >
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={closeMobileNav}
          aria-hidden="true"
        />
        <div className="absolute inset-y-0 left-0 animate-slide-in-left">
          <PortalSidebar {...sidebarProps} currentPage={page} mobile onCloseMobile={closeMobileNav} />
        </div>
      </div>
    ) : null;

  // Applicant funnel takes over the whole main area
  if (jobForFunnel) {
    return (
      <PortalAccountMenuProvider value={accountMenuProps}>
        <div className={`flex h-dvh w-full ${darkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
          <PortalSidebar {...sidebarProps} currentPage={prevPage} />
          {renderMobileNavDrawer(prevPage)}
          <main
            ref={mainRef}
            className="flex-1 overflow-y-auto pb-[var(--cookie-consent-bottom-space,0px)] transition-[padding-bottom] duration-200"
            data-qa-employer-page="applicant-funnel"
          >
            <RecoverableSectionBoundary
              resetKey={`applicant-funnel:${jobForFunnel.id}:${jobForFunnel.updated_at ?? ''}`}
              title={t('applicant_funnel_error_title')}
              description={t('applicant_funnel_load_error')}
              retryLabel={t('applicant_funnel_retry')}
              onRetry={fetchData}
              secondaryLabel={t('applicant_funnel_back')}
              onSecondaryAction={() => { setJobForFunnel(null); setCurrentPage(prevPage); }}
            >
              <PortalTopBar title={`${t('portal_title_applicants_for')} — ${jobForFunnel.title}`} darkMode={darkMode} />
              <div className="mx-auto max-w-[1088px] p-4 animate-view-fade sm:p-6 lg:p-8">
                <ApplicantFunnel
                  job={jobForFunnel}
                  employerUid={session.user.id}
                  onBack={() => { setJobForFunnel(null); setCurrentPage(prevPage); }}
                  t={t}
                />
              </div>
            </RecoverableSectionBoundary>
          </main>
        </div>
      </PortalAccountMenuProvider>
    );
  }

  return (
    <PortalAccountMenuProvider value={accountMenuProps}>
      <div className={`flex h-dvh w-full ${darkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
        <PortalSidebar {...sidebarProps} currentPage={currentPage} />
        {renderMobileNavDrawer(currentPage)}

        <main
          ref={mainRef}
          className="flex-1 overflow-y-auto pb-[var(--cookie-consent-bottom-space,0px)] transition-[padding-bottom] duration-200"
          data-qa-employer-page={currentPage}
        >
          {currentPage === 'dashboard' && (
            <PortalDashboard
              jobPostings={jobPostings}
              kpiData={kpiData}
              actionQueue={actionQueue}
              loading={loading}
              error={error}
              darkMode={darkMode}
              onNavigate={navigate}
              onViewApplicants={handleViewApplicants}
              companyName={profile.company_name || ''}
              t={t}
            />
          )}

          {currentPage === 'post-job' && (
            <PortalPostJob
              session={session}
              profile={profile}
              darkMode={darkMode}
              existingJob={jobToEdit}
              onSaved={handlePostJobSaved}
              onCancel={handlePostJobCancel}
              t={t}
            />
          )}

          {currentPage === 'job-listings' && (
            <PortalJobListings
              jobPostings={jobPostings}
              kpiData={kpiData}
              loading={loading}
              error={error}
              darkMode={darkMode}
              onEditJob={handleEditJob}
              onViewApplicants={handleViewApplicants}
              onSourceCandidates={handleSourceCandidates}
              onSetJobActive={handleSetJobActive}
              onNavigate={navigate}
              t={t}
            />
          )}

          {currentPage === 'talent-pool' && (
            <PortalTalentPool
              profile={profile}
              darkMode={darkMode}
              onPostJob={() => navigate('post-job')}
              onOpenShortlist={() => navigate('shortlist')}
              navigateToBusinessPricing={navigateToBusinessPricing}
              jobPostings={jobPostings}
              jobsLoading={loading}
              jobsError={error}
              onRetryJobs={fetchData}
              initialJobId={talentPoolInitialJobId}
              t={t}
            />
          )}

          {currentPage === 'shortlist' && (
            <PortalShortlist
              session={session}
              darkMode={darkMode}
              t={t}
              onNavigate={navigate}
            />
          )}

          {currentPage === 'agency-hub' && (
            <>
              <PortalTopBar title={t('portal_nav_agency_hub')} darkMode={darkMode} />
              <div className={`mx-auto max-w-[1088px] p-4 animate-view-fade sm:p-6 lg:p-8 ${darkMode ? 'text-white' : ''}`}>
                <AgencyHub session={session} profile={profile} t={t} />
              </div>
            </>
          )}

          {currentPage === 'company-profile' && (
            <PortalOrgProfile
              session={session}
              profile={profile}
              darkMode={darkMode}
              onSaved={refreshProfile}
              t={t}
            />
          )}

          {currentPage === 'account-settings' && (
            <PortalAccountSettings
              session={session}
              darkMode={darkMode}
              onBack={() => navigate(accountBackPage === 'account-settings' ? 'dashboard' : accountBackPage)}
              t={t}
            />
          )}

          {currentPage === 'billing' && (
            <PortalBilling
              profile={profile}
              darkMode={darkMode}
              activeJobs={kpiData.activeJobs}
              onSelectPlan={handleSelectPlan}
              planSaving={planSaving}
              t={t}
            />
          )}
        </main>
      </div>
    </PortalAccountMenuProvider>
  );
};

export type { PortalPage };
