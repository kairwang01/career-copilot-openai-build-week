#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGET_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

export function exportedFunctionNames(compiledIndex) {
  const names = new Set();
  for (const match of compiledIndex.matchAll(/Object\.defineProperty\(exports,\s*"([A-Za-z][A-Za-z0-9_]*)"/g)) {
    names.add(match[1]);
  }
  for (const match of compiledIndex.matchAll(/\bexports\.([A-Za-z][A-Za-z0-9_]*)\s*=/g)) {
    if (match[1] !== '__esModule') names.add(match[1]);
  }
  return names;
}

export function validateFunctionTargets(targetText, compiledIndex) {
  const lines = targetText.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  if (lines.length === 0 || lines.some((line) => !TARGET_NAME.test(line))) {
    throw new Error('Function targets must contain one non-empty ASCII export name per line.');
  }
  if (new Set(lines).size !== lines.length) {
    throw new Error('Function target list contains duplicates.');
  }
  const sorted = [...lines].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  if (lines.some((line, index) => line !== sorted[index])) {
    throw new Error('Function target list must be sorted for a stable evidence hash.');
  }
  const exported = exportedFunctionNames(compiledIndex);
  const missing = lines.filter((name) => !exported.has(name));
  if (missing.length > 0) {
    throw new Error(`Compiled Functions index does not export: ${missing.join(', ')}`);
  }
  return lines;
}

function argument(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function main() {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const targetsArg = argument('targets', '');
  if (!targetsArg) throw new Error('--targets file is missing.');
  const targetsPath = resolve(targetsArg);
  const compiledPath = resolve(
    root,
    argument('compiled-index', 'functions/lib/index.js'),
  );
  const format = argument('format', 'summary');
  if (!existsSync(targetsPath)) throw new Error('--targets file is missing.');
  if (!existsSync(compiledPath)) throw new Error('Compiled Functions index is missing.');
  const targets = validateFunctionTargets(
    readFileSync(targetsPath, 'utf8'),
    readFileSync(compiledPath, 'utf8'),
  );
  if (format === 'firebase') {
    process.stdout.write(`${targets.map((name) => `functions:${name}`).join(',')}\n`);
  } else if (format === 'json') {
    process.stdout.write(`${JSON.stringify(targets)}\n`);
  } else if (format === 'summary') {
    process.stdout.write(`Validated ${targets.length} explicit Function targets.\n`);
  } else {
    throw new Error('--format must be summary, firebase, or json.');
  }
}

if (resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Function target validation failed.');
    process.exitCode = 1;
  }
}
