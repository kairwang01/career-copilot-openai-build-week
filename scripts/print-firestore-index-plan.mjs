import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function buildFirestoreIndexPlan(config) {
  if (!config || !Array.isArray(config.indexes) || !Array.isArray(config.fieldOverrides)) {
    throw new TypeError('Invalid firestore.indexes.json structure.');
  }

  const composites = config.indexes.map((index) => ({
    collectionGroup: index.collectionGroup,
    queryScope: index.queryScope,
    fields: (index.fields ?? []).map((field) => ({
      fieldPath: field.fieldPath,
      mode: field.order ?? field.arrayConfig,
    })),
  }));
  const ttlPolicies = config.fieldOverrides
    .filter((override) => override.ttl === true)
    .map((override) => ({
      collectionGroup: override.collectionGroup,
      fieldPath: override.fieldPath,
    }));

  return {
    compositeCount: composites.length,
    ttlPolicyCount: ttlPolicies.length,
    composites,
    ttlPolicies,
  };
}

async function main() {
  const configPath = resolve(process.cwd(), 'firestore.indexes.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const plan = buildFirestoreIndexPlan(config);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
