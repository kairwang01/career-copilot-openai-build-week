<!-- Canonical source. Run `node scripts/sync-api-docs.mjs` after editing. -->

# Career CoPilot API

The Career CoPilot API lets approved partners call platform capabilities from
their own servers using a scoped API key.

## Authentication

Every request needs a key in the `Authorization` header:

```
Authorization: Bearer cc_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Keys are minted by a platform admin in **Admin → API Platform** (each key is
scoped, rate-limited, and tied to an application). The full secret is shown
once at creation — store it securely; only its prefix is ever displayed again.
Test keys are prefixed `cc_dev_`, live keys `cc_live_`.

Use keys only from a trusted server or secret-managed automation. Never embed a
key in browser JavaScript, a mobile binary, a public repository, analytics, or
client-visible logs. The API intentionally does not enable browser CORS.

## Base URL

```
https://<region>-<your-project-id>.cloudfunctions.net/publicApi
```

All responses are JSON. Success is `{ "ok": true, "data": … }`; failure is
`{ "ok": false, "error": { "code": "…", "message": "…" } }` with an HTTP status
that matches the error code.

The service meters every authenticated request before route and scope handling,
so authenticated requests that later return `403`, `404`, or another error still
count toward the key's limits. Do not use the API key for route discovery.

## Endpoints

### `GET /v1/jobs` — scope `jobs.read`

Returns up to 50 currently-active job postings (public fields only), newest
first. This endpoint does not paginate yet; clients must treat `count` as the
number returned, not the total number of active postings.

```bash
curl -H "Authorization: Bearer $CC_API_KEY" \
  https://<region>-<project-id>.cloudfunctions.net/publicApi/v1/jobs
```

```json
{
  "ok": true,
  "data": {
    "jobs": [
      {
        "id": "abc123",
        "title": "Frontend Engineer",
        "company_name": "Acme Inc.",
        "location": "Toronto, ON",
        "work_mode": "hybrid",
        "employment_type": "full_time",
        "salary_range": "$110k–140k CAD",
        "created_at": "2026-06-24T16:39:53.716Z"
      }
    ],
    "count": 1
  }
}
```

### `POST /v1/resume/analyze` — scope `resume.analyze`

Runs a structured resume analysis (ATS readiness, keywords, strengths,
improvements) for a target market.

Body:
- `resume_text` (string, required) — full resume text (max 50,000 chars).
- `market` (string, optional) — target market, e.g. `Canadian`, `United States`. Defaults to `Canadian`.
- `language` (string, optional) — output-language code. Recognized prefixes are
  `en`, `fr`, `de`, `ar`, `ja`, `vi`, `zh`, `es`, `ko`, `pt`, and `hi` (regional
  suffixes are accepted). Blank or unrecognized values fall back to the dominant
  input language; resume-facing keywords still follow the selected market.

```bash
curl -X POST \
  -H "Authorization: Bearer $CC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"resume_text":"Jane Doe — Software Engineer…","market":"Canadian"}' \
  https://<region>-<project-id>.cloudfunctions.net/publicApi/v1/resume/analyze
```

Returns `{ "ok": true, "data": { "analysis": { … } } }`.

### `POST /v1/cover-letter` — scope `tools.generate`

Generates a tailored cover letter from a resume + job description.

Body:
- `resume_text` (string, required) — full resume text (max 50,000 chars).
- `job_description` (string, required) — target job description (max 50,000 chars).
- `market` (string, optional) — target market. Defaults to `Canadian`.
- `language` (string, optional) — requested letter-language code, using the same
  recognized prefixes and fallback behavior described above.

```bash
curl -X POST \
  -H "Authorization: Bearer $CC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"resume_text":"Jane Doe…","job_description":"Senior React role…"}' \
  https://<region>-<project-id>.cloudfunctions.net/publicApi/v1/cover-letter
```

Returns `{ "ok": true, "data": { "cover_letter": { … } } }`.

### `GET /v1/usage` — scope `usage.read`

Returns the calling key's own limits, current usage, and most recent requests.

```json
{
  "ok": true,
  "data": {
    "rate_limit_per_min": 60,
    "monthly_quota": 10000,
    "minute_used": 2,
    "month_used": 2,
    "recent": [
      { "timestamp": "2026-06-24T16:51:38.864Z", "endpoint": "GET /v1/jobs", "status": 200, "latency_ms": 84 }
    ]
  }
}
```

## Rate limits & quota

Each key carries a per-minute rate limit and a monthly request quota (defaults
60/min and 10,000/month; an admin can adjust per key). Counters use UTC minute
and calendar-month windows. Exceeding either returns
`429` with code `rate_limited` or `quota_exceeded`.

The service does not currently send `Retry-After`. For `rate_limited`, wait for
the next UTC minute window. For `quota_exceeded`, wait for the next UTC calendar
month or ask the platform administrator to review the key. For transient
`ai_error`/`ai_unavailable` responses, use bounded exponential backoff with
jitter and a small maximum attempt count. Every authenticated retry is a new
metered request and may also create new provider cost; never retry indefinitely.

## Error codes

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `invalid_request` | Missing/invalid body (e.g. no `resume_text`). |
| 401 | `missing_authorization` | No `Authorization: Bearer` header. |
| 401 | `invalid_key` | Key not recognized. |
| 403 | `key_inactive` | Key is disabled or revoked. |
| 403 | `insufficient_scope` | Key lacks the endpoint's scope. |
| 404 | `not_found` | No endpoint matches the method/path. |
| 429 | `rate_limited` / `quota_exceeded` | Per-minute or monthly limit hit. |
| 502 | `ai_error` | The provider failed; use bounded backoff if retrying. |
| 503 | `ai_unavailable` | No usable provider route is available; try later. |
| 500 | `internal_error` | Unexpected server error. |

```json
{ "ok": false, "error": { "code": "insufficient_scope", "message": "This key is missing the required 'resume.analyze' scope." } }
```
