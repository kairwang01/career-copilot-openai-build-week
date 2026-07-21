
import React, { useState, useRef, useEffect } from 'react';
import { ClipboardPaste, FileText, Globe, Link2, Upload } from 'lucide-react';
import type { ResumeImage } from '../types';
import { SUPPORTED_MARKETS } from '../config';
import { extractTextFromUrl } from '../services/aiClient';
import { parseFile } from '../services/fileHelpers';
import {
  getResumeFileValidationIssue,
  RESUME_FILE_ACCEPT,
  ResumeFileValidationError,
  type ResumeFileValidationCode,
} from '../lib/resumeFileValidation';
import { safeHttpUrl } from '../lib/safeUrl';
import ResumePreview from './ResumePreview';
import ConfirmActionDialog from './ConfirmActionDialog';

interface UploadSectionProps {
  resumeText: string;
  setResumeText: (text: string) => void;
  resumeImages: ResumeImage[] | null;
  setResumeImages: (images: ResumeImage[] | null) => void;
  onInitiateAnalysis: (e: React.FormEvent) => void;
  isLoading: boolean;
  error: string | null;
  setError: (error: string | null) => void;
  market: string;
  setMarket: (market: string) => void;
  t: (key: string) => string;
  variant?: 'site' | 'workspace';
  /** Workspace only: persist the original uploaded file to Storage (logged-in candidate). */
  onResumeFileSelected?: (file: File, isCurrent: () => boolean) => Promise<void>;
  /** The resume file already saved for this user, if any. */
  storedResumeFile?: { name: string | null; url: string; uploadedAt?: string | null } | null;
  onRemoveResumeFile?: () => void;
  isSavingResumeFile?: boolean;
}

