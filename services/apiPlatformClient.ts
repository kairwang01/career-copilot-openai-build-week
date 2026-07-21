/**
 * API Platform service layer.
 *
 * The admin UI talks only to this adapter; every operation is backed by
 * Firebase callables that enforce admin RBAC, server-side key generation, and
 * audit logging. Full API secrets are returned once on key creation and are
 * never stored client-side.
 */

import { httpsCallable } from 'firebase/functions';
import { firebaseFunctions } from '../lib/firebaseClient';
import type { ApiKeyScope } from '../lib/access/permissions';

const call = <Req, Res>(name: string) =>
  httpsCallable<Req, Res>(firebaseFunctions, name);

export interface ApiApplication {
  id: string;
  name: string;
  description: string;
  environment: 'development' | 'production';
  /** Owning organization (users/{uid} of the org admin). null = platform-owned. */
  owner_org_id: string | null;
  created_by: string;
  created_at: string;
  /** Derived server-side: active+disabled (not revoked) key count. */
  key_count: number;
}

export interface PlatformApiKey {
  id: string;
  app_id: string;
  name: string;
  /** Display prefix, e.g. "cc_dev_a1b2". The secret itself is never stored here. */
  prefix: string;
  environment: 'development' | 'production';
  scopes: ApiKeyScope[];
  status: 'active' | 'disabled' | 'revoked';
  created_by: string;
  created_at: string;
  last_used_at: string | null;
  rate_limit_per_min: number;
  monthly_quota: number;
}

export interface ApiUsageSummary {
  month_requests: number;
  month_quota: number;
  month_errors: number;
  daily: { date: string; requests: number; errors: number }[];
}

export interface ApiRequestLogEntry {
  id: string;
  timestamp: string;
  key_prefix: string;
  endpoint: string;
  status: number;
  latency_ms: number;
}

export interface CreatedKeyResult {
  key: PlatformApiKey;
  /** Full secret — returned exactly once, never persisted client-side. */
  secret: string;
}

const unwrap = async <T>(p: Promise<{ data: T }>): Promise<T> => (await p).data;

export const apiPlatform = {
  listApplications(): Promise<ApiApplication[]> {
    return unwrap(call<Record<string, never>, ApiApplication[]>('apiPlatformListApplications')({}));
  },

  createApplication(input: {
    name: string;
    description: string;
    environment: 'development' | 'production';
  }): Promise<ApiApplication> {
    return unwrap(call<typeof input, ApiApplication>('apiPlatformCreateApplication')(input));
  },

  listApiKeys(): Promise<PlatformApiKey[]> {
    return unwrap(call<Record<string, never>, PlatformApiKey[]>('apiPlatformListKeys')({}));
  },

  createApiKey(input: {
    app_id: string;
    name: string;
    environment: 'development' | 'production';
    scopes: ApiKeyScope[];
  }): Promise<CreatedKeyResult> {
    return unwrap(call<typeof input, CreatedKeyResult>('apiPlatformCreateKey')(input));
  },

  revokeApiKey(keyId: string): Promise<void> {
    return unwrap(call<{ keyId: string }, { ok: true }>('apiPlatformRevokeKey')({ keyId })).then(() => undefined);
  },

  updateApiKeyStatus(keyId: string, status: 'active' | 'disabled'): Promise<void> {
    return unwrap(call<{ keyId: string; status: 'active' | 'disabled' }, { ok: true }>(
      'apiPlatformUpdateKeyStatus',
    )({ keyId, status })).then(() => undefined);
  },

  getUsageSummary(): Promise<ApiUsageSummary> {
    return unwrap(call<Record<string, never>, ApiUsageSummary>('apiPlatformGetUsage')({}));
  },

  listUsageLogs(): Promise<ApiRequestLogEntry[]> {
    return unwrap(call<Record<string, never>, ApiRequestLogEntry[]>('apiPlatformListUsageLogs')({}));
  },
};
