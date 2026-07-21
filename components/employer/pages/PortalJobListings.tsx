import React, { useState } from 'react';
import {
  ArrowRight,
  Briefcase,
  Users,
  TrendingUp,
  UserCheck,
  ThumbsUp,
  MapPin,
  Calendar,
  Edit,
  ChevronDown,
  ChevronUp,
  Search,
  AlertCircle,
  MessageSquare,
} from 'lucide-react';
import { PortalTopBar } from '../PortalTopBar';
import ConfirmActionDialog from '../../ConfirmActionDialog';
import type { JobPostingWithCount } from '../../../lib/recruitingData';
import type { PortalPage } from '../PortalSidebar';

interface PortalJobListingsProps {
  jobPostings: JobPostingWithCount[];
  kpiData: { activeJobs: number; totalApplicants: number; newApplicants: number };
  loading: boolean;
  error: string | null;
  darkMode: boolean;
  onEditJob: (job: JobPostingWithCount) => void;
  onViewApplicants: (job: JobPostingWithCount) => void;
  onSourceCandidates: (job: JobPostingWithCount) => void;
  onSetJobActive: (job: JobPostingWithCount, isActive: boolean) => Promise<void> | void;
  onNavigate: (page: PortalPage) => void;
  t?: (key: string) => string;
}

function StatCard({
  title,
  value,
  Icon,
  darkMode,
}: {
  title: string;
  value: string | number;
  Icon: React.ElementType;
  darkMode: boolean;
}) {
  const dm = darkMode;
  return (
    <div className={`rounded-xl border p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${dm ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`text-2xl font-semibold leading-none ${dm ? 'text-white' : 'text-gray-900'}`}>{value}</div>
          <div className={`mt-2 text-xs font-medium leading-4 ${dm ? 'text-gray-400' : 'text-gray-600'}`}>{title}</div>
        </div>
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${dm ? 'bg-gray-700' : 'bg-blue-50'}`}>
          <Icon className="w-4 h-4 text-[#1d4ed8]" />
        </div>
      </div>
    </div>
  );
}

