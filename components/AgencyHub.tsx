import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { AppSession as Session } from "../lib/data";
import type { UserProfile, BulkAnalysisItem } from "../types";
import {
  analyzeResume,
  anonymizeResume,
  calculateCompatibility,
  generateClientPitchEmail,
  generateCandidatePrepKit,
  extractTextFromUrl,
} from "../services/aiClient";
import { parseFile } from "../services/fileHelpers";
import { getResumeFileValidationIssue, RESUME_FILE_ACCEPT } from "../lib/resumeFileValidation";
import { SUPPORTED_MARKETS, DEFAULT_MARKET } from "../config";
import { createSecureRandomToken } from "../lib/secureRandomId";
import { DownloadButtons } from "./tools/ToolUtils";
import { listActiveEmployerJobs, type JobPosting } from "../lib/recruitingData";
import { useToast } from "./Toast";
import { ViewportAwareDialog } from "./ViewportAwareDialog";
import ConfirmActionDialog from "./ConfirmActionDialog";
import {
  BarChart3,
  BookOpen,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  CloudUpload,
  Eye,
  FileText,
  History,
  Loader2,
  Mail,
  Plus,
  Settings,
  SlidersHorizontal,
  Star,
  Trash2,
  TrendingUp,
  Users,
  X,
} from "lucide-react";

interface AgencyHubProps {
  session: Session;
  profile: UserProfile;
  t: (key: string) => string;
}

// --- UI Sub-Components for the Redesign ---

interface HubSettings {
  autoOpenResult: boolean;
  focusCompletedAfterRun: boolean;
  denseTable: boolean;
}

type AgencyFilter = "all" | "complete" | "analyzing" | "error";
type TranslationFn = (key: string) => string;
type QueuedBulkAnalysisItem = BulkAnalysisItem & { fileObj?: File };

interface AgencyFilterCounts {
  all: number;
  complete: number;
  analyzing: number;
  error: number;
}

const ACCEPTED_RESUME_TYPES = RESUME_FILE_ACCEPT;

const formatTranslation = (
  template: string,
  values: Record<string, string | number>,
) =>
  Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
    template,
  );

const createFileId = () => createSecureRandomToken();

const isAcceptedResumeFile = (file: File) =>
  getResumeFileValidationIssue(file) === null;

const buildPostedJobBrief = (job: JobPosting, t: TranslationFn) => {
  const sections = [
    job.title,
    job.company_name ? `${t("agency_job_context_company")}: ${job.company_name}` : null,
    job.location ? `${t("agency_job_context_location")}: ${job.location}` : null,
    job.salary_range ? `${t("agency_job_context_salary")}: ${job.salary_range}` : null,
    job.description?.trim() ? `\n${job.description.trim()}` : null,
  ].filter(Boolean);

  return sections.join("\n");
};

const agencyStatusLabel = (
  status: BulkAnalysisItem["status"],
  t: TranslationFn,
) => {
  const labels: Record<BulkAnalysisItem["status"], string> = {
    queued: t("agency_status_queued"),
    parsing: t("agency_status_parsing"),
    analyzing: t("agency_status_analyzing"),
    complete: t("agency_status_complete"),
    error: t("agency_status_error"),
  };
  return labels[status];
};

const AgencyHeader = ({
  onOpenSettings,
  onOpenHistory,
  title,
  subtitle,
  iconColor,
  settingsLabel,
  historyLabel,
}: {
  onOpenSettings: () => void;
  onOpenHistory: () => void;
  title: string;
  subtitle: string;
  iconColor: string;
  settingsLabel: string;
  historyLabel: string;
}) => (
  <div className="bg-slate-900 text-white p-4 sm:p-6 rounded-t-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center shadow-lg gap-4">
    <div className="flex items-start sm:items-center gap-3 sm:gap-4 w-full sm:w-auto">
      <div className={`${iconColor} p-3 rounded-xl shadow-lg flex-shrink-0`}>
        <BarChart3 className="h-8 w-8 text-white" />
      </div>
      <div>
        <h2 className="text-xl font-bold tracking-wide sm:text-2xl">
          {title}
        </h2>
        <p className="mt-1 text-sm leading-5 text-slate-400">{subtitle}</p>
      </div>
    </div>
    <div className="flex gap-3 w-full sm:w-auto sm:justify-end">
      <button
        type="button"
        onClick={onOpenSettings}
        className="flex min-h-10 flex-1 items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-lg transition-colors border border-slate-700 text-slate-200 sm:flex-none"
        aria-label={settingsLabel}
      >
        <Settings className="h-5 w-5 text-blue-400" />
        <span className="font-medium text-sm">
          {settingsLabel}
        </span>
      </button>
      <button
        type="button"
        onClick={onOpenHistory}
        className="inline-flex min-h-10 min-w-10 items-center justify-center bg-green-600 hover:bg-green-700 p-2.5 rounded-lg sm:rounded-full shadow-lg transition-colors border border-green-500"
        title={historyLabel}
        aria-label={historyLabel}
      >
        <History className="h-5 w-5 text-white" />
      </button>
    </div>
  </div>
);