const InputMethodButton: React.FC<{
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}> = ({ icon, label, active, onClick, disabled = false }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`flex min-h-11 items-center justify-center gap-2 rounded-[var(--site-radius)] border px-3 py-2.5 text-sm font-semibold transition-all disabled:cursor-wait disabled:opacity-60 sm:min-h-12 sm:px-4 sm:py-3 ${
        active
          ? 'bg-[var(--site-action)] text-white border-[var(--site-action)]'
          : 'bg-[var(--site-surface)] text-[var(--site-text)] border-[var(--site-border)] hover:border-[var(--site-action)]/40'
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 text-center leading-tight">{label}</span>
    </button>
);

const UploadSection: React.FC<UploadSectionProps> = ({
  resumeText,
  setResumeText,
  resumeImages,
  setResumeImages,
  onInitiateAnalysis,
  isLoading,
  error,
  setError,
  market,
  setMarket,
  t,
  onResumeFileSelected,
  storedResumeFile,
  onRemoveResumeFile,
  isSavingResumeFile,
}) => {
  const [activeTab, setActiveTab] = useState<'paste' | 'upload' | 'url'>('paste');
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState<string>('');
  const [isParsing, setIsParsing] = useState(false);
  const [isUrlProcessing, setIsUrlProcessing] = useState(false);
  const [removeFileConfirmOpen, setRemoveFileConfirmOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Shared token across the file-parse and URL-import paths: a newer upload/import (or
  // unmount) bumps it so a slow earlier call can't write its content — or persist the
  // wrong file to Storage — over the one the user actually ended on.
  const runIdRef = useRef(0);
  useEffect(() => () => { runIdRef.current++; }, []);

  const formatMessage = (key: string, values: Record<string, string | number>) =>
    Object.entries(values).reduce(
      (message, [token, value]) => message.split(`{${token}}`).join(String(value)),
      t(key),
    );

  const translatedOrFallback = (key: string, fallback: string) => {
    const translated = t(key);
    return translated === key ? fallback : translated;
  };

  const fileValidationErrorMessage = (code: ResumeFileValidationCode) => {
    switch (code) {
      case 'unsupported':
        return t('upload_file_unsupported_type');
      case 'file_too_large':
        return t('resume_file_too_large');
      case 'image_too_large':
        return translatedOrFallback('upload_file_image_too_large', 'Resume image must be smaller than 5 MB.');
      case 'too_many_pdf_pages':
        return translatedOrFallback('upload_file_pdf_page_limit', 'PDF resume must have no more than 8 pages.');
      case 'text_too_large':
        return translatedOrFallback('upload_file_text_too_long', 'The extracted resume text is too long to analyze.');
      case 'image_payload_too_large':
        return translatedOrFallback('upload_file_scan_too_large', 'The scanned resume is too large to analyze. Use a smaller or text-based PDF.');
    }
  };

  const parseFileErrorMessage = (parseError: unknown) => {
    if (!(parseError instanceof Error)) return t('upload_file_parse_failed');
    if (parseError instanceof ResumeFileValidationError) {
      return fileValidationErrorMessage(parseError.code);
    }
    switch (parseError.message) {
      case 'Could not extract text or images from PDF.':
        return t('upload_file_pdf_extract_failed');
      case 'Could not read the image file.':
        return t('upload_file_image_read_failed');
      case 'Unsupported file type. Please upload a .txt, .png, .jpg, .pdf, or .docx file.':
        return t('upload_file_unsupported_type');
      default:
        return t('upload_file_parse_failed');
    }
  };

  const clearInputs = () => {
    setResumeText('');
    setResumeImages(null);
    setUrlInput('');
    setError(null);
    setInfoMessage(null);
  };

  const handleTabChange = (tab: 'paste' | 'upload' | 'url') => {
    setActiveTab(tab);
  };

  const handleUrlImport = async () => {
    if (!urlInput.trim()) {
        setError(t('upload_url_required'));
        return;
    }

    const myRun = ++runIdRef.current;
    setIsUrlProcessing(true);
    setResumeText('');
    setResumeImages(null);
    setError(null);
    setInfoMessage(t('upload_url_importing'));

    try {
        const { extractedText } = await extractTextFromUrl(urlInput);
        if (myRun !== runIdRef.current) return; // superseded by a newer upload/import or unmount

        if (extractedText && extractedText.trim().length > 300) {
            setResumeText(extractedText);
            setActiveTab('paste');
            setInfoMessage(t('upload_url_import_success'));
        } else {
            setError(t('upload_url_import_insufficient'));
            setInfoMessage(null);
        }
    } catch (err) {
        if (myRun !== runIdRef.current) return;
        // Some sites (e.g. LinkedIn) block automated import — always leave the user a way forward.
        const detail = err instanceof Error ? err.message : t('upload_url_unknown_error');
        setError(`${detail} ${t('upload_url_import_error_suffix')}`);
        setInfoMessage(null);
    } finally {
        setIsUrlProcessing(false);
    }
  };


  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validationIssue = getResumeFileValidationIssue(file);
    if (validationIssue) {
      setError(fileValidationErrorMessage(validationIssue));
      setInfoMessage(null);
      e.target.value = '';
      return;
    }

    clearInputs();
    const myRun = ++runIdRef.current;
    setIsParsing(true);
    setInfoMessage(formatMessage('upload_file_processing', { fileName: file.name }));

    try {
        const result = await parseFile(file);
        if (myRun !== runIdRef.current) return; // a newer upload/import or unmount won — don't clobber it (or persist this file)

        if (result.images && result.images.length > 0) {
            setResumeImages(result.images);
            setActiveTab('upload');
            setInfoMessage(formatMessage('upload_file_images_success', { count: result.images.length, fileName: file.name }));
        } else if (result.text) {
            setResumeText(result.text);
            setActiveTab('paste');
            setInfoMessage(formatMessage('upload_file_text_success', { fileName: file.name }));
        } else {
            throw new Error(t('upload_file_no_content'));
        }
        // Persist the original file to Storage (workspace + signed-in only). The
        // extracted text above is already feeding the tools; this keeps a
        // downloadable copy of exactly what the user submitted.
        await onResumeFileSelected?.(file, () => myRun === runIdRef.current);
    } catch (parseError) {
        if (myRun !== runIdRef.current) return;
        setError(parseFileErrorMessage(parseError));
        setInfoMessage(null);
    } finally {
        setIsParsing(false);
        if (e.target) e.target.value = '';
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setResumeText(e.target.value);
    if(error) setError(null);
    if(infoMessage) setInfoMessage(null);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onInitiateAnalysis(e);
  };

  const hasContent = !!resumeText.trim() || (!!resumeImages && resumeImages.length > 0);
  const analysisButtonDisabled = isLoading || isUrlProcessing || !hasContent;

  return (
    <div className="rounded-[var(--site-radius)] border border-[var(--site-border)] bg-[var(--site-surface)] p-6 sm:p-8 animate-slide-in-up">
      <div className="text-center mb-8">
        <h2 className="text-xl sm:text-2xl font-semibold text-[var(--site-text)] tracking-tight">
          {t('upload_title')}
        </h2>
        <p className="mt-2 text-[var(--site-text-muted)] max-w-2xl mx-auto">
          {t('upload_subtitle')}
        </p>
      </div>

      <form onSubmit={handleFormSubmit} className="space-y-6 max-w-3xl mx-auto">

        <div className="space-y-2">
            <label
              htmlFor="market-select"
              className="flex items-center justify-center gap-2 text-sm font-medium text-[var(--site-text)]"
            >
                <Globe className="h-5 w-5 text-gray-500 dark:text-gray-400" aria-hidden="true" />
                {t('upload_market_label')}
            </label>
            <select
                id="market-select"
                value={market}
                onChange={(e) => setMarket(e.target.value)}
                className="w-full max-w-xs mx-auto block bg-[var(--site-surface)] border border-[var(--site-border)] text-[var(--site-text)] text-base rounded-[var(--site-radius)] focus:ring-2 focus:ring-[var(--site-action)]/40 focus:border-[var(--site-action)] p-3 transition"
            >
                {SUPPORTED_MARKETS.map((marketName) => (
                    <option key={marketName} value={marketName}>{marketName}</option>
                ))}
            </select>
        </div>

        {(storedResumeFile || isSavingResumeFile) && (
          <div className="flex items-center gap-3 rounded-[var(--site-radius)] border border-[var(--site-border)] bg-[var(--site-surface-muted)] p-3 text-sm">
            <FileText className="h-5 w-5 shrink-0 text-[var(--site-action)]" aria-hidden="true" />
            {isSavingResumeFile ? (
              <span className="min-w-0 flex-1 text-[var(--site-text-muted)]">{t('resume_file_saving')}</span>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate text-[var(--site-text)]" title={storedResumeFile?.name ?? undefined}>
                  {storedResumeFile?.name || t('resume_file_stored_label')}
                </span>
                {safeHttpUrl(storedResumeFile?.url) && (
                  <a
                    href={safeHttpUrl(storedResumeFile?.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 font-semibold text-[var(--site-action)] hover:underline"
                  >
                    {t('resume_file_download')}
                  </a>
                )}
                {onRemoveResumeFile && (
                  <button
                    type="button"
                    onClick={() => setRemoveFileConfirmOpen(true)}
                    className="shrink-0 text-[var(--site-text-muted)] hover:text-[var(--site-risk)] hover:underline"
                  >
                    {t('resume_file_remove')}
                  </button>
                )}
              </>
            )}
          </div>
        )}

        <div className="mb-6 grid grid-cols-1 gap-2 rounded-[var(--site-radius)] bg-[var(--site-surface-muted)] p-1.5 sm:grid-cols-3 sm:gap-3">
            <InputMethodButton label={t('upload_tab_paste')} active={activeTab==='paste'} disabled={isParsing || Boolean(isSavingResumeFile)} onClick={() => handleTabChange('paste')} icon={<ClipboardPaste className="h-5 w-5" aria-hidden="true" />} />
            <InputMethodButton label={t('upload_tab_upload')} active={activeTab==='upload'} disabled={isParsing || Boolean(isSavingResumeFile)} onClick={() => handleTabChange('upload')} icon={<Upload className="h-5 w-5" aria-hidden="true" />} />
            <InputMethodButton label={t('upload_tab_url')} active={activeTab==='url'} disabled={isParsing || Boolean(isSavingResumeFile)} onClick={() => handleTabChange('url')} icon={<Link2 className="h-5 w-5" aria-hidden="true" />} />
        </div>

        <div className="min-h-[250px]">
          {activeTab === 'paste' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-in">
                <div>
                    <label
                      htmlFor="resume-text"
                      className="block text-sm font-medium text-[var(--site-text)] mb-2"
                    >
                        {t('upload_resume_text_label')}
                    </label>
                    <textarea
                        id="resume-text"
                        className="w-full h-[260px] sm:h-[380px] bg-[var(--site-surface)] border border-[var(--site-border)] text-[var(--site-text)] text-base rounded-[var(--site-radius)] focus:ring-2 focus:ring-[var(--site-action)]/40 focus:border-[var(--site-action)] block p-4 transition placeholder:text-[var(--site-text-muted)] disabled:bg-[var(--site-surface-muted)] disabled:cursor-not-allowed"
                        placeholder={t('upload_resume_text_placeholder')}
                        value={resumeText}
                        onChange={handleTextChange}
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-[var(--site-text)] mb-2">{t('upload_preview_label')}</label>
                    <ResumePreview resumeText={resumeText} market={market} t={t} />
                </div>
            </div>
          )}
            {activeTab === 'upload' && (
                <div className="w-full animate-fade-in space-y-3">
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      disabled={isParsing || Boolean(isSavingResumeFile)}
                      className="hidden"
                      accept={RESUME_FILE_ACCEPT}
                      aria-label={t('upload_file_input_aria')}
                    />
                    {resumeImages && resumeImages.length > 0 ? (
                         <div className="text-center p-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl">
                            <p className="text-green-700 dark:text-green-400 font-semibold">
                              {resumeImages.length > 1
                                ? formatMessage('upload_image_ready_pages', { count: resumeImages.length })
                                : t('upload_image_ready_single')}
                            </p>
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              disabled={isParsing || Boolean(isSavingResumeFile)}
                              className="mt-2 text-sm text-blue-600 hover:underline disabled:cursor-wait disabled:opacity-60 dark:text-blue-400"
                            >
                              {t('upload_change_file')}
                            </button>
                         </div>
                    ) : (
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isParsing || Boolean(isSavingResumeFile)}
                          aria-busy={isParsing || Boolean(isSavingResumeFile)}
                          className="w-full rounded-xl border-2 border-dashed border-gray-300 p-8 text-center transition-colors hover:border-blue-500 disabled:cursor-wait disabled:opacity-60 dark:border-gray-600"
                        >
                           <p className="mt-2 font-semibold">{isParsing ? t('upload_processing') : t('upload_click_upload')}</p>
                        </button>
                    )}
                </div>
            )}
            {activeTab === 'url' && (
                <div className="space-y-4 animate-fade-in">
                    <input
                        type="url"
                        className="w-full bg-white dark:bg-slate-900 border-2 border-gray-200 dark:border-slate-600 rounded-xl p-4"
                        placeholder={t('upload_url_placeholder')}
                        value={urlInput}
                        onChange={(e) => { setUrlInput(e.target.value); setError(null); }}
                        disabled={isUrlProcessing}
                        aria-label={t('upload_url_input_aria')}
                    />
                    <button
                        type="button"
                        onClick={handleUrlImport}
                        disabled={isUrlProcessing || !urlInput.trim()}
                        aria-busy={isUrlProcessing}
                        className="w-full rounded-xl bg-gray-700 px-6 py-3 font-bold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-400"
                    >
                        {isUrlProcessing ? t('upload_importing') : t('upload_import_url')}
                    </button>
                </div>
            )}
        </div>

        {error && (
          <div role="alert" className="bg-[var(--site-risk-bg)] text-[var(--site-risk)] p-4 rounded-[var(--site-radius)] border border-[var(--site-risk)]/20">
            <p>{error}</p>
          </div>
        )}
        {infoMessage && (
          <div role="status" aria-live="polite" className="bg-[var(--site-surface-muted)] text-[var(--site-text)] p-4 rounded-[var(--site-radius)] border border-[var(--site-border)]">
            <p>{infoMessage}</p>
          </div>
        )}

        <div className="text-center pt-4">
            <button
              type="submit"
              disabled={analysisButtonDisabled}
              aria-disabled={analysisButtonDisabled}
              className="w-full max-w-xs flex items-center justify-center bg-[var(--site-action)] hover:bg-[var(--site-action-hover)] disabled:cursor-not-allowed disabled:opacity-50 text-white font-semibold py-3.5 px-6 rounded-[var(--site-radius)] transition-all mx-auto"
            >
              {isLoading ? t('upload_analyzing') : t('upload_button_analyze')}
            </button>
        </div>
      </form>
      <ConfirmActionDialog
        open={removeFileConfirmOpen}
        title={t('resume_file_remove')}
        description="Remove the saved resume file from your account? Your pasted resume text stays in the editor."
        detail={storedResumeFile?.name ?? undefined}
        cancelLabel="Cancel"
        confirmLabel={t('resume_file_remove')}
        loadingLabel={t('resume_file_saving')}
        loading={Boolean(isSavingResumeFile)}
        tone="danger"
        onOpenChange={(open) => {
          if (!open && !isSavingResumeFile) setRemoveFileConfirmOpen(false);
        }}
        onCancel={() => {
          if (!isSavingResumeFile) setRemoveFileConfirmOpen(false);
        }}
        onConfirm={() => {
          onRemoveResumeFile?.();
          setRemoveFileConfirmOpen(false);
        }}
      />
    </div>
  );
};

export default UploadSection;
