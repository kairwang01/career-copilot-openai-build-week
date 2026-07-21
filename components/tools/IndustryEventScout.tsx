import React, { useEffect, useMemo, useState } from 'react';
import {
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  FileSearch,
  Globe2,
  Mail,
  MapPin,
  Search,
  UsersRound,
} from 'lucide-react';
import { findIndustryEvents } from '../../services/aiClient';
import { safeHttpUrl } from '../../lib/safeUrl';
import type { EventScoutResult, IndustryEvent } from '../../types';
import StagedLoader from '../StagedLoader';
import { useCancellableLoading } from '../../hooks/useCancellableLoading';
import { useToolResults } from '../../contexts/ToolResultsContext';
import { DownloadButtons, SavedResultBar, ToolError } from './ToolUtils';
import { buildEmailContextFromIndustryEvent } from '../../lib/toolPrefill';

const SAMPLE_FIELD = 'Artificial Intelligence';
const SAMPLE_LOCATION = 'Toronto, Canada';

interface IndustryEventScoutProps {
  openTool: (tool: string, input?: string) => void;
  t: (key: string) => string;
}

type EventFilter = 'all' | 'job_fair' | 'conference' | 'meetup' | 'other';
type GroundingChunk = { web?: { uri?: string; title?: string } };
type EventScoutResultWithContext = EventScoutResult & {
  field?: string;
  locationQuery?: string;
  generatedAt?: number;
  groundingChunks?: GroundingChunk[];
};

const FILTERS: EventFilter[] = ['all', 'job_fair', 'conference', 'meetup', 'other'];
const MAX_EVENT_RESULTS = 50;
const MAX_SEARCH_TERM_LENGTH = 160;
const MAX_EVENT_TEXT_LENGTH = 2_000;

const boundedText = (value: unknown, maxLength = MAX_EVENT_TEXT_LENGTH) =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const normalizeEventScoutResult = (value: unknown): EventScoutResultWithContext | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.events)) return null;

  const events = raw.events
    .slice(0, MAX_EVENT_RESULTS)
    .map((item): IndustryEvent | null => {
      if (!item || typeof item !== 'object') return null;
      const event = item as Record<string, unknown>;
      const eventName = boundedText(event.eventName, 300);
      const date = boundedText(event.date, 160);
      const location = boundedText(event.location, 300);
      const url = safeHttpUrl(boundedText(event.url, 2_048));
      const summary = boundedText(event.summary);
      const eventType = ['conference', 'meetup', 'job_fair'].includes(String(event.eventType))
        ? event.eventType as IndustryEvent['eventType']
        : 'other';
      // Search results without a safe network URL are not verifiable and must not
      // be presented as registration links.
      if (!eventName || !date || !location || !url || !summary) return null;
      return { eventName, date, location, url, summary, eventType };
    })
    .filter((event): event is IndustryEvent => event !== null);

  const groundingChunks = Array.isArray(raw.groundingChunks)
    ? raw.groundingChunks
      .slice(0, 12)
      .map((item): GroundingChunk | null => {
        if (!item || typeof item !== 'object') return null;
        const web = (item as { web?: unknown }).web;
        if (!web || typeof web !== 'object') return null;
        const uri = safeHttpUrl(boundedText((web as Record<string, unknown>).uri, 2_048));
        if (!uri) return null;
        return { web: { uri, title: boundedText((web as Record<string, unknown>).title, 300) } };
      })
      .filter((chunk): chunk is GroundingChunk => chunk !== null)
    : [];

  return {
    events,
    groundingChunks,
    field: boundedText(raw.field, MAX_SEARCH_TERM_LENGTH),
    locationQuery: boundedText(raw.locationQuery, MAX_SEARCH_TERM_LENGTH),
    generatedAt: typeof raw.generatedAt === 'number' && Number.isFinite(raw.generatedAt)
      ? raw.generatedAt
      : undefined,
  };
};

