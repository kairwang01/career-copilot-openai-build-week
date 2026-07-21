import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  getBusinessLlmConfig,
  listModels,
  setAiModel,
  setBusinessLlmConfig,
} from '../services/aiClient';

interface ConfigFormState {
  base_url: string;
  api_key: string;
  model: string;
}

const EMPTY_FORM: ConfigFormState = { base_url: '', api_key: '', model: '' };

const formatText = (template: string, values: Record<string, string>) =>
  Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, value), template);

export const BusinessCustomApi: React.FC<{ className?: string; t?: (key: string) => string }> = ({ className, t }) => {
  const [isBusiness, setIsBusiness] = useState(false);
  const [ready, setReady] = useState(false);
  const [form, setForm] = useState<ConfigFormState>(EMPTY_FORM);
  const [maskedKey, setMaskedKey] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [formMsg, setFormMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const formLoadedRef = useRef(false);
  // Ref (not the formLoading state) so a synchronous double-submit — e.g. a quick double
  // Enter before setFormLoading commits — is actually blocked.
  const savingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    listModels()
      .then(({ isBusiness: biz }) => {
        if (!active) return;
        setIsBusiness(!!biz);
        setReady(true);
      })
      .catch(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isBusiness || formLoadedRef.current) return;
    let active = true;
    formLoadedRef.current = true;
    setFormLoading(true);
    getBusinessLlmConfig()
      .then((cfg) => {
        if (!active) return;
        if (cfg.configured) {
          setForm({ base_url: cfg.base_url, api_key: '', model: cfg.model });
          setMaskedKey(cfg.api_key_masked);
          setAiModel('custom');
        }
      })
      .catch(() => {
        // Non-fatal; keep the form editable so the business user can reconnect.
      })
      .finally(() => {
        if (active) setFormLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isBusiness]);

  const handleFormSave = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    setFormMsg(null);
    if (savingRef.current) return; // already saving — ignore re-entry

    if (!form.base_url.startsWith('https://')) {
      setFormMsg({ type: 'error', text: t?.('account_custom_endpoint_base_url_error') ?? 'Base URL must start with https://' });
      return;
    }
    if (!form.api_key && !maskedKey) {
      setFormMsg({ type: 'error', text: t?.('account_custom_endpoint_key_required') ?? 'API key is required.' });
      return;
    }
    if (!form.model.trim()) {
      setFormMsg({ type: 'error', text: t?.('account_custom_endpoint_model_required') ?? 'Model name is required.' });
      return;
    }

    savingRef.current = true;
    setFormLoading(true);
    try {
      await setBusinessLlmConfig({
        base_url: form.base_url.trim(),
        api_key: form.api_key,
        model: form.model.trim(),
      });
      if (!mountedRef.current) return;
      setForm((prev) => ({ ...prev, api_key: '' }));
      setMaskedKey(null);
      formLoadedRef.current = false;
      setAiModel('custom');
      setFormMsg({ type: 'success', text: t?.('account_custom_endpoint_saved') ?? 'Custom endpoint saved.' });
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : t?.('account_custom_endpoint_save_error') ?? 'Save failed. Check your inputs and try again.';
      setFormMsg({ type: 'error', text: msg });
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setFormLoading(false);
    }
  }, [form, maskedKey, t]);

  if (!ready || !isBusiness) return null;

  return (
    <div className={className}>
      <h2 className="border-b pb-2 text-xl font-semibold text-gray-700 dark:border-slate-700 dark:text-gray-300">
        {t?.('account_custom_endpoint_title') ?? 'Custom Endpoint'}
      </h2>

      <form
        onSubmit={handleFormSave}
        className="mt-4 flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-800/60 dark:bg-blue-950/30"
      >
        <p className="text-[10px] font-bold uppercase tracking-wide text-blue-600 dark:text-blue-400">
          {t?.('account_custom_endpoint_badge') ?? 'Bring Your Own Endpoint'}
        </p>

        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600 dark:text-slate-400">
            {t?.('account_custom_endpoint_base_url') ?? 'API Base URL'}
          </label>
          <input
            type="url"
            required
            placeholder="https://api.example.com/v1"
            value={form.base_url}
            onChange={(event) => setForm((prev) => ({ ...prev, base_url: event.target.value }))}
            disabled={formLoading}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-200"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600 dark:text-slate-400">
            {t?.('account_custom_endpoint_api_key') ?? 'API Key'}{maskedKey && !form.api_key ? (
              <span className="ml-1.5 font-normal text-gray-400 dark:text-slate-500">
                {formatText(t?.('account_custom_endpoint_current_key') ?? '(current: {key})', { key: maskedKey })}
              </span>
            ) : null}
          </label>
          <input
            type="password"
            autoComplete="new-password"
            placeholder={maskedKey ? t?.('account_custom_endpoint_key_placeholder') ?? 'Enter new key to replace' : 'sk-...'}
            value={form.api_key}
            onChange={(event) => setForm((prev) => ({ ...prev, api_key: event.target.value }))}
            disabled={formLoading}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-200"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600 dark:text-slate-400">
            {t?.('account_custom_endpoint_model_name') ?? 'Model Name'}
          </label>
          <input
            type="text"
            required
            placeholder={t?.('account_custom_endpoint_model_placeholder') ?? 'e.g. model-name'}
            value={form.model}
            onChange={(event) => setForm((prev) => ({ ...prev, model: event.target.value }))}
            disabled={formLoading}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-200"
          />
        </div>

        {formMsg && (
          <p className={`text-xs font-medium leading-snug ${
            formMsg.type === 'success'
              ? 'text-green-600 dark:text-green-400'
              : 'text-red-600 dark:text-red-400'
          }`}>
            {formMsg.text}
          </p>
        )}

        <button
          type="submit"
          disabled={formLoading}
          className="self-end rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-700 dark:hover:bg-blue-600"
        >
          {formLoading ? t?.('account_custom_endpoint_saving') ?? 'Saving...' : t?.('account_custom_endpoint_save') ?? 'Save configuration'}
        </button>
      </form>
    </div>
  );
};
