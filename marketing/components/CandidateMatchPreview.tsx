import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { ScoreBar } from './ScoreBar';

interface CandidateMatchPreviewProps {
  t: (key: string) => string;
}

type ActionState = Record<string, 'idle' | 'shortlisted' | 'messaged'>;

interface RoleRequirement {
  label: string;
  required: boolean;
  met: boolean;
}

interface CandidateMatch {
  id: string;
  name: string;
  roleFit: number;
  resumeEvidence: string;
  availability: string;
  location: string;
  matchReasons: string[];
  roleRequirements: RoleRequirement[];
}

const initials = (name: string) =>
  name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2);

export const CandidateMatchPreview: React.FC<CandidateMatchPreviewProps> = ({ t }) => {
  const [actions, setActions] = useState<ActionState>({});
  const jobRoleTitle = t('site_match_demo_role_title');
  const candidateMatches: CandidateMatch[] = [
    {
      id: 'c1',
      name: 'Jordan Lee',
      roleFit: 84,
      resumeEvidence: t('site_match_demo_c1_evidence'),
      availability: t('site_match_demo_c1_availability'),
      location: t('site_match_demo_c1_location'),
      matchReasons: [
        t('site_match_demo_c1_reason_1'),
        t('site_match_demo_c1_reason_2'),
        t('site_match_demo_c1_reason_3'),
      ],
      roleRequirements: [
        { label: t('site_match_demo_req_react'), required: true, met: true },
        { label: t('site_match_demo_req_design_systems'), required: true, met: true },
        { label: t('site_match_demo_req_accessibility'), required: true, met: true },
        { label: t('site_match_demo_req_graphql'), required: false, met: false },
        { label: t('site_match_demo_req_lead'), required: false, met: true },
      ],
    },
    {
      id: 'c2',
      name: 'Samira Okonkwo',
      roleFit: 76,
      resumeEvidence: t('site_match_demo_c2_evidence'),
      availability: t('site_match_demo_c2_availability'),
      location: t('site_match_demo_c2_location'),
      matchReasons: [
        t('site_match_demo_c2_reason_1'),
        t('site_match_demo_c2_reason_2'),
      ],
      roleRequirements: [
        { label: t('site_match_demo_req_react'), required: true, met: false },
        { label: t('site_match_demo_req_design_systems'), required: true, met: false },
        { label: t('site_match_demo_req_accessibility'), required: true, met: false },
        { label: t('site_match_demo_req_graphql'), required: false, met: true },
        { label: t('site_match_demo_req_lead'), required: false, met: false },
      ],
    },
  ];

  const setAction = (id: string, state: 'shortlisted' | 'messaged') => {
    setActions((prev) => ({ ...prev, [id]: state }));
  };

  return (
    <div className="rounded-[var(--site-radius)] border border-[var(--site-border)] bg-[var(--site-surface)] overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-[var(--site-border)] bg-[var(--site-surface-muted)]">
        <div className="flex flex-wrap justify-between items-start gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('site_talent_pool_title')}</p>
            <p className="text-xs text-[var(--site-text-muted)]">{t('site_talent_pool_subtitle')}</p>
          </div>
          <span className="text-xs px-2 py-1 rounded border border-[var(--site-border)] bg-[var(--site-surface)] shrink-0">
            {candidateMatches.length} {t('site_talent_pool_matches')}
          </span>
        </div>
        <p className="text-xs text-[var(--site-text-muted)] mt-2 truncate">
          {t('site_match_role_label')}: <span className="font-medium text-[var(--site-text)]">{jobRoleTitle}</span>
        </p>
      </div>

      <div className="divide-y divide-[var(--site-border)]">
        {candidateMatches.map((c) => {
          const state = actions[c.id] ?? 'idle';
          return (
            <div key={c.id} className="p-4 sm:p-5">
              <div className="flex gap-3 sm:gap-4">
                <div className="w-10 h-10 rounded-full bg-[var(--site-surface-muted)] border border-[var(--site-border)] flex items-center justify-center text-sm font-semibold text-[var(--site-action)] shrink-0">
                  {initials(c.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-col sm:flex-row sm:justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <h4 className="font-semibold truncate">{c.name}</h4>
                      <p className="text-xs text-[var(--site-text-muted)] truncate">
                        {c.location} · {c.availability}
                      </p>
                    </div>
                    <div className="w-full sm:w-28 shrink-0">
                      <ScoreBar label={t('site_match_role_fit')} value={c.roleFit} tone="ready" />
                    </div>
                  </div>

                  {state !== 'idle' && (
                    <div
                      className={`text-xs px-2 py-1 rounded mb-3 inline-block ${
                        state === 'shortlisted'
                          ? 'bg-[var(--site-ready-bg)] text-[var(--site-ready)]'
                          : 'bg-[var(--site-surface-muted)] text-[var(--site-action)] border border-[var(--site-border)]'
                      }`}
                    >
                      {state === 'shortlisted' ? t('site_match_status_shortlisted') : t('site_match_status_messaged')}
                    </div>
                  )}

                  <p className="text-sm text-[var(--site-text-muted)] mb-3 border-l-2 border-[var(--site-border)] pl-3">
                    {c.resumeEvidence}
                  </p>

                  <div className="mb-4 overflow-x-auto">
                    <p className="text-xs font-medium text-[var(--site-text-muted)] mb-2">
                      {t('site_match_requirements_title')}
                    </p>
                    <table className="w-full text-xs min-w-[280px]">
                      <thead>
                        <tr className="text-[var(--site-text-muted)] text-left">
                          <th className="pb-1 font-medium">{t('site_match_req_col')}</th>
                          <th className="pb-1 font-medium w-16">{t('site_match_req_status')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.roleRequirements.map((req) => (
                          <tr key={req.label} className="border-t border-[var(--site-border)]">
                            <td className="py-1.5 pr-2">
                              {req.label}
                              {req.required && (
                                <span className="text-[var(--site-risk)] ml-1">*</span>
                              )}
                            </td>
                            <td className="py-1.5">
                              <span
                                className={
                                  req.met
                                    ? 'text-[var(--site-ready)] font-medium'
                                    : 'text-[var(--site-gap)]'
                                }
                              >
                                {req.met ? t('site_match_req_met') : t('site_match_req_missing')}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <ul className="text-xs space-y-1 mb-4 text-[var(--site-text-muted)]">
                    {c.matchReasons.map((reason) => (
                      <li key={reason} className="flex gap-2">
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--site-ready)]" aria-hidden="true" strokeWidth={2.5} />
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={state === 'shortlisted'}
                      onClick={() => setAction(c.id, 'shortlisted')}
                      className={`text-xs font-medium px-3 py-2 min-h-[44px] rounded-[var(--site-radius)] transition-colors ${
                        state === 'shortlisted'
                          ? 'bg-[var(--site-ready-bg)] text-[var(--site-ready)] border border-[var(--site-ready)]/30'
                          : 'bg-[var(--site-action)] text-white'
                      }`}
                    >
                      {state === 'shortlisted' ? t('site_match_status_shortlisted') : t('site_match_action_shortlist')}
                    </button>
                    <button
                      type="button"
                      disabled={state === 'messaged'}
                      onClick={() => setAction(c.id, 'messaged')}
                      className="text-xs font-medium px-3 py-2 min-h-[44px] rounded-[var(--site-radius)] border border-[var(--site-border)] text-[var(--site-text)] disabled:opacity-60"
                    >
                      {state === 'messaged' ? t('site_match_status_messaged') : t('site_match_action_message')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
