# API Platform — backend callable contract

Status: **implemented.** The admin console calls the Cloud Functions listed
below through `services/apiPlatformClient.ts`. Keep both files in sync when
adding new platform capabilities.

## Callables

| Callable | Client method | Permission (server-enforced) |
|---|---|---|
| `apiPlatformListApplications` | `listApplications()` | `admin.apiplatform.read` |
| `apiPlatformCreateApplication` | `createApplication(input)` | `admin.apiplatform.manage` |
| `apiPlatformListKeys` | `listApiKeys()` | `admin.apiplatform.read` |
| `apiPlatformCreateKey` | `createApiKey(input)` | `admin.apiplatform.manage` |
| `apiPlatformRevokeKey` | `revokeApiKey(keyId)` | `admin.apiplatform.manage` |
| `apiPlatformUpdateKeyStatus` | `updateApiKeyStatus(keyId, status)` | `admin.apiplatform.manage` |
| `apiPlatformGetUsage` | `getUsageSummary()` | `admin.apiplatform.read` |
| `apiPlatformListUsageLogs` | `listUsageLogs()` | `admin.apiplatform.read` |

`onApiUsageLogCreated` is a retrying Firestore create trigger, not a client
callable. It applies each new `api_usage_logs/{entryId}` document to the UTC-day
and UTC-month summary shards through the same transactional helper used by the
production backfill.

Permission strings map to the client registry (`lib/access/permissions.ts`):
`admin.apiplatform.read` = role admin or super; `admin.apiplatform.manage` =
super only. Enforce via the same role resolution used by `adminWhoAmI` /
`requireAdmin` middleware — never trust a role claim from the request payload.
When org-scoped access lands, `owner_org_id` filters list responses and an
`requireOrgAdmin(orgId)` check guards mutations on org-owned applications.

## Public gateway (consumption) — `publicApi`

The admin callables above *mint* keys; `functions/src/handlers/apiGateway.ts`
(`publicApi`, an `onRequest` HTTP function) is where partners *use* them. Per
request it authenticates the `Authorization: Bearer <secret>` by SHA-256 hash
(same `secretHash`), rejects non-`active` keys, enforces the endpoint scope +
per-minute rate limit + monthly quota (`api_key_usage/{keyId}` counters), runs
the endpoint, then writes an `api_usage_logs` entry and advances `last_used_at`.

| Endpoint | Method | Scope | Backed by |
|---|---|---|---|
| `/v1/jobs` | GET | `jobs.read` | active `job_postings` (public fields; no AI) |
| `/v1/resume/analyze` | POST `{resume_text, market?, language?}` | `resume.analyze` | `resolveProvider()` + `ANALYSIS_SCHEMA` |
| `/v1/cover-letter` | POST `{resume_text, job_description, market?, language?}` | `tools.generate` | `resolveProvider()` + `COVER_LETTER_SCHEMA` |
| `/v1/usage` | GET | `usage.read` | `api_key_usage` counters + recent `api_usage_logs` (no AI) |

Every scope in `ALLOWED_SCOPES` now maps to a live endpoint.

`publicApi` is configured with `cors:false`. Partner keys are trusted-server
credentials: never embed one in browser JavaScript, a mobile binary, or other
client-visible code. The exact language prefixes/fallback behavior, request
limits, response examples, and server integration guidance are canonical in
`docs/api.md` (with a generated public mirror).

After a key authenticates, `meterUsage` runs before route matching, scope
validation, request-body validation, or provider invocation. Therefore an
authenticated unknown-route, insufficient-scope, invalid-body, or transient AI
attempt consumes one request when it is still within quota; a retry is another
metered attempt and may create provider cost. A request rejected because its
minute/month counter is already at the limit is not incremented again. The
service currently sends no `Retry-After`; bounded retry guidance and UTC window
semantics live in `docs/api.md` and must not be duplicated differently here.

