# Security review — Career CoPilot

Last reviewed: 2026-07-13
Scope: client trust boundaries, Firestore/Storage rules, Cloud Functions,
authentication, AI providers, billing, uploads, and operational controls.

This is a source review and local automated assessment, not a penetration test,
privacy certification, or proof that production IAM and provider settings are
correct. The release remains **no-go** until the external gates at the end are
completed in the target project.

## Trust boundary

The browser is untrusted. Roles, entitlements, credits, API quotas, job and
application transitions, interview/scorecard changes, billing state, sourcing
consent, and admin mutations are validated by server functions. Current
Firestore rules deny direct client writes to server-owned collections and fail
closed for admin access; UI visibility is not treated as authorization.

## OWASP-oriented findings

### A01 — Broken access control

- Admin roles are resolved server-side. The client uses an authoritative access
  check rather than a cached profile role to admit the admin portal.
- Hiring mutations use callables and re-read authoritative job/application data.
  Candidate/employer ownership and duplicate-application checks are enforced on
  the server.
- Talent discovery is opt-in and uses only a de-identified structured profile.
  Contact/resume access requires per-employer consent, creates a frozen 30-day
  packet, supports immediate revocation, and is also protected by Firestore TTL.
- Employer BYOA credentials are stored in
  `private_custom_provider_configs/{uid}` and are masked by the public callables;
  direct client access is denied.
- Storage paths are owner- and product-role-gated. Company-logo and resume rules
  depend on a cross-service Firestore lookup, so production service-agent IAM is
  an explicit launch gate rather than assumed from emulator tests.

Residual risk: the machine used for this review has no working Java/Firebase
emulator toolchain, so the final rules/callable integration suites still require
a release-workstation or CI run.

### A02 — Cryptographic and secret handling

- Stripe, platform AI, partner API, and employer BYOA secrets are server-side.
  UIs receive masked identifiers and do not re-display stored raw keys.
- The BYOA migration is transactional, guarded, idempotent, and reports aggregate
  counts only. Strict rules must not be deployed until production reports zero
  legacy `users.custom_provider` fields.
- HTTPS is required for configured external model endpoints; the server validates
  and pins resolved public addresses before transport.

Residual risk: production secret versions, key rotation, provider-side revocation,
and restricted migration-export deletion cannot be proven from this repository.

### A03 — Injection and untrusted input

- Callable payloads use type/enum checks, length and output caps, bounded paging,
  and server-owned identifiers for privileged writes.
- URL inputs pass shared safe-URL validation. Server-side fetches reject local,
  private, link-local, metadata, and non-HTTPS destinations; DNS resolution is
  validated and pinned for the outbound request, including redirects.
- AI output is treated as advisory content. Draft-quality checks reject common
  placeholders and fabricated resume fields, but model output is not a trusted
  authorization or data source.

Residual risk: prompt injection and generated-content quality cannot be fully
eliminated. High-stakes drafts require user review, and production model probes
must use non-sensitive test data.

### A04 — Insecure design

- Credit deduction/refund, API metering, monthly grants, admin credit changes,
  Stripe webhook processing, and high-risk mutations use transactions,
  idempotency keys, ledgers, or durable checkpoints as appropriate.
- Failed AI-credit refunds enter a deterministic server-only recovery queue with
  a bounded scheduled worker. Completed Stripe Checkout sessions that cannot be
  fulfilled enter a durable operator queue; webhook replay cannot reopen an
  operator-resolved review.
- Billing entitlement is derived from exact active provider state; unavailable
  legacy employer add-ons are blocked from public selection, checkout, and admin
  assignment.
- Account access removal has durable retry checkpoints and deletes private BYOA
  credentials, but it is intentionally not represented as complete data erasure.

Residual risk: there is no approved full retention/anonymization/export workflow,
no self-service erasure, and no complete malware/content scanning pipeline for
uploads. These require product, legal, security, and operations owners.

### A05 — Security misconfiguration

- Production builds fail on missing, malformed, or placeholder Firebase values;
  optional Stripe/Sentry configuration is also validated when enabled.
- Hosting emits CSP and standard security headers. Source maps are disabled for
  production. Browser Sentry loads only after optional-monitoring consent;
  server-side Sentry is separately DSN-gated and sets `sendDefaultPii: false`.
- Billing simulation and sample-account mutation are explicit environment- and
  project-gated non-production paths.

Residual risk: repository configuration does not prove deployed headers, Firebase
indexes/TTL readiness, Storage service-agent IAM, App Check enforcement, budget
alerts, deletion protection, PITR, SMTP/DNS, or provider credentials. Follow the
production runbook and capture target-project evidence.

### A06 — Vulnerable and outdated components

The 2026-07-13 local dependency audit reported zero advisories in the root tree.
The Functions tree reported 11 moderate findings (8 in the production tree) and
zero high or critical findings; the available automated remediation requires major or
otherwise unsafe version changes (notably `firebase-admin`), so it was not applied
inside this release hardening pass. This is point-in-time evidence only. Re-run
full and production-only audits in the Node 22 release environment, review actual
runtime reachability, and track the compatible dependency upgrades separately.

