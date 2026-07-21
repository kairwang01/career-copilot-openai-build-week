import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BookmarkCheck,
  Briefcase,
  CheckCircle2,
  ClipboardCopy,
  Download,
  FileText,
  MailCheck,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Users,
  XCircle,
} from "lucide-react";
import { PortalTopBar } from "../PortalTopBar";
import ConfirmActionDialog from "../../ConfirmActionDialog";
import type { PortalPage } from "../PortalSidebar";
import type { AppSession as Session } from "../../../lib/data";
import {
  listShortlist,
  removeFromShortlist,
  updateShortlistEntry,
  type ShortlistEntry,
  type ShortlistStatus,
} from "../../../lib/shortlistData";
import { useToast as useSharedToast } from "../../Toast";

interface PortalShortlistProps {
  session: Session;
  darkMode: boolean;
  t: (key: string) => string;
  onNavigate: (page: PortalPage) => void;
}

type TranslationFn = (key: string) => string;

// ---- helpers ----------------------------------------------------------------

function escapeCSVField(value: string): string {
  let s = String(value ?? "");
  // Neutralize spreadsheet formula injection: a candidate-controlled value
  // starting with = + - @ (or a leading tab/CR) is executed as a formula by
  // Excel/Sheets/LibreOffice. Prefix an apostrophe so the cell is treated as
  // text. Runs BEFORE quoting so a value with both a formula char and a comma
  // gets both protections.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function formatTranslation(
  template: string,
  values: Record<string, string | number>,
): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

function exportCSV(
  entries: ShortlistEntry[],
  t: TranslationFn,
): void {
  const headers = [
    t("shortlist_csv_candidate_name"),
    t("shortlist_csv_current_role"),
    t("shortlist_csv_skills"),
    t("shortlist_csv_match_score"),
    t("shortlist_csv_match_reasons"),
    t("shortlist_csv_associated_job"),
    t("shortlist_csv_status"),
    t("shortlist_csv_notes"),
    t("shortlist_csv_saved_at"),
  ];

  const rows = entries.map((e) => [
    escapeCSVField(e.candidate_name),
    escapeCSVField(e.candidate_snapshot.current_role ?? ""),
    escapeCSVField((e.candidate_snapshot.skills ?? []).join("; ")),
    escapeCSVField(String(e.match_score)),
    escapeCSVField(e.match_reasons.join("; ")),
    escapeCSVField(e.job_title),
    escapeCSVField(e.status),
    escapeCSVField(e.notes),
    escapeCSVField(new Date(e.saved_at).toLocaleString()),
  ]);

  const csvContent = [
    headers.map(escapeCSVField).join(","),
    ...rows.map((r) => r.join(",")),
  ].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = t("shortlist_export_filename");
  a.click();
  URL.revokeObjectURL(url);
}

function buildOutreachMessage(
  entry: ShortlistEntry,
  t: TranslationFn,
): string {
  const roleLine = entry.candidate_snapshot.current_role
    ? formatTranslation(t("shortlist_outreach_role_line"), {
        role: entry.candidate_snapshot.current_role,
      })
    : "";
  const skills =
    (entry.candidate_snapshot.skills ?? []).length > 0
      ? formatTranslation(t("shortlist_outreach_skills_line"), {
          skills: entry.candidate_snapshot.skills!.slice(0, 3).join(", "),
        })
      : "";
  return formatTranslation(t("shortlist_outreach_template"), {
    name: entry.candidate_name,
    jobTitle: entry.job_title,
    score: entry.match_score,
    roleLine,
    skillsLine: skills,
  });
}

function getScoreToneClass(score: number, darkMode: boolean): string {
  if (score >= 80) {
    return darkMode ? "text-green-400" : "text-green-600";
  }
  if (score >= 60) {
    return darkMode ? "text-amber-300" : "text-amber-600";
  }
  return darkMode ? "text-red-400" : "text-red-600";
}

