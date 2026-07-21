/**
 * k6 load baseline — SCRUM-43
 * Read endpoint (listModels) + one AI endpoint (analyzeResume), P95 capture.
 *
 * This script is executed by the k6 binary (NOT Node). It runs two scenarios
 * against Firebase Cloud Functions callables on the local emulator:
 *
 *   - read : `listModels`     — cheap authenticated read (one Firestore doc get)
 *   - ai   : `analyzeResume`  — AI callable, run with E2E_LLM_STUB=true so the
 *            LLM call is deterministic and instant. With the stub on, this
 *            measures app + transport overhead (auth verify + credit
 *            transaction + (de)serialization), NOT real provider latency.
 *            Real M3 end-to-end latency is measured separately in SCRUM-45.
 *
 * Config is passed via environment variables (see loadtest/run-baseline.mjs):
 *   FUNCTIONS_BASE   e.g. http://127.0.0.1:5001/demo-careercopilot/us-central1
 *   ID_TOKEN         Firebase Auth emulator ID token (Bearer)
 *   SCENARIO         "read" | "ai" | "all"  (default "all")
 *   VUS              virtual users (default 5)
 *   DURATION         test duration per scenario (default "30s")
 *
 * Callable invocation contract (HTTPS callable over POST):
 *   POST {FUNCTIONS_BASE}/{functionName}
 *   Headers: Content-Type: application/json, Authorization: Bearer <ID_TOKEN>
 *   Body:    { "data": { ...args } }
 *   Success: HTTP 200, body { "result": ... }
 */

import http from "k6/http";
import { check } from "k6";
import { Trend } from "k6/metrics";

const FUNCTIONS_BASE = __ENV.FUNCTIONS_BASE;
const ID_TOKEN = __ENV.ID_TOKEN;
const SCENARIO = (__ENV.SCENARIO || "all").toLowerCase();
const VUS = parseInt(__ENV.VUS || "5", 10);
const DURATION = __ENV.DURATION || "30s";

if (!FUNCTIONS_BASE || !ID_TOKEN) {
  throw new Error("FUNCTIONS_BASE and ID_TOKEN env vars are required");
}

// Per-endpoint latency trends so each P95 is reported independently.
const readLatency = new Trend("read_listModels_latency", true);
const aiLatency = new Trend("ai_analyzeResume_latency", true);

const HEADERS = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${ID_TOKEN}`,
};

// ---------------------------------------------------------------------------
// Targets (thresholds). Abort-on-fail is intentionally OFF: we always want a
// full report. Pass/fail is evaluated from the thresholds at the end.
//   READ  — read endpoints should be well under 1s          -> p95 < 1000ms
//   AI    — M3 acceptable target is < 8s p95 for AI endpoints. With the LLM
//           stub the transport floor should be far below that; we assert the
//           same 8000ms ceiling so the harness is meaningful when pointed at a
//           real provider, and document the stub caveat in the README.
// ---------------------------------------------------------------------------
function buildScenarios() {
  const scenarios = {};
  if (SCENARIO === "read" || SCENARIO === "all") {
    scenarios.read = {
      executor: "constant-vus",
      exec: "readScenario",
      vus: VUS,
      duration: DURATION,
      tags: { endpoint: "read" },
    };
  }
  if (SCENARIO === "ai" || SCENARIO === "all") {
    scenarios.ai = {
      executor: "constant-vus",
      exec: "aiScenario",
      vus: VUS,
      duration: DURATION,
      // Stagger AI start so the two scenarios do not contend if SCENARIO=all.
      startTime: SCENARIO === "all" ? DURATION : "0s",
      tags: { endpoint: "ai" },
    };
  }
  return scenarios;
}

export const options = {
  scenarios: buildScenarios(),
  thresholds: {
    "read_listModels_latency": ["p(95)<1000"], // M1/M2: read well under 1s
    "ai_analyzeResume_latency": ["p(95)<8000"], // M3: AI acceptable < 8s p95
    "http_req_failed": ["rate<0.01"], // < 1% errors
  },
};

export function readScenario() {
  const url = `${FUNCTIONS_BASE}/listModels`;
  const res = http.post(url, JSON.stringify({ data: {} }), { headers: HEADERS });
  readLatency.add(res.timings.duration);
  check(res, {
    "read: status 200": (r) => r.status === 200,
    "read: has result": (r) => {
      try {
        return JSON.parse(r.body).result !== undefined;
      } catch (_e) {
        return false;
      }
    },
  });
}

export function aiScenario() {
  const url = `${FUNCTIONS_BASE}/analyzeResume`;
  const body = JSON.stringify({
    data: {
      resumeText:
        "Jane Doe, Software Engineer, Toronto ON. Senior Developer at Acme Corp 2020-2024, " +
        "built React dashboards and Node.js APIs. BSc Computer Science, University of Toronto 2019. " +
        "Skills: TypeScript, React, Node.js, Firebase, AWS.",
      marketName: "Canada",
    },
  });
  const res = http.post(url, body, { headers: HEADERS });
  aiLatency.add(res.timings.duration);
  check(res, {
    "ai: status 200": (r) => r.status === 200,
    "ai: has result": (r) => {
      try {
        return JSON.parse(r.body).result !== undefined;
      } catch (_e) {
        return false;
      }
    },
  });
}

// Default function required by k6 when no per-scenario exec resolves; unused.
export default function () {}
