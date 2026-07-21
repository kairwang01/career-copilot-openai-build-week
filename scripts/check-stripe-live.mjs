#!/usr/bin/env node

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalizeStripeReleaseConfig,
  parseDotEnvText,
  STRIPE_PRICE_EXPECTATIONS,
} from './lib/stripe-release-config.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FUNCTIONS_ROOT = resolve(ROOT, 'functions');
const CHECKER_PATH = fileURLToPath(import.meta.url);
const CONTRACT_PATH = resolve(ROOT, 'scripts/lib/stripe-release-config.mjs');
const SITE_ORIGIN_PATH = resolve(ROOT, 'config/site-origin.mjs');
const FUNCTIONS_LOCK_PATH = resolve(ROOT, 'functions/package-lock.json');
const REQUIRED_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'customer.subscription.deleted',
  'invoice.payment_failed',
  'invoice.payment_succeeded',
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

export function verifyGitReleaseState({ approvedSha, head, porcelain }) {
  if (head !== approvedSha) {
    throw new Error('The reviewed commit is not the current Git HEAD.');
  }
  if (porcelain.trim()) {
    throw new Error('The Stripe live preflight requires a clean Git worktree.');
  }
}

export async function verifyStripeLiveConfiguration({
  stripe,
  config,
  webhookUrl,
  stripeApiVersion,
}) {
  const issues = [];
  let verifiedWebhookEndpointId;
  const ids = Object.keys(STRIPE_PRICE_EXPECTATIONS)
    .map((key) => config[key])
    .filter(Boolean);
  if (new Set(ids).size !== ids.length) {
    issues.push('Each supported plan or credit pack must use a distinct Price ID.');
  }

  for (const [key, expectation] of Object.entries(STRIPE_PRICE_EXPECTATIONS)) {
    const id = config[key];
    if (!id) {
      issues.push(`${key} is missing.`);
      continue;
    }
    try {
      const price = await stripe.prices.retrieve(id, { expand: ['product'] });
      if (!price.livemode) issues.push(`${key} resolves to a sandbox Price.`);
      if (!price.active) issues.push(`${key} resolves to an inactive Price.`);
      if (price.currency !== 'cad') issues.push(`${key} must use CAD.`);
      if (price.type !== expectation.type) {
        issues.push(`${key} must be ${expectation.type}, not ${price.type}.`);
      }
      if (expectation.type === 'recurring' && price.recurring?.interval !== 'month') {
        issues.push(`${key} must renew monthly.`);
      }
      if (
        expectation.type === 'recurring' &&
        (price.recurring?.interval_count !== 1 ||
          price.recurring?.usage_type !== 'licensed')
      ) {
        issues.push(`${key} must be a one-month licensed recurring Price.`);
      }
      if (price.unit_amount !== expectation.unitAmount) {
        issues.push(`${key} amount does not match the published CAD price.`);
      }
      if (price.lookup_key !== expectation.lookupKey) {
        issues.push(`${key} has the wrong or missing stable lookup key.`);
      }
      if (
        typeof price.product === 'string' ||
        price.product?.deleted ||
        price.product?.active !== true
      ) {
        issues.push(`${key} must reference an active expanded Product.`);
      }
    } catch {
      issues.push(`${key} could not be retrieved with the live Stripe account.`);
    }
  }

  try {
    const endpoints = [];
    let startingAfter;
    for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
      const page = await stripe.webhookEndpoints.list({
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      endpoints.push(...page.data);
      if (page.has_more !== true) break;
      const lastId = page.data.at(-1)?.id;
      if (!lastId) throw new Error('Stripe returned an invalid webhook page.');
      startingAfter = lastId;
      if (pageNumber === 99) {
        throw new Error('Stripe webhook endpoint pagination exceeded the safety limit.');
      }
    }
    const candidates = endpoints.filter(
      (candidate) =>
        candidate.url === webhookUrl &&
        candidate.status === 'enabled' &&
        candidate.livemode === true,
    );
    if (candidates.length === 0) {
      issues.push('The enabled live Stripe webhook endpoint is missing.');
    } else {
      const platformCandidates = candidates.filter(
        (candidate) => candidate.application === null,
      );
      if (platformCandidates.length === 0) {
        issues.push('The Stripe webhook must be a platform-account endpoint.');
      }
      const versionCandidates = platformCandidates.filter(
        (candidate) => candidate.api_version === stripeApiVersion,
      );
      if (versionCandidates.length === 0) {
        issues.push(
          `The Stripe webhook API version must be pinned to ${stripeApiVersion}.`,
        );
      } else {
        const completeEndpoint = versionCandidates.find((candidate) => {
          const enabled = new Set(candidate.enabled_events);
          return (
            enabled.has('*') ||
            REQUIRED_WEBHOOK_EVENTS.every((event) => enabled.has(event))
          );
        });
        if (!completeEndpoint) {
          const enabled = new Set(versionCandidates[0].enabled_events);
          for (const event of REQUIRED_WEBHOOK_EVENTS) {
            if (!enabled.has(event)) {
              issues.push(`Stripe webhook is missing ${event}.`);
            }
          }
        } else {
          verifiedWebhookEndpointId = completeEndpoint.id;
        }
      }
    }
  } catch {
    issues.push('Live Stripe webhook endpoints could not be listed.');
  }

  if (issues.length > 0) {
    throw new Error(issues.join('\n'));
  }

  return {
    pricesChecked: Object.keys(STRIPE_PRICE_EXPECTATIONS).length,
    webhookEventsChecked: REQUIRED_WEBHOOK_EVENTS.length,
    webhookEndpointId: verifiedWebhookEndpointId,
    stripeApiVersion,
  };
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
  const configArg = process.argv.find((value) => value.startsWith('--config-file='));
  const projectArg = process.argv.find((value) => value.startsWith('--project='));
  const regionArg = process.argv.find((value) => value.startsWith('--region='));
  const evidenceArg = process.argv.find((value) => value.startsWith('--evidence-file='));
  const approvedShaArg = process.argv.find((value) => value.startsWith('--approved-sha='));
  const configPath = resolve(
    ROOT,
    configArg?.slice('--config-file='.length) ||
      'functions/.env.career-copilot-a3168',
  );
  const project = projectArg?.slice('--project='.length) || '';
  const region = regionArg?.slice('--region='.length) || '';
  const evidencePath = evidenceArg?.slice('--evidence-file='.length) || '';
  const approvedSha = approvedShaArg?.slice('--approved-sha='.length) || '';

  if (
    configPath !== FUNCTIONS_ROOT &&
    !configPath.startsWith(`${FUNCTIONS_ROOT}/`) &&
    !configPath.startsWith(`${FUNCTIONS_ROOT}\\`)
  ) {
    throw new Error('--config-file must stay within functions/.');
  }
  if (!existsSync(configPath)) throw new Error('Stripe production config file is missing.');
  if (!/^[a-z][a-z0-9-]{5,29}$/.test(project)) {
    throw new Error('--project must be an explicit Firebase project ID.');
  }
  if (!/^[a-z]+(?:-[a-z0-9]+)+$/.test(region)) {
    throw new Error('--region must be an explicit Functions region.');
  }
  if (!/^[0-9a-f]{40}$/.test(approvedSha)) {
    throw new Error('--approved-sha must be the reviewed 40-character commit.');
  }
  const evidenceRelation = relative(ROOT, evidencePath);
  if (
    !isAbsolute(evidencePath) ||
    !(
      evidenceRelation === '..' ||
      evidenceRelation.startsWith(`..${sep}`) ||
      isAbsolute(evidenceRelation)
    )
  ) {
    throw new Error('--evidence-file must be an absolute path outside the repository.');
  }
  if (existsSync(evidencePath)) {
    throw new Error('--evidence-file must not overwrite an existing release record.');
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
  verifyGitReleaseState({ approvedSha, head, porcelain });

  const config = parseDotEnvText(readFileSync(configPath, 'utf8'));
  const secret = await readSecretFromStdin();
  const require = createRequire(resolve(FUNCTIONS_ROOT, 'package.json'));
  const Stripe = require('stripe');
  const functionsLock = JSON.parse(readFileSync(FUNCTIONS_LOCK_PATH, 'utf8'));
  const lockedStripeVersion =
    functionsLock.packages?.['node_modules/stripe']?.version;
  if (
    typeof lockedStripeVersion !== 'string' ||
    Stripe.PACKAGE_VERSION !== lockedStripeVersion
  ) {
    throw new Error(
      'Installed Stripe SDK does not match functions/package-lock.json; run npm --prefix functions ci.',
    );
  }
  const stripe = new Stripe(secret, {
    maxNetworkRetries: 2,
    timeout: 20_000,
    telemetry: false,
  });
  const result = await verifyStripeLiveConfiguration({
    stripe,
    config,
    webhookUrl: `https://${region}-${project}.cloudfunctions.net/stripeWebhook`,
    stripeApiVersion: Stripe.API_VERSION,
  });
  writeFileSync(
    evidencePath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        status: 'passed',
        approvedSha,
        checkedAt: new Date().toISOString(),
        project,
        region,
        configSha256: sha256(canonicalizeStripeReleaseConfig(config)),
        checkerSha256: sha256File(CHECKER_PATH),
        contractSha256: sha256File(CONTRACT_PATH),
        siteOriginSha256: sha256File(SITE_ORIGIN_PATH),
        functionsLockSha256: sha256File(FUNCTIONS_LOCK_PATH),
        stripeSdkVersion: Stripe.PACKAGE_VERSION,
        ...result,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600, flag: 'wx' },
  );
  console.log(
    `Stripe live preflight passed: ${result.pricesChecked} Prices and ${result.webhookEventsChecked} webhook events checked. No secret values printed.`,
  );
}

if (resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error('Stripe live preflight failed:');
    for (const line of (error instanceof Error ? error.message : 'Unknown failure').split('\n')) {
      console.error(` - ${line}`);
    }
    process.exitCode = 1;
  });
}