function ShortlistSkeleton({
  darkMode,
  t,
}: {
  darkMode: boolean;
  t: TranslationFn;
}) {
  const dm = darkMode;
  const card = dm ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200";
  const block = dm ? "bg-gray-700/70" : "bg-gray-200";

  return (
    <div role="status" aria-live="polite" className="space-y-4 animate-panel-expand">
      <span className="sr-only">{t("shortlist_loading")}</span>
      <div className={`rounded-xl border p-4 sm:p-5 ${card}`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-3">
            <div className={`h-4 w-44 rounded ${block}`} />
            <div className={`h-3 w-72 max-w-full rounded ${block}`} />
          </div>
          <div className={`h-10 w-36 rounded-lg ${block}`} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className={`rounded-xl border p-4 ${card}`}>
            <div className={`h-6 w-16 rounded ${block}`} />
            <div className={`mt-3 h-3 w-24 rounded ${block}`} />
          </div>
        ))}
      </div>
      <div className={`rounded-xl border p-4 ${card}`}>
        <div className={`h-10 w-full rounded-lg ${block}`} />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className={`h-20 rounded-lg ${block}`} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- Status chip ------------------------------------------------------------

const STATUS_STYLES: Record<ShortlistStatus, string> = {
  saved:
    "bg-blue-100 text-blue-800 border border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-700",
  contacted:
    "bg-teal-100 text-teal-800 border border-teal-200 dark:bg-teal-900/40 dark:text-teal-300 dark:border-teal-700",
  rejected:
    "bg-red-100 text-red-700 border border-red-200 dark:bg-red-900/40 dark:text-red-400 dark:border-red-700",
};

