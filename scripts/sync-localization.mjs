import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, '..');
const defaultSourceDir = join(repositoryRoot, 'localization');
const defaultTargetDir = join(repositoryRoot, 'public', 'localization');
const placeholderPattern = /\{[^{}]+\}/g;

export class LocalizationValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LocalizationValidationError';
  }
}

const pathExists = async (path) => {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const listJsonFiles = async (directory) => {
  if (!(await pathExists(directory))) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();
};

const readDictionary = async (path) => {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new LocalizationValidationError(`Invalid JSON in ${path}: ${error.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new LocalizationValidationError(`${path} must contain a JSON object.`);
  }

  const nonStringKeys = Object.entries(parsed)
    .filter(([, value]) => typeof value !== 'string')
    .map(([key]) => key);
  if (nonStringKeys.length > 0) {
    throw new LocalizationValidationError(
      `${path} has non-string values for: ${nonStringKeys.join(', ')}`,
    );
  }

  return parsed;
};

const sortedPlaceholders = (value) => (value.match(placeholderPattern) || []).sort();

const sameList = (left, right) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const describeKeyMismatch = (file, missing, extra) => {
  const details = [];
  if (missing.length > 0) details.push(`missing: ${missing.join(', ')}`);
  if (extra.length > 0) details.push(`extra: ${extra.join(', ')}`);
  return `${file} does not match the canonical English key set (${details.join('; ')}).`;
};

const atomicCopy = async (sourcePath, targetPath) => {
  const content = await readFile(sourcePath);
  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, content);
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
};

export const syncLocalization = async ({
  sourceDir = defaultSourceDir,
  targetDir = defaultTargetDir,
  check = false,
  logger = console,
} = {}) => {
  const sourceFiles = await listJsonFiles(sourceDir);
  const targetFiles = await listJsonFiles(targetDir);

  if (!sourceFiles.includes('en.json')) {
    throw new LocalizationValidationError(`${sourceDir} must contain en.json.`);
  }

  const targetOnlyFiles = targetFiles.filter((file) => !sourceFiles.includes(file));
  if (targetOnlyFiles.length > 0) {
    throw new LocalizationValidationError(
      `Published locale files have no canonical source: ${targetOnlyFiles.join(', ')}. ` +
        'Move them into localization/ before syncing; they will not be deleted automatically.',
    );
  }

  const dictionaries = new Map();
  for (const file of sourceFiles) {
    dictionaries.set(file, await readDictionary(join(sourceDir, file)));
  }

  const english = dictionaries.get('en.json');
  const englishKeys = Object.keys(english).sort();
  for (const [file, dictionary] of dictionaries) {
    const keys = Object.keys(dictionary).sort();
    const missing = englishKeys.filter((key) => !(key in dictionary));
    const extra = keys.filter((key) => !(key in english));
    if (missing.length > 0 || extra.length > 0) {
      throw new LocalizationValidationError(describeKeyMismatch(file, missing, extra));
    }

    const placeholderMismatches = englishKeys.filter(
      (key) => !sameList(sortedPlaceholders(english[key]), sortedPlaceholders(dictionary[key])),
    );
    if (placeholderMismatches.length > 0) {
      throw new LocalizationValidationError(
        `${file} has placeholder mismatches for: ${placeholderMismatches.join(', ')}`,
      );
    }
  }

  const changed = [];
  for (const file of sourceFiles) {
    const sourcePath = join(sourceDir, file);
    const targetPath = join(targetDir, file);
    if (await pathExists(targetPath)) {
      const published = await readDictionary(targetPath);
      const canonical = dictionaries.get(file);
      const publishedOnlyKeys = Object.keys(published).filter((key) => !(key in canonical));
      if (publishedOnlyKeys.length > 0) {
        throw new LocalizationValidationError(
          `${file} contains published-only keys: ${publishedOnlyKeys.join(', ')}. ` +
            'Promote them to localization/ before syncing; they will not be deleted automatically.',
        );
      }

      const [sourceBytes, targetBytes] = await Promise.all([
        readFile(sourcePath),
        readFile(targetPath),
      ]);
      if (!sourceBytes.equals(targetBytes)) changed.push(file);
    } else {
      changed.push(file);
    }
  }

  if (check && changed.length > 0) {
    throw new LocalizationValidationError(
      `Published localization is out of date: ${changed.join(', ')}. ` +
        'Run npm run localization:sync and commit both directories.',
    );
  }

  if (!check && changed.length > 0) {
    await mkdir(targetDir, { recursive: true });
    for (const file of changed) {
      await atomicCopy(join(sourceDir, file), join(targetDir, file));
    }
  }

  const action = check ? 'verified' : changed.length > 0 ? 'synced' : 'already synchronized';
  const changedSummary = changed.length > 0 ? ` (${changed.join(', ')})` : '';
  logger?.log?.(`Localization ${action}: ${sourceFiles.length} locales${changedSummary}.`);
  return { locales: sourceFiles, changed };
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const unknownArgs = args.filter((arg) => arg !== '--check');
  if (unknownArgs.length > 0) {
    console.error(`Unknown arguments: ${unknownArgs.join(', ')}`);
    process.exitCode = 1;
  } else {
    syncLocalization({ check: args.includes('--check') }).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
