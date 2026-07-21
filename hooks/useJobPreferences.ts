import { useEffect, useState } from 'react';

export interface JobPreferences {
  status: 'active' | 'open' | 'browsing' | 'not_looking';
  roles: string;        // comma-separated free text, e.g. "Frontend Engineer, Full-stack"
  locations: string;    // e.g. "Ottawa, Remote"
  salaryMin: string;    // free text, e.g. "80k CAD"
  availability: string; // e.g. "2 weeks notice"
}

const KEY = 'job_preferences';
const UPDATE_EVENT = 'career-copilot:job-preferences-updated';
const STATUSES: JobPreferences['status'][] = ['active', 'open', 'browsing', 'not_looking'];

const clampText = (value: unknown, maxLength: number): string => (
  typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
);

const preferenceKey = (p: JobPreferences): string => (
  [p.status, p.roles, p.locations, p.salaryMin, p.availability].join('\u001f')
);

export function normalizeJobPreferences(value: unknown): JobPreferences | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const status = record.status;
  if (typeof status !== 'string' || !STATUSES.includes(status as JobPreferences['status'])) return null;

  return {
    status: status as JobPreferences['status'],
    roles: clampText(record.roles, 240),
    locations: clampText(record.locations, 240),
    salaryMin: clampText(record.salaryMin, 80),
    availability: clampText(record.availability, 120),
  };
}

export function loadJobPreferences(): JobPreferences | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalizeJobPreferences(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function getEffectiveJobPreferences(accountPrefs?: unknown): JobPreferences | null {
  return normalizeJobPreferences(accountPrefs) ?? loadJobPreferences();
}

export function saveJobPreferences(p: JobPreferences): void {
  const next = normalizeJobPreferences(p) ?? p;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* storage unavailable */ }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<JobPreferences>(UPDATE_EVENT, { detail: next }));
  }
}

const STATUS_LABELS: Record<JobPreferences['status'], string> = {
  active: 'Actively looking',
  open: 'Open to opportunities',
  browsing: 'Just browsing',
  not_looking: 'Not looking',
};

/** Renders the preferences as a prompt block the AI job search prepends to the resume. */
export function preferencesToPromptBlock(p: JobPreferences): string {
  const statusLabel = STATUS_LABELS[p.status] ?? p.status;
  const lines: string[] = [
    'CANDIDATE JOB PREFERENCES (use these to filter and rank results):',
    `- Job-seeking status: ${statusLabel}`,
  ];
  if (p.roles.trim()) lines.push(`- Target roles: ${p.roles.trim()}`);
  if (p.locations.trim()) lines.push(`- Preferred locations: ${p.locations.trim()}`);
  if (p.salaryMin.trim()) lines.push(`- Minimum salary expectation: ${p.salaryMin.trim()}`);
  if (p.availability.trim()) lines.push(`- Availability: ${p.availability.trim()}`);
  return lines.join('\n');
}

/** One-line summary for display (roles · locations · salaryMin). */
export function prefsSummaryLine(p: JobPreferences): string {
  const parts: string[] = [];
  if (p.roles.trim()) parts.push(p.roles.trim());
  if (p.locations.trim()) parts.push(p.locations.trim());
  if (p.salaryMin.trim()) parts.push(p.salaryMin.trim());
  return parts.join(' · ');
}

/** React hook — wraps load/save with local state and mirrors account-backed prefs. */
export function useJobPreferences(options?: { accountPrefs?: unknown }): {
  prefs: JobPreferences | null;
  save: (p: JobPreferences) => void;
} {
  const accountPrefs = normalizeJobPreferences(options?.accountPrefs);
  const [prefs, setPrefs] = useState<JobPreferences | null>(() => loadJobPreferences());

  useEffect(() => {
    if (!accountPrefs) return;
    saveJobPreferences(accountPrefs);
    setPrefs(accountPrefs);
  }, [accountPrefs ? preferenceKey(accountPrefs) : '']);

  useEffect(() => {
    const syncFromStorage = () => setPrefs(loadJobPreferences());
    const syncFromEvent = (event: Event) => {
      const nextPrefs = (event as CustomEvent<JobPreferences>).detail;
      setPrefs(nextPrefs ?? loadJobPreferences());
    };

    window.addEventListener('storage', syncFromStorage);
    window.addEventListener(UPDATE_EVENT, syncFromEvent);

    return () => {
      window.removeEventListener('storage', syncFromStorage);
      window.removeEventListener(UPDATE_EVENT, syncFromEvent);
    };
  }, []);

  const save = (p: JobPreferences) => {
    saveJobPreferences(p);
    setPrefs(p);
  };

  return { prefs, save };
}
