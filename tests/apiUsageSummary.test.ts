import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const handlerSource = readFileSync(new URL('functions/src/handlers/apiPlatform.ts', root), 'utf8');
const indexSource = readFileSync(new URL('functions/src/index.ts', root), 'utf8');
const panelSource = readFileSync(new URL('components/admin/ApiPlatformPanel.tsx', root), 'utf8');
const helpSource = readFileSync(new URL('components/admin/AdminPortal.tsx', root), 'utf8');
const contractSource = readFileSync(new URL('functions/src/handlers/apiPlatform.contract.md', root), 'utf8');
const deploymentSource = readFileSync(new URL('docs/deployment/README.md', root), 'utf8');
const firestoreIndexes = JSON.parse(
  readFileSync(new URL('firestore.indexes.json', root), 'utf8'),
) as { fieldOverrides: Array<{ collectionGroup: string; fieldPath: string; ttl: boolean; indexes: unknown[] }> };

describe('API usage summary scaling contract', () => {
  it('replaces the capped raw-log scan with bounded sharded summary reads', () => {
    const usageBlock = handlerSource.match(
      /export async function apiPlatformGetUsageImpl[\s\S]*?export async function apiPlatformListUsageLogsImpl/,
    )?.[0] ?? '';

    expect(usageBlock).not.toContain('.limit(5000)');
    expect(usageBlock).not.toContain('API_USAGE_LOGS).where("timestamp"');
    expect(handlerSource).toContain('const API_USAGE_SUMMARY_SHARD_COUNT = 32');
    expect(usageBlock).toContain('readUsageSummaryShards(periods)');
    expect(usageBlock).toContain('AggregateField.sum("monthly_quota")');
  });

  it('applies each log exactly once and fans writes across deterministic shards', () => {
    const applyBlock = handlerSource.match(
      /export async function applyApiUsageSummaryForLog[\s\S]*?export const onApiUsageLogCreatedFunction/,
    )?.[0] ?? '';

    expect(applyBlock).toContain('dbForOperation.runTransaction');
    expect(applyBlock).toContain('API_USAGE_SUMMARY_VERSION');
    expect(applyBlock).toContain('FieldValue.increment(1)');
    expect(applyBlock).toContain('FieldValue.increment(isError ? 1 : 0)');
    expect(applyBlock).toContain('summaryShardForLog(logId)');
    expect(applyBlock).toContain('data.summary_day === dateKey');
    expect(applyBlock).toContain('data.summary_month === monthKey');
    expect(applyBlock).toContain('data.summary_shard === shard');
    expect(applyBlock).toContain('data.summary_is_error === isError');
    expect(applyBlock.indexOf('usageTimestamp(data.timestamp)')).toBeLessThan(
      applyBlock.indexOf('data.summary_version === API_USAGE_SUMMARY_VERSION'),
    );
    expect(applyBlock).toContain('expires_at: summaryExpiry(period.type, period.key)');
    expect(applyBlock).toContain('tx.update(logRef');
    expect(applyBlock).not.toMatch(/console\.(?:log|error)[^\n]*(?:logId|key_id|request)/i);
  });

  it('mounts a retrying Firestore create trigger from the Functions entry point', () => {
    expect(handlerSource).toContain('{ document: "api_usage_logs/{logId}", retry: true }');
    expect(indexSource).toMatch(
      /onApiUsageLogCreatedFunction\s+as onApiUsageLogCreated/,
    );
  });

  it('bounds summary retention and documents eventual, fixed-read semantics', () => {
    expect(handlerSource).toContain('const API_USAGE_SUMMARY_RETENTION_DAYS = 120');
    expect(firestoreIndexes.fieldOverrides).toContainEqual({
      collectionGroup: 'api_usage_summary_shards',
      fieldPath: 'expires_at',
      ttl: true,
      indexes: [],
    });
    expect(contractSource).toContain('fixed batch read of at most 256 summary documents');
    expect(contractSource).toContain('eventually consistent telemetry');
    expect(contractSource).toContain('expires 120 days after the end of its UTC day/month');
    expect(deploymentSource).toContain('at most 256 summary documents');
    expect(deploymentSource).toContain('Platform Operations owns');
  });

  it('discloses asynchronous summary updates in the panel and tab help', () => {
    expect(panelSource).toContain("at('api.stats.eventual')");
    expect(helpSource).toContain('Summary counters update asynchronously');
  });

  it('keeps the API platform contract aligned with the trusted-server gateway', () => {
    expect(contractSource).toContain('{resume_text, market?, language?}');
    expect(contractSource).toContain('{resume_text, job_description, market?, language?}');
    expect(contractSource).toContain('configured with `cors:false`');
    expect(contractSource).toContain('`meterUsage` runs before route matching');
    expect(contractSource).toContain('currently sends no `Retry-After`');
  });
});