const CardShell: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <section className={`rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}>
    {children}
  </section>
);

const InsightItem: React.FC<{ icon: React.ElementType; title: string; body: string }> = ({ icon: Icon, title, body }) => (
  <div className="flex gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-blue-700 shadow-sm dark:bg-slate-900 dark:text-blue-300">
      <Icon className="h-4 w-4" />
    </div>
    <div>
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</p>
      <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{body}</p>
    </div>
  </div>
);

const getHostName = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const IndustryEventScout: React.FC<IndustryEventScoutProps> = ({ openTool, t }) => {
  const { loading, begin, end, cancel } = useCancellableLoading();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EventScoutResultWithContext | null>(null);
  const { canSave, saved, saveState, persist, clear } = useToolResults<EventScoutResultWithContext>();
  const [fromSaved, setFromSaved] = useState(false);
  const [field, setField] = useState('');
  const [location, setLocation] = useState('');
  const [activeFilter, setActiveFilter] = useState<EventFilter>('all');
  const isChineseUi = /[\u3400-\u9fff]/.test(t('tool_industry_event_scout_title') || t('tool_event_scout_find_button'));

  const ui = {
    tryExample: t('tool_try_example'),
    retry: t('tool_try_again'),
    all: isChineseUi ? '全部' : 'All',
    jobFair: isChineseUi ? '招聘活动' : 'Hiring event',
    conference: isChineseUi ? '会议' : 'Conference',
    meetup: isChineseUi ? '聚会' : 'Meetup',
    other: isChineseUi ? '其他' : 'Other',
    searchQuality: isChineseUi ? '搜索质量' : 'Search quality',
    fieldStatus: isChineseUi ? '行业方向' : 'Field',
    locationStatus: isChineseUi ? '地点范围' : 'Location',
    missing: isChineseUi ? '待填写' : 'Needed',
    ready: isChineseUi ? '已填写' : 'Ready',
    resultCount: isChineseUi ? '个活动' : 'events',
    eventType: isChineseUi ? '活动类型' : 'Event type',
    sourceShortlist: isChineseUi ? '来源会优先选择官网、活动页和可信社区。' : 'Prioritizes official event pages, organizers, and credible community listings.',
    fitSignal: isChineseUi ? '适合用于拓展人脉、找招聘活动或了解行业趋势。' : 'Useful for networking, hiring events, and reading the local market.',
    verifyBeforeRegister: isChineseUi ? '报名之前请确认日期、费用、地点和主办方。' : 'Before registering, verify the date, cost, location, and organizer.',
    emptyFiltered: t('tool_event_scout_no_filter_results'),
    emptyAll: t('tool_event_scout_no_results'),
    preparedFor: isChineseUi ? '搜索范围' : 'Search scope',
    sources: t('tool_event_scout_sources_label'),
    sourceFallback: isChineseUi ? '来源' : 'Source',
    visit: t('tool_event_scout_visit_link'),
    draftEmail: t('tool_event_scout_draft_email_button'),
    newSearch: t('tool_event_scout_new_search_button'),
  };

  const eventTypeConfig: Record<EventFilter, { label: string; chip: string; dot: string }> = {
    all: { label: ui.all, chip: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200', dot: 'bg-slate-400' },
    job_fair: { label: ui.jobFair, chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-200 dark:ring-emerald-800', dot: 'bg-emerald-500' },
    conference: { label: ui.conference, chip: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-900/20 dark:text-blue-200 dark:ring-blue-800', dot: 'bg-blue-500' },
    meetup: { label: ui.meetup, chip: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200 dark:bg-violet-900/20 dark:text-violet-200 dark:ring-violet-800', dot: 'bg-violet-500' },
    other: { label: ui.other, chip: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200 dark:bg-amber-900/20 dark:text-amber-200 dark:ring-amber-800', dot: 'bg-amber-500' },
  };

  useEffect(() => {
    const normalized = saved && !result ? normalizeEventScoutResult(saved.result) : null;
    if (normalized) {
      setResult(normalized);
      setFromSaved(true);
      if (normalized.field) setField(normalized.field);
      if (normalized.locationQuery) setLocation(normalized.locationQuery);
    }
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredEvents = useMemo(() => {
    if (!result) return [];
    return result.events.filter((event) => activeFilter === 'all' || (event.eventType || 'other') === activeFilter);
  }, [activeFilter, result]);

  const groundingSources = useMemo(() => {
    const chunks = result?.groundingChunks ?? [];
    return chunks
      .filter((chunk): chunk is GroundingChunk & { web: { uri: string; title?: string } } => Boolean(chunk?.web?.uri))
      .slice(0, 6);
  }, [result]);

  const resetResult = () => {
    setResult(null);
    setFromSaved(false);
    setError(null);
    setActiveFilter('all');
  };

  const handleTryExample = () => {
    setField(SAMPLE_FIELD);
    setLocation(SAMPLE_LOCATION);
    setError(null);
  };

  const runTool = async () => {
    const nextField = field.trim().slice(0, MAX_SEARCH_TERM_LENGTH);
    const nextLocation = location.trim().slice(0, MAX_SEARCH_TERM_LENGTH);
    if (!nextField || !nextLocation) {
      setError(t('tool_event_scout_error_required'));
      return;
    }

    setField(nextField);
    setLocation(nextLocation);
    setActiveFilter('all');

    const alive = begin();
    setError(null);
    setResult(null);
    try {
      const apiResult = normalizeEventScoutResult(await findIndustryEvents(nextField, nextLocation));
      if (!alive()) return;
      if (!apiResult) {
        throw new Error(t('ai_error_empty_response'));
      }
      const nextResult: EventScoutResultWithContext = {
        ...apiResult,
        field: nextField,
        locationQuery: nextLocation,
        generatedAt: Date.now(),
      };
      setResult(nextResult);
      setFromSaved(false);
      persist(nextResult);
    } catch (err) {
      if (alive()) setError(err instanceof Error ? err.message : t('unexpected_error'));
    } finally {
      if (alive()) end();
    }
  };

  const buildDownloadText = (events: IndustryEvent[]) =>
    events
      .map((event) => {
        const eventType = (event.eventType || 'other') as EventFilter;
        return [
          `## ${event.eventName}`,
          `${event.date} | ${event.location} | ${eventTypeConfig[eventType]?.label ?? ui.other}`,
          event.summary,
          safeHttpUrl(event.url),
        ].filter(Boolean).join('\n');
      })
      .join('\n\n');

  const renderInput = () => {
    const fieldReady = Boolean(field.trim());
    const locationReady = Boolean(location.trim());
    return (
      <div data-qa="industry-event-scout-tool" data-qa-tool-state="input" className="mx-auto max-w-6xl space-y-6">
        <CardShell className="overflow-hidden">
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1.15fr)_360px]">
            <div className="p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.24em] text-blue-700 dark:text-blue-300">
                    <FileSearch className="h-4 w-4" />
                    {t('tool_event_scout_intro_title')}
                  </div>
                  <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
                    {t('tool_industry_event_scout_title')}
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                    {t('tool_event_scout_intro_desc')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleTryExample}
                  data-qa="industry-event-scout-try-example"
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Search className="h-4 w-4" />
                  {ui.tryExample}
                </button>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="field-of-interest" className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {t('tool_event_scout_field_label')}
                  </label>
                  <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2.5 shadow-sm focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:focus-within:ring-blue-900/40">
                    <BriefcaseBusiness className="h-4 w-4 shrink-0 text-slate-400" />
                    <input
                      type="text"
                      id="field-of-interest"
                      data-qa="industry-event-scout-field"
                      value={field}
                      onChange={(event) => setField(event.target.value)}
                      maxLength={MAX_SEARCH_TERM_LENGTH}
                      required
                      className="min-w-0 flex-1 bg-transparent text-sm text-slate-950 outline-none placeholder:text-slate-400 dark:text-slate-100"
                      placeholder={t('tool_event_scout_field_placeholder')}
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="event-location" className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {t('tool_event_scout_location_label')}
                  </label>
                  <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2.5 shadow-sm focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:focus-within:ring-blue-900/40">
                    <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
                    <input
                      type="text"
                      id="event-location"
                      data-qa="industry-event-scout-location"
                      value={location}
                      onChange={(event) => setLocation(event.target.value)}
                      maxLength={MAX_SEARCH_TERM_LENGTH}
                      required
                      className="min-w-0 flex-1 bg-transparent text-sm text-slate-950 outline-none placeholder:text-slate-400 dark:text-slate-100"
                      placeholder={t('tool_event_scout_location_placeholder')}
                    />
                  </div>
                </div>
              </div>

              {error && (
                <div className="mt-4">
                  <ToolError message={error} onRetry={runTool} retryLabel={ui.retry} />
                </div>
              )}

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={runTool}
                  data-qa="industry-event-scout-generate"
                  disabled={loading}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300 dark:disabled:bg-blue-900"
                >
                  <Search className="h-4 w-4" />
                  {loading ? t('tool_event_scout_searching_button') : t('tool_event_scout_find_button')}
                </button>
                <p className="text-sm text-slate-500 dark:text-slate-400">{ui.verifyBeforeRegister}</p>
              </div>
            </div>

            <aside className="border-t border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950/60 lg:border-l lg:border-t-0">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">{ui.searchQuality}</p>
              <div className="mt-4 grid gap-3">
                <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{ui.fieldStatus}</span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${fieldReady ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200' : 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-200'}`}>
                      {fieldReady ? ui.ready : ui.missing}
                    </span>
                  </div>
                  <p className="mt-2 truncate text-sm text-slate-500 dark:text-slate-400">{fieldReady ? field.trim() : t('tool_event_scout_field_placeholder')}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{ui.locationStatus}</span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${locationReady ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200' : 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-200'}`}>
                      {locationReady ? ui.ready : ui.missing}
                    </span>
                  </div>
                  <p className="mt-2 truncate text-sm text-slate-500 dark:text-slate-400">{locationReady ? location.trim() : t('tool_event_scout_location_placeholder')}</p>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                <InsightItem icon={Globe2} title={ui.sources} body={ui.sourceShortlist} />
                <InsightItem icon={UsersRound} title={ui.eventType} body={ui.fitSignal} />
              </div>
            </aside>
          </div>
        </CardShell>
      </div>
    );
  };

  const renderEventCard = (event: IndustryEvent, index: number) => {
    const eventType = (event.eventType || 'other') as EventFilter;
    const typeInfo = eventTypeConfig[eventType] ?? eventTypeConfig.other;
    const eventUrl = safeHttpUrl(event.url);
    const host = getHostName(eventUrl);
    return (
      <article
        key={`${event.eventName}-${index}`}
        data-qa="industry-event-card"
        className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-start justify-between gap-4">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${typeInfo.chip}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${typeInfo.dot}`} />
            {typeInfo.label}
          </span>
          {host && <span className="max-w-[140px] truncate text-xs font-medium text-slate-400">{host}</span>}
        </div>
        <h3 data-qa="industry-event-name" className="mt-4 text-lg font-semibold leading-snug text-slate-950 dark:text-slate-50">{event.eventName}</h3>
        <div className="mt-3 grid gap-2 text-sm text-slate-600 dark:text-slate-400">
          <div className="flex gap-2">
            <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <span>{event.date}</span>
          </div>
          <div className="flex gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <span>{event.location}</span>
          </div>
        </div>
        <p data-qa="industry-event-summary" className="mt-4 flex-1 text-sm leading-relaxed text-slate-700 dark:text-slate-300">{event.summary}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {eventUrl && (
            <a
              href={eventUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-900 dark:text-blue-300 dark:hover:bg-blue-950/30"
            >
              {ui.visit}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )}
          <button
            type="button"
            data-qa="industry-event-draft-email"
            onClick={() => openTool('email-crafter', buildEmailContextFromIndustryEvent(event, result?.field || field))}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Mail className="h-3.5 w-3.5" />
            {ui.draftEmail}
          </button>
        </div>
      </article>
    );
  };

  const renderResult = () => {
    if (!result) return null;
    const downloadText = buildDownloadText(result.events);
    const scope = [result.field || field, result.locationQuery || location].filter(Boolean).join(' · ');

    return (
      <div data-qa="industry-event-scout-tool" data-qa-tool-state="result" className="mx-auto max-w-6xl space-y-5 break-words animate-fade-in">
        <SavedResultBar
          t={t}
          canSave={canSave}
          isSaved={fromSaved}
          savedAt={saved?.savedAt ?? null}
          saveState={saveState}
          onTryNext={resetResult}
          onClearSaved={() => { clear(); setFromSaved(false); }}
        />

        <CardShell className="overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-slate-200 p-5 dark:border-slate-800 sm:flex-row sm:items-start sm:justify-between sm:p-6">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] text-blue-700 dark:text-blue-300">
                <CalendarDays className="h-4 w-4" />
                {t('tool_event_scout_results_title')}
              </div>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
                {filteredEvents.length} {ui.resultCount}
              </h2>
              {scope && (
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  {ui.preparedFor}: <span className="font-semibold text-slate-800 dark:text-slate-200">{scope}</span>
                </p>
              )}
            </div>
            <DownloadButtons textContent={downloadText} baseFilename="industry_events" />
          </div>

          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((filterKey) => (
                <button
                  key={filterKey}
                  type="button"
                  onClick={() => setActiveFilter(filterKey)}
                  aria-pressed={activeFilter === filterKey}
                  className={`min-h-11 rounded-full px-3.5 py-2 text-sm font-semibold transition ${
                    activeFilter === filterKey
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {eventTypeConfig[filterKey].label}
                </button>
              ))}
            </div>

            {error && (
              <div className="mt-4">
                <ToolError message={error} onRetry={runTool} retryLabel={ui.retry} />
              </div>
            )}

            {result.events.length === 0 ? (
              <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center dark:border-slate-700 dark:bg-slate-800/60">
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{ui.emptyAll}</p>
              </div>
            ) : filteredEvents.length === 0 ? (
              <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center dark:border-slate-700 dark:bg-slate-800/60">
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{ui.emptyFiltered}</p>
              </div>
            ) : (
              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                {filteredEvents.map(renderEventCard)}
              </div>
            )}
          </div>
        </CardShell>

        {groundingSources.length > 0 && (
          <CardShell className="p-5 sm:p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
              {ui.sources}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {groundingSources.map((chunk, index) => (
                <a
                  key={`${chunk.web.uri ?? chunk.web.title ?? index}`}
                  href={chunk.web.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-medium text-blue-700 transition hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-800 dark:text-blue-300 dark:hover:bg-blue-950/30"
                >
                  <span className="line-clamp-2">{chunk.web.title || getHostName(chunk.web.uri || '') || ui.sourceFallback}</span>
                </a>
              ))}
            </div>
          </CardShell>
        )}

        <button
          type="button"
          onClick={resetResult}
          className="w-full rounded-xl border-2 border-dashed border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {ui.newSearch}
        </button>
      </div>
    );
  };

  if (loading) {
    return (
      <StagedLoader
        title={t('tool_event_scout_searching_button')}
        steps={[
          t('tool_event_scout_loader_step1'),
          t('tool_event_scout_loader_step2'),
          t('tool_event_scout_loader_step3'),
        ]}
        onCancel={cancel}
        icon={<CalendarDays />}
        accent="amber"
      />
    );
  }

  return result ? renderResult() : renderInput();
};

export default IndustryEventScout;
