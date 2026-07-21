import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const packageJson = JSON.parse(
  readFileSync(new URL('package.json', root), 'utf8'),
) as { scripts: Record<string, string> };
const runbook = readFileSync(
  new URL('docs/deployment/README.md', root),
  'utf8',
);
const runner = readFileSync(
  new URL('scripts/run-release-gate.mjs', root),
  'utf8',
);
const workflow = readFileSync(
  new URL('.github/workflows/ci.yml', root),
  'utf8',
);
const playwrightConfig = readFileSync(
  new URL('playwright.config.ts', root),
  'utf8',
);
const artifactConfig = readFileSync(
  new URL('playwright.release.config.ts', root),
  'utf8',
);
const callableSuites = readdirSync(new URL('tests/', root))
  .filter((name) => name.endsWith('.callable.test.ts'))
  .sort();

describe('release test-gate composition', () => {
  it('keeps every emulator-backed suite out of the pure unit gate', () => {
    const unit = packageJson.scripts['test:unit'];
    expect(unit).toContain('--exclude="tests/*.callable.test.ts"');
    expect(unit).toContain('--exclude="tests/firestore.rules.test.ts"');
    expect(unit).toContain('--exclude="tests/storage.rules.test.ts"');
    expect(unit).toContain('--exclude="tests/stripeRedirectUrl.test.ts"');
  });

  it('runs every callable plus the Firestore-backed redirect suite', () => {
    const callableGate = packageJson.scripts['test:callables'];
    for (const suite of callableSuites) {
      expect(callableGate, `missing ${suite}`).toContain(`tests/${suite}`);
    }
    expect(callableGate).toContain('tests/stripeRedirectUrl.test.ts');
    expect(callableGate.match(/\.callable\.test\.ts/g)).toHaveLength(callableSuites.length);
    expect(callableGate).toContain('--only firestore');
  });

  it('starts both rules emulators and runs both rules suites', () => {
    const rulesGate = packageJson.scripts['test:rules'];
    expect(rulesGate).toContain('--only firestore,storage');
    expect(rulesGate).toContain('tests/firestore.rules.test.ts');
    expect(rulesGate).toContain('tests/storage.rules.test.ts');
  });

  it('keeps one fail-fast release aggregator as the production entry point', () => {
    expect(packageJson.scripts['gate:release']).toBe(
      'node scripts/run-release-gate.mjs all',
    );
    expect(runner).toContain("'test:unit'");
    expect(runner).toContain("'test:rules'");
    expect(runner).toContain("'test:callables'");
    expect(runner).toContain("'smoke:runtime-critical'");
    expect(runner).toContain("'smoke:tool-execution'");
    expect(runner).toContain("'smoke:account-profile'");
    expect(runner).toContain("'test:e2e'");
    expect(runner).toContain("'test:e2e:artifact'");
    expect(runbook).toContain('npm run gate:release');
    expect(runbook).toContain('E2E_STAGE_DIR="$STAGE"');
    expect(packageJson.scripts['check:stripe-env']).toBe(
      'node scripts/check-stripe-env.mjs --production --config-file=functions/.env.career-copilot-a3168',
    );
    expect(packageJson.scripts['gate:release:live']).toContain(
      'scripts/check-stripe-live.mjs',
    );
    expect(packageJson.scripts['gate:release:webhook-record']).toContain(
      'scripts/record-stripe-webhook-evidence.mjs',
    );
    expect(runner).toContain('STRIPE_LIVE_EVIDENCE');
    expect(runner).toContain('STRIPE_WEBHOOK_EVIDENCE');
    expect(runner).toContain("evidence.schemaVersion !== 1");
    expect(runner).toContain('evidence.pricesChecked !== 9');
    expect(runner).toContain('evidence.webhookEventsChecked !== 6');
    expect(runner).toContain('evidence.stripeSdkVersion !== lockedStripeVersion');
    expect(runner).toContain('evidence.stripeApiVersion !== Stripe.API_VERSION');
    expect(runner).toContain('configSha256');
    expect(runner).toContain('checkerSha256');
    expect(runner).toContain('contractSha256');
    expect(runner).toContain('validateStripeWebhookReleaseEvidence');
    expect(runner).toContain('workbench-deliveries.artifact');
    expect(runner).toContain('firestore-ledger.artifact');
    expect(runner).toContain("['status', '--porcelain', '--untracked-files=all']");
    expect(runner).toContain("requestedPhase === 'all'");
    expect(runbook).toContain('npm run gate:release:live');
    expect(runbook).toContain('stripe_live_evidence_sha256');
    expect(runbook).toContain('stripe_webhook_evidence_sha256');
  });

  it('forbids focused browser tests and accepts the built stage at three widths', () => {
    expect(playwrightConfig).toContain('forbidOnly: true');
    expect(playwrightConfig).toContain('retries: 0');
    expect(playwrightConfig).toContain(
      "reuseExistingServer: process.env.PW_REUSE_EXISTING_SERVER === '1'",
    );
    expect(artifactConfig).toContain('forbidOnly: true');
    expect(artifactConfig).toContain('retries: 0');
    expect(artifactConfig).toContain("testDir: './e2e/release'");
    expect(artifactConfig).toContain('width: 1440');
    expect(artifactConfig).toContain('width: 768');
    expect(artifactConfig).toContain('width: 320');
  });

  it('requires every CI phase for the same commit and preserves evidence', () => {
    expect(workflow).toContain('static-and-unit:');
    expect(workflow).toContain('emulator-contracts:');
    expect(workflow).toContain('browser-e2e:');
    expect(workflow).toContain('release-gate:');
    expect(workflow).toContain(
      'needs: [static-and-unit, emulator-contracts, browser-e2e]',
    );
    expect(workflow).toContain('actions/upload-artifact@v7');
    expect(workflow).toContain('git status --porcelain --untracked-files=all');
    expect(workflow).toContain('firebase-tools@15.23.0');
    expect(workflow).toContain('npm run gate:release:source');
    expect(workflow).toContain('npm run gate:release:emulator');
    expect(workflow).toContain('npm run gate:release:browser');
  });
});
