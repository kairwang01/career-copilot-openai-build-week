import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'docs', 'api.md');
const publicPath = path.join(root, 'public', 'docs', 'api.md');
const checkOnly = process.argv.includes('--check');

const source = await readFile(sourcePath, 'utf8');
const current = await readFile(publicPath, 'utf8').catch(() => '');

if (current === source) {
  console.log('API documentation mirror is synchronized.');
  process.exit(0);
}

if (checkOnly) {
  console.error('public/docs/api.md is stale. Run `node scripts/sync-api-docs.mjs`.');
  process.exit(1);
}

await writeFile(publicPath, source, 'utf8');
console.log('Synchronized docs/api.md to public/docs/api.md.');
