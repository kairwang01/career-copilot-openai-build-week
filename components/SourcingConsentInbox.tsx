import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  Inbox,
  Loader2,
  MessageSquare,
  ShieldAlert,
  Undo2,
  XCircle,
} from 'lucide-react';
import {
  respondSourcingOutreach,
  subscribeSourcingOutreachForCandidate,
  type SourcingOutreach,
} from '../lib/sourcingOutreachData';
import { useToast } from './Toast';

type TranslationFn = (key: string) => string;

interface SourcingConsentInboxProps {
  uid: string;
  t: TranslationFn;
}

const formatCopy = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((copy, [key, value]) => copy.replaceAll(`{${key}}`, String(value)), template);

const formatDate = (value: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const statusLabelKey = (status: SourcingOutreach['status']) => {
  switch (status) {
    case 'accepted':
      return 'sourcing_status_accepted';
    case 'declined':
      return 'sourcing_status_declined';
    case 'cancelled':
      return 'sourcing_status_cancelled';
    case 'revoked':
      return 'sourcing_status_revoked';
    case 'requested':
    default:
      return 'sourcing_status_requested';
  }
};

const statusClass = (status: SourcingOutreach['status']) => {
  switch (status) {
    case 'accepted':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-900/20 dark:text-emerald-300';
    case 'declined':
      return 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
    case 'cancelled':
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-300';
    case 'revoked':
      return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/50 dark:bg-rose-900/20 dark:text-rose-300';
    case 'requested':
    default:
      return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800/50 dark:bg-blue-900/20 dark:text-blue-300';
  }
};

const SourcingConsentInbox: React.FC<SourcingConsentInboxProps> = ({ uid, t }) => {
  const [requests, setRequests] = useState<SourcingOutreach[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const respondingRef = useRef<string | null>(null);
  const responseRunRef = useRef(0);
  const { addToast } = useToast();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    responseRunRef.current += 1;
    respondingRef.current = null;
    setRespondingId(null);

    if (!uid) {
      setRequests([]);
      setLoading(false);
      return undefined;
    }
    let active = true;
    setLoading(true);
    setError(null);
    const unsubscribe = subscribeSourcingOutreachForCandidate(
      uid,
      (next) => {
        if (!mountedRef.current || !active) return;
        setRequests(next);
        setLoading(false);
      },
      () => {
        if (!mountedRef.current || !active) return;
        setError(t('sourcing_inbox_error'));
        setLoading(false);
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [t, uid]);

  const pending = useMemo(() => requests.filter((request) => request.status === 'requested'), [requests]);
  const recent = useMemo(() => {
    const resolved = requests.filter((request) => request.status !== 'requested');
    const now = Date.now();
    const revocable = resolved.filter((request) => (
      request.status === 'accepted' && request.packet_expires_at_ms > now
    ));
    const otherRecent = resolved
      .filter((request) => !revocable.includes(request))
      .slice(0, Math.max(0, 3 - revocable.length));
    // Every active acceptance remains reachable so candidates can always revoke
    // it; non-revocable history stays intentionally compact.
    return [...revocable, ...otherRecent];
  }, [requests]);

  const respond = async (request: SourcingOutreach, action: 'accept' | 'decline' | 'revoke') => {
    if (respondingRef.current) return;
    const runId = ++responseRunRef.current;
    respondingRef.current = request.id;
    setRespondingId(request.id);
    try {
      await respondSourcingOutreach({ outreachId: request.id, action });
      if (mountedRef.current && responseRunRef.current === runId) {
        const successKey = action === 'accept'
          ? 'sourcing_accept_success'
          : action === 'revoke'
            ? 'sourcing_revoke_success'
            : 'sourcing_decline_success';
        addToast(t(successKey), 'success');
      }
    } catch (err) {
      if (mountedRef.current && responseRunRef.current === runId) {
        addToast(err instanceof Error ? err.message : t('sourcing_response_error'), 'error');
      }
    } finally {
      if (mountedRef.current && responseRunRef.current === runId) {
        respondingRef.current = null;
        setRespondingId(null);
      }
    }
  };

  return (
    <section
      data-qa="sourcing-consent-inbox"
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-blue-700 dark:border-blue-800/50 dark:bg-blue-900/30 dark:text-blue-300">
            <Inbox className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{t('sourcing_inbox_title')}</h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{t('sourcing_inbox_desc')}</p>
          </div>
        </div>
        <span className="inline-flex w-fit items-center rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 dark:border-blue-800/50 dark:bg-blue-900/20 dark:text-blue-300">
          {formatCopy(t('sourcing_pending_count'), { n: pending.length })}
        </span>
      </div>

      {loading && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('sourcing_inbox_loading')}
        </div>
      )}

      {error && (
        <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && requests.length === 0 && (
        <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
          {t('sourcing_inbox_empty')}
        </div>
      )}

      {pending.length > 0 && (
        <div className="mt-4 space-y-3">
          {pending.map((request) => (
            <article
              key={request.id}
              data-qa="sourcing-request-card"
              data-qa-sourcing-status={request.status}
              className="rounded-xl border border-blue-100 bg-blue-50/60 p-4 dark:border-blue-900/50 dark:bg-blue-950/20"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-blue-950 dark:text-blue-100">
                      <Building2 className="h-4 w-4" />
                      {request.company_name || t('sourcing_company_fallback')}
                    </span>
                    <span className="rounded-full border border-blue-200 bg-white px-2 py-0.5 text-xs font-semibold text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
                      {request.job_title || t('talent_manual_role_label')}
                    </span>
                    {formatDate(request.created_at) && (
                      <span className="text-xs text-blue-700 dark:text-blue-300">{formatDate(request.created_at)}</span>
                    )}
                  </div>
                  <p className="mt-3 whitespace-pre-line text-sm leading-6 text-blue-900 dark:text-blue-100">
                    {request.message}
                  </p>
                  {request.organization_verification === 'unverified_self_reported' && (
                    <div
                      data-qa="sourcing-org-unverified"
                      className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200"
                    >
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{t('sourcing_org_unverified')}</span>
                    </div>
                  )}
                  <p className="mt-3 text-xs leading-5 text-blue-800 dark:text-blue-200">
                    {t('sourcing_packet_expiry_note')}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col">
                  <button
                    type="button"
                    onClick={() => respond(request, 'accept')}
                    disabled={Boolean(respondingId)}
                    aria-busy={respondingId === request.id}
                    data-qa="sourcing-accept"
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-wait disabled:bg-emerald-400"
                  >
                    {respondingId === request.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    {t('sourcing_accept')}
                  </button>
                  <button
                    type="button"
                    onClick={() => respond(request, 'decline')}
                    disabled={Boolean(respondingId)}
                    aria-busy={respondingId === request.id}
                    data-qa="sourcing-decline"
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-wait disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <XCircle className="h-4 w-4" />
                    {t('sourcing_decline')}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('sourcing_recent_title')}</p>
          <div className="mt-2 space-y-2">
            {recent.map((request) => (
              <div
                key={request.id}
                data-qa="sourcing-recent-card"
                data-qa-sourcing-status={request.status}
                className="flex flex-col gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <MessageSquare className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="truncate font-medium text-slate-900 dark:text-slate-100">
                      {request.company_name || t('sourcing_company_fallback')} · {request.job_title || t('talent_manual_role_label')}
                    </span>
                  </div>
                  {request.message && (
                    <p className="mt-1 line-clamp-2 whitespace-pre-line text-xs leading-5 text-slate-600 dark:text-slate-400">
                      {request.message}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <span className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-xs font-semibold ${statusClass(request.status)}`}>
                    {request.status === 'accepted' && request.packet_expires_at_ms <= Date.now()
                      ? t('sourcing_packet_expired')
                      : t(statusLabelKey(request.status))}
                  </span>
                  {request.status === 'accepted' && request.packet_expires_at_ms > Date.now() && (
                    <button
                      type="button"
                      onClick={() => respond(request, 'revoke')}
                      disabled={Boolean(respondingId)}
                      aria-busy={respondingId === request.id}
                      data-qa="sourcing-revoke"
                      className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-wait disabled:text-rose-300 dark:border-rose-800 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-rose-950/30"
                    >
                      {respondingId === request.id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Undo2 className="h-3.5 w-3.5" />}
                      {t('sourcing_revoke')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};

export default SourcingConsentInbox;