### A07 — Authentication failures

- Firebase Auth backs user sessions; protected callables require verified server
  context and admin callables enforce the role hierarchy.
- Candidate and business signup flows resume/complete the profile after a partial
  account creation instead of silently leaving an unusable identity.
- Business roles carry server-owned provenance. Organization identity starts as
  explicitly unverified, and both sourcing requests and job cards fail closed to
  that warning state until an independent server-side review marks it verified.
- Password and submission paths prevent synchronous duplicate actions; sample
  account mutations are disabled in customer production.

Residual risk: production email verification/reset delivery depends on the
transactional email extension and verified SMTP sender domain, which remain a
launch gate. App Check and abuse-rate controls should be added before broad public
traffic.

### A08 — Software and data integrity

- Admin mutations, credit changes, application status, and Stripe events have
  server-owned audit/ledger records. Stripe webhook processing uses a durable
  event ledger and idempotent transitions.
- Canonical pricing, entitlement, quota, localization, and API documentation
  contracts have static parity gates to reduce hand-copied drift.
- Guarded production scripts default to no-I/O dry runs and require an exact
  project plus typed action confirmation. Credential migrations/backfills print
  aggregate counts only; role/bootstrap scripts intentionally print the target
  email/UID for operator verification. None should print secrets.

Residual risk: the repository workflow does not itself prove that branch
protection requires the release jobs or that the production operator followed
the signed change process. Verify both in GitHub and the target environment.

### A09 — Logging and monitoring

- Admin/business audit records and Cloud Functions logs provide operational
  evidence. Browser Sentry loads only after optional-monitoring consent.
  Cloud Functions Sentry does not consume browser consent; it is separately
  DSN-gated and configured with `sendDefaultPii: false`.
- Partner API usage logs have a 90-day expiry field; identifier-free day/month
  summary shards have a 120-day expiry after their last update. Both have
  guarded rollout/backfill procedures and eventual TTL deletion.
- Consented sourcing packets carry a 30-day expiry and a dedicated TTL policy;
  the callable also rejects them immediately at expiry or revocation instead of
  waiting for eventual TTL deletion.
- Sourcing creation uses a deterministic, server-only employer/candidate guard
  and an atomic UTC-day quota counter (5 unverified, 30 verified). Pending
  requests expire after 14 days, terminal consent cycles impose a seven-day
  cooldown, and both the pending-request and quota-counter TTL records are
  included in the account-deletion retention manifest. Candidate packets expose
  only the contact/resume whitelist; raw talent profiles and references are
  excluded from both new and legacy callable responses.

Residual risk: production alert policies, log access/retention, redaction,
server/browser Sentry sampling and approval, and incident routing are not verified. Do not log resume content,
provider keys, API keys, Stripe secrets, or migration row identities.

### A10 — Server-side request forgery

External compatible-provider and URL-import transports validate scheme, hostname,
DNS results, redirects, response size, and timeout. Requests connect to the
validated address while preserving the intended TLS hostname, closing the prior
DNS-rebinding gap covered by unit tests.

Residual risk: outbound egress allow-listing and provider certificate/hostname
monitoring are infrastructure controls outside this code review.

## Release-blocking security and privacy gates

| Priority | Gate | Required evidence before customer launch |
|---|---|---|
| P0 | BYOA legacy-secret migration | Restricted export; guarded migration; zero residue; second idempotent run; strict-rules smoke |
| P0 | Firebase rules and Storage IAM | Java/Firebase emulator suites green; candidate/employer/no-profile upload smoke; service-agent role verified |
| P0 | Transactional email | Extension installed; SMTP authenticated; SPF/DKIM/DMARC and verification/reset/notification delivery tested |
| P0 | Retention and deletion decision | Approved policy and owner for shared hiring, billing/audit, Storage, Stripe, export, anonymization, and erasure evidence |
| P0 | Business identity provenance | Read-only production audit has zero unresolved role provenance, unverified organization, or sample-account findings |
| P1 | Abuse protection | App Check and per-user/IP controls designed, enabled, monitored, and load-tested |
| P1 | Upload content safety | Server-side magic-byte validation plus malware/content scanning or an explicitly accepted launch restriction |
| P1 | Production observability | Alerts, budgets, log/Sentry redaction and retention, on-call route, and incident exercise verified |
| P1 | Financial compensation operations | Stripe fulfillment reviews and credit refund manual/permanent failures alert a named operator; reconciliation smoke proves at-most-once recovery |
| P1 | Real integrations | Live Stripe, AI providers, SMTP, DNS, Firebase indexes/TTL, and rollback paths tested with non-sensitive fixtures |

Re-run this review after those gates, after any trust-boundary change, and before
claiming production security or regulatory compliance.
