
import React, { Suspense, useState } from 'react';
import type { AppSession as Session } from '../lib/data';
import type { UserProfile } from '../types';
import { ToolResultsProvider } from '../contexts/ToolResultsContext';
import RecoverableSectionBoundary from './RecoverableSectionBoundary';

// Each tool is code-split into its own chunk (React.lazy) so the candidate
// workspace shell stays small and a tool's code is fetched only when opened,
// instead of the full tool library bloating the main CareerApp bundle.
const AgileCoach = React.lazy(() => import('./tools/AgileCoach'));
const CareerPathPlanner = React.lazy(() => import('./tools/CareerPathPlanner'));
const CoverLetterGenerator = React.lazy(() => import('./tools/CoverLetterGenerator'));
const EmailCrafter = React.lazy(() => import('./tools/EmailCrafter'));
const EnglishPro = React.lazy(() => import('./tools/EnglishPro'));
const LinkedInOptimizer = React.lazy(() => import('./tools/LinkedInOptimizer'));
const OpportunityFinder = React.lazy(() => import('./tools/OpportunityFinder'));
const PortfolioWebsiteBuilder = React.lazy(() => import('./tools/PortfolioWebsiteBuilder'));
const ResumeFormatter = React.lazy(() => import('./tools/ResumeFormatter'));
const SalaryNegotiator = React.lazy(() => import('./tools/SalaryNegotiator'));
const NetworkingAssistant = React.lazy(() => import('./tools/NetworkingAssistant'));
const PerformanceReviewPrep = React.lazy(() => import('./tools/PerformanceReviewPrep'));
const SkillLearningPlanner = React.lazy(() => import('./tools/SkillLearningPlanner'));
const IndustryEventScout = React.lazy(() => import('./tools/IndustryEventScout'));
const InterviewPrep = React.lazy(() => import('./tools/InterviewPrep'));

interface ToolRunnerProps {
  tool: string;
  resumeText: string;
  initialInput: string;
  onClose: () => void;
  openTool: (tool: string, input?: string) => void;
  market: string;
  session: Session | null;
  profile: UserProfile | null;
  refreshProfile: () => void;
  t: (key: string) => string;
}

const toolMap: { [key: string]: React.FC<any> } = {
  'resume-formatter': ResumeFormatter,
  'opportunity-finder': OpportunityFinder,
  'linkedin-optimizer': LinkedInOptimizer,
  'cover-letter': CoverLetterGenerator,
  'career-path': CareerPathPlanner,
  'agile-coach': AgileCoach,
  'salary-negotiation': SalaryNegotiator,
  'english-pro': EnglishPro,
  'email-crafter': EmailCrafter,
  'website-builder': PortfolioWebsiteBuilder,
  'networking-assistant': NetworkingAssistant,
  'performance-review-prep': PerformanceReviewPrep,
  'skill-learning-plan': SkillLearningPlanner,
  'industry-event-scout': IndustryEventScout,
  'interview-prep': InterviewPrep,
};

/** Brief fallback while a lazily-loaded tool chunk is fetched. */
export const ToolChunkFallback: React.FC<{ t: (key: string) => string }> = ({ t }) => (
  <div
    data-qa="tool-loading-state"
    className="flex min-h-[360px] items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-12 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900"
    role="status"
    aria-label={t('tool_runner_loading_title')}
  >
    <div className="w-full max-w-md">
      <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600 dark:border-slate-700 dark:border-t-blue-400" />
      <p className="mt-4 text-sm font-semibold text-slate-900 dark:text-slate-100">{t('tool_runner_loading_title')}</p>
      <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{t('tool_runner_loading_desc')}</p>
      <div className="mt-5 space-y-2" aria-hidden="true">
        <div className="mx-auto h-2.5 w-11/12 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
        <div className="mx-auto h-2.5 w-2/3 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
      </div>
    </div>
  </div>
);

const ToolRunner: React.FC<ToolRunnerProps> = ({ tool, ...props }) => {
  const ActiveTool = toolMap[tool];
  const uid = props.session?.user?.id ?? null;
  const subscriptionStatus = props.profile?.subscription_status ?? null;
  const [retryNonce, setRetryNonce] = useState(0);

  if (!ActiveTool) {
      return (
        <div data-qa="tool-runner-unavailable" className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
          <p className="font-semibold">{props.t('tool_runner_unavailable_title')}</p>
          <p className="mt-1 text-sm">{props.t('tool_runner_unavailable_desc')}</p>
          <button
            type="button"
            onClick={props.onClose}
            className="mt-4 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-800"
          >
            {props.t('tool_runner_back_to_tools')}
          </button>
        </div>
      );
  }

  return (
    <div data-qa="tool-runner" data-qa-tool={tool} className="h-full animate-fade-in">
      <RecoverableSectionBoundary
        resetKey={`${tool}:${uid ?? 'anonymous'}:${retryNonce}`}
        title={props.t('tool_runner_error_title')}
        description={props.t('tool_runner_error_desc')}
        retryLabel={props.t('tool_runner_retry')}
        onRetry={() => setRetryNonce((value) => value + 1)}
        secondaryLabel={props.t('tool_runner_back_to_tools')}
        onSecondaryAction={props.onClose}
      >
        <ToolResultsProvider
          toolKey={tool}
          uid={uid}
          subscriptionStatus={subscriptionStatus}
          loadingTitle={props.t('tool_results_loading_title')}
          loadingDescription={props.t('tool_results_loading_desc')}
        >
          <Suspense fallback={<ToolChunkFallback t={props.t} />}>
            <ActiveTool {...props} tool={tool} />
          </Suspense>
        </ToolResultsProvider>
      </RecoverableSectionBoundary>
    </div>
  );
};

export default ToolRunner;
