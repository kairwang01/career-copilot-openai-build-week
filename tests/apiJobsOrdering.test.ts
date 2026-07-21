import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const gateway = fs.readFileSync(path.join(root, 'functions/src/handlers/apiGateway.ts'), 'utf8');
const indexes = JSON.parse(fs.readFileSync(path.join(root, 'firestore.indexes.json'), 'utf8')) as {
  indexes: Array<{ collectionGroup: string; fields: Array<{ fieldPath: string; order?: string }> }>;
};

describe('public jobs API ordering', () => {
  it('keeps partner keys on server-to-server callers by disabling browser CORS', () => {
    expect(gateway).toMatch(/onRequest\(\{\s*invoker:\s*"public",\s*cors:\s*false\s*\}/);
  });

  it('orders in Firestore before applying the documented cap', () => {
    expect(gateway).toMatch(/collection\("job_postings"\)[\s\S]*?where\("is_active",\s*"==",\s*true\)[\s\S]*?orderBy\("created_at",\s*"desc"\)[\s\S]*?limit\(50\)/);
    expect(gateway).not.toMatch(/sort\(\(a, b\)[\s\S]*?created_at/);
  });

  it('ships the composite index required by the ordered active query', () => {
    expect(indexes.indexes).toContainEqual(expect.objectContaining({
      collectionGroup: 'job_postings',
      fields: [
        { fieldPath: 'is_active', order: 'ASCENDING' },
        { fieldPath: 'created_at', order: 'DESCENDING' },
      ],
    }));
  });
});
