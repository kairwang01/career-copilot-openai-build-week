import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Trash2, ChevronDown, ChevronRight, Check, Loader2, Save, Sparkles, X, AlertTriangle, RotateCcw } from 'lucide-react';
import {
  TALENT_PROFILE_SCHEMA,
  emptyTalentProfile,
  isTalentProfileReady,
  sanitizeExtractedProfile,
  hasMeaningfulEntry,
  type TalentProfile,
  type FieldConfig,
  type Section,
} from '../lib/talentProfile';
import {
  loadTalentProfile,
  saveTalentProfile,
  withdrawTalentDiscoveryConsent,
} from '../services/talentProfile';
import { extractTalentProfile } from '../services/aiClient';
import { ViewportAwareDialog } from './ViewportAwareDialog';
import { LanguageSyncBanner } from './LanguageSyncBanner';
import {
  type LanguageVersionLibrary,
  adoptBareResult,
  getLanguageVersion,
  isLanguageVersionLibrary,
  listVersionLanguages,
  setActiveLanguage,
  upsertLanguageVersion,
} from '../lib/languageVersions';
import { canSaveResults, loadToolResult, saveToolResult } from '../services/toolResults';

// The per-language store holds the extraction OUTPUT (the schema-coerced draft we
// merge into empty fields), keyed by the language it was generated in.
type ExtractionDraft = Partial<TalentProfile>;

interface TalentProfileFormProps {
  uid: string;
  /** Pre-seed name/email when the profile is brand new. */
  seed?: { name?: string; email?: string };
  /** The candidate's resume text, used to auto-fill the profile. */
  resumeText?: string;
  /** Rendered as a sticky footer action (e.g. "Save & apply"). */
  primaryLabel?: string;
  onPrimary?: (profile: TalentProfile) => void;
  onSaved?: (profile: TalentProfile) => void;
  /** Current UI language — drives the language-sync banner. */
  currentLang?: string;
  /** Localization function for every customer-facing label and message. */
  t: (key: string) => string;
  /** Subscription status — paid tiers persist per-language extraction versions. */
  subscriptionStatus?: string | null;
}

const inputCls =
  'w-full min-w-0 max-w-full scroll-mb-48 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-100';

type TranslationFn = (key: string) => string;
type TranslationValues = Record<string, string | number>;

const formatTranslation = (template: string, values: TranslationValues = {}) =>
  Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
    template,
  );

const sectionTranslationKey = (sectionId: string) => `talent_profile_section_${sectionId}`;
const itemTranslationKey = (sectionId: string) => `talent_profile_item_${sectionId}`;
const skillTranslationKey = (groupKey: string) => `talent_profile_skill_${groupKey}_label`;
const fieldTranslationKey = (sectionId: string, fieldKey: string, suffix: 'label' | 'placeholder' | 'help') =>
  `talent_profile_field_${sectionId}_${fieldKey}_${suffix}`;
const fieldOptionTranslationKey = (sectionId: string, fieldKey: string, optionIndex: number) =>
  `talent_profile_field_${sectionId}_${fieldKey}_option_${optionIndex}`;

const PREFILL_LANGUAGE_OPTIONS = [
  { value: 'en', labelKey: 'talent_profile_prefill_language_en_label', noteKey: 'talent_profile_prefill_language_en_note' },
  { value: 'fr', labelKey: 'talent_profile_prefill_language_fr_label', noteKey: 'talent_profile_prefill_language_fr_note' },
  { value: 'zh', labelKey: 'talent_profile_prefill_language_zh_label', noteKey: 'talent_profile_prefill_language_zh_note' },
  { value: 'es', labelKey: 'talent_profile_prefill_language_es_label', noteKey: 'talent_profile_prefill_language_es_note' },
  { value: 'de', labelKey: 'talent_profile_prefill_language_de_label', noteKey: 'talent_profile_prefill_language_de_note' },
  { value: 'ja', labelKey: 'talent_profile_prefill_language_ja_label', noteKey: 'talent_profile_prefill_language_ja_note' },
  { value: 'vi', labelKey: 'talent_profile_prefill_language_vi_label', noteKey: 'talent_profile_prefill_language_vi_note' },
  { value: 'ar', labelKey: 'talent_profile_prefill_language_ar_label', noteKey: 'talent_profile_prefill_language_ar_note' },
  { value: 'source', labelKey: 'talent_profile_prefill_language_source_label', noteKey: 'talent_profile_prefill_language_source_note' },
] as const;

type PrefillReviewState = {
  before: TalentProfile;
  paths: string[];
  language: string;
};

type ValidationIssue = {
  path: string;
  message: string;
};

type ProfileMessage = {
  kind: 'ok' | 'info' | 'error';
  key: string;
  values?: TranslationValues;
  language?: string;
};

const cloneProfile = (profile: TalentProfile): TalentProfile => JSON.parse(JSON.stringify(profile)) as TalentProfile;

const hasVisibleValue = (value: unknown): boolean => {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasVisibleValue);
  return false;
};

const getPathLabel = (path: string, t: TranslationFn): string => {
  const [sectionId, maybeIndexOrKey, maybeKey] = path.split('.');
  const section = TALENT_PROFILE_SCHEMA.find((s) => s.id === sectionId);
  if (!section) return path;
  const sectionTitle = t(sectionTranslationKey(section.id));
  if (section.kind === 'skills') {
    const group = section.groups.find((g) => g.key === maybeIndexOrKey);
    return `${sectionTitle} · ${group ? t(skillTranslationKey(group.key)) : maybeIndexOrKey}`;
  }
  if (section.kind === 'object') {
    const field = section.fields.find((f) => f.key === maybeIndexOrKey);
    return `${sectionTitle} · ${field ? t(fieldTranslationKey(section.id, field.key, 'label')) : maybeIndexOrKey}`;
  }
  const index = Number.parseInt(maybeIndexOrKey ?? '', 10);
  const field = section.fields.find((f) => f.key === maybeKey);
  return `${sectionTitle} #${Number.isFinite(index) ? index + 1 : '?'} · ${field ? t(fieldTranslationKey(section.id, field.key, 'label')) : maybeKey ?? ''}`;
};

const parseFirstNumber = (value: unknown): number | null => {
  if (typeof value !== 'string') return null;
  const match = value.replace(',', '.').match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
};

const isValidIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const collectValidationIssues = (profile: TalentProfile, t: TranslationFn): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const email = typeof profile.basic.email === 'string' ? profile.basic.email.trim() : '';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    issues.push({ path: 'basic.email', message: t('talent_profile_validation_email') });
  }

  TALENT_PROFILE_SCHEMA.forEach((section) => {
    if (section.kind === 'object') {
      const data = (profile as any)[section.id] as Record<string, unknown>;
      section.fields.forEach((field) => {
        const value = data?.[field.key];
        if (field.type === 'date' && typeof value === 'string' && value.trim() && !isValidIsoDate(value.trim())) {
          issues.push({ path: `${section.id}.${field.key}`, message: t('talent_profile_validation_date') });
        }
      });
      return;
    }
    if (section.kind !== 'list') return;
    const items = ((profile as any)[section.id] ?? []) as Record<string, unknown>[];
    items.forEach((item, index) => {
      section.fields.forEach((field) => {
        const value = item[field.key];
        const path = `${section.id}.${index}.${field.key}`;
        if (field.type === 'date' && typeof value === 'string' && value.trim() && !isValidIsoDate(value.trim())) {
          issues.push({ path, message: t('talent_profile_validation_date') });
        }
      });

      const start = typeof item.startDate === 'string' ? item.startDate.trim() : '';
      const end = typeof item.endDate === 'string' ? item.endDate.trim() : '';
      if (start && end && isValidIsoDate(start) && isValidIsoDate(end) && start > end) {
        issues.push({ path: `${section.id}.${index}.endDate`, message: t('talent_profile_validation_end_date') });
      }
      if (section.id === 'education') {
        const gpa = typeof item.gpa === 'string' ? item.gpa.trim() : '';
        const gpaScale = typeof item.gpaScale === 'string' ? item.gpaScale.trim() : '';
        const gpaNumber = parseFirstNumber(gpa);
        const scaleNumber = parseFirstNumber(gpaScale);
        if (gpa && gpaNumber === null) {
          issues.push({ path: `${section.id}.${index}.gpa`, message: t('talent_profile_validation_gpa') });
        }
        if (gpaScale && scaleNumber === null) {
          issues.push({ path: `${section.id}.${index}.gpaScale`, message: t('talent_profile_validation_gpa_scale') });
        }
        if (gpaNumber !== null && scaleNumber !== null && gpaNumber > scaleNumber) {
          issues.push({ path: `${section.id}.${index}.gpa`, message: t('talent_profile_validation_gpa_exceeds_scale') });
        }
      }
    });
  });

  return issues;
};