const ToggleRow = ({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) => (
  <label className="flex items-start justify-between gap-4 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 cursor-pointer">
    <span>
      <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
        {title}
      </span>
      <span className="mt-1 block text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
        {description}
      </span>
    </span>
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      className="mt-1 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
    />
  </label>
);

const AgencySettingsModal = ({
  settings,
  onChange,
  onClose,
  t,
}: {
  settings: HubSettings;
  onChange: (settings: HubSettings) => void;
  onClose: () => void;
  t: TranslationFn;
}) => {
  const update = (patch: Partial<HubSettings>) =>
    onChange({ ...settings, ...patch });

  return (
    <ViewportAwareDialog open onClose={onClose} closeOnBackdrop labelledBy="agency-settings-title" maxWidth={512} zIndex={90}>
      <div className="rounded-2xl bg-gray-50 shadow-2xl dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 dark:border-slate-800 p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-blue-600 p-2 text-white">
              <SlidersHorizontal className="h-5 w-5" />
            </div>
            <div>
              <h3
                id="agency-settings-title"
                className="text-lg font-bold text-gray-900 dark:text-gray-100"
              >
                {t("agency_settings_title")}
              </h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {t("agency_settings_desc")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800"
            aria-label={t("agency_settings_close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3 p-5">
          <ToggleRow
            title={t("agency_setting_auto_open_title")}
            description={t("agency_setting_auto_open_desc")}
            checked={settings.autoOpenResult}
            onChange={(checked) => update({ autoOpenResult: checked })}
          />
          <ToggleRow
            title={t("agency_setting_focus_done_title")}
            description={t("agency_setting_focus_done_desc")}
            checked={settings.focusCompletedAfterRun}
            onChange={(checked) => update({ focusCompletedAfterRun: checked })}
          />
          <ToggleRow
            title={t("agency_setting_dense_rows_title")}
            description={t("agency_setting_dense_rows_desc")}
            checked={settings.denseTable}
            onChange={(checked) => update({ denseTable: checked })}
          />
        </div>
      </div>
    </ViewportAwareDialog>
  );
};

const statusTone = (status: BulkAnalysisItem["status"]) => {
  if (status === "complete")
    return "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800";
  if (status === "error")
    return "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800";
  if (status === "analyzing" || status === "parsing")
    return "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800";
  return "bg-gray-50 text-gray-600 border-gray-200 dark:bg-slate-800 dark:text-gray-300 dark:border-slate-700";
};

const isPendingAnalysisStatus = (status: BulkAnalysisItem["status"]) =>
  status === "queued" || status === "error";

const isProcessingStatus = (status: BulkAnalysisItem["status"]) =>
  status === "parsing" || status === "analyzing";

const getAgencyScore = (
  file: BulkAnalysisItem,
  mode: "general" | "matching",
) => (mode === "matching" ? file.matchScore || 0 : file.result?.score || 0);

const getAgencySummary = (
  file: BulkAnalysisItem,
  mode: "general" | "matching",
) => (mode === "matching" ? file.matchSummary : file.result?.summary);

const getCandidateDisplayName = (file: BulkAnalysisItem) =>
  file.candidateName || file.fileName;

const AgencyHistoryModal = ({
  files,
  mode,
  onClose,
  t,
}: {
  files: BulkAnalysisItem[];
  mode: "general" | "matching";
  onClose: () => void;
  t: TranslationFn;
}) => {
  const recent = [...files].reverse();

  return (
    <ViewportAwareDialog open onClose={onClose} closeOnBackdrop labelledBy="agency-history-title" maxWidth={672} zIndex={90}>
      <div className="flex min-h-[360px] flex-col rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 dark:border-slate-800 p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-green-600 p-2 text-white">
              <History className="h-5 w-5" />
            </div>
            <div>
              <h3
                id="agency-history-title"
                className="text-lg font-bold text-gray-900 dark:text-gray-100"
              >
                {t("agency_history_title")}
              </h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {formatTranslation(t("agency_history_desc"), {
                  mode:
                    mode === "matching"
                      ? t("agency_history_mode_matching")
                      : t("agency_history_mode_general"),
                })}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800"
            aria-label={t("agency_history_close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto p-5">
          {recent.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 dark:border-slate-700 p-8 text-center">
              <Clock3 className="mx-auto h-8 w-8 text-gray-400" />
              <p className="mt-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
                {t("agency_history_empty_title")}
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {t("agency_history_empty_desc")}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {recent.map((file) => {
                const score =
                  mode === "matching" ? file.matchScore : file.result?.score;
                return (
                  <div
                    key={file.id}
                    className="rounded-xl border border-gray-200 dark:border-slate-700 p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {file.candidateName || file.fileName}
                        </p>
                        <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                          {file.fileName}
                        </p>
                        {(file.matchSummary ||
                          file.result?.summary ||
                          file.error) && (
                          <p className="mt-2 line-clamp-2 text-sm text-gray-600 dark:text-gray-300">
                            {file.error ||
                              file.matchSummary ||
                              file.result?.summary}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {typeof score === "number" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {score}
                          </span>
                        )}
                        <span
                          className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(file.status)}`}
                        >
                          {agencyStatusLabel(file.status, t)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </ViewportAwareDialog>
  );
};

const workflowStepTone = (
  state: "done" | "active" | "attention" | "idle",
) => {
  if (state === "done")
    return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200";
  if (state === "attention")
    return "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100";
  if (state === "active")
    return "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-100";
  return "border-gray-200 bg-white text-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-300";
};

const AgencyWorkflowPanel: React.FC<{
  mode: "general" | "matching";
  files: BulkAnalysisItem[];
  hasJobDescription: boolean;
  selectedJobTitle?: string;
  isAnalyzing: boolean;
  t: TranslationFn;
}> = ({ mode, files, hasJobDescription, selectedJobTitle, isAnalyzing, t }) => {
  const pending = files.filter(
    (file) => file.status === "queued" || file.status === "error",
  ).length;
  const inProgress = files.filter(
    (file) => file.status === "parsing" || file.status === "analyzing",
  ).length;
  const completed = files.filter((file) => file.status === "complete").length;
  const needsBrief = mode === "matching" && !hasJobDescription;

  const steps = [
    {
      label: t("agency_workflow_step_brief"),
      value:
        mode === "matching"
          ? hasJobDescription
            ? selectedJobTitle || t("agency_workflow_custom_brief")
            : t("agency_workflow_missing_brief")
          : t("agency_workflow_market_ready"),
      state: needsBrief ? "attention" : "done",
      icon: BriefcaseBusiness,
    },
    {
      label: t("agency_workflow_step_resumes"),
      value:
        files.length > 0
          ? formatTranslation(t("agency_workflow_resume_count"), {
              count: files.length,
              pending,
            })
          : t("agency_workflow_no_resumes"),
      state: files.length > 0 ? "done" : "idle",
      icon: FileText,
    },
    {
      label: t("agency_workflow_step_results"),
      value: isAnalyzing
        ? t("agency_workflow_processing")
        : completed > 0
          ? formatTranslation(t("agency_workflow_completed_count"), {
              count: completed,
            })
          : t("agency_workflow_waiting"),
      state: isAnalyzing ? "active" : completed > 0 ? "done" : "idle",
      icon: CheckCircle2,
    },
  ] as const;

  const readiness =
    isAnalyzing
      ? t("agency_workflow_running")
      : files.length === 0
        ? t("agency_workflow_add_resumes")
        : needsBrief
          ? t("agency_workflow_add_brief")
          : pending > 0 || inProgress > 0
            ? t("agency_workflow_ready_to_run")
            : t("agency_workflow_all_done");

  return (
    <div className="border-b border-gray-100 bg-slate-50 px-4 py-4 dark:border-slate-700 dark:bg-slate-900/40 sm:px-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-3">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <div
                key={step.label}
                className={`flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${workflowStepTone(step.state)}`}
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase text-current/70">
                    {step.label}
                  </p>
                  <p className="truncate text-sm font-semibold">
                    {step.value}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
        <div className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-gray-200">
          {readiness}
        </div>
      </div>
    </div>
  );
};

const AgencyCommandCenter: React.FC<{
  mode: "general" | "matching";
  files: BulkAnalysisItem[];
  pendingAnalysisCount: number;
  completedCount: number;
  errorCount: number;
  hasJobDescription: boolean;
  selectedJobTitle?: string;
  market: string;
  isAnalyzing: boolean;
  canRunAnalysis: boolean;
  onPrimaryAction: () => void;
  t: TranslationFn;
}> = ({
  mode,
  files,
  pendingAnalysisCount,
  completedCount,
  errorCount,
  hasJobDescription,
  selectedJobTitle,
  market,
  isAnalyzing,
  canRunAnalysis,
  onPrimaryAction,
  t,
}) => {
  const needsBrief = mode === "matching" && !hasJobDescription;
  const needsFiles = files.length === 0;
  // When the only suggested action is "Upload resumes" the dropzone right below
  // already does that — the button would just duplicate it, so hide it. Keep it
  // for the distinct states (Add brief / Run queue / Review results).
  const showPrimaryAction = needsBrief || !needsFiles;
  const primaryDisabled =
    isAnalyzing ||
    (!needsBrief && !needsFiles && pendingAnalysisCount > 0 && !canRunAnalysis);
  const primaryLabel = isAnalyzing
    ? t("agency_command_processing")
    : needsBrief
      ? t("agency_command_add_brief")
      : needsFiles
        ? t("agency_command_upload_resumes")
        : pendingAnalysisCount > 0
          ? t("agency_command_run_queue")
          : t("agency_command_review_results");
  const primaryIcon = isAnalyzing
    ? Loader2
    : needsBrief
      ? BriefcaseBusiness
      : needsFiles
        ? CloudUpload
        : pendingAnalysisCount > 0
          ? BarChart3
          : CheckCircle2;
  const PrimaryIcon = primaryIcon;
  const helperText =
    mode === "matching"
      ? t("agency_command_desc_matching")
      : t("agency_command_desc_general");
  const contextLabel =
    mode === "matching"
      ? selectedJobTitle || t("agency_workflow_custom_brief")
      : market;

  const metrics = [
    {
      label: t("agency_command_files_metric"),
      value: files.length,
      tone: "bg-white text-gray-900 dark:bg-slate-900 dark:text-gray-100",
    },
    {
      label: t("agency_command_pending_metric"),
      value: pendingAnalysisCount,
      tone: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300",
    },
    {
      label: t("agency_command_completed_metric"),
      value: completedCount,
      tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300",
    },
    {
      label: t("agency_command_attention_metric"),
      value: errorCount,
      tone: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-200",
    },
  ];

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
              {t("agency_command_title")}
            </p>
            <span className="rounded-full border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 dark:border-slate-700 dark:text-gray-300">
              {contextLabel}
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600 dark:text-gray-400">
            {helperText}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[420px]">
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className={`rounded-xl border border-gray-200 px-3 py-2 text-center dark:border-slate-700 ${metric.tone}`}
            >
              <p className="text-xl font-bold">{metric.value}</p>
              <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide opacity-75">
                {metric.label}
              </p>
            </div>
          ))}
        </div>
      </div>

      {showPrimaryAction && (
        <div className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-4 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
            <span className="font-semibold text-gray-900 dark:text-gray-100">
              {t("agency_command_next_action")}
            </span>{" "}
            {primaryLabel}
          </p>
          <button
            type="button"
            onClick={onPrimaryAction}
            disabled={primaryDisabled}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600 dark:disabled:bg-slate-700 dark:disabled:text-gray-400"
          >
            <PrimaryIcon className={`h-4 w-4 ${isAnalyzing ? "animate-spin" : ""}`} />
            {primaryLabel}
          </button>
        </div>
      )}
    </section>
  );
};

const AgencyModeGuide: React.FC<{
  mode: "general" | "matching";
  hasJobDescription: boolean;
  onUsePostedJob: () => void;
  onPasteBrief: () => void;
  onUploadResumes: () => void;
  t: TranslationFn;
}> = ({
  mode,
  hasJobDescription,
  onUsePostedJob,
  onPasteBrief,
  onUploadResumes,
  t,
}) => {
  const matching = mode === "matching";
  const steps = [
    {
      title: t("agency_workflow_step_brief"),
      description: matching
        ? hasJobDescription
          ? t("agency_workflow_ready_to_run")
          : t("agency_workflow_add_brief")
        : t("agency_workflow_market_ready"),
      Icon: BriefcaseBusiness,
    },
    {
      title: t("agency_workflow_step_resumes"),
      description: matching
        ? t("agency_drop_rank_hint")
        : t("agency_drop_browse_hint"),
      Icon: FileText,
    },
    {
      title: t("agency_workflow_step_results"),
      description: t("agency_mode_guide_results_desc"),
      Icon: CheckCircle2,
    },
  ];

  return (
    <section className="animate-panel-expand rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
            {t("agency_mode_guide_title")}
          </p>
          <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-400">
            {matching
              ? t("agency_mode_guide_matching_desc")
              : t("agency_mode_guide_general_desc")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {matching && !hasJobDescription && (
            <>
              <button
                type="button"
                onClick={onUsePostedJob}
                className="inline-flex min-h-9 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
              >
                {t("agency_mode_guide_select_job")}
              </button>
              <button
                type="button"
                onClick={onPasteBrief}
                className="inline-flex min-h-9 items-center justify-center rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-slate-700 dark:text-gray-200 dark:hover:bg-slate-700"
              >
                {t("agency_jd_tab_paste")}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onUploadResumes}
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            <CloudUpload className="h-4 w-4" aria-hidden="true" />
            {t("agency_mode_guide_upload")}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {steps.map((step) => {
          const Icon = step.Icon;
          return (
            <div
              key={step.title}
              className="rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-slate-700 dark:bg-slate-900/50"
            >
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-blue-600 dark:text-blue-300" aria-hidden="true" />
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {step.title}
                </p>
              </div>
              <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                {step.description}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
};

const QueueStatusList: React.FC<{
  files: BulkAnalysisItem[];
  onRemove: (id: string) => void;
  t: TranslationFn;
}> = ({ files, onRemove, t }) => {
  const activeFiles = files.filter(
    (file) =>
      file.status === "queued" ||
      file.status === "parsing" ||
      file.status === "analyzing",
  );

  if (activeFiles.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm animate-fade-in dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-center gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-700/40">
        <Clock3 className="h-5 w-5 text-blue-600 dark:text-blue-300" />
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t("agency_queue_in_progress_title")}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("agency_queue_in_progress_desc")}
          </p>
        </div>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-slate-700">
        {activeFiles.map((file) => {
          const isBusy =
            file.status === "parsing" || file.status === "analyzing";
          return (
            <div
              key={file.id}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-center gap-3">
                <CandidateAvatar name={file.fileName} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {file.fileName}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {isBusy
                      ? t("agency_workflow_processing")
                      : t("agency_workflow_resume_queue")}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 sm:flex-shrink-0">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(file.status)}`}
                >
                  {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {agencyStatusLabel(file.status, t)}
                </span>
                {!isBusy && (
                  <button
                    type="button"
                    onClick={() => onRemove(file.id)}
                    className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-gray-500 dark:hover:bg-red-900/20 dark:hover:text-red-300"
                    title={t("agency_action_remove")}
                    aria-label={t("agency_action_remove")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const FilterTabs = ({
  currentFilter,
  setFilter,
  counts,
  t,
}: {
  currentFilter: AgencyFilter;
  setFilter: (f: AgencyFilter) => void;
  counts: AgencyFilterCounts;
  t: TranslationFn;
}) => (
  <div className="flex gap-2 overflow-x-auto px-4 py-3 bg-white dark:bg-slate-800 border-b border-gray-100 dark:border-slate-700 sm:flex-wrap sm:px-6 sm:py-4">
    {[
      { id: "all" as const, label: t("agency_filter_all"), count: counts.all },
      {
        id: "complete" as const,
        label: t("agency_filter_done"),
        count: counts.complete,
        color: "text-green-600",
      },
      {
        id: "analyzing" as const,
        label: t("agency_filter_in_progress"),
        count: counts.analyzing,
        color: "text-blue-600",
      },
      {
        id: "error" as const,
        label: t("agency_filter_attention"),
        count: counts.error,
        color: "text-red-600",
      },
    ].map((tab) => (
      <button
        key={tab.id}
        type="button"
        onClick={() => setFilter(tab.id)}
        aria-pressed={currentFilter === tab.id}
        className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold transition-all ${
          currentFilter === tab.id
            ? "bg-slate-900 dark:bg-slate-600 text-white shadow-md"
            : "bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600"
        }`}
      >
        {tab.label}{" "}
        <span
          className={`ml-1 ${currentFilter === tab.id ? "text-slate-300" : tab.color || "text-gray-500"}`}
        >
          ({tab.count})
        </span>
      </button>
    ))}
  </div>
);

const AnalysisResultModal = ({
  file,
  onClose,
  t,
}: {
  file: BulkAnalysisItem;
  onClose: () => void;
  t: TranslationFn;
}) => {
  if (!file.result) return null;
  const { score, summary, strengths, improvements, keywords } = file.result;

  return (
    <ViewportAwareDialog open onClose={onClose} closeOnBackdrop labelledBy="agency-analysis-title" maxWidth={672} zIndex={80}>
      <div className="flex min-h-[420px] flex-col rounded-2xl bg-white shadow-2xl dark:bg-slate-800">
        <div className="flex-shrink-0 flex items-center justify-between p-6 border-b border-gray-100 dark:border-slate-700">
          <div className="flex items-center gap-4">
            <CandidateAvatar name={file.fileName} />
            <div>
              <h3
                id="agency-analysis-title"
                className="text-xl font-bold text-gray-900 dark:text-gray-100"
              >
                {file.fileName}
              </h3>
              <p className="text-sm text-gray-500">
                {t("agency_analysis_report_subtitle")}
              </p>
            </div>
          </div>
          <button type="button"
            onClick={onClose}
            aria-label={t("job_form_close")}
            className="p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-full transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-grow overflow-y-auto p-6 space-y-6">
          {/* Score Section */}
          <div className="flex items-center gap-6 p-4 bg-gray-50 dark:bg-slate-700/50 rounded-xl">
            <div className="text-center min-w-[80px]">
              <div
                className={`text-3xl font-extrabold ${score >= 80 ? "text-green-600" : score >= 60 ? "text-yellow-600" : "text-red-600"}`}
              >
                {score}
              </div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {t("agency_table_score")}
              </div>
            </div>
            <p className="text-gray-700 dark:text-gray-300 text-sm leading-relaxed">
              {summary}
            </p>
          </div>

          {/* Strengths */}
          <div>
            <h4 className="font-bold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" aria-hidden="true" />
              {t("agency_analysis_strengths")}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {strengths.map((s, i) => (
                <div
                  key={i}
                  className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-800 rounded-lg text-sm text-green-800 dark:text-green-200"
                >
                  {s}
                </div>
              ))}
            </div>
          </div>

          {/* Improvements */}
          <div>
            <h4 className="font-bold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full bg-yellow-500"
                aria-hidden="true"
              />
              {t("agency_analysis_improvements")}
            </h4>
            <div className="space-y-3">
              {improvements.map((imp, i) => (
                <div
                  key={i}
                  className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-100 dark:border-yellow-800 rounded-lg"
                >
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-200 mb-1">
                    {imp.area}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {imp.suggestion}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Keywords */}
          <div>
            <h4 className="font-bold text-gray-900 dark:text-gray-100 mb-3">
              {t("agency_analysis_keywords")}
            </h4>
            <div className="flex flex-wrap gap-2">
              {keywords.map((k, i) => (
                <span
                  key={i}
                  className="px-2.5 py-1 bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 rounded-full text-xs font-medium"
                >
                  {k}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-900/50 rounded-b-2xl text-right">
          <button type="button"
            onClick={onClose}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-sm transition-colors"
          >
            {t("agency_analysis_close_report")}
          </button>
        </div>
      </div>
    </ViewportAwareDialog>
  );
};

const CandidateAvatar: React.FC<{ name: string }> = ({ name }) => {
  const initials =
    (name || "?")
      .split(" ")
      .map((n) => n[0] ?? "")
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  // Deterministic color based on name length
  const colors = [
    "bg-blue-100 text-blue-700",
    "bg-green-100 text-green-700",
    "bg-purple-100 text-purple-700",
    "bg-yellow-100 text-yellow-700",
    "bg-pink-100 text-pink-700",
    "bg-indigo-100 text-indigo-700",
  ];
  const colorClass = colors[(name || "").length % colors.length];

  return (
    <div
      className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${colorClass} border border-white shadow-sm flex-shrink-0`}
    >
      {initials}
    </div>
  );
};

const ScoreBar: React.FC<{ score: number }> = ({ score }) => {
  let colorClass = "bg-red-500";
  if (score >= 80) colorClass = "bg-green-500";
  else if (score >= 60) colorClass = "bg-yellow-500";

  return (
    <div className="w-full max-w-[100px]">
      <div className="flex justify-between text-xs mb-1">
        <span
          className={`font-bold ${score >= 80 ? "text-green-600" : score >= 60 ? "text-yellow-600" : "text-red-600"}`}
        >
          {score}%
        </span>
      </div>
      <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
        <div
          className={`h-1.5 rounded-full ${colorClass} transition-all duration-1000`}
          style={{ width: `${score}%` }}
        ></div>
      </div>
    </div>
  );
};

const TableSkeleton: React.FC<{ t: TranslationFn }> = ({ t }) => (
  <div
    role="status"
    aria-live="polite"
    className="rounded-xl border border-blue-100 bg-blue-50/70 p-4 animate-panel-expand dark:border-blue-900/50 dark:bg-blue-950/20"
  >
    <div className="mb-4 flex items-start gap-3">
      <div className="rounded-lg bg-blue-600 p-2 text-white">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
      <div>
        <p className="text-sm font-bold text-blue-950 dark:text-blue-100">
          {t("agency_results_processing_title")}
        </p>
        <p className="mt-1 text-sm text-blue-800 dark:text-blue-200">
          {t("agency_results_processing_desc")}
        </p>
      </div>
    </div>
    <div className="animate-pulse space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center space-x-4">
          <div className="rounded-full bg-gray-200 dark:bg-slate-700 h-10 w-10"></div>
          <div className="flex-1 space-y-2 py-1">
            <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-3/4"></div>
            <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-1/2"></div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

const AgencyResultsEmptyState: React.FC<{
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}> = ({ title, description, actionLabel, onAction }) => (
  <div className="animate-panel-expand rounded-xl border border-dashed border-gray-300 bg-white px-4 py-8 text-center dark:border-slate-700 dark:bg-slate-800 sm:px-6">
    <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-gray-300">
      <FileText className="h-5 w-5" aria-hidden="true" />
    </div>
    <p className="mt-3 text-sm font-bold text-gray-900 dark:text-gray-100">
      {title}
    </p>
    <p className="mx-auto mt-1 max-w-lg text-sm leading-6 text-gray-500 dark:text-gray-400">
      {description}
    </p>
    {actionLabel && onAction && (
      <button
        type="button"
        onClick={onAction}
        className="mt-4 inline-flex min-h-9 items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
      >
        {actionLabel}
      </button>
    )}
  </div>
);

const ResultActionButton: React.FC<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className: string;
  children: React.ReactNode;
}> = ({ label, onClick, disabled, className, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    title={label}
    aria-label={label}
  >
    {children}
  </button>
);

const AgencyResultActions: React.FC<{
  file: BulkAnalysisItem;
  mode: "general" | "matching";
  canGeneratePrep: boolean;
  onViewAnalysis: (file: BulkAnalysisItem) => void;
  onAnonymize: (id: string) => void;
  onPrep: (id: string) => void;
  onPitch: (id: string) => void;
  onRemove: (id: string) => void;
  t: TranslationFn;
}> = ({
  file,
  mode,
  canGeneratePrep,
  onViewAnalysis,
  onAnonymize,
  onPrep,
  onPitch,
  onRemove,
  t,
}) => (
  <div className="flex items-center justify-end gap-2">
    {mode === "general" && (
      <ResultActionButton
        label={t("agency_action_view_analysis")}
        onClick={() => onViewAnalysis(file)}
        className="bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
      >
        <Eye className="h-4 w-4" />
      </ResultActionButton>
    )}
    <ResultActionButton
      label={
        file.isAnonymizing
          ? t("agency_action_anonymizing")
          : t("agency_action_blind_resume")
      }
      onClick={() => onAnonymize(file.id)}
      disabled={file.isAnonymizing}
      className={
        file.blindResumeText
          ? "bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-800/40"
          : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-700 dark:text-gray-300 dark:hover:bg-slate-600"
      }
    >
      {file.isAnonymizing ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <FileText className="h-4 w-4" />
      )}
    </ResultActionButton>
    {mode === "matching" && (
      <ResultActionButton
        label={
          file.isPrepping
            ? t("agency_action_generating_prep")
            : t("agency_action_prep_kit")
        }
        onClick={() => onPrep(file.id)}
        disabled={file.isPrepping || (!file.prepKit && !canGeneratePrep)}
        className={
          file.prepKit
            ? "bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-400 dark:hover:bg-indigo-800/40"
            : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-700 dark:text-gray-300 dark:hover:bg-slate-600"
        }
      >
        {file.isPrepping ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <BookOpen className="h-4 w-4" />
        )}
      </ResultActionButton>
    )}
    <ResultActionButton
      label={
        file.isPitching
          ? t("agency_action_generating_pitch")
          : t("agency_action_generate_pitch")
      }
      onClick={() => onPitch(file.id)}
      disabled={file.isPitching}
      className={
        file.pitchEmail
          ? "bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-900/30 dark:text-purple-400 dark:hover:bg-purple-800/40"
          : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-700 dark:text-gray-300 dark:hover:bg-slate-600"
      }
    >
      {file.isPitching ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Mail className="h-4 w-4" />
      )}
    </ResultActionButton>
    <ResultActionButton
      label={t("agency_action_remove")}
      onClick={() => onRemove(file.id)}
      className="text-gray-400 hover:bg-red-50 hover:text-red-500 dark:text-gray-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
    >
      <Trash2 className="h-4 w-4" />
    </ResultActionButton>
  </div>
);

// Lets a recruiter read a candidate's full summary inline — important in matching
// mode, where there is no per-row analysis modal (file.result is general-mode only).
const ExpandableSummary: React.FC<{
  text: string;
  clampClass: string;
  t: TranslationFn;
  name?: string;
}> = ({ text, clampClass, t, name }) => {
  const [open, setOpen] = React.useState(false);
  const isLong = (text?.length ?? 0) > 140;
  return (
    <>
      <p className={`text-sm leading-6 text-gray-600 dark:text-gray-300 ${clampClass}`}>
        {text || t("agency_analysis_pending")}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-1 text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400"
        >
          {t("agency_summary_show_more")}
        </button>
      )}
      {/* Full summary in a modal (not inline) so it never pushes the candidate
          list down — mirrors the Blind Resume / Prep Kit modal experience. */}
      {open && (
        <ViewportAwareDialog open onClose={() => setOpen(false)} closeOnBackdrop ariaLabel={name || t("agency_table_summary")} maxWidth={512} zIndex={70}>
          <div className="flex min-h-[280px] flex-col rounded-xl bg-white shadow-2xl dark:bg-slate-800">
            <div className="flex items-center justify-between border-b border-gray-100 p-4 dark:border-slate-700">
              <h3 className="font-bold text-gray-900 dark:text-gray-100">{name || t("agency_table_summary")}</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("agency_summary_show_less")}
                className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-slate-700 dark:hover:text-gray-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-y-auto whitespace-pre-wrap p-5 text-sm leading-6 text-gray-700 dark:text-gray-300">
              {text}
            </div>
          </div>
        </ViewportAwareDialog>
      )}
    </>
  );
};

const CompletedResultsList: React.FC<{
  files: BulkAnalysisItem[];
  mode: "general" | "matching";
  denseTable: boolean;
  hasJobDescription: boolean;
  onViewAnalysis: (file: BulkAnalysisItem) => void;
  onAnonymize: (id: string) => void;
  onPrep: (id: string) => void;
  onPitch: (id: string) => void;
  onRemove: (id: string) => void;
  t: TranslationFn;
}> = ({
  files,
  mode,
  denseTable,
  hasJobDescription,
  onViewAnalysis,
  onAnonymize,
  onPrep,
  onPitch,
  onRemove,
  t,
}) => {
  if (files.length === 0) return null;

  const renderActions = (file: BulkAnalysisItem) => (
    <AgencyResultActions
      file={file}
      mode={mode}
      canGeneratePrep={hasJobDescription}
      onViewAnalysis={onViewAnalysis}
      onAnonymize={onAnonymize}
      onPrep={onPrep}
      onPitch={onPitch}
      onRemove={onRemove}
      t={t}
    />
  );

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg animate-fade-in dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-col gap-1 border-b border-gray-100 bg-gray-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-700/40 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
          {t("agency_results_ready_title")}
        </p>
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
          {formatTranslation(t("agency_workflow_completed_count"), {
            count: files.length,
          })}
        </p>
      </div>

      <div className="space-y-3 p-3 md:hidden">
        {files.map((file, index) => {
          const score = getAgencyScore(file, mode);
          const summary = getAgencySummary(file, mode);
          const name = getCandidateDisplayName(file);

          return (
            <article
              key={file.id}
              className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-blue-100 bg-blue-50 text-xs font-bold text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-gray-900 dark:text-gray-100">
                      {name}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                      {file.fileName}
                    </p>
                  </div>
                </div>
                <div className="w-24 shrink-0">
                  <ScoreBar score={score} />
                </div>
              </div>
              <div className="mt-3">
                <ExpandableSummary text={summary} clampClass="line-clamp-3" t={t} name={name} />
              </div>
              <div className="mt-4 flex flex-col gap-2 border-t border-gray-100 pt-3 dark:border-slate-700">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t("agency_mobile_actions_label")}
                </p>
                {renderActions(file)}
              </div>
            </article>
          );
        })}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[640px] text-left">
          <thead className="bg-gray-50 text-xs font-semibold uppercase text-gray-700 dark:bg-slate-700/50 dark:text-gray-200">
            <tr>
              <th className="px-6 py-4">{t("agency_table_rank")}</th>
              <th className="px-6 py-4">{t("agency_table_candidate")}</th>
              <th className="w-32 px-6 py-4">{t("agency_table_score")}</th>
              <th className="px-6 py-4">{t("agency_table_summary")}</th>
              <th className="px-6 py-4 text-right">
                {t("agency_table_actions")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
            {files.map((file, index) => {
              const score = getAgencyScore(file, mode);
              const summary = getAgencySummary(file, mode);
              const name = getCandidateDisplayName(file);

              return (
                <tr
                  key={file.id}
                  className="transition-colors hover:bg-gray-50 dark:hover:bg-slate-700/50"
                >
                  <td
                    className={`w-16 whitespace-nowrap px-6 text-center font-medium ${denseTable ? "py-3" : "py-4"}`}
                  >
                    <span
                      className={`inline-flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold ${
                        index < 3
                          ? "border-blue-100 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                          : "border-gray-100 bg-gray-50 text-gray-500 dark:border-slate-600 dark:bg-slate-700 dark:text-gray-400"
                      }`}
                    >
                      {index + 1}
                    </span>
                  </td>
                  <td className={`px-6 ${denseTable ? "py-3" : "py-4"}`}>
                    <div className="flex min-w-0 items-center gap-3">
                      <CandidateAvatar name={name} />
                      <div className="min-w-0">
                        <p className="truncate font-bold text-gray-900 dark:text-gray-100">
                          {name}
                        </p>
                        <p className="max-w-[180px] truncate text-xs text-gray-500 dark:text-gray-400">
                          {file.fileName}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td
                    className={`align-middle px-6 ${denseTable ? "py-3" : "py-4"}`}
                  >
                    <ScoreBar score={score} />
                  </td>
                  <td className={`px-6 ${denseTable ? "py-3" : "py-4"}`}>
                    <ExpandableSummary text={summary} clampClass="line-clamp-2" t={t} name={name} />
                  </td>
                  <td
                    className={`px-6 text-right ${denseTable ? "py-3" : "py-4"}`}
                  >
                    {renderActions(file)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const BatchInsights: React.FC<{
  files: BulkAnalysisItem[];
  mode: "general" | "matching";
  t: TranslationFn;
}> = ({ files, mode, t }) => {
  const completed = files.filter((f) => f.status === "complete");
  if (completed.length === 0) return null;

  const avgScore = Math.round(
    completed.reduce((acc, curr) => acc + getAgencyScore(curr, mode), 0) /
      completed.length,
  );
  const highMatches = completed.filter(
    (f) => getAgencyScore(f, mode) >= 80,
  ).length;

  const topCandidate = [...completed].sort(
    (a, b) => getAgencyScore(b, mode) - getAgencyScore(a, mode),
  )[0];
  const topName =
    mode === "matching"
      ? topCandidate?.candidateName || topCandidate?.fileName
      : topCandidate?.fileName;

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm flex items-center gap-4">
        <div className="p-3 bg-blue-100 dark:bg-blue-900/30 text-blue-600 rounded-lg">
          <Users className="h-6 w-6" />
        </div>
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">
            {t("agency_insights_candidates")}
          </p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {files.length}
          </p>
        </div>
      </div>
      <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm flex items-center gap-4">
        <div className="p-3 bg-green-100 dark:bg-green-900/30 text-green-600 rounded-lg">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">
            {t("agency_insights_top_tier")}
          </p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {highMatches}
          </p>
        </div>
      </div>
      <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm flex items-center gap-4">
        <div className="p-3 bg-purple-100 dark:bg-purple-900/30 text-purple-600 rounded-lg">
          <TrendingUp className="h-6 w-6" />
        </div>
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">
            {t("agency_insights_avg_score")}
          </p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {avgScore}%
          </p>
        </div>
      </div>
      <div className="bg-gradient-to-r from-blue-600 to-indigo-700 p-4 rounded-xl border border-blue-500 shadow-sm text-white relative overflow-hidden">
        <div className="relative z-10">
          <p className="text-xs text-blue-200 font-medium uppercase tracking-wider">
            {t("agency_insights_top_performer")}
          </p>
          <p className="text-lg font-bold truncate mt-1">
            {topName || t("agency_status_analyzing")}
          </p>
          <p className="text-sm text-blue-100">
            {formatTranslation(t("agency_insights_points"), {
              score: getAgencyScore(topCandidate, mode),
            })}
          </p>
        </div>
        <div className="absolute right-0 bottom-0 opacity-10 transform translate-x-2 translate-y-2">
          <Star className="h-24 w-24" fill="currentColor" />
        </div>
      </div>
    </div>
  );
};

const PitchModal: React.FC<{
  file: BulkAnalysisItem;
  onClose: () => void;
  t: (key: string) => string;
}> = ({ file, onClose, t }) => {
  const { addToast } = useToast();
  if (!file.pitchEmail) return null;

  const copyToClipboard = async () => {
    const text = `${t("outreach_subject_copy_prefix")}: ${file.pitchEmail!.subject}\n\n${file.pitchEmail!.body}`;
    try {
      await navigator.clipboard.writeText(text);
      addToast(t("agency_pitch_copied"), "success");
    } catch {
      addToast(t("agency_pitch_copy_failed"), "error");
    }
  };

  return (
    <ViewportAwareDialog open onClose={onClose} closeOnBackdrop labelledBy="agency-pitch-title" maxWidth={672} zIndex={70}>
      <div className="flex min-h-[420px] flex-col rounded-xl bg-white shadow-2xl dark:bg-slate-800">
        <div className="flex-shrink-0 flex items-center justify-between p-4 border-b border-gray-200 dark:border-slate-700">
          <h3
            id="agency-pitch-title"
            className="text-xl font-bold text-gray-800 dark:text-gray-100"
          >
            {t("agency_pitch_modal_title")}
          </h3>
          <button type="button"
            onClick={onClose}
            aria-label={t("job_form_close")}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-full p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-grow overflow-y-auto p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t("outreach_subject_label")}
            </label>
            <input
              readOnly
              value={file.pitchEmail.subject}
              className="w-full bg-gray-50 dark:bg-slate-900 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-gray-100 rounded-md p-2 shadow-sm focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t("outreach_body_label")}
            </label>
            <textarea
              readOnly
              value={file.pitchEmail.body}
              rows={10}
              className="w-full bg-gray-50 dark:bg-slate-900 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-gray-100 rounded-md p-2 shadow-sm focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
            />
          </div>
        </div>
        <div className="flex-shrink-0 flex justify-end items-center p-4 border-t border-gray-200 dark:border-slate-700 space-x-3">
          <button type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-slate-600"
          >
            {t("job_form_close")}
          </button>
          <button type="button"
            onClick={copyToClipboard}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700"
          >
            {t("outreach_copy")}
          </button>
        </div>
      </div>
    </ViewportAwareDialog>
  );
};

const PrepKitModal: React.FC<{
  file: BulkAnalysisItem;
  onClose: () => void;
  t: TranslationFn;
}> = ({ file, onClose, t }) => {
  if (!file.prepKit) return null;

  const {
    weakSpots = [],
    keyProjects = [],
    predictedQuestions = [],
  } = file.prepKit;
  const candidateName = file.candidateName || file.fileName;

  const formatForDownload = () => {
    let content = `# ${formatTranslation(t("agency_prep_download_title"), { name: candidateName })}\n\n`;
    content += `## ${t("agency_prep_weak_spots")}\n`;
    weakSpots.forEach((item) => (content += `* ${item}\n`));
    content += `\n## ${t("agency_prep_projects")}\n`;
    keyProjects.forEach((item) => (content += `* ${item}\n`));
    content += `\n## ${t("agency_prep_questions")}\n`;
    predictedQuestions.forEach((item) => (content += `* ${item}\n`));
    return content;
  };

  return (
    <ViewportAwareDialog open onClose={onClose} closeOnBackdrop labelledBy="agency-prep-title" maxWidth={768} zIndex={70}>
      <div className="flex min-h-[480px] flex-col rounded-xl bg-white shadow-2xl dark:bg-slate-800">
        <div className="flex-shrink-0 flex items-center justify-between p-4 border-b border-gray-200 dark:border-slate-700">
          <h3
            id="agency-prep-title"
            className="text-xl font-bold text-gray-800 dark:text-gray-100"
          >
            {formatTranslation(t("agency_prep_modal_title"), {
              name: candidateName,
            })}
          </h3>
          <div className="flex items-center gap-3">
            <DownloadButtons
              textContent={formatForDownload()}
              baseFilename={`prep_kit_${candidateName.replace(/\s+/g, "_")}`}
            />
            <button type="button"
              onClick={onClose}
              aria-label={t("job_form_close")}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-full p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="flex-grow overflow-y-auto p-6 space-y-6">
          <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700/50 rounded-lg">
            <h4 className="font-bold text-yellow-800 dark:text-yellow-200 mb-2 flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full bg-yellow-500"
                aria-hidden="true"
              />
              {t("agency_prep_weak_spots")}
            </h4>
            <ul className="list-disc list-inside space-y-1 text-sm text-yellow-900 dark:text-yellow-100">
              {weakSpots.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>

          <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700/50 rounded-lg">
            <h4 className="font-bold text-green-800 dark:text-green-200 mb-2 flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full bg-green-500"
                aria-hidden="true"
              />
              {t("agency_prep_projects")}
            </h4>
            <ul className="list-disc list-inside space-y-1 text-sm text-green-900 dark:text-green-100">
              {keyProjects.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>

          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700/50 rounded-lg">
            <h4 className="font-bold text-blue-800 dark:text-blue-200 mb-2 flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full bg-blue-500"
                aria-hidden="true"
              />
              {t("agency_prep_questions")}
            </h4>
            <ul className="list-decimal list-inside space-y-1 text-sm text-blue-900 dark:text-blue-100">
              {predictedQuestions.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </ViewportAwareDialog>
  );
};

const BlindResumeModal: React.FC<{
  file: BulkAnalysisItem;
  onClose: () => void;
  t: TranslationFn;
}> = ({ file, onClose, t }) => {
  if (!file.blindResumeText) return null;

  return (
    <ViewportAwareDialog open onClose={onClose} closeOnBackdrop labelledBy="agency-blind-title" maxWidth={896} zIndex={70}>
      <div className="flex min-h-[520px] flex-col rounded-xl bg-white shadow-2xl dark:bg-slate-800">
        <div className="flex-shrink-0 flex items-center justify-between p-4 border-b border-gray-200 dark:border-slate-700">
          <h3
            id="agency-blind-title"
            className="text-xl font-bold text-gray-800 dark:text-gray-100"
          >
            {formatTranslation(t("agency_blind_modal_title"), {
              name: file.fileName,
            })}
          </h3>
          <div className="flex items-center gap-3">
            <DownloadButtons
              textContent={file.blindResumeText}
              baseFilename={`blind_resume_${file.fileName.replace(/\s+/g, "_")}`}
            />
            <button type="button"
              onClick={onClose}
              aria-label={t("job_form_close")}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-full p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="flex-grow overflow-y-auto p-6">
          <div className="p-6 border rounded-lg bg-gray-50 dark:bg-slate-900/50 font-serif text-sm whitespace-pre-wrap dark:text-gray-300">
            {file.blindResumeText}
          </div>
        </div>
      </div>
    </ViewportAwareDialog>
  );
};

const AgencyHub: React.FC<AgencyHubProps> = ({ session, profile, t }) => {
  const { addToast } = useToast();
  const [mode, setMode] = useState<"general" | "matching">("general");
  const [files, setFiles] = useState<BulkAnalysisItem[]>([]);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [removeFileTarget, setRemoveFileTarget] = useState<BulkAnalysisItem | null>(null);
  const [market, setMarket] = useState<string>(DEFAULT_MARKET);
  const [isMarketMenuOpen, setIsMarketMenuOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  // Let a long bulk run be stopped, and never setState / keep processing after
  // the recruiter navigates away mid-batch.
  const cancelBulkRef = useRef(false);
  const isMountedRef = useRef(true);
  const jdExtractingRef = useRef(false);
  const anonymizingIdsRef = useRef(new Set<string>());
  const pitchingIdsRef = useRef(new Set<string>());
  const preppingIdsRef = useRef(new Set<string>());
  useEffect(() => {
    isMountedRef.current = true;
    cancelBulkRef.current = false;
    return () => {
      isMountedRef.current = false;
      cancelBulkRef.current = true;
      jdExtractingRef.current = false;
      anonymizingIdsRef.current.clear();
      pitchingIdsRef.current.clear();
      preppingIdsRef.current.clear();
    };
  }, []);
  const [currentFilter, setCurrentFilter] = useState<AgencyFilter>("all");
  const [showDetailModal, setShowDetailModal] =
    useState<BulkAnalysisItem | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [hubSettings, setHubSettings] = useState<HubSettings>({
    autoOpenResult: true,
    focusCompletedAfterRun: true,
    denseTable: false,
  });

  // JD Input State
  const [jdSource, setJdSource] = useState<"paste" | "url" | "select">("paste");
  const [jobDescription, setJobDescription] = useState("");
  const [jdUrl, setJdUrl] = useState("");
  const [isExtractingJd, setIsExtractingJd] = useState(false);
  const [internalJobs, setInternalJobs] = useState<JobPosting[]>([]);
  const [selectedInternalJobId, setSelectedInternalJobId] =
    useState<string>("");

  const [viewPitchId, setViewPitchId] = useState<string | null>(null);
  const [viewPrepKitId, setViewPrepKitId] = useState<string | null>(null);
  const [viewBlindResumeId, setViewBlindResumeId] = useState<string | null>(
    null,
  );
  const [isLoadingJobs, setIsLoadingJobs] = useState(false);
  const [jobsFetchError, setJobsFetchError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jdPanelRef = useRef<HTMLDivElement>(null);

  const fetchInternalJobs = useCallback(async () => {
    setIsLoadingJobs(true);
    setJobsFetchError(false);
    try {
      const jobs = await listActiveEmployerJobs(session.user.id);
      if (!isMountedRef.current) return;
      setInternalJobs(jobs);
    } catch {
      if (!isMountedRef.current) return;
      setInternalJobs([]);
      setJobsFetchError(true);
    } finally {
      if (isMountedRef.current) setIsLoadingJobs(false);
    }
  }, [session.user.id]);

  // Preload active postings as soon as the recruiter enters JD matching. The
  // selector should feel ready, not like a hidden second step after tab switch.
  useEffect(() => {
    if (mode === "matching") {
      void fetchInternalJobs();
    }
  }, [mode, fetchInternalJobs]);

  const handleJdUrlImport = async () => {
    const sourceUrl = jdUrl.trim();
    if (!sourceUrl || jdExtractingRef.current) return;
    jdExtractingRef.current = true;
    setIsExtractingJd(true);
    try {
      const result = await extractTextFromUrl(sourceUrl);
      if (!isMountedRef.current) return;
      if (result.extractedText && result.extractedText.trim()) {
        setSelectedInternalJobId("");
        setJobDescription(result.extractedText);
        setJdSource("paste"); // Switch to paste mode to show result
        addToast(t("agency_jd_import_success"), "success");
      } else {
        // The page had no extractable job description — tell the user instead of
        // silently doing nothing.
        addToast(t("agency_jd_import_empty"), "error");
      }
    } catch {
      if (!isMountedRef.current) return;
      addToast(t("agency_jd_import_failed"), "error");
    } finally {
      jdExtractingRef.current = false;
      if (isMountedRef.current) setIsExtractingJd(false);
    }
  };

  const handleInternalJobSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const jobId = e.target.value;
    setSelectedInternalJobId(jobId);
    if (!jobId) {
      setJobDescription("");
      return;
    }
    const job = internalJobs.find((j) => j.id === jobId);
    if (job) {
      setJobDescription(buildPostedJobBrief(job, t));
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const processNewFiles = useCallback((newFileList: FileList | File[]) => {
    const incomingFiles = Array.from(newFileList);
    const acceptedFiles = incomingFiles.filter(isAcceptedResumeFile);
    const rejectedCount = incomingFiles.length - acceptedFiles.length;

    if (rejectedCount > 0) {
      addToast(
        formatTranslation(t("agency_files_rejected"), {
          count: rejectedCount,
          types: ACCEPTED_RESUME_TYPES,
        }),
        "error",
      );
    }

    const newItems: QueuedBulkAnalysisItem[] = acceptedFiles.map(
      (file) => ({
        id: createFileId(),
        fileName: file.name,
        status: "queued",
        fileObj: file,
      }),
    );

    if (newItems.length === 0) return;

    setFiles((prev) => [...prev, ...newItems]);
    setCurrentFilter("all");
    addToast(
      formatTranslation(t("agency_files_added"), { count: newItems.length }),
      "info",
    );
  }, [addToast, t]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processNewFiles(e.dataTransfer.files);
    }
  }, [processNewFiles]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processNewFiles(e.target.files);
    }
    e.target.value = "";
  };

  const runBulkAnalysis = async () => {
    if (mode === "matching" && !jobDescription.trim()) {
      addToast(t("agency_jd_required"), "error");
      return;
    }

    const queue = files.filter(
      (f) => isPendingAnalysisStatus(f.status),
    ) as QueuedBulkAnalysisItem[];

    if (queue.length === 0) {
      addToast(t("agency_no_new_files"), "info");
      return;
    }

    cancelBulkRef.current = false;
    setIsAnalyzing(true);

    // Update UI to show parsing state
    setFiles((prev) =>
      prev.map((f) =>
        queue.find((q) => q.id === f.id) ? { ...f, status: "parsing" } : f,
      ),
    );

    const processFile = async (item: QueuedBulkAnalysisItem) => {
      try {
        if (!item.fileObj) {
          throw new Error("Missing queued file");
        }

        // 1. Parse File
        const parsed = await parseFile(item.fileObj);
        const resumeText = parsed.text || "";

        // 2. Update UI to analyzing state
        setFiles((prev) =>
          prev.map((f) =>
            f.id === item.id
              ? { ...f, status: "analyzing", text: resumeText }
              : f,
          ),
        );

        // 3. Analyze based on mode
        if (mode === "general") {
          const result = await analyzeResume(
            resumeText,
            parsed.images || null,
            market,
          );
          setFiles((prev) =>
            prev.map((f) =>
              f.id === item.id ? { ...f, status: "complete", result } : f,
            ),
          );
          if (hubSettings.autoOpenResult && queue.length === 1) {
            setShowDetailModal({
              ...item,
              status: "complete",
              result,
            } as BulkAnalysisItem);
          }
        } else {
          // Matching Mode
          const matchResult = await calculateCompatibility(
            resumeText,
            jobDescription,
          );
          setFiles((prev) =>
            prev.map((f) =>
              f.id === item.id
                ? {
                    ...f,
                    status: "complete",
                    matchScore: matchResult.compatibilityScore,
                    matchSummary: matchResult.summary,
                    candidateName: matchResult.candidateName || item.fileName,
                  }
                : f,
            ),
          );
        }
      } catch {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === item.id
              ? {
                  ...f,
                  status: "error",
                  error: t("agency_file_process_failed"),
                }
              : f,
          ),
        );
      }
    };

    // Execute sequentially to avoid rate limiting. Stop early if the recruiter
    // hit Stop or navigated away.
    for (const item of queue) {
      if (cancelBulkRef.current || !isMountedRef.current) break;
      await processFile(item);
    }

    if (!isMountedRef.current) return;
    const wasCancelled = cancelBulkRef.current;
    cancelBulkRef.current = false;
    if (wasCancelled) {
      // All queued items were flipped to "parsing" up front, but only one is processed
      // at a time — return the not-yet-processed ones to "queued" so they aren't stuck
      // with a spinner (and the remove/retry controls, hidden while busy, work again).
      setFiles((prev) => prev.map((f) =>
        f.status === "parsing" || f.status === "analyzing" ? { ...f, status: "queued" } : f,
      ));
    }
    setIsAnalyzing(false);
    if (hubSettings.focusCompletedAfterRun) setCurrentFilter("complete");
    addToast(
      wasCancelled ? t("agency_analysis_stopped") : t("agency_analysis_complete"),
      wasCancelled ? "info" : "success",
    );
  };

  const handleAnonymize = async (id: string) => {
    const file = files.find((f) => f.id === id);
    if (!file || !file.text || file.isAnonymizing || anonymizingIdsRef.current.has(id)) return;
    anonymizingIdsRef.current.add(id);

    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, isAnonymizing: true } : f)),
    );

    try {
      const result = await anonymizeResume(
        file.text,
        profile.company_name || "Agency",
      );
      if (!isMountedRef.current) return;
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id
            ? {
                ...f,
                isAnonymizing: false,
                blindResumeText: result.anonymizedText,
              }
            : f,
        ),
      );
      setViewBlindResumeId(id);
    } catch {
      if (!isMountedRef.current) return;
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id
            ? {
                ...f,
                isAnonymizing: false,
                error: t("agency_blind_resume_failed"),
              }
            : f,
        ),
      );
      addToast(t("agency_blind_resume_failed"), "error");
    } finally {
      anonymizingIdsRef.current.delete(id);
    }
  };

  const handleGeneratePitch = async (id: string) => {
    const file = files.find((f) => f.id === id);
    if (!file || !file.text || file.isPitching || pitchingIdsRef.current.has(id)) return;
    pitchingIdsRef.current.add(id);

    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, isPitching: true } : f)),
    );

    try {
      const name = file.candidateName || file.fileName;
      const jd = mode === "matching" ? jobDescription : undefined;
      const result = await generateClientPitchEmail(file.text, name, jd);
      if (!isMountedRef.current) return;
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id ? { ...f, isPitching: false, pitchEmail: result } : f,
        ),
      );
      setViewPitchId(id);
    } catch {
      if (!isMountedRef.current) return;
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id
            ? { ...f, isPitching: false, error: t("agency_pitch_failed") }
            : f,
        ),
      );
      addToast(t("agency_pitch_failed"), "error");
    } finally {
      pitchingIdsRef.current.delete(id);
    }
  };

  const handleGeneratePrepKit = async (id: string) => {
    const file = files.find((f) => f.id === id);
    if (!file || !file.text || file.isPrepping || preppingIdsRef.current.has(id)) return;
    if (!jobDescription.trim()) {
      addToast(t("agency_jd_required"), "error");
      return;
    }
    preppingIdsRef.current.add(id);

    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, isPrepping: true } : f)),
    );

    try {
      const result = await generateCandidatePrepKit(file.text, jobDescription);
      if (!isMountedRef.current) return;
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id ? { ...f, isPrepping: false, prepKit: result } : f,
        ),
      );
      setViewPrepKitId(id);
    } catch {
      if (!isMountedRef.current) return;
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id
            ? { ...f, isPrepping: false, error: t("agency_prep_kit_failed") }
            : f,
        ),
      );
      addToast(t("agency_prep_kit_failed"), "error");
    } finally {
      preppingIdsRef.current.delete(id);
    }
  };

  const removeFile = (id: string) => {
    anonymizingIdsRef.current.delete(id);
    pitchingIdsRef.current.delete(id);
    preppingIdsRef.current.delete(id);
    setFiles((prev) => prev.filter((f) => f.id !== id));
    if (viewPitchId === id) setViewPitchId(null);
    if (viewPrepKitId === id) setViewPrepKitId(null);
    if (viewBlindResumeId === id) setViewBlindResumeId(null);
    if (showDetailModal?.id === id) setShowDetailModal(null);
    setRemoveFileTarget(null);
  };

  const requestRemoveFile = (id: string) => {
    const target = files.find((file) => file.id === id);
    if (target) setRemoveFileTarget(target);
  };

  const handleBlindResumeAction = (id: string) => {
    const file = files.find((f) => f.id === id);
    if (!file) return;
    if (file.blindResumeText) {
      setViewBlindResumeId(id);
      return;
    }
    void handleAnonymize(id);
  };

  const handlePrepKitAction = (id: string) => {
    const file = files.find((f) => f.id === id);
    if (!file) return;
    if (file.prepKit) {
      setViewPrepKitId(id);
      return;
    }
    void handleGeneratePrepKit(id);
  };

  const handlePitchAction = (id: string) => {
    const file = files.find((f) => f.id === id);
    if (!file) return;
    if (file.pitchEmail) {
      setViewPitchId(id);
      return;
    }
    void handleGeneratePitch(id);
  };

  const sortedFiles = useMemo(
    () =>
      [...files].sort(
        (a, b) => getAgencyScore(b, mode) - getAgencyScore(a, mode),
      ),
    [files, mode],
  );

  const displayFiles = useMemo(
    () =>
      sortedFiles.filter(
        (f) =>
          currentFilter === "all" ||
          f.status === currentFilter ||
          (currentFilter === "analyzing" && isProcessingStatus(f.status)),
      ),
    [currentFilter, sortedFiles],
  );

  const completedDisplayFiles = useMemo(
    () => displayFiles.filter((f) => f.status === "complete"),
    [displayFiles],
  );
  const errorDisplayFiles = useMemo(
    () => displayFiles.filter((f) => f.status === "error"),
    [displayFiles],
  );

  const counts: AgencyFilterCounts = useMemo(
    () => ({
      all: files.length,
      complete: files.filter((f) => f.status === "complete").length,
      analyzing: files.filter((f) => isProcessingStatus(f.status)).length,
      error: files.filter((f) => f.status === "error").length,
    }),
    [files],
  );

  const activePitchFile = viewPitchId
    ? files.find((f) => f.id === viewPitchId)
    : null;
  const activePrepKitFile = viewPrepKitId
    ? files.find((f) => f.id === viewPrepKitId)
    : null;
  const activeBlindResumeFile = viewBlindResumeId
    ? files.find((f) => f.id === viewBlindResumeId)
    : null;
  const selectedInternalJob = selectedInternalJobId
    ? internalJobs.find((job) => job.id === selectedInternalJobId) ?? null
    : null;
  const hasJobDescription = jobDescription.trim().length > 0;
  const pendingAnalysisCount = files.filter(
    (file) => isPendingAnalysisStatus(file.status),
  ).length;
  const completedCount = counts.complete;
  const errorCount = counts.error;
  const canRunAnalysis =
    !isAnalyzing &&
    pendingAnalysisCount > 0 &&
    !(mode === "matching" && !hasJobDescription);
  const handleCommandPrimaryAction = () => {
    if (isAnalyzing) return;
    if (mode === "matching" && !hasJobDescription) {
      setJdSource(internalJobs.length > 0 ? "select" : "paste");
      requestAnimationFrame(() => {
        jdPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      return;
    }
    if (files.length === 0) {
      fileInputRef.current?.click();
      return;
    }
    if (pendingAnalysisCount > 0 && canRunAnalysis) {
      void runBulkAnalysis();
      return;
    }
    if (completedCount > 0) {
      setCurrentFilter("complete");
    }
  };

  const activeHeader =
    mode === "general"
      ? {
          title: t("agency_mode_general_title"),
          subtitle: t("agency_mode_general_subtitle"),
          color: "bg-orange-500",
        }
      : {
          title: t("agency_mode_matching_title"),
          subtitle: t("agency_mode_matching_subtitle"),
          color: "bg-blue-600",
        };

  return (
    <div className="space-y-6 animate-fade-in pb-12 sm:space-y-8">
      {activePitchFile && (
        <PitchModal
          file={activePitchFile}
          onClose={() => setViewPitchId(null)}
          t={t}
        />
      )}
      {activePrepKitFile && (
        <PrepKitModal
          file={activePrepKitFile}
          onClose={() => setViewPrepKitId(null)}
          t={t}
        />
      )}
      {activeBlindResumeFile && (
        <BlindResumeModal
          file={activeBlindResumeFile}
          onClose={() => setViewBlindResumeId(null)}
          t={t}
        />
      )}
      {showDetailModal && (
        <AnalysisResultModal
          file={showDetailModal}
          onClose={() => setShowDetailModal(null)}
          t={t}
        />
      )}
      {showSettingsModal && (
        <AgencySettingsModal
          settings={hubSettings}
          onChange={setHubSettings}
          onClose={() => setShowSettingsModal(false)}
          t={t}
        />
      )}
      {showHistoryModal && (
        <AgencyHistoryModal
          files={files}
          mode={mode}
          onClose={() => setShowHistoryModal(false)}
          t={t}
        />
      )}

      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-gray-100 sm:text-3xl">
            {t("portal_nav_agency_hub")}
          </h1>
          <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400 sm:text-base">
            {t("agency_page_subtitle")}
          </p>
        </div>
        {mode === "general" && (
          <div
            className="relative flex w-full items-center gap-3 md:w-auto"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setIsMarketMenuOpen(false);
            }}
          >
            <button
              type="button"
              aria-haspopup="listbox"
              aria-expanded={isMarketMenuOpen}
              onClick={() => setIsMarketMenuOpen((open) => !open)}
              className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-left text-sm font-semibold text-gray-900 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 md:min-w-40"
            >
              <span>{market}</span>
              <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${isMarketMenuOpen ? "rotate-180" : ""}`} />
            </button>
            {isMarketMenuOpen && (
              <div
                role="listbox"
                className="absolute right-0 top-full z-20 mt-2 w-full min-w-40 overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
              >
                {SUPPORTED_MARKETS.map((m) => {
                  const selected = m === market;
                  return (
                    <button
                      key={m}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setMarket(m);
                        setIsMarketMenuOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-semibold ${
                        selected
                          ? "bg-slate-100 text-slate-950 dark:bg-slate-800 dark:text-white"
                          : "text-gray-600 hover:bg-gray-50 hover:text-gray-950 dark:text-slate-300 dark:hover:bg-slate-800/70 dark:hover:text-white"
                      }`}
                    >
                      <span>{m}</span>
                      {selected && <Check className="h-4 w-4 text-slate-500 dark:text-slate-300" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </header>

      {/* Mode Switcher */}
      <div className="flex justify-center">
        <div className="grid w-full grid-cols-2 rounded-xl bg-gray-100 p-1 dark:bg-slate-800/50 sm:w-auto">
          <button
            type="button"
            onClick={() => {
              setMode("general");
            }}
            className={`min-h-10 rounded-lg px-4 py-2 text-sm font-semibold transition-all sm:px-6 ${
              mode === "general"
                ? "bg-white dark:bg-slate-700 shadow text-blue-600 dark:text-blue-400"
                : "text-gray-500 hover:text-gray-700 dark:text-gray-400"
            }`}
          >
            {t("agency_mode_general_title")}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("matching");
            }}
            className={`min-h-10 rounded-lg px-4 py-2 text-sm font-semibold transition-all sm:px-6 ${
              mode === "matching"
                ? "bg-white dark:bg-slate-700 shadow text-blue-600 dark:text-blue-400"
                : "text-gray-500 hover:text-gray-700 dark:text-gray-400"
            }`}
          >
            {t("agency_mode_matching_title")}
          </button>
        </div>
      </div>

      <AgencyCommandCenter
        mode={mode}
        files={files}
        pendingAnalysisCount={pendingAnalysisCount}
        completedCount={completedCount}
        errorCount={errorCount}
        hasJobDescription={hasJobDescription}
        selectedJobTitle={selectedInternalJob?.title}
        market={market}
        isAnalyzing={isAnalyzing}
        canRunAnalysis={canRunAnalysis}
        onPrimaryAction={handleCommandPrimaryAction}
        t={t}
      />

      {/* Main Container */}
      <div className="rounded-2xl bg-gray-50 p-1 dark:bg-slate-900/50 sm:p-2">
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 overflow-hidden">
          <AgencyHeader
            onOpenSettings={() => setShowSettingsModal(true)}
            onOpenHistory={() => setShowHistoryModal(true)}
            title={activeHeader.title}
            subtitle={activeHeader.subtitle}
            iconColor={activeHeader.color}
            settingsLabel={t("agency_header_settings")}
            historyLabel={t("agency_header_history")}
          />
          <FilterTabs
            currentFilter={currentFilter}
            setFilter={setCurrentFilter}
            counts={counts}
            t={t}
          />
          <AgencyWorkflowPanel
            mode={mode}
            files={files}
            hasJobDescription={hasJobDescription}
            selectedJobTitle={selectedInternalJob?.title}
            isAnalyzing={isAnalyzing}
            t={t}
          />

          <div className="space-y-5 p-4 sm:space-y-6 sm:p-6">
            {/* JD Input for Matching Mode */}
            {mode === "matching" && (
              <div ref={jdPanelRef} className="bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-xl p-4 animate-fade-in scroll-mt-6 sm:p-6">
                <label className="block text-sm font-bold text-blue-900 dark:text-blue-100 mb-3">
                  {t("agency_jd_step_label")}
                </label>

                {/* JD Source Tabs */}
                <div className="flex flex-wrap gap-2 mb-4 border-b border-blue-200 dark:border-blue-800 pb-2">
                  <button
                    type="button"
                    onClick={() => setJdSource("paste")}
                    className={`px-3 py-1 text-sm font-medium rounded-t-md transition-colors ${jdSource === "paste" ? "text-blue-700 dark:text-blue-400 border-b-2 border-blue-700 dark:border-blue-400" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"}`}
                    aria-pressed={jdSource === "paste"}
                  >
                    {t("agency_jd_tab_paste")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setJdSource("url")}
                    className={`px-3 py-1 text-sm font-medium rounded-t-md transition-colors ${jdSource === "url" ? "text-blue-700 dark:text-blue-400 border-b-2 border-blue-700 dark:border-blue-400" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"}`}
                    aria-pressed={jdSource === "url"}
                  >
                    {t("agency_jd_tab_url")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setJdSource("select")}
                    className={`px-3 py-1 text-sm font-medium rounded-t-md transition-colors ${jdSource === "select" ? "text-blue-700 dark:text-blue-400 border-b-2 border-blue-700 dark:border-blue-400" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"}`}
                    aria-pressed={jdSource === "select"}
                  >
                    {t("agency_jd_tab_posted")}
                  </button>
                  {mode === "matching" && internalJobs.length > 0 && (
                    <span className="ml-auto inline-flex items-center rounded-full border border-blue-200 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 dark:border-blue-800 dark:bg-slate-900 dark:text-blue-300">
                      {formatTranslation(t("agency_active_jobs_count"), {
                        count: internalJobs.length,
                      })}
                    </span>
                  )}
                </div>

                {/* Inputs based on source */}
                {jdSource === "paste" && (
                  <textarea
                    value={jobDescription}
                    onChange={(e) => {
                      setSelectedInternalJobId("");
                      setJobDescription(e.target.value);
                    }}
                    placeholder={t("agency_jd_paste_placeholder")}
                    className="min-h-32 w-full resize-y rounded-lg border border-blue-300 bg-white p-3 text-sm text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500"
                  />
                )}

                {jdSource === "url" && (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="url"
                      value={jdUrl}
                      onChange={(e) => setJdUrl(e.target.value)}
                      placeholder="https://company.com/careers/job-123"
                      className="min-h-11 flex-1 rounded-lg border border-blue-300 bg-white p-3 text-sm text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500"
                    />
                    <button
                      type="button"
                      onClick={handleJdUrlImport}
                      disabled={isExtractingJd || !jdUrl.trim()}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-2 font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isExtractingJd && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}
                      {isExtractingJd
                        ? t("agency_jd_importing")
                        : t("agency_jd_import")}
                    </button>
                  </div>
                )}

                {jdSource === "select" &&
                  (isLoadingJobs ? (
                    <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 py-2">
                      <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      {t("agency_loading_posted_jobs")}
                    </div>
                  ) : jobsFetchError ? (
                    <div className="flex items-center justify-between gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg text-sm text-red-700 dark:text-red-300">
                      <span>{t("agency_jobs_load_failed")}</span>
                      <button
                        type="button"
                        onClick={fetchInternalJobs}
                        className="text-xs font-semibold underline hover:no-underline"
                      >
                        {t("agency_retry")}
                      </button>
                    </div>
                  ) : (
                    <select
                      value={selectedInternalJobId}
                      onChange={handleInternalJobSelect}
                      className="min-h-11 w-full rounded-lg border border-blue-300 bg-white p-3 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100"
                    >
                      <option value="">
                        {t("agency_select_job_placeholder")}
                      </option>
                      {internalJobs.length === 0 && (
                        <option disabled value="">
                          {t("agency_no_active_jobs")}
                        </option>
                      )}
                      {internalJobs.map((job) => (
                        <option key={job.id} value={job.id}>
                          {job.title}{job.location ? ` — ${job.location}` : ""}
                        </option>
                      ))}
                    </select>
                  ))}

                {selectedInternalJob && (
                  <div className="mt-4 animate-panel-expand rounded-xl border border-blue-200 bg-white p-4 text-sm shadow-sm dark:border-blue-800 dark:bg-slate-900">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
                          {t("agency_selected_job_label")}
                        </p>
                        <p className="mt-1 truncate text-base font-bold text-gray-900 dark:text-gray-100">
                          {selectedInternalJob.title}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-600 dark:text-gray-400">
                          <span>{selectedInternalJob.location || t("talent_location_remote")}</span>
                          {selectedInternalJob.salary_range && (
                            <span>{selectedInternalJob.salary_range}</span>
                          )}
                          {!selectedInternalJob.description?.trim() && (
                            <span className="font-semibold text-amber-700 dark:text-amber-300">
                              {t("agency_selected_job_missing_description")}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                          {t("agency_selected_job_ready")}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedInternalJobId("");
                            setJobDescription("");
                          }}
                          className="text-xs font-semibold text-blue-700 underline-offset-2 hover:underline dark:text-blue-300"
                        >
                          {t("agency_selected_job_clear")}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-4 flex flex-col gap-2 text-xs text-blue-800 dark:text-blue-200 sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    {selectedInternalJob
                      ? t("agency_jd_helper_posted")
                      : t("agency_jd_helper_manual")}
                  </span>
                  <span>
                    {formatTranslation(t("agency_jd_length"), {
                      count: jobDescription.trim().length,
                    })}
                  </span>
                </div>
              </div>
            )}

            {/* File Drop Area */}
            {files.length === 0 ? (
              <div className="space-y-4">
                <AgencyModeGuide
                  mode={mode}
                  hasJobDescription={hasJobDescription}
                  onUsePostedJob={() => setJdSource("select")}
                  onPasteBrief={() => setJdSource("paste")}
                  onUploadResumes={() => fileInputRef.current?.click()}
                  t={t}
                />
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  aria-label={t("agency_drop_title")}
                  className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors sm:p-10 ${
                    isDragging
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                      : "border-gray-300 dark:border-slate-600 hover:border-blue-400 dark:hover:border-blue-500 bg-gray-50 dark:bg-slate-700/30"
                  }`}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    multiple
                    onChange={handleFileInput}
                    accept={ACCEPTED_RESUME_TYPES}
                  />
                  <div className="bg-white dark:bg-slate-700 p-4 rounded-full inline-block shadow-sm mb-4">
                    <CloudUpload className="h-10 w-10 text-blue-600 dark:text-blue-400" />
                  </div>
                  <p className="text-xl font-medium text-gray-900 dark:text-gray-100">
                    {t("agency_drop_title")}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                    {mode === "matching"
                      ? t("agency_drop_rank_hint")
                      : t("agency_drop_browse_hint")}
                  </p>
                  <p className="mt-2 text-xs font-medium text-gray-400 dark:text-gray-500">
                    {t("agency_drop_formats")}
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Actions Toolbar */}
                <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-slate-600 dark:bg-slate-700/50 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-800 dark:text-blue-400 dark:hover:bg-blue-900/20 dark:hover:text-blue-300"
                    >
                      <Plus className="h-4 w-4" />
                      {t("agency_add_more")}
                    </button>
                    <p className="mt-1 px-2 text-xs text-gray-500 dark:text-gray-400">
                      {formatTranslation(t("agency_toolbar_summary"), {
                        pending: pendingAnalysisCount,
                        done: completedCount,
                      })}
                    </p>
                  </div>
                  <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    multiple
                    onChange={handleFileInput}
                    accept={ACCEPTED_RESUME_TYPES}
                  />

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <button
                      type="button"
                      onClick={() => {
                        if (files.length > 0) setClearConfirmOpen(true);
                      }}
                      className="inline-flex min-h-10 items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/20"
                      disabled={isAnalyzing}
                    >
                      {t("agency_clear_all")}
                    </button>
                    {isAnalyzing && (
                      <button
                        type="button"
                        onClick={() => { cancelBulkRef.current = true; }}
                        className="inline-flex min-h-10 items-center justify-center rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
                      >
                        {t("agency_stop")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={runBulkAnalysis}
                      disabled={!canRunAnalysis}
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300 dark:disabled:bg-blue-900/50"
                    >
                      {isAnalyzing && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      )}
                      {isAnalyzing
                        ? t("agency_processing")
                        : mode === "matching"
                          ? t("agency_rank_candidates")
                          : t("agency_analyze_queue")}
                    </button>
                  </div>
                </div>
                {mode === "matching" && !hasJobDescription && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-100">
                    {t("agency_matching_empty_jd_hint")}
                  </div>
                )}
                <QueueStatusList
                  files={displayFiles}
                  onRemove={requestRemoveFile}
                  t={t}
                />
                {currentFilter === "complete" &&
                  completedDisplayFiles.length === 0 && (
                    <AgencyResultsEmptyState
                      title={t("agency_no_completed_results")}
                      description={
                        isAnalyzing
                          ? t("agency_results_processing_desc")
                          : t("agency_results_empty_filter_desc")
                      }
                    />
                  )}
                {currentFilter === "error" && errorDisplayFiles.length === 0 && (
                  <AgencyResultsEmptyState
                    title={t("agency_results_no_attention_title")}
                    description={t("agency_results_no_attention_desc")}
                  />
                )}

                {/* Batch Insights */}
                <BatchInsights files={files} mode={mode} t={t} />

                {/* Error file list — shown when filter is 'error' */}
                {currentFilter === "error" && errorDisplayFiles.length > 0 && (
                  <div className="space-y-2 animate-fade-in">
                    {errorDisplayFiles.map((file) => (
                      <div
                        key={file.id}
                        className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-700 dark:bg-red-900/20 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <CandidateAvatar name={file.fileName} />
                          <div className="min-w-0">
                            <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                              {file.fileName}
                            </p>
                            <p className="text-xs text-red-600 dark:text-red-400 truncate">
                              {file.error || t("agency_analysis_failed")}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-2 sm:ml-4">
                          <button
                            type="button"
                            onClick={() =>
                              setFiles((prev) =>
                                prev.map((f) =>
                                  f.id === file.id
                                    ? {
                                        ...f,
                                        status: "queued",
                                        error: undefined,
                                      }
                                    : f,
                                ),
                              )
                            }
                            className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            {t("agency_retry")}
                          </button>
                          <button
                            type="button"
                            onClick={() => requestRemoveFile(file.id)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-full"
                            title={t("agency_action_remove")}
                            aria-label={t("agency_action_remove")}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <CompletedResultsList
                  files={completedDisplayFiles}
                  mode={mode}
                  denseTable={hubSettings.denseTable}
                  hasJobDescription={hasJobDescription}
                  onViewAnalysis={setShowDetailModal}
                  onAnonymize={handleBlindResumeAction}
                  onPrep={handlePrepKitAction}
                  onPitch={handlePitchAction}
                  onRemove={requestRemoveFile}
                  t={t}
                />

                {completedDisplayFiles.length === 0 &&
                  currentFilter !== "complete" &&
                  currentFilter !== "error" &&
                  (isAnalyzing ? (
                    <TableSkeleton t={t} />
                  ) : pendingAnalysisCount > 0 ? (
                    <AgencyResultsEmptyState
                      title={t("agency_results_waiting_title")}
                      description={t("agency_results_waiting_desc")}
                      actionLabel={
                        canRunAnalysis ? t("agency_command_run_queue") : undefined
                      }
                      onAction={
                        canRunAnalysis ? () => void runBulkAnalysis() : undefined
                      }
                    />
                  ) : null)}
              </div>
            )}
          </div>
        </div>
      </div>
      <ConfirmActionDialog
        open={clearConfirmOpen}
        title={t("agency_clear_all")}
        description={t("agency_clear_all_confirm")}
        detail={`${files.length} file${files.length === 1 ? "" : "s"}`}
        cancelLabel={t("dashboard_cancel_update")}
        confirmLabel={t("agency_clear_all")}
        tone="danger"
        onOpenChange={(open) => {
          if (!open) setClearConfirmOpen(false);
        }}
        onCancel={() => setClearConfirmOpen(false)}
        onConfirm={() => {
          setFiles([]);
          setClearConfirmOpen(false);
        }}
      />
      <ConfirmActionDialog
        open={Boolean(removeFileTarget)}
        title={t("agency_action_remove")}
        description="Remove this resume from the agency workspace?"
        detail={removeFileTarget?.fileName}
        cancelLabel={t("dashboard_cancel_update")}
        confirmLabel={t("agency_action_remove")}
        tone="danger"
        onOpenChange={(open) => {
          if (!open) setRemoveFileTarget(null);
        }}
        onCancel={() => setRemoveFileTarget(null)}
        onConfirm={() => {
          if (removeFileTarget) removeFile(removeFileTarget.id);
        }}
      />
    </div>
  );
};

export default AgencyHub;
