# k6 Load Baseline (SCRUM-43)

A reproducible [k6](https://k6.io/) load baseline against **one read endpoint**
and **one AI endpoint** on the local Firebase emulator, capturing **P95** latency
to check it against the team's M1/M2/M3 latency targets.

Relates to **SCRUM-68** (key endpoints have a measured load / P95 baseline) and
**SCRUM-45** (real end-to-end M3 latency vs. the live community LLM router).

---

## What is measured

| Scenario | Callable | What it exercises |
|----------|----------|-------------------|
| `read`   | `listModels`    | Auth verify + one `users/{uid}` Firestore read + tier gating. A cheap authenticated read path. |
| `ai`     | `analyzeResume` | Auth verify + **server-side credit transaction** + LLM call + structured response. The canonical AI callable. |

Both are HTTPS **callable** functions. The harness invokes them exactly as the
Firebase SDK does:

```
POST {functionsBase}/{functionName}
Content-Type: application/json
Authorization: Bearer <emulator ID token>
Body: { "data": { ...args } }
→ 200 { "result": ... }
```

### The LLM is stubbed — read this

The AI scenario runs with **`E2E_LLM_STUB=true`**. With this flag set,
`resolveProvider()` (functions/src/llm/models.ts) returns a deterministic,
offline `StubLLMProvider` that responds instantly and synthesises an object
matching the request's `responseSchema`. No network, no API key, no real model.

**Why:** it makes the AI path deterministic so the harness measures the
**application + transport overhead** (auth verification, the credit transaction,
request/response serialization, callable plumbing) in isolation — repeatable and
infra-free.

> ⚠️ **Stub latency ≠ real provider latency.** This baseline does **not** measure
> the real LLM round-trip. The free community LLM router is currently **30–90s**;
> the M3 *acceptable* target is **< 8s P95**. The real, end-to-end M3 number is
> measured separately in **SCRUM-45** against the live provider. Treat the AI
> P95 here as the *floor* (overhead-only) the real number sits on top of.

---

## Targets (how to interpret P95)

P95 = 95% of requests completed at or under this latency. It is the standard
tail-latency SLO signal: more robust than the average, less noisy than the max.

| Milestone | Endpoint class | Target (P95) | Where checked |
|-----------|----------------|--------------|---------------|
| M1 / M2   | Read endpoints | **well under 1s** (threshold `< 1000ms`) | this harness, `read` scenario |
| M3        | AI endpoints   | **< 8s** (acceptable target) | **SCRUM-45** (real provider); this harness only measures the stubbed overhead floor |

The k6 thresholds in `baseline.js` encode these:

```js
"read_listModels_latency":  ["p(95)<1000"],  // M1/M2
"ai_analyzeResume_latency": ["p(95)<8000"],  // M3 ceiling (meaningful vs a real provider)
"http_req_failed":          ["rate<0.01"],   // < 1% errors
```

If a threshold is crossed, k6 exits non-zero (code 99) and prints which metric
failed — so this can gate CI.

---

## How to run

### Prerequisites

- **k6** — `brew install k6` (or see https://k6.io/docs/get-started/installation/)
- **JDK 21+** — required by the current `firebase-tools` emulator. If your default
  `java` is older, prefix the run with a 21+ `JAVA_HOME` (same pattern as the
  smoke scripts), e.g. on macOS with Homebrew:
  ```bash
  export JAVA_HOME="/opt/homebrew/opt/openjdk@21"
  export PATH="$JAVA_HOME/bin:$PATH"
  ```
- Function deps installed once: `npm --prefix functions install`

### Run

```bash
npm run loadtest:baseline
```

This:
1. builds the functions (`npm --prefix functions run build`),
2. boots the **auth + firestore + functions** emulators with `E2E_LLM_STUB=true`
   via `firebase emulators:exec` (the same mechanism as `test:rules` /
   `test:callables`),
3. runs `loadtest/setup-and-run.mjs`, which mints an emulator ID token, seeds a
   paid test user with credits, disables the admin daily-usage quota for the run,
   then executes `loadtest/baseline.js` with k6,
4. tears the emulators down automatically.

### Tuning knobs (env vars)

| Var | Default | Meaning |
|-----|---------|---------|
| `SCENARIO` | `all` | `read` \| `ai` \| `all` |
| `VUS`      | `5`   | concurrent virtual users |
| `DURATION` | `30s` | duration per scenario |
| `SEED_CREDITS` | `1000000` | starting balance for the test user |

Examples:

```bash
SCENARIO=read VUS=10 DURATION=1m npm run loadtest:baseline
SCENARIO=ai   VUS=5  DURATION=30s npm run loadtest:baseline
```

---

## Files

- `baseline.js` — the k6 script (two scenarios, per-endpoint P95 trends + thresholds).
- `setup-and-run.mjs` — runs inside `emulators:exec`: mint token → seed user →
  disable quotas → spawn k6. ESM `.mjs`, matching repo convention.
- `results/` — captured runs. See `results/baseline-2026-06-26.md`.

---

## Results

See [`results/baseline-2026-06-26.md`](results/baseline-2026-06-26.md) for the
latest captured P95 numbers and pass/fail vs targets.
