import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFirestoreIndexPlan } from '../scripts/print-firestore-index-plan.mjs';

const runbook = readFileSync(new URL('../docs/deployment/README.md', import.meta.url), 'utf8');
const checklist = readFileSync(new URL('../docs/deploy-checklist.md', import.meta.url), 'utf8');

describe('production deployment runbook', () => {
  it('orders private BYOA migration before strict Firestore rules', () => {
    const section = runbook.slice(
      runbook.indexOf('### Migrate legacy BYOA credentials'),
      runbook.indexOf('### Cloud Functions'),
    );
    expect(section).toContain('migrateCustomProviderConfigs.js');
    expect(section).toContain('restricted Firestore export location');
    expect(section).toContain('never download it to a workstation');
    expect(section).toContain('remaining_legacy_fields=0');
    expect(section).toContain('legacy_found=0');
    expect(section).toContain('migrated=0');
    expect(section).toContain('getBusinessLlmConfig');
    expect(section).toContain('setBusinessLlmConfig');
    expect(section.indexOf('remaining_legacy_fields=0'))
      .toBeLessThan(section.indexOf('deploy the current Firestore Rules'));
    expect(checklist).toContain('Do not deploy rules first');
  });

  it('stages query-only indexes before dependent Functions without enabling TTL early', () => {
    const queryIndexes = runbook.indexOf('### Stage query-only composite indexes');
    const byoa = runbook.indexOf('### Migrate legacy BYOA credentials');
    const expiry = runbook.indexOf('### Backfill API usage-log expiry');
    const summaries = runbook.indexOf('### Backfill exact API usage summaries');
    const strictRules = runbook.indexOf('### Deploy strict Rules and Storage');

    expect(queryIndexes).toBeGreaterThan(0);
    expect(queryIndexes).toBeLessThan(byoa);
    expect(byoa).toBeLessThan(expiry);
    expect(expiry).toBeLessThan(summaries);
    expect(summaries).toBeLessThan(strictRules);

    const earlyIndexSection = runbook.slice(queryIndexes, byoa);
    expect(earlyIndexSection).toContain('gcloud firestore indexes composite create');
    expect(earlyIndexSection).toContain('--collection-group=job_postings');
    expect(earlyIndexSection).toContain('print-firestore-index-plan.mjs');
    expect(earlyIndexSection).toMatch(/22\s+canonical composite signatures/);
    expect(earlyIndexSection).toMatch(/leave field overrides\s+untouched/);
    expect(earlyIndexSection).not.toContain('--only firestore:indexes');
  });

  it('derives the documented index and TTL inventory from the canonical config', () => {
    const config = JSON.parse(
      readFileSync(new URL('../firestore.indexes.json', import.meta.url), 'utf8'),
    );
    const plan = buildFirestoreIndexPlan(config);

    expect(plan.compositeCount).toBe(22);
    expect(plan.ttlPolicyCount).toBe(5);
    expect(runbook).toContain('all five TTL policies');
    for (const policy of plan.ttlPolicies) {
      expect(runbook).toContain(`${policy.collectionGroup}.${policy.fieldPath}`);
    }
  });

  it('requires safe usage-counter reconciliation before enabling daily credit caps', () => {
    const reconciliation = runbook.slice(
      runbook.indexOf('### Reconcile current-day usage counters'),
      runbook.indexOf('## 10. Prepare the VM'),
    );
    expect(reconciliation).toContain('absolute recomputation');
    expect(reconciliation).toContain('status in [deducted, free]');
    expect(reconciliation).toContain('refund_status != refunded');
    expect(reconciliation).toContain('second no-change verification');
    expect(reconciliation).toContain('next complete UTC day');
    expect(reconciliation).toContain('usage_counter_reconciliation_reviews/{usageEventId}');
    expect(reconciliation).toMatch(/nonzero\s+global/);
    expect(reconciliation).toMatch(/nonzero\s+per-plan/);
    expect(checklist).toMatch(/current\s+UTC-day usage counters/);
    expect(checklist).toContain('usage_counter_reconciliation_reviews.status=pending');
  });

  it('documents the guarded super bootstrap without an implicit identity', () => {
    const bootstrap = runbook.slice(
      runbook.indexOf('Bootstrap the first super administrator'),
      runbook.indexOf("The Admin Portal's sample-account reset"),
    );
    expect(bootstrap).toContain('node scripts/grantSuper.js');
    expect(bootstrap).toContain('--email administrator@example.com');
    expect(bootstrap.match(/--production/g)).toHaveLength(2);
    expect(bootstrap.match(/--project career-copilot-a3168/g)).toHaveLength(2);
    expect(runbook).toContain('ALLOW_PRODUCTION_WRITES=1');
    expect(runbook).toContain('ADMIN_CHANGE_REASON=SEC-1234-first-super-bootstrap');
    expect(runbook).toContain(
      'GRANT_SUPER:career-copilot-a3168:administrator@example.com',
    );
    expect(runbook).not.toContain('the script has a development-era default');
  });

  it('makes the Storage cross-service IAM and two-role smoke gate explicit', () => {
    expect(runbook).toContain('@gcp-sa-firebasestorage.iam.gserviceaccount.com');
    expect(runbook).toContain('Firebase Rules Firestore Service Agent');
    expect(runbook).toContain('Candidate profile: resume upload succeeds');
    expect(runbook).toContain('Employer profile: company-logo upload succeeds');
    expect(runbook).toContain('no `users/{uid}` profile is denied');
  });

  it('documents the durable private-credential deletion checkpoint', () => {
    expect(runbook).toContain('private_custom_provider_configs/{uid}');
    expect(runbook).toContain('private_credentials_delete_api_succeeded');
    expect(runbook).toContain('deleted_private_credentials: true');
    expect(runbook).toContain('before the parent');
  });

  it('backfills usage-log expiry before enabling the TTL policy', () => {
    const backfill = runbook.indexOf('### Backfill API usage-log expiry');
    const fullIndexDeploy = runbook.indexOf('--only firestore:indexes', backfill);
    const strictRules = runbook.indexOf('### Deploy strict Rules and Storage');
    expect(backfill).toBeGreaterThan(0);
    expect(fullIndexDeploy).toBeGreaterThan(backfill);
    expect(fullIndexDeploy).toBeLessThan(strictRules);
    expect(runbook).toContain('backfillApiUsageLogExpiry.js');
    expect(runbook).toContain('remaining_missing_expiry=0');
    expect(runbook).toContain('gcloud firestore fields ttls list');

    const strictSection = runbook.slice(strictRules, runbook.indexOf('### Cloud Functions'));
    expect(strictSection).toContain('--only firestore:rules,storage');
    expect(strictSection).not.toContain('firestore:rules,firestore:indexes,storage');
  });

  it('builds, exercises, hashes, and promotes the same frontend stage once', () => {
    const releaseGate = runbook.slice(
      runbook.indexOf('## 8. Run the release gate'),
      runbook.indexOf('## 9. Deploy Firebase resources'),
    );
    const publish = runbook.slice(
      runbook.indexOf('## 12. Build, test, and publish one frontend artifact'),
      runbook.indexOf('## 13. Verify production'),
    );

    expect(releaseGate).not.toContain('npm run build\n');
    expect(publish.match(/npm run build -- --outDir "\$STAGE"/g)).toHaveLength(1);
    expect(publish).toContain('E2E_STAGE_DIR="$STAGE"');
    expect(publish).toContain('npm run gate:release');
    expect(publish).toContain('release_gate_result_sha256');
    expect(publish).toContain('release_gate_log_sha256');
    expect(publish).toContain('stripe_live_evidence_sha256');
    expect(publish).toContain('stripe_webhook_evidence_sha256');
    expect(publish).toContain('STRIPE_LIVE_EVIDENCE=');
    expect(publish).toContain('STRIPE_WEBHOOK_EVIDENCE=');
    expect(publish).toContain('set -Eeuo pipefail');
    expect(publish).toContain('artifact_manifest_sha256');
    expect(publish).toContain('sha256sum -c "$2"');
    expect(publish).toContain('/var/lib/career-copilot-releases/$STAMP');
    expect(publish).toContain('/var/lib/career-copilot-artifacts');
    expect(publish).not.toContain('FILES="$ROOT/release-');
    expect(publish.indexOf('npm run build -- --outDir "$STAGE"'))
      .toBeLessThan(publish.indexOf('mv -Tf "$NEXT" "$ROOT/dist"'));
    expect(publish).toContain('test ! -e dist || test -L dist');
    expect(publish).toContain('sudo flock -n /run/lock/career-copilot-release.lock');
    expect(publish.indexOf('sha256sum -c "$FILES"'))
      .toBeLessThan(publish.indexOf('mv -Tf "$NEXT" "$ROOT/dist"'));
    expect(publish).toContain('sudo -u copilot find "$STAGE" -type f ! -readable');
    expect(publish).toContain('rollback_on_error');
    expect(publish).toContain('ln -s "$PREVIOUS" "$NEXT"');
    expect(publish).toContain('APPROVED_SHA=REPLACE_WITH_REVIEWED_MAIN_COMMIT');
    expect(publish).toContain('rev-parse origin/main)" = "$APPROVED_SHA"');
    expect(publish).toContain('env -i');
    expect(publish).toContain('test ! -e .env.production.local');
    expect(publish).toContain(
      'test -z "$(git status --porcelain --untracked-files=all)"',
    );
    expect(publish).toContain('sudo chown -R root:copilot "$STAGE"');
    expect(publish).toContain("'root:copilot'");
    expect(checklist).toContain('do not rebuild a different artifact during publish');
  });

  it('keeps the production artifact build unique to section 12', () => {
    const beforePublish = runbook.slice(
      0,
      runbook.indexOf('## 12. Build, test, and publish one frontend artifact'),
    );
    const afterPublish = runbook.slice(runbook.indexOf('## 13. Verify production'));
    expect(beforePublish).not.toMatch(/(?:^|\n)npm run build(?:\s|$)/);
    expect(afterPublish).not.toMatch(/(?:^|\n)npm run build(?:\s|$)/);
  });

  it('serializes and automatically restores manual frontend rollback', () => {
    const rollback = runbook.slice(
      runbook.indexOf('### Frontend rollback'),
      runbook.indexOf('### Functions rollback'),
    );
    expect(rollback).toContain('flock -n /run/lock/career-copilot-release.lock');
    expect(rollback).toContain('sha256sum -c "$2"');
    expect(rollback).toContain('sudo -u copilot find "$GOOD" -type f ! -readable');
    expect(rollback).toContain('restore_current');
    expect(rollback).toContain('ln -s "$BAD" "$NEXT"');
    expect(rollback).toContain('case "$GOOD" in "$ARTIFACT_ROOT"/*)');
  });

  it('requires an audited non-empty Function target list for rollback', () => {
    const rollback = runbook.slice(
      runbook.indexOf('### Functions rollback'),
      runbook.indexOf('### Secret rollback'),
    );
    expect(rollback).toContain('FUNCTION_TARGETS_FILE=');
    expect(rollback).toContain('validate-function-targets.mjs');
    expect(rollback).toContain('functions.targets.sha256');
    expect(rollback).toContain('firebase deploy --project career-copilot-a3168 --only "$FUNCTION_TARGETS"');
    expect(rollback).toContain('set -Eeuo pipefail');
    expect(rollback).toContain('git status --porcelain --untracked-files=all');
    expect(rollback).toContain('flock -n /run/lock/career-copilot-release.lock');
    expect(rollback).toContain('worktree add --detach');
    expect(rollback).toContain('worktree remove --force');
    expect(rollback).not.toContain('git checkout "$KNOWN_GOOD_SHA"');
    expect(rollback).not.toContain('functions:aiProxy,functions:generateCoverLetter');
  });

  it('derives normal Function deploy and rollback from the same sealed target file', () => {
    const deploy = runbook.slice(
      runbook.indexOf('### Cloud Functions'),
      runbook.indexOf('## 10. Prepare the VM'),
    );
    expect(deploy).toContain('REVIEWED_FUNCTION_TARGETS=');
    expect(deploy).toContain('FUNCTION_TARGETS_FILE=');
    expect(deploy).toContain('validate-function-targets.mjs');
    expect(deploy).toContain('functions.targets.sha256');
    expect(deploy).toContain('FUNCTION_ONLY=$(node scripts/validate-function-targets.mjs');
    expect(deploy).toContain('firebase deploy --project career-copilot-a3168 --only "$FUNCTION_ONLY"');
    expect(deploy).not.toContain('--only functions:aiProxy,functions:analyzeResume');
  });

  it('separates the non-login deploy and runtime identities', () => {
    const vm = runbook.slice(
      runbook.indexOf('## 10. Prepare the VM'),
      runbook.indexOf('## Customer-launch gates'),
    );
    expect(vm).toContain('copilot-deploy');
    expect(vm).toContain('sudo -u copilot-deploy -H');
    expect(vm).toContain('sudo -u copilot test -r');
    expect(vm).toContain("'copilot-deploy:copilot-deploy'");
    expect(vm).not.toContain('sudo -u copilot npm run build');
    expect(vm).toContain('disable --now uottawa-copilot-autodeploy.timer');
    expect(vm).not.toContain('enable --now uottawa-copilot-autodeploy.timer');
  });
});
