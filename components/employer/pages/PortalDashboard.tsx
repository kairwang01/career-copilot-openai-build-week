import React from 'react';
import {
  BarChart2,
  BookmarkCheck,
  Briefcase,
  Building2,
  ChevronRight,
  Plus,
  Search,
  TrendingUp,
  User,
  Users,
} from 'lucide-react';
import { PortalTopBar } from '../PortalTopBar';
import type { JobPostingWithCount } from '../../../lib/recruitingData';
import type { PortalPage } from '../PortalSidebar';

interface KpiData {
  activeJobs: number;
  totalApplicants: number;
  newApplicants: number;
  avgMatchScore: number;
}

interface ActionQueue {
  newThisWeek: number;
  topNewJobs: { id: string; title: string; newCount: number }[];
}

interface PortalDashboardProps {
  jobPostings: JobPostingWithCount[];
  kpiData: KpiData;
  actionQueue?: ActionQueue;
  loading: boolean;
  error: string | null;
  darkMode: boolean;
  onNavigate: (page: PortalPage) => void;
  onViewApplicants?: (job: JobPostingWithCount) => void;
  companyName: string;
  t: (key: string) => string;
}

const formatTranslation = (
  template: string,
  values: Record<string, string | number>,
) =>
  Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{${key}}`, String(value)),
    template,
  );

function KpiCard({
  title,
  value,
  Icon,
  darkMode,
  loading = false,
}: {
  title: string;
  value: string;
  Icon: React.ElementType;
  darkMode: boolean;
  loading?: boolean;
}) {
  return (
    <div
      className={`flex min-h-[112px] items-center gap-4 rounded-xl border p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md sm:p-5 ${
        darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
      }`}
    >
      <div className={`rounded-lg p-3 ${darkMode ? 'bg-gray-700' : 'bg-blue-50'}`}>
        <Icon className="w-6 h-6 text-[#1d4ed8]" />
      </div>
      <div className="min-w-0">
        <p className={`text-2xl font-bold leading-tight ${darkMode ? 'text-white' : 'text-gray-900'} ${loading ? 'animate-pulse' : ''}`}>
          {loading ? '—' : value}
        </p>
        <p className={`text-sm leading-5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{title}</p>
      </div>
    </div>
  );
}

