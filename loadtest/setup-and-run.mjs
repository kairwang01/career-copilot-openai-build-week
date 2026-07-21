/**
 * loadtest/setup-and-run.mjs — SCRUM-43
 *
 * Runs INSIDE `firebase emulators:exec` (auth + firestore + functions are up).
 * It:
 *   1. Mints a Firebase Auth emulator ID token (signUp, like the smoke scripts).
 *   2. Seeds users/{uid} via the Firestore emulator REST API with a large credit
 *      balance and a paid subscription (exempt from the free-tier run cap) so the
 *      AI scenario is not throttled by quotas mid-run.
 *   3. Spawns the k6 binary against loadtest/baseline.js, passing the token,
 *      functions base URL, and scenario knobs as env vars.
 *
 * Ports come from firebase.json (auth 9199, functions 5001, firestore 8080) and
 * may be overridden via env. The project id defaults to the demo project used by
 * the existing emulator npm scripts (test:rules / test:callables).
 *
 * Why a paid/seeded user: deductCredits + checkQuotasOrThrow run server-side on
 * every AI call (this overhead is intentionally measured). Seeding avoids the
 * run hitting failed-precondition (no credits) or resource-exhausted (free cap),
 * which would otherwise pollute the latency sample with error responses.
 */

import { spawn } from "node:child_process";
import process from "node:process";

const PROJECT_ID = process.env.LOADTEST_PROJECT || "demo-careercopilot";
const REGION = "us-central1";
const API_KEY = "demo-key"; // accepted by the Auth emulator without a real project

const AUTH_PORT = process.env.AUTH_EMULATOR_PORT || "9199";
const FUNCTIONS_PORT = process.env.FUNCTIONS_EMULATOR_PORT || "5001";
const FIRESTORE_PORT = process.env.FIRESTORE_EMULATOR_PORT || "8080";

const AUTH_URL = `http://127.0.0.1:${AUTH_PORT}`;
const FUNCTIONS_BASE = `http://127.0.0.1:${FUNCTIONS_PORT}/${PROJECT_ID}/${REGION}`;
const FIRESTORE_BASE = `http://127.0.0.1:${FIRESTORE_PORT}`;

const SCENARIO = process.env.SCENARIO || "all";
const VUS = process.env.VUS || "5";
const DURATION = process.env.DURATION || "30s";
const SEED_CREDITS = process.env.SEED_CREDITS || "1000000";

function die(msg, err) {
  console.error(`\n[loadtest] ERROR: ${msg}`);
  if (err) console.error(err);
  process.exit(1);
}

async function mintIdToken() {
  const res = await fetch(
    `${AUTH_URL}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returnSecureToken: true }),
    }
  );
  if (!res.ok) die(`Auth emulator signUp failed (HTTP ${res.status}). Is the auth emulator on :${AUTH_PORT}?`);
  const json = await res.json();
  if (!json.idToken || !json.localId) die("Auth emulator did not return idToken/localId.");
  return { idToken: json.idToken, uid: json.localId };
}

async function seedUser(uid) {
  // Firestore emulator REST PATCH. "executive" => paid tier (exempt from the
  // free-tier daily run cap); large credits => never hits insufficient-credits.
  const url =
    `${FIRESTORE_BASE}/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}` +
    `?updateMask.fieldPaths=credits&updateMask.fieldPaths=role&updateMask.fieldPaths=subscription_status`;
  const res = await fetch(url, {
    method: "PATCH",
    // "Bearer owner" makes the Firestore emulator bypass security rules (admin
    // context), so seeding is not blocked by firestore.rules.
    headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
    body: JSON.stringify({
      fields: {
        credits: { integerValue: String(SEED_CREDITS) },
        role: { stringValue: "candidate" },
        subscription_status: { stringValue: "executive" },
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    die(`Firestore emulator seed failed (HTTP ${res.status}) on :${FIRESTORE_PORT}. ${text}`);
  }
}

async function disablePlatformQuotas() {
  // Turn the admin daily-usage quota OFF for the baseline run. checkQuotasOrThrow
  // returns early when platform_config/quotas.enabled === false, so the AI
  // scenario is not throttled (and is not skewed) by per-day usage accounting.
  // This is the same toggle the Admin Portal exposes — it is legitimate test
  // setup, not a code change.
  const url =
    `${FIRESTORE_BASE}/v1/projects/${PROJECT_ID}/databases/(default)/documents/platform_config/quotas` +
    `?updateMask.fieldPaths=enabled`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
    body: JSON.stringify({ fields: { enabled: { booleanValue: false } } }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    die(`Firestore emulator quota-disable failed (HTTP ${res.status}). ${text}`);
  }
}

function runK6(idToken) {
  return new Promise((resolve) => {
    const args = ["run", new URL("./baseline.js", import.meta.url).pathname];
    const child = spawn("k6", args, {
      stdio: "inherit",
      env: {
        ...process.env,
        FUNCTIONS_BASE,
        ID_TOKEN: idToken,
        SCENARIO,
        VUS,
        DURATION,
      },
    });
    child.on("error", (err) =>
      die("Failed to launch k6. Is it installed and on PATH? (`brew install k6`)", err)
    );
    child.on("close", (code) => resolve(code ?? 1));
  });
}

(async () => {
  console.log("[loadtest] SCRUM-43 baseline");
  console.log(`[loadtest] project=${PROJECT_ID} scenario=${SCENARIO} vus=${VUS} duration=${DURATION}`);
  console.log(`[loadtest] E2E_LLM_STUB=${process.env.E2E_LLM_STUB || "(unset)"}  (AI latency = app/transport only)`);

  const { idToken, uid } = await mintIdToken();
  console.log(`[loadtest] minted ID token for uid=${uid}`);
  await seedUser(uid);
  console.log(`[loadtest] seeded users/${uid} (credits=${SEED_CREDITS}, subscription_status=executive)`);
  await disablePlatformQuotas();
  console.log("[loadtest] disabled platform daily-usage quotas for the run");

  const code = await runK6(idToken);
  process.exit(code);
})().catch((err) => die("unexpected failure", err));
