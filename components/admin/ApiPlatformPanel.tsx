import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Info, X } from 'lucide-react';
import { Card, EmptyState, FieldLabel, PrimaryButton, SectionHeading, SubsectionHeading, tableCell, tableHead, tableRow, textInput } from './adminUi';
import { at } from './adminText';
import { ViewportAwareDialog } from '../ViewportAwareDialog';
import ConfirmActionDialog from '../ConfirmActionDialog';
import { API_KEY_SCOPES, type ApiKeyScope } from '../../lib/access/permissions';
import {
  apiPlatform,
  type ApiApplication,
  type ApiRequestLogEntry,
  type ApiUsageSummary,
  type PlatformApiKey,
} from '../../services/apiPlatformClient';

/**
 * API Platform tab.
 *
 * Manages third-party applications and their scoped keys against the
 * apiPlatformClient service contract. Backend contract:
 * functions/src/handlers/apiPlatform.contract.md
 */

const ENV_BADGE: Record<'development' | 'production', string> = {
  development: 'bg-blue-50 text-blue-700 border border-blue-100',
  production: 'bg-violet-50 text-violet-700 border border-violet-100',
};
const STATUS_BADGE: Record<PlatformApiKey['status'], string> = {
  active: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
  disabled: 'bg-gray-100 text-gray-600 border border-gray-200',
  revoked: 'bg-red-50 text-red-700 border border-red-200',
};

const fmtDate = (iso: string | null) => (iso ? iso.slice(0, 10) : at('api.keys.never'));

