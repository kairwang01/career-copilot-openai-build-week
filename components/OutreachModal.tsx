import React, { useState, useEffect, useRef } from 'react';
import { generateOutreachEmail } from '../services/aiClient';
import type { ProfessionalEmailResult, UserProfile } from '../types';
import { DEFAULT_MARKET } from '../config';
import { useToast } from './Toast';
import { Loader2 } from 'lucide-react';
import { ViewportAwareDialog } from './ViewportAwareDialog';

interface MatchedCandidate extends UserProfile {
    compatibilityScore: number;
    summary: string;
}

interface OutreachModalProps {
    candidate: MatchedCandidate & { index: number };
    jobDescription: string;
    employerProfile: UserProfile;
    onClose: () => void;
    t: (key: string) => string;
}

const OutreachModal: React.FC<OutreachModalProps> = ({ candidate, jobDescription, employerProfile, onClose, t }) => {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<ProfessionalEmailResult | null>(null);
    const [editableBody, setEditableBody] = useState('');
    const [editableSubject, setEditableSubject] = useState('');
    const [copying, setCopying] = useState(false);
    const copyingRef = useRef(false);
    const { addToast } = useToast();


    useEffect(() => {
        // alive guards both unmount (close mid-generation) and candidate-switch: the
        // cleanup flips the prior run dead so its slow resolve can't paint the wrong
        // candidate's email or setState on a closed modal.
        let alive = true;
        const runTool = async () => {
            setLoading(true);
            setError(null);
            try {
                if (!candidate.resume_text) {
                    throw new Error(t('outreach_resume_unavailable'));
                }
                const apiResult = await generateOutreachEmail(candidate.resume_text, jobDescription, employerProfile, DEFAULT_MARKET);
                if (!alive) return;
                setResult(apiResult);
                setEditableBody(apiResult.body);
                setEditableSubject(apiResult.subject);
            } catch (err) {
                if (!alive) return;
                setError(err instanceof Error ? err.message : t('outreach_error_unknown'));
            } finally {
                if (alive) setLoading(false);
            }
        };
        runTool();
        return () => { alive = false; };
    }, [candidate, jobDescription, employerProfile, t]);

    const handleCopy = async () => {
        if (!result || copyingRef.current) return;
        copyingRef.current = true;
        setCopying(true);
        try {
            await navigator.clipboard.writeText(`${t('outreach_subject_copy_prefix')}: ${editableSubject}\n\n${editableBody}`);
            addToast(t('outreach_copied_toast'), 'success');
        } catch {
            addToast(t('outreach_copy_failed'), 'error');
        } finally {
            copyingRef.current = false;
            setCopying(false);
        }
    };
    
    return (
        <ViewportAwareDialog open onClose={onClose} closeOnBackdrop labelledBy="outreach-modal-title" maxWidth={672} zIndex={70}>
            <div className="flex min-h-[360px] flex-col rounded-xl bg-white shadow-2xl dark:bg-slate-800">
                <div className="p-4 border-b dark:border-slate-700">
                    <h3 id="outreach-modal-title" className="text-lg font-bold text-gray-800 dark:text-gray-100">
                        {t('outreach_modal_title').replace('{n}', String(candidate.index + 1))}
                    </h3>
                </div>
                <div className="flex-grow overflow-y-auto p-6 space-y-4">
                    {loading && (
                        <div role="status" className="flex flex-col items-center justify-center gap-3 py-12 text-center text-gray-600 dark:text-gray-300">
                            <Loader2 className="h-8 w-8 animate-spin text-blue-600 dark:text-blue-300" />
                            <p className="text-sm font-medium">{t('outreach_generating')}</p>
                        </div>
                    )}
                    {error && <div role="alert" className="text-red-600 bg-red-100 dark:bg-red-900/20 dark:text-red-400 p-4 rounded-lg">{error}</div>}
                    {result && (
                        <div className="space-y-4">
                             <div>
                                <label htmlFor="outreach-subject" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('outreach_subject_label')}</label>
                                <input type="text" id="outreach-subject" value={editableSubject} onChange={e => setEditableSubject(e.target.value)} className="mt-1 w-full bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-md shadow-sm dark:text-gray-100"/>
                             </div>
                             <div>
                                 <label htmlFor="outreach-body" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('outreach_body_label')}</label>
                                 <textarea id="outreach-body" value={editableBody} onChange={e => setEditableBody(e.target.value)} rows={15} className="mt-1 w-full border border-gray-300 dark:border-slate-600 rounded-md shadow-sm bg-white dark:bg-slate-700 dark:text-gray-100"/>
                             </div>
                        </div>
                    )}
                </div>
                <div className="p-4 border-t dark:border-slate-700 bg-gray-50 dark:bg-slate-900/40 rounded-b-xl flex justify-end gap-3">
                    <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-slate-600">
                        {t('outreach_cancel')}
                    </button>
                    <button type="button" onClick={handleCopy} disabled={!result || copying} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300">
                        {t('outreach_copy')}
                    </button>
                </div>
            </div>
        </ViewportAwareDialog>
    );
};

export default OutreachModal;