export function PortalJobListings({
  jobPostings,
  kpiData,
  loading,
  error,
  darkMode,
  onEditJob,
  onViewApplicants,
  onSourceCandidates,
  onSetJobActive,
  onNavigate,
  t: tProp,
}: PortalJobListingsProps) {
  const t = tProp ?? ((k: string) => k);
  const dm = darkMode;
  const [showExpired, setShowExpired] = useState(false);
  const [showAllActive, setShowAllActive] = useState(false);

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'closed'>('all');
  const [statusConfirm, setStatusConfirm] = useState<{ job: JobPostingWithCount; isActive: boolean } | null>(null);
  const [statusSavingId, setStatusSavingId] = useState<string | null>(null);

  const normalizedQuery = query.trim().toLowerCase();
  const activeJobs = jobPostings.filter((j) => j.is_active);
  const closedJobs = jobPostings.filter((j) => !j.is_active);
  const filteredJobs = jobPostings.filter((job) => {
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && job.is_active) ||
      (statusFilter === 'closed' && !job.is_active);
    const haystack = `${job.title} ${job.location ?? ''} ${job.company_name ?? ''}`.toLowerCase();
    return matchesStatus && (!normalizedQuery || haystack.includes(normalizedQuery));
  });
  const filteredActiveJobs = filteredJobs.filter((j) => j.is_active);
  const filteredClosedJobs = filteredJobs.filter((j) => !j.is_active);
  const displayedActive = showAllActive ? filteredActiveJobs : filteredActiveJobs.slice(0, 5);
  const showingClosedOnly = statusFilter === 'closed';
  const showClosedListings = showExpired || showingClosedOnly;
  const activeWithApplicants = activeJobs.filter((j) => j.applicant_count > 0).length;
  const quietActiveJobs = activeJobs.filter((j) => j.applicant_count === 0).length;
  const avgApplicants = activeJobs.length > 0
    ? Math.round(activeJobs.reduce((sum, job) => sum + job.applicant_count, 0) / activeJobs.length)
    : 0;
  const hasActiveFilters = normalizedQuery.length > 0 || statusFilter !== 'all';

  const statusLabel = (job: JobPostingWithCount) => (job.is_active ? t('portal_status_active') : t('portal_status_closed'));
  const statusStyle = (job: JobPostingWithCount) =>
    job.is_active
      ? dm ? 'bg-teal-900/30 text-teal-300 border-teal-800' : 'bg-teal-50 text-teal-800 border-teal-200'
      : dm ? 'bg-gray-700 text-gray-300 border-gray-600' : 'bg-gray-100 text-gray-700 border-gray-300';
  const needsCandidates = (job: JobPostingWithCount) => job.is_active && job.applicant_count === 0;
  const clearFilters = () => {
    setQuery('');
    setStatusFilter('all');
    setShowAllActive(false);
  };
  const requestJobStatusChange = (job: JobPostingWithCount, isActive: boolean) => {
    if (statusSavingId) return;
    setStatusConfirm({ job, isActive });
  };
  const closeStatusConfirm = () => {
    if (!statusSavingId) setStatusConfirm(null);
  };
  const confirmJobStatusChange = async () => {
    if (!statusConfirm || statusSavingId) return;
    const { job, isActive } = statusConfirm;
    setStatusSavingId(job.id);
    try {
      await onSetJobActive(job, isActive);
      setStatusConfirm(null);
    } finally {
      setStatusSavingId(null);
    }
  };
  const getNextAction = (job: JobPostingWithCount) => {
    if (!job.is_active) {
      return {
        label: t('portal_listings_action_edit_closed'),
        description: t('portal_listings_next_closed'),
        Icon: Edit,
        onClick: () => onEditJob(job),
        primary: false,
      };
    }

    if (job.applicant_count > 0) {
      return {
        label: t('portal_listings_action_review'),
        description: t('portal_listings_next_review').replace('{n}', String(job.applicant_count)),
        Icon: MessageSquare,
        onClick: () => onViewApplicants(job),
        primary: true,
      };
    }

    return {
      label: t('portal_listings_action_source'),
      description: t('portal_listings_next_source'),
      Icon: Search,
      onClick: () => onSourceCandidates(job),
      primary: true,
    };
  };

  const JobRow: React.FC<{ job: JobPostingWithCount }> = ({ job }) => {
    const nextAction = getNextAction(job);
    const NextActionIcon = nextAction.Icon;

    return (
      <article
        className={`animate-panel-expand rounded-xl border p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md sm:p-5 ${
          dm ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
        }`}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`px-3 py-1 rounded-full text-xs font-medium border text-center ${statusStyle(job)}`}>
                {statusLabel(job)}
              </span>
              {needsCandidates(job) && (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-200">
                  {t('portal_listings_needs_candidates')}
                </span>
              )}
            </div>

            <button type="button"
              onClick={() => onViewApplicants(job)}
              aria-label={t('portal_listings_view_applicants_aria').replace('{title}', job.title)}
              className={`mt-3 text-left text-lg font-semibold leading-tight transition-colors hover:text-[#1d4ed8] sm:text-xl ${dm ? 'text-white' : 'text-gray-900'}`}
            >
              {job.title}
            </button>
            <div className={`mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm ${dm ? 'text-gray-400' : 'text-gray-600'}`}>
              <span className="flex items-center gap-1">
                <MapPin className="w-4 h-4" />
                {job.location || t('talent_location_remote')}
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="w-4 h-4" />
                {t('employer_dashboard_posted_on')} {new Date(job.created_at).toLocaleDateString()}
              </span>
            </div>
            <p className={`mt-3 max-w-2xl text-sm leading-6 ${dm ? 'text-gray-400' : 'text-gray-600'}`}>
              {nextAction.description}
            </p>
          </div>

          <div className="flex w-full flex-col gap-3 lg:w-[280px]">
            <button type="button"
              onClick={() => onViewApplicants(job)}
              aria-label={t('portal_listings_view_applicants_aria').replace('{title}', job.title)}
              className={`group rounded-lg border px-4 py-3 text-left transition-colors ${
                dm ? 'border-gray-700 bg-gray-900/30 hover:bg-gray-700' : 'border-gray-100 bg-gray-50 hover:bg-blue-50/50'
              }`}
            >
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className={`text-3xl font-semibold leading-none ${dm ? 'text-white' : 'text-gray-900'}`}>
                    {job.applicant_count}
                  </div>
                  <div className={`mt-1 text-sm ${dm ? 'text-gray-400' : 'text-gray-600'} group-hover:text-[#1d4ed8] transition-colors`}>
                    {t('employer_dashboard_applicants_label')}
                  </div>
                </div>
                <Users className="h-5 w-5 text-[#1d4ed8]" />
              </div>
            </button>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-1">
              <button
                type="button"
                onClick={nextAction.onClick}
                className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-blue-400/40 ${
                  nextAction.primary
                    ? 'bg-[#1d4ed8] text-white shadow-sm shadow-blue-600/20 hover:bg-[#1a45c9]'
                    : dm
                      ? 'border border-gray-600 text-gray-200 hover:bg-gray-700'
                      : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <NextActionIcon className="h-4 w-4" />
                {nextAction.label}
                {nextAction.primary && <ArrowRight className="h-4 w-4" />}
              </button>
              <button type="button"
                onClick={() => onEditJob(job)}
                aria-label={t('portal_listings_edit_aria').replace('{title}', job.title)}
                className={`inline-flex min-h-10 items-center justify-center gap-1.5 px-3 py-2 text-sm border rounded-lg transition-colors ${
                  dm ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Edit className="w-4 h-4" />
                {t('employer_dashboard_edit_button')}
              </button>
              <button type="button"
                onClick={() => requestJobStatusChange(job, !job.is_active)}
                disabled={statusSavingId === job.id}
                aria-label={job.is_active ? t('portal_listings_close_job') : t('portal_listings_reopen_job')}
                className={`inline-flex min-h-10 items-center justify-center gap-1.5 px-3 py-2 text-sm border rounded-lg transition-colors ${
                  job.is_active
                    ? (dm ? 'border-red-700 text-red-300 hover:bg-red-900/20' : 'border-red-200 text-red-600 hover:bg-red-50')
                    : (dm ? 'border-green-700 text-green-300 hover:bg-green-900/20' : 'border-green-300 text-green-700 hover:bg-green-50')
                }`}
              >
                {statusSavingId === job.id
                  ? t('portal_billing_updating')
                  : job.is_active
                    ? t('portal_listings_close_job')
                    : t('portal_listings_reopen_job')}
              </button>
            </div>
          </div>
        </div>
      </article>
    );
  };

  return (
    <>
      <PortalTopBar title={t('portal_nav_job_listings')} darkMode={dm} />
      <div className="max-w-[1088px] mx-auto p-4 sm:p-6 lg:p-8 animate-view-fade">

        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className={`text-2xl font-semibold tracking-tight ${dm ? 'text-white' : 'text-gray-900'}`}>
              {t('portal_listings_page_title')}
            </h1>
            <p className={`mt-1 max-w-2xl text-sm leading-6 ${dm ? 'text-gray-400' : 'text-gray-500'}`}>
              {t('portal_listings_page_desc')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('post-job')}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#1d4ed8] px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 transition-colors hover:bg-[#1a45c9] focus:outline-none focus:ring-2 focus:ring-blue-400/40"
          >
            <Briefcase className="h-4 w-4" />
            {t('portal_listings_post_job_cta')}
          </button>
        </div>

        {loading && (
          <div role="status" aria-live="polite" className="space-y-4">
            <p className={dm ? 'text-gray-400' : 'text-gray-500'}>{t('portal_loading_data')}</p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {[0, 1, 2, 3, 4, 5].map((item) => (
                <div key={item} className={`h-[92px] rounded-xl border p-4 ${dm ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'}`}>
                  <div className={`h-5 w-12 rounded-full ${dm ? 'bg-gray-700' : 'bg-gray-200'}`} />
                  <div className={`mt-4 h-3 w-3/4 rounded-full ${dm ? 'bg-gray-700' : 'bg-gray-200'}`} />
                </div>
              ))}
            </div>
            <div className={`h-32 rounded-xl border ${dm ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'}`} />
          </div>
        )}
        {error && !loading && (
          <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Stats — all derived from existing job/application data, no placeholder pipeline counts. */}
        {!loading && (
          <div className="mb-8">
            <h2 className={`text-base font-semibold mb-3 ${dm ? 'text-white' : 'text-gray-900'}`}>{t('portal_listings_quick_stats')}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <StatCard title={t('portal_kpi_active_posts')} value={kpiData.activeJobs} Icon={Briefcase} darkMode={dm} />
              <StatCard title={t('kpi_total_applicants')} value={kpiData.totalApplicants} Icon={Users} darkMode={dm} />
              <StatCard title={t('portal_kpi_new_applicants_7d')} value={kpiData.newApplicants} Icon={TrendingUp} darkMode={dm} />
              <StatCard title={t('portal_listings_with_applicants')} value={activeWithApplicants} Icon={UserCheck} darkMode={dm} />
              <StatCard title={t('portal_listings_quiet_posts')} value={quietActiveJobs} Icon={AlertCircle} darkMode={dm} />
              <StatCard title={t('portal_listings_avg_applicants')} value={avgApplicants} Icon={ThumbsUp} darkMode={dm} />
            </div>
          </div>
        )}

        {!loading && (
          <div className={`mb-6 rounded-xl border p-4 ${dm ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <label className="relative flex-1">
                <span className="sr-only">{t('portal_listings_search_label')}</span>
                <Search className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${dm ? 'text-gray-500' : 'text-gray-400'}`} />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('portal_listings_search_placeholder')}
                  className={`w-full rounded-lg border py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-[#1d4ed8] focus:ring-2 focus:ring-blue-100 ${
                    dm
                      ? 'border-gray-600 bg-gray-700 text-white placeholder:text-gray-500 focus:ring-blue-900/40'
                      : 'border-gray-300 bg-white text-gray-900 placeholder:text-gray-400'
                  }`}
                />
              </label>
              <div className={`grid grid-cols-3 rounded-lg p-1 ${dm ? 'bg-gray-700' : 'bg-gray-100'}`} role="group" aria-label={t('portal_listings_filter_label')}>
                {([
                  ['all', t('portal_listings_filter_all')],
                  ['active', t('portal_listings_filter_active')],
                  ['closed', t('portal_listings_filter_closed')],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setStatusFilter(key);
                      setShowAllActive(false);
                    }}
                    aria-pressed={statusFilter === key}
                    className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                      statusFilter === key
                        ? 'bg-white text-[#1d4ed8] shadow-sm dark:bg-gray-900 dark:text-blue-300'
                        : dm
                        ? 'text-gray-300 hover:text-white'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className={`text-xs ${dm ? 'text-gray-500' : 'text-gray-500'}`}>
                {t('portal_listings_filter_result').replace('{n}', String(filteredJobs.length))}
              </p>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className={`inline-flex w-fit items-center justify-center rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    dm ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {t('portal_listings_clear_filters')}
                </button>
              )}
            </div>
          </div>
        )}

        {!loading && filteredJobs.length === 0 && (
          <div className={`rounded-xl border p-10 text-center ${dm ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
            <p className={`text-base font-semibold ${dm ? 'text-white' : 'text-gray-900'}`}>{t('portal_listings_no_results_title')}</p>
            <p className={`mt-2 text-sm ${dm ? 'text-gray-400' : 'text-gray-500'}`}>{t('portal_listings_no_results_desc')}</p>
            <button
              type="button"
              onClick={clearFilters}
              className={`mt-4 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                dm ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {t('portal_listings_clear_filters')}
            </button>
          </div>
        )}

        {/* Active listings */}
        {!loading && filteredJobs.length > 0 && !showingClosedOnly && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className={`text-base font-semibold ${dm ? 'text-white' : 'text-gray-900'}`}>
                {t('portal_listings_active_recent')}
              </h2>
              <span className={`text-sm ${dm ? 'text-gray-400' : 'text-gray-600'}`}>
                {t('portal_listings_count_label').replace('{n}', String(filteredActiveJobs.length))}
              </span>
            </div>

            {filteredActiveJobs.length === 0 ? (
              <div className={`rounded-xl border p-10 text-center ${dm ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                <p className={`text-base font-semibold ${dm ? 'text-white' : 'text-gray-900'}`}>{t('portal_listings_no_active')}</p>
                <p className={`mx-auto mt-2 max-w-sm text-sm ${dm ? 'text-gray-400' : 'text-gray-500'}`}>{t('portal_listings_no_active_desc')}</p>
                <button type="button"
                  onClick={() => onNavigate('post-job')}
                  className="mt-5 px-5 py-2 bg-[#1d4ed8] text-white rounded-lg text-sm font-medium hover:bg-[#1a45c9] transition-colors"
                >
                  {t('portal_nav_post_job')}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {displayedActive.map((job) => <JobRow key={job.id} job={job} />)}
              </div>
            )}

            {filteredActiveJobs.length > 5 && (
              <button type="button"
                onClick={() => setShowAllActive(!showAllActive)}
                className={`mt-4 w-full flex items-center justify-center gap-2 py-2 text-sm font-medium transition-colors ${
                  dm ? 'text-gray-400 hover:text-gray-200' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {showAllActive ? t('portal_listings_show_less') : t('portal_listings_show_more').replace('{n}', String(filteredActiveJobs.length - 5))}
                {showAllActive ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            )}
          </div>
        )}

        {/* Closed/expired — collapsible */}
        {!loading && filteredClosedJobs.length > 0 && (
          <div className="mt-8">
            <button
              type="button"
              onClick={() => {
                if (!showingClosedOnly) {
                  setShowExpired(!showExpired);
                }
              }}
              aria-expanded={showClosedListings}
              className={`w-full flex items-center justify-between p-4 border rounded-xl transition-colors ${
                dm ? 'bg-gray-800 border-gray-700 hover:bg-gray-700' : 'bg-white border-gray-200 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center gap-3">
                <h2 className={`text-base font-semibold ${dm ? 'text-white' : 'text-gray-900'}`}>
                  {t('portal_listings_expired')}
                </h2>
                <span className={`text-sm ${dm ? 'text-gray-400' : 'text-gray-600'}`}>({filteredClosedJobs.length})</span>
              </div>
              {showClosedListings
                ? <ChevronUp className={`w-5 h-5 ${dm ? 'text-gray-400' : 'text-gray-600'}`} />
                : <ChevronDown className={`w-5 h-5 ${dm ? 'text-gray-400' : 'text-gray-600'}`} />}
            </button>

            {showClosedListings && (
              <div className="mt-4 space-y-4 animate-panel-expand">
                {filteredClosedJobs.map((job) => <JobRow key={job.id} job={job} />)}
              </div>
            )}
          </div>
        )}
      </div>
      <ConfirmActionDialog
        open={Boolean(statusConfirm)}
        title={statusConfirm?.isActive ? t('portal_listings_reopen_job') : t('portal_listings_close_job')}
        description={statusConfirm?.isActive
          ? `${t('portal_listings_reopen_job')} "${statusConfirm.job.title}"?`
          : t('portal_listings_close_confirm').replace('{title}', statusConfirm?.job.title ?? '')}
        detail={statusConfirm?.job.title}
        cancelLabel={t('dashboard_cancel_update')}
        confirmLabel={statusConfirm?.isActive ? t('portal_listings_reopen_job') : t('portal_listings_close_job')}
        loadingLabel={t('portal_billing_updating')}
        loading={Boolean(statusSavingId)}
        tone={statusConfirm?.isActive ? 'primary' : 'danger'}
        onOpenChange={(open) => {
          if (!open) closeStatusConfirm();
        }}
        onCancel={closeStatusConfirm}
        onConfirm={confirmJobStatusChange}
      />
    </>
  );
}