export function PortalDashboard({
  jobPostings,
  kpiData,
  actionQueue,
  loading,
  error,
  darkMode,
  onNavigate,
  onViewApplicants,
  companyName,
  t,
}: PortalDashboardProps) {
  const dm = darkMode;
  const { activeJobs, totalApplicants, newApplicants, avgMatchScore } = kpiData;
  const hasCompanyProfile = companyName.trim().length > 0;

  const priorityActions = [
    activeJobs === 0
      ? {
          msg: t('portal_priority_publish_first'),
          page: 'post-job' as PortalPage,
          action: t('portal_action_start_posting'),
          Icon: Plus,
        }
      : newApplicants > 0
        ? {
            msg: formatTranslation(t('portal_priority_review_new'), { count: newApplicants }),
            page: 'job-listings' as PortalPage,
            action: t('portal_action_review_now'),
            Icon: Users,
          }
        : totalApplicants > 0
          ? {
              msg: t('portal_priority_screen_candidates'),
              page: 'job-listings' as PortalPage,
              action: t('portal_action_review_now'),
              Icon: BarChart2,
            }
          : {
              msg: t('portal_priority_source_candidates'),
              page: 'talent-pool' as PortalPage,
              action: t('portal_action_open_discover'),
              Icon: Search,
            },
    !hasCompanyProfile && {
      msg: t('portal_action_complete_profile'),
      page: 'company-profile' as PortalPage,
      action: t('portal_action_go_to_profile'),
      Icon: User,
    },
  ].filter(Boolean) as {
    msg: string;
    page: PortalPage;
    action: string;
    Icon: React.ElementType;
  }[];

  // Next up — the single highest-priority Action-Required item, shown large.
  const nextUp = priorityActions[0];

  const quickActions = [
    {
      page: 'post-job' as PortalPage,
      title: t('portal_nav_post_job'),
      Icon: Plus,
      primary: true,
    },
    {
      page: 'job-listings' as PortalPage,
      title: t('portal_dashboard_view_applicants'),
      Icon: Users,
    },
    {
      page: 'talent-pool' as PortalPage,
      title: t('portal_nav_discover'),
      Icon: Briefcase,
    },
    {
      page: 'shortlist' as PortalPage,
      title: t('portal_nav_shortlist'),
      Icon: BookmarkCheck,
    },
    {
      page: 'agency-hub' as PortalPage,
      title: t('portal_nav_agency_hub'),
      Icon: Building2,
    },
    {
      page: 'company-profile' as PortalPage,
      title: t('portal_nav_org_profile'),
      Icon: User,
    },
  ];

  return (
    <>
      <PortalTopBar title={t('portal_nav_dashboard')} darkMode={dm} />
      <div className="mx-auto max-w-[1088px] p-4 animate-view-fade sm:p-6 lg:p-8">
        <div className="mb-8">
          <p className={`text-lg font-medium ${dm ? 'text-white' : 'text-gray-900'}`}>
            {companyName
              ? t('portal_dashboard_welcome_named').replace('{name}', companyName)
              : t('portal_dashboard_welcome')}
          </p>
          <p className={dm ? 'text-gray-400' : 'text-gray-500'}>
            {t('portal_dashboard_subtitle')}
          </p>
        </div>

        {/* Action queue — "what to handle today" so the recruiter doesn't hunt across
            tools. Deep-links each hot job straight to its pipeline. */}
        {!loading && !error && actionQueue && (
          <div className="mb-8 rounded-xl border border-blue-100 bg-blue-50/60 p-4 dark:border-blue-900/50 dark:bg-blue-950/30">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <BookmarkCheck className="h-5 w-5 text-blue-600 dark:text-blue-300" aria-hidden="true" />
                <h2 className={`text-sm font-semibold ${dm ? 'text-blue-100' : 'text-blue-900'}`}>
                  {t('portal_action_queue_title')}
                </h2>
              </div>
              {actionQueue.newThisWeek > 0 && (
                <button
                  type="button"
                  onClick={() => onNavigate('job-listings')}
                  className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white transition hover:bg-blue-700"
                >
                  {t('portal_action_queue_review_cta')}
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>
            {actionQueue.newThisWeek > 0 ? (
              <>
                <p className={`mt-1 text-sm ${dm ? 'text-blue-200' : 'text-blue-900'}`}>
                  {t('portal_action_queue_summary').replace('{count}', String(actionQueue.newThisWeek))}
                </p>
                {actionQueue.topNewJobs.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {actionQueue.topNewJobs.map((j) => {
                      const job = jobPostings.find((p) => p.id === j.id);
                      const clickable = !!job && !!onViewApplicants;
                      return (
                        <button
                          key={j.id}
                          type="button"
                          disabled={!clickable}
                          onClick={() => { if (job && onViewApplicants) onViewApplicants(job); }}
                          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${dm ? 'border-blue-800 bg-blue-950 text-blue-200 hover:bg-blue-900' : 'border-blue-200 bg-white text-blue-800 hover:bg-blue-100'} disabled:cursor-default disabled:opacity-60`}
                        >
                          <span className="max-w-[180px] truncate">{j.title}</span>
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${dm ? 'bg-blue-800 text-blue-100' : 'bg-blue-600 text-white'}`}>
                            {t('portal_action_queue_new_badge').replace('{count}', String(j.newCount))}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <p className={`mt-1 text-sm ${dm ? 'text-blue-200' : 'text-blue-800'}`}>
                {t('portal_action_queue_caught_up')}
              </p>
            )}
          </div>
        )}

        {/* KPIs — real data from EmployerDashboard.fetchDashboardData */}
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
          <KpiCard title={t('portal_kpi_active_posts')} value={activeJobs.toString()} Icon={Briefcase} darkMode={dm} loading={loading} />
          <KpiCard title={t('kpi_total_applicants')} value={totalApplicants.toString()} Icon={Users} darkMode={dm} loading={loading} />
          <KpiCard title={t('portal_kpi_new_applicants_7d')} value={newApplicants.toString()} Icon={TrendingUp} darkMode={dm} loading={loading} />
          <div
            className={`flex min-h-[112px] items-center gap-4 rounded-xl border p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md sm:p-5 ${
              dm ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
            }`}
          >
            <div className={`rounded-lg p-3 ${dm ? 'bg-gray-700' : 'bg-blue-50'}`}>
              <BarChart2 className="w-6 h-6 text-[#1d4ed8]" />
            </div>
            <div>
              <p className={`text-2xl font-bold ${dm ? 'text-white' : 'text-gray-900'} ${loading ? 'animate-pulse' : ''}`}>
                {loading ? '—' : avgMatchScore > 0 ? `${avgMatchScore}%` : '—'}
              </p>
              <p className={`text-sm ${dm ? 'text-gray-400' : 'text-gray-500'}`}>{t('kpi_avg_match_score')}</p>
              {!loading && avgMatchScore === 0 && (
                <p className={`text-xs mt-0.5 ${dm ? 'text-gray-500' : 'text-gray-400'}`}>{t('portal_kpi_no_scored')}</p>
              )}
            </div>
          </div>
        </div>

        {/* Next up — single highest-priority Action-Required item, shown large */}
        {nextUp && (
          <div
            className={`mb-8 flex flex-col gap-4 rounded-xl border p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6 ${
              dm ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
            }`}
          >
            <div className="flex min-w-0 items-start gap-4">
              <span className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${dm ? 'bg-gray-700 text-blue-300' : 'bg-blue-50 text-[#1d4ed8]'}`}>
                <nextUp.Icon className="h-6 w-6" />
              </span>
              <div className="min-w-0">
                <p className={`text-xs font-semibold uppercase tracking-wide ${dm ? 'text-gray-400' : 'text-gray-500'}`}>
                  {t('portal_dashboard_next_up')}
                </p>
                <p className={`mt-1 text-lg font-semibold leading-snug ${dm ? 'text-white' : 'text-gray-900'}`}>{nextUp.msg}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate(nextUp.page)}
              className="inline-flex min-h-11 w-full flex-shrink-0 items-center justify-center gap-1 rounded-lg bg-[#1d4ed8] px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 transition-colors hover:bg-[#1a45c9] focus:outline-none focus:ring-2 focus:ring-blue-400/40 sm:w-auto"
            >
              {nextUp.action}
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Quick actions — compact icon + label row */}
        <div className={`mb-8 rounded-xl border p-4 sm:p-6 ${dm ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
          <h2 className={`text-base font-semibold mb-4 ${dm ? 'text-white' : 'text-gray-900'}`}>{t('portal_dashboard_quick_actions')}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {quickActions.map(({ page, title, Icon, primary }) => (
              <button
                key={page}
                type="button"
                onClick={() => onNavigate(page)}
                aria-label={title}
                className={`group flex flex-col items-center justify-center gap-2 rounded-xl border p-3 text-center transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-400/40 ${
                  primary
                    ? 'border-blue-600 bg-[#1d4ed8] text-white shadow-sm shadow-blue-600/20 hover:bg-[#1a45c9]'
                    : dm
                    ? 'border-gray-700 bg-gray-900/30 text-gray-200 hover:border-gray-600 hover:bg-gray-700/60'
                    : 'border-gray-200 bg-white text-gray-900 hover:border-blue-200 hover:bg-blue-50/40'
                }`}
              >
                <span
                  className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${
                    primary ? 'bg-white/15' : dm ? 'bg-gray-700' : 'bg-blue-50'
                  }`}
                >
                  <Icon className={`h-5 w-5 ${primary ? 'text-white' : 'text-[#1d4ed8]'}`} />
                </span>
                <span className="block text-xs font-semibold leading-snug">{title}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Job Overview — derived from live jobPostings */}
        <div className="mb-8">
          <div className={`rounded-xl border p-4 sm:p-6 ${dm ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
            <h2 className={`text-lg font-semibold mb-4 ${dm ? 'text-white' : 'text-gray-900'}`}>{t('portal_dashboard_job_overview')}</h2>
            {jobPostings.length === 0 ? (
              <p className={`text-sm ${dm ? 'text-gray-400' : 'text-gray-500'}`}>{t('portal_dashboard_no_postings')}</p>
            ) : (() => {
              const active = jobPostings.filter((j) => j.is_active);
              const topPerformer = [...active].sort((a, b) => b.applicant_count - a.applicant_count)[0];
              const lowActivity = [...active].sort((a, b) => a.applicant_count - b.applicant_count)[0];
              const expiringSoon = [...active].sort(
                (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
              )[0];
              const applicantsLabel = (n: number) =>
                `${n} ${t('employer_dashboard_applicants_label')}`;
              const highlights = [
                topPerformer && {
                  category: t('portal_overview_top_performing'),
                  jobTitle: topPerformer.title,
                  metric: applicantsLabel(topPerformer.applicant_count),
                },
                lowActivity && lowActivity.id !== topPerformer?.id && {
                  category: t('portal_overview_low_activity'),
                  jobTitle: lowActivity.title,
                  metric: applicantsLabel(lowActivity.applicant_count),
                },
                expiringSoon && {
                  category: t('portal_overview_oldest_posting'),
                  jobTitle: expiringSoon.title,
                  metric: `${t('employer_dashboard_posted_on')} ${new Date(expiringSoon.created_at).toLocaleDateString()}`,
                },
              ].filter(Boolean) as { category: string; jobTitle: string; metric: string }[];
              return (
                <div className="space-y-4">
                  {highlights.map((h, i) => (
                    <div key={i} className={`border rounded-lg p-4 ${dm ? 'border-gray-700' : 'border-gray-200'}`}>
                      <div className={`text-xs font-medium mb-2 ${dm ? 'text-gray-400' : 'text-gray-600'}`}>{h.category}</div>
                      <div className={`font-semibold mb-1 ${dm ? 'text-white' : 'text-gray-900'}`}>{h.jobTitle}</div>
                      <div className={`text-sm ${dm ? 'text-gray-400' : 'text-gray-600'}`}>{h.metric}</div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Recent job postings — real data */}
        <div className={`rounded-xl border p-4 sm:p-6 ${dm ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
          <h2 className={`text-base font-semibold mb-4 ${dm ? 'text-white' : 'text-gray-900'}`}>
            {t('portal_dashboard_recent_postings')}
          </h2>

          {loading && (
            <div role="status" aria-live="polite" className="space-y-3">
              <p className={dm ? 'text-gray-400' : 'text-gray-500'}>{t('portal_loading_data')}</p>
              {[0, 1, 2].map((item) => (
                <div
                  key={item}
                  className={`h-16 rounded-lg border p-4 ${dm ? 'border-gray-700 bg-gray-900/40' : 'border-gray-100 bg-gray-50'}`}
                >
                  <div className={`h-3 w-1/3 rounded-full ${dm ? 'bg-gray-700' : 'bg-gray-200'}`} />
                  <div className={`mt-3 h-2 w-1/2 rounded-full ${dm ? 'bg-gray-700' : 'bg-gray-200'}`} />
                </div>
              ))}
            </div>
          )}

          {error && !loading && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
              {error}
            </div>
          )}

          {!loading && !error && jobPostings.length === 0 && (
            <div className="text-center py-10">
              <p className={`text-sm mb-4 ${dm ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('portal_dashboard_no_postings')}
              </p>
              <button type="button"
                onClick={() => onNavigate('post-job')}
                className="px-5 py-2 bg-[#1d4ed8] text-white rounded-lg text-sm font-medium hover:bg-[#1a45c9] transition-colors"
              >
                {t('employer_dashboard_post_first_job_button')}
              </button>
            </div>
          )}

          {!loading && !error && jobPostings.slice(0, 5).map((job) => (
            <div
              key={job.id}
              className={`flex flex-col gap-3 py-4 border-b last:border-0 sm:flex-row sm:items-center sm:justify-between ${
                dm ? 'border-gray-700' : 'border-gray-100'
              }`}
            >
              <div className="min-w-0">
                <p className={`break-words text-sm font-semibold ${dm ? 'text-white' : 'text-gray-900'}`}>{job.title}</p>
                <p className={`text-xs mt-0.5 ${dm ? 'text-gray-400' : 'text-gray-500'}`}>
                  {job.location || t('talent_location_remote')} &bull; {t('employer_dashboard_posted_on')} {new Date(job.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center justify-between gap-4 sm:justify-end">
                <div className="text-center">
                  <p className="text-xl font-bold text-[#1d4ed8]">{job.applicant_count}</p>
                  <p className={`text-xs ${dm ? 'text-gray-400' : 'text-gray-500'}`}>{t('employer_dashboard_applicants_label')}</p>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                    job.is_active
                      ? dm ? 'bg-teal-900/30 text-teal-300 border-teal-800' : 'bg-teal-50 text-teal-800 border-teal-200'
                      : dm ? 'bg-gray-700 text-gray-300 border-gray-600' : 'bg-gray-100 text-gray-600 border-gray-200'
                  }`}
                >
                  {job.is_active ? t('portal_status_active') : t('portal_status_closed')}
                </span>
              </div>
            </div>
          ))}

          {!loading && jobPostings.length > 5 && (
            <button type="button"
              onClick={() => onNavigate('job-listings')}
              className={`mt-4 text-sm font-medium text-[#1d4ed8] hover:underline`}
            >
              {t('portal_dashboard_see_all').replace('{n}', jobPostings.length.toString())}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
