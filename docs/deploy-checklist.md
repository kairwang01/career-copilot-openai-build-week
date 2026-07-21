# Production release checklist

This is the short operator checklist. The ordered commands, migration guards,
configuration reference, rollback procedure, and VM/Hosting instructions live in
the canonical runbook: [`docs/deployment/README.md`](deployment/README.md).
Historical commit ranges, test counts, and past deployment claims do not belong
in this checklist and are never current release evidence.

## 1. Identify the release

- [ ] Open a release/change record with owner, reviewers, target project, branch,
  commit SHA, maintenance window, rollback decision-maker, and evidence location.
- [ ] Confirm the team remote and synchronize without rewriting local work:

  ```bash
  git status --short
  git checkout dev
  git fetch upstream dev --prune
  git merge --ff-only upstream/dev
  test "$(git rev-parse HEAD)" = "$(git rev-parse upstream/dev)"
  git status --short
  ```

  Stop before checkout/fetch/merge if the first status is non-empty, and require the final
  status to be empty. Release testing and publishing must use the exact recorded
  `upstream/dev` tree, not a mixture of that commit and local uncommitted changes.

- [ ] Set the target explicitly and verify it before every Firebase command:

  ```bash
  PROJECT_ID=career-copilot-a3168
  firebase projects:list
  firebase functions:list --project "$PROJECT_ID"
  ```

- [ ] Confirm no production secret is in Git, build output, logs, tickets, or the
  frontend environment. Review every changed handler and importer of changed
  shared Functions modules to produce an explicit deployment target list.

## 2. Prove the candidate locally/CI

- [ ] Verify `node` and the package manager on the release workstation. Verify
  `java` and Firebase CLI in the CI job that owns emulator coverage; a developer
  workstation does not need a local Java emulator to commit or push. Do not use
  a hard-coded machine path.
- [ ] Install from lockfiles, build one named stage, then run the canonical
  `E2E_STAGE_DIR=/absolute/stage RELEASE_APPROVED_SHA=<reviewed-sha>
  STRIPE_LIVE_EVIDENCE=/root-sealed/live.json
  STRIPE_WEBHOOK_EVIDENCE=/root-sealed/webhook.json npm run gate:release`
  aggregator.
  Do not replace
  it with a hand-maintained subset. CI may parallelize its source, emulator, and
  browser phases only when the final `release-gate` job requires all three for
  the same commit.
- [ ] Confirm the aggregator ran localization/API-doc parity, type checks, pure
  tests, dependency audits, script scans, Firestore/Storage Rules, all callable
  suites, runtime smokes, emulator E2E, and built-artifact browser acceptance.
- [ ] Record exact commands, versions, pass/fail totals, build asset summary,
  commit SHA, gate-result/log hashes, and artifact-manifest hash. A historical
  green count or a result for a different artifact is not evidence for this tree.
- [ ] Run the read-only business-role provenance audit against the explicitly
  named production project. It prints only hashed references. Resolve every
  `role_provenance_unverified`, `organization_identity_unverified`, and
  `sample_account_present` finding before customer launch:

  ```bash
  cd functions
  npm run audit:business-roles -- --project=career-copilot-a3168
  ```
- [ ] Stop if the designated CI emulator suite or any required live-Firebase,
  Stripe, browser, or source check is skipped because its owning environment is
  unavailable. Local Java absence alone is not a failure when the exact SHA's CI
  emulator job ran; never relabel a partial CI or live-Firebase run as green.

## 3. Verify release configuration

- [ ] Production build variables pass the fail-fast checks in `vite.config.ts`;
  source maps are absent and Hosting/VM headers match `firebase.json`.
- [ ] `BILLING_SIMULATION` and demo/sample mutation flags are absent in customer
  production. Stripe Price IDs cover only supported subscriptions and credit
  packs; legacy `single_post` / `job_pack` products remain disabled.
- [ ] With a least-privilege Secret Manager identity, run
  `gate:release:live` for the exact approved SHA. Require the nine distinct live
  Prices to match the published CAD amounts, stable lookup keys, billing modes,
  active Products, and all six webhook events. Root-seal its JSON evidence;
  section 12 must consume it within six hours and hash it into release metadata.
- [ ] After deployment, complete a signed live webhook and replay smoke. Secret
  metadata and endpoint-list checks cannot prove the stored signing secret
  matches Stripe's current endpoint secret.
- [ ] Canonical app URL, Firebase regions, Storage bucket/region, AI routes,
  provider keys, quotas, Stripe webhook secret, Sentry consent behavior, and SMTP
  sender configuration have named owners and target-project evidence.
- [ ] Because password accounts are hard-gated on verification, real verification
  and password-reset messages complete successfully through representative
  consumer and customer corporate mailboxes; SPF/DKIM/DMARC and the support
  recovery path are recorded. A successful send API response alone is not enough.
- [ ] Budget alerts, delete protection/PITR decision, log/Sentry redaction and
  retention, incident routing, and rollback access are recorded.
- [ ] Alerting and an operator owner exist for
  `billing_fulfillment_reviews` (`status == pending`) and
  `credit_refund_reviews` (`status in [manual_review, failed_permanent]`, or
  `status == pending` for more than 20 minutes). Alert as well when the
  `processCreditRefundReviews` success heartbeat is absent for 20 minutes. A paid
  Checkout review is closed only after Stripe refund/cancellation and local
  entitlement reconciliation are both evidenced.
