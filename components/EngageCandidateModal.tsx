import React, { useState } from 'react';
import { Link2, X } from 'lucide-react';
import type { UserProfile } from '../types';
import ResumePreview from './ResumePreview';
import OutreachModal from './OutreachModal';
import { ViewportAwareDialog } from './ViewportAwareDialog';
import { getSepoliaAddressUrl, normalizeWalletAddressForDisplay } from '../lib/web3Links';

interface MatchedCandidate extends UserProfile {
    compatibilityScore: number;
    summary: string;
}

interface EngageCandidateModalProps {
    candidate: MatchedCandidate & { index: number };
    jobDescription: string;
    employerProfile: UserProfile;
    onClose: () => void;
    t: (key: string) => string;
}

const EngageCandidateModal: React.FC<EngageCandidateModalProps> = ({ candidate, jobDescription, employerProfile, onClose, t }) => {
    const [isOutreachModalOpen, setIsOutreachModalOpen] = useState(false);
    const walletAddress = normalizeWalletAddressForDisplay(candidate.wallet_address);
    const walletUrl = getSepoliaAddressUrl(walletAddress);

    return (
        <ViewportAwareDialog
            open
            onClose={onClose}
            closeOnBackdrop={!isOutreachModalOpen}
            closeOnEscape={!isOutreachModalOpen}
            labelledBy="engage-candidate-title"
            maxWidth={768}
            zIndex={60}
        >
            <div className="flex min-h-[420px] flex-col rounded-xl bg-white shadow-2xl dark:bg-slate-800">
                <div className="flex-shrink-0 flex items-center justify-between p-4 border-b dark:border-slate-700">
                    <h3 id="engage-candidate-title" className="text-xl font-bold text-gray-800 dark:text-gray-100">
                        {t('engage_candidate_title').replace('{n}', String(candidate.index + 1))}
                    </h3>
                    <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full p-1 focus:outline-none focus:ring-2 focus:ring-blue-400/40" aria-label={t('engage_close_aria')}>
                        <X className="h-6 w-6" aria-hidden="true" />
                    </button>
                </div>
                <div className="flex-grow overflow-y-auto p-6 space-y-6">
                    <div className="text-center p-4 bg-gray-50 dark:bg-slate-700 rounded-lg border dark:border-slate-600">
                        <p className="text-4xl font-extrabold text-green-600">{candidate.compatibilityScore}%</p>
                        <p className="text-sm font-semibold text-gray-600 dark:text-gray-400">{t('engage_match_score')}</p>
                        <p className="text-gray-700 dark:text-gray-300 mt-3">{candidate.summary}</p>
                    </div>
                     {walletAddress && walletUrl && (
                        <div>
                            <h4 className="font-bold text-lg text-gray-800 dark:text-gray-100 mb-2">{t('engage_web3_title')}</h4>
                            <div className="p-3 bg-gray-50 dark:bg-slate-700 rounded-lg border dark:border-slate-600 flex items-center gap-3">
                                <Link2 className="h-6 w-6 text-blue-600 flex-shrink-0" aria-hidden="true" />
                                <div>
                                    <p className="text-xs text-gray-500">{t('engage_wallet_address')}</p>
                                    <a href={walletUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-sm text-blue-600 hover:underline break-all">
                                        {walletAddress}
                                    </a>
                                </div>
                            </div>
                        </div>
                    )}
                    {candidate.resume_text ? (
                        <div>
                            <h4 className="font-bold text-lg text-gray-800 dark:text-gray-100 mb-2">{t('engage_resume_title')}</h4>
                            <div className="h-[40vh]">
                                <ResumePreview resumeText={candidate.resume_text} market="" t={t} />
                            </div>
                        </div>
                    ) : (
                        // The full resume stays private by design (other profiles are
                        // not client-readable). Explain that instead of showing an empty
                        // "resume unavailable" panel that looks broken after engaging.
                        <div className="rounded-lg border border-dashed border-gray-300 dark:border-slate-600 p-4 text-center">
                            <h4 className="font-semibold text-gray-800 dark:text-gray-100 mb-1">{t('engage_resume_title')}</h4>
                            <p className="text-sm text-gray-500 dark:text-gray-400">{t('engage_resume_private_note')}</p>
                        </div>
                    )}
                </div>
                <div className="flex-shrink-0 flex justify-between items-center p-4 border-t dark:border-slate-700 bg-gray-50 dark:bg-slate-900/40 rounded-b-xl">
                    <p className="text-xs text-gray-500 dark:text-gray-400">{t('engage_privacy_note')}</p>
                    <button type="button"
                        onClick={() => setIsOutreachModalOpen(true)}
                        className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700"
                    >
                        {t('engage_draft_outreach_button')}
                    </button>
                </div>
            </div>
            {isOutreachModalOpen && (
                <OutreachModal
                    candidate={candidate}
                    jobDescription={jobDescription}
                    employerProfile={employerProfile}
                    onClose={() => setIsOutreachModalOpen(false)}
                    t={t}
                />
            )}
        </ViewportAwareDialog>
    );
};

export default EngageCandidateModal;
