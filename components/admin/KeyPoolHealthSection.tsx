import React from 'react';
import { Card, SectionHeading, tableCell, tableHead, tableRow } from './adminUi';
import { at } from './adminText';
import { LlmProviderIcon } from './LlmProviderIcon';
import type { ModelEntry } from '../../services/adminClient';

/** Human-readable hint for the availability-error codes the router records. */
const ERROR_HINTS: Record<string, string> = {
  '401': 'invalid key',
  '403': 'forbidden',
  '429': 'rate limited',
  '500': 'provider error',
  '502': 'provider error',
  '503': 'provider unavailable',
  timeout: 'timed out',
  quota: 'quota exhausted',
  empty: 'empty response',
};

const PREVIEW_TIERS = ['free', 'paid', 'business'] as const;

const describeError = (code: string): string => {
  const hint = ERROR_HINTS[code.toLowerCase()];
  return hint ? `${code} - ${hint}` : code;
};

/**
 * Key-pool health overview for the Models & Keys tab.
 *
 * Pure presentation over data the server already returns from adminListModels
 * (masked key pools + best-effort key_health aggregates). Raw keys never reach
 * this component - only masked previews and hashes-derived health counters.
 */
export const KeyPoolHealthSection: React.FC<{ models: ModelEntry[] }> = ({ models }) => {
  const enabled = models.filter((m) => m.enabled && m.id !== 'custom');
  if (enabled.length === 0) return null;

  const modelLabel = (id: string) => models.find((m) => m.id === id)?.label ?? id;

  const fmtTime = (iso: string | null | undefined) =>
    iso ? iso.slice(0, 16).replace('T', ' ') : '-';

  const renderFallback = (m: ModelEntry) => {
    if (m.fallbackChain?.length) {
      return (
        <div>
          <span className="font-sans text-[10px] font-semibold uppercase text-gray-500">{at('pool.route_explicit')}</span>
          <span className="block">{m.fallbackChain.map(modelLabel).join(' -> ')}</span>
        </div>
      );
    }
    const preview = m.implicitFallbackPreviewByTier;
    return (
      <div>
        <span className="font-sans text-[10px] font-semibold uppercase text-gray-500">{at('pool.route_implicit')}</span>
        {PREVIEW_TIERS.map((tier) => {
          const chain = preview?.[tier] ?? [];
          return (
            <span key={tier} className="block">
              {tier}: {chain.length ? chain.map(modelLabel).join(' -> ') : at('pool.route_none')}
            </span>
          );
        })}
      </div>
    );
  };

  const poolSize = (m: ModelEntry) => {
    const pooled = m.api_keys?.length ?? 0;
    if (pooled > 0) return pooled;
    if (m.api_key || m.builtin || m.provider === 'gemini') return 1;
    return 0;
  };

  return (
    <Card className="overflow-hidden">
      <div className="px-5 pt-5 pb-3">
        <SectionHeading>{at('pool.title')}</SectionHeading>
        <p className="mt-1 text-xs text-gray-500">{at('pool.subtitle')}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-t border-gray-100">
          <thead>
            <tr className="bg-gray-50/80">
              <th className={tableHead}>{at('pool.col_model')}</th>
              <th className={tableHead}>{at('pool.col_keys')}</th>
              <th className={tableHead}>{at('pool.col_status')}</th>
              <th className={tableHead}>{at('pool.col_failures')}</th>
              <th className={tableHead}>{at('pool.col_cooldown')}</th>
              <th className={tableHead}>{at('pool.col_last_error')}</th>
              <th className={tableHead}>{at('pool.col_route')}</th>
            </tr>
          </thead>
          <tbody>
            {enabled.map((m) => {
              const h = m.keyHealth;
              const cooled = Boolean(h?.anyCooled);
              const hasData = h !== undefined && h !== null;
              const iconText = [m.id, m.label, m.builtin, m.providerModel, m.base_url].filter(Boolean).join(' ');
              return (
                <tr key={m.id} className={tableRow}>
                  <td className={tableCell}>
                    <span className="flex items-start gap-2">
                      <LlmProviderIcon text={iconText} className="mt-0.5" />
                      <span className="min-w-0">
                        <span className="font-medium text-gray-900">{m.label}</span>
                        <span className="block font-mono text-[10px] text-gray-400">{m.id}</span>
                      </span>
                    </span>
                  </td>
                  <td className={tableCell}>{poolSize(m)}</td>
                  <td className={tableCell}>
                    {!hasData ? (
                      <span className="inline-block text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded bg-gray-100 text-gray-500">
                        {at('pool.status_no_data')}
                      </span>
                    ) : cooled ? (
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                        {at('pool.status_cooling')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                        {at('pool.status_healthy')}
                      </span>
                    )}
                  </td>
                  <td className={tableCell}>{h?.failureCount ?? '-'}</td>
                  <td className={`${tableCell} font-mono text-xs`}>{fmtTime(h?.cooldownUntil)}</td>
                  <td className={`${tableCell} font-mono text-xs`}>
                    {h?.lastErrorCode ? describeError(h.lastErrorCode) : '-'}
                    {h?.lastFailureAt && (
                      <span className="block text-[10px] text-gray-400">{fmtTime(h.lastFailureAt)}</span>
                    )}
                  </td>
                  <td className={`${tableCell} font-mono text-[11px]`}>
                    {renderFallback(m)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
};
