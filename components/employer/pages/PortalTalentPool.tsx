import React from 'react';
import type { UserProfile } from '../../../types';
import TalentDiscovery from '../../TalentDiscovery';
import { PortalTopBar } from '../PortalTopBar';
import type { JobPostingWithCount } from '../../../lib/recruitingData';

interface PortalTalentPoolProps {
  profile: UserProfile;
  darkMode: boolean;
  onPostJob: () => void;
  onOpenShortlist: () => void;
  navigateToBusinessPricing: () => void;
  jobPostings: JobPostingWithCount[];
  jobsLoading: boolean;
  jobsError: string | null;
  onRetryJobs: () => void;
  initialJobId?: string | null;
  t: (key: string) => string;
}

// Reuses TalentDiscovery which fetches Firebase candidate profiles and runs matching.
export function PortalTalentPool({
  profile,
  darkMode,
  onPostJob,
  onOpenShortlist,
  navigateToBusinessPricing,
  jobPostings,
  jobsLoading,
  jobsError,
  onRetryJobs,
  initialJobId = null,
  t,
}: PortalTalentPoolProps) {
  return (
    <>
      <PortalTopBar title={t('portal_nav_discover')} darkMode={darkMode} />
      <div className={`max-w-[1088px] mx-auto p-4 sm:p-6 lg:p-8 animate-view-fade ${darkMode ? 'text-white' : ''}`}>
        <TalentDiscovery
          t={t}
          profile={profile}
          onPostJob={onPostJob}
          onOpenShortlist={onOpenShortlist}
          navigateToBusinessPricing={navigateToBusinessPricing}
          postedJobs={jobPostings}
          postedJobsLoading={jobsLoading}
          postedJobsError={jobsError}
          onRetryPostedJobs={onRetryJobs}
          initialSelectedJobId={initialJobId}
        />
      </div>
    </>
  );
}
