import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const firestoreIndexes = JSON.parse(
  readFileSync(new URL('firestore.indexes.json', root), 'utf8'),
) as {
  indexes: Array<{
    collectionGroup: string;
    queryScope: string;
    fields: Array<{ fieldPath: string; order: string }>;
  }>;
  fieldOverrides: Array<{
    collectionGroup: string;
    fieldPath: string;
    ttl: boolean;
    indexes: unknown[];
  }>;
};

describe('Firestore retention index contract', () => {
  it('keeps the ordered due-refund worker query deployable', () => {
    expect(firestoreIndexes.indexes).toContainEqual({
      collectionGroup: 'credit_refund_reviews',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'next_attempt_at', order: 'ASCENDING' },
      ],
    });
  });

  it('keeps automatic expiry enabled for frozen sourcing candidate packets', () => {
    expect(firestoreIndexes.fieldOverrides).toContainEqual({
      collectionGroup: 'sourcing_candidate_packets',
      fieldPath: 'expires_at',
      ttl: true,
      indexes: [],
    });
  });

  it('keeps candidate actionable sourcing queries and activity pulses deployable', () => {
    expect(firestoreIndexes.indexes).toContainEqual({
      collectionGroup: 'sourcing_outreach',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'candidate_id', order: 'ASCENDING' },
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'packet_expires_at_ms', order: 'DESCENDING' },
      ],
    });
    expect(firestoreIndexes.indexes).toContainEqual({
      collectionGroup: 'sourcing_outreach',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'candidate_id', order: 'ASCENDING' },
        { fieldPath: 'updated_at', order: 'DESCENDING' },
      ],
    });
  });

  it('expires pending sourcing requests and short-lived daily quota counters', () => {
    expect(firestoreIndexes.fieldOverrides).toContainEqual({
      collectionGroup: 'sourcing_outreach',
      fieldPath: 'expires_at',
      ttl: true,
      indexes: [],
    });
    expect(firestoreIndexes.fieldOverrides).toContainEqual({
      collectionGroup: 'sourcing_outreach_daily_quotas',
      fieldPath: 'expires_at',
      ttl: true,
      indexes: [],
    });
  });
});
