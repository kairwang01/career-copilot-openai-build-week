// One-off QA seed (emulator only): give the candidate a connected wallet + a
// high-scoring resume analysis so the Web3 preview credential's mint-eligibility
// gate opens. Run AFTER seed-emulator.mjs, against the running emulators.
import { createRequire } from 'module';
import { configureFirebaseScript } from './lib/firebase-script-safety.mjs';
import { buildWeb3EligibleAnalysis } from './lib/resume-analysis-fixtures.mjs';

const firebaseTarget = configureFirebaseScript({ scriptName: 'seed-web3-preview' });
const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');

admin.initializeApp({ projectId: firebaseTarget.projectId });
const auth = admin.auth();
const db = admin.firestore();

const candidate = await auth.getUserByEmail('candidate@careercopilot.test');
const now = new Date().toISOString();
const walletAddress = '0x1111111111111111111111111111111111111111';

await db.collection('platform_config').doc('web3').set(
  {
    enabled: true,
    network: 'sepolia',
    chain_id: 11155111,
    contract_address: '0x2A3b1A43842238321a22542a035921A362358189',
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_by: 'seed-web3-preview',
  },
  { merge: true },
);

await db.collection('users').doc(candidate.uid).set(
  {
    wallet_address: walletAddress,
    resume_text: 'QA seed resume text for Web3 preview eligibility. Project leadership, measurable delivery, and strong technical evidence.',
    nft_minted: false,
    nft_staked: false,
    nft_earnings: 0,
    nft_token_id: null,
    updated_at: now,
  },
  { merge: true },
);

await db
  .collection('users')
  .doc(candidate.uid)
  .collection('resume_analyses')
  .doc('qa-web3-eligible')
  .set(buildWeb3EligibleAnalysis({
    createdAt: admin.firestore.Timestamp.now(),
    summary: 'QA seed — high score to unlock the Proof-of-Talent credential.',
  }));

console.log(`Enabled Web3 preview and seeded wallet + score-90 analysis for candidate ${candidate.uid}`);
