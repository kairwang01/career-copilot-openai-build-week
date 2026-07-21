import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CUSTOM_PROVIDER_CONFIG_COLLECTION,
  CustomProviderAccountDeletedError,
  CustomProviderApiKeyRequiredError,
  deleteCustomProviderConfig,
  getCustomProviderConfig,
  mergeCustomProviderConfig,
  migrateLegacyCustomProviderConfig,
  planCustomProviderMigration,
  setCustomProviderConfig,
} from '../functions/src/llm/customProviderStore';
import { businessLlmConfigResponse } from '../functions/src/handlers/businessLlm';

interface FakeRef {
  path: string;
}

interface FakeOperation {
  kind: 'set' | 'update' | 'delete';
  path: string;
  data: Record<string, unknown>;
}

function fakeDatabase(initial: Record<string, Record<string, unknown>>) {
  const docs = new Map(Object.entries(initial));
  const operations: FakeOperation[] = [];
  const transaction = {
    async getAll(...refs: FakeRef[]) {
      return refs.map((ref) => {
        const value = docs.get(ref.path);
        return {
          exists: value !== undefined,
          data: () => value,
          get: (field: string) => value?.[field],
        };
      });
    },
    set(ref: FakeRef, data: Record<string, unknown>) {
      operations.push({ kind: 'set', path: ref.path, data });
      return transaction;
    },
    update(ref: FakeRef, data: Record<string, unknown>) {
      operations.push({ kind: 'update', path: ref.path, data });
      return transaction;
    },
    delete(ref: FakeRef) {
      operations.push({ kind: 'delete', path: ref.path, data: {} });
      return transaction;
    },
  };
  const database = {
    collection(name: string) {
      return { doc: (uid: string): FakeRef => ({ path: `${name}/${uid}` }) };
    },
    async runTransaction<T>(callback: (tx: typeof transaction) => Promise<T>): Promise<T> {
      return callback(transaction);
    },
  };
  return { database, operations };
}

const privateConfig = {
  base_url: 'https://private.example/v1',
  api_key: 'sk-private-secret-1234',
  model: 'private-model',
};
const legacyConfig = {
  base_url: 'https://legacy.example/v1',
  api_key: 'sk-legacy-secret-5678',
  model: 'legacy-model',
};