HTTP error contract (JSON `{ ok:false, error:{ code, message } }`):
`401 missing_authorization|invalid_key`, `403 key_inactive|insufficient_scope`,
`404 not_found`, `429 rate_limited|quota_exceeded`, `400 invalid_request`,
`503 ai_unavailable` (no provider key), `502 ai_error`. Success is
`{ ok:true, data:… }`. Only the key **prefix** is ever logged — never the secret.
Partner AI traffic routes through `resolveProvider(key.created_by)` so tiering /
key pooling apply (req #6). The gateway never reads or returns raw provider keys
directly; the server-only resolver may read the protected platform/model config.

## Data model (Firestore)

- `api_applications/{appId}`: name, description, environment
  (`development|production`, immutable after create), owner_org_id (nullable),
  created_by, created_at.
- `api_keys/{keyId}`: app_id, name, prefix, **secret_hash (SHA-256)**,
  environment (inherited from app), scopes[], status
  (`active|disabled|revoked`), created_by, created_at, last_used_at,
  rate_limit_per_min, monthly_quota.
- `api_usage_logs/{entryId}`: timestamp, expires_at, key_id, app_id, key_prefix,
  endpoint, status, latency_ms. After exact-once summary application it also
  carries summary_version, summary_day, summary_month, summary_shard,
  summary_is_error, and summary_applied_at. The marker and both counter
  increments share one transaction. Marker metadata must match the source log
  before a retry is accepted as already applied. New records expire after 90
  days through the Firestore TTL policy declared in `firestore.indexes.json`;
  deletion is eventual.
- `api_usage_summary_shards/{periodType_periodKey_shard}`: period_type
  (`day|month`), period_key (UTC), deterministic shard number `0..31`,
  summary_version, requests, errors, updated_at, expires_at. The 32-way shard is
  derived from the source log document id, so concurrent increments are spread
  without storing a partner key or request identity in the summary. Each shard
  expires 120 days after the end of its UTC day/month. The
  `api_usage_summary_shards.expires_at` TTL policy and deletion are eventual.
- `api_usage_summary_state/rollout_v1`: summary_version, source_collection,
  last_verified_at. The guarded backfill writes this checkpoint only after a
  full zero-residue rescan. `apiPlatformGetUsage` fails with
  `failed-precondition` while the checkpoint is absent or stale.

## Admin usage-summary read semantics

`apiPlatformGetUsage` reads the current UTC month and the latest seven UTC days.
It issues a fixed batch read of at most 256 summary documents (8 periods x 32
shards), validates every counter/version, and calculates active-key monthly
quota with a Firestore server-side sum. There is no raw-log `limit(5000)` scan
and no dependency on the 500-key admin list cap.

The trigger is asynchronous: a just-written log can be briefly absent from the
dashboard until `summary_version=1` appears on that log. After the trigger (or
backfill) commits, each retained valid log contributes exactly once. This is
eventually consistent telemetry, not a zero-lag realtime counter. Production
acceptance must wait for the marker before comparing a controlled request delta.

Rollout is intentionally two-stage: deploy only `onApiUsageLogCreated`, run the
guarded stable-pagination backfill twice (zero residue, then `applied=0`), and
only then deploy `apiPlatformGetUsage`. Platform Operations owns both summary
TTL activation and a quarterly residue check. The canonical commands and stop
conditions are in `docs/deployment/README.md`.

## Security requirements (non-negotiable)

1. **Secret generation is server-side only.** `apiPlatformCreateKey` generates
   the secret, returns it once in the response, stores only the SHA-256 hash
   (same pattern as `llm/models.ts` `keyHash()` for provider key health).
2. **No raw secret anywhere else**: not in Firestore, not in logs, not in
   audit details, not in any list/read response. List responses carry `prefix`
   only.
3. **Scope + quota validation per request** in the public API gateway: a key
   must carry the scope for the endpoint it calls; rate limit and monthly
   quota are enforced server-side (reuse the quotas pattern in
   `admin/usageLog.ts`).
4. **Revocation is immediate and irreversible** (`failed-precondition` when
   re-enabling a revoked key).
5. **Every mutation writes `admin_audit_log`** (actions:
   `api_app_create`, `api_key_create`, `api_key_revoke`,
   `api_key_status_change`) with key prefix only in details.
6. **Provider keys stay behind the resolver boundary**: gateway handlers never
   read, log, or return raw platform/model-registry keys. Partner traffic goes
   through the server-only `resolveProvider()` path like first-party traffic so
   tiering/pooling apply.

## Error contract

Use callable `HttpsError` codes; the client surfaces `error.message` directly:
`permission-denied` (missing permission), `not-found` (unknown app/key),
`failed-precondition` (revoked key, empty scopes, usage-summary migration not
ready), `resource-exhausted`
(quota), `invalid-argument` (validation).

## Deliberately deferred

Webhooks (`api_webhooks`) — no consumer exists yet; add when a partner needs
push delivery. Quota rules stay per-key fields rather than a separate rules
collection at this scale.
