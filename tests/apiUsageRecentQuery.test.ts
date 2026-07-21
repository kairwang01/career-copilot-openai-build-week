import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);

describe('public API recent-usage contract', () => {
  it('orders and bounds usage logs in Firestore before returning them', () => {
    const source = readFileSync(new URL('functions/src/handlers/apiGateway.ts', root), 'utf8');
    const usageBlock = source.match(/async function handleUsage[\s\S]*?function endpointLabel/)?.[0] ?? '';

    expect(usageBlock).toContain('.where("key_id", "==", key.id)');
    expect(usageBlock).toContain('.orderBy("timestamp", "desc")');
    expect(usageBlock).toContain('.limit(20)');
    expect(usageBlock).not.toContain('.limit(100)');
    expect(usageBlock).not.toContain('.sort(');
  });

  it('declares the composite index required by the recent-usage query', () => {
    const indexes = JSON.parse(readFileSync(new URL('firestore.indexes.json', root), 'utf8')) as {
      indexes: Array<{ collectionGroup: string; fields: Array<{ fieldPath: string; order: string }> }>;
      fieldOverrides: Array<{
        collectionGroup: string;
        fieldPath: string;
        ttl: boolean;
        indexes: unknown[];
      }>;
    };
    expect(indexes.indexes).toContainEqual({
      collectionGroup: 'api_usage_logs',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'key_id', order: 'ASCENDING' },
        { fieldPath: 'timestamp', order: 'DESCENDING' },
      ],
    });
    expect(indexes.fieldOverrides).toContainEqual({
      collectionGroup: 'api_usage_logs',
      fieldPath: 'expires_at',
      ttl: true,
      indexes: [],
    });
  });

  it('writes a bounded 90-day expiry without logging partner secrets', () => {
    const source = readFileSync(new URL('functions/src/handlers/apiGateway.ts', root), 'utf8');
    const recordBlock = source.match(/async function recordUsage[\s\S]*?await batch\.commit\(\);/)?.[0] ?? '';
    expect(source).toContain('API_USAGE_LOG_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000');
    expect(recordBlock).toContain(
      'expires_at: Timestamp.fromMillis(Date.now() + API_USAGE_LOG_RETENTION_MS)',
    );
    expect(recordBlock).toContain('key_prefix: key.prefix');
    expect(recordBlock).not.toMatch(/secret|authorization/i);
  });
});