function StatusChip({
  status,
  t,
}: {
  status: ShortlistStatus;
  t: TranslationFn;
}) {
  const label = t(`shortlist_status_${status}`);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_STYLES[status]}`}
    >
      {label}
    </span>
  );
}

function CandidateProfile({
  entry,
  darkMode,
  compact = false,
}: {
  entry: ShortlistEntry;
  darkMode: boolean;
  compact?: boolean;
}) {
  const dm = darkMode;
  const skills = entry.candidate_snapshot.skills ?? [];
  const missingRequirements = entry.missing_requirements ?? [];

  return (
    <div>
      <p className={`font-semibold ${dm ? "text-white" : "text-gray-900"}`}>
        {entry.candidate_name}
      </p>
      {entry.candidate_snapshot.current_role && (
        <p className={`mt-0.5 text-xs ${dm ? "text-gray-400" : "text-gray-500"}`}>
          {entry.candidate_snapshot.current_role}
        </p>
      )}
      {skills.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {skills.slice(0, compact ? 4 : 5).map((skill) => (
            <span
              key={skill}
              className={`rounded border px-1.5 py-0.5 text-xs ${
                dm
                  ? "border-blue-700 bg-blue-900/50 text-blue-300"
                  : "border-blue-200 bg-blue-50 text-blue-700"
              }`}
            >
              {skill}
            </span>
          ))}
        </div>
      )}
      {entry.match_reasons.length > 0 && (
        <ul className={`mt-2 space-y-0.5 text-xs ${dm ? "text-green-400" : "text-green-700"}`}>
          {entry.match_reasons.slice(0, compact ? 2 : 3).map((reason, index) => (
            <li key={`${reason}-${index}`} className="flex items-start gap-1">
              <CheckCircle2 className="mt-0.5 h-3 w-3 flex-shrink-0" />
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      )}
      {missingRequirements.length > 0 && (
        <ul className={`mt-1 space-y-0.5 text-xs ${dm ? "text-red-400" : "text-red-600"}`}>
          {missingRequirements.slice(0, compact ? 1 : 2).map((requirement, index) => (
            <li key={`${requirement}-${index}`} className="flex items-start gap-1">
              <XCircle className="mt-0.5 h-3 w-3 flex-shrink-0" />
              <span>{requirement}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NotesEditor({
  entry,
  darkMode,
  t,
  isEditing,
  editNotes,
  busy,
  density = "table",
  onChangeNotes,
  onStartEdit,
  onSaveNotes,
  onCancelEdit,
}: {
  entry: ShortlistEntry;
  darkMode: boolean;
  t: TranslationFn;
  isEditing: boolean;
  editNotes: string;
  busy: boolean;
  density?: "table" | "card";
  onChangeNotes: (notes: string) => void;
  onStartEdit: (entry: ShortlistEntry) => void;
  onSaveNotes: (id: string) => void;
  onCancelEdit: () => void;
}) {
  const dm = darkMode;
  const textSize = density === "card" ? "text-sm" : "text-xs";

  if (isEditing) {
    return (
      <div className="flex flex-col gap-2 animate-panel-expand">
        <textarea
          value={editNotes}
          onChange={(event) => onChangeNotes(event.target.value)}
          rows={density === "card" ? 4 : 3}
          maxLength={2000}
          aria-label={t("shortlist_edit_notes")}
          className={`w-full rounded-lg border px-3 py-2 ${textSize} transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/30 ${
            dm
              ? "border-gray-600 bg-gray-700 text-gray-100 placeholder:text-gray-500"
              : "border-gray-300 bg-white text-gray-900 placeholder:text-gray-400"
          }`}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onSaveNotes(entry.id)}
            disabled={busy}
            className="inline-flex min-h-8 items-center justify-center rounded-lg bg-[#1d4ed8] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#1a45c9] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? t("shortlist_saving_notes") : t("shortlist_save_notes")}
          </button>
          <button
            type="button"
            onClick={onCancelEdit}
            disabled={busy}
            className={`inline-flex min-h-8 items-center justify-center rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              dm
                ? "border-gray-600 text-gray-300 hover:bg-gray-700"
                : "border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {t("shortlist_cancel")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <span className={`${textSize} flex-1 leading-relaxed ${dm ? "text-gray-300" : "text-gray-600"}`}>
        {entry.notes || (
          <span className={dm ? "text-gray-500" : "text-gray-400"}>
            {t("shortlist_no_notes")}
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={() => onStartEdit(entry)}
        aria-label={t("shortlist_edit_notes")}
        title={t("shortlist_edit_notes")}
        className={`inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400/40 ${
          dm
            ? "text-gray-400 hover:bg-gray-700 hover:text-gray-200"
            : "text-gray-500 hover:bg-gray-100 hover:text-gray-800"
        }`}
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function EntryActions({
  entry,
  darkMode,
  t,
  busyEntryId,
  layout = "icon",
  onMarkContacted,
  onCopyOutreach,
  onRemove,
}: {
  entry: ShortlistEntry;
  darkMode: boolean;
  t: TranslationFn;
  busyEntryId: string | null;
  layout?: "icon" | "stacked";
  onMarkContacted: (entry: ShortlistEntry) => void;
  onCopyOutreach: (entry: ShortlistEntry) => void;
  onRemove: (entry: ShortlistEntry) => void;
}) {
  const dm = darkMode;
  const anyBusy = Boolean(busyEntryId);
  const isContacted = entry.status === "contacted";
  const disableContact = isContacted || anyBusy;
  const disableAction = anyBusy;

  if (layout === "stacked") {
    const mobileButton =
      "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400/40 disabled:cursor-not-allowed disabled:opacity-60";

    return (
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => onCopyOutreach(entry)}
          disabled={disableAction}
          className={`${mobileButton} ${
            dm
              ? "bg-blue-950/40 text-blue-200 hover:bg-blue-900/50"
              : "bg-blue-50 text-blue-700 hover:bg-blue-100"
          }`}
        >
          <ClipboardCopy className="h-4 w-4" />
          {t("shortlist_copy_outreach")}
        </button>
        <button
          type="button"
          onClick={() => onMarkContacted(entry)}
          disabled={disableContact}
          className={`${mobileButton} ${
            disableContact
              ? dm
                ? "bg-gray-700 text-gray-500"
                : "bg-gray-100 text-gray-400"
              : dm
                ? "bg-teal-950/40 text-teal-200 hover:bg-teal-900/50"
                : "bg-teal-50 text-teal-700 hover:bg-teal-100"
          }`}
        >
          <MailCheck className="h-4 w-4" />
          {t("shortlist_mark_contacted")}
        </button>
        <button
          type="button"
          onClick={() => onRemove(entry)}
          disabled={disableAction}
          className={`${mobileButton} ${
            dm
              ? "bg-red-950/30 text-red-300 hover:bg-red-900/40"
              : "bg-red-50 text-red-600 hover:bg-red-100"
          }`}
        >
          <Trash2 className="h-4 w-4" />
          {t("shortlist_remove")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={() => onMarkContacted(entry)}
        disabled={disableContact}
        title={t("shortlist_mark_contacted")}
        aria-label={t("shortlist_mark_contacted")}
        className={`rounded-lg p-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400/40 ${
          disableContact
            ? dm
              ? "cursor-not-allowed text-gray-600"
              : "cursor-not-allowed text-gray-300"
            : dm
              ? "text-teal-400 hover:bg-teal-900/30"
              : "text-teal-600 hover:bg-teal-50"
        }`}
      >
        <MailCheck className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onCopyOutreach(entry)}
        disabled={disableAction}
        title={t("shortlist_copy_outreach")}
        aria-label={t("shortlist_copy_outreach")}
        className={`rounded-lg p-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400/40 disabled:cursor-not-allowed disabled:opacity-50 ${
          dm
            ? "text-blue-400 hover:bg-blue-900/30"
            : "text-blue-600 hover:bg-blue-50"
        }`}
      >
        <ClipboardCopy className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onRemove(entry)}
        title={t("shortlist_remove")}
        aria-label={t("shortlist_remove")}
        disabled={disableAction}
        className={`rounded-lg p-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400/40 disabled:cursor-not-allowed disabled:opacity-50 ${
          dm
            ? "text-red-400 hover:bg-red-900/30"
            : "text-red-500 hover:bg-red-50"
        }`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

// ---- Main component ---------------------------------------------------------

export function PortalShortlist({
  session,
  darkMode,
  t,
  onNavigate,
}: PortalShortlistProps) {
  const dm = darkMode;
  const employerUid = session.user.id;

  const [entries, setEntries] = useState<ShortlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ShortlistStatus>(
    "all",
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ShortlistEntry | null>(null);
  const busyEntryRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  const { addToast } = useSharedToast();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listShortlist(employerUid);
      if (!mountedRef.current) return;
      setEntries(data);
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : t("shortlist_load_error"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [employerUid, t]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleRemove = async (entry: ShortlistEntry) => {
    if (busyEntryId || busyEntryRef.current) return;
    const id = entry.id;
    busyEntryRef.current = id;
    setBusyEntryId(id);
    try {
      await removeFromShortlist(employerUid, id);
      if (!mountedRef.current) return;
      setEntries((prev) => prev.filter((e) => e.id !== id));
      setRemoveTarget(null);
      addToast(t("shortlist_removed"), "success");
    } catch {
      if (mountedRef.current) addToast(t("shortlist_action_error"), "error");
    } finally {
      busyEntryRef.current = null;
      if (mountedRef.current) setBusyEntryId(null);
    }
  };

  const handleMarkContacted = async (entry: ShortlistEntry) => {
    if (entry.status === "contacted" || busyEntryId || busyEntryRef.current) return;
    busyEntryRef.current = entry.id;
    setBusyEntryId(entry.id);
    try {
      await updateShortlistEntry(employerUid, entry.id, {
        status: "contacted",
      });
      if (!mountedRef.current) return;
      setEntries((prev) =>
        prev.map((e) =>
          e.id === entry.id ? { ...e, status: "contacted" } : e,
        ),
      );
      addToast(t("shortlist_marked_contacted"), "success");
    } catch {
      if (mountedRef.current) addToast(t("shortlist_action_error"), "error");
    } finally {
      busyEntryRef.current = null;
      if (mountedRef.current) setBusyEntryId(null);
    }
  };

  const handleCopyOutreach = (entry: ShortlistEntry) => {
    const message = buildOutreachMessage(entry, t);
    navigator.clipboard.writeText(message).then(
      () => addToast(t("shortlist_outreach_copied"), "success"),
      () => addToast(t("shortlist_action_error"), "error"),
    );
  };

  const handleStartEditNotes = (entry: ShortlistEntry) => {
    setEditingId(entry.id);
    setEditNotes(entry.notes);
  };

  const handleSaveNotes = async (id: string) => {
    if (busyEntryId || busyEntryRef.current) return;
    busyEntryRef.current = id;
    setBusyEntryId(id);
    try {
      await updateShortlistEntry(employerUid, id, { notes: editNotes });
      if (!mountedRef.current) return;
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, notes: editNotes } : e)),
      );
      addToast(t("shortlist_notes_saved"), "success");
      // Only close the editor on success — on failure keep the typed draft open so the
      // user doesn't silently lose what they wrote.
      setEditingId(null);
      setEditNotes("");
    } catch {
      if (mountedRef.current) addToast(t("shortlist_action_error"), "error");
    } finally {
      busyEntryRef.current = null;
      if (mountedRef.current) setBusyEntryId(null);
    }
  };

  const handleCancelEditNotes = () => {
    if (busyEntryId) return;
    setEditingId(null);
    setEditNotes("");
  };

  const card = dm ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200";
  const normalizedQuery = query.trim().toLowerCase();
  const filteredEntries = entries.filter((entry) => {
    const matchesStatus =
      statusFilter === "all" || entry.status === statusFilter;
    const haystack = [
      entry.candidate_name,
      entry.job_title,
      entry.candidate_snapshot.current_role ?? "",
      ...(entry.candidate_snapshot.skills ?? []),
    ]
      .join(" ")
      .toLowerCase();
    return (
      matchesStatus && (!normalizedQuery || haystack.includes(normalizedQuery))
    );
  });
  const hasActiveFilters = normalizedQuery.length > 0 || statusFilter !== "all";
  const exportEntries = hasActiveFilters ? filteredEntries : entries;
  const contactedCount = entries.filter(
    (entry) => entry.status === "contacted",
  ).length;
  const savedCount = entries.length;
  const followUpCount = entries.filter((entry) => entry.status === "saved").length;
  const avgMatch =
    entries.length > 0
      ? Math.round(
          entries.reduce((sum, entry) => sum + entry.match_score, 0) /
            entries.length,
        )
      : 0;
  const contactProgress =
    entries.length > 0 ? Math.round((contactedCount / entries.length) * 100) : 0;
  const statusFilters = [
    ["all", t("shortlist_filter_all")],
    ["saved", t("shortlist_status_saved")],
    ["contacted", t("shortlist_status_contacted")],
    ["rejected", t("shortlist_status_rejected")],
  ] as const;
  const stats = [
    {
      label: t("shortlist_stats_saved"),
      value: savedCount,
      icon: BookmarkCheck,
      tone: dm
        ? "bg-blue-950/50 text-blue-300"
        : "bg-blue-50 text-blue-700",
    },
    {
      label: t("shortlist_stats_contacted"),
      value: contactedCount,
      icon: MailCheck,
      tone: dm
        ? "bg-teal-950/50 text-teal-300"
        : "bg-teal-50 text-teal-700",
    },
    {
      label: t("shortlist_stats_avg_match"),
      value: `${avgMatch}%`,
      icon: CheckCircle2,
      tone: dm
        ? "bg-green-950/40 text-green-300"
        : "bg-green-50 text-green-700",
    },
    {
      label: t("shortlist_stats_follow_up"),
      value: followUpCount,
      icon: Users,
      tone: dm
        ? "bg-amber-950/40 text-amber-300"
        : "bg-amber-50 text-amber-700",
    },
  ];

  const clearFilters = () => {
    setQuery("");
    setStatusFilter("all");
  };

  return (
    <>
      <PortalTopBar title={t("shortlist_page_title")} darkMode={dm} />

      <div className="mx-auto max-w-[1088px] p-4 sm:p-6 lg:p-8 animate-view-fade">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className={`text-2xl font-bold ${dm ? "text-white" : "text-gray-900"}`}>
              {t("shortlist_page_title")}
            </h1>
            <p className={`mt-1 max-w-2xl text-sm ${dm ? "text-gray-400" : "text-gray-500"}`}>
              {t("shortlist_page_desc")}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => onNavigate("talent-pool")}
              className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400/40 ${
                dm
                  ? "border-gray-600 text-gray-200 hover:bg-gray-700"
                  : "border-gray-300 text-gray-700 hover:bg-gray-50"
              }`}
            >
              <Users className="h-4 w-4" />
              {t("shortlist_discover_more")}
              <ArrowRight className="h-4 w-4" />
            </button>
            {entries.length > 0 && (
              <button
                type="button"
                onClick={() => exportCSV(exportEntries, t)}
                disabled={exportEntries.length === 0}
                aria-label={t("shortlist_export_csv")}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#1d4ed8] px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 transition-colors hover:bg-[#1a45c9] focus:outline-none focus:ring-2 focus:ring-blue-400/40 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Download className="h-4 w-4" />
                {t("shortlist_export_csv")}
              </button>
            )}
          </div>
        </div>

        {loading && <ShortlistSkeleton darkMode={dm} t={t} />}

        {!loading && error && (
          <div
            role="alert"
            className={`animate-panel-expand rounded-xl border p-4 sm:p-5 ${
              dm
                ? "border-red-900/60 bg-red-950/30 text-red-100"
                : "border-red-200 bg-red-50 text-red-800"
            }`}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold">{t("shortlist_load_error")}</p>
                {error !== t("shortlist_load_error") && (
                  <p className={`mt-1 text-sm ${dm ? "text-red-200/80" : "text-red-700"}`}>
                    {error}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={fetchEntries}
                className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-red-400/40 ${
                  dm
                    ? "border-red-800 text-red-100 hover:bg-red-900/40"
                    : "border-red-200 bg-white text-red-700 hover:bg-red-100"
                }`}
              >
                <RefreshCw className="h-4 w-4" />
                {t("shortlist_retry")}
              </button>
            </div>
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div className={`rounded-xl border p-6 text-center sm:p-10 ${card}`}>
            <BookmarkCheck
              className={`mx-auto mb-4 h-12 w-12 ${dm ? "text-gray-600" : "text-gray-300"}`}
            />
            <p className={`text-lg font-semibold ${dm ? "text-white" : "text-gray-900"}`}>
              {t("shortlist_empty_title")}
            </p>
            <p className={`mx-auto mt-2 max-w-md text-sm ${dm ? "text-gray-400" : "text-gray-500"}`}>
              {t("shortlist_empty_desc")}
            </p>
            <button
              type="button"
              onClick={() => onNavigate("talent-pool")}
              className="mt-5 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#1d4ed8] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1a45c9] focus:outline-none focus:ring-2 focus:ring-blue-400/40"
            >
              {t("shortlist_empty_cta_discover")}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {!loading && !error && entries.length > 0 && (
          <>
            <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {stats.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className={`rounded-xl border p-4 ${card}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className={`text-2xl font-bold ${dm ? "text-white" : "text-gray-900"}`}>
                          {item.value}
                        </p>
                        <p className={`mt-1 text-xs font-medium ${dm ? "text-gray-400" : "text-gray-500"}`}>
                          {item.label}
                        </p>
                      </div>
                      <span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${item.tone}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className={`mb-6 animate-panel-expand rounded-xl border p-4 sm:p-5 ${card}`}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${
                      dm
                        ? "bg-teal-950/50 text-teal-300"
                        : "bg-teal-50 text-teal-700"
                    }`}
                  >
                    <MailCheck className="h-5 w-5" />
                  </span>
                  <div>
                    <p className={`text-sm font-semibold ${dm ? "text-white" : "text-gray-900"}`}>
                      {t("shortlist_queue_title")}
                    </p>
                    <p className={`mt-1 max-w-2xl text-sm ${dm ? "text-gray-400" : "text-gray-500"}`}>
                      {t("shortlist_queue_desc")}
                    </p>
                  </div>
                </div>
                <div className="min-w-[180px]">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className={`text-xs font-semibold ${dm ? "text-gray-300" : "text-gray-600"}`}>
                      {formatTranslation(t("shortlist_queue_progress"), {
                        contacted: contactedCount,
                        total: entries.length,
                      })}
                    </span>
                    <span className={`text-xs font-semibold ${dm ? "text-teal-300" : "text-teal-700"}`}>
                      {contactProgress}%
                    </span>
                  </div>
                  <div className={`h-2 overflow-hidden rounded-full ${dm ? "bg-gray-700" : "bg-gray-100"}`}>
                    <div
                      className="h-full rounded-full bg-teal-500 transition-all duration-500"
                      style={{ width: `${contactProgress}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className={`mb-6 rounded-xl border p-4 ${card}`}>
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <label className="relative flex-1">
                  <span className="sr-only">{t("shortlist_search_label")}</span>
                  <Search
                    className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${dm ? "text-gray-500" : "text-gray-400"}`}
                  />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("shortlist_search_placeholder")}
                    className={`w-full rounded-lg border py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-[#1d4ed8] focus:ring-2 focus:ring-blue-100 ${
                      dm
                        ? "border-gray-600 bg-gray-700 text-white placeholder:text-gray-500 focus:ring-blue-900/40"
                        : "border-gray-300 bg-white text-gray-900 placeholder:text-gray-400"
                    }`}
                  />
                </label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div
                    className={`grid grid-cols-2 rounded-lg p-1 sm:grid-cols-4 ${dm ? "bg-gray-700" : "bg-gray-100"}`}
                    role="group"
                    aria-label={t("shortlist_filter_label")}
                  >
                    {statusFilters.map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setStatusFilter(key)}
                        aria-pressed={statusFilter === key}
                        className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400/40 ${
                          statusFilter === key
                            ? "bg-white text-[#1d4ed8] shadow-sm dark:bg-gray-900 dark:text-blue-300"
                            : dm
                              ? "text-gray-300 hover:text-white"
                              : "text-gray-600 hover:text-gray-900"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className={`inline-flex min-h-10 items-center justify-center rounded-lg border px-3 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400/40 ${
                        dm
                          ? "border-gray-600 text-gray-300 hover:bg-gray-700"
                          : "border-gray-300 text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {t("shortlist_clear_filters")}
                    </button>
                  )}
                </div>
              </div>
              <p className={`mt-3 text-xs ${dm ? "text-gray-500" : "text-gray-500"}`}>
                {formatTranslation(t("shortlist_filter_result"), {
                  shown: filteredEntries.length,
                  total: entries.length,
                })}
              </p>
            </div>
          </>
        )}

        {!loading &&
          !error &&
          entries.length > 0 &&
          filteredEntries.length === 0 && (
            <div className={`animate-panel-expand rounded-xl border p-8 text-center sm:p-10 ${card}`}>
              <p className={`text-base font-semibold ${dm ? "text-white" : "text-gray-900"}`}>
                {t("shortlist_no_results_title")}
              </p>
              <p className={`mx-auto mt-2 max-w-md text-sm ${dm ? "text-gray-400" : "text-gray-500"}`}>
                {t("shortlist_no_results_desc")}
              </p>
              <button
                type="button"
                onClick={clearFilters}
                className={`mt-4 inline-flex min-h-10 items-center justify-center rounded-lg border px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400/40 ${
                  dm
                    ? "border-gray-600 text-gray-300 hover:bg-gray-700"
                    : "border-gray-300 text-gray-700 hover:bg-gray-50"
                }`}
              >
                {t("shortlist_clear_filters")}
              </button>
            </div>
          )}

        {!loading && !error && filteredEntries.length > 0 && (
          <>
            <div className="space-y-3 lg:hidden">
              {filteredEntries.map((entry) => (
                <article
                  key={entry.id}
                  className={`animate-panel-expand rounded-xl border p-4 ${card}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <CandidateProfile entry={entry} darkMode={dm} compact />
                    <div className="flex flex-shrink-0 flex-col items-end gap-2">
                      <span className={`text-lg font-bold ${getScoreToneClass(entry.match_score, dm)}`}>
                        {entry.match_score}%
                      </span>
                      <StatusChip status={entry.status} t={t} />
                    </div>
                  </div>
                  <div
                    className={`mt-4 grid gap-3 rounded-lg p-3 sm:grid-cols-2 ${
                      dm ? "bg-gray-900/40" : "bg-gray-50"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <Briefcase className={`mt-0.5 h-4 w-4 ${dm ? "text-gray-500" : "text-gray-400"}`} />
                      <div>
                        <p className={`text-xs font-semibold ${dm ? "text-gray-500" : "text-gray-500"}`}>
                          {t("shortlist_mobile_job_label")}
                        </p>
                        <p className={`text-sm font-medium ${dm ? "text-gray-200" : "text-gray-800"}`}>
                          {entry.job_title}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <BookmarkCheck className={`mt-0.5 h-4 w-4 ${dm ? "text-gray-500" : "text-gray-400"}`} />
                      <div>
                        <p className={`text-xs font-semibold ${dm ? "text-gray-500" : "text-gray-500"}`}>
                          {t("shortlist_mobile_saved_label")}
                        </p>
                        <p className={`text-sm font-medium ${dm ? "text-gray-200" : "text-gray-800"}`}>
                          {new Date(entry.saved_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4">
                    <div className="mb-2 flex items-center gap-2">
                      <FileText className={`h-4 w-4 ${dm ? "text-gray-500" : "text-gray-400"}`} />
                      <p className={`text-xs font-semibold ${dm ? "text-gray-400" : "text-gray-500"}`}>
                        {t("shortlist_mobile_notes_label")}
                      </p>
                    </div>
                    <NotesEditor
                      entry={entry}
                      darkMode={dm}
                      t={t}
                      isEditing={editingId === entry.id}
                      editNotes={editNotes}
                      busy={busyEntryId === entry.id}
                      density="card"
                      onChangeNotes={setEditNotes}
                      onStartEdit={handleStartEditNotes}
                      onSaveNotes={handleSaveNotes}
                      onCancelEdit={handleCancelEditNotes}
                    />
                  </div>
                  <EntryActions
                    entry={entry}
                    darkMode={dm}
                    t={t}
                    busyEntryId={busyEntryId}
                    layout="stacked"
                    onMarkContacted={handleMarkContacted}
                    onCopyOutreach={handleCopyOutreach}
                    onRemove={setRemoveTarget}
                  />
                </article>
              ))}
            </div>

            <div className={`hidden rounded-xl border overflow-hidden lg:block ${card}`}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr
                      className={`border-b ${dm ? "border-gray-700 bg-gray-700/50" : "border-gray-200 bg-gray-50"}`}
                    >
                      <th className={`px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider ${dm ? "text-gray-400" : "text-gray-500"}`}>
                        {t("shortlist_col_candidate")}
                      </th>
                      <th className={`px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider ${dm ? "text-gray-400" : "text-gray-500"}`}>
                        {t("shortlist_col_job")}
                      </th>
                      <th className={`px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider ${dm ? "text-gray-400" : "text-gray-500"}`}>
                        {t("shortlist_col_score")}
                      </th>
                      <th className={`px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider ${dm ? "text-gray-400" : "text-gray-500"}`}>
                        {t("shortlist_col_status")}
                      </th>
                      <th className={`px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider ${dm ? "text-gray-400" : "text-gray-500"}`}>
                        {t("shortlist_col_saved")}
                      </th>
                      <th className={`px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider ${dm ? "text-gray-400" : "text-gray-500"}`}>
                        {t("shortlist_col_notes")}
                      </th>
                      <th className={`px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider ${dm ? "text-gray-400" : "text-gray-500"}`}>
                        {t("shortlist_col_actions")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-inherit">
                    {filteredEntries.map((entry) => (
                      <tr
                        key={entry.id}
                        className={`transition-colors ${
                          dm
                            ? "border-gray-700 hover:bg-gray-700/40"
                            : "border-gray-100 hover:bg-gray-50"
                        }`}
                      >
                        <td className="min-w-[220px] px-5 py-4">
                          <CandidateProfile entry={entry} darkMode={dm} />
                        </td>
                        <td className={`min-w-[150px] px-5 py-4 ${dm ? "text-gray-300" : "text-gray-700"}`}>
                          {entry.job_title}
                        </td>
                        <td className="px-5 py-4">
                          <span className={`text-lg font-bold ${getScoreToneClass(entry.match_score, dm)}`}>
                            {entry.match_score}%
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <StatusChip status={entry.status} t={t} />
                        </td>
                        <td className={`whitespace-nowrap px-5 py-4 text-xs ${dm ? "text-gray-400" : "text-gray-500"}`}>
                          {new Date(entry.saved_at).toLocaleDateString()}
                        </td>
                        <td className="min-w-[220px] px-5 py-4">
                          <NotesEditor
                            entry={entry}
                            darkMode={dm}
                            t={t}
                            isEditing={editingId === entry.id}
                            editNotes={editNotes}
                            busy={busyEntryId === entry.id}
                            onChangeNotes={setEditNotes}
                            onStartEdit={handleStartEditNotes}
                            onSaveNotes={handleSaveNotes}
                            onCancelEdit={handleCancelEditNotes}
                          />
                        </td>
                        <td className="px-5 py-4">
                          <EntryActions
                            entry={entry}
                            darkMode={dm}
                            t={t}
                            busyEntryId={busyEntryId}
                            onMarkContacted={handleMarkContacted}
                            onCopyOutreach={handleCopyOutreach}
                            onRemove={setRemoveTarget}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div
                className={`border-t px-5 py-3 text-xs ${dm ? "border-gray-700 text-gray-500" : "border-gray-200 text-gray-400"}`}
              >
                {formatTranslation(t("shortlist_total_entries"), {
                  shown: filteredEntries.length,
                  total: entries.length,
                })}
              </div>
            </div>
          </>
        )}
      </div>
      <ConfirmActionDialog
        open={Boolean(removeTarget)}
        title={t("shortlist_remove")}
        description={`Remove ${removeTarget?.candidate_name ?? "this candidate"} from your shortlist?`}
        detail={removeTarget?.job_title}
        cancelLabel="Cancel"
        confirmLabel={t("shortlist_remove")}
        loadingLabel={t("portal_billing_updating")}
        loading={Boolean(removeTarget && busyEntryId === removeTarget.id)}
        tone="danger"
        onOpenChange={(open) => {
          if (!open && !busyEntryId) setRemoveTarget(null);
        }}
        onCancel={() => {
          if (!busyEntryId) setRemoveTarget(null);
        }}
        onConfirm={() => {
          if (removeTarget) void handleRemove(removeTarget);
        }}
      />
    </>
  );
}