export const ApiPlatformPanel: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const [apps, setApps] = useState<ApiApplication[]>([]);
  const [keys, setKeys] = useState<PlatformApiKey[]>([]);
  const [usage, setUsage] = useState<ApiUsageSummary | null>(null);
  const [requests, setRequests] = useState<ApiRequestLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // create-app form
  const [showAppForm, setShowAppForm] = useState(false);
  const [appName, setAppName] = useState('');
  const [appDesc, setAppDesc] = useState('');
  const [appEnv, setAppEnv] = useState<'development' | 'production'>('development');
  const [creatingApp, setCreatingApp] = useState(false);

  // create-key modal
  const [keyModalApp, setKeyModalApp] = useState<ApiApplication | null>(null);
  const [keyName, setKeyName] = useState('');
  const [keyScopes, setKeyScopes] = useState<ApiKeyScope[]>(['jobs.read']);
  const [creatingKey, setCreatingKey] = useState(false);
  // Show-once secret modal. The secret lives only in this transient state.
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);
  const [busyKeyId, setBusyKeyId] = useState<string | null>(null);
  const [productionKeyConfirmOpen, setProductionKeyConfirmOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<PlatformApiKey | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [a, k, u, r] = await Promise.all([
        apiPlatform.listApplications(),
        apiPlatform.listApiKeys(),
        apiPlatform.getUsageSummary(),
        apiPlatform.listUsageLogs(),
      ]);
      if (!mountedRef.current) return;
      setApps(a);
      setKeys(k);
      setUsage(u);
      setRequests(r);
    } catch {
      if (mountedRef.current) setLoadError(true);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const reportError = (err: unknown) =>
    mountedRef.current && setActionError(err instanceof Error ? err.message : 'The action failed. Please retry.');

  const createApp = async () => {
    if (!appName.trim()) return;
    setCreatingApp(true);
    setActionError(null);
    try {
      await apiPlatform.createApplication({ name: appName.trim(), description: appDesc.trim(), environment: appEnv });
      if (!mountedRef.current) return;
      setAppName('');
      setAppDesc('');
      setShowAppForm(false);
      await load();
    } catch (err) {
      reportError(err);
    } finally {
      if (mountedRef.current) setCreatingApp(false);
    }
  };

  const createKey = async () => {
    if (!keyModalApp || !keyName.trim() || keyScopes.length === 0) return;
    setCreatingKey(true);
    setActionError(null);
    try {
      const result = await apiPlatform.createApiKey({
        app_id: keyModalApp.id,
        name: keyName.trim(),
        environment: keyModalApp.environment,
        scopes: keyScopes,
      });
      if (!mountedRef.current) return;
      setCreatedSecret(result.secret);
      setSecretCopied(false);
      setKeyName('');
      setProductionKeyConfirmOpen(false);
      await load();
    } catch (err) {
      reportError(err);
    } finally {
      if (mountedRef.current) setCreatingKey(false);
    }
  };

  const requestCreateKey = () => {
    if (!keyModalApp || creatingKey || !keyName.trim() || keyScopes.length === 0) return;
    // Production keys count against live quotas; require an explicit product-level confirm.
    if (keyModalApp.environment === 'production') {
      setProductionKeyConfirmOpen(true);
      return;
    }
    void createKey();
  };

  const closeSecretModal = () => {
    setCreatedSecret(null);
    setKeyModalApp(null);
  };

  const toggleScope = (scope: ApiKeyScope) => {
    setKeyScopes((prev) => prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]);
  };

  const revokeKey = async (key: PlatformApiKey) => {
    setBusyKeyId(key.id);
    setActionError(null);
    try {
      await apiPlatform.revokeApiKey(key.id);
      if (mountedRef.current) setRevokeTarget(null);
      await load();
    }
    catch (err) { reportError(err); }
    finally { if (mountedRef.current) setBusyKeyId(null); }
  };

  const toggleKeyStatus = async (key: PlatformApiKey) => {
    setBusyKeyId(key.id);
    setActionError(null);
    try {
      await apiPlatform.updateApiKeyStatus(key.id, key.status === 'active' ? 'disabled' : 'active');
      await load();
    } catch (err) { reportError(err); }
    finally { if (mountedRef.current) setBusyKeyId(null); }
  };

  if (loading && apps.length === 0) {
    return (
      <div className="flex items-center justify-center py-16" role="status" aria-label="Loading API platform">
        <span className="w-6 h-6 border-2 border-blue-200 border-t-blue-700 rounded-full animate-spin" />
      </div>
    );
  }

  if (loadError) {
    return (
      <Card className="p-6 text-center">
        <p className="text-sm text-red-700">{at('api.error.load')}</p>
        <button type="button" onClick={load} className="mt-3 text-sm font-semibold text-blue-700 hover:underline">
          {at('api.error.retry')}
        </button>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Trust banner: clear about server-side secret handling */}
      <div className="flex items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          <span className="font-semibold">{at('api.banner.title')}</span>{' '}
          {at('api.banner.body')}
        </p>
      </div>

      {/* Mutation error banner */}
      {actionError && (
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 animate-panel-expand">
          <X className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="ml-auto shrink-0 text-red-600 hover:text-red-800" aria-label="Dismiss error">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Usage summary */}
      {usage && (
        <div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {[
              { label: at('api.stats.requests'), value: `${usage.month_requests.toLocaleString()} / ${usage.month_quota.toLocaleString()}` },
              { label: at('api.stats.errors'), value: String(usage.month_errors) },
              { label: at('api.stats.apps'), value: String(apps.length) },
              { label: at('api.stats.active_keys'), value: String(keys.filter((k) => k.status === 'active').length) },
            ].map((c) => (
              <Card key={c.label} className="p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{c.label}</p>
                <p className="mt-1.5 text-2xl font-semibold text-gray-900">{c.value}</p>
              </Card>
            ))}
          </div>
          <p className="mt-2 flex items-start gap-1.5 text-xs text-gray-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{at('api.stats.eventual')}</span>
          </p>
        </div>
      )}

      {/* Applications */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-3">
          <div>
            <SectionHeading>{at('api.apps.title')}</SectionHeading>
            <p className="mt-1 text-xs text-gray-500">{at('api.apps.subtitle')}</p>
          </div>
          {canManage && (
            <PrimaryButton onClick={() => setShowAppForm((v) => !v)}>
              {showAppForm ? at('api.apps.cancel') : at('api.apps.create')}
            </PrimaryButton>
          )}
        </div>

        {showAppForm && (
          <div className="mx-5 mb-4 rounded-md border border-gray-200 bg-gray-50 p-4 space-y-3 animate-panel-expand">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <FieldLabel htmlFor="app-name">{at('api.apps.name')}</FieldLabel>
                <input id="app-name" type="text" value={appName} onChange={(e) => setAppName(e.target.value)} placeholder={at('api.apps.name_ph')} className={textInput} />
              </div>
              <div>
                <FieldLabel htmlFor="app-env">{at('api.apps.env')}</FieldLabel>
                <select id="app-env" value={appEnv} onChange={(e) => setAppEnv(e.target.value as 'development' | 'production')} className={textInput}>
                  <option value="development">{at('api.apps.env_dev')}</option>
                  <option value="production">{at('api.apps.env_prod')}</option>
                </select>
              </div>
            </div>
            <div>
              <FieldLabel htmlFor="app-desc">{at('api.apps.desc')}</FieldLabel>
              <input id="app-desc" type="text" value={appDesc} onChange={(e) => setAppDesc(e.target.value)} placeholder={at('api.apps.desc_ph')} className={textInput} />
            </div>
            <button
              type="button"
              onClick={createApp}
              disabled={creatingApp || !appName.trim()}
              className="inline-flex items-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-800 disabled:opacity-50 transition-colors"
            >
              {creatingApp && <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
              {at('api.apps.submit')}
            </button>
          </div>
        )}

        {apps.length === 0 ? (
          <EmptyState message={at('api.apps.empty')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-t border-gray-100">
              <thead>
                <tr className="bg-gray-50/80">
                  <th className={tableHead}>{at('api.apps.col_app')}</th>
                  <th className={tableHead}>{at('api.apps.col_env')}</th>
                  <th className={tableHead}>{at('api.apps.col_keys')}</th>
                  <th className={tableHead}>{at('api.apps.col_created')}</th>
                  {canManage && <th className={tableHead}></th>}
                </tr>
              </thead>
              <tbody>
                {apps.map((app) => (
                  <tr key={app.id} className={tableRow}>
                    <td className={tableCell}>
                      <span className="font-medium text-gray-900">{app.name}</span>
                      {app.description && <span className="block text-xs text-gray-500">{app.description}</span>}
                    </td>
                    <td className={tableCell}>
                      <span className={`inline-block text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded ${ENV_BADGE[app.environment]}`}>
                        {app.environment}
                      </span>
                    </td>
                    <td className={tableCell}>{app.key_count}</td>
                    <td className={`${tableCell} font-mono text-xs`}>{fmtDate(app.created_at)}</td>
                    {canManage && (
                      <td className={`${tableCell} text-right`}>
                        <button
                          type="button"
                          onClick={() => { setKeyModalApp(app); setKeyName(''); setKeyScopes(['jobs.read']); }}
                          className="text-sm font-semibold text-blue-700 hover:underline"
                        >
                          {at('api.apps.issue_key')}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Keys */}
      <Card className="overflow-hidden">
        <div className="px-5 pt-5 pb-3">
          <SectionHeading>{at('api.keys.title')}</SectionHeading>
          <p className="mt-1 text-xs text-gray-500">{at('api.keys.subtitle')}</p>
        </div>
        {keys.length === 0 ? (
          <EmptyState message={at('api.keys.empty')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-t border-gray-100">
              <thead>
                <tr className="bg-gray-50/80">
                  <th className={tableHead}>{at('api.keys.col_name')}</th>
                  <th className={tableHead}>{at('api.keys.col_key')}</th>
                  <th className={tableHead}>{at('api.keys.col_scopes')}</th>
                  <th className={tableHead}>{at('api.keys.col_status')}</th>
                  <th className={tableHead}>{at('api.keys.col_limits')}</th>
                  <th className={tableHead}>{at('api.keys.col_last_used')}</th>
                  {canManage && <th className={tableHead}></th>}
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.id} className={tableRow}>
                    <td className={tableCell}>
                      <span className="font-medium text-gray-900">{key.name}</span>
                      <span className="block text-[10px] text-gray-400">
                        {apps.find((a) => a.id === key.app_id)?.name ?? key.app_id}
                      </span>
                    </td>
                    <td className={`${tableCell} font-mono text-xs`}>{key.prefix}...</td>
                    <td className={tableCell}>
                      <span className="flex flex-wrap gap-1">
                        {key.scopes.map((s) => (
                          <span key={s} className="inline-block font-mono text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{s}</span>
                        ))}
                      </span>
                    </td>
                    <td className={tableCell}>
                      <span className={`inline-block text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded ${STATUS_BADGE[key.status]}`}>
                        {key.status}
                      </span>
                    </td>
                    <td className={`${tableCell} font-mono text-xs whitespace-nowrap`}>
                      {key.rate_limit_per_min}/min / {key.monthly_quota.toLocaleString()}/mo
                    </td>
                    <td className={`${tableCell} font-mono text-xs`}>{fmtDate(key.last_used_at)}</td>
                    {canManage && (
                      <td className={`${tableCell} text-right whitespace-nowrap`}>
                        {key.status !== 'revoked' && (
                          <>
                            <button
                              type="button"
                              onClick={() => toggleKeyStatus(key)}
                              disabled={busyKeyId === key.id}
                              className="text-sm font-semibold text-gray-600 hover:text-gray-900 hover:underline disabled:opacity-50 mr-3"
                            >
                              {key.status === 'active' ? at('api.keys.disable') : at('api.keys.enable')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setRevokeTarget(key)}
                              disabled={busyKeyId === key.id}
                              className="text-sm font-semibold text-red-600 hover:text-red-800 hover:underline disabled:opacity-50"
                            >
                              {at('api.keys.revoke')}
                            </button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Recent requests + docs */}
      <div className="grid lg:grid-cols-[1.4fr_0.6fr] gap-4 items-start">
        <Card className="overflow-hidden">
          <div className="px-5 pt-5 pb-3">
            <SectionHeading>{at('api.logs.title')}</SectionHeading>
            <p className="mt-1 text-xs text-gray-500">{at('api.logs.subtitle')}</p>
          </div>
          {requests.length === 0 ? (
            <EmptyState message={at('api.logs.empty')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-t border-gray-100">
                <thead>
                  <tr className="bg-gray-50/80">
                    <th className={tableHead}>{at('api.logs.col_time')}</th>
                    <th className={tableHead}>{at('api.logs.col_key')}</th>
                    <th className={tableHead}>{at('api.logs.col_endpoint')}</th>
                    <th className={tableHead}>{at('api.logs.col_status')}</th>
                    <th className={tableHead}>{at('api.logs.col_latency')}</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id} className={tableRow}>
                      <td className={`${tableCell} font-mono text-xs whitespace-nowrap`}>{r.timestamp.slice(11, 16)}</td>
                      <td className={`${tableCell} font-mono text-xs`}>{r.key_prefix}</td>
                      <td className={`${tableCell} font-mono text-xs`}>{r.endpoint}</td>
                      <td className={tableCell}>
                        <span className={`font-mono text-xs font-semibold ${r.status < 400 ? 'text-emerald-700' : 'text-red-600'}`}>{r.status}</span>
                      </td>
                      <td className={`${tableCell} font-mono text-xs`}>{r.latency_ms} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <SectionHeading>{at('api.docs.title')}</SectionHeading>
          <p className="mt-2 text-xs leading-relaxed text-gray-600">{at('api.docs.body')}</p>
          <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{at('api.docs.endpoints')}</p>
            <table className="mt-2 w-full text-xs">
              <tbody>
                {[
                  { route: 'GET /v1/jobs', scope: 'jobs.read' },
                  { route: 'POST /v1/resume/analyze', scope: 'resume.analyze' },
                  { route: 'POST /v1/cover-letter', scope: 'tools.generate' },
                  { route: 'GET /v1/usage', scope: 'usage.read' },
                ].map((e) => (
                  <tr key={e.route}>
                    <td className="py-1 pr-3 font-mono text-gray-800">{e.route}</td>
                    <td className="py-1 font-mono text-gray-500">{e.scope}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-gray-500">{at('api.docs.auth_hint')}</p>
            <code className="mt-1 block overflow-x-auto rounded bg-gray-900 px-2 py-1 font-mono text-[11px] text-gray-100">Authorization: Bearer cc_live_...</code>
          </div>
          <a
            href="/docs/api.md"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block text-sm font-semibold text-blue-700 hover:underline"
          >
            {at('api.docs.link')}
          </a>
        </Card>
      </div>

      {/* Issue-key modal */}
      {keyModalApp && !createdSecret && (
        <ViewportAwareDialog open onClose={() => setKeyModalApp(null)} closeOnBackdrop ariaLabel={`${at('api.modal.issue_title')} - ${keyModalApp.name}`} maxWidth={448} zIndex={80}>
          <div className="rounded-lg bg-white p-6 shadow-xl">
            <SubsectionHeading>{at('api.modal.issue_title')} - {keyModalApp.name}</SubsectionHeading>
            <div className="mt-4 space-y-4">
              <div>
                <FieldLabel htmlFor="new-key-name">{at('api.modal.key_name')}</FieldLabel>
                <input id="new-key-name" type="text" value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder={at('api.modal.key_name_ph')} className={textInput} />
              </div>
              <div>
                <FieldLabel>{at('api.modal.scopes')}</FieldLabel>
                <div className="space-y-2">
                  {API_KEY_SCOPES.map((scope) => (
                    <label key={scope.id} className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={keyScopes.includes(scope.id)}
                        onChange={() => toggleScope(scope.id)}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span>
                        <span className="block font-mono text-xs text-gray-800">{scope.id}</span>
                        <span className="block text-[11px] text-gray-500">{scope.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setKeyModalApp(null)} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                {at('api.modal.cancel')}
              </button>
              <button
                type="button"
                onClick={requestCreateKey}
                disabled={creatingKey || !keyName.trim() || keyScopes.length === 0}
                className="inline-flex items-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
              >
                {creatingKey && <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                {at('api.modal.generate')}
              </button>
            </div>
          </div>
        </ViewportAwareDialog>
      )}

      {/* Show-once secret modal: no backdrop/ESC close; storing the key must
          be acknowledged explicitly before the secret disappears for good. */}
      {createdSecret && (
        <ViewportAwareDialog open onClose={closeSecretModal} closeOnBackdrop={false} closeOnEscape={false} ariaLabel={at('api.secret.title')} maxWidth={448} zIndex={80}>
          <div className="rounded-lg bg-white p-6 shadow-xl">
            <SubsectionHeading>{at('api.secret.title')}</SubsectionHeading>
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {at('api.secret.warning')}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <input readOnly value={createdSecret} className="flex-1 rounded-md border border-gray-300 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-800" />
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard
                    .writeText(createdSecret)
                    .then(() => {
                      if (mountedRef.current) setSecretCopied(true);
                    })
                    .catch(() => {});
                }}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {secretCopied ? at('api.secret.copied') : at('api.secret.copy')}
              </button>
            </div>
            <button
              type="button"
              onClick={closeSecretModal}
              className="mt-4 w-full rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
            >
              {at('api.secret.confirm')}
            </button>
          </div>
        </ViewportAwareDialog>
      )}

      <ConfirmActionDialog
        open={productionKeyConfirmOpen}
        title={at('api.modal.generate')}
        description={at('api.modal.prod_confirm')}
        detail={keyModalApp?.name}
        cancelLabel={at('api.modal.cancel')}
        confirmLabel={at('api.modal.generate')}
        loadingLabel={at('api.modal.generate')}
        loading={creatingKey}
        tone="danger"
        onOpenChange={(open) => {
          if (!open && !creatingKey) setProductionKeyConfirmOpen(false);
        }}
        onCancel={() => {
          if (!creatingKey) setProductionKeyConfirmOpen(false);
        }}
        onConfirm={createKey}
      />

      <ConfirmActionDialog
        open={Boolean(revokeTarget)}
        title={at('api.keys.revoke')}
        description={revokeTarget
          ? `${at('api.revoke.confirm_prefix')} "${revokeTarget.name}" (${revokeTarget.prefix}...)? ${at('api.revoke.confirm_suffix')}`
          : ''}
        detail={revokeTarget?.name}
        cancelLabel={at('api.modal.cancel')}
        confirmLabel={at('api.keys.revoke')}
        loadingLabel={at('api.keys.revoke')}
        loading={Boolean(revokeTarget && busyKeyId === revokeTarget.id)}
        tone="danger"
        onOpenChange={(open) => {
          if (!open && !busyKeyId) setRevokeTarget(null);
        }}
        onCancel={() => {
          if (!busyKeyId) setRevokeTarget(null);
        }}
        onConfirm={() => {
          if (revokeTarget) void revokeKey(revokeTarget);
        }}
      />
    </div>
  );
};
