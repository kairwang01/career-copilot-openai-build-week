/**
 * aiProxy guard runtime smoke.
 *
 * Closes the gap left by the impl-level callable suites: the AI proxy callable was
 * never exercised through the real functions emulator runtime (the "unit-green /
 * runtime-crashes" class). This drives the DETERMINISTIC guard layer that rejects
 * BEFORE any model call — so it needs no LLM provider key:
 *   1. unauthenticated  → rejected (auth middleware)
 *   2. missing tool     → invalid-argument
 *   3. unknown tool      → invalid-argument
 *   4. oversized payload → the exact shared envelope error
 *
 * It intentionally never reaches provider.generate, so a successful generation is out
 * of scope (covered separately when a provider key is available).
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { configureFirebaseScript } from './lib/firebase-script-safety.mjs';

const firebaseTarget = configureFirebaseScript({ scriptName: 'aiproxy-guard-smoke' });
const PROJECT_ID = firebaseTarget.projectId;
const PASSWORD = 'QaSeed!2026';
const CANDIDATE_EMAIL = 'candidate@careercopilot.test';
// Keep these build-independent smoke mirrors synchronized with runtimeLimits.ts;
// resumeLimitContract.test.ts pins them to the same 200k/300k contract.
const MAX_RESUME_TEXT_CHARS = 200_000;
const MAX_AI_TOOL_PAYLOAD_CHARS = 300_000;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || 'demo-api-key',
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || 'demo-careercopilot.firebaseapp.com',
  projectId: PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || 'demo-careercopilot.appspot.com',
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '000000000000',
  appId: process.env.VITE_FIREBASE_APP_ID || '1:000000000000:web:demo',
};

const functionsRegion = process.env.VITE_FIREBASE_FUNCTIONS_REGION || 'us-central1';
const authEmulatorUrl = process.env.VITE_FIREBASE_AUTH_EMULATOR_URL || 'http://127.0.0.1:9199';
const functionsEmulatorHost = process.env.VITE_FIREBASE_FUNCTIONS_EMULATOR_HOST || '127.0.0.1';
const functionsEmulatorPort = Number(process.env.VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT || '5001');

function initClientApp(name) {
  const app = initializeApp(firebaseConfig, name);
  const auth = getAuth(app);
  const functions = getFunctions(app, functionsRegion);
  connectAuthEmulator(auth, authEmulatorUrl, { disableWarnings: true });
  connectFunctionsEmulator(functions, functionsEmulatorHost, functionsEmulatorPort);
  return { app, auth, functions };
}

async function runSeedScript() {
  await new Promise((resolve, reject) => {
    const child = spawn((process.env.NODE_BINARY || 'node'), ['scripts/seed-emulator.mjs'], {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
    });
    child.on('exit', (code, signal) => (code === 0 ? resolve() : reject(new Error(`seed-emulator failed with ${code ?? signal}`))));
  });
}

async function expectCallableRejected(factory, pattern, label) {
  try {
    await factory();
  } catch (error) {
    const text = `${error?.code || ''} ${error?.message || error}`;
    if (pattern.test(text)) {
      console.log(`  ✓ ${label}`);
      return;
    }
    throw new Error(`${label}: rejected but with unexpected error → ${text}`);
  }
  throw new Error(`Expected rejection: ${label}`);
}

async function main() {
  await runSeedScript();

  const anon = initClientApp('aiproxy-anon');
  const candidate = initClientApp('aiproxy-candidate');

  try {
    const anonAiProxy = httpsCallable(anon.functions, 'aiProxy');
    await expectCallableRejected(
      () => anonAiProxy({ tool: 'generateLearningPlan', payload: {} }),
      /unauthenticated/i,
      'unauthenticated aiProxy call rejected',
    );

    await signInWithEmailAndPassword(candidate.auth, CANDIDATE_EMAIL, PASSWORD);
    const aiProxy = httpsCallable(candidate.functions, 'aiProxy');

    await expectCallableRejected(
      () => aiProxy({ payload: {} }),
      /invalid-argument|tool is required/i,
      'missing tool rejected',
    );

    await expectCallableRejected(
      () => aiProxy({ tool: '__no_such_tool__', payload: {} }),
      /invalid-argument|unknown tool/i,
      'unknown tool rejected',
    );

    await expectCallableRejected(
      () => aiProxy({
        tool: 'generateLearningPlan',
        payload: {
          resumeText: 'R'.repeat(MAX_RESUME_TEXT_CHARS),
          skillToLearn: 'S'.repeat(MAX_AI_TOOL_PAYLOAD_CHARS - MAX_RESUME_TEXT_CHARS),
          marketName: 'Canada',
        },
      }),
      /request payload exceeds the 300000 character content limit/i,
      'oversized otherwise-valid payload rejected for the envelope limit',
    );

    console.log('\naiProxy guard runtime smoke passed.');
  } finally {
    await Promise.allSettled([deleteApp(anon.app), deleteApp(candidate.app)]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