- [ ] Alert on every pending `usage_counter_reconciliation_reviews` record and
  assign a named owner; these records mean credit-limit counters are deliberately
  conservative until an absolute rebuild and second no-change check complete.

## 4. Deploy in compatibility order

Do not deploy rules first. Compatibility Functions, guarded migrations, and
their zero-residue checks must complete before strict rules.

- [ ] Create the restricted pre-change exports required by the canonical runbook
  and record operation status without exposing row identities or secrets.
- [ ] Following the canonical runbook, use `gcloud` to create only missing
  query-only composite indexes (exact fields and order) and wait until each is
  `READY`. Do not upload the complete index file or enable TTL yet.
- [ ] Build Functions and deploy the reviewed explicit function target list. Never
  use an unreviewed bare `--only functions` command. Store the exact one-name-per-
  line target file with the release evidence so rollback reuses and validates the
  same non-empty set against the known-good export manifest. For this launch,
  require `processCreditRefundReviews` as its own line in the reviewed target evidence.
- [ ] Before enabling any nonzero daily credit-spend cap, reconcile the current
  UTC-day usage counters by absolute recomputation from source `usage_events` and
  require a second no-change verification. If a reviewed rebuild operation is not
  available, keep global, per-user, and per-plan daily credit caps at `0` until the
  next complete UTC day after the new Functions revision is active; run caps stay
  enabled because refunded attempts intentionally still count.
- [ ] Set a nonzero global daily attempt cap and a nonzero `daily_run_limit` for
  every plan allowed to call a live AI provider. `0` falls back only to the hard
  server ceilings (10,000 platform / 500 per user per UTC day) and is not a normal
  production capacity setting once failed requests restore credits. Record the
  reviewed values and overload rationale in the change record.
- [ ] Require `usage_counter_reconciliation_reviews.status=pending` to be zero.
  Resolve each server-only item by absolute source-event recomputation and retain
  a second no-change check; never clear the alert by replaying a completed refund.
- [ ] Run the guarded private-BYOA migration. Require zero legacy fields and a
  second no-change/idempotence run before strict Firestore Rules.
- [ ] Run guarded API usage expiry/summary backfills as documented. Require zero
  malformed/residual records and a second no-change run before TTL/summary readers
  are treated as authoritative.
- [ ] Deploy the complete canonical Firestore index configuration, then verify
  every composite remains `READY` and all five TTL policies (usage logs, usage
  summary shards, expired sourcing packets, expired pending outreach, and
  sourcing daily-quota counters) are active. Only after that
  gate, deploy and smoke the summary reader.
- [ ] Deploy Firestore and Storage Rules only after compatibility Functions and
  migrations are complete.
- [ ] Verify the Firebase Storage service-agent cross-service Firestore role, then
  complete candidate, employer, and missing-profile upload/read/delete smokes.
- [ ] Publish the exact tested frontend artifact atomically using the canonical
  Hosting or VM procedure; do not rebuild a different artifact during publish.

## 5. Post-deploy acceptance

- [ ] Anonymous routes: home, pricing, employer, API docs, privacy, cookies,
  localization/RTL, small viewport, and security headers.
- [ ] Candidate: signup/verification, resume upload/paste, onboarding resume,
  successful and failed AI run accounting, job browse/reviews pagination,
  application confirmation, status/message flow, checkout/cancel/portal.
- [ ] Failed paid AI smoke: user balance returns exactly once, the metered-attempt
  count increases by one, net credits increase by zero, one refund ledger entry
  exists, and replay does not restore balance or counters again.
- [ ] Employer: signup, organization profile/logo, posting, applicant funnel,
  unverified-organization labels, consented sourcing, frozen 30-day packet,
  candidate revocation/expiry, inactive-job rejection, cross-job pending
  deduplication, seven-day cooldown, verified/unverified UTC-day quotas,
  scorecards/interviews/messages, BYOA masked update and one custom-model run.
- [ ] Admin roles: reviewer/admin/super access matrix, every tab help description,
  model probe/routing, credit adjustment, user report redaction, deletion retry,
  API key creation/revocation/usage, billing controls, and audit log.
- [ ] External systems: Stripe signed webhook and replay, AI fallback/failure,
  verification/reset/notification email delivery, Sentry consent/no-consent,
  indexes/TTL, Storage IAM, logs/alerts, and budget notification.
- [ ] Use `gcloud functions list --v2` for `us-central1` to record that
  `processCreditRefundReviews` is active, then leave one non-customer
  refund-recovery fixture pending for the scheduler. Confirm the worker resolves
  it exactly once within 20 minutes without direct batch invocation, its success
  heartbeat is visible, and no unexplained pending/manual compensation records
  remain before opening traffic.
- [ ] Real-device human walkthrough completes the primary journey with keyboard,
  screen-reader spot checks, and representative phone/tablet/desktop viewports.

## 6. Close or roll back

- [ ] Compare error, latency, billing, credit, email, and support signals to the
  pre-release baseline through the agreed observation window.
- [ ] If a gate fails, stop further rollout and execute the documented compatible
  rollback. Do not roll rules back across a data migration without the named data
  owner and rollback decision-maker.
- [ ] Close the release only when every required item has a linked evidence record.
  Any accepted deferral must name its owner, impact, expiry date, and customer
  communication; “not tested” is not a pass.