// ── Chip editor (chips fields + skill groups) ───────────────────────────────
const ChipEditor: React.FC<{
  values: string[];
  onChange: (next: string[]) => void;
  t: TranslationFn;
  placeholder?: string;
  suggestions?: string[];
  inputId?: string;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  invalid?: boolean;
}> = ({ values, onChange, t, placeholder, suggestions, inputId, ariaLabel, ariaDescribedBy, invalid }) => {
  const [draft, setDraft] = useState('');
  const add = (v: string) => {
    const trimmed = v.trim();
    if (trimmed && !values.includes(trimmed)) onChange([...values, trimmed]);
    setDraft('');
  };
  const remaining = (suggestions ?? []).filter((s) => !values.includes(s));
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap gap-1.5">
        {values.map((v) => (
          <span key={v} dir="auto" className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
            <span className="min-w-0 [overflow-wrap:anywhere]">{v}</span>
            <button
              type="button"
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-blue-400 transition hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400/30 dark:hover:text-blue-200"
              aria-label={formatTranslation(t('talent_profile_remove_value'), { value: v })}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          id={inputId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(draft); } }}
          placeholder={placeholder ?? t('talent_profile_add_item_input')}
          aria-label={ariaLabel ?? placeholder ?? t('talent_profile_add_item_input')}
          aria-describedby={ariaDescribedBy}
          aria-invalid={invalid || undefined}
          dir="auto"
          className="min-w-0 basis-28 flex-1 scroll-mb-48 border-none bg-transparent px-1 py-1.5 text-sm text-gray-900 focus:outline-none dark:text-gray-100"
        />
      </div>
      {remaining.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {remaining.slice(0, 12).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              aria-label={formatTranslation(t('talent_profile_add_item'), { item: s })}
              className="max-w-full rounded-full border border-dashed border-gray-300 px-2 py-1.5 text-xs text-gray-500 hover:border-blue-400 hover:text-blue-600 dark:border-slate-600 dark:text-slate-400"
            >
              <span aria-hidden="true">+ </span><span dir="auto" className="[overflow-wrap:anywhere]">{s}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Single field renderer ───────────────────────────────────────────────────
const fieldDomId = (scopeId: string, path: string) => `${scopeId}-field-${path.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
const fieldIssueId = (scopeId: string, path: string) => `${fieldDomId(scopeId, path)}-issue`;

const FieldInput: React.FC<{
  sectionId: string;
  field: FieldConfig;
  value: unknown;
  onChange: (v: unknown) => void;
  t: TranslationFn;
  id: string;
  describedBy?: string;
  invalid?: boolean;
}> = ({ sectionId, field, value, onChange, t, id, describedBy, invalid }) => {
  const label = t(fieldTranslationKey(sectionId, field.key, 'label'));
  const placeholder = field.placeholder ? t(fieldTranslationKey(sectionId, field.key, 'placeholder')) : undefined;
  if (field.type === 'chips') {
    return (
      <ChipEditor
        values={Array.isArray(value) ? (value as string[]) : []}
        onChange={onChange}
        t={t}
        placeholder={placeholder}
        suggestions={field.suggestions}
        inputId={id}
        ariaLabel={label}
        ariaDescribedBy={describedBy}
        invalid={invalid}
      />
    );
  }
  const str = typeof value === 'string' ? value : '';
  if (field.type === 'textarea') {
    return <textarea id={id} value={str} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3} aria-describedby={describedBy} aria-invalid={invalid || undefined} dir="auto" className={`${inputCls} resize-y`} />;
  }
  if (field.type === 'select') {
    return (
      <select id={id} value={str} onChange={(e) => onChange(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid || undefined} className={inputCls}>
        <option value="">{t('talent_profile_select_placeholder')}</option>
        {(field.options ?? []).map((option, index) => (
          <option key={`${option}:${index}`} value={option}>{t(fieldOptionTranslationKey(sectionId, field.key, index))}</option>
        ))}
      </select>
    );
  }
  return <input id={id} type={field.type === 'date' ? 'date' : 'text'} value={str} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-describedby={describedBy} aria-invalid={invalid || undefined} dir={field.type === 'date' ? undefined : 'auto'} className={inputCls} />;
};

const FieldLabel: React.FC<{ sectionId: string; field: FieldConfig; htmlFor: string; t: TranslationFn }> = ({ sectionId, field, htmlFor, t }) => (
  <label htmlFor={htmlFor} className="mb-1 block min-w-0 flex-1 text-xs font-semibold text-gray-600 dark:text-gray-300">
    <span className="[overflow-wrap:anywhere]">{t(fieldTranslationKey(sectionId, field.key, 'label'))}</span>
    {field.optional && <span className="ms-1 font-normal text-gray-400">({t('talent_profile_optional')})</span>}
    {field.help && <span className="mt-0.5 block text-[11px] font-normal leading-4 text-gray-400 [overflow-wrap:anywhere] dark:text-slate-500">{t(fieldTranslationKey(sectionId, field.key, 'help'))}</span>}
  </label>
);

const FieldGrid: React.FC<{
  scopeId: string;
  sectionId: string;
  fields: FieldConfig[];
  data: Record<string, unknown>;
  onField: (key: string, v: unknown) => void;
  t: TranslationFn;
  pathFor?: (key: string) => string;
  highlightedPaths?: Set<string>;
  issueByPath?: Map<string, string>;
  onReviewPath?: (path: string) => void;
}> = ({ scopeId, sectionId, fields, data, onField, t, pathFor, highlightedPaths, issueByPath, onReviewPath }) => (
  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
    {fields.map((f) => {
      const path = pathFor?.(f.key) ?? f.key;
      const highlighted = highlightedPaths?.has(path) ?? false;
      const issue = issueByPath?.get(path);
      const inputId = fieldDomId(scopeId, path);
      const issueId = issue ? fieldIssueId(scopeId, path) : undefined;
      return (
        <div
          key={f.key}
          className={`${f.full || f.type === 'textarea' || f.type === 'chips' ? 'sm:col-span-2' : ''} min-w-0 rounded-lg ${
            issue
              ? 'border border-red-200 bg-red-50/60 p-2 dark:border-red-900/60 dark:bg-red-950/20'
              : highlighted
                ? 'border border-blue-200 bg-blue-50/70 p-2 dark:border-blue-900/60 dark:bg-blue-950/20'
                : ''
          }`}
        >
          <div className="flex min-w-0 items-start justify-between gap-2">
            <FieldLabel sectionId={sectionId} field={f} htmlFor={inputId} t={t} />
            {highlighted && onReviewPath && (
              <button type="button" onClick={() => onReviewPath(path)} className="shrink-0 text-[11px] font-semibold text-blue-600 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-100">
                {t('talent_profile_reviewed')}
              </button>
            )}
          </div>
          <FieldInput sectionId={sectionId} field={f} value={data[f.key]} onChange={(v) => onField(f.key, v)} t={t} id={inputId} describedBy={issueId} invalid={Boolean(issue)} />
          {issue && <p id={issueId} className="mt-1 text-xs font-medium text-red-600 [overflow-wrap:anywhere] dark:text-red-300">{issue}</p>}
        </div>
      );
    })}
  </div>
);

// ── Main form ───────────────────────────────────────────────────────────────
// Resume→profile extraction is a free convenience (TOOL_REGISTRY.extractTalentProfile
// has creditKey:null — the server charges nothing). There is no distinct
// TOOL_CREDIT_COSTS key for it, so regeneration in a new language is free too and
// the banner shows a 0-credit cost.
const PROFILE_EXTRACT_CREDIT_COST = 0;

const TalentProfileForm: React.FC<TalentProfileFormProps> = ({ uid, seed, resumeText, primaryLabel, onPrimary, onSaved, currentLang = 'en', t, subscriptionStatus }) => {
  const reactId = React.useId();
  const scopeId = `talent-profile-${reactId.replace(/[^a-zA-Z0-9_-]+/g, '')}`;
  const [profile, setProfile] = useState<TalentProfile>(emptyTalentProfile());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [withdrawingDiscovery, setWithdrawingDiscovery] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [prefilling, setPrefilling] = useState(false);
  const [prefillDialogOpen, setPrefillDialogOpen] = useState(false);
  const [prefillLanguage, setPrefillLanguage] = useState('en');
  const [prefillReview, setPrefillReview] = useState<PrefillReviewState | null>(null);
  const [showAllPrefillPaths, setShowAllPrefillPaths] = useState(false);
  const [prefillMsg, setPrefillMsg] = useState<ProfileMessage | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({ basic: true, intention: true });
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [visualViewportBottomInset, setVisualViewportBottomInset] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  // Language-sync: per-language store of extraction drafts, the language of the
  // draft last applied, and the UI language the user dismissed the nudge for.
  const [profileLib, setProfileLib] = useState<LanguageVersionLibrary<ExtractionDraft> | null>(null);
  const [resultLang, setResultLang] = useState<string | null>(null);
  const [langSyncDismissed, setLangSyncDismissed] = useState<string | null>(null);
  const prefillButtonRef = useRef<HTMLButtonElement | null>(null);
  const prefillRunRef = useRef(0);
  const mountedRef = useRef(true);

  const prefillLanguageOption = (language: string) =>
    PREFILL_LANGUAGE_OPTIONS.find((option) => option.value === language);
  const prefillLanguageLabel = (language: string) => {
    const option = prefillLanguageOption(language);
    return option ? t(option.labelKey) : formatTranslation(t('talent_profile_selected_language'), { language: language.toUpperCase() });
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      prefillRunRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return undefined;
    const updateBottomInset = () => {
      const next = Math.max(0, Math.ceil(window.innerHeight - viewport.offsetTop - viewport.height));
      setVisualViewportBottomInset((current) => (current === next ? current : next));
    };
    updateBottomInset();
    viewport.addEventListener('resize', updateBottomInset, { passive: true });
    viewport.addEventListener('scroll', updateBottomInset, { passive: true });
    window.addEventListener('resize', updateBottomInset, { passive: true });
    return () => {
      viewport.removeEventListener('resize', updateBottomInset);
      viewport.removeEventListener('scroll', updateBottomInset);
      window.removeEventListener('resize', updateBottomInset);
    };
  }, []);

  // Load any saved per-language extraction versions (paid tiers only persist).
  // A stored library lets a later UI-language change offer a FREE switch to an
  // already-generated draft instead of a paid re-run. Bare pre-versioning saves
  // are adopted as a single version in the current UI language (backward-compat).
  useEffect(() => {
    let cancelled = false;
    setProfileLib(null);
    loadToolResult<LanguageVersionLibrary<ExtractionDraft> | ExtractionDraft>(uid, 'talent-profile').then((saved) => {
      if (cancelled || !saved) return;
      if (isLanguageVersionLibrary<ExtractionDraft>(saved.result)) {
        setProfileLib(saved.result);
      } else {
        setProfileLib(adoptBareResult<ExtractionDraft>(saved.result as ExtractionDraft, currentLang, saved.savedAt || Date.now()));
      }
    });
    return () => { cancelled = true; };
    // currentLang is only the fallback lang for a legacy bare result; re-running
    // on every UI-language change would needlessly refetch, so it's excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  const markReviewPath = (path: string) => {
    // Any edit makes the persisted "Saved" indicator stale — clear it so the user
    // knows there are unsaved changes again.
    setSavedAt(null);
    setPrefillReview((state) => {
      if (!state) return null;
      const nextPaths = state.paths.filter((p) => p !== path);
      return nextPaths.length ? { ...state, paths: nextPaths } : null;
    });
  };

  const clearReviewPathsByPrefix = (prefix: string) => {
    setPrefillReview((state) => {
      if (!state) return null;
      const nextPaths = state.paths.filter((p) => !p.startsWith(prefix));
      return nextPaths.length ? { ...state, paths: nextPaths } : null;
    });
  };

  // Auto-fill from the candidate's resume. Fills ONLY empty fields / empty list
  // sections (never overwrites what the candidate already typed); skills are
  // unioned. The AI output is schema-coerced (sanitizeExtractedProfile) so dates
  // and select values populate correctly.
  const openPrefillDialog = () => {
    if (!resumeText || resumeText.trim().length < 40) {
      setPrefillMsg({ kind: 'info', key: 'talent_profile_resume_required' });
      return;
    }
    setPrefillMsg(null);
    setPrefillDialogOpen(true);
  };

  const focusReviewPath = (path: string) => {
    const [sectionId] = path.split('.');
    if (sectionId) setOpen((current) => ({ ...current, [sectionId]: true }));

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target = document.getElementById(fieldDomId(scopeId, path));
        if (!target) return;
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
          target.focus({ preventScroll: true });
        } else {
          target.focus?.({ preventScroll: true });
        }
      });
    });
  };

  // Merge an extraction draft into the CURRENT profile (empty fields / empty list
  // sections only — never overwrites what the candidate typed; skills are unioned)
  // and surface the review highlights. Shared by a fresh extraction and by a free
  // "switch to a stored version" from the language-sync banner.
  const applyExtractionDraft = (ex: ExtractionDraft, language: string) => {
    const before = cloneProfile(profile);
    setSavedAt(null);
    // Decide which sections will actually receive data (from current state) so
    // we can expand exactly those — the user must see everything before saving.
    const touched = new Set<string>();
    const reviewPaths = new Set<string>();
    (['basic', 'intention', 'additional'] as const).forEach((id) => {
      const exObj = ex[id] as Record<string, string> | undefined;
      if (!exObj) return;
      Object.keys(exObj).forEach((k) => {
        const cur = (profile[id] as Record<string, string>)[k];
        if ((!cur || !String(cur).trim()) && hasVisibleValue(exObj[k])) {
          touched.add(id);
          reviewPaths.add(`${id}.${k}`);
        }
      });
    });
    (['education', 'experience', 'projects', 'awards', 'portfolio'] as const).forEach((id) => {
      const exList = ex[id] as Record<string, string | string[]>[] | undefined;
      if (exList && exList.length && !(profile[id] ?? []).some(hasMeaningfulEntry)) {
        touched.add(id);
        exList.forEach((item, index) => {
          Object.keys(item).forEach((key) => {
            if (hasVisibleValue(item[key])) reviewPaths.add(`${id}.${index}.${key}`);
          });
        });
      }
    });
    if (ex.skills) {
      Object.keys(ex.skills).forEach((g) => {
        const hasNewSkill = ((ex.skills as Record<string, string[]>)[g] ?? []).some((s) => !(profile.skills[g] ?? []).includes(s));
        if (hasNewSkill) {
          touched.add('skills');
          reviewPaths.add(`skills.${g}`);
        }
      });
    }

    setProfile((p) => {
      const next: TalentProfile = { ...p, basic: { ...p.basic }, intention: { ...p.intention }, additional: { ...p.additional }, skills: { ...p.skills } };
      (['basic', 'intention', 'additional'] as const).forEach((id) => {
        const exObj = ex[id] as Record<string, string> | undefined;
        if (!exObj) return;
        const cur = next[id] as Record<string, string>;
        Object.keys(exObj).forEach((k) => {
          if (!cur[k] || !String(cur[k]).trim()) cur[k] = exObj[k];
        });
      });
      (['education', 'experience', 'projects', 'awards', 'portfolio'] as const).forEach((id) => {
        const exList = ex[id] as Record<string, string | string[]>[] | undefined;
        if (exList && exList.length && !(next[id] ?? []).some(hasMeaningfulEntry)) next[id] = exList;
      });
      if (ex.skills) {
        Object.keys(ex.skills).forEach((g) => {
          next.skills[g] = Array.from(new Set([...(next.skills[g] ?? []), ...((ex.skills as Record<string, string[]>)[g] ?? [])]));
        });
      }
      return next;
    });
    if (touched.size) setOpen((o) => ({ ...o, ...Object.fromEntries([...touched].map((id) => [id, true])) }));
    if (reviewPaths.size) {
      setShowAllPrefillPaths(false);
      setPrefillReview({ before, paths: [...reviewPaths], language });
      setPrefillMsg({
        kind: 'ok',
        key: 'talent_profile_prefill_success',
        values: { count: reviewPaths.size },
        language,
      });
    } else {
      setPrefillReview(null);
      setPrefillMsg({ kind: 'info', key: 'talent_profile_prefill_no_empty' });
    }
  };

  // Fold a fresh extraction into the per-language library, track its language for
  // the banner, and persist for paid tiers (free saves are rejected by rules).
  const recordExtractionVersion = (lang: string, ex: ExtractionDraft) => {
    setResultLang(lang);
    setLangSyncDismissed(null);
    setProfileLib((prev) => {
      const nextLib = upsertLanguageVersion<ExtractionDraft>(prev, lang, ex, Date.now());
      if (canSaveResults(subscriptionStatus)) void saveToolResult(uid, 'talent-profile', nextLib);
      return nextLib;
    });
  };

  const handlePrefill = async (targetLanguage: string) => {
    if (!resumeText || resumeText.trim().length < 40) {
      setPrefillMsg({ kind: 'info', key: 'talent_profile_resume_required' });
      setPrefillDialogOpen(false);
      return;
    }
    const runId = prefillRunRef.current + 1;
    prefillRunRef.current = runId;
    setPrefilling(true);
    setPrefillMsg(null);
    try {
      const ex = sanitizeExtractedProfile(await extractTalentProfile(resumeText, { targetLanguage }));
      if (!mountedRef.current || prefillRunRef.current !== runId) return;
      applyExtractionDraft(ex, targetLanguage);
      recordExtractionVersion(targetLanguage, ex);
    } catch (err) {
      if (mountedRef.current && prefillRunRef.current === runId) {
        console.error('Talent Profile resume prefill failed.', err);
        setPrefillMsg({ kind: 'error', key: 'talent_profile_prefill_error' });
      }
    } finally {
      if (mountedRef.current && prefillRunRef.current === runId) {
        setPrefilling(false);
        setPrefillDialogOpen(false);
      }
    }
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);
    loadTalentProfile(uid)
      .then((p) => {
        if (!active) return;
        // Seed name/email for a brand-new profile.
        if (!p.basic?.name && seed?.name) p.basic = { ...p.basic, name: seed.name };
        if (!p.basic?.email && seed?.email) p.basic = { ...p.basic, email: seed.email };
        setProfile(p);
        setLoading(false);
      })
      .catch(() => {
        // Don't render the form on a failed read — a save would clobber the real
        // profile with an empty one. Show a retry instead.
        if (active) { setLoadError(true); setLoading(false); }
      });
    return () => { active = false; };
    // Re-fetch only on identity change or explicit retry. The effect REPLACES the
    // in-memory profile via setProfile, so reacting to live seed.name/seed.email
    // changes (full_name can arrive late via the users/{uid} snapshot) would wipe
    // the candidate's unsaved section edits. The seed is first-load-only by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, reloadKey]);

  const ready = useMemo(() => isTalentProfileReady(profile), [profile]);
  const highlightedPaths = useMemo(() => new Set(prefillReview?.paths ?? []), [prefillReview]);
  const validationIssues = useMemo(() => collectValidationIssues(profile, t), [profile, t]);
  const issueByPath = useMemo(() => new Map(validationIssues.map((issue) => [issue.path, issue.message])), [validationIssues]);
  const hasBlockingValidation = validationIssues.length > 0;
  const readyStatusId = `${scopeId}-ready-status`;
  const validationSummaryId = `${scopeId}-validation-summary`;
  const saveErrorId = `${scopeId}-save-error`;
  const prefillTitleId = `${scopeId}-prefill-title`;
  const prefillDescriptionId = `${scopeId}-prefill-description`;
  const prefillLanguageId = `${scopeId}-prefill-language`;
  const prefillLanguageNoteId = `${scopeId}-prefill-language-note`;
  const saveButtonDescription = hasBlockingValidation ? validationSummaryId : saveError ? saveErrorId : undefined;
  const primaryButtonDescription = hasBlockingValidation ? validationSummaryId : !ready ? readyStatusId : saveError ? saveErrorId : undefined;

  const acceptPrefillReview = () => {
    // Clearing the highlights + the Save button are the signal — no extra
    // "marked as reviewed, now save" message (a confirmation of a confirmation).
    setPrefillReview(null);
    setShowAllPrefillPaths(false);
  };

  const clearPrefillDraft = () => {
    if (!prefillReview) return;
    setProfile(cloneProfile(prefillReview.before));
    setPrefillReview(null);
    setShowAllPrefillPaths(false);
    setSaveError(false);
    setPrefillMsg({ kind: 'info', key: 'talent_profile_draft_cleared' });
  };

  const setObjectField = (sectionId: string, key: string, v: unknown) => {
    setProfile((p) => ({ ...p, [sectionId]: { ...(p as any)[sectionId], [key]: v } }));
    markReviewPath(`${sectionId}.${key}`);
  };
  const setSkill = (group: string, v: string[]) => {
    setProfile((p) => ({ ...p, skills: { ...p.skills, [group]: v } }));
    markReviewPath(`skills.${group}`);
  };
  const addItem = (sectionId: string) => {
    setSavedAt(null);
    setProfile((p) => ({ ...p, [sectionId]: [...((p as any)[sectionId] as unknown[]), {}] }));
  };
  const removeItem = (sectionId: string, i: number) => {
    setSavedAt(null);
    setProfile((p) => ({ ...p, [sectionId]: ((p as any)[sectionId] as unknown[]).filter((_, idx) => idx !== i) }));
    clearReviewPathsByPrefix(`${sectionId}.`);
  };
  const setItemField = (sectionId: string, i: number, key: string, v: unknown) => {
    setProfile((p) => ({
      ...p,
      [sectionId]: ((p as any)[sectionId] as Record<string, unknown>[]).map((it, idx) => (idx === i ? { ...it, [key]: v } : it)),
    }));
    markReviewPath(`${sectionId}.${i}.${key}`);
  };

  const persist = async (markComplete: boolean): Promise<TalentProfile> => {
    if (hasBlockingValidation) {
      setPrefillMsg({ kind: 'error', key: 'talent_profile_validation_fix' });
      throw new Error(t('talent_profile_validation_fix'));
    }
    const next: TalentProfile = { ...profile, status: markComplete && ready ? 'complete' : profile.status };
    setSaving(true);
    setSaveError(false);
    try {
      await saveTalentProfile(uid, next);
      setProfile(next);
      setSavedAt(Date.now());
      onSaved?.(next);
    } catch (e) {
      // Surface the failure — a silent swallow leaves the form looking saved
      // while the server still holds the old profile (and the apply gate reads it).
      setSaveError(true);
      throw e;
    } finally {
      setSaving(false);
    }
    return next;
  };

  const updateDiscoverability = async (nextDiscoverable: boolean) => {
    setSavedAt(null);
    setSaveError(false);

    if (nextDiscoverable) {
      // Opt-in is persisted only with the validated full profile save below.
      setProfile((current) => ({ ...current, discoverable: true }));
      return;
    }

    // Opt-out is privacy-critical and must not depend on unrelated form
    // validation. Persist only this field immediately, rolling the visual state
    // back if the server rejects the write so the UI never claims a false state.
    setProfile((current) => ({ ...current, discoverable: false }));
    setWithdrawingDiscovery(true);
    try {
      await withdrawTalentDiscoveryConsent(uid);
      setSavedAt(Date.now());
    } catch {
      setProfile((current) => ({ ...current, discoverable: true }));
      setSaveError(true);
    } finally {
      setWithdrawingDiscovery(false);
    }
  };

  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  if (loadError) {
    return (
      <div role="alert" className="flex min-w-0 flex-col items-center justify-center gap-3 px-4 py-16 text-center text-gray-500">
        <p className="max-w-full [overflow-wrap:anywhere]">{t('talent_profile_load_error')}</p>
        <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="min-h-11 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-800">{t('talent_profile_retry')}</button>
      </div>
    );
  }
  if (loading) {
    return <div role="status" className="flex min-w-0 items-center justify-center px-4 py-16 text-center text-gray-500"><Loader2 className="me-2 h-5 w-5 shrink-0 animate-spin" aria-hidden="true" /> <span className="[overflow-wrap:anywhere]">{t('talent_profile_loading')}</span></div>;
  }

  const renderSection = (section: Section) => {
    const isOpen = open[section.id] ?? false;
    let count = 0;
    if (section.kind === 'list') count = ((profile as any)[section.id] as unknown[]).length;
    const triggerId = `${scopeId}-${section.id}-trigger`;
    const panelId = `${scopeId}-${section.id}-panel`;
    const sectionTitle = t(sectionTranslationKey(section.id));
    return (
      <div key={section.id} className="min-w-0 rounded-xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <button id={triggerId} type="button" onClick={() => toggle(section.id)} aria-expanded={isOpen} aria-controls={panelId} className="flex min-h-11 w-full min-w-0 items-center justify-between gap-3 px-4 py-4 text-start sm:px-5">
          <span className="flex min-w-0 flex-wrap items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
            <span className="min-w-0 [overflow-wrap:anywhere]">{sectionTitle}</span>
            {section.kind === 'list' && count > 0 && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-slate-700 dark:text-slate-300">{count}</span>}
          </span>
          {isOpen ? <ChevronDown className="h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" /> : <ChevronRight className="h-5 w-5 shrink-0 text-gray-400 rtl:rotate-180" aria-hidden="true" />}
        </button>
          <div id={panelId} role="region" aria-labelledby={triggerId} hidden={!isOpen} className="min-w-0 border-t border-gray-100 px-4 py-5 dark:border-slate-700 sm:px-5">
            {section.kind === 'object' && (
              <FieldGrid
                scopeId={scopeId}
                sectionId={section.id}
                fields={section.fields}
                data={(profile as any)[section.id]}
                onField={(k, v) => setObjectField(section.id, k, v)}
                t={t}
                pathFor={(key) => `${section.id}.${key}`}
                highlightedPaths={highlightedPaths}
                issueByPath={issueByPath}
                onReviewPath={markReviewPath}
              />
            )}
            {section.kind === 'skills' && (
              <div className="space-y-5">
                {section.groups.map((g) => (
                  <div
                    key={g.key}
                    className={`min-w-0 rounded-lg ${highlightedPaths.has(`skills.${g.key}`) ? 'border border-blue-200 bg-blue-50/70 p-2 dark:border-blue-900/60 dark:bg-blue-950/20' : ''}`}
                  >
                    <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
                      <p className="min-w-0 text-xs font-semibold text-gray-600 [overflow-wrap:anywhere] dark:text-gray-300">{t(skillTranslationKey(g.key))}</p>
                      {highlightedPaths.has(`skills.${g.key}`) && (
                        <button type="button" onClick={() => markReviewPath(`skills.${g.key}`)} className="shrink-0 text-[11px] font-semibold text-blue-600 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-100">
                          {t('talent_profile_reviewed')}
                        </button>
                      )}
                    </div>
                    <ChipEditor
                      values={profile.skills[g.key] ?? []}
                      onChange={(v) => setSkill(g.key, v)}
                      t={t}
                      placeholder={formatTranslation(t('talent_profile_add_group_placeholder'), { group: t(skillTranslationKey(g.key)) })}
                      suggestions={g.suggestions}
                      ariaLabel={formatTranslation(t('talent_profile_group_skills_label'), { group: t(skillTranslationKey(g.key)) })}
                    />
                  </div>
                ))}
              </div>
            )}
            {section.kind === 'list' && (
              <div className="space-y-4">
                {((profile as any)[section.id] as Record<string, unknown>[]).map((item, i) => (
                  <div key={i} className="min-w-0 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-slate-600 dark:bg-slate-900/50 sm:p-4">
                    <div className="mb-3 flex min-w-0 items-start justify-between gap-2">
                      <span dir="auto" className="min-w-0 text-sm font-semibold text-gray-700 [overflow-wrap:anywhere] dark:text-gray-200">
                        {(item[section.itemTitleKey] as string) || formatTranslation(t('talent_profile_new_item'), { item: t(itemTranslationKey(section.id)) })}
                      </span>
                      <button type="button" onClick={() => removeItem(section.id, i)} aria-label={formatTranslation(t('talent_profile_remove_item'), { item: t(itemTranslationKey(section.id)) })} className="inline-flex min-h-8 shrink-0 items-center gap-1 text-xs font-medium text-gray-400 hover:text-red-600">
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> {t('talent_profile_remove')}
                      </button>
                    </div>
                    <FieldGrid
                      scopeId={scopeId}
                      sectionId={section.id}
                      fields={section.fields}
                      data={item}
                      onField={(k, v) => setItemField(section.id, i, k, v)}
                      t={t}
                      pathFor={(key) => `${section.id}.${i}.${key}`}
                      highlightedPaths={highlightedPaths}
                      issueByPath={issueByPath}
                      onReviewPath={markReviewPath}
                    />
                  </div>
                ))}
                <button type="button" onClick={() => addItem(section.id)} className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-4 py-2 text-start text-sm font-medium text-gray-600 hover:border-blue-400 hover:text-blue-600 dark:border-slate-600 dark:text-slate-300">
                  <Plus className="h-4 w-4 shrink-0" aria-hidden="true" /> <span className="[overflow-wrap:anywhere]">{formatTranslation(t('talent_profile_add_item'), { item: t(itemTranslationKey(section.id)) })}</span>
                </button>
              </div>
            )}
          </div>
      </div>
    );
  };

  const saveBar = (
    <div
      data-qa="talent-profile-save-bar"
      style={{ bottom: `calc(var(--cookie-consent-bottom-space, 0px) + ${visualViewportBottomInset}px)` }}
      className="fixed inset-x-0 z-30 max-h-[min(50dvh,18rem)] overflow-y-auto overscroll-contain border-t border-gray-200 bg-white/95 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur transition-[bottom] duration-200 dark:border-slate-700 dark:bg-slate-900/95 sm:px-4 lg:start-64"
    >
      <div className="mx-auto flex min-w-0 max-w-3xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3 sm:pe-24 xl:pe-0">
        {saveError && (
          <span id={saveErrorId} role="alert" className="min-w-0 text-xs font-medium text-red-600 [overflow-wrap:anywhere] dark:text-red-400 sm:me-auto">
            {t('talent_profile_save_error')}
          </span>
        )}
        {!saveError && hasBlockingValidation && (
          <span className="min-w-0 text-xs font-medium text-red-600 [overflow-wrap:anywhere] dark:text-red-400 sm:me-auto">
            {t('talent_profile_validation_fix')}
          </span>
        )}
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <button type="button" onClick={() => { persist(true).catch(() => {}); }} disabled={saving || withdrawingDiscovery || prefilling || hasBlockingValidation} aria-describedby={saveButtonDescription} aria-busy={saving || withdrawingDiscovery} className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 whitespace-normal rounded-lg border border-gray-300 px-4 py-2 text-center text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-800 sm:w-auto">
            {saving ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4 shrink-0" aria-hidden="true" />} <span className="[overflow-wrap:anywhere]">{t('talent_profile_save')}</span>
          </button>
          {onPrimary && (
            <button type="button" disabled={saving || withdrawingDiscovery || prefilling || !ready || hasBlockingValidation} aria-describedby={primaryButtonDescription} aria-busy={saving || withdrawingDiscovery} onClick={async () => { try { const p = await persist(true); onPrimary(p); } catch { /* error shown inline */ } }} className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 whitespace-normal rounded-lg bg-blue-600 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
              <span className="[overflow-wrap:anywhere]">{primaryLabel ?? t('talent_profile_save_apply')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="mx-auto min-w-0 max-w-3xl pb-[calc(14rem+var(--cookie-consent-bottom-space,0px))] sm:pb-[calc(8rem+var(--cookie-consent-bottom-space,0px))]">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900 [overflow-wrap:anywhere] dark:text-gray-100">{t('talent_profile_title')}</h1>
        <p className="mt-1 text-sm text-gray-500 [overflow-wrap:anywhere] dark:text-gray-400">{t('talent_profile_subtitle')}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button ref={prefillButtonRef} type="button" onClick={openPrefillDialog} disabled={prefilling} aria-busy={prefilling} className="inline-flex min-h-11 max-w-full items-center gap-1.5 whitespace-normal rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-start text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-60 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-300">
            {prefilling ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />}
            <span className="[overflow-wrap:anywhere]">{prefilling ? t('talent_profile_reading_your_resume') : t('talent_profile_prefill_from_resume')}</span>
          </button>
          {prefillMsg && (
            <span role={prefillMsg.kind === 'error' ? 'alert' : 'status'} className={`min-w-0 max-w-full text-xs [overflow-wrap:anywhere] ${prefillMsg.kind === 'error' ? 'text-red-600 dark:text-red-400' : prefillMsg.kind === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400'}`}>
              {formatTranslation(t(prefillMsg.key), {
                ...prefillMsg.values,
                ...(prefillMsg.language ? { language: prefillLanguageLabel(prefillMsg.language) } : {}),
              })}
            </span>
          )}
        </div>
        <p id={readyStatusId} role="status" aria-live="polite" className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-xs font-medium">
          {ready
            ? <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"><Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> <span className="[overflow-wrap:anywhere]">{t('talent_profile_ready')}</span></span>
            : <span className="max-w-full rounded-full bg-amber-50 px-2 py-1 text-amber-700 [overflow-wrap:anywhere] dark:bg-amber-950/40 dark:text-amber-300">{t('talent_profile_incomplete')}</span>}
          {savedAt && <span className="text-gray-400">{t('talent_profile_saved')}</span>}
        </p>
      </div>

      <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50/70 p-4 dark:border-blue-900/60 dark:bg-blue-950/20">
        <label className="flex min-w-0 cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            checked={profile.discoverable === true}
            disabled={saving || withdrawingDiscovery || (!ready && profile.discoverable !== true)}
            onChange={(event) => {
              void updateDiscoverability(event.target.checked);
            }}
            aria-busy={withdrawingDiscovery}
            aria-describedby={`${scopeId}-discoverable-help`}
          />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-blue-950 [overflow-wrap:anywhere] dark:text-blue-100">
              {t('talent_profile_discoverable_label')}
            </span>
            <span id={`${scopeId}-discoverable-help`} className="mt-1 block text-xs leading-5 text-blue-900/80 [overflow-wrap:anywhere] dark:text-blue-200/80">
              {t(ready ? 'talent_profile_discoverable_help' : 'talent_profile_discoverable_incomplete')}
            </span>
          </span>
        </label>
      </div>

      {resultLang && resultLang !== currentLang && langSyncDismissed !== currentLang && (
        <LanguageSyncBanner
          contentLang={resultLang}
          uiLang={currentLang}
          availableLangs={listVersionLanguages(profileLib)}
          creditCost={PROFILE_EXTRACT_CREDIT_COST}
          canPersist={canSaveResults(subscriptionStatus)}
          busy={prefilling}
          t={t}
          onSwitch={(lang) => {
            // Free: replay a stored extraction draft in `lang` through the same
            // merge path (fills still-empty fields; no network / no credits).
            const v = getLanguageVersion(profileLib, lang);
            if (!v) return;
            applyExtractionDraft(v.result, lang);
            setResultLang(lang);
            setLangSyncDismissed(null);
            setProfileLib((prev) => (prev ? setActiveLanguage(prev, lang) : prev));
          }}
          onRegenerate={() => { handlePrefill(currentLang).catch(() => {}); }}
          onDismiss={() => setLangSyncDismissed(currentLang)}
        />
      )}

      {prefillReview && (
        <div className="mb-4 min-w-0 rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/60 dark:bg-blue-950/25">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="flex min-w-0 items-center gap-1.5 text-sm font-bold text-blue-800 dark:text-blue-200">
                <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" /> <span className="[overflow-wrap:anywhere]">{t('talent_profile_review_title')}</span>
              </p>
              <p className="mt-1 text-sm leading-6 text-blue-900/80 [overflow-wrap:anywhere] dark:text-blue-100/80">
                {formatTranslation(
                  t(prefillReview.paths.length === 1 ? 'talent_profile_review_description_one' : 'talent_profile_review_description_many'),
                  { count: prefillReview.paths.length, language: prefillLanguageLabel(prefillReview.language) },
                )}
              </p>
            </div>
            <div className="flex w-full shrink-0 flex-col gap-2 min-[360px]:flex-row sm:w-auto sm:flex-wrap">
              <button type="button" onClick={acceptPrefillReview} className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 whitespace-normal rounded-lg bg-blue-600 px-3 py-2 text-center text-xs font-semibold text-white hover:bg-blue-700 min-[360px]:w-auto">
                <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> <span className="[overflow-wrap:anywhere]">{t('talent_profile_accept_all')}</span>
              </button>
              <button type="button" onClick={clearPrefillDraft} className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 whitespace-normal rounded-lg border border-blue-200 bg-white px-3 py-2 text-center text-xs font-semibold text-blue-700 hover:bg-blue-50 min-[360px]:w-auto dark:border-blue-800 dark:bg-slate-900 dark:text-blue-200 dark:hover:bg-blue-950/40">
                <RotateCcw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> <span className="[overflow-wrap:anywhere]">{t('talent_profile_clear_draft')}</span>
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(showAllPrefillPaths ? prefillReview.paths : prefillReview.paths.slice(0, 8)).map((path) => (
              <button key={path} type="button" onClick={() => focusReviewPath(path)} aria-label={formatTranslation(t('talent_profile_jump_to'), { field: getPathLabel(path, t) })} className="max-w-full whitespace-normal rounded-full border border-blue-200 bg-white px-2.5 py-1.5 text-start text-xs font-medium text-blue-700 [overflow-wrap:anywhere] hover:bg-blue-100 dark:border-blue-800 dark:bg-slate-900 dark:text-blue-200 dark:hover:bg-blue-950/40">
                {getPathLabel(path, t)}
              </button>
            ))}
            {prefillReview.paths.length > 8 && (
              <button
                type="button"
                onClick={() => setShowAllPrefillPaths((value) => !value)}
                className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-200 dark:bg-blue-950/50 dark:text-blue-200 dark:hover:bg-blue-900/60"
              >
                {showAllPrefillPaths ? t('talent_profile_show_fewer') : formatTranslation(t('talent_profile_show_more'), { count: prefillReview.paths.length - 8 })}
              </button>
            )}
          </div>
        </div>
      )}

      {validationIssues.length > 0 && (
        <div id={validationSummaryId} role="alert" className="mb-4 min-w-0 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-100">
          <p className="flex min-w-0 items-center gap-1.5 font-bold">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> <span className="[overflow-wrap:anywhere]">{formatTranslation(t(validationIssues.length === 1 ? 'talent_profile_validation_summary_one' : 'talent_profile_validation_summary_many'), { count: validationIssues.length })}</span>
          </p>
          <ul className="mt-2 min-w-0 space-y-1">
            {validationIssues.slice(0, 5).map((issue) => (
              <li key={`${issue.path}:${issue.message}`} className="[overflow-wrap:anywhere]">{getPathLabel(issue.path, t)}: {issue.message}</li>
            ))}
            {validationIssues.length > 5 && <li>{formatTranslation(t('talent_profile_validation_more'), { count: validationIssues.length - 5 })}</li>}
          </ul>
        </div>
      )}

      <ViewportAwareDialog
        open={prefillDialogOpen}
        anchorRef={prefillButtonRef}
        strategy="anchor-or-center"
        labelledBy={prefillTitleId}
        describedBy={prefillDescriptionId}
        onClose={() => {
          if (!prefilling) setPrefillDialogOpen(false);
        }}
        className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="flex min-w-0 shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-4 py-4 dark:border-slate-800 sm:px-5">
          <div className="min-w-0">
            <p className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-300">
              <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> <span className="[overflow-wrap:anywhere]">{t('talent_profile_prefill_eyebrow')}</span>
            </p>
            <h3 id={prefillTitleId} className="mt-2 text-lg font-bold text-gray-950 [overflow-wrap:anywhere] dark:text-gray-50">{t('talent_profile_prefill_dialog_title')}</h3>
            <p id={prefillDescriptionId} className="mt-1 text-sm leading-6 text-gray-500 [overflow-wrap:anywhere] dark:text-slate-400">
              {t('talent_profile_prefill_dialog_description')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPrefillDialogOpen(false)}
            disabled={prefilling}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-gray-200"
            aria-label={t('talent_profile_prefill_dialog_close')}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5">
          <div>
            <label htmlFor={prefillLanguageId} className="mb-1 block text-sm font-semibold text-gray-800 [overflow-wrap:anywhere] dark:text-gray-100">
              {t('talent_profile_prefill_output_language')}
            </label>
            <select
              id={prefillLanguageId}
              value={prefillLanguage}
              onChange={(e) => setPrefillLanguage(e.target.value)}
              className={inputCls}
              disabled={prefilling}
              aria-describedby={prefillLanguageNoteId}
            >
              {PREFILL_LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{t(option.labelKey)}</option>
              ))}
            </select>
            <p id={prefillLanguageNoteId} className="mt-2 text-xs leading-5 text-gray-500 [overflow-wrap:anywhere] dark:text-slate-400">
              {(() => {
                const option = prefillLanguageOption(prefillLanguage);
                return option ? t(option.noteKey) : '';
              })()}
            </p>
          </div>

          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900 [overflow-wrap:anywhere] dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
            {t('talent_profile_prefill_warning')}
          </div>
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-gray-100 px-4 py-4 sm:flex-row sm:justify-end sm:px-5 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setPrefillDialogOpen(false)}
            disabled={prefilling}
            className="min-h-11 w-full whitespace-normal rounded-lg border border-gray-300 px-4 py-2 text-center text-sm font-semibold text-gray-700 [overflow-wrap:anywhere] hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-800 sm:w-auto"
          >
            {t('talent_profile_cancel')}
          </button>
          <button
            type="button"
            onClick={() => { handlePrefill(prefillLanguage).catch(() => {}); }}
            disabled={prefilling}
            aria-busy={prefilling}
            className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 whitespace-normal rounded-lg bg-blue-600 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 sm:w-auto"
          >
            {prefilling ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />}
            <span className="[overflow-wrap:anywhere]">{prefilling ? t('talent_profile_reading_resume') : t('talent_profile_prefill_draft')}</span>
          </button>
        </div>
      </ViewportAwareDialog>

      <div className="space-y-3">{TALENT_PROFILE_SCHEMA.map(renderSection)}</div>

      {/* Rendered outside the workspace scroll container so fixed positioning
          stays viewport-based on long forms and across browser engines. */}
      {typeof document !== 'undefined' ? createPortal(saveBar, document.body) : saveBar}
    </div>
  );
};

export default TalentProfileForm;
