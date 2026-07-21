#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalizeStripeReleaseConfig,
  parseDotEnvText,
} from './lib/stripe-release-config.mjs';
import { validateStripeWebhookReleaseEvidence } from './lib/stripe-webhook-release-evidence.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STRIPE_CONFIG_PATH = resolve(
  ROOT,
  'functions/.env.career-copilot-a3168',
);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function externalRegularFile(path) {
  if (!path || !existsSync(path) || lstatSync(path).isSymbolicLink()) return false;
  const realPath = realpathSync(path);
  const relation = relative(ROOT, realPath);
  return (
    lstatSync(realPath).isFile() &&
    (relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation))
  );
}

const PHASES = {
  source: [
    'localization:check',
    'test:localization',
    'api-docs:check',
    'scan:functional-bugs',
    'check:stripe-env',
    'typecheck',
    'typecheck:functions',
    'test:unit',
    'audit:dependencies',
    'audit:functions',
  ],
  emulator: [
    'test:rules',
    'test:callables',
    'smoke:runtime-critical',
    'smoke:tool-execution',
    'smoke:account-profile',
  ],
  browser: ['test:e2e', 'test:e2e:artifact'],
  artifact: ['test:e2e:artifact'],
};

const requestedPhase = process.argv[2] || 'all';
if (!['source', 'emulator', 'browser', 'artifact', 'all'].includes(requestedPhase)) {
  console.error('Usage: node scripts/run-release-gate.mjs source|emulator|browser|artifact|all');
  process.exit(2);
}

const npmExecPath = process.env.npm_execpath;
if (!npmExecPath || !existsSync(npmExecPath)) {
  console.error('Run the release gate through an npm package script so npm_execpath is pinned.');
  process.exit(2);
}

const stageDir = process.env.E2E_STAGE_DIR
  ? resolve(process.env.E2E_STAGE_DIR)
  : undefined;
if (
  ['browser', 'artifact', 'all'].includes(requestedPhase) &&
  (!stageDir || !existsSync(resolve(stageDir, 'index.html')))
) {
  console.error('E2E_STAGE_DIR must point to a built release stage containing index.html.');
  process.exit(2);
}

const approvedSha =
  process.env.RELEASE_APPROVED_SHA || process.env.GITHUB_SHA || undefined;
