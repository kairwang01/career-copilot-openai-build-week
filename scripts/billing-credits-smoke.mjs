/**
 * Billing / credits callable runtime smoke test.
 *
 * Runs only against Firebase emulators with BILLING_SIMULATION=true. It locks the
 * money/entitlement path through real callable runtime invocations:
 *   1. unpaid setSubscriptionStatus stays pending and grants nothing,
 *   2. simulated checkout returns a fake payment URL,
 *   3. confirmSimulatedCheckout writes billing.active and activates the plan,
 *   4. credit_renewals records the paid high-water grant,
 *   5. repeated confirmation does not double-grant same-period credits,
 *   6. subscription management opens the simulated portal,
 *   7. simulated cancel downgrades without wiping existing credits,
 *   8. one-off credit-pack purchase grants credits without changing plan/role,
 *      is idempotent on the checkout session (no double-grant), and a NEW
 *      checkout session grants again,
 *   9. business checkout promotes/keeps employer role and grants business credits,
 *  10. business cancel preserves the employer portal role.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { configureFirebaseScript } from './lib/firebase-script-safety.mjs';

const firebaseTarget = configureFirebaseScript({ scriptName: 'billing-credits-smoke' });

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');
const { DEFAULT_PLAN_QUOTAS } = require('../functions/lib/admin/quotaDefaults.js');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ID = firebaseTarget.projectId;
const PASSWORD = 'QaSeed!2026';
const CANDIDATE_EMAIL = 'candidate@careercopilot.test';
const EMPLOYER_EMAIL = 'employer@careercopilot.test';
const SEED_CREDITS = 100;
const ACCELERATOR_MONTHLY_CREDITS = DEFAULT_PLAN_QUOTAS.accelerator.monthly_credit_grant;
const PRO_MONTHLY_CREDITS = DEFAULT_PLAN_QUOTAS.pro.monthly_credit_grant;
const CHECKOUT_RUN_ID = randomUUID();
const CHECKOUT_OPERATION_IDS = Object.freeze({
  candidateSubscription: `billing-smoke:candidate-subscription:${CHECKOUT_RUN_ID}`,
  firstCreditPack: `billing-smoke:credit-pack-first:${CHECKOUT_RUN_ID}`,
  secondCreditPack: `billing-smoke:credit-pack-second:${CHECKOUT_RUN_ID}`,
  employerSubscription: `billing-smoke:employer-subscription:${CHECKOUT_RUN_ID}`,
});

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

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}
const db = admin.firestore();
const adminAuth = admin.auth();

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
      ...options,
    });
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} failed with ${code ?? signal}`));
    });
  });
}

function initClientApp(name) {
  const app = initializeApp(firebaseConfig, name);
  const auth = getAuth(app);
  const functions = getFunctions(app, functionsRegion);
  connectAuthEmulator(auth, authEmulatorUrl, { disableWarnings: true });
  connectFunctionsEmulator(functions, functionsEmulatorHost, functionsEmulatorPort);
  return { app, auth, functions };
}

async function signInClient(email, appName) {
  const client = initClientApp(appName);
  await signInWithEmailAndPassword(client.auth, email, PASSWORD);
  return client;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function seedBillingFixture() {
  await run((process.env.NODE_BINARY || 'node'), ['scripts/seed-emulator.mjs']);
  const [candidate, employer] = await Promise.all([
    adminAuth.getUserByEmail(CANDIDATE_EMAIL),
    adminAuth.getUserByEmail(EMPLOYER_EMAIL),
  ]);
  const now = new Date().toISOString();

  await Promise.all([
    db.collection('billing').doc(candidate.uid).delete().catch(() => undefined),
    db.collection('billing').doc(employer.uid).delete().catch(() => undefined),
    db.collection('credit_renewals').doc(candidate.uid).delete().catch(() => undefined),
    db.collection('credit_renewals').doc(employer.uid).delete().catch(() => undefined),
    db.collection('users').doc(candidate.uid).set(
      {
        role: 'candidate',
        subscription_status: 'free',
        credits: SEED_CREDITS,
        full_name: 'Casey Candidate',
        updated_at: now,
      },
      { merge: true },
    ),
    db.collection('users').doc(employer.uid).set(
      {
        role: 'employer',
        subscription_status: 'free',
        credits: SEED_CREDITS,
        full_name: 'Erin Employer',
        company_name: 'Seed Test Co',
        company_size: '11-50',
        updated_at: now,
      },
      { merge: true },
    ),
  ]);

  return { candidateUid: candidate.uid, employerUid: employer.uid };
}

function assertSimulatedCheckout(result, expectedPlan, expectedAudience) {
  assert(result?.data?.simulated === true, `Expected simulated checkout: ${JSON.stringify(result?.data)}`);
  assert(typeof result.data.id === 'string' && result.data.id.startsWith('sim_'), `Unexpected sim id: ${result.data.id}`);
  assert(typeof result.data.url === 'string', `Missing simulated checkout URL: ${JSON.stringify(result.data)}`);
  const url = new URL(result.data.url, 'http://localhost');
  assert(url.pathname === '/billing/checkout', `Unexpected checkout path: ${result.data.url}`);
  assert(url.searchParams.get('plan') === expectedPlan, `Unexpected checkout plan: ${result.data.url}`);
  assert(url.searchParams.get('audience') === expectedAudience, `Unexpected checkout audience: ${result.data.url}`);
  assert(url.searchParams.get('sim') === result.data.id, `Checkout sim id mismatch: ${result.data.url}`);
}

async function assertUser(uid, expected) {
  const user = (await db.collection('users').doc(uid).get()).data();
  for (const [key, value] of Object.entries(expected)) {
    assert(user?.[key] === value, `users/${uid}.${key}=${user?.[key]}, expected ${value}`);
  }
  return user;
}

async function assertBilling(uid, expected) {
  const billing = (await db.collection('billing').doc(uid).get()).data();
  for (const [key, value] of Object.entries(expected)) {
    assert(billing?.[key] === value, `billing/${uid}.${key}=${billing?.[key]}, expected ${value}`);
  }
  return billing;
}

async function main() {
  if (process.env.BILLING_SIMULATION !== 'true') {
    throw new Error('BILLING_SIMULATION=true is required for smoke:billing-credits.');
  }
  const { candidateUid, employerUid } = await seedBillingFixture();
  const candidateClient = await signInClient(CANDIDATE_EMAIL, 'billing-smoke-candidate');
  const employerClient = await signInClient(EMPLOYER_EMAIL, 'billing-smoke-employer');

  try {
    const candidateSetSubscription = httpsCallable(candidateClient.functions, 'setSubscriptionStatus');
    const candidateCreateCheckout = httpsCallable(candidateClient.functions, 'createCheckoutSession');
    const candidateConfirmCheckout = httpsCallable(candidateClient.functions, 'confirmSimulatedCheckout');
    const candidateCreatePortal = httpsCallable(candidateClient.functions, 'createBillingPortalSession');
    const candidateCancelSubscription = httpsCallable(candidateClient.functions, 'cancelSubscriptionSimulated');
    const employerCreateCheckout = httpsCallable(employerClient.functions, 'createCheckoutSession');
    const employerConfirmCheckout = httpsCallable(employerClient.functions, 'confirmSimulatedCheckout');
    const employerCreatePortal = httpsCallable(employerClient.functions, 'createBillingPortalSession');
    const employerCancelSubscription = httpsCallable(employerClient.functions, 'cancelSubscriptionSimulated');

    const pending = await candidateSetSubscription({ planKey: 'pending_accelerator' });
    assert(pending.data.status === 'pending_payment', `Expected pending_payment: ${JSON.stringify(pending.data)}`);
    assert(pending.data.subscription_status === 'free', `Expected subscription to remain free: ${JSON.stringify(pending.data)}`);
    assert(pending.data.credits === SEED_CREDITS, `Expected no unpaid credit grant: ${JSON.stringify(pending.data)}`);
    await assertUser(candidateUid, { role: 'candidate', subscription_status: 'free', credits: SEED_CREDITS });
    await assertBilling(candidateUid, { active: false, pending_plan: 'accelerator', pending_audience: 'candidate' });
    console.log('  ✓ unpaid candidate plan stays pending with no credit grant');

    const candidateCheckout = await candidateCreateCheckout({
      planKey: 'pending_accelerator',
      uiMode: 'hosted',
      operationId: CHECKOUT_OPERATION_IDS.candidateSubscription,
    });
    assertSimulatedCheckout(candidateCheckout, 'accelerator', 'candidate');
    console.log('  ✓ simulated candidate checkout session returned');

    const retriedCandidateCheckout = await candidateCreateCheckout({
      planKey: 'pending_accelerator',
      uiMode: 'hosted',
      operationId: CHECKOUT_OPERATION_IDS.candidateSubscription,
    });
    assert(
      retriedCandidateCheckout.data.id === candidateCheckout.data.id,
      `Same checkout operation did not reuse its session: ${JSON.stringify(retriedCandidateCheckout.data)}`,
    );
    console.log('  ✓ same checkout operation reuses the simulated session');

    const activatedCandidate = await candidateConfirmCheckout({ planKey: 'pending_accelerator' });
    assert(activatedCandidate.data.status === 'active', `Candidate checkout did not activate: ${JSON.stringify(activatedCandidate.data)}`);
    assert(activatedCandidate.data.subscription_status === 'accelerator', `Unexpected candidate plan: ${JSON.stringify(activatedCandidate.data)}`);
    assert(activatedCandidate.data.grant_source === 'paid', `Expected paid grant source: ${JSON.stringify(activatedCandidate.data)}`);
    const expectedCandidateCredits = SEED_CREDITS + ACCELERATOR_MONTHLY_CREDITS;
    await assertUser(candidateUid, { role: 'candidate', subscription_status: 'accelerator', credits: expectedCandidateCredits });
    await assertBilling(candidateUid, { active: true, plan: 'accelerator', audience: 'candidate', provider: 'stripe', status: 'active' });
    const candidateRenewal = (await db.collection('credit_renewals').doc(candidateUid).get()).data();
    assert(candidateRenewal?.granted_amount === ACCELERATOR_MONTHLY_CREDITS, `Unexpected candidate renewal grant: ${JSON.stringify(candidateRenewal)}`);
    assert(candidateRenewal?.grant_source === 'paid', `Unexpected candidate renewal source: ${JSON.stringify(candidateRenewal)}`);
    console.log('  ✓ simulated candidate payment activates billing + credits');

    const repeatedCandidate = await candidateConfirmCheckout({ planKey: 'pending_accelerator' });
    assert(repeatedCandidate.data.credits === expectedCandidateCredits, `Repeat confirmation double-granted credits: ${JSON.stringify(repeatedCandidate.data)}`);
    await assertUser(candidateUid, { credits: expectedCandidateCredits });
    console.log('  ✓ repeated candidate confirmation does not double-grant credits');

    const candidatePortal = await candidateCreatePortal({});
    assert(candidatePortal.data.url === '/billing/manage', `Unexpected candidate portal URL: ${JSON.stringify(candidatePortal.data)}`);
    assert(candidatePortal.data.simulated === true, `Expected simulated candidate portal: ${JSON.stringify(candidatePortal.data)}`);
    console.log('  ✓ candidate billing management opens simulated portal');

    const candidateCancel = await candidateCancelSubscription({});
    assert(candidateCancel.data.status === 'cancelled', `Candidate cancel failed: ${JSON.stringify(candidateCancel.data)}`);
    assert(candidateCancel.data.subscription_status === 'free', `Candidate cancel did not return free plan: ${JSON.stringify(candidateCancel.data)}`);
    await assertUser(candidateUid, { role: 'candidate', subscription_status: 'free', credits: expectedCandidateCredits });
    await assertBilling(candidateUid, { active: false, status: 'cancelled_simulated' });
    console.log('  ✓ candidate simulated cancel downgrades plan and preserves credits');

    // --- One-off credit packs (SCRUM-55): grant credits, never change plan/role ---
    const PACK_500_CREDITS = 600; // mirror of config/credits.ts CREDIT_PACKS pack_500
    const creditsBeforePack = expectedCandidateCredits; // plan unchanged by cancel

    const packCheckout = await candidateCreateCheckout({
      planKey: 'pack_500',
      uiMode: 'hosted',
      operationId: CHECKOUT_OPERATION_IDS.firstCreditPack,
    });
    assert(packCheckout.data.simulated === true, `Expected simulated pack checkout: ${JSON.stringify(packCheckout.data)}`);
    assert(typeof packCheckout.data.id === 'string' && packCheckout.data.id.startsWith('sim_'), `Unexpected pack sim id: ${packCheckout.data.id}`);
    const packUrl = new URL(packCheckout.data.url, 'http://localhost');
    assert(packUrl.pathname === '/billing/checkout', `Unexpected pack checkout path: ${packCheckout.data.url}`);
    assert(packUrl.searchParams.get('pack') === 'pack_500', `Unexpected pack key: ${packCheckout.data.url}`);
    assert(packUrl.searchParams.get('kind') === 'credit_pack', `Unexpected pack kind: ${packCheckout.data.url}`);
    console.log('  ✓ simulated credit-pack checkout session returned');

    const packGrant = await candidateConfirmCheckout({ planKey: 'pack_500', sessionId: packCheckout.data.id });
    assert(packGrant.data.credits === creditsBeforePack + PACK_500_CREDITS, `Pack did not grant credits: ${JSON.stringify(packGrant.data)}`);
    assert(packGrant.data.subscription_status === 'free', `Pack must not change plan: ${JSON.stringify(packGrant.data)}`);
    assert(packGrant.data.role === 'candidate', `Pack must not change role: ${JSON.stringify(packGrant.data)}`);
    await assertUser(candidateUid, { role: 'candidate', subscription_status: 'free', credits: creditsBeforePack + PACK_500_CREDITS });
    console.log('  ✓ credit-pack confirm grants credits without changing plan or role');

    const packRepeat = await candidateConfirmCheckout({ planKey: 'pack_500', sessionId: packCheckout.data.id });
    assert(packRepeat.data.credits === creditsBeforePack + PACK_500_CREDITS, `Repeat pack confirm double-granted: ${JSON.stringify(packRepeat.data)}`);
    await assertUser(candidateUid, { credits: creditsBeforePack + PACK_500_CREDITS });
    console.log('  ✓ repeated credit-pack confirm (same session) does not double-grant');

    const packCheckout2 = await candidateCreateCheckout({
      planKey: 'pack_500',
      uiMode: 'hosted',
      operationId: CHECKOUT_OPERATION_IDS.secondCreditPack,
    });
    const packGrant2 = await candidateConfirmCheckout({ planKey: 'pack_500', sessionId: packCheckout2.data.id });
    assert(packGrant2.data.credits === creditsBeforePack + 2 * PACK_500_CREDITS, `New pack checkout did not grant again: ${JSON.stringify(packGrant2.data)}`);
    await assertUser(candidateUid, { credits: creditsBeforePack + 2 * PACK_500_CREDITS });
    console.log('  ✓ a new credit-pack checkout session grants again');

    const employerCheckout = await employerCreateCheckout({
      planKey: 'pending_biz_pro',
      uiMode: 'hosted',
      operationId: CHECKOUT_OPERATION_IDS.employerSubscription,
    });
    assertSimulatedCheckout(employerCheckout, 'pro', 'business');
    console.log('  ✓ simulated business checkout session returned');

    const activatedEmployer = await employerConfirmCheckout({ planKey: 'pending_biz_pro' });
    assert(activatedEmployer.data.status === 'active', `Business checkout did not activate: ${JSON.stringify(activatedEmployer.data)}`);
    assert(activatedEmployer.data.role === 'employer', `Business checkout did not preserve/promote employer: ${JSON.stringify(activatedEmployer.data)}`);
    assert(activatedEmployer.data.subscription_status === 'pro', `Unexpected business plan: ${JSON.stringify(activatedEmployer.data)}`);
    assert(activatedEmployer.data.grant_source === 'paid', `Expected paid business grant: ${JSON.stringify(activatedEmployer.data)}`);
    const expectedEmployerCredits = SEED_CREDITS + PRO_MONTHLY_CREDITS;
    await assertUser(employerUid, { role: 'employer', subscription_status: 'pro', credits: expectedEmployerCredits });
    await assertBilling(employerUid, { active: true, plan: 'pro', audience: 'business', provider: 'stripe', status: 'active' });
    const employerRenewal = (await db.collection('credit_renewals').doc(employerUid).get()).data();
    assert(employerRenewal?.granted_amount === PRO_MONTHLY_CREDITS, `Unexpected employer renewal grant: ${JSON.stringify(employerRenewal)}`);
    assert(employerRenewal?.grant_source === 'paid', `Unexpected employer renewal source: ${JSON.stringify(employerRenewal)}`);
    console.log('  ✓ simulated business payment activates entitlement + employer credits');

    const employerPortal = await employerCreatePortal({});
    assert(employerPortal.data.url === '/billing/manage', `Unexpected employer portal URL: ${JSON.stringify(employerPortal.data)}`);
    assert(employerPortal.data.simulated === true, `Expected simulated employer portal: ${JSON.stringify(employerPortal.data)}`);
    console.log('  ✓ employer billing management opens simulated portal');

    const employerCancel = await employerCancelSubscription({});
    assert(employerCancel.data.status === 'cancelled', `Employer cancel failed: ${JSON.stringify(employerCancel.data)}`);
    assert(employerCancel.data.subscription_status === 'free', `Employer cancel did not return free plan: ${JSON.stringify(employerCancel.data)}`);
    await assertUser(employerUid, { role: 'employer', subscription_status: 'free', credits: expectedEmployerCredits });
    await assertBilling(employerUid, { active: false, status: 'cancelled_simulated' });
    console.log('  ✓ employer simulated cancel preserves employer role and credits');
  } finally {
    await Promise.allSettled([deleteApp(candidateClient.app), deleteApp(employerClient.app)]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
