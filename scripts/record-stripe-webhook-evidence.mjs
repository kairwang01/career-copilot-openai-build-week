#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalizeStripeReleaseConfig,
  parseDotEnvText,
} from './lib/stripe-release-config.mjs';
import {
  STRIPE_WEBHOOK_RELEASE_EVENTS,
  validateStripeWebhookReleaseEvidence,
} from './lib/stripe-webhook-release-evidence.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = resolve(ROOT, 'functions/.env.career-copilot-a3168');
const ENDPOINT_URL =
  'https://us-central1-career-copilot-a3168.cloudfunctions.net/stripeWebhook';

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || '';
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function outsideRepository(path) {
  const relation = relative(ROOT, path);
  return relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation);
}

function externalInputPath(value, label) {
  if (!value || !isAbsolute(value) || !existsSync(value) || lstatSync(value).isSymbolicLink()) {
    throw new Error(`${label} must be an existing external regular file.`);
  }
  const path = realpathSync(value);
  if (!outsideRepository(path) || !statSync(path).isFile() || statSync(path).size === 0) {
    throw new Error(`${label} must be a non-empty file outside the repository.`);
  }
  return path;
}

async function readSecretFromStdin() {
  if (process.stdin.isTTY) {
    throw new Error('Pipe STRIPE_SECRET_KEY from Secret Manager through standard input.');
  }
  process.stdin.setEncoding('utf8');
  let value = '';
  for await (const chunk of process.stdin) {
    value += chunk;
    if (value.length > 512) throw new Error('Stripe secret input is unexpectedly large.');
  }
  value = value.trim();
  if (!/^sk_live_[A-Za-z0-9]{16,}$/.test(value)) {
    throw new Error('Secret Manager did not provide a live Stripe secret key.');
  }
  return value;
}