let liveStripeEvidence;
let webhookStripeEvidence;
if (requestedPhase === 'all') {
  const liveEvidencePath = process.env.STRIPE_LIVE_EVIDENCE
    ? resolve(process.env.STRIPE_LIVE_EVIDENCE)
    : undefined;
  const webhookEvidencePath = process.env.STRIPE_WEBHOOK_EVIDENCE
    ? resolve(process.env.STRIPE_WEBHOOK_EVIDENCE)
    : undefined;
  if (!approvedSha || !/^[0-9a-f]{40}$/.test(approvedSha)) {
    console.error('RELEASE_APPROVED_SHA is required for the complete release gate.');
    process.exit(2);
  }
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
  const porcelain = execFileSync(
    'git',
    ['status', '--porcelain', '--untracked-files=all'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  if (head !== approvedSha || porcelain.trim()) {
    console.error(
      'The complete release gate requires the approved commit at HEAD and a clean worktree.',
    );
    process.exit(2);
  }
  if (!liveEvidencePath || !externalRegularFile(liveEvidencePath)) {
    console.error('STRIPE_LIVE_EVIDENCE is required for the complete release gate.');
    process.exit(2);
  }
  if (!webhookEvidencePath || !externalRegularFile(webhookEvidencePath)) {
    console.error('STRIPE_WEBHOOK_EVIDENCE is required for the complete release gate.');
    process.exit(2);
  }
  const webhookEvidenceDirectory = dirname(webhookEvidencePath);
  const workbenchArtifactPath = resolve(
    webhookEvidenceDirectory,
    'workbench-deliveries.artifact',
  );
  const firestoreArtifactPath = resolve(
    webhookEvidenceDirectory,
    'firestore-ledger.artifact',
  );
  if (
    !externalRegularFile(workbenchArtifactPath) ||
    !externalRegularFile(firestoreArtifactPath)
  ) {
    console.error(
      'STRIPE_WEBHOOK_EVIDENCE requires its two root-sealed reviewed artifacts.',
    );
    process.exit(2);
  }
  let evidence;
  try {
    evidence = JSON.parse(readFileSync(liveEvidencePath, 'utf8'));
  } catch {
    console.error('STRIPE_LIVE_EVIDENCE is not valid JSON.');
    process.exit(2);
  }
  const checkedAt = Date.parse(evidence.checkedAt || '');
  const ageMs = Date.now() - checkedAt;
  const config = parseDotEnvText(readFileSync(STRIPE_CONFIG_PATH, 'utf8'));
  const functionsLockPath = resolve(ROOT, 'functions/package-lock.json');
  const functionsLock = JSON.parse(readFileSync(functionsLockPath, 'utf8'));
  const lockedStripeVersion =
    functionsLock.packages?.['node_modules/stripe']?.version;
  const require = createRequire(resolve(ROOT, 'functions/package.json'));
  const Stripe = require('stripe');
  if (
    typeof lockedStripeVersion !== 'string' ||
    Stripe.PACKAGE_VERSION !== lockedStripeVersion
  ) {
    console.error(
      'Installed Stripe SDK does not match functions/package-lock.json.',
    );
    process.exit(2);
  }
  const expectedHashes = {
    configSha256: sha256(canonicalizeStripeReleaseConfig(config)),
    checkerSha256: sha256File(resolve(ROOT, 'scripts/check-stripe-live.mjs')),
    contractSha256: sha256File(
      resolve(ROOT, 'scripts/lib/stripe-release-config.mjs'),
    ),
    siteOriginSha256: sha256File(resolve(ROOT, 'config/site-origin.mjs')),
    functionsLockSha256: sha256File(functionsLockPath),
  };
  if (
    evidence.schemaVersion !== 1 ||
    evidence.status !== 'passed' ||
    evidence.approvedSha !== approvedSha ||
    evidence.project !== 'career-copilot-a3168' ||
    evidence.region !== 'us-central1' ||
    evidence.pricesChecked !== 9 ||
    evidence.webhookEventsChecked !== 6 ||
    !/^we_[A-Za-z0-9]+$/.test(evidence.webhookEndpointId || '') ||
    evidence.stripeSdkVersion !== lockedStripeVersion ||
    evidence.stripeApiVersion !== Stripe.API_VERSION ||
    Object.entries(expectedHashes).some(
      ([key, value]) => evidence[key] !== value,
    ) ||
    !Number.isFinite(checkedAt) ||
    ageMs < -5 * 60_000 ||
    ageMs > 6 * 60 * 60_000
  ) {
    console.error('STRIPE_LIVE_EVIDENCE is stale or does not match this release.');
    process.exit(2);
  }
  liveStripeEvidence = {
    checkedAt: evidence.checkedAt,
    sha256: sha256(readFileSync(liveEvidencePath)),
  };
  let webhookEvidence;
  try {
    webhookEvidence = JSON.parse(readFileSync(webhookEvidencePath, 'utf8'));
  } catch {
    console.error('STRIPE_WEBHOOK_EVIDENCE is not valid JSON.');
    process.exit(2);
  }
  const webhookExpectedHashes = {
    configSha256: expectedHashes.configSha256,
    contractSha256: expectedHashes.contractSha256,
    recorderSha256: sha256File(
      resolve(ROOT, 'scripts/record-stripe-webhook-evidence.mjs'),
    ),
    validatorSha256: sha256File(
      resolve(ROOT, 'scripts/lib/stripe-webhook-release-evidence.mjs'),
    ),
    webhookSourceSha256: sha256File(
      resolve(ROOT, 'functions/src/handlers/stripeBilling.ts'),
    ),
    stripeLiveEvidenceSha256: liveStripeEvidence.sha256,
    workbenchArtifactSha256: sha256File(workbenchArtifactPath),
    firestoreArtifactSha256: sha256File(firestoreArtifactPath),
  };
  try {
    const summary = validateStripeWebhookReleaseEvidence(webhookEvidence, {
      approvedSha,
      endpointUrl:
        'https://us-central1-career-copilot-a3168.cloudfunctions.net/stripeWebhook',
      endpointId: evidence.webhookEndpointId,
      expectedHashes: webhookExpectedHashes,
    });
    webhookStripeEvidence = {
      ...summary,
      eventIdSha256: sha256(webhookEvidence.eventId),
      sha256: sha256(readFileSync(webhookEvidencePath)),
    };
  } catch {
    console.error(
      'STRIPE_WEBHOOK_EVIDENCE is stale or does not match this release.',
    );
    process.exit(2);
  }
}
const evidenceDir = process.env.RELEASE_GATE_RESULTS
  ? resolve(process.env.RELEASE_GATE_RESULTS)
  : undefined;
const evidenceJson = evidenceDir
  ? resolve(evidenceDir, `release-gate-${requestedPhase}.json`)
  : undefined;
const evidenceLog = evidenceDir
  ? resolve(evidenceDir, `release-gate-${requestedPhase}.log`)
  : undefined;

if (evidenceDir) {
  mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
  writeFileSync(evidenceLog, '', { mode: 0o600 });
}

const result = {
  schemaVersion: 1,
  phase: requestedPhase,
  approvedSha,
  liveStripeEvidence,
  webhookStripeEvidence,
  stage: stageDir ? basename(stageDir) : undefined,
  startedAt: new Date().toISOString(),
  completedAt: undefined,
  status: 'running',
  toolchain: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    packageManager: process.env.npm_config_user_agent || 'unknown',
  },
  commands: [],
};

function redact(text) {
  return text
    .replace(/\b(?:sk_(?:live|test)|rk_(?:live|test)|whsec)_[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, '[REDACTED]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]');
}

function createLineRedactor() {
  let privateKeyBlock = false;
  return (line) => {
    if (/-----BEGIN [^-]*PRIVATE KEY-----/.test(line)) {
      privateKeyBlock = true;
      return '[REDACTED PRIVATE KEY]';
    }
    if (privateKeyBlock) {
      if (/-----END [^-]*PRIVATE KEY-----/.test(line)) {
        privateKeyBlock = false;
      }
      return undefined;
    }
    return redact(line);
  };
}

function appendEvidence(line) {
  if (evidenceLog) appendFileSync(evidenceLog, `${redact(line)}\n`, 'utf8');
}

function logEvent(message) {
  console.log(message);
  appendEvidence(message);
}

function persistResult() {
  if (!evidenceJson) return;
  const temporary = `${evidenceJson}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(result, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporary, evidenceJson);
}

function captureStream(stream, destination) {
  let pending = '';
  const redactLine = createLineRedactor();
  const writeLine = (line, trailingNewline) => {
    const safe = redactLine(line);
    if (safe === undefined) return;
    destination.write(trailingNewline ? `${safe}\n` : safe);
    if (evidenceLog) appendFileSync(evidenceLog, `${safe}\n`, 'utf8');
  };
  stream.on('data', (chunk) => {
    pending += chunk.toString('utf8');
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || '';
    for (const line of lines) writeLine(line, true);
  });
  return () => {
    if (pending) writeLine(pending, false);
  };
}

async function runPackageScript(script) {
  const commandResult = {
    script,
    startedAt: new Date().toISOString(),
    completedAt: undefined,
    durationMs: undefined,
    exitCode: undefined,
    status: 'running',
  };
  result.commands.push(commandResult);
  persistResult();
  logEvent(`[release-gate] START npm run ${script}`);
  const started = Date.now();

  const child = spawn(process.execPath, [npmExecPath, 'run', script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CI: process.env.CI || '1',
      ...(stageDir ? { E2E_STAGE_DIR: stageDir } : {}),
    },
    shell: false,
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  const flushStdout = captureStream(child.stdout, process.stdout);
  const flushStderr = captureStream(child.stderr, process.stderr);

  const outcome = await new Promise((resolveExit) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolveExit(value);
    };
    child.once('error', (error) =>
      settle({ exitCode: 1, error: `Unable to start npm run ${script}: ${error.message}` }),
    );
    child.once('close', (code, signal) => {
      if (signal) {
        settle({
          exitCode: 1,
          error: `npm run ${script} terminated with signal ${signal}`,
        });
        return;
      }
      settle({ exitCode: code ?? 1 });
    });
  });
  flushStdout();
  flushStderr();

  commandResult.completedAt = new Date().toISOString();
  commandResult.durationMs = Date.now() - started;
  commandResult.exitCode = outcome.exitCode;
  commandResult.status = outcome.exitCode === 0 ? 'passed' : 'failed';
  if (outcome.error) commandResult.error = outcome.error;
  persistResult();
  logEvent(
    `[release-gate] ${commandResult.status.toUpperCase()} npm run ${script} (${commandResult.durationMs} ms)`,
  );
  if (outcome.exitCode !== 0) {
    throw new Error(
      outcome.error || `Release gate stopped because npm run ${script} failed.`,
    );
  }
}

function selectedScripts() {
  if (requestedPhase === 'all') {
    return [...PHASES.source, ...PHASES.emulator, ...PHASES.browser];
  }
  return PHASES[requestedPhase];
}

try {
  if (stageDir && !statSync(stageDir).isDirectory()) {
    throw new Error('E2E_STAGE_DIR must be a directory.');
  }
  for (const script of selectedScripts()) {
    await runPackageScript(script);
  }
  result.status = 'passed';
} catch (error) {
  result.status = 'failed';
  result.error = error instanceof Error ? error.message : 'Unknown release gate failure.';
  console.error(result.error);
  process.exitCode = 1;
} finally {
  result.completedAt = new Date().toISOString();
  persistResult();
}
