/**
 * Functions emulator helper.
 *
 * Some deployed functions declare Secret Manager bindings. In local emulator
 * runs, Firebase tries to resolve those secrets before the callable body can
 * fall back to process.env. This writes harmless local-only placeholders so
 * runtime smokes can exercise simulation paths without real Stripe secrets.
 *
 * The target file is ignored by git (`*.local`). Existing non-placeholder
 * secret values are refused so a real credential cannot enter an emulator run.
 */
import { chmodSync, existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  assertSafeLocalFilePath,
  mergeEmulatorSecretPlaceholders,
} from './lib/firebase-script-safety.mjs';

const functionsDirectory = fileURLToPath(new URL('../functions/', import.meta.url));
const path = assertSafeLocalFilePath({
  filePath: fileURLToPath(new URL('../functions/.secret.local', import.meta.url)),
  allowedDirectory: functionsDirectory,
  expectedBasename: '.secret.local',
});

if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
  throw new Error('Refusing to write emulator secrets through a symbolic link.');
}

const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
const next = mergeEmulatorSecretPlaceholders(current, {
  STRIPE_SECRET_KEY: 'sk_test_emulator_placeholder',
  STRIPE_WEBHOOK_SECRET: 'whsec_emulator_placeholder',
});

writeFileSync(path, next, { mode: 0o600 });
chmodSync(path, 0o600);

console.log('Prepared functions/.secret.local for emulator secrets (values not printed).');