async function main() {
  const approvedSha = argument('approved-sha');
  const evidencePath = resolve(argument('evidence-file'));
  const liveEvidencePath = externalInputPath(
    argument('live-evidence'),
    '--live-evidence',
  );
  const workbenchArtifactPath = externalInputPath(
    argument('workbench-artifact'),
    '--workbench-artifact',
  );
  const firestoreArtifactPath = externalInputPath(
    argument('firestore-artifact'),
    '--firestore-artifact',
  );
  if (!/^[0-9a-f]{40}$/.test(approvedSha)) {
    throw new Error('--approved-sha must be the reviewed 40-character commit.');
  }
  if (
    !argument('evidence-file') ||
    !isAbsolute(argument('evidence-file')) ||
    !outsideRepository(evidencePath)
  ) {
    throw new Error('--evidence-file must be an absolute path outside the repository.');
  }
  if (existsSync(evidencePath)) {
    throw new Error('--evidence-file must not overwrite an existing release record.');
  }
  if (!process.argv.includes('--confirm-workbench-deliveries')) {
    throw new Error('Confirm both 2xx Stripe Workbench deliveries.');
  }
  if (!process.argv.includes('--confirm-firestore-ledger')) {
    throw new Error('Confirm the Firestore ledger before recording evidence.');
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
    throw new Error('Evidence recording requires the approved clean Git worktree.');
  }
  const liveEvidence = JSON.parse(readFileSync(liveEvidencePath, 'utf8'));
  if (liveEvidence.approvedSha !== approvedSha || liveEvidence.status !== 'passed') {
    throw new Error('Stripe live evidence does not match the approved release.');
  }
  const functionsLockPath = resolve(ROOT, 'functions/package-lock.json');
  const functionsLock = JSON.parse(readFileSync(functionsLockPath, 'utf8'));
  const lockedStripeVersion =
    functionsLock.packages?.['node_modules/stripe']?.version;
  const require = createRequire(resolve(ROOT, 'functions/package.json'));
  const Stripe = require('stripe');
  if (
    typeof lockedStripeVersion !== 'string' ||
    Stripe.PACKAGE_VERSION !== lockedStripeVersion ||
    liveEvidence.stripeSdkVersion !== lockedStripeVersion ||
    liveEvidence.stripeApiVersion !== Stripe.API_VERSION
  ) {
    throw new Error('Stripe SDK or live evidence does not match the Functions lockfile.');
  }
  const secret = await readSecretFromStdin();
  const stripe = new Stripe(secret, {
    maxNetworkRetries: 2,
    timeout: 20_000,
    telemetry: false,
  });
  const [event, endpoint] = await Promise.all([
    stripe.events.retrieve(argument('event-id')),
    stripe.webhookEndpoints.retrieve(argument('endpoint-id')),
  ]);
  if (
    event.livemode !== true ||
    !STRIPE_WEBHOOK_RELEASE_EVENTS.includes(event.type)
  ) {
    throw new Error('The selected Stripe event is not a supported live event.');
  }
  const enabledEvents = new Set(endpoint.enabled_events);
  if (
    endpoint.id !== liveEvidence.webhookEndpointId ||
    endpoint.url !== ENDPOINT_URL ||
    endpoint.status !== 'enabled' ||
    endpoint.livemode !== true ||
    endpoint.application !== null ||
    endpoint.api_version !== Stripe.API_VERSION ||
    (!enabledEvents.has('*') && !enabledEvents.has(event.type))
  ) {
    throw new Error('The selected endpoint does not match the live Stripe preflight.');
  }
  const config = parseDotEnvText(readFileSync(CONFIG_PATH, 'utf8'));
  const expectedHashes = {
    configSha256: sha256(canonicalizeStripeReleaseConfig(config)),
    contractSha256: sha256File(resolve(ROOT, 'scripts/lib/stripe-release-config.mjs')),
    recorderSha256: sha256File(fileURLToPath(import.meta.url)),
    validatorSha256: sha256File(
      resolve(ROOT, 'scripts/lib/stripe-webhook-release-evidence.mjs'),
    ),
    webhookSourceSha256: sha256File(
      resolve(ROOT, 'functions/src/handlers/stripeBilling.ts'),
    ),
    stripeLiveEvidenceSha256: sha256File(liveEvidencePath),
    workbenchArtifactSha256: sha256File(workbenchArtifactPath),
    firestoreArtifactSha256: sha256File(firestoreArtifactPath),
  };
  const evidence = {
    schemaVersion: 1,
    status: 'passed',
    approvedSha,
    checkedAt: new Date().toISOString(),
    project: 'career-copilot-a3168',
    region: 'us-central1',
    endpointId: endpoint.id,
    endpointUrl: ENDPOINT_URL,
    functionRevision: argument('function-revision'),
    operatorRef: argument('operator-ref'),
    changeRecord: argument('change-record'),
    eventId: event.id,
    eventType: event.type,
    stripeEventCreatedAt: new Date(event.created * 1000).toISOString(),
    livemode: event.livemode,
    firstResentAt: argument('first-resent-at'),
    replayResentAt: argument('replay-resent-at'),
    firstDeliveryHttpStatus: Number(argument('first-http-status')),
    replayDeliveryHttpStatus: Number(argument('replay-http-status')),
    workbenchDeliveryVerified: true,
    firestoreLedgerVerified: true,
    ledgerStatus: 'completed',
    ledgerStripeEventId: event.id,
    ledgerEventType: event.type,
    ledgerLivemode: true,
    ledgerAttemptsBefore: Number(argument('ledger-attempts-before')),
    ledgerAttemptsAfterFirst: Number(argument('ledger-attempts-after-first')),
    ledgerAttemptsAfterReplay: Number(argument('ledger-attempts-after-replay')),
    ledgerCompletedAtBefore: argument('ledger-completed-at-before'),
    ledgerCompletedAtAfterReplay: argument('ledger-completed-at-after-replay'),
    ...expectedHashes,
  };
  validateStripeWebhookReleaseEvidence(evidence, {
    approvedSha,
    endpointUrl: ENDPOINT_URL,
    endpointId: liveEvidence.webhookEndpointId,
    expectedHashes,
  });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  });
  console.log('Stripe signed-webhook replay evidence recorded. No secrets printed.');
}

if (resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'Webhook evidence recording failed.',
    );
    process.exitCode = 1;
  });
}
