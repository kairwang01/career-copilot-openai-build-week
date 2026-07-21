import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LocalizationValidationError, syncLocalization } from './sync-localization.mjs';

const silentLogger = { log() {} };

const createFixture = async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'localization-sync-'));
  const sourceDir = join(root, 'localization');
  const targetDir = join(root, 'public', 'localization');
  await mkdir(sourceDir, { recursive: true });
  await mkdir(targetDir, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return { sourceDir, targetDir };
};

const writeDictionary = (path, dictionary) =>
  writeFile(path, `${JSON.stringify(dictionary, null, 2)}\n`, 'utf8');

test('syncs changed files and is idempotent', async (t) => {
  const { sourceDir, targetDir } = await createFixture(t);
  const english = { greeting: 'Hello {name}', status: 'Ready' };
  const french = { greeting: 'Bonjour {name}', status: 'Pret' };
  await writeDictionary(join(sourceDir, 'en.json'), english);
  await writeDictionary(join(sourceDir, 'fr.json'), french);
  await writeDictionary(join(targetDir, 'en.json'), { ...english, status: 'Stale' });
  await writeDictionary(join(targetDir, 'fr.json'), french);

  const first = await syncLocalization({ sourceDir, targetDir, logger: silentLogger });
  assert.deepEqual(first.changed, ['en.json']);
  assert.equal(
    await readFile(join(targetDir, 'en.json'), 'utf8'),
    await readFile(join(sourceDir, 'en.json'), 'utf8'),
  );

  const second = await syncLocalization({ sourceDir, targetDir, logger: silentLogger });
  assert.deepEqual(second.changed, []);
  await syncLocalization({ sourceDir, targetDir, check: true, logger: silentLogger });
});

test('check mode reports publication drift without rewriting it', async (t) => {
  const { sourceDir, targetDir } = await createFixture(t);
  await writeDictionary(join(sourceDir, 'en.json'), { status: 'Ready' });
  await writeDictionary(join(targetDir, 'en.json'), { status: 'Stale' });

  await assert.rejects(
    syncLocalization({ sourceDir, targetDir, check: true, logger: silentLogger }),
    (error) => error instanceof LocalizationValidationError && /out of date/.test(error.message),
  );
  assert.equal(JSON.parse(await readFile(join(targetDir, 'en.json'), 'utf8')).status, 'Stale');
});

test('refuses to delete keys that exist only in the published copy', async (t) => {
  const { sourceDir, targetDir } = await createFixture(t);
  await writeDictionary(join(sourceDir, 'en.json'), { status: 'Ready' });
  await writeDictionary(join(targetDir, 'en.json'), { status: 'Ready', publishedOnly: 'Keep me' });

  await assert.rejects(
    syncLocalization({ sourceDir, targetDir, logger: silentLogger }),
    (error) => error instanceof LocalizationValidationError && /published-only keys/.test(error.message),
  );
  assert.equal(
    JSON.parse(await readFile(join(targetDir, 'en.json'), 'utf8')).publishedOnly,
    'Keep me',
  );
});

test('requires locale key and placeholder parity with English', async (t) => {
  const { sourceDir, targetDir } = await createFixture(t);
  await writeDictionary(join(sourceDir, 'en.json'), { greeting: 'Hello {name}', status: 'Ready' });
  await writeDictionary(join(sourceDir, 'fr.json'), { greeting: 'Bonjour {candidate}' });

  await assert.rejects(
    syncLocalization({ sourceDir, targetDir, logger: silentLogger }),
    (error) => error instanceof LocalizationValidationError && /missing: status/.test(error.message),
  );

  await writeDictionary(join(sourceDir, 'fr.json'), {
    greeting: 'Bonjour {candidate}',
    status: 'Pret',
  });
  await assert.rejects(
    syncLocalization({ sourceDir, targetDir, logger: silentLogger }),
    (error) =>
      error instanceof LocalizationValidationError &&
      /placeholder mismatches for: greeting/.test(error.message),
  );
});
