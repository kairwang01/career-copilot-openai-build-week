import React, { useState, useEffect, useRef } from 'react';
import {
    AlertCircle,
    CheckCircle2,
    LineChart,
    Loader2,
    Send,
    ShieldCheck,
    Sparkles,
    Wand2,
    X,
} from 'lucide-react';
import type { AppSession as Session } from '../lib/data';
import { generateJobDescription, analyzeSalary, checkInclusivity, formatJobDescription } from '../services/aiClient';
import type { InclusivitySuggestion, UserProfile } from '../types';
import { saveJobPosting, type JobPosting } from '../lib/recruitingData';
import { createSecureRandomToken } from '../lib/secureRandomId';
import { renderFormattedText } from './tools/ToolUtils';
import { ViewportAwareDialog } from './ViewportAwareDialog';
import {
    WORK_MODES,
    EMPLOYMENT_TYPES,
    EXPERIENCE_LEVELS,
    workModeLabelKey,
    employmentTypeLabelKey,
    experienceLevelLabelKey,
} from '../constants/jobPostingFields';

interface JobPostFormProps {
    session: Session;
    profile: UserProfile;
    onClose: () => void;
    onPostCreated: () => void;
    existingJob?: JobPosting | null;
    t: (key: string) => string;
    /** When true, renders as an in-flow container rather than a fixed modal overlay. */
    embedded?: boolean;
}

type AiAction = 'description' | 'salary' | 'inclusivity' | 'format';

// Simple modal component for inclusivity results
const InclusivityModal: React.FC<{ suggestions: InclusivitySuggestion[]; onClose: () => void; t: (key: string) => string }> = ({ suggestions, onClose, t }) => {
    return (
        <ViewportAwareDialog open onClose={onClose} closeOnBackdrop labelledBy="job-inclusivity-title" maxWidth={512} zIndex={60}>
            <div className="flex min-h-[320px] flex-col rounded-xl bg-white shadow-2xl dark:bg-gray-800">
                <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                    <h3 id="job-inclusivity-title" className="text-lg font-bold text-gray-800 dark:text-white">{t('job_form_inclusivity_results_title')}</h3>
                </div>
                <div className="flex-grow overflow-y-auto p-6 space-y-4">
                    {suggestions.length === 0 ? (
                        <div className="text-center p-6 bg-green-50 text-green-800 rounded-lg dark:bg-green-900/20 dark:text-green-300">
                            <p className="font-semibold">{t('job_form_inclusivity_pass_title')}</p>
                            <p>{t('job_form_inclusivity_pass_desc')}</p>
                        </div>
                    ) : (
                        suggestions.map((item, i) => (
                            <div key={i} className="text-sm p-3 border rounded-md bg-gray-50 border-gray-200 dark:bg-gray-900/60 dark:border-gray-700">
                                <p className="mb-2 text-gray-600 dark:text-gray-300"><strong>{t('job_form_original_label')}:</strong> <span className="line-through">{item.originalText}</span></p>
                                <p className="mb-2 text-green-700 dark:text-green-300"><strong>{t('job_form_suggestion_label')}:</strong> {item.suggestion}</p>
                                <p className="text-xs text-yellow-800 bg-yellow-50 p-2 rounded-md border border-yellow-200 dark:text-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800"><strong>{t('job_form_reason_label')}:</strong> {item.explanation}</p>
                            </div>
                        ))
                    )}
                </div>
                <div className="p-4 border-t border-gray-200 bg-gray-50 rounded-b-xl text-right dark:border-gray-700 dark:bg-gray-900">
                    <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700">{t('job_form_close')}</button>
                </div>
            </div>
        </ViewportAwareDialog>
    );
};


