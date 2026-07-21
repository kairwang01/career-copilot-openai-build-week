import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseDotEnvText,
  REQUIRED_PRICE_KEYS,
} from './lib/stripe-release-config.mjs';
import { SITE_ORIGIN } from '../config/site-origin.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const productionMode = process.argv.includes('--production');
// Avoid Node's own --env-file flag, which can consume the argument before this
// script on newer runtimes. This option is intentionally script-specific.
const configFileArg = process.argv.find((value) => value.startsWith('--config-file='));
const envFile = configFileArg?.slice('--config-file='.length) || 'functions/.env';
const ENV_PATH = resolve(ROOT, envFile);
const FUNCTIONS_ROOT = resolve(ROOT, 'functions');

if (ENV_PATH !== FUNCTIONS_ROOT && !ENV_PATH.startsWith(`${FUNCTIONS_ROOT}/`) && !ENV_PATH.startsWith(`${FUNCTIONS_ROOT}\\`)) {
  console.error('Stripe env check failed: --config-file must stay within functions/.');
  process.exit(1);
}

const PLACEHOLDER_VALUE =
  /(?:replace(?:[_-]?me)?|placeholder|your[_-]|change[_-]?me|example\.(?:com|net|org))/i;

function parseDotEnv(path) {
  return existsSync(path) ? parseDotEnvText(readFileSync(path, 'utf8')) : {};
}

const fileEnv = parseDotEnv(ENV_PATH);
const env = { ...fileEnv, ...process.env };
const issues = [];
const warnings = [];

function requireValue(key, label = key) {
  if (!env[key]) issues.push(`${label} is missing`);
  return env[key] || '';
}

function assertPattern(key, pattern, label) {
  const value = requireValue(key);
  if (value && !pattern.test(value)) {
    issues.push(`${key} must be a valid ${label}`);
  }
  if (value && PLACEHOLDER_VALUE.test(value)) {
    issues.push(`${key} still contains a placeholder value`);
  }
}

function assertOptionalPattern(key, pattern, label) {
  const value = env[key];
  if (value && !pattern.test(value)) {
    issues.push(`${key} must be a valid ${label}`);
  }
  if (value && PLACEHOLDER_VALUE.test(value)) {
    issues.push(`${key} still contains a placeholder value`);
  }
}

function assertUrl(key) {
  const value = requireValue(key);
  if (!value) return;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
      issues.push(`${key} must be an http(s) URL`);
    }
    if (
      url.protocol !== 'https:' &&
      !(
        env.BILLING_SIMULATION === 'true' &&
        ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
      )
    ) {
      issues.push(`${key} must use HTTPS outside local billing simulation`);
    }
    if (PLACEHOLDER_VALUE.test(value)) {
      issues.push(`${key} still contains a placeholder value`);
    }
    if (
      productionMode &&
      (url.origin !== SITE_ORIGIN ||
        url.pathname !== '/' ||
        url.search ||
        url.hash ||
        url.username ||
        url.password)
    ) {
      issues.push(`${key} must equal the canonical SITE_ORIGIN (${SITE_ORIGIN})`);
    }
  } catch {
    issues.push(`${key} must be a valid URL`);
  }
}

assertUrl('APP_BASE_URL');
assertOptionalPattern(
  'STRIPE_SECRET_KEY',
  /^sk_(?:test|live)_[A-Za-z0-9]{16,}$/,
  'Stripe secret key',
);
assertOptionalPattern(
  'STRIPE_WEBHOOK_SECRET',
  /^whsec_[A-Za-z0-9]{16,}$/,
  'Stripe webhook secret',
);
for (const key of REQUIRED_PRICE_KEYS) {
  assertPattern(key, /^price_[A-Za-z0-9]{8,}$/, 'Stripe Price ID');
}

for (const key of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']) {
  if (fileEnv[key]) {
    issues.push(`${key} must stay in Secret Manager, not the dotenv config file`);
  }
}

if (env.BILLING_SIMULATION === 'true') {
  const message = 'BILLING_SIMULATION=true means real Stripe Checkout is bypassed.';
  if (productionMode) issues.push(message);
  else warnings.push(message);
}

if (productionMode && env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
  issues.push('STRIPE_SECRET_KEY must be a live-mode key for a production release');
}

if (issues.length) {
  console.error('Stripe env check failed:');
  for (const issue of issues) console.error(` - ${issue}`);
  console.error(`\nNo secret values were printed. Set missing values in ${envFile} or Firebase Secret Manager for deploy.`);
  process.exit(1);
}

console.log('Stripe env check passed. No secret values printed.');
for (const warning of warnings) console.warn(`Warning: ${warning}`);
