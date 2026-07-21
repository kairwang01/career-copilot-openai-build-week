/**
 * Runs every runtime-critical smoke sequentially against ONE already-running emulator
 * (started by the `smoke:runtime-critical` npm script's `firebase emulators:exec`).
 *
 * Each smoke connects to the running emulator and exits non-zero on failure; this
 * runner aggregates the results so CI / pre-deploy can gate on a single command.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureFirebaseScript } from './lib/firebase-script-safety.mjs';

configureFirebaseScript({ scriptName: 'run-all-smokes' });

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SMOKES = [
  ['auth-routing', 'scripts/auth-routing-smoke.mjs'],
  ['sourcing-outreach', 'scripts/sourcing-outreach-smoke.mjs'],
  ['hiring-loop', 'scripts/hiring-loop-smoke.mjs'],
  ['billing-credits', 'scripts/billing-credits-smoke.mjs'],
  ['aiproxy-guard', 'scripts/aiproxy-guard-smoke.mjs'],
  ['dialogs', 'scripts/dialog-positioning-smoke.mjs'],
  ['overlays', 'scripts/overlay-collision-smoke.mjs'],
  ['navigation-ui', 'scripts/navigation-ui-smoke.mjs'],
  ['resume-preview', 'scripts/resume-preview-smoke.mjs'],
  ['web3-preview', 'scripts/web3-preview-smoke.mjs'],
];

function runSmoke(script) {
  return new Promise((resolve) => {
    const child = spawn((process.env.NODE_BINARY || 'node'), [script], { cwd: REPO_ROOT, env: process.env, stdio: 'inherit' });
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function main() {
  const results = [];
  for (const [name, script] of SMOKES) {
    console.log(`\n========== runtime smoke: ${name} ==========`);
    const code = await runSmoke(script);
    results.push({ name, code });
    if (code !== 0) console.error(`✗ ${name} FAILED (exit ${code})`);
  }

  console.log('\n========== runtime-critical summary ==========');
  for (const { name, code } of results) console.log(`  ${code === 0 ? '✓' : '✗'} ${name}`);

  const failed = results.filter((r) => r.code !== 0);
  if (failed.length > 0) {
    console.error(`\n${failed.length}/${results.length} runtime smokes FAILED: ${failed.map((r) => r.name).join(', ')}`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} runtime-critical smokes passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
