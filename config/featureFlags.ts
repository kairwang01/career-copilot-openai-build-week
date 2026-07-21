/**
 * Client feature flags.
 *
 * Web3 is an experimental, optional module (wallet identity + Proof-of-Talent
 * credential on Sepolia). The platform-level value lives in
 * platform_config/web3 and is read/written through Cloud Functions. A small
 * local cache keeps first paint stable while the callable refreshes.
 */

import { httpsCallable } from 'firebase/functions';
import { firebaseFunctions } from '../lib/firebaseClient';

const WEB3_FLAG_KEY = 'feature_web3_enabled';
const FLAG_EVENT = 'featureflag:web3';
const WEB3_DEFAULT = false;

export interface Web3Config {
  enabled: boolean;
  preview_mode: boolean;
  network: 'sepolia';
  chain_id: 11155111;
  contract_address: string;
  updated_at: string | null;
  updated_by: string | null;
}

export type Web3ConfigUpdate = {
  enabled: boolean;
  preview_mode?: boolean;
  contract_address?: string;
};

const call = <Req, Res>(name: string) =>
  httpsCallable<Req, Res>(firebaseFunctions, name);

const readCachedWeb3Enabled = (): boolean => {
  try {
    const raw = localStorage.getItem(WEB3_FLAG_KEY);
    if (raw === null) return WEB3_DEFAULT;
    return raw === 'true';
  } catch {
    return WEB3_DEFAULT;
  }
};

const writeCachedWeb3Enabled = (enabled: boolean): void => {
  try { localStorage.setItem(WEB3_FLAG_KEY, String(enabled)); } catch { /* unavailable */ }
};

const publishWeb3Flag = (enabled: boolean): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(FLAG_EVENT, { detail: enabled }));
};

export const isWeb3Enabled = (): boolean => readCachedWeb3Enabled();

export const refreshWeb3Config = async (): Promise<Web3Config> => {
  const result = await call<Record<string, never>, Web3Config>('getWeb3Config')({});
  const enabled = result.data.enabled === true;
  writeCachedWeb3Enabled(enabled);
  publishWeb3Flag(enabled);
  return result.data;
};

export const refreshWeb3Enabled = async (): Promise<boolean> => {
  const config = await refreshWeb3Config();
  return config.enabled;
};

export const getWeb3Config = async (): Promise<Web3Config> => {
  const result = await call<Record<string, never>, Web3Config>('adminGetWeb3Config')({});
  writeCachedWeb3Enabled(result.data.enabled);
  publishWeb3Flag(result.data.enabled);
  return result.data;
};

export const setWeb3Enabled = async (enabled: boolean): Promise<Web3Config> => {
  const result = await call<Web3ConfigUpdate, Web3Config>('adminUpdateWeb3Config')({ enabled });
  writeCachedWeb3Enabled(result.data.enabled);
  publishWeb3Flag(result.data.enabled);
  return result.data;
};

export const updateWeb3Config = async (update: Web3ConfigUpdate): Promise<Web3Config> => {
  const result = await call<Web3ConfigUpdate, Web3Config>('adminUpdateWeb3Config')(update);
  writeCachedWeb3Enabled(result.data.enabled);
  publishWeb3Flag(result.data.enabled);
  return result.data;
};

/** Subscribe to flag changes (same-tab toggles + cross-tab storage events). */
export const onWeb3FlagChange = (handler: (enabled: boolean) => void): (() => void) => {
  const onCustom = () => handler(readCachedWeb3Enabled());
  const onStorage = (e: StorageEvent) => {
    if (e.key === WEB3_FLAG_KEY) handler(readCachedWeb3Enabled());
  };
  window.addEventListener(FLAG_EVENT, onCustom);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(FLAG_EVENT, onCustom);
    window.removeEventListener('storage', onStorage);
  };
};
