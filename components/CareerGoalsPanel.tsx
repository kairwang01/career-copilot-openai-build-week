import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Loader2, Target } from 'lucide-react';
import { useJobPreferences, normalizeJobPreferences, prefsSummaryLine } from '../hooks/useJobPreferences';
import type { JobPreferences } from '../hooks/useJobPreferences';
import { data } from '../lib/data';
import type { AppSession as Session } from '../lib/data';
import type { UserProfile } from '../types';

interface CareerGoalsPanelProps {
  t?: (key: string) => string;
  session?: Session | null;
  profile?: UserProfile | null;
  refreshProfile?: () => void;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

type StatusOption = {
  value: JobPreferences['status'];
  labelKey: string;
  labelEn: string;
  dot: string;
};

const STATUS_OPTIONS: StatusOption[] = [
  { value: 'active',      labelKey: 'goals_status_active',      labelEn: 'Actively looking',       dot: 'bg-green-500' },
  { value: 'open',        labelKey: 'goals_status_open',        labelEn: 'Open to opportunities',  dot: 'bg-blue-500' },
  { value: 'browsing',    labelKey: 'goals_status_browsing',    labelEn: 'Just browsing',           dot: 'bg-amber-500' },
  { value: 'not_looking', labelKey: 'goals_status_not_looking', labelEn: 'Not looking',            dot: 'bg-gray-400' },
];

const DEFAULT_PREFS: JobPreferences = {
  status: 'open',
  roles: '',
  locations: '',
  salaryMin: '',
  availability: '',
};

// Curated suggestion lists so role/location entries converge on canonical values
// instead of inconsistent free text. The fields stay comma-separated multi-value
// (a combobox), so users can still add anything not on the list.
const ROLE_SUGGESTIONS = [
  'Software Engineer', 'Frontend Engineer', 'Backend Engineer', 'Full-Stack Engineer',
  'Mobile Developer', 'DevOps Engineer', 'Cloud Engineer', 'Data Analyst', 'Data Scientist',
  'Data Engineer', 'Machine Learning Engineer', 'QA Engineer', 'Cybersecurity Analyst',
  'Product Manager', 'Project Manager', 'Business Analyst', 'UX Designer', 'UI Designer',
  'Product Designer', 'Marketing Manager', 'Sales Representative', 'Account Manager',
  'Financial Analyst', 'HR Specialist', 'Operations Manager',
];

const LOCATION_SUGGESTIONS = [
  'Remote', 'Hybrid', 'On-site',
  'Toronto', 'Vancouver', 'Ottawa', 'Montreal', 'Calgary',
  'New York', 'San Francisco', 'Seattle', 'Austin',
  'London', 'Berlin', 'Paris', 'Singapore', 'Tokyo', 'Sydney',
];

const CareerGoalsPanel: React.FC<CareerGoalsPanelProps> = ({ t: tProp, session, profile, refreshProfile }) => {
  // Identity fallback — returns the English label for the key when no t() provided
  const t = tProp ?? ((key: string) => {
    const map: Record<string, string> = {
      goals_panel_title:      'Career Goals',
      goals_panel_desc:       'Set your job-seeking preferences to guide role recommendations.',
      goals_status_active:    'Actively looking',
      goals_status_open:      'Open to opportunities',
      goals_status_browsing:  'Just browsing',
      goals_status_not_looking: 'Not looking',
      goals_label_roles:      'Target roles',
      goals_placeholder_roles: 'e.g. Frontend Engineer, Full-stack',
      goals_label_locations:  'Preferred locations',
      goals_placeholder_locations: 'e.g. Ottawa, Remote',
      goals_label_salary:     'Minimum salary',
      goals_placeholder_salary: 'e.g. 80k CAD',
      goals_salary_hint:      'Use a yearly amount plus currency, for example 80000 CAD.',
      goals_label_availability: 'Availability',
      goals_placeholder_availability: 'e.g. 2 weeks notice',
      goals_save_button:      'Save',
      goals_saving_button:    'Saving...',
      goals_saved_flash:      'Saved',
      goals_saved_to_account: 'Saved to your account',
      goals_saved_locally:    'Saved on this device',
      goals_save_failed:      'Saved here, but account sync failed: {error}',
      goals_feeds_ai:         'Used to guide job matches, filters, and outreach prep.',
      goals_no_prefs:         'No preferences set yet.',
    };
    return map[key] ?? key;
  });

  const { prefs: storedPrefs, save } = useJobPreferences({ accountPrefs: profile?.job_preferences ?? null });
  const [isExpanded, setIsExpanded] = useState(!storedPrefs);
  const [form, setForm] = useState<JobPreferences>(storedPrefs ?? DEFAULT_PREFS);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');
  const [hasEdited, setHasEdited] = useState(false);
  const savedFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveInFlightRef = useRef(false);

  useEffect(() => () => {
    if (savedFlashTimerRef.current) clearTimeout(savedFlashTimerRef.current);
    saveInFlightRef.current = false;
  }, []);

  useEffect(() => {
    if (!storedPrefs || hasEdited) return;
    setForm(storedPrefs);
    if (saveState !== 'saving') setIsExpanded(false);
  }, [storedPrefs, hasEdited, saveState]);

  const patchForm = (patch: Partial<JobPreferences>) => {
    setHasEdited(true);
    setSaveState('idle');
    setSaveError('');
    setForm((f) => ({ ...f, ...patch }));
  };

  const handleSave = async () => {
    if (saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    try {
      const nextPrefs = normalizeJobPreferences(form) ?? form;
      const uid = session?.user?.id;
      save(nextPrefs);
      setForm(nextPrefs);
      setHasEdited(false);
      setSaveError('');
      setSaveState(uid ? 'saving' : 'saved');

      if (uid) {
        const { error } = await data.profiles.update(uid, {
          job_preferences: nextPrefs,
          updated_at: new Date().toISOString(),
        });
        if (error) throw error;
        await refreshProfile?.();
      }

      setSaveState('saved');
      setIsExpanded(false);
      if (savedFlashTimerRef.current) clearTimeout(savedFlashTimerRef.current);
      savedFlashTimerRef.current = setTimeout(() => setSaveState('idle'), 2200);
    } catch (error) {
      setSaveState('error');
      setSaveError(error instanceof Error ? error.message : 'Please try again.');
      setIsExpanded(true);
    } finally {
      saveInFlightRef.current = false;
    }
  };

  const summary = storedPrefs ? prefsSummaryLine(storedPrefs) : null;

  return (
    <section data-qa="career-goals-panel" className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
      {/* Header / collapsed row */}
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left"
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Target className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('goals_panel_title')}</span>
          {!isExpanded && storedPrefs && (
            <span className="ml-2 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 truncate">
              {/* Status dot + label */}
              {(() => {
                const opt = STATUS_OPTIONS.find((o) => o.value === storedPrefs.status);
                return opt ? (
                  <>
                    <span className={`inline-block h-2 w-2 rounded-full ${opt.dot}`} />
                    <span>{t(opt.labelKey)}</span>
                  </>
                ) : null;
              })()}
              {summary && <span className="text-gray-400 dark:text-gray-500">·</span>}
              {summary && <span className="truncate">{summary}</span>}
            </span>
          )}
          {!isExpanded && !storedPrefs && (
            <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">{t('goals_no_prefs')}</span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" />
        )}
      </button>

      {/* Expanded form */}
      {isExpanded && (
        <div className="px-5 pb-5 border-t border-slate-100 dark:border-slate-700">
          <p className="mt-3 mb-4 text-sm text-gray-600 dark:text-gray-300">{t('goals_panel_desc')}</p>

          {/* Status segmented control */}
          <div className="mb-4">
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((opt) => {
                const isActive = form.status === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => patchForm({ status: opt.value })}
                    data-qa={`career-goals-status-${opt.value}`}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors
                      ${isActive
                        ? 'border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-slate-600'
                      }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${opt.dot}`} />
                    {t(opt.labelKey)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Text inputs */}
          <div className="grid gap-3 sm:grid-cols-2">
            {/* Target roles */}
            <div>
              <label htmlFor="cg-roles" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('goals_label_roles')}
              </label>
              <input
                id="cg-roles"
                data-qa="career-goals-roles"
                type="text"
                list="cg-role-suggestions"
                value={form.roles}
                onChange={(e) => patchForm({ roles: e.target.value })}
                placeholder={t('goals_placeholder_roles')}
                className="w-full rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
              />
              <datalist id="cg-role-suggestions">
                {ROLE_SUGGESTIONS.map((r) => <option key={r} value={r} />)}
              </datalist>
            </div>

            {/* Preferred locations */}
            <div>
              <label htmlFor="cg-locations" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('goals_label_locations')}
              </label>
              <input
                id="cg-locations"
                data-qa="career-goals-locations"
                type="text"
                list="cg-location-suggestions"
                value={form.locations}
                onChange={(e) => patchForm({ locations: e.target.value })}
                placeholder={t('goals_placeholder_locations')}
                className="w-full rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
              />
              <datalist id="cg-location-suggestions">
                {LOCATION_SUGGESTIONS.map((l) => <option key={l} value={l} />)}
              </datalist>
            </div>

            {/* Minimum salary */}
            <div>
              <label htmlFor="cg-salary" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('goals_label_salary')}
              </label>
              <input
                id="cg-salary"
                data-qa="career-goals-salary"
                type="number"
                min="0"
                step="1000"
                inputMode="numeric"
                value={form.salaryMin}
                onChange={(e) => patchForm({ salaryMin: e.target.value })}
                placeholder={t('goals_placeholder_salary')}
                className="w-full rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
              />
              <p className="mt-1 text-[11px] leading-4 text-gray-500 dark:text-gray-400">{t('goals_salary_hint')}</p>
            </div>

            {/* Availability */}
            <div>
              <label htmlFor="cg-availability" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('goals_label_availability')}
              </label>
              <input
                id="cg-availability"
                data-qa="career-goals-availability"
                type="text"
                value={form.availability}
                onChange={(e) => patchForm({ availability: e.target.value })}
                placeholder={t('goals_placeholder_availability')}
                className="w-full rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('goals_feeds_ai')}</p>
              {saveState === 'saved' && (
                <p data-qa="career-goals-save-status" className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {session?.user?.id ? t('goals_saved_to_account') : t('goals_saved_locally')}
                </p>
              )}
              {saveState === 'error' && (
                <p data-qa="career-goals-save-status" className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-300">
                  <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('goals_save_failed').replace('{error}', saveError || 'Please try again.')}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={handleSave}
              data-qa="career-goals-save"
              disabled={saveState === 'saving'}
              className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md bg-blue-700 hover:bg-blue-800 px-4 py-1.5 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-blue-400"
            >
              {saveState === 'saving' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {saveState === 'saved' && <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
              {saveState === 'saving' ? t('goals_saving_button') : saveState === 'saved' ? t('goals_saved_flash') : t('goals_save_button')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

export default CareerGoalsPanel;
