import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Card, SectionHeading } from './adminUi';
import { at } from './adminText';
import {
  getWeb3Config,
  isWeb3Enabled,
  onWeb3FlagChange,
  setWeb3Enabled,
  updateWeb3Config,
  type Web3Config,
} from '../../config/featureFlags';

/**
 * Web3 settings tab: optional identity module control.
 *
 * Web3 in this product is strictly optional identity tooling: candidates may
 * connect a wallet and hold a Proof-of-Talent credential (Sepolia testnet).
 * Nothing in the core product - auth, payments, hiring portal, career tools -
 * depends on a wallet. This panel turns the whole surface on/off.
 */
export const Web3SettingsPanel: React.FC = () => {
  const [enabled, setEnabled] = useState(isWeb3Enabled());
  const [config, setConfig] = useState<Web3Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runtimeSaving, setRuntimeSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(true);
  const [contractAddress, setContractAddress] = useState('');

  useEffect(() => {
    let mounted = true;
    const unsubscribe = onWeb3FlagChange(setEnabled);
    getWeb3Config()
      .then((cfg) => {
        if (!mounted) return;
        setConfig(cfg);
        setEnabled(cfg.enabled);
        setPreviewMode(cfg.preview_mode !== false);
        setContractAddress(cfg.contract_address);
      })
      .catch((err) => {
        if (mounted) setError(err instanceof Error ? err.message : at('web3.error.load'));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const toggle = async () => {
    const next = !enabled;
    setSaving(true);
    setError(null);
    try {
      const updated = await setWeb3Enabled(next);
      setConfig(updated);
      setEnabled(updated.enabled);
      setPreviewMode(updated.preview_mode !== false);
      setContractAddress(updated.contract_address);
    } catch (err) {
      setError(err instanceof Error ? err.message : at('web3.error.save'));
    } finally {
      setSaving(false);
    }
  };

  const saveRuntime = async () => {
    const trimmedAddress = contractAddress.trim();
    setRuntimeSaving(true);
    setError(null);
    try {
      const updated = await updateWeb3Config({
        enabled,
        preview_mode: previewMode,
        contract_address: trimmedAddress,
      });
      setConfig(updated);
      setEnabled(updated.enabled);
      setPreviewMode(updated.preview_mode !== false);
      setContractAddress(updated.contract_address);
    } catch (err) {
      setError(err instanceof Error ? err.message : at('web3.error.save'));
    } finally {
      setRuntimeSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          <span className="font-semibold">{at('web3.banner.title')}</span>{' '}
          {at('web3.banner.body')}
        </p>
      </div>

      <Card className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <SectionHeading>{at('web3.toggle.title')}</SectionHeading>
            <p className="mt-1 text-xs leading-relaxed text-gray-500">{at('web3.toggle.desc')}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={at('web3.toggle.aria')}
            onClick={toggle}
            disabled={loading || saving}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${enabled ? 'bg-blue-600' : 'bg-gray-300'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
        <p className={`text-xs font-medium ${enabled ? 'text-emerald-700' : 'text-gray-500'}`}>
          {enabled ? at('web3.toggle.on') : at('web3.toggle.off')}
        </p>
        <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] leading-relaxed text-gray-500">
          {at('web3.toggle.scope_note')}
        </p>
        {error && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}
        {config?.updated_at && (
          <p className="text-[11px] text-gray-500">
            {at('web3.updated_prefix')} {config.updated_at.slice(0, 10)}
          </p>
        )}
      </Card>

      <Card className="p-5 space-y-4">
        <SectionHeading>{at('web3.usage.title')}</SectionHeading>
        <ul className="grid gap-2.5 md:grid-cols-2">
          {[
            ['Wallet connection (live)', 'Optional identity link on the candidate Account page. Connection failures fall back to the normal account flow; nothing is blocked.'],
            ['Proof-of-Talent credential (Sepolia preview)', 'Candidates scoring 85+ on resume analysis can issue a credential signal; employers see verified status in the talent pool.'],
            ['Credential verification (reserved)', 'Third-party verification will use the public contract path when the live contract is enabled.'],
            ['Partner settlement (not enabled)', 'Token-based settlement for API-platform partners is outside the current release scope.'],
          ].map(([title, desc]) => (
            <li key={title} className="rounded-md border border-gray-200 px-3 py-2.5">
              <p className="text-xs font-semibold text-gray-900">{title}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{desc}</p>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-5">
        <SectionHeading>{at('web3.contract.title')}</SectionHeading>
        <dl className="mt-3 space-y-2 text-xs">
          <div className="flex flex-wrap gap-x-3">
            <dt className="text-gray-500 shrink-0">{at('web3.contract.network')}</dt>
            <dd className="font-mono text-gray-800">Sepolia testnet (chain 11155111)</dd>
          </div>
          <div className="flex flex-wrap gap-x-3">
            <dt className="text-gray-500 shrink-0">{at('web3.contract.address')}</dt>
            <dd className="font-mono text-gray-800 break-all">{config?.contract_address ?? contractAddress}</dd>
          </div>
        </dl>
        <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold text-gray-900">{at('web3.runtime.title')}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{at('web3.runtime.desc')}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={previewMode}
              onClick={() => setPreviewMode((value) => !value)}
              disabled={loading || runtimeSaving}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${previewMode ? 'bg-amber-500' : 'bg-emerald-600'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${previewMode ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
          <p className={`mt-2 text-xs font-medium ${previewMode ? 'text-amber-700' : 'text-emerald-700'}`}>
            {previewMode ? at('web3.runtime.preview') : at('web3.runtime.live')}
          </p>
          <label className="mt-4 block text-xs font-semibold text-gray-700" htmlFor="web3-contract-address">
            {at('web3.contract.address')}
          </label>
          <input
            id="web3-contract-address"
            type="text"
            value={contractAddress}
            onChange={(event) => setContractAddress(event.target.value)}
            disabled={loading || runtimeSaving}
            placeholder="0x..."
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs text-gray-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-100"
          />
          <button
            type="button"
            onClick={saveRuntime}
            disabled={loading || runtimeSaving || !/^0x[a-fA-F0-9]{40}$/.test(contractAddress.trim())}
            className="mt-3 inline-flex min-h-9 items-center justify-center rounded-md bg-gray-900 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-black disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
          >
            {runtimeSaving ? at('web3.runtime.saving') : at('web3.runtime.save')}
          </button>
        </div>
      </Card>
    </div>
  );
};