describe('server-only custom provider storage', () => {
  it('preserves an existing key when PATCH input leaves api_key blank', () => {
    expect(mergeCustomProviderConfig(privateConfig, {
      base_url: 'https://next.example/v1',
      api_key: '   ',
      model: 'next-model',
    })).toEqual({
      base_url: 'https://next.example/v1',
      api_key: privateConfig.api_key,
      model: 'next-model',
    });
  });

  it('requires a key for the first configuration', () => {
    expect(() => mergeCustomProviderConfig(null, {
      base_url: 'https://next.example/v1',
      api_key: '',
      model: 'next-model',
    })).toThrow(CustomProviderApiKeyRequiredError);
  });

  it('migrates a legacy-only value and deletes the owner-readable field atomically', async () => {
    const { database, operations } = fakeDatabase({
      'users/emp1': { role: 'employer', custom_provider: legacyConfig },
    });

    await expect(getCustomProviderConfig('emp1', database as never)).resolves.toEqual(legacyConfig);
    expect(operations).toHaveLength(2);
    expect(operations[0]).toMatchObject({
      kind: 'set',
      path: `${CUSTOM_PROVIDER_CONFIG_COLLECTION}/emp1`,
      data: legacyConfig,
    });
    expect(operations[1].kind).toBe('update');
    expect(operations[1].path).toBe('users/emp1');
    expect(Object.keys(operations[1].data)).toEqual(['custom_provider']);
    expect(JSON.stringify(operations[1].data)).not.toContain(legacyConfig.api_key);
  });

  it('keeps the private value authoritative while deleting a stale legacy copy', async () => {
    const { database, operations } = fakeDatabase({
      [`${CUSTOM_PROVIDER_CONFIG_COLLECTION}/emp1`]: privateConfig,
      'users/emp1': { role: 'employer', custom_provider: legacyConfig },
    });

    await expect(getCustomProviderConfig('emp1', database as never)).resolves.toEqual(privateConfig);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ kind: 'update', path: 'users/emp1' });
  });

  it('returns secret-free migration statuses for batch reconciliation', async () => {
    const { database: migratedDatabase } = fakeDatabase({
      'users/emp1': { role: 'employer', custom_provider: legacyConfig },
    });
    await expect(migrateLegacyCustomProviderConfig('emp1', migratedDatabase as never))
      .resolves.toEqual({ config: legacyConfig, status: 'migrated' });

    const { database: preservedDatabase } = fakeDatabase({
      [`${CUSTOM_PROVIDER_CONFIG_COLLECTION}/emp2`]: privateConfig,
      'users/emp2': { role: 'employer', custom_provider: legacyConfig },
    });
    await expect(migrateLegacyCustomProviderConfig('emp2', preservedDatabase as never))
      .resolves.toEqual({ config: privateConfig, status: 'private_preserved' });

    const { database: invalidDatabase } = fakeDatabase({
      'users/emp3': { role: 'employer', custom_provider: { api_key: 'incomplete' } },
    });
    await expect(migrateLegacyCustomProviderConfig('emp3', invalidDatabase as never))
      .resolves.toEqual({ config: null, status: 'invalid_removed' });

    const { database: noLegacyDatabase } = fakeDatabase({
      [`${CUSTOM_PROVIDER_CONFIG_COLLECTION}/emp4`]: privateConfig,
      'users/emp4': { role: 'employer' },
    });
    await expect(migrateLegacyCustomProviderConfig('emp4', noLegacyDatabase as never))
      .resolves.toEqual({ config: privateConfig, status: 'none' });
  });

  it('uses the transactional private value for empty-key set requests', async () => {
    const { database, operations } = fakeDatabase({
      [`${CUSTOM_PROVIDER_CONFIG_COLLECTION}/emp1`]: privateConfig,
      'users/emp1': { role: 'employer' },
    });

    const result = await setCustomProviderConfig('emp1', {
      base_url: 'https://next.example/v1',
      api_key: '',
      model: 'next-model',
    }, database as never);

    expect(result.api_key).toBe(privateConfig.api_key);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      kind: 'set',
      path: `${CUSTOM_PROVIDER_CONFIG_COLLECTION}/emp1`,
      data: {
        base_url: 'https://next.example/v1',
        api_key: privateConfig.api_key,
        model: 'next-model',
      },
    });
  });

  it('blocks credential reads and writes once an account-deletion tombstone exists', async () => {
    const { database: readDatabase } = fakeDatabase({
      [`${CUSTOM_PROVIDER_CONFIG_COLLECTION}/emp1`]: privateConfig,
      'users/emp1': { role: 'employer' },
      'account_deletion_requests/emp1': { status: 'deleting' },
    });
    await expect(getCustomProviderConfig('emp1', readDatabase as never))
      .rejects.toBeInstanceOf(CustomProviderAccountDeletedError);

    const { database: writeDatabase, operations } = fakeDatabase({
      [`${CUSTOM_PROVIDER_CONFIG_COLLECTION}/emp1`]: privateConfig,
      'users/emp1': { role: 'employer' },
      'account_deletion_requests/emp1': { status: 'completed' },
    });
    await expect(setCustomProviderConfig('emp1', {
      base_url: 'https://next.example/v1',
      api_key: '',
      model: 'next-model',
    }, writeDatabase as never)).rejects.toBeInstanceOf(CustomProviderAccountDeletedError);
    expect(operations).toHaveLength(0);
  });

  it('plans invalid legacy cleanup without copying malformed data', () => {
    expect(planCustomProviderMigration(undefined, { api_key: 'raw-but-incomplete' })).toEqual({
      config: null,
      configToPersist: null,
      deleteLegacyField: true,
    });
  });

  it('provides an idempotent account-deletion hook for private and legacy copies', async () => {
    const { database, operations } = fakeDatabase({
      [`${CUSTOM_PROVIDER_CONFIG_COLLECTION}/emp1`]: privateConfig,
      'users/emp1': { role: 'employer', custom_provider: legacyConfig },
    });

    await deleteCustomProviderConfig('emp1', database as never);
    expect(operations.map(({ kind, path }) => ({ kind, path }))).toEqual([
      { kind: 'delete', path: `${CUSTOM_PROVIDER_CONFIG_COLLECTION}/emp1` },
      { kind: 'update', path: 'users/emp1' },
    ]);
  });

  it('returns only a masked public projection', () => {
    const response = businessLlmConfigResponse(privateConfig);
    expect(response).toMatchObject({
      configured: true,
      base_url: privateConfig.base_url,
      model: privateConfig.model,
    });
    expect(JSON.stringify(response)).not.toContain(privateConfig.api_key);
    expect(response).not.toHaveProperty('api_key');
    expect(response).toHaveProperty('api_key_masked');
  });
});

describe('custom provider Firestore boundary', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  const models = readFileSync(new URL('../functions/src/llm/models.ts', import.meta.url), 'utf8');
  const validUserBlock = rules.slice(
    rules.indexOf('function validUser(data)'),
    rules.indexOf('function validLegacyUserProfileUpdate(data)'),
  );

  it('explicitly denies all client access to private provider documents', () => {
    expect(rules).toMatch(
      /match \/private_custom_provider_configs\/\{uid\} \{\s*allow read, write: if false;\s*\}/,
    );
  });

  it('blocks legacy secret-bearing user reads and new client-created legacy fields', () => {
    expect(rules).toContain(
      '&& (resource == null || !hasField(resource.data, "custom_provider"));',
    );
    expect(validUserBlock).not.toContain('"custom_provider"');
  });

  it('resolves custom models through the private store, not the owner-readable snapshot', () => {
    expect(models).toContain('customProviderConfig = await getCustomProviderConfig(uid);');
    expect(models).not.toContain('snap.get("custom_provider")');
  });

  it('wires private credential deletion before the parent profile is removed', () => {
    const adminPortal = readFileSync(
      new URL('../functions/src/handlers/adminPortal.ts', import.meta.url),
      'utf8',
    );
    expect(adminPortal).toContain('await deleteCustomProviderConfig(targetUid);');
    expect(adminPortal.indexOf('await deleteCustomProviderConfig(targetUid);'))
      .toBeLessThan(adminPortal.indexOf('await userRef.delete();'));
  });
});