const JobPostForm: React.FC<JobPostFormProps> = ({ session, profile, onClose, onPostCreated, existingJob, t, embedded = false }) => {
    // Main form state
    const [jobTitle, setJobTitle] = useState('');
    const [location, setLocation] = useState('');
    const [salaryRange, setSalaryRange] = useState('');
    const [keyResponsibilities, setKeyResponsibilities] = useState('');
    const [jobDescription, setJobDescription] = useState('');

    // Structured fields — role details
    const [workMode, setWorkMode] = useState('');
    const [employmentType, setEmploymentType] = useState('');
    const [experienceLevel, setExperienceLevel] = useState('');
    const [department, setDepartment] = useState('');
    const [responsibilities, setResponsibilities] = useState('');
    // Structured fields — requirements
    const [requiredQualifications, setRequiredQualifications] = useState('');
    const [niceToHaveQualifications, setNiceToHaveQualifications] = useState('');
    const [requiredSkills, setRequiredSkills] = useState<string[]>([]);
    const [preferredSkills, setPreferredSkills] = useState<string[]>([]);
    const [requiredSkillDraft, setRequiredSkillDraft] = useState('');
    const [preferredSkillDraft, setPreferredSkillDraft] = useState('');
    // Structured fields — compensation & logistics
    const [visaSponsorship, setVisaSponsorship] = useState(false);
    const [relocation, setRelocation] = useState(false);
    const [languageRequirement, setLanguageRequirement] = useState('');
    // Structured fields — hiring process
    const [applicationDeadline, setApplicationDeadline] = useState('');
    const [headcount, setHeadcount] = useState('');
    const [interviewProcess, setInterviewProcess] = useState('');
    const [campusNewGrad, setCampusNewGrad] = useState(false);
    // Screener questions (Indeed/LinkedIn style). Ids are server-assigned on save.
    const [screenerQuestions, setScreenerQuestions] = useState<
        { _uid: string; prompt: string; type: 'yes_no' | 'short_text'; required: boolean; expected: string | null }[]
    >([]);

    // UI/Loading state
    const [loading, setLoading] = useState(false);
    // Synchronous re-entry latch: a state flag lags a render, so a fast double Enter/
    // click could fire two saveJobPosting calls → a DUPLICATE live job posting.
    const submittingRef = useRef(false);
    // False once unmounted — guards AI-result setState if the user leaves mid-analyze.
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);
    const [error, setError] = useState('');
    const [aiLoading, setAiLoading] = useState<AiAction | null>(null);
    const aiLoadingRef = useRef<typeof aiLoading>(null);
    const [aiErrors, setAiErrors] = useState<Partial<Record<AiAction, string>>>({});
    const [inclusivityResults, setInclusivityResults] = useState<InclusivitySuggestion[] | null>(null);
    const [salarySuggestion, setSalarySuggestion] = useState<{ yearly: string; monthly: string; } | null>(null);
    const [editorView, setEditorView] = useState<'edit' | 'preview'>('edit');


    const isEditing = !!existingJob;
    const isAiBusy = aiLoading !== null;
    const startAiAction = (action: AiAction) => {
        if (aiLoadingRef.current) return false;
        aiLoadingRef.current = action;
        setAiLoading(action);
        setAiErrors((current) => ({ ...current, [action]: undefined }));
        return true;
    };
    const finishAiAction = (action: AiAction) => {
        if (aiLoadingRef.current !== action) return;
        aiLoadingRef.current = null;
        if (mountedRef.current) setAiLoading(null);
    };
    const setAiActionError = (action: AiAction, message: string) => {
        setAiErrors((current) => ({ ...current, [action]: message }));
    };
    const hasTitle = jobTitle.trim().length > 0;
    const hasLocation = location.trim().length > 0;
    const hasDescription = jobDescription.trim().length > 0;
    const hasSalary = salaryRange.trim().length > 0;
    const hasWorkMode = workMode.trim().length > 0;
    const hasEmploymentType = employmentType.trim().length > 0;
    const hasExperienceLevel = experienceLevel.trim().length > 0;
    const hasDepartment = department.trim().length > 0;
    const hasResponsibilities = responsibilities.trim().length > 0;
    const hasRequiredQualifications = requiredQualifications.trim().length > 0;
    const hasRequiredSkills = requiredSkills.length > 0;
    const hasApplicationDeadline = applicationDeadline.trim().length > 0;
    const parsedHeadcount = Number(headcount);
    const hasHeadcount = headcount.trim().length > 0 && Number.isFinite(parsedHeadcount) && parsedHeadcount >= 1;
    const readinessItems = [
        { label: t('job_form_check_title'), complete: hasTitle },
        { label: t('job_form_check_location'), complete: hasLocation },
        { label: t('job_field_work_mode'), complete: hasWorkMode },
        { label: t('job_field_employment_type'), complete: hasEmploymentType },
        { label: t('job_field_experience_level'), complete: hasExperienceLevel },
        { label: t('job_field_department'), complete: hasDepartment },
        { label: t('job_form_check_description'), complete: hasDescription },
        { label: t('job_field_responsibilities'), complete: hasResponsibilities },
        { label: t('job_field_required_qualifications'), complete: hasRequiredQualifications },
        { label: t('job_field_required_skills'), complete: hasRequiredSkills },
        { label: t('job_field_application_deadline'), complete: hasApplicationDeadline },
        { label: t('job_field_headcount'), complete: hasHeadcount },
        { label: t('job_form_check_salary'), complete: hasSalary, optional: true },
    ];
    const completedReadinessItems = readinessItems.filter((item) => item.complete).length;
    const requiredReadinessItems = readinessItems.filter((item) => !item.optional);
    const completedRequiredItems = requiredReadinessItems.filter((item) => item.complete).length;
    const readinessPercent = Math.round((completedReadinessItems / readinessItems.length) * 100);
    const canSubmit = completedRequiredItems === requiredReadinessItems.length && !loading && !isAiBusy;

    useEffect(() => {
        if (existingJob) {
            setJobTitle(existingJob.title);
            setLocation(existingJob.location || '');
            setSalaryRange(existingJob.salary_range || '');
            setJobDescription(existingJob.description || '');
            // Structured fields — hydrate from the saved posting.
            setWorkMode(existingJob.work_mode || '');
            setEmploymentType(existingJob.employment_type || '');
            setExperienceLevel(existingJob.experience_level || '');
            setDepartment(existingJob.department || '');
            setResponsibilities(existingJob.responsibilities || '');
            setRequiredQualifications(existingJob.required_qualifications || '');
            setNiceToHaveQualifications(existingJob.nice_to_have_qualifications || '');
            setRequiredSkills(existingJob.required_skills || []);
            setPreferredSkills(existingJob.preferred_skills || []);
            setVisaSponsorship(!!existingJob.visa_sponsorship);
            setRelocation(!!existingJob.relocation);
            setLanguageRequirement(existingJob.language_requirement || '');
            setApplicationDeadline(existingJob.application_deadline || '');
            setHeadcount(existingJob.headcount ? String(existingJob.headcount) : '');
            setInterviewProcess(existingJob.interview_process || '');
            setCampusNewGrad(!!existingJob.campus_new_grad);
            setScreenerQuestions(
                (existingJob.screener_questions || []).map((q) => ({
                    _uid: createSecureRandomToken(),
                    prompt: q.prompt, type: q.type, required: q.required, expected: q.expected,
                })),
            );
            // Key responsibilities are not saved, so they will be blank on edit.
        }
    }, [existingJob]);

    // Chip-input helpers for the skill arrays: add the trimmed draft on Enter (no
    // duplicates), remove an individual chip, and clear the draft afterwards.
    const addSkill = (
        draft: string,
        skills: string[],
        setSkills: React.Dispatch<React.SetStateAction<string[]>>,
        setDraft: React.Dispatch<React.SetStateAction<string>>,
    ) => {
        const value = draft.trim();
        if (!value) return;
        if (!skills.some((s) => s.toLowerCase() === value.toLowerCase())) {
            setSkills([...skills, value]);
        }
        setDraft('');
    };

    const removeSkill = (
        skill: string,
        setSkills: React.Dispatch<React.SetStateAction<string[]>>,
    ) => {
        setSkills((prev) => prev.filter((s) => s !== skill));
    };

    const handleSkillKeyDown = (
        e: React.KeyboardEvent<HTMLInputElement>,
        draft: string,
        skills: string[],
        setSkills: React.Dispatch<React.SetStateAction<string[]>>,
        setDraft: React.Dispatch<React.SetStateAction<string>>,
    ) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            addSkill(draft, skills, setSkills, setDraft);
        }
    };

    const handleGenerateDescription = async () => {
        if (!jobTitle || !keyResponsibilities) {
            setAiActionError('description', t('job_form_error_generate_required'));
            return;
        }
        if (!startAiAction('description')) return;
        try {
            const { company_name, company_description } = profile;
            const result = await generateJobDescription(jobTitle, keyResponsibilities, company_name || '', company_description || '');
            if (!mountedRef.current) return;
            setJobDescription(result.jobDescription);
            setEditorView('preview');
        } catch (err) {
            if (mountedRef.current) setAiActionError('description', err instanceof Error ? err.message : t('job_form_error_generate_failed'));
        } finally {
            finishAiAction('description');
        }
    };
    
    const handleFormatDescription = async () => {
        if (!jobDescription) {
            setAiActionError('format', t('job_form_error_format_required'));
            return;
        }
        if (!startAiAction('format')) return;
        try {
            const result = await formatJobDescription(jobDescription);
            if (!mountedRef.current) return;
            setJobDescription(result.formattedDescription);
            if (result.jobTitle && !jobTitle) {
                setJobTitle(result.jobTitle);
            }
            if (result.location && !location) {
                setLocation(result.location);
            }
            setEditorView('preview');
        } catch (err) {
            if (mountedRef.current) setAiActionError('format', err instanceof Error ? err.message : t('job_form_error_format_failed'));
        } finally {
            finishAiAction('format');
        }
    };

    const handleAnalyzeSalary = async () => {
        if (!jobTitle || !location) {
            setAiActionError('salary', t('job_form_error_salary_required'));
            return;
        }
        if (!startAiAction('salary')) return;
        setSalarySuggestion(null);
        try {
            const result = await analyzeSalary(jobTitle, location, jobDescription);
            if (!mountedRef.current) return;
            setSalarySuggestion({ yearly: result.yearlySalary, monthly: result.monthlySalary });
        } catch (err) {
            if (mountedRef.current) setAiActionError('salary', err instanceof Error ? err.message : t('job_form_error_salary_failed'));
        } finally {
            finishAiAction('salary');
        }
    };
    
    const handleCheckInclusivity = async () => {
        if (!jobDescription) {
            setAiActionError('inclusivity', t('job_form_error_inclusivity_required'));
            return;
        }
        if (!startAiAction('inclusivity')) return;
        try {
            const result = await checkInclusivity(jobDescription);
            if (!mountedRef.current) return;
            setInclusivityResults(result.suggestions);
        } catch (err) {
            if (mountedRef.current) setAiActionError('inclusivity', err instanceof Error ? err.message : t('job_form_error_inclusivity_failed'));
        } finally {
            finishAiAction('inclusivity');
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit) {
            setError(isAiBusy ? t('job_form_action_busy_note') : t('job_form_submit_requirements'));
            return;
        }
        if (submittingRef.current) return; // already creating — block synchronous double-submit
        submittingRef.current = true;
        setLoading(true);
        setError('');

        try {
            const jobData = {
                title: jobTitle.trim(),
                location: location.trim(),
                description: jobDescription.trim(),
                salary_range: salaryRange.trim(),
                // Structured fields — the server re-validates these (it is authoritative).
                work_mode: workMode,
                employment_type: employmentType,
                experience_level: experienceLevel,
                department: department.trim(),
                responsibilities: responsibilities.trim(),
                required_qualifications: requiredQualifications.trim(),
                nice_to_have_qualifications: niceToHaveQualifications.trim(),
                required_skills: requiredSkills,
                preferred_skills: preferredSkills,
                application_deadline: applicationDeadline,
                headcount: headcount ? Number(headcount) : null,
                visa_sponsorship: visaSponsorship,
                relocation: relocation,
                language_requirement: languageRequirement.trim(),
                interview_process: interviewProcess.trim(),
                campus_new_grad: campusNewGrad,
                screener_questions: screenerQuestions
                    .filter((q) => q.prompt.trim())
                    .map((q, i) => ({
                        id: `q${i + 1}`,
                        prompt: q.prompt.trim(),
                        type: q.type,
                        required: q.required,
                        expected: q.type === 'yes_no' ? q.expected : null,
                    })),
                // Snapshot company name + context at create time; profile fields are
                // trusted (read from server-provisioned user doc, not user input).
                company_name: profile.company_name ?? null,
                company_size: profile.company_size ?? null,
                industry: profile.industry ?? null,
                founded_year: profile.founded_year ?? null,
            };

            await saveJobPosting(session.user.id, jobData, isEditing ? existingJob.id : undefined);

            onPostCreated();
            onClose();

        } catch (err) {
            setError(err instanceof Error ? err.message : t('job_form_error_unknown'));
        } finally {
            submittingRef.current = false;
            setLoading(false);
        }
    };

    const labelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-300';
    const inputClass = 'mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:ring-blue-900/40';
    const sectionHeadingClass = 'text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400';
    const checkboxRowClass = 'flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300';
    const checkboxClass = 'h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800';
    const secondaryButtonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700';
    const primaryButtonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-transparent bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400';
    const submitButtonLabel = loading
        ? (isEditing ? t('job_form_saving') : t('job_form_posting'))
        : (isEditing ? t('job_form_save_changes') : t('job_form_post_job'));

    const renderAiError = (action: AiAction, onRetry: () => void) => {
        const message = aiErrors[action];
        if (!message) return null;
        return (
            <div role="alert" className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200 sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0">{message}</span>
                <button
                    type="button"
                    onClick={onRetry}
                    disabled={isAiBusy}
                    className="shrink-0 self-start rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:bg-red-950 dark:text-red-100 dark:hover:bg-red-900 sm:self-auto"
                >
                    {t('try_again')}
                </button>
            </div>
        );
    };

    // Reusable chip/tag input for a skill array — type a skill + Enter to add a
    // removable chip. Used for both required and preferred skills.
    const renderSkillInput = (
        id: string,
        skills: string[],
        setSkills: React.Dispatch<React.SetStateAction<string[]>>,
        draft: string,
        setDraft: React.Dispatch<React.SetStateAction<string>>,
    ) => (
        <div className="mt-1 rounded-lg border border-gray-300 bg-white px-2 py-2 shadow-sm transition focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 dark:border-gray-600 dark:bg-gray-800 dark:focus-within:ring-blue-900/40">
            {skills.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                    {skills.map((skill) => (
                        <span key={skill} className="inline-flex items-center gap-1 rounded-full bg-blue-50 py-1 pl-2.5 pr-1 text-xs font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                            {skill}
                            <button
                                type="button"
                                onClick={() => removeSkill(skill, setSkills)}
                                className="rounded-full p-0.5 text-blue-500 transition-colors hover:bg-blue-100 hover:text-blue-700 dark:text-blue-300 dark:hover:bg-blue-900/60"
                                aria-label={`${t('job_field_remove')}: ${skill}`}
                            >
                                <X className="h-3 w-3" aria-hidden="true" />
                            </button>
                        </span>
                    ))}
                </div>
            )}
            <input
                type="text"
                id={id}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => handleSkillKeyDown(e, draft, skills, setSkills, setDraft)}
                onBlur={() => addSkill(draft, skills, setSkills, setDraft)}
                placeholder={t('job_field_skills_placeholder')}
                aria-label={id === 'required-skills' ? t('job_field_required_skills') : t('job_field_preferred_skills')}
                className="block w-full bg-transparent px-1 py-1 text-sm text-gray-900 focus:outline-none dark:text-gray-100 dark:placeholder:text-gray-500"
            />
        </div>
    );

    const readinessCard = (
        <aside className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('job_form_readiness_title')}</h3>
                    <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{t('job_form_readiness_desc')}</p>
                </div>
                <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                    {readinessPercent}%
                </span>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                <div className="h-full rounded-full bg-blue-600 transition-all duration-500" style={{ width: `${readinessPercent}%` }} />
            </div>
            <div className="mt-4 space-y-2">
                {readinessItems.map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-3">
                        <span className={`text-xs ${item.complete ? 'text-gray-700 dark:text-gray-200' : 'text-gray-500 dark:text-gray-400'}`}>
                            {item.label}{item.optional ? ` ${t('job_form_optional_suffix')}` : ''}
                        </span>
                        {item.complete
                            ? <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />
                            : <span className="h-4 w-4 rounded-full border border-gray-300 dark:border-gray-600" aria-hidden="true" />}
                    </div>
                ))}
            </div>
            {!canSubmit && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
                    {isAiBusy ? t('job_form_action_busy_note') : t('job_form_submit_requirements')}
                </div>
            )}
        </aside>
    );

    // Shared form body — used in both embedded and modal modes
    const formBody = (
        <>
            {error && (
                <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                    <span>{error}</span>
                </div>
            )}

            <section className="space-y-3">
                <h3 className={sectionHeadingClass}>{t('job_section_basic')}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="job-title" className={labelClass}>{t('job_form_title_label')}</label>
                        <input type="text" id="job-title" value={jobTitle} onChange={e => setJobTitle(e.target.value)} required className={inputClass} />
                    </div>
                    <div>
                        <label htmlFor="location" className={labelClass}>{t('job_form_location_label')}</label>
                        <input type="text" id="location" value={location} onChange={e => setLocation(e.target.value)} placeholder={t('job_form_location_placeholder')} required className={inputClass} />
                    </div>
                </div>
            </section>

            <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl space-y-3 dark:bg-blue-950/30 dark:border-blue-900/60">
                <div>
                    <label htmlFor="key-responsibilities" className="block text-sm font-semibold text-blue-900 dark:text-blue-200">{t('job_form_content_generation_label')}</label>
                    <p className="mt-1 text-xs leading-5 text-blue-800/80 dark:text-blue-200/80">{t('job_form_helper_hint')}</p>
                </div>
                <textarea id="key-responsibilities" value={keyResponsibilities} onChange={e => setKeyResponsibilities(e.target.value)} rows={4} className={inputClass} placeholder={t('job_form_key_points_placeholder')} />
                <button type="button" onClick={handleGenerateDescription} disabled={isAiBusy} className={`w-full sm:w-auto ${primaryButtonClass}`}>
                    {aiLoading === 'description'
                        ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                    {aiLoading === 'description' ? t('job_form_generating') : t('job_form_generate_button')}
                </button>
                {renderAiError('description', handleGenerateDescription)}
            </div>

            <div>
                <div className="border-b border-gray-200">
                    <nav className="-mb-px flex space-x-4" aria-label="Tabs">
                        <button type="button" onClick={() => setEditorView('edit')} className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm ${editorView === 'edit' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-200'}`}>{t('job_form_write_tab')}</button>
                        <button type="button" onClick={() => setEditorView('preview')} className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm ${editorView === 'preview' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-200'}`}>{t('job_form_preview_tab')}</button>
                    </nav>
                </div>
                <div className="mt-4">
                    {editorView === 'edit' ? (
                        <div className="animate-fade-in">
                            <label htmlFor="job-description" className="sr-only">{t('job_form_description_label')}</label>
                            <textarea id="job-description" value={jobDescription} onChange={e => setJobDescription(e.target.value)} rows={15} required className={inputClass} placeholder={t('job_form_description_placeholder')} />
                            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <button type="button" onClick={handleFormatDescription} disabled={isAiBusy || !jobDescription} className={`w-full ${secondaryButtonClass}`}>
                                        {aiLoading === 'format'
                                            ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                            : <Wand2 className="h-4 w-4" aria-hidden="true" />}
                                        {aiLoading === 'format' ? t('job_form_formatting') : t('job_form_format_button')}
                                    </button>
                                    {renderAiError('format', handleFormatDescription)}
                                </div>
                                <div className="space-y-2">
                                    <button type="button" onClick={handleCheckInclusivity} disabled={isAiBusy || !jobDescription} className={`w-full ${secondaryButtonClass}`}>
                                        {aiLoading === 'inclusivity'
                                            ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                            : <ShieldCheck className="h-4 w-4" aria-hidden="true" />}
                                        {aiLoading === 'inclusivity' ? t('job_form_checking') : t('job_form_inclusivity_button')}
                                    </button>
                                    {renderAiError('inclusivity', handleCheckInclusivity)}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="animate-fade-in p-4 border rounded-lg bg-gray-50 min-h-[350px] max-h-[calc(100dvh-450px)] overflow-y-auto text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
                            {jobDescription.trim() ? renderFormattedText(jobDescription) : <p className="text-gray-500 text-center dark:text-gray-400">{t('job_form_preview_empty')}</p>}
                        </div>
                    )}
                </div>
            </div>

            <section className="space-y-4 border-t border-gray-200 pt-6 dark:border-gray-700">
                <h3 className={sectionHeadingClass}>{t('job_section_role')}</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label htmlFor="work-mode" className={labelClass}>{t('job_field_work_mode')}</label>
                        <select id="work-mode" value={workMode} onChange={e => setWorkMode(e.target.value)} required className={inputClass}>
                            <option value="">{t('job_field_select_placeholder')}</option>
                            {WORK_MODES.map((v) => (
                                <option key={v} value={v}>{t(workModeLabelKey(v))}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="employment-type" className={labelClass}>{t('job_field_employment_type')}</label>
                        <select id="employment-type" value={employmentType} onChange={e => setEmploymentType(e.target.value)} required className={inputClass}>
                            <option value="">{t('job_field_select_placeholder')}</option>
                            {EMPLOYMENT_TYPES.map((v) => (
                                <option key={v} value={v}>{t(employmentTypeLabelKey(v))}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="experience-level" className={labelClass}>{t('job_field_experience_level')}</label>
                        <select id="experience-level" value={experienceLevel} onChange={e => setExperienceLevel(e.target.value)} required className={inputClass}>
                            <option value="">{t('job_field_select_placeholder')}</option>
                            {EXPERIENCE_LEVELS.map((v) => (
                                <option key={v} value={v}>{t(experienceLevelLabelKey(v))}</option>
                            ))}
                        </select>
                    </div>
                </div>
                <div>
                    <label htmlFor="department" className={labelClass}>{t('job_field_department')}</label>
                    <input type="text" id="department" value={department} onChange={e => setDepartment(e.target.value)} required className={inputClass} />
                </div>
                <div>
                    <label htmlFor="responsibilities" className={labelClass}>{t('job_field_responsibilities')}</label>
                    <textarea id="responsibilities" value={responsibilities} onChange={e => setResponsibilities(e.target.value)} rows={4} required className={inputClass} />
                </div>
            </section>

            <section className="space-y-4 border-t border-gray-200 pt-6 dark:border-gray-700">
                <h3 className={sectionHeadingClass}>{t('job_section_requirements')}</h3>
                <div>
                    <label htmlFor="required-qualifications" className={labelClass}>{t('job_field_required_qualifications')}</label>
                    <textarea id="required-qualifications" value={requiredQualifications} onChange={e => setRequiredQualifications(e.target.value)} rows={4} required className={inputClass} />
                </div>
                <div>
                    <label htmlFor="nice-to-have" className={labelClass}>
                        {t('job_field_nice_to_have')} <span className="font-normal text-gray-400 dark:text-gray-500">{t('job_field_optional')}</span>
                    </label>
                    <textarea id="nice-to-have" value={niceToHaveQualifications} onChange={e => setNiceToHaveQualifications(e.target.value)} rows={3} className={inputClass} />
                </div>
                <div>
                    <label htmlFor="required-skills" className={labelClass}>{t('job_field_required_skills')}</label>
                    {renderSkillInput('required-skills', requiredSkills, setRequiredSkills, requiredSkillDraft, setRequiredSkillDraft)}
                    <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{t('job_field_skills_hint')}</p>
                </div>
                <div>
                    <label htmlFor="preferred-skills" className={labelClass}>
                        {t('job_field_preferred_skills')} <span className="font-normal text-gray-400 dark:text-gray-500">{t('job_field_optional')}</span>
                    </label>
                    {renderSkillInput('preferred-skills', preferredSkills, setPreferredSkills, preferredSkillDraft, setPreferredSkillDraft)}
                    <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{t('job_field_skills_hint')}</p>
                </div>
            </section>

            <section className="space-y-4 border-t border-gray-200 pt-6 dark:border-gray-700">
                <h3 className={sectionHeadingClass}>{t('job_section_compensation')}</h3>
                <div>
                    <label htmlFor="salary" className={labelClass}>{t('job_form_salary_label')} <span className="font-normal text-gray-400 dark:text-gray-500">{t('job_field_optional')}</span></label>
                    <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                        <input type="text" id="salary" value={salaryRange} onChange={e => setSalaryRange(e.target.value)} placeholder={t('job_form_salary_placeholder')} className={inputClass} />
                        <button type="button" onClick={handleAnalyzeSalary} disabled={isAiBusy} className="inline-flex items-center justify-center gap-2 rounded-lg bg-gray-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-400 dark:bg-gray-600 dark:hover:bg-gray-500 sm:flex-shrink-0">
                            {aiLoading === 'salary'
                                ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                : <LineChart className="h-4 w-4" aria-hidden="true" />}
                            {aiLoading === 'salary' ? t('job_form_analyzing_short') : t('job_form_analyze_rate')}
                        </button>
                    </div>
                    {aiErrors.salary && (
                        <div className="mt-2">
                            {renderAiError('salary', handleAnalyzeSalary)}
                        </div>
                    )}
                    {salarySuggestion && (
                        <div className="mt-2 text-sm text-gray-600 bg-blue-50 p-3 rounded-lg border border-blue-200 dark:text-blue-100 dark:bg-blue-950/30 dark:border-blue-900/60">
                            <p className="font-semibold">{t('job_form_salary_suggestion')}</p>
                            <p><strong>{t('job_form_yearly_label')}:</strong> {salarySuggestion.yearly}</p>
                            <p><strong>{t('job_form_monthly_label')}:</strong> {salarySuggestion.monthly}</p>
                        </div>
                    )}
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
                    <label className={checkboxRowClass}>
                        <input type="checkbox" checked={visaSponsorship} onChange={e => setVisaSponsorship(e.target.checked)} className={checkboxClass} />
                        {t('job_field_visa_sponsorship')}
                    </label>
                    <label className={checkboxRowClass}>
                        <input type="checkbox" checked={relocation} onChange={e => setRelocation(e.target.checked)} className={checkboxClass} />
                        {t('job_field_relocation')}
                    </label>
                </div>
                <div>
                    <label htmlFor="language-requirement" className={labelClass}>
                        {t('job_field_language_requirement')} <span className="font-normal text-gray-400 dark:text-gray-500">{t('job_field_optional')}</span>
                    </label>
                    <input type="text" id="language-requirement" value={languageRequirement} onChange={e => setLanguageRequirement(e.target.value)} className={inputClass} />
                </div>
            </section>

            <section className="space-y-4 border-t border-gray-200 pt-6 dark:border-gray-700">
                <h3 className={sectionHeadingClass}>{t('job_section_hiring')}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="application-deadline" className={labelClass}>{t('job_field_application_deadline')}</label>
                        <input type="date" id="application-deadline" value={applicationDeadline} onChange={e => setApplicationDeadline(e.target.value)} required className={inputClass} />
                    </div>
                    <div>
                        <label htmlFor="headcount" className={labelClass}>{t('job_field_headcount')}</label>
                        <input type="number" id="headcount" min={1} value={headcount} onChange={e => setHeadcount(e.target.value)} required className={inputClass} />
                    </div>
                </div>
                <div>
                    <label htmlFor="interview-process" className={labelClass}>
                        {t('job_field_interview_process')} <span className="font-normal text-gray-400 dark:text-gray-500">{t('job_field_optional')}</span>
                    </label>
                    <textarea id="interview-process" value={interviewProcess} onChange={e => setInterviewProcess(e.target.value)} rows={3} className={inputClass} />
                </div>
                <label className={checkboxRowClass}>
                    <input type="checkbox" checked={campusNewGrad} onChange={e => setCampusNewGrad(e.target.checked)} className={checkboxClass} />
                    {t('job_field_campus_new_grad')}
                </label>
            </section>

            <section className="space-y-4 border-t border-gray-200 pt-6 dark:border-gray-700">
                <h3 className={sectionHeadingClass}>{t('job_section_screener')}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">{t('job_screener_desc')}</p>
                <div className="space-y-3">
                    {screenerQuestions.map((q, i) => (
                        <div key={q._uid} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                            <div className="flex items-start gap-2">
                                <input
                                    type="text"
                                    value={q.prompt}
                                    onChange={e => setScreenerQuestions(list => list.map((x, xi) => xi === i ? { ...x, prompt: e.target.value } : x))}
                                    placeholder={t('job_screener_prompt_placeholder')}
                                    aria-label={`${t('job_screener_prompt_placeholder')} ${i + 1}`}
                                    maxLength={300}
                                    className={inputClass}
                                />
                                <button
                                    type="button"
                                    onClick={() => setScreenerQuestions(list => list.filter((_, xi) => xi !== i))}
                                    aria-label={`${t('job_screener_remove')} ${i + 1}`}
                                    className="mt-2 shrink-0 text-xs font-semibold text-gray-400 hover:text-red-500"
                                >
                                    {t('job_screener_remove')}
                                </button>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-3">
                                <select
                                    value={q.type}
                                    onChange={e => setScreenerQuestions(list => list.map((x, xi) => xi === i ? { ...x, type: e.target.value as 'yes_no' | 'short_text', expected: e.target.value === 'yes_no' ? x.expected : null } : x))}
                                    aria-label={`${t('job_section_screener')} ${i + 1} ${t('job_screener_type_text')}`}
                                    className={`${inputClass} w-auto`}
                                >
                                    <option value="short_text">{t('job_screener_type_text')}</option>
                                    <option value="yes_no">{t('job_screener_type_yes_no')}</option>
                                </select>
                                <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                                    <input type="checkbox" checked={q.required} onChange={e => setScreenerQuestions(list => list.map((x, xi) => xi === i ? { ...x, required: e.target.checked } : x))} className={checkboxClass} />
                                    {t('job_screener_required')}
                                </label>
                                {q.type === 'yes_no' && (
                                    <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                                        {t('job_screener_expected')}
                                        <select
                                            value={q.expected ?? ''}
                                            onChange={e => setScreenerQuestions(list => list.map((x, xi) => xi === i ? { ...x, expected: e.target.value || null } : x))}
                                            aria-label={`${t('job_screener_expected')} ${i + 1}`}
                                            className={`${inputClass} w-auto`}
                                        >
                                            <option value="">{t('job_screener_expected_any')}</option>
                                            <option value="yes">{t('apply_review_screener_yes')}</option>
                                            <option value="no">{t('apply_review_screener_no')}</option>
                                        </select>
                                    </label>
                                )}
                            </div>
                        </div>
                    ))}
                    {screenerQuestions.length < 8 && (
                        <button
                            type="button"
                            onClick={() => setScreenerQuestions(list => [...list, { _uid: createSecureRandomToken(), prompt: '', type: 'short_text', required: false, expected: null }])}
                            className="text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400"
                        >
                            + {t('job_screener_add')}
                        </button>
                    )}
                </div>
            </section>
        </>
    );

    if (embedded) {
        // Render as a plain page section — no backdrop or fixed positioning
        return (
            <>
                <div className="max-w-[1088px] mx-auto p-4 sm:p-6 lg:p-8">
                    <form id="job-post-form" onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]" aria-busy={loading || isAiBusy}>
                        <div className="space-y-6">
                            {formBody}
                        </div>
                        <div className="lg:sticky lg:top-6 lg:self-start">
                            {readinessCard}
                        </div>
                    </form>
                    <div className="flex flex-col-reverse gap-3 pt-4 border-t border-gray-200 mt-6 sm:flex-row sm:items-center sm:justify-end dark:border-gray-700">
                        <button type="button" onClick={onClose} className={secondaryButtonClass}>{t('job_form_cancel')}</button>
                        <button type="submit" form="job-post-form" disabled={!canSubmit} className={primaryButtonClass}>
                            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                            {submitButtonLabel}
                        </button>
                    </div>
                </div>
                {inclusivityResults && <InclusivityModal suggestions={inclusivityResults} onClose={() => setInclusivityResults(null)} t={t} />}
            </>
        );
    }

    return (
        <>
            <ViewportAwareDialog
                open
                onClose={onClose}
                closeOnBackdrop={!inclusivityResults}
                closeOnEscape={!inclusivityResults}
                ariaLabel={isEditing ? t('job_form_edit_title') : t('job_form_create_title')}
                maxWidth={896}
                zIndex={50}
            >
                <div className="flex min-h-[520px] flex-col rounded-xl bg-white shadow-2xl dark:bg-gray-800">
                    <div className="flex-shrink-0 flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                        <h3 className="text-xl font-bold text-gray-800 dark:text-white">{isEditing ? t('job_form_edit_title') : t('job_form_create_title')}</h3>
                        <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full p-1" aria-label={t('job_form_close')}>
                            <X className="h-6 w-6" aria-hidden="true" />
                        </button>
                    </div>
                    <form id="job-post-form" onSubmit={handleSubmit} className="flex-grow overflow-y-auto p-6" aria-busy={loading || isAiBusy}>
                        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
                            <div className="space-y-6">
                                {formBody}
                            </div>
                            <div className="lg:sticky lg:top-0 lg:self-start">
                                {readinessCard}
                            </div>
                        </div>
                    </form>
                    <div className="flex-shrink-0 flex justify-end items-center p-4 border-t border-gray-200 bg-gray-50 rounded-b-xl space-x-3 dark:border-gray-700 dark:bg-gray-900">
                        <button type="button" onClick={onClose} className={secondaryButtonClass}>{t('job_form_cancel')}</button>
                        <button type="submit" form="job-post-form" disabled={!canSubmit} className={primaryButtonClass}>
                            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                            {submitButtonLabel}
                        </button>
                    </div>
                </div>
            </ViewportAwareDialog>
            {inclusivityResults && <InclusivityModal suggestions={inclusivityResults} onClose={() => setInclusivityResults(null)} t={t} />}
        </>
    );
};

export default JobPostForm;
