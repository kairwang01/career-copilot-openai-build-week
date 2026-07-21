# Firebase and VM Deployment Guide

This is the production runbook for Career CoPilot. It covers the Firebase backend and the Ubuntu VM that serves the web application. Domain names in this guide use `copilot.example.com`; replace that placeholder with the temporary demo domain or the final production domain for the environment being deployed.

Follow the sections in order for a new environment. For an ordinary release, use the shorter checklist in [Routine releases](#15-routine-releases).

The commands below assume:

- the repository is checked out at `/var/www/uottawa-copilot` on the VM;
- the Firebase project is `career-copilot-a3168`;
- Cloud Functions run in `us-central1`;
- the public domain is supplied by the deployment owner and may be temporary during the demo phase;
- the static server listens on `127.0.0.1:9050` behind nginx.

Replace those values when creating another environment. Never copy production keys into a staging project.

## What runs where

The application is split across two deployment targets:

| Part | Runs on | How it is released |
| --- | --- | --- |
| React/Vite frontend | Ubuntu VM, behind nginx | Build/test one named stage, promote it atomically to `dist/`, restart `uottawa-copilot.service` |
| Callable and HTTP APIs | Firebase Cloud Functions, Node.js 22 | `firebase deploy --only functions:<name>` |
| Firestore security | Cloud Firestore | `firebase deploy --only firestore:rules` |
| Firestore indexes | Cloud Firestore | `firebase deploy --only firestore:indexes` |
| Resume and avatar storage rules | Firebase Storage | `firebase deploy --only storage` |
| Storage browser CORS | Google Cloud Storage bucket | `gcloud storage buckets update ... --cors-file=storage.cors.json` |
| Firebase default site | Firebase Hosting | A redirect only; it sends `*.web.app` traffic to the VM domain |

Firebase Hosting is not the production frontend host. Running `firebase deploy --only hosting` updates the redirect, not the application served by the VM domain.

## Values to collect before starting

Keep this worksheet outside the repository. A password manager or the deployment system's secret store is the right place.

| Value | Example | Secret? | Used by |
| --- | --- | --- | --- |
| Firebase project ID | `career-copilot-a3168` | No | CLI, frontend, Functions |
| Functions region | `us-central1` | No | Frontend Functions client |
| Firebase Web API key | Firebase console value | No | Frontend Firebase SDK |
| Firebase auth domain | `<project>.firebaseapp.com` | No | Frontend Firebase SDK |
| Firebase app ID | `1:...:web:...` | No | Frontend Firebase SDK |
| Firebase storage bucket | `<project>.firebasestorage.app` | No | Frontend Firebase SDK |
| Gemini API key | Provider key | Yes | Admin model registry or Functions fallback |
| Stripe secret key | `sk_test_...` or `sk_live_...` | Yes | Secret Manager |
| Stripe webhook secret | `whsec_...` | Yes | Secret Manager |
| Stripe publishable key | `pk_test_...` or `pk_live_...` | No | Frontend checkout |
| Stripe Price IDs | `price_...` | No | Functions billing config |
| Public app URL | `https://copilot.example.com` | No | Redirects, email links, Stripe returns; use the current environment domain |
| VM public IP | IPv4 address | No | DNS A record |

The Firebase Web API key is an application identifier, not a server secret. Its safety comes from Firebase Auth, Firestore/Storage rules, API restrictions, and authorized domains. Gemini and Stripe secret keys must never appear in a `VITE_*` variable or a browser bundle.

## 1. Install the command-line tools

### Local workstation

Install Node.js 22, npm, Git, the Firebase CLI, and the Google Cloud CLI.

```bash
node --version
npm --version
git --version
firebase --version
gcloud --version
```

The Functions package declares Node.js 22 in `functions/package.json`. Use the same major version locally and in CI.

Install or update the Firebase CLI:

```bash
npm install --global firebase-tools@15.23.0
```

Authenticate interactively:

```bash
firebase login
gcloud auth login
gcloud auth application-default login
```

On a headless VM, use:

```bash
firebase login --no-localhost
```

Do not put a personal Firebase refresh token in the repository. CI should use Workload Identity Federation or a narrowly scoped service account.

### Ubuntu VM packages

```bash
sudo apt-get update
sudo apt-get install --yes nginx certbot python3-certbot-nginx rsync git curl ca-certificates
```

Install Node.js 22 using the package source approved for the VM, then confirm:

```bash
node --version
npm --version
```

The output of `node --version` must start with `v22`.

## 2. Create and prepare the Firebase project

Create the project in the Firebase console or select an existing Google Cloud project and add Firebase to it.

Confirm that the CLI can see it:

```bash
firebase projects:list
firebase use --add
firebase use
```

`firebase use --add` writes the project alias to `.firebaserc`. This repository uses:

```json
{
  "projects": {
    "default": "career-copilot-a3168"
  }
}
```

Always pass `--project` in production commands even when the default alias is correct. It prevents an accidental deploy to whichever project was selected in another terminal.

For a brand-new environment, the CLI equivalents are:

```bash
firebase projects:create YOUR_PROJECT_ID
firebase apps:create WEB "Career CoPilot Web" --project YOUR_PROJECT_ID
firebase apps:list WEB --project YOUR_PROJECT_ID
firebase apps:sdkconfig WEB YOUR_FIREBASE_WEB_APP_ID --project YOUR_PROJECT_ID
```

List valid Firestore regions and create the default database if it does not exist:

```bash
firebase firestore:locations
firebase firestore:databases:create '(default)' \
  --project YOUR_PROJECT_ID \
  --location us-central1 \
  --edition standard
```

Database creation is permanent with respect to location. Choose it before writing production data.

### Enable Firebase products

In the Firebase console:

1. Enable Email/Password in **Authentication > Sign-in method**.
2. Add the production domain under **Authentication > Settings > Authorized domains**.
3. Create a Firestore database in Native mode.
4. Create the default Storage bucket.
5. Register a Web App and copy its public configuration values.

Cloud Functions deployment enables most required Google Cloud APIs automatically. The project must allow these services:

- Cloud Functions
- Cloud Build
- Artifact Registry
- Cloud Run
- Eventarc
- Pub/Sub
- Cloud Scheduler
- Secret Manager
- Firestore
- Firebase Storage

If an organization policy prevents automatic enablement, an administrator must enable the blocked API before the deploy is retried.

## 3. Understand the repository Firebase configuration

### `.firebaserc`

Maps the local `default` alias to the real Firebase project ID. It contains no credentials.

### `firebase.json`

The file has five sections:

#### `functions`

```json
{
  "source": "functions",
  "predeploy": ["npm --prefix \"$RESOURCE_DIR\" run build"]
}
```

- `source` tells Firebase where the Functions package lives.
- `predeploy` compiles TypeScript before an upload. A type error stops the release.

#### `hosting`

`public` points to `dist`, but this project's Hosting rules redirect every path to the configured VM domain. The `rewrites` entry is retained as a safe SPA fallback if the redirect is removed later.

The currently deployed default site may be an older meta-refresh page rather than the 301 declared in `firebase.json`. Test a preview channel before replacing it:

```bash
firebase hosting:channel:deploy redirect-check \
  --expires 1h \
  --project career-copilot-a3168
```

Open the preview URL and test `/`, `/workspace`, and one unknown SPA path. Deploy the redirect only after the preview behaves as intended:

```bash
firebase deploy --project career-copilot-a3168 --only hosting
```

Verify both headers and body because an older meta-refresh release can return HTTP 200:

```bash
curl -sSI https://career-copilot-a3168.web.app/
curl -sS https://career-copilot-a3168.web.app/ | head
```

#### `firestore`

Points at `firestore.rules` and `firestore.indexes.json`. Rules control authorization. Indexes support the compound queries used by usage reporting, messages, and interviews.

#### `storage`

Points at `storage.rules`. Browser CORS is separate and is configured on the bucket with `storage.cors.json`.

#### `emulators`

The default local ports are:

| Emulator | Port |
| --- | ---: |
| Auth | 9199 |
| Functions | 5001 |
| Firestore | 8080 |
| Storage | 9197 |
| Emulator UI | 4001 |

`firebase.qa.json` uses alternate ports for QA scripts that must run alongside another emulator session.

## 4. Configure the frontend

Copy the example file:

```bash
cp .env.example .env.local
chmod 600 .env.local
```

Set the Firebase Web App values:

```dotenv
VITE_FIREBASE_API_KEY=replace_with_firebase_web_api_key
VITE_FIREBASE_AUTH_DOMAIN=career-copilot-a3168.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=career-copilot-a3168
VITE_FIREBASE_STORAGE_BUCKET=career-copilot-a3168.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=replace_with_sender_id
VITE_FIREBASE_APP_ID=replace_with_app_id
VITE_FIREBASE_FUNCTIONS_REGION=us-central1
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_replace_me
```

What each value does:

| Variable | Purpose |
| --- | --- |
| `VITE_FIREBASE_API_KEY` | Identifies the Firebase web project |
| `VITE_FIREBASE_AUTH_DOMAIN` | Hosts Firebase Auth redirects and session helpers |
| `VITE_FIREBASE_PROJECT_ID` | Selects Firestore and Functions project resources |
| `VITE_FIREBASE_STORAGE_BUCKET` | Selects the resume/avatar bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Part of the Firebase Web App identity |
| `VITE_FIREBASE_APP_ID` | Unique Firebase Web App identifier |
| `VITE_FIREBASE_FUNCTIONS_REGION` | Must match `setGlobalOptions` in `functions/src/index.ts` |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Opens Stripe checkout in the browser; a `pk_*` value only |

Do not add any of these:

```dotenv
VITE_API_KEY=...
VITE_GEMINI_API_KEY=...
VITE_STRIPE_SECRET_KEY=...
```

Every `VITE_*` value is eligible for inclusion in the browser build. Server keys belong in Firestore admin configuration, Functions environment files, or Secret Manager.

## 5. Configure Cloud Functions

Install and compile the Functions package:

```bash
npm --prefix functions ci
npm --prefix functions run build
```

The runtime is defined in `functions/package.json`:

```json
{
  "engines": {
    "node": "22"
  }
}
```

### Project-specific environment file

Firebase automatically loads `functions/.env.<project-id>` during deployment. For production, the path is:

```text
functions/.env.career-copilot-a3168
```

The repository ignores `.env` and `.env.*` files. Confirm before every commit:

```bash
git status --short
git check-ignore -v functions/.env.career-copilot-a3168
```

A production file can contain non-secret runtime choices and compatibility fallbacks:

```dotenv
APP_BASE_URL=https://copilot.example.com
ALLOWED_REDIRECT_ORIGINS=https://copilot.example.com
BILLING_SIMULATION=false
OPPORTUNITY_USE_GOOGLE_SEARCH=true
GEMINI_MODEL=gemini-3.5-flash
LLM_SPEED_ROUTE_ATTEMPT_TIMEOUT_MS=30000
LLM_SPEED_ROUTE_TOTAL_TIMEOUT_MS=45000
LLM_QUALITY_REPAIR_START_BEFORE_MS=25000

STRIPE_PRICE_ESSENTIALS=price_replace_me
STRIPE_PRICE_ACCELERATOR=price_replace_me
STRIPE_PRICE_EXECUTIVE=price_replace_me
STRIPE_PRICE_STARTER=price_replace_me
STRIPE_PRICE_GROWTH=price_replace_me
STRIPE_PRICE_PRO=price_replace_me
STRIPE_PRICE_PACK_100=price_replace_me
STRIPE_PRICE_PACK_500=price_replace_me
STRIPE_PRICE_PACK_1000=price_replace_me
```

| Variable | Meaning |
| --- | --- |
| `APP_BASE_URL` | Fallback domain for Stripe return URLs and server-built links |
| `ALLOWED_REDIRECT_ORIGINS` | Comma-separated extra origins allowed for safe post-payment returns |
| `BILLING_SIMULATION` | `true` uses the demo checkout path; production billing requires `false` |
| `OPPORTUNITY_USE_GOOGLE_SEARCH` | Enables Gemini Search grounding when not set to `false` |
| `GEMINI_MODEL` | Environment fallback when Firestore has no model setting |
| `GEMINI_FALLBACK_MODEL` | Optional model retry target; omit to disable |
| `LLM_SPEED_ROUTE_ATTEMPT_TIMEOUT_MS` | Maximum time for one speed-pool member attempt |
| `LLM_SPEED_ROUTE_TOTAL_TIMEOUT_MS` | Total deadline for a speed-pool generation call |
| `LLM_QUALITY_REPAIR_START_BEFORE_MS` | Latest point at which a second-pass quality repair may start |
| `STRIPE_PRICE_*` | Stripe Price IDs for candidate and employer plans |
| `SENTRY_DSN` | Optional server-side Sentry project DSN |
| `SENTRY_TRACES_RATE` | Optional server trace sampling rate, for example `0.1` |

`BILLING_SIMULATION=true` is a demo setting. It must not be described as a live Stripe deployment.

`STRIPE_PRICE_PACK_100`, `STRIPE_PRICE_PACK_500`, and `STRIPE_PRICE_PACK_1000` are one-time credit-pack prices. The other listed `STRIPE_PRICE_*` values cover recurring candidate and employer subscriptions.

Create the live Prices with these exact contracts. The checked-in
`scripts/lib/stripe-release-config.mjs` is the machine-readable source used by
the production preflight; public price copy and credit-pack configuration must
change in the same release if any amount changes.

| Environment key | CAD cents | Billing | Required lookup key |
| --- | ---: | --- | --- |
| `STRIPE_PRICE_ESSENTIALS` | 1900 | monthly | `career_copilot_essentials_cad_monthly` |
| `STRIPE_PRICE_ACCELERATOR` | 3900 | monthly | `career_copilot_accelerator_cad_monthly` |
| `STRIPE_PRICE_EXECUTIVE` | 7900 | monthly | `career_copilot_executive_cad_monthly` |
| `STRIPE_PRICE_STARTER` | 7900 | monthly | `career_copilot_starter_cad_monthly` |
| `STRIPE_PRICE_GROWTH` | 19900 | monthly | `career_copilot_growth_cad_monthly` |
| `STRIPE_PRICE_PRO` | 49900 | monthly | `career_copilot_pro_cad_monthly` |
| `STRIPE_PRICE_PACK_100` | 300 | one time | `career_copilot_pack_100_cad_once` |
| `STRIPE_PRICE_PACK_500` | 900 | one time | `career_copilot_pack_500_cad_once` |
| `STRIPE_PRICE_PACK_1000` | 1500 | one time | `career_copilot_pack_1000_cad_once` |

Do not configure or sell the legacy `single_post` / `job_pack` employer products. Public cards, self-service selection, admin assignment, and new checkout are intentionally blocked until the backend has an atomic consumable-post ledger, 30-day expiry enforcement, and refund/reversal handling. Existing paid webhook records remain readable only for legacy support.

### Secret Manager

Stripe Functions bind Secret Manager values directly. Set them with:

```bash
firebase functions:secrets:set STRIPE_SECRET_KEY --project career-copilot-a3168
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --project career-copilot-a3168
firebase functions:secrets:get STRIPE_SECRET_KEY --project career-copilot-a3168
firebase functions:secrets:get STRIPE_WEBHOOK_SECRET --project career-copilot-a3168
```

The first two commands prompt for the secret value without putting it on the command line. Redeploy the Functions that bind a changed secret:

```bash
firebase deploy --project career-copilot-a3168 \
  --only functions:createCheckoutSession,functions:createBillingPortalSession,functions:stripeWebhook
```

Keep both secrets in Secret Manager as their only source. The production dotenv
checker rejects copies of them in `functions/.env.career-copilot-a3168`. Before a
customer launch, use a least-privilege operator identity to stream the live key
directly into the preflight; the key is held in memory and never printed or put
on a command line:

```bash
set -Eeuo pipefail
APPROVED_SHA=REPLACE_WITH_REVIEWED_40_CHARACTER_SHA
LIVE_TMP_DIR=$(mktemp -d)
LIVE_TMP=$LIVE_TMP_DIR/stripe-live.json
trap 'rm -rf "$LIVE_TMP_DIR"' EXIT
LIVE_EVIDENCE=/var/lib/career-copilot-releases/stripe-live/$APPROVED_SHA.json
test ! -e "$LIVE_EVIDENCE"
test "$(git rev-parse HEAD)" = "$APPROVED_SHA"
test -z "$(git status --porcelain --untracked-files=all)"
npm --prefix functions ci
test -z "$(git status --porcelain --untracked-files=all)"
firebase functions:secrets:access STRIPE_SECRET_KEY \
  --project career-copilot-a3168 | \
  npm run gate:release:live -- \
    --approved-sha="$APPROVED_SHA" \
    --evidence-file="$LIVE_TMP"
sudo install -d -m 0750 -o root -g copilot-deploy \
  /var/lib/career-copilot-releases/stripe-live
sudo install -m 0440 -o root -g copilot-deploy "$LIVE_TMP" "$LIVE_EVIDENCE"
rm -rf "$LIVE_TMP_DIR"
trap - EXIT
```

This calls Stripe with the live account and requires every configured Price to
be distinct, active, live-mode, CAD, equal to its published amount and stable
lookup key, attached to an active Product, and one-month licensed recurring or
one-time as appropriate. The installed Stripe SDK must exactly match the
Functions lockfile. The enabled platform-account webhook must pin the same API
version as that SDK and
live `stripeWebhook` endpoint and all six handled event types. Record only the
success summary and the root-sealed JSON evidence. It is valid for six hours
and only for its exact approved commit; the complete section 12 gate refuses to
run without it and binds its SHA-256 into the release result. Stripe does not reveal an existing
endpoint's signing secret, so after deploy a signed live webhook smoke and
replay remains a separate mandatory gate proving `STRIPE_WEBHOOK_SECRET` matches.

After the backend deployment, use a previously completed, low-risk live event
whose ledger already has `status=completed`. Do not create a charge or spend
money without explicit human approval. Record the ledger's `attempts` and
`completed_at`, resend the same event twice with Stripe's registered endpoint,
and verify both deliveries are 2xx in Stripe Workbench:

```bash
set -Eeuo pipefail
APPROVED_SHA=REPLACE_WITH_REVIEWED_40_CHARACTER_SHA
EVENT_ID=evt_REPLACE_WITH_REVIEWED_LIVE_EVENT
ENDPOINT_ID=we_REPLACE_WITH_REGISTERED_ENDPOINT
stripe events resend "$EVENT_ID" --webhook-endpoint="$ENDPOINT_ID"
# Verify the first 2xx delivery in Stripe Workbench, then repeat once.
stripe events resend "$EVENT_ID" --webhook-endpoint="$ENDPOINT_ID"
```

Query `stripe_webhook_events` after each resend. The same ledger must remain
completed, with the exact event ID/type/live-mode fields and unchanged
`attempts` and `completed_at`; this proves the replay followed the duplicate
path and produced no additional entitlement effect. Capture the two Workbench
delivery timestamps/statuses, the deployed Function revision, and the before /
after ledger values in the reviewed change record. Then create the standardized
record outside the repository (timestamps below are examples only):

```bash
set -Eeuo pipefail
WEBHOOK_TMP_DIR=$(mktemp -d)
WEBHOOK_TMP=$WEBHOOK_TMP_DIR/stripe-webhook.json
trap 'rm -rf "$WEBHOOK_TMP_DIR"' EXIT
LIVE_EVIDENCE=/var/lib/career-copilot-releases/stripe-live/$APPROVED_SHA.json
WORKBENCH_ARTIFACT=/absolute/review-record/workbench-deliveries.artifact
FIRESTORE_ARTIFACT=/absolute/review-record/firestore-ledger.artifact
WEBHOOK_EVIDENCE_DIR=/var/lib/career-copilot-releases/stripe-webhook/$APPROVED_SHA
WEBHOOK_EVIDENCE=$WEBHOOK_EVIDENCE_DIR/evidence.json
test ! -e "$WEBHOOK_EVIDENCE_DIR"
firebase functions:secrets:access STRIPE_SECRET_KEY \
  --project career-copilot-a3168 | \
  npm run gate:release:webhook-record -- \
  --approved-sha="$APPROVED_SHA" \
  --live-evidence="$LIVE_EVIDENCE" \
  --evidence-file="$WEBHOOK_TMP" \
  --workbench-artifact="$WORKBENCH_ARTIFACT" \
  --firestore-artifact="$FIRESTORE_ARTIFACT" \
  --endpoint-id="$ENDPOINT_ID" \
  --function-revision=stripewebhook-REPLACE_WITH_REVISION \
  --operator-ref=REPLACE_WITH_APPROVED_OPERATOR_ID \
  --change-record=REPLACE_WITH_CHANGE_RECORD_ID \
  --event-id="$EVENT_ID" \
  --first-resent-at=REPLACE_WITH_WORKBENCH_ISO_TIME \
  --replay-resent-at=REPLACE_WITH_WORKBENCH_ISO_TIME \
  --first-http-status=200 \
  --replay-http-status=200 \
  --ledger-attempts-before=REPLACE_WITH_INTEGER \
  --ledger-attempts-after-first=REPLACE_WITH_SAME_INTEGER \
  --ledger-attempts-after-replay=REPLACE_WITH_SAME_INTEGER \
  --ledger-completed-at-before=REPLACE_WITH_FIRESTORE_ISO_TIME \
  --ledger-completed-at-after-replay=REPLACE_WITH_SAME_ISO_TIME \
  --confirm-workbench-deliveries \
  --confirm-firestore-ledger
sudo install -d -m 0750 -o root -g copilot-deploy "$WEBHOOK_EVIDENCE_DIR"
sudo install -m 0440 -o root -g copilot-deploy \
  "$WEBHOOK_TMP" "$WEBHOOK_EVIDENCE"
sudo install -m 0440 -o root -g copilot-deploy \
  "$WORKBENCH_ARTIFACT" "$WEBHOOK_EVIDENCE_DIR/workbench-deliveries.artifact"
sudo install -m 0440 -o root -g copilot-deploy \
  "$FIRESTORE_ARTIFACT" "$WEBHOOK_EVIDENCE_DIR/firestore-ledger.artifact"
rm -rf "$WEBHOOK_TMP_DIR"
trap - EXIT
```

The recorder retrieves the event and endpoint from Stripe with the streamed
live key, but it cannot query Workbench delivery attempts or replace the human
review of Workbench and the production Firestore ledger. The two artifacts must
contain only the reviewed, minimally necessary delivery and ledger fields; redact
customer data before sealing them. The recorder binds their hashes and the operator /
change-record references
to the clean approved commit, current webhook source, price configuration, and
live Stripe preflight. Section 12 rejects a missing, stale, mismatched, non-2xx,
or replay-mutating record. This external live step remains a launch blocker until
an authorized operator completes it. Stripe documents event resend and delivery
inspection in its [webhook operations guide](https://docs.stripe.com/webhooks).

The current AI provider resolution order is:

1. `platform_config/llm` in Firestore, managed through the Admin Portal;
2. the matching Functions environment variable as a fallback.

The supported fallback environment variables are:

```dotenv
GEMINI_API_KEY=
KAIRLLM_API_KEY=
KAIRLLM_BASE_URL=https://ai.gogosling.ca/v1
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
```

Do not duplicate working provider keys across several configuration layers without a reason. It makes rotation and incident response harder. Prefer the Admin Portal for the current model registry and keep only an intentional emergency fallback in the Functions environment.

## 6. Configure Firestore runtime settings

The protected `platform_config` collection holds operational settings that can change without a code release.

| Document | Contents |
| --- | --- |
| `platform_config/llm` | Gemini, KairLLM, and DeepSeek keys/models/base URLs |
| `platform_config/models` | Model registry, default model, routing pools, module routes |
| `platform_config/quotas` | Plan quotas, tool costs, token caps, feature gates |
| `platform_config/prompts` | Published prompt overrides |
| `platform_config/access` | Admin role assignments |
| `platform_config/app` | Canonical public URL |
| `platform_config/web3` | Optional Web3 module configuration |

Set the canonical domain in `platform_config/app`:

```json
{
  "app_base_url": "https://copilot.example.com"
}
```

Use the Admin Portal for LLM keys, models, routing pools, prompts, quotas, and admin roles. The portal masks stored credentials and writes an audit record for mutations.

Bootstrap the first super administrator only after that person has a Firebase Auth account. The script has no implicit email or project and is a no-write dry run by default:

```bash
gcloud auth application-default login
cd functions
export ALLOW_PRODUCTION_WRITES=1
export CONFIRM_PRODUCTION_PROJECT=career-copilot-a3168
node scripts/grantSuper.js \
  --email administrator@example.com \
  --production \
  --project career-copilot-a3168
```

The shared target guard requires those project confirmations even though the dry run returns before Firebase SDK initialization. Review the printed production target and exact confirmation, then apply to the same target:

```bash
export ADMIN_CHANGE_REASON=SEC-1234-first-super-bootstrap
node scripts/grantSuper.js \
  --email administrator@example.com \
  --production \
  --project career-copilot-a3168 \
  --apply \
  --confirm-action "GRANT_SUPER:career-copilot-a3168:administrator@example.com"
```

Run privileged production changes in an interactive terminal. Non-interactive execution is denied unless the separate CI override is deliberately enabled; do not use that override for an ordinary bootstrap.

The Admin Portal's sample-account reset is super-only and disabled outside the
Firebase Emulator by default. Never enable it in the customer production
project. If a dedicated non-production QA project needs it, the Functions
runtime must contain both flags, and the project ids must match exactly:

```dotenv
ALLOW_SAMPLE_ACCOUNT_MUTATION=true
SAMPLE_ACCOUNT_PROJECT_ID=career-copilot-qa
```

Leaving either value unset or naming a different project fails closed. Remove
both flags after the QA account-reset window.

### Audit business-role provenance before launch

Business signup now stamps `role_provenance`, `role_provisioned_at`, and an
explicit `organization_verified=false` server-side. Stripe fulfillment can
backfill missing provenance, but it never upgrades organization trust. Existing
employer/agency rows created before this contract require a read-only audit:

```bash
cd functions
npm run audit:business-roles -- --project=career-copilot-a3168
```

The project argument is mandatory. The script performs no writes and emits only
aggregate counts plus 12-character hashed references; it never prints names,
emails, raw UIDs, company names, or billing identifiers. Exit code `2` means an
operator must reconcile one or more of:

- `role_provenance_unverified`: prove the role from an approved signup/admin or
  exact Stripe entitlement record;
- `organization_identity_unverified`: complete the approved organization review;
- `sample_account_present`: remove the non-production sample account from the
  customer project.

Do not convert a self-reported organization into a verified badge merely because
it has paid. Payment and organization identity are separate trust decisions.

For the default Gemini route:

- model: `gemini-3.5-flash`;
- speed-route thinking: `low`, except deterministic resume reformatting, which uses `minimal`;
- speed attempt timeout: 30 seconds;
- speed total timeout: 45 seconds;
- add a tested fallback member before relying on automatic pool failover.

## 7. Configure Storage CORS

`storage.rules` controls authorization. `storage.cors.json` controls which browser origins may send upload requests to the bucket. Both are required.

### Verify cross-service Storage Rules access

The company-logo and resume upload rules call `firestore.get()` to read the owner's product role. During an interactive Storage Rules deploy, the Firebase CLI may prompt to enable the required cross-service permission. Accept that prompt, then verify in Google Cloud IAM (with **Include Google-provided role grants** enabled) that the Storage service agent whose address ends in `@gcp-sa-firebasestorage.iam.gserviceaccount.com` has the **Firebase Rules Firestore Service Agent** role. If it is missing, do not launch uploads; rerun the targeted Storage Rules deploy interactively and resolve the IAM grant first.

Each authorized upload currently performs one Firestore rules lookup. Those reads are billed as Firestore reads and count toward the Storage Rules cross-service document-access limits.

Before launch, run a two-role smoke test with dedicated accounts and disposable files:

1. Candidate profile: resume upload succeeds; company-logo upload is denied.
2. Employer profile: company-logo upload succeeds; resume upload is denied.
3. A signed-in account with no `users/{uid}` profile is denied for both role-gated paths.
4. Delete every disposable object and verify owner-only reads/deletes still work.

Rules-emulator tests remain mandatory, but they do not prove that the production service-agent IAM grant exists.

Apply CORS:

```bash
gcloud storage buckets update \
  gs://career-copilot-a3168.firebasestorage.app \
  --cors-file=storage.cors.json \
  --project=career-copilot-a3168
```

Inspect it:

```bash
gcloud storage buckets describe \
  gs://career-copilot-a3168.firebasestorage.app \
  --format='yaml(cors_config)' \
  --project=career-copilot-a3168
```

Test the browser preflight:

```bash
curl -i -X OPTIONS \
  -H 'Origin: https://copilot.example.com' \
  -H 'Access-Control-Request-Method: PUT' \
  -H 'Access-Control-Request-Headers: content-type' \
  'https://firebasestorage.googleapis.com/v0/b/career-copilot-a3168.firebasestorage.app/o/deploy-check'
```

The response should be successful and include an allowed origin matching the request.

## 8. Run the release gate

Install dependencies from the lockfiles:

```bash
npm ci
npm --prefix functions ci
```

Run the canonical source phase. It validates the non-secret production Stripe configuration,
type-checks both packages, runs the complete pure suite and dependency audits,
and records a fail-fast result when `RELEASE_GATE_RESULTS` is set:

```bash
RELEASE_GATE_RESULTS=/absolute/restricted/evidence/source \
  RELEASE_APPROVED_SHA=$(git rev-parse HEAD) \
  npm run gate:release:source
```

For a VM release, do not create a disposable `dist/` here and then rebuild it
during publication. The production frontend is built exactly once into a named
release stage, exercised from that same stage, hashed, and promoted by the
[atomic frontend procedure](#12-build-test-and-publish-one-frontend-artifact).
That later artifact gate is part of this release gate, not an optional second
build.

For a customer launch or any `main` promotion, the exact SHA's CI emulator and
browser phases are mandatory even when the file-name diff looks frontend-only.
A developer workstation may run only the source preflight and does not need a
local Java/Firebase emulator to commit or push. In the CI or release environment
that owns browser coverage, install Chromium and run the phase command:

```bash
npx playwright install --with-deps chromium
RELEASE_GATE_RESULTS=/absolute/restricted/evidence/emulator \
  RELEASE_APPROVED_SHA=$(git rev-parse HEAD) \
  npm run gate:release:emulator
```

The only complete acceptance command is `npm run gate:release`. Section 12 runs
it after building the one named stage and supplies that stage through
`E2E_STAGE_DIR`. Do not substitute a hand-maintained subset of tests. CI may run
the source, emulator, and browser phases in parallel, but its final
`release-gate` job requires all three results for the same `${{ github.sha }}`.

The emulator tests require Java, but the package scripts do not assume a Java
installation path. Verify the designated CI image with `java -version` and, when
that environment requires it, set `JAVA_HOME` to its real JRE/JDK location. Do
not copy a macOS Homebrew path into Windows, Linux, or CI configuration. Emulator
coverage is an isolated regression check; it never substitutes for production
Functions, Rules, indexes, TTL, IAM, or authenticated live-Firebase smoke.

Emulator scripts pass temporary variables through `scripts/run-with-env.mjs`.
That wrapper sets `NODE_BINARY` to the Node process that launched it and invokes
children without an outer shell. On Windows it resolves an npm-compatible
`firebase.cmd` shim to the shim's JavaScript entry point; an unrecognized `.cmd`
or `.bat` is rejected rather than executed through `cmd.exe`. Keep the quoted
`emulators:exec` payload (including payloads containing `&&`) as one Firebase CLI
argument, and do not reintroduce inline POSIX `NAME=value` assignments or
`NODE_BINARY=$(command -v node)` substitutions. Java and the Firebase CLI remain
explicit prerequisites only for the environment that owns the emulator phase.
If either is absent there, have the CI owner provision it instead of embedding a
machine-specific path in `package.json`.

## 9. Deploy Firebase resources

### Stage query-only composite indexes before dependent Functions

Do not upload the complete `firestore.indexes.json` yet. That canonical file has
five TTL policies: `api_usage_logs.expires_at`,
`api_usage_summary_shards.expires_at`,
`sourcing_candidate_packets.expires_at`, `sourcing_outreach.expires_at`, and
`sourcing_outreach_daily_quotas.expires_at`. The retained API usage records must
be backfilled before the first two are enabled; the three sourcing collections
already receive server-written expiry fields. Generate the inventory directly
from the canonical file, save it with the change record, and compare all 22
canonical composite signatures with production:

```bash
node scripts/print-firestore-index-plan.mjs \
  > /absolute/restricted/evidence/firestore-index-plan.json
gcloud firestore indexes composite list \
  --project=career-copilot-a3168 \
  --database='(default)' \
  --format='json(name,queryScope,fields,state)'
```

Create every missing query index with `gcloud` and leave field overrides
untouched. The commands below show the required command shape; they are not a
replacement for reconciling every signature in the generated 22-index plan.
Omit a create command when the exact index already exists:

```bash
gcloud firestore indexes composite list \
  --project=career-copilot-a3168 \
  --database='(default)' \
  --format='json(name,queryScope,fields,state)'

gcloud firestore indexes composite create \
  --project=career-copilot-a3168 \
  --database='(default)' \
  --collection-group=job_applications \
  --query-scope=collection \
  --field-config=field-path=candidate_id,order=ascending \
  --field-config=field-path=application_date,order=descending

gcloud firestore indexes composite create \
  --project=career-copilot-a3168 \
  --database='(default)' \
  --collection-group=admin_prompt_versions \
  --query-scope=collection \
  --field-config=field-path=promptKey,order=ascending \
  --field-config=field-path=version,order=descending

gcloud firestore indexes composite create \
  --project=career-copilot-a3168 \
  --database='(default)' \
  --collection-group=admin_prompt_versions \
  --query-scope=collection \
  --field-config=field-path=promptKey,order=ascending \
  --field-config=field-path=status,order=ascending

gcloud firestore indexes composite create \
  --project=career-copilot-a3168 \
  --database='(default)' \
  --collection-group=api_usage_logs \
  --query-scope=collection \
  --field-config=field-path=key_id,order=ascending \
  --field-config=field-path=timestamp,order=descending

gcloud firestore indexes composite create \
  --project=career-copilot-a3168 \
  --database='(default)' \
  --collection-group=company_reviews \
  --query-scope=collection \
  --field-config=field-path=employer_id,order=ascending \
  --field-config=field-path=created_at,order=descending

gcloud firestore indexes composite create \
  --project=career-copilot-a3168 \
  --database='(default)' \
  --collection-group=job_postings \
  --query-scope=collection \
  --field-config=field-path=is_active,order=ascending \
  --field-config=field-path=created_at,order=descending
```

Wait until every required composite index reports `READY` before deploying a
Function that issues its query. In particular, `publicApi` must not be deployed
until the `job_postings(is_active ASC, created_at DESC)` index is ready.

```bash
gcloud firestore indexes composite list \
  --project=career-copilot-a3168 \
  --database='(default)' \
  --format='json(name,queryScope,fields,state)'
```

### Migrate legacy BYOA credentials before strict Firestore Rules

The current rules deny client reads of any `users/{uid}` document that still contains the legacy `custom_provider` field because it includes a raw API key. Deploying those rules before migrating would lock affected users out of their own profiles. Use this order for the first release containing `private_custom_provider_configs`:

1. Open a migration change ticket and record the release owner, approved window, current commit, rollback decision-maker, and a restricted Firestore export location. Export at least `users`, `private_custom_provider_configs`, and `account_deletion_requests` before any write. The export contains raw provider keys and profile PII: keep it in a dedicated encrypted bucket with narrowly scoped IAM and an approved short retention/deletion date; never download it to a workstation or attach it to logs, tickets, or build artifacts. Wait for the export operation to complete successfully and record only its operation ID/path and status.
2. Build Functions and deploy every callable that resolves or edits custom-provider models while the previous Firestore rules remain active. The current set is `aiProxy`, `analyzeResume`, `mockInterview`, `generateCoverLetter`, `generateCareerPath`, `careerCoach`, `extractTextFromUrl`, `discoverTalent`, `listJobApplicants`, `publicApi`, `listModels`, `adminListModels`, `adminUpsertModel`, `adminDeleteModel`, `adminSetDefaultModel`, `adminUpdateModelRouting`, `adminTestModel`, `getBusinessLlmConfig`, and `setBusinessLlmConfig`. Re-derive the list from imports of `functions/src/llm/models.ts` whenever that module changes.
3. From the repository root, build and run the migration's no-I/O plan. The shared production-target guard requires the two explicit project confirmations even for a dry run; the script still returns before initializing the Firebase SDK and performs no remote read or write:

   ```bash
   cd "$(git rev-parse --show-toplevel)"
   npm --prefix functions run build
   (
     cd functions
     export ALLOW_PRODUCTION_WRITES=1
     export CONFIRM_PRODUCTION_PROJECT=career-copilot-a3168
     node scripts/migrateCustomProviderConfigs.js \
       --production \
       --project career-copilot-a3168
   )
   ```

4. Review the target, then apply with all production guards and the exact typed confirmation:

   ```bash
   cd "$(git rev-parse --show-toplevel)"
   (
     cd functions
     export ALLOW_PRODUCTION_WRITES=1
     export CONFIRM_PRODUCTION_PROJECT=career-copilot-a3168
     node scripts/migrateCustomProviderConfigs.js \
       --production \
       --project career-copilot-a3168 \
       --apply \
       --confirm-action "MIGRATE_CUSTOM_PROVIDER:career-copilot-a3168:users.custom_provider"
   )
   ```

5. Require the final output to contain `remaining_legacy_fields=0`. Then run the same apply command a second time and require `legacy_found=0`, `migrated=0`, and `remaining_legacy_fields=0` as the idempotence proof. The script paginates in stable document-id order, migrates each credential transactionally, prints aggregate counts only, and rescans the entire collection after writing.
6. Only after the zero-residue check succeeds, continue to the two API-usage
   backfills below. Do not deploy the current Firestore Rules yet. After both
   backfills, the full index/TTL configuration, and the strict rules/Storage gate
   complete, smoke-test masked BYOA read/update through the two business
   callables, verify that direct client reads of
   `private_custom_provider_configs/{uid}` are denied, and use a migrated
   employer account to run one custom-model tool successfully through the normal
   model resolver. Confirm that neither the callable response nor approved logs
   contain the raw key. Close the change ticket only after all three paths
   succeed; delete the restricted export on its approved retention date.

If the migration fails or any legacy field remains, stop. Keep the previous rules in place, investigate the aggregate failure, and do not deploy the strict rules.

### Backfill API usage-log expiry before enabling TTL

The updated `publicApi` writer adds `expires_at` to new usage records. After that Function is deployed but before the index configuration enables TTL, backfill older records with the guarded script. Production target selection requires the same two environment confirmations for both plan and apply:

```bash
cd "$(git rev-parse --show-toplevel)"
(
  cd functions
  export ALLOW_PRODUCTION_WRITES=1
  export CONFIRM_PRODUCTION_PROJECT=career-copilot-a3168
  node scripts/backfillApiUsageLogExpiry.js \
    --production \
    --project career-copilot-a3168

  node scripts/backfillApiUsageLogExpiry.js \
    --production \
    --project career-copilot-a3168 \
    --apply \
    --confirm-action "BACKFILL_API_USAGE_TTL:career-copilot-a3168:api_usage_logs.expires_at"
)
```

Require `invalid_timestamp=0` and `remaining_missing_expiry=0`, then run the same apply command again and require `updated=0`. If either count is nonzero, stop and reconcile the malformed records before enabling TTL. The script prints aggregate counts only.

### Backfill exact API usage summaries before switching the admin dashboard

The admin API dashboard reads 32 deterministic counter shards for each of the
seven UTC days and the current UTC month. This replaces the former
`api_usage_logs.limit(5000)` scan, which silently undercounted busy months. Each
new log is applied to its day and month shards by the retrying
`onApiUsageLogCreated` trigger. The log marker and both increments are committed
in one Firestore transaction, so trigger retries and the backfill cannot count a
log twice. The dashboard also calculates active-key monthly quota with a
server-side aggregate instead of the 500-key admin list cap. Each refresh reads
at most 256 summary documents (`8 periods * 32 shards`) plus the rollout state
and quota aggregate. The counters are exact after the asynchronous trigger has
marked the log; they are intentionally eventually consistent during that short
processing window and must not be described as zero-lag realtime telemetry.

Roll this out in two Function deployments so the reader cannot observe a
partially migrated database:

1. Build Functions, then deploy **only** the new writer trigger. Do not deploy
   `apiPlatformGetUsage` yet.

   ```bash
   cd "$(git rev-parse --show-toplevel)"
   npm --prefix functions run build
   firebase deploy \
     --project career-copilot-a3168 \
     --only functions:onApiUsageLogCreated
   ```

2. From `functions/`, run the no-I/O plan. Even the production plan requires
   explicit target confirmations, but it returns before Firebase Admin is
   loaded and performs no remote read or write:

   ```bash
   cd "$(git rev-parse --show-toplevel)"
   (
     cd functions
     export ALLOW_PRODUCTION_WRITES=1
     export CONFIRM_PRODUCTION_PROJECT=career-copilot-a3168
     node scripts/backfillApiUsageSummaries.js \
       --production \
       --project career-copilot-a3168
   )
   ```

3. Review the exact target, then apply with the typed confirmation:

   ```bash
   cd "$(git rev-parse --show-toplevel)"
   (
     cd functions
     export ALLOW_PRODUCTION_WRITES=1
     export CONFIRM_PRODUCTION_PROJECT=career-copilot-a3168
     node scripts/backfillApiUsageSummaries.js \
       --production \
       --project career-copilot-a3168 \
       --apply \
       --confirm-action "BACKFILL_API_USAGE_SUMMARIES:career-copilot-a3168:api_usage_logs.summary_version"
   )
   ```

4. Require `missing=0`, `remaining_invalid_timestamp=0`,
   `remaining_invalid_status=0`, `remaining_invalid_marker=0`,
   `remaining_unapplied=0`, and
   `checkpoint=ready`. Run the same apply command again and additionally require
   `applied=0`; `already_applied` should equal `scanned`. The stable document-id
   scan uses bounded pages and concurrency, and prints aggregate counts only—no
   API key, key id, request id, or log id.
5. Now that both the usage-log expiry and summary backfills have zero residue,
   deploy the complete canonical index configuration. This reconciles the
   query-only composites staged earlier and enables all five TTL policies.
   Do not rely on a successful upload alone; require every composite index to be
   `READY` and all five TTL policies to be active.

   ```bash
   firebase deploy \
     --project career-copilot-a3168 \
     --only firestore:indexes

   gcloud firestore indexes composite list \
     --project=career-copilot-a3168 \
     --database='(default)' \
     --format='table(name.basename(),queryScope,state)'

   gcloud firestore fields ttls list \
     --project=career-copilot-a3168 \
     --collection-group=api_usage_logs

   gcloud firestore fields ttls list \
     --project=career-copilot-a3168 \
     --collection-group=api_usage_summary_shards

  gcloud firestore fields ttls list \
    --project=career-copilot-a3168 \
    --collection-group=sourcing_candidate_packets

  gcloud firestore fields ttls list \
    --project=career-copilot-a3168 \
    --collection-group=sourcing_outreach

  gcloud firestore fields ttls list \
    --project=career-copilot-a3168 \
    --collection-group=sourcing_outreach_daily_quotas
   ```

   Require the active fields to be exactly
   `api_usage_logs.expires_at`, `api_usage_summary_shards.expires_at`,
   `sourcing_candidate_packets.expires_at`, `sourcing_outreach.expires_at`, and
   `sourcing_outreach_daily_quotas.expires_at` for this release.

6. Only after both migration runs and the TTL check are green, deploy the new reader:

   ```bash
   firebase deploy \
     --project career-copilot-a3168 \
     --only functions:apiPlatformGetUsage
   ```

7. Send one controlled successful partner request and one controlled 4xx
   request. Wait for both retained log documents to show `summary_version=1`,
   then verify the dashboard's UTC-day and UTC-month deltas are `requests=2`
   and `errors=1`. Record aggregate results only in the change ticket.

The reader fails closed with `failed-precondition` until the guarded script has
written `api_usage_summary_state/rollout_v1`. If the trigger reports an invalid
log, the migration leaves the checkpoint unready: stop, reconcile the malformed
record under the approved data-repair process, and rerun the migration. Do not
deploy `apiPlatformGetUsage`, manually increment summary shards, clear summary
markers, or expose log identifiers in tickets. The trigger must remain deployed
for all future `publicApi` traffic.

Every shard carries an `expires_at` value 120 days after the end of its UTC day
or month. Platform Operations owns the `api_usage_summary_shards.expires_at`
Firestore TTL policy and a quarterly residue check. Confirm that policy is
active before deploying the reader; otherwise the summary collection will grow
by as many as 32 day shards per day plus 32 month shards per month indefinitely.
TTL deletion is eventual, so the residue check should allow the documented
Firestore TTL processing delay and escalate shards materially past retention.

### Deploy strict Rules and Storage only after migrations

At this point the query indexes are ready, both guarded backfills have passed a
second no-change run, all five TTL policies are active, and the summary reader has
been deployed and checked. Run a dry run for the remaining strict resources;
do not include `firestore:indexes` here because its two-phase rollout is already
complete:

```bash
firebase deploy --dry-run \
  --project career-copilot-a3168 \
  --only firestore:rules,storage
```

Then deploy:

```bash
firebase deploy \
  --project career-copilot-a3168 \
  --only firestore:rules,storage
```

If either migration checkpoint, TTL policy, or required composite index is not
green, stop and keep the previous rules in place. TTL deletion is eventual
rather than immediate; the retention checks below must allow the documented
processing delay.

For a production database, decide whether to enable delete protection and point-in-time recovery. Both can affect operating cost and recovery procedures:

```bash
firebase firestore:databases:update '(default)' \
  --project career-copilot-a3168 \
  --delete-protection ENABLED \
  --point-in-time-recovery ENABLED
```

### Cloud Functions

This production project still contains legacy per-tool Functions that are not exported by the current source tree. Do not run a forced, untargeted Functions deployment. It can offer to delete those functions.

Review the production table without dumping environment variables:

```bash
firebase functions:list --project career-copilot-a3168
```

The change record owner creates one reviewed, sorted ASCII export name per line
in `REVIEWED_FUNCTION_TARGETS`. Include every Function importing a changed shared
module. The release operator validates that list against the compiled index,
seals it as the single source for the deploy command, and records its hash:

This launch requires `processCreditRefundReviews` as its own line in `REVIEWED_FUNCTION_TARGETS`.
It is a new scheduled compensation worker; omitting it would leave failed inline
credit refunds pending without automatic recovery.

```bash
ROOT=/var/www/uottawa-copilot
APPROVED_SHA=REPLACE_WITH_REVIEWED_40_CHARACTER_SHA
REVIEWED_FUNCTION_TARGETS=/absolute/path/from-change-record/functions.targets
FUNCTION_EVIDENCE_BASE=/var/lib/career-copilot-releases/functions

sudo flock -n /run/lock/career-copilot-release.lock \
  bash -s -- "$ROOT" "$APPROVED_SHA" "$REVIEWED_FUNCTION_TARGETS" \
  "$FUNCTION_EVIDENCE_BASE" <<'DEPLOY_FUNCTIONS'
set -Eeuo pipefail
ROOT=$1
APPROVED_SHA=$2
REVIEWED_FUNCTION_TARGETS=$3
FUNCTION_EVIDENCE_BASE=$4
test "${#APPROVED_SHA}" = 40
case "$APPROVED_SHA" in *[!0-9a-f]*) exit 1 ;; esac
FUNCTION_EVIDENCE_DIR="$FUNCTION_EVIDENCE_BASE/$APPROVED_SHA"
FUNCTION_TARGETS_FILE="$FUNCTION_EVIDENCE_DIR/functions.targets"
test ! -e "$FUNCTION_EVIDENCE_DIR"
test -s "$REVIEWED_FUNCTION_TARGETS"
grep -Fxq 'processCreditRefundReviews' "$REVIEWED_FUNCTION_TARGETS"
test "$(sudo -u copilot-deploy -H git -C "$ROOT" branch --show-current)" = main
test "$(sudo -u copilot-deploy -H git -C "$ROOT" rev-parse HEAD)" = "$APPROVED_SHA"
test -z "$(sudo -u copilot-deploy -H git -C "$ROOT" status --porcelain --untracked-files=all)"

# Root seals the reviewed list for the fixed deployment identity. That same
# identity builds, validates, deploys, and later reads the list during rollback.
install -d -m 0750 -o root -g copilot-deploy "$FUNCTION_EVIDENCE_DIR"
install -m 0440 -o root -g copilot-deploy \
  "$REVIEWED_FUNCTION_TARGETS" "$FUNCTION_TARGETS_FILE"
sha256sum "$FUNCTION_TARGETS_FILE" >"$FUNCTION_EVIDENCE_DIR/functions.targets.sha256"
chown root:copilot-deploy "$FUNCTION_EVIDENCE_DIR/functions.targets.sha256"
chmod 0440 "$FUNCTION_EVIDENCE_DIR/functions.targets.sha256"

sudo -u copilot-deploy -H bash -s -- \
  "$ROOT" "$FUNCTION_TARGETS_FILE" "$APPROVED_SHA" <<'DEPLOY_SEALED_FUNCTIONS'
set -Eeuo pipefail
ROOT=$1
FUNCTION_TARGETS_FILE=$2
APPROVED_SHA=$3
cd "$ROOT"
npm --prefix functions ci
npm --prefix functions run build
FUNCTION_ONLY=$(node scripts/validate-function-targets.mjs \
  --targets="$FUNCTION_TARGETS_FILE" --format=firebase)
test -n "$FUNCTION_ONLY"
firebase deploy --project career-copilot-a3168 --only "$FUNCTION_ONLY"
test "$(git rev-parse HEAD)" = "$APPROVED_SHA"
test -z "$(git status --porcelain --untracked-files=all)"
DEPLOY_SEALED_FUNCTIONS
DEPLOY_FUNCTIONS
```

The review owner supplies `REVIEWED_FUNCTION_TARGETS`; the validator proves each
entry exists in `functions/lib/index.js`; the sealed file and SHA prove what was
deployed; and rollback reads that same file. If a new Function does not exist in
the known-good commit, rollback requires an explicit delete/compatibility plan
rather than silently dropping it from the list.

Confirm the selected functions are active:

```bash
gcloud functions list --v2 \
  --regions=us-central1 \
  --project=career-copilot-a3168 \
  --format='table(name.basename(),updateTime,state,buildConfig.runtime)'
```

For this launch, retain the filtered row as evidence and require its state to be
`ACTIVE` before creating a recovery fixture:

```bash
gcloud functions list --v2 \
  --regions=us-central1 \
  --project=career-copilot-a3168 \
  --filter='name:processCreditRefundReviews' \
  --format='table(name.basename(),updateTime,state,buildConfig.runtime)'
```

Avoid `firebase functions:list --json` in shared logs. The raw output can include ordinary runtime environment variables.

### Reconcile current-day usage counters before enabling credit caps

The new refund path keeps each failed request as a metered abuse-control attempt
but removes its settled refund from net credit spend. Refunds created by an older
revision may already have `refund_status=refunded` while the derived current-day
`usage_counters.credits` still contains gross spend. Replaying those refunds is
not a migration: the source event correctly returns duplicate and must not issue
another balance or ledger change.

Before any global, per-user, or per-plan daily credit cap becomes nonzero, use an
operator-reviewed absolute recomputation for the current UTC day:

- `runs` is the count of source events with `status in [deducted, free]`;
- `credits` is the sum of `credit_cost` where `status == deducted` and
  `refund_status != refunded`;
- write the exact global and per-user derived totals without changing balances,
  ledgers, or source events;
- preserve aggregate-only evidence and require a second no-change verification.

Do not replay relative decrements from historical refund events. If no reviewed
absolute rebuild operation is available, keep all daily credit caps at `0`
through the next complete UTC day after the new Functions revision is active,
then enable them from the naturally clean day. Daily run caps can remain enabled
because refunded attempts intentionally continue to consume one attempt slot.

An invalid source day or a counter smaller than the refund amount must never
erase spend belonging to other requests. The refund still restores the user's
balance, preserves the restrictive counter, and writes a deterministic
`usage_counter_reconciliation_reviews/{usageEventId}` record. The Admin dashboard
shows unresolved records. Before relying on credit counters, require every review
to be resolved by an absolute source-event recomputation and a second no-change
run; replaying the already-completed refund is not remediation.

Finally, refunded failures do not consume credits, so credits alone cannot bound
provider abuse. The server therefore always enforces hard ceilings of 10,000
platform attempts and 500 attempts per user per UTC day, even when configurable
quotas are off or `0`. These are last-resort cost-containment boundaries, not the
launch capacity plan. Before enabling a live provider, configure a stricter
nonzero global `daily_tool_run_limit` and a stricter nonzero per-plan
`daily_run_limit` for every eligible live plan and record the expected load
rationale.

## 10. Prepare the VM

### DNS

Create an A record:

```text
copilot.example.com -> VM_PUBLIC_IPV4
```

Wait until it resolves from outside the VM:

```bash
dig +short copilot.example.com
```

### Repository

Keep deployment and runtime identities separate. `copilot-deploy` owns the
repository and release directories; `copilot` can only read the published
runtime files. Neither identity has an interactive login shell:

```bash
sudo useradd --system --no-create-home \
  --home-dir /var/www/uottawa-copilot \
  --shell /usr/sbin/nologin \
  copilot
sudo useradd --system --create-home \
  --home-dir /var/lib/career-copilot-deploy \
  --shell /usr/sbin/nologin \
  copilot-deploy
sudo install -d -o copilot-deploy -g copilot-deploy \
  /var/www/uottawa-copilot \
  /var/cache/career-copilot-npm
sudo chown copilot-deploy:copilot-deploy /var/cache/career-copilot-npm
sudo install -d -m 0700 -o copilot-deploy -g copilot-deploy \
  /var/lib/career-copilot-releases
sudo install -d -m 0755 -o root -g root \
  /var/lib/career-copilot-artifacts
```

Provision a read-only GitHub deploy key and a pinned `known_hosts` entry under
`/var/lib/career-copilot-deploy/.ssh` using the team's secret-management
procedure. Do not paste a private key into this runbook or a shell transcript.
Then clone and install only as the deployment identity:

```bash
sudo -u copilot-deploy -H env \
  NPM_CONFIG_CACHE=/var/cache/career-copilot-npm \
  git clone --branch main \
  git@github.com:abhishek-ip/Career-CoPilot-uOttawa.git \
  /var/www/uottawa-copilot
sudo -u copilot-deploy -H env \
  NPM_CONFIG_CACHE=/var/cache/career-copilot-npm \
  npm --prefix /var/www/uottawa-copilot ci
sudo -u copilot-deploy -H env \
  NPM_CONFIG_CACHE=/var/cache/career-copilot-npm \
  npm --prefix /var/www/uottawa-copilot/functions ci

test "$(stat -c '%U:%G' /var/www/uottawa-copilot)" = \
  'copilot-deploy:copilot-deploy'
sudo -u copilot test -r /var/www/uottawa-copilot/static-server.mjs
```

Create `/var/www/uottawa-copilot/.env.local`, set only the public frontend values from [Configure the frontend](#4-configure-the-frontend), and apply:

```bash
sudo chown copilot-deploy:copilot-deploy /var/www/uottawa-copilot/.env.local
sudo chmod 600 /var/www/uottawa-copilot/.env.local
```

### systemd service

Create `/etc/systemd/system/uottawa-copilot.service`:

```ini
[Unit]
Description=Career CoPilot static SPA on port 9050
After=network.target

[Service]
Type=simple
WorkingDirectory=/var/www/uottawa-copilot
Environment=PORT=9050
Environment=HOST=127.0.0.1
ExecStart=/usr/bin/node /var/www/uottawa-copilot/static-server.mjs
Restart=on-failure
RestartSec=3
User=copilot
Group=copilot
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

The checked-in `static-server.mjs` serves hashed assets with long-lived caching, serves other files with `no-cache`, and falls back to `index.html` for client-side routes.

Load the service, but leave it stopped until the first staged artifact passes
the procedure in section 12:

```bash
sudo systemctl daemon-reload
sudo systemctl enable uottawa-copilot.service
test "$(systemctl is-active uottawa-copilot.service || true)" = inactive
```

Do not run Git, npm, stage creation, or artifact moves as root or as the runtime
identity. Root is used only for host configuration and service control.

## 11. Configure nginx and TLS

Create `/etc/nginx/sites-available/uottawa-copilot`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name copilot.example.com;

    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:9050;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable and test it:

```bash
sudo ln -s /etc/nginx/sites-available/uottawa-copilot /etc/nginx/sites-enabled/uottawa-copilot
sudo nginx -t
sudo systemctl reload nginx
```

Issue and install the certificate:

```bash
sudo certbot --nginx -d copilot.example.com
sudo certbot renew --dry-run
```

Allow only the expected public ports:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Port 9050 stays bound to `127.0.0.1`; it should not be exposed by the firewall or cloud security group.

## 12. Build, test, and publish one frontend artifact

Do not build directly over the live `dist/` directory. A browser can request a
new `index.html` while old assets are being deleted, causing a temporary blank
page. Build once into a unique stage, run the full source/emulator/browser gate
against that stage, record commit/lockfile/environment/gate/artifact hashes,
and atomically replace a `dist` symlink with a symlink to that exact immutable
artifact. `static-server.mjs` follows the symlink on each file read.

An older VM may still have a real `dist/` directory. Convert it once during a
planned maintenance window before using the normal release procedure. This is
the only non-atomic legacy transition; the service is stopped throughout it:

```bash
ROOT=/var/www/uottawa-copilot
ARTIFACT_ROOT=/var/lib/career-copilot-artifacts

sudo flock -n /run/lock/career-copilot-release.lock \
  bash -s -- "$ROOT" "$ARTIFACT_ROOT" <<'LEGACY_CONVERSION'
set -Eeuo pipefail
ROOT=$1
ARTIFACT_ROOT=$2

if test -d "$ROOT/dist" && ! test -L "$ROOT/dist"; then
  LEGACY_STAMP="legacy-$(date -u +%Y%m%dT%H%M%SZ)"
  LEGACY="$ARTIFACT_ROOT/$LEGACY_STAMP"
  EVIDENCE="/var/lib/career-copilot-releases/$LEGACY_STAMP"
  WAS_ACTIVE=0
  if sudo systemctl is-active --quiet uottawa-copilot.service; then
    WAS_ACTIVE=1
    sudo systemctl stop uottawa-copilot.service
  fi
  MOVED=0
  restore_legacy_dist() {
    rc=$?
    trap - ERR
    set +e
    if test "$MOVED" = 1; then
      test ! -L "$ROOT/dist" || sudo rm "$ROOT/dist"
      sudo chown -R copilot-deploy:copilot-deploy "$LEGACY"
      sudo chmod -R u+rwX "$LEGACY"
      sudo mv "$LEGACY" "$ROOT/dist"
    fi
    test "$WAS_ACTIVE" = 0 || sudo systemctl start uottawa-copilot.service
    exit "$rc"
  }
  trap restore_legacy_dist ERR
  sudo mv "$ROOT/dist" "$LEGACY"
  MOVED=1
  sudo -u copilot-deploy mkdir -m 0700 "$EVIDENCE"
  sudo -u copilot-deploy -H bash -c '
    cd "$1"
    find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum >"$2"
  ' _ "$LEGACY" "$EVIDENCE/artifact.sha256"
  sudo chown -R root:copilot "$LEGACY"
  sudo find "$LEGACY" -type d -exec chmod 0555 {} +
  sudo find "$LEGACY" -type f -exec chmod 0444 {} +
  sudo -u copilot-deploy ln -s "$LEGACY" "$ROOT/dist"
  sudo -u copilot test -r "$ROOT/dist/index.html"
  test "$WAS_ACTIVE" = 0 || sudo systemctl start uottawa-copilot.service
  trap - ERR
fi

test ! -e "$ROOT/dist" || test -L "$ROOT/dist"
LEGACY_CONVERSION
```

From the repository root:

```bash
ROOT=/var/www/uottawa-copilot
ARTIFACT_ROOT=/var/lib/career-copilot-artifacts
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
APPROVED_SHA=REPLACE_WITH_REVIEWED_MAIN_COMMIT
STRIPE_LIVE_EVIDENCE=/var/lib/career-copilot-releases/stripe-live/$APPROVED_SHA.json
STRIPE_WEBHOOK_EVIDENCE=/var/lib/career-copilot-releases/stripe-webhook/$APPROVED_SHA/evidence.json

# One root-owned lock covers build, promotion, restart, production smoke, and
# any automatic rollback. Git/npm/build operations still run as copilot-deploy;
# root only creates/seals the immutable stage and controls the service.
sudo flock -n /run/lock/career-copilot-release.lock \
  bash -s -- "$ROOT" "$ARTIFACT_ROOT" "$STAMP" "$APPROVED_SHA" \
  "$STRIPE_LIVE_EVIDENCE" "$STRIPE_WEBHOOK_EVIDENCE" <<'PUBLISH'
set -Eeuo pipefail
ROOT=$1
ARTIFACT_ROOT=$2
STAMP=$3
APPROVED_SHA=$4
STRIPE_LIVE_EVIDENCE=$5
STRIPE_WEBHOOK_EVIDENCE=$6
STAGE="$ARTIFACT_ROOT/$STAMP"
EVIDENCE="/var/lib/career-copilot-releases/$STAMP"
FILES="$EVIDENCE/artifact.sha256"
META="$EVIDENCE/release.meta"
PREVIOUS=$(readlink -f "$ROOT/dist" 2>/dev/null || true)

test "${#APPROVED_SHA}" = 40
case "$APPROVED_SHA" in *[!0-9a-f]*) exit 1 ;; esac
test -s "$STRIPE_LIVE_EVIDENCE"
test "$(stat -c '%U:%G' "$STRIPE_LIVE_EVIDENCE")" = 'root:copilot-deploy'
test "$(stat -c '%a' "$STRIPE_LIVE_EVIDENCE")" = 440
test -s "$STRIPE_WEBHOOK_EVIDENCE"
test "$(stat -c '%U:%G' "$STRIPE_WEBHOOK_EVIDENCE")" = 'root:copilot-deploy'
test "$(stat -c '%a' "$STRIPE_WEBHOOK_EVIDENCE")" = 440
WEBHOOK_EVIDENCE_DIR=$(dirname "$STRIPE_WEBHOOK_EVIDENCE")
for artifact in workbench-deliveries.artifact firestore-ledger.artifact; do
  test -s "$WEBHOOK_EVIDENCE_DIR/$artifact"
  test "$(stat -c '%U:%G' "$WEBHOOK_EVIDENCE_DIR/$artifact")" = 'root:copilot-deploy'
  test "$(stat -c '%a' "$WEBHOOK_EVIDENCE_DIR/$artifact")" = 440
done
test -z "$(sudo -u copilot-deploy -H git -C "$ROOT" status --porcelain)"
sudo -u copilot-deploy -H git -C "$ROOT" fetch origin main
test "$(sudo -u copilot-deploy -H git -C "$ROOT" rev-parse origin/main)" = "$APPROVED_SHA"
sudo -u copilot-deploy -H git -C "$ROOT" checkout main
sudo -u copilot-deploy -H git -C "$ROOT" merge --ff-only "$APPROVED_SHA"
test "$(sudo -u copilot-deploy -H git -C "$ROOT" rev-parse HEAD)" = "$APPROVED_SHA"
test -z "$(sudo -u copilot-deploy -H git -C "$ROOT" status --porcelain)"

sudo -u copilot-deploy mkdir -m 0700 "$EVIDENCE"
sudo install -d -m 0750 -o copilot-deploy -g copilot-deploy "$STAGE"
sudo -u copilot-deploy -H env -i \
  HOME=/var/lib/career-copilot-deploy \
  USER=copilot-deploy \
  LOGNAME=copilot-deploy \
  PATH=/usr/local/bin:/usr/bin:/bin \
  LANG=C.UTF-8 \
  CI=1 \
  STRIPE_LIVE_EVIDENCE="$STRIPE_LIVE_EVIDENCE" \
  STRIPE_WEBHOOK_EVIDENCE="$STRIPE_WEBHOOK_EVIDENCE" \
  NPM_CONFIG_CACHE=/var/cache/career-copilot-npm \
  bash -s -- "$ROOT" "$STAGE" "$FILES" "$META" "$STAMP" "$PREVIOUS" "$APPROVED_SHA" <<'BUILD'
set -Eeuo pipefail
ROOT=$1
STAGE=$2
FILES=$3
META=$4
STAMP=$5
PREVIOUS=$6
APPROVED_SHA=$7
cd "$ROOT"

test "$(git branch --show-current)" = main
test "$(git rev-parse HEAD)" = "$APPROVED_SHA"
test "$(git rev-parse origin/main)" = "$APPROVED_SHA"
test -z "$(git status --porcelain --untracked-files=all)"
test -s .env.local
test ! -e .env
test ! -e .env.production
test ! -e .env.production.local
test ! -e dist || test -L dist

npm ci
npm --prefix functions ci
npm run build -- --outDir "$STAGE"
E2E_STAGE_DIR="$STAGE" \
  RELEASE_GATE_RESULTS="$(dirname "$META")" \
  RELEASE_APPROVED_SHA="$APPROVED_SHA" \
  npm run gate:release
test -z "$(git status --porcelain --untracked-files=all)"
test "$(git rev-parse HEAD)" = "$APPROVED_SHA"

test -s "$STAGE/index.html"
ENTRY=$(sed -n 's/.*src="\/\(assets\/index-[^"]*\.js\)".*/\1/p' "$STAGE/index.html")
test -n "$ENTRY"
test -s "$STAGE/$ENTRY"

(
  cd "$STAGE"
  find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum
) >"$FILES"
{
  printf 'commit=%s\n' "$APPROVED_SHA"
  printf 'package_lock_sha256=%s\n' \
    "$(sha256sum package-lock.json | awk '{print $1}')"
  printf 'functions_lock_sha256=%s\n' \
    "$(sha256sum functions/package-lock.json | awk '{print $1}')"
  printf 'frontend_env_sha256=%s\n' \
    "$(sha256sum .env.local | awk '{print $1}')"
  printf 'artifact_manifest_sha256=%s\n' \
    "$(sha256sum "$FILES" | awk '{print $1}')"
  printf 'release_gate_result_sha256=%s\n' \
    "$(sha256sum "$(dirname "$META")/release-gate-all.json" | awk '{print $1}')"
  printf 'release_gate_log_sha256=%s\n' \
    "$(sha256sum "$(dirname "$META")/release-gate-all.log" | awk '{print $1}')"
  printf 'stripe_live_evidence_sha256=%s\n' \
    "$(sha256sum "$STRIPE_LIVE_EVIDENCE" | awk '{print $1}')"
  printf 'stripe_webhook_evidence_sha256=%s\n' \
    "$(sha256sum "$STRIPE_WEBHOOK_EVIDENCE" | awk '{print $1}')"
  printf 'node_version=%s\n' "$(node --version)"
  printf 'npm_version=%s\n' "$(npm --version)"
  printf 'vite_version=%s\n' "$(node -p \"require('./node_modules/vite/package.json').version\")"
  printf 'os_release_sha256=%s\n' \
    "$(sha256sum /etc/os-release | awk '{print $1}')"
  printf 'previous_artifact=%s\n' "$PREVIOUS"
} >"$META"

# Prove the immutable stage matches its manifest before it can become live.
(
  cd "$STAGE"
  sha256sum -c "$FILES"
)
BUILD

# Root seals the accepted artifact; deploy/runtime identities cannot edit it.
sudo chown -R root:copilot "$STAGE"
sudo find "$STAGE" -type d -exec chmod 0555 {} +
sudo find "$STAGE" -type f -exec chmod 0444 {} +

# Prove the restricted runtime identity can traverse and read every staged file.
UNREADABLE=$(sudo -u copilot find "$STAGE" -type f ! -readable -print -quit)
test -z "$UNREADABLE"
sudo -u copilot test -r "$STAGE/index.html"
test "$(stat -c '%U:%G' "$STAGE")" = 'root:copilot'

NEXT="$ROOT/dist.new"
PROMOTED=0
rollback_on_error() {
  rc=$?
  trap - ERR
  set +e
  if test "$PROMOTED" = 1; then
    PREVIOUS_FILES="/var/lib/career-copilot-releases/$(basename "$PREVIOUS")/artifact.sha256"
    if test -n "$PREVIOUS" && test -s "$PREVIOUS/index.html" && \
       test -s "$PREVIOUS_FILES" && \
       sudo -u copilot-deploy -H bash -c \
         'cd "$1" && sha256sum -c "$2"' _ "$PREVIOUS" "$PREVIOUS_FILES"; then
      test ! -L "$NEXT" || sudo -u copilot-deploy rm "$NEXT"
      sudo -u copilot-deploy ln -s "$PREVIOUS" "$NEXT"
      sudo -u copilot-deploy mv -Tf "$NEXT" "$ROOT/dist"
      if ! sudo systemctl restart uottawa-copilot.service; then
        echo 'ROLLBACK_FAILED: previous artifact restored but service restart failed' >&2
        sudo systemctl stop uottawa-copilot.service
      fi
    else
      echo 'ROLLBACK_FAILED: previous artifact or manifest is invalid; service stopped' >&2
      sudo systemctl stop uottawa-copilot.service
    fi
  elif test -L "$NEXT"; then
    sudo -u copilot-deploy rm "$NEXT"
  fi
  exit "$rc"
}
trap rollback_on_error ERR

test ! -e "$NEXT" && test ! -L "$NEXT"
sudo -u copilot-deploy ln -s "$STAGE" "$NEXT"
sudo -u copilot-deploy mv -Tf "$NEXT" "$ROOT/dist"
PROMOTED=1
test "$(readlink -f "$ROOT/dist")" = "$STAGE"
sudo -u copilot-deploy -H bash -c \
  'cd "$1" && sha256sum -c "$2"' _ "$ROOT/dist" "$FILES"
sudo -u copilot test -r "$ROOT/dist/index.html"
sudo systemctl restart uottawa-copilot.service

curl --fail --silent --show-error \
  --retry 4 --retry-all-errors --retry-delay 1 \
  https://copilot.example.com/ >/dev/null

trap - ERR
echo "Release metadata: $META"
echo "Artifact manifest: $FILES"
echo "Previous artifact: $PREVIOUS"
PUBLISH
```

The retry is intentional. nginx can return one brief 502 while systemd replaces the Node process.

The same staged directory is the artifact that passed Playwright route, runtime,
resource, responsive-layout, and exact-copy checks before hash verification and
promotion. `release.meta` binds the artifact manifest to the redacted gate log
and structured gate result for the approved SHA. Evidence lives outside the Git working tree
under the mode-`0700` `/var/lib/career-copilot-releases/<timestamp>/` directory,
so it cannot make the next clean-tree gate fail. Immutable artifacts live under
`/var/lib/career-copilot-artifacts/`. Keep the current artifact, the newest
known-good previous artifact, and their evidence. Remove older artifacts and
evidence only through the approved retention procedure after the new version
has been observed in production.

## 13. Verify production

### Frontend routes

```bash
for path in / /pricing /employers /sample-report /workspace /privacy.html /robots.txt; do
  curl -sS -o /dev/null -w "$path %{http_code}\n" "https://copilot.example.com$path"
done
```

Expected result: every path returns `200`.

### API authorization boundary

An unauthenticated callable request must not return application data:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H 'content-type: application/json' \
  -d '{"data":{"tool":"convertResumeFormat"}}' \
  'https://us-central1-career-copilot-a3168.cloudfunctions.net/aiProxy'
```

Expected result: `401`.

The public API should also reject a missing API key:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  'https://us-central1-career-copilot-a3168.cloudfunctions.net/publicApi/v1/jobs'
```

Expected result: `401`.

### Service and proxy

```bash
sudo systemctl is-active uottawa-copilot.service
sudo nginx -t
sudo journalctl -u uottawa-copilot.service --since '15 minutes ago' --no-pager
sudo tail -n 100 /var/log/nginx/uottawa-copilot.error.log
```

### Functions logs

Use narrow, non-secret fields for an AI error review:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="aiproxy" AND severity>=ERROR' \
  --project=career-copilot-a3168 \
  --limit=50 \
  --format='table(timestamp,severity,jsonPayload.event,jsonPayload.tool,jsonPayload.errorCode)'
```

### Authenticated smoke test

Use a dedicated QA account with a small credit balance. Check at least:

1. one `aiProxy` structured tool;
2. one Google Search-grounded tool;
3. resume analysis;
4. cover letter generation;
5. headshot generation;
6. Admin Portal model connection test;
7. candidate and employer navigation on a mobile viewport.

Do not use a production customer's account for release testing.

## 14. Roll back

### Frontend rollback

```bash
ROOT=/var/www/uottawa-copilot
ARTIFACT_ROOT=/var/lib/career-copilot-artifacts
GOOD=/var/lib/career-copilot-artifacts/REPLACE_WITH_TIMESTAMP

sudo flock -n /run/lock/career-copilot-release.lock \
  bash -s -- "$ROOT" "$ARTIFACT_ROOT" "$GOOD" <<'ROLLBACK'
set -Eeuo pipefail
ROOT=$1
ARTIFACT_ROOT=$(readlink -f "$2")
GOOD=$(readlink -f "$3")
NEXT="$ROOT/dist.new"
BAD=$(readlink -f "$ROOT/dist")
FILES="/var/lib/career-copilot-releases/$(basename "$GOOD")/artifact.sha256"

case "$GOOD" in "$ARTIFACT_ROOT"/*) ;; *) exit 1 ;; esac
case "$BAD" in "$ARTIFACT_ROOT"/*) ;; *) exit 1 ;; esac
test -n "$BAD"
test "$GOOD" != "$BAD"
test -s "$GOOD/index.html"
test -s "$FILES"
sudo -u copilot-deploy -H bash -c \
  'cd "$1" && sha256sum -c "$2"' _ "$GOOD" "$FILES"
UNREADABLE=$(sudo -u copilot find "$GOOD" -type f ! -readable -print -quit)
test -z "$UNREADABLE"

SWITCHED=0
restore_current() {
  rc=$?
  trap - ERR
  set +e
  if test "$SWITCHED" = 1 && test -s "$BAD/index.html"; then
    test ! -L "$NEXT" || sudo -u copilot-deploy rm "$NEXT"
    sudo -u copilot-deploy ln -s "$BAD" "$NEXT"
    sudo -u copilot-deploy mv -Tf "$NEXT" "$ROOT/dist"
    sudo systemctl restart uottawa-copilot.service
    curl --fail --silent --retry 4 --retry-all-errors \
      https://copilot.example.com/ >/dev/null
  fi
  exit "$rc"
}
trap restore_current ERR

test ! -e "$NEXT" && test ! -L "$NEXT"
sudo -u copilot-deploy ln -s "$GOOD" "$NEXT"
sudo -u copilot-deploy mv -Tf "$NEXT" "$ROOT/dist"
SWITCHED=1
test "$(readlink -f "$ROOT/dist")" = "$GOOD"
sudo -u copilot test -r "$ROOT/dist/index.html"
sudo systemctl restart uottawa-copilot.service
curl --fail --silent --show-error \
  --retry 4 --retry-all-errors --retry-delay 1 \
  https://copilot.example.com/ >/dev/null

trap - ERR
echo "Rolled back from: $BAD"
ROLLBACK
```

### Billing and credit compensation queues

Every completed paid Checkout that cannot be fulfilled is written to the
server-only deterministic record
`billing_fulfillment_reviews/{checkoutSessionId}`. Alert on
`status == "pending" && operator_action_required == true`. The record retains
only the provider/account references needed to reconcile the payment. Resolve it
only after an authorized operator has refunded or cancelled the Stripe object,
reconciled the local billing/credit state, attached the change record, and set
`status="resolved"`, `operator_action_required=false`, and a specific
`resolution`. A webhook replay increments `attempts` but never reopens a resolved
record.

AI refunds that cannot commit inline are written to
`credit_refund_reviews/{usageEventId}`. The scheduled
`processCreditRefundReviews` Function retries a bounded page every 10 minutes and
uses the source usage event as the idempotency authority. Alert immediately on
`manual_review` or `failed_permanent`; inspect `last_error_code`, repair the
source account/event under a change record, and prove the balance/ledger changed
at most once. Also alert when a `pending` record is older than 20 minutes or when
the `Credit refund recovery batch complete` success heartbeat is absent for 20
minutes. After deployment, leave one non-customer recovery fixture pending and
require the scheduler to resolve it exactly once within 20 minutes without direct
batch invocation. These collections are server-only and must not be edited from
a browser client.

### Functions rollback

Cloud Functions revisions are managed by Google Cloud. Roll back only from a
reviewed release record that contains the exact non-empty Function target list
used by the failed release. Do not replace that list with a copied example or
silently deploy only two handlers when a shared module changed.

```bash
ROOT=/var/www/uottawa-copilot
WORKTREE_ROOT=/var/lib/career-copilot-worktrees
KNOWN_GOOD_SHA=REPLACE_WITH_REVIEWED_40_CHARACTER_SHA
FAILED_RELEASE_SHA=REPLACE_WITH_FAILED_40_CHARACTER_SHA
FUNCTION_EVIDENCE_BASE=/var/lib/career-copilot-releases/functions

sudo flock -n /run/lock/career-copilot-release.lock \
  bash -s -- "$ROOT" "$WORKTREE_ROOT" "$KNOWN_GOOD_SHA" \
  "$FAILED_RELEASE_SHA" "$FUNCTION_EVIDENCE_BASE" <<'FUNCTION_ROLLBACK'
set -Eeuo pipefail
ROOT=$1
WORKTREE_ROOT=$2
KNOWN_GOOD_SHA=$3
FAILED_RELEASE_SHA=$4
FUNCTION_EVIDENCE_BASE=$5
test "${#KNOWN_GOOD_SHA}" = 40
case "$KNOWN_GOOD_SHA" in *[!0-9a-f]*) exit 1 ;; esac
test "${#FAILED_RELEASE_SHA}" = 40
case "$FAILED_RELEASE_SHA" in *[!0-9a-f]*) exit 1 ;; esac
FUNCTION_EVIDENCE_DIR="$FUNCTION_EVIDENCE_BASE/$FAILED_RELEASE_SHA"
FUNCTION_TARGETS_FILE="$FUNCTION_EVIDENCE_DIR/functions.targets"
WORKTREE="$WORKTREE_ROOT/functions-rollback-$KNOWN_GOOD_SHA"
PRIMARY_HEAD=$(sudo -u copilot-deploy -H git -C "$ROOT" rev-parse HEAD)
PRIMARY_BRANCH=$(sudo -u copilot-deploy -H git -C "$ROOT" branch --show-current)

test -s "$FUNCTION_TARGETS_FILE"
sha256sum -c "$FUNCTION_EVIDENCE_DIR/functions.targets.sha256"
test "$PRIMARY_BRANCH" = main
test -z "$(sudo -u copilot-deploy -H git -C "$ROOT" status --porcelain --untracked-files=all)"
sudo -u copilot-deploy -H git -C "$ROOT" cat-file -e "$KNOWN_GOOD_SHA^{commit}"
test ! -e "$WORKTREE"
sudo install -d -m 0750 -o copilot-deploy -g copilot-deploy "$WORKTREE_ROOT"

cleanup_worktree() {
  sudo -u copilot-deploy -H git -C "$ROOT" \
    worktree remove --force "$WORKTREE" >/dev/null 2>&1 || true
}
trap cleanup_worktree EXIT
sudo -u copilot-deploy -H git -C "$ROOT" \
  worktree add --detach "$WORKTREE" "$KNOWN_GOOD_SHA"
test "$(sudo -u copilot-deploy -H git -C "$WORKTREE" rev-parse HEAD)" = "$KNOWN_GOOD_SHA"

# The production Functions dotenv contains identifiers only; secrets remain in
# Secret Manager. Copy it into the isolated worktree for the source gate.
test -s "$ROOT/functions/.env.career-copilot-a3168"
sudo -u copilot-deploy install -m 0600 \
  "$ROOT/functions/.env.career-copilot-a3168" \
  "$WORKTREE/functions/.env.career-copilot-a3168"

sudo -u copilot-deploy -H bash -s -- \
  "$WORKTREE" "$FUNCTION_TARGETS_FILE" "$KNOWN_GOOD_SHA" <<'DEPLOY_FUNCTION_ROLLBACK'
set -Eeuo pipefail
WORKTREE=$1
FUNCTION_TARGETS_FILE=$2
KNOWN_GOOD_SHA=$3
cd "$WORKTREE"
npm ci
npm --prefix functions ci
npm run gate:release:source
npm run gate:release:emulator
FUNCTION_TARGETS=$(node scripts/validate-function-targets.mjs \
  --targets="$FUNCTION_TARGETS_FILE" --format=firebase)
test -n "$FUNCTION_TARGETS"
firebase deploy --project career-copilot-a3168 --only "$FUNCTION_TARGETS"
test "$(git rev-parse HEAD)" = "$KNOWN_GOOD_SHA"
test -z "$(git status --porcelain --untracked-files=all)"
DEPLOY_FUNCTION_ROLLBACK

cleanup_worktree
trap - EXIT
test ! -e "$WORKTREE"
test "$(sudo -u copilot-deploy -H git -C "$ROOT" rev-parse HEAD)" = "$PRIMARY_HEAD"
test "$(sudo -u copilot-deploy -H git -C "$ROOT" branch --show-current)" = "$PRIMARY_BRANCH"
test -z "$(sudo -u copilot-deploy -H git -C "$ROOT" status --porcelain --untracked-files=all)"
FUNCTION_ROLLBACK
```

Do not roll back Firestore rules independently from code unless the old rules remain compatible with all documents written by the current release.

### Secret rollback

Secret Manager keeps versions. Disable a compromised version only after the replacement secret has been set and every function that binds it has been redeployed.

## 15. Routine releases

### Promote `dev` to `main`

`main` is the production branch. Keep promotion fast-forward-only:

```bash
git checkout dev
git pull --ff-only upstream dev

npm ci
npm --prefix functions ci
npm run gate:release:source

# Before merging, require the GitHub Actions `release-gate` check for this exact
# dev SHA; it aggregates source, emulator, and built-artifact browser jobs.
DEV_SHA=$(git rev-parse HEAD)
test -n "$DEV_SHA"

git checkout main
git pull --ff-only upstream main
git merge --ff-only dev
git push upstream main
```

This local command is a source preflight, not the complete acceptance result or
the production artifact build. Prefer branch protection that requires CI's final
`release-gate` status for `DEV_SHA`. If the private-repository plan cannot enforce
that rule, the change record must instead capture the exact SHA, successful
aggregate run URL, and two-person approval before merge; a green job for another
SHA is never acceptable. This manual control is an explicit plan limitation, not
evidence that branch protection exists. Section 12 is the only place the
deployable frontend artifact is built.

If `git merge --ff-only dev` fails, stop and inspect the branch graph. Do not force-push `main` to hide a divergence.

### Point the VM auto-deployer at `main`

The old optional VM timer referenced an unmanaged
`/usr/local/bin/uottawa-copilot-autodeploy.sh`. Keep that timer disabled: the
script and its unit files are not reviewed artifacts in this repository, and an
unattended rebuild cannot currently prove that it promotes the same tested
stage. If automated deployment is added later, check in the script and units,
run them as `copilot-deploy`, and make them execute the complete section 12
gate. A VM originally set up to track `dev` must still correct its fetch refspec:

The VM's `origin` name is intentional and local to that production clone: the
clone command above points it directly at the team repository. Developer clones
use the project-level `upstream` convention from `AGENTS.md`; do not copy the
VM's remote naming back into workstation release commands.

1. set `BRANCH=main` in the script;
2. update the systemd service and timer descriptions so they no longer say `origin/dev`;
3. replace a dev-only fetch refspec with a main refspec:

```bash
sudo -u copilot-deploy -H git -C /var/www/uottawa-copilot \
  config --unset-all remote.origin.fetch
sudo -u copilot-deploy -H git -C /var/www/uottawa-copilot \
  config --add remote.origin.fetch '+refs/heads/main:refs/remotes/origin/main'
sudo -u copilot-deploy -H git -C /var/www/uottawa-copilot fetch origin main
```

Confirm the source clone is correctly pinned, while leaving the unmanaged timer
disabled:

```bash
sudo -u copilot-deploy -H bash -c '
  cd /var/www/uottawa-copilot
  test "$(git branch --show-current)" = main
  test -z "$(git status --porcelain --untracked-files=all)"
  git merge-base --is-ancestor HEAD origin/main
'
sudo systemctl daemon-reload
sudo systemctl disable --now uottawa-copilot-autodeploy.timer 2>/dev/null || true
```

Do not enable an automatic release until its checked-in implementation passes
the same build-once, stage-smoke, manifest, ownership, and rollback gates.

### Backend release

Use the single compatibility sequence in
[Deploy Firebase resources](#9-deploy-firebase-resources): stage missing
query-only composite indexes and wait for `READY`; deploy the explicitly
reviewed compatibility Functions; complete the BYOA and both API-usage guarded
backfills with second no-change runs; upload the full index/TTL configuration;
deploy and verify the summary reader; and only then deploy strict Firestore
Rules and Storage Rules. Never substitute a rules-first bulk command for that
sequence. Derive and record the explicit changed-Function target list from the
release diff instead of using a bare `--only functions` deployment.

### VM frontend release

Copy the reviewed 40-character `main` commit from the approved change record
into `APPROVED_SHA`, then run
[Build, test, and publish one frontend artifact](#12-build-test-and-publish-one-frontend-artifact).
That locked transaction performs the fetch and fast-forward, proves
`HEAD == origin/main == APPROVED_SHA`, and rejects a dirty tree before and after
the gate. Do not run a separate `git pull` while a release may be active.

## Customer-launch gates and production hardening

Transactional email is a customer-launch requirement because verification,
password reset, and workflow notification delivery are core account paths. Use
the separate Auth-mail and workflow-mail matrices in
[Email deliverability and release gate](../email-deliverability.md); an installed
Trigger Email extension does not prove Firebase Auth verification/reset delivery.
The remaining hardening items must be explicit launch decisions, with an owner
and accepted risk recorded for anything deferred:

- enable Firestore delete protection;
- enable Firestore point-in-time recovery if the plan and region support it;
- configure budget alerts for Cloud Functions, Cloud Run, Firestore, Storage, Gemini, and Stripe;
- route pending Stripe-fulfillment and manual/permanent credit-refund reviews to
  a named billing operator with an on-call SLA;
- complete the business-role provenance audit and independently review every
  organization before displaying a verified identity signal;
- **Auth mail:** verify the canonical action domain, Firebase Auth templates,
  authorized domains, expiry/reuse, and real verification/reset delivery across
  the required mailbox matrix;
- **workflow mail:** install and configure the Firebase Trigger Email extension,
  then verify the SMTP sender domain, SPF, DKIM, DMARC, bounce handling, and real
  notification delivery;
- verify the deployed unit runs as `copilot`, while the repository and immutable
  source repository remains owned by `copilot-deploy`; the artifact root and
  sealed release directories must be root-owned and read-only to both deploy and
  runtime identities;
- keep Storage in the intended region (`us-east1` in the current production project) and Functions in their declared regions;
- review the one legacy `us-east1`/generation-1 auth trigger before changing global region or runtime assumptions.

### Account-deletion operator runbook

The product currently has no user self-service deletion flow. `adminDeleteUser`
is an operator-only access-removal workflow: it removes the Firebase Auth user,
deletes both the server-only `private_custom_provider_configs/{uid}` credential
document and any legacy `users/{uid}.custom_provider` field, then removes the
parent `users/{uid}` profile. It is **not** a complete statutory data erasure
workflow.

Before an operator starts deletion:

1. Record the exact Firebase Auth UID and a specific reason. Prefer UID over
   email so a reused email address cannot select the wrong historical account.
2. Remove any `super`, `admin`, or `reviewer` grant through Access Control.
3. Reconcile recurring billing directly in Stripe. Cancel it according to the
   approved billing procedure, wait for the local `billing/{uid}` record to show
   an explicitly closed state, and separately resolve any open Checkout Session.
   Firestore alone cannot prove that no remote Stripe session or subscription is
   still actionable. A delayed successful Checkout webhook can otherwise restore
   local billing entitlement and recreate the deleted profile.
4. Run `adminDeleteUser` once and keep the returned `pending_cleanup` manifest
   with the support/privacy case.

The durable `account_deletion_requests/{uid}` record provides a short lease,
per-step checkpoints, a stable completed result, and retry-by-UID recovery after
a partial failure. A retry returns the recorded result; a concurrent live attempt
is rejected. If Auth or the profile is recreated after an earlier attempt, the
workflow stops for human review instead of deleting the recreated resource.
Credential cleanup is checkpointed as
`private_credentials_delete_api_succeeded` and must complete before the parent
profile is deleted. If that step fails after Auth removal, leave the deletion
request in place and retry with the same UID; the workflow resumes from its
durable checkpoints rather than recreating Auth or skipping the secret scrub.
Legacy completed tombstones that predate this checkpoint are reopened once so
private credentials are still removed. The returned result must record
`deleted_private_credentials: true` before the case is treated as access removal
complete.

The workflow intentionally retains and inventories data whose deletion requires
an approved retention or anonymization policy, including:

- all remaining `users/{uid}` subcollections;
- hiring records shared with candidates or employers, frozen application
  resumes, reviews, messages, sourcing records, and generated mail;
- billing, credits, purchases, usage metering, and admin audit records;
- user-owned Storage prefixes such as avatars, company logos, resumes, and
  portfolio sites;
- Stripe customers, subscriptions, invoices, and related provider records.

**Launch blocker:** privacy/legal and finance owners must define retention,
anonymization, shared-record ownership, Storage erasure, Stripe cancellation,
and evidence-of-erasure rules before this operation can be represented as full
account erasure. Until then, process every `pending_cleanup` item explicitly and
do not delete audit or financial records ad hoc.

### Transactional email extension

Application notifications write email jobs to the Firestore `mail` collection. Email is sent only when the Firebase **Trigger Email from Firestore** extension is installed and connected to an SMTP provider.

```bash
cp extensions/firestore-send-email.env.example extensions/firestore-send-email.env
chmod 600 extensions/firestore-send-email.env
firebase ext:install firebase/firestore-send-email \
  --project career-copilot-a3168
firebase ext:list --project career-copilot-a3168
```

During installation:

- keep the collection name as `mail`;
- use `us-central1`;
- configure an authenticated SMTP service;
- use a verified sender domain;
- keep the SMTP password in Secret Manager, not in Git.

After installation, trigger an applicant status email and verify delivery, bounce handling, and the reply-to address.

## 16. Common failures

### `firebase deploy` wants to delete functions

Cause: production has functions that are not exported by the checked-out source tree.

Action: answer no, then rerun with an explicit `functions:<name>` list. Do not use `--force`.

### The VM site returns 502

Check the service and local port:

```bash
sudo systemctl status uottawa-copilot.service --no-pager
sudo journalctl -u uottawa-copilot.service -n 100 --no-pager
curl -I http://127.0.0.1:9050/
sudo nginx -t
```

### A deep link returns 404

The checked-in static server supplies the SPA fallback only for paths without file extensions. Confirm systemd starts `static-server.mjs`, not a generic file server.

### Resume upload fails in the browser

Check all three layers:

1. `storage.rules` is deployed;
2. `storage.cors.json` is applied to the real bucket;
3. `VITE_FIREBASE_STORAGE_BUCKET` names that same bucket.

### AI requests fail near 20 seconds

Confirm the latest Functions revision is active and the speed-route defaults are present:

```dotenv
LLM_SPEED_ROUTE_ATTEMPT_TIMEOUT_MS=30000
LLM_SPEED_ROUTE_TOTAL_TIMEOUT_MS=45000
```

For Gemini 3.5 Flash, use `minimal` thinking for deterministic transformations and `low` for tasks that need evaluation or writing quality. Do not solve a timeout by raising every request to several minutes; that hides unhealthy routing and produces poor user feedback.

### A yellow AI status banner stays visible

The frontend treats the banner as a 30-second recent-request incident. A successful AI request, browser reconnection, account change, or the expiry timer clears it. If it persists on an old tab, reload once to fetch the latest frontend assets.

### Stripe checkout stays in simulation

Check:

```dotenv
BILLING_SIMULATION=false
```

Then confirm real `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and every `STRIPE_PRICE_*` value are configured. Placeholder Price IDs are not a live billing setup.

## 17. Security rules for operators

- Never commit `.env`, `.env.*`, `.env.local`, service-account JSON, provider keys, Stripe secrets, or Firebase CLI credentials.
- Never put a Gemini, KairLLM, DeepSeek, or Stripe secret key in a `VITE_*` variable.
- Build production frontend assets from an allow-listed environment, not from an operator's full shell environment.
- Use a named Functions deployment list on this project; do not use a forced full deployment.
- Keep the VM's application port private and expose only nginx.
- Use separate Firebase and Stripe projects for production and staging.
- Rotate a leaked key before deleting evidence needed to understand the incident.
- Keep one tested frontend rollback directory until the replacement release has been observed.
- Review Firestore and Storage rules as code. Console edits are temporary and will be overwritten by the next deployment.
