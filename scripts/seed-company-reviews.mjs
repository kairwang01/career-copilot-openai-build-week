/**
 * seed-company-reviews.mjs
 * Seeds demo company_reviews and employer_rating documents. Emulator routing
 * is the default. Production requires the allowlisted project and explicit
 * interactive or CI confirmations enforced by firebase-script-safety.
 *
 * Emulator: node scripts/seed-company-reviews.mjs
 */

import { createRequire } from 'node:module';
import { configureFirebaseScript } from './lib/firebase-script-safety.mjs';

const firebaseTarget = configureFirebaseScript({
  scriptName: 'seed-company-reviews',
  productionProjects: ['career-copilot-a3168'],
});
const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');

admin.initializeApp({ projectId: firebaseTarget.projectId });
const db = admin.firestore();

async function upsert(collection, docId, data) {
  await db.collection(collection).doc(docId).set(data, { merge: true });
}

// ── Review data ────────────────────────────────────────────────────────────────

const EMPLOYERS = [
  {
    id: 'dChmNQnLLFSIiunSlXmMnySXiql2',
    name: 'NovaSphere Technologies Inc.',
    reviews: [
      {
        uid: 'demo_candidate_001',
        tier: 'hired',
        rating: 5,
        text: 'Incredibly smooth interview process — the recruiter kept me updated at every stage. Onboarding was well-structured and the team was welcoming from day one.',
        daysAgo: 12,
      },
      {
        uid: 'demo_candidate_002',
        tier: 'offer',
        rating: 4,
        text: 'Three rounds total: a take-home, a technical screen, and a culture fit. Feedback was prompt. I ultimately declined the offer for personal reasons, but the process itself was professional and respectful.',
        daysAgo: 28,
      },
      {
        uid: 'demo_candidate_003',
        tier: 'interviewed',
        rating: 3,
        text: 'The technical interview was fair and the questions were relevant. Communication afterwards was a bit slow — took about two weeks to get a status update. Would still recommend applying.',
        daysAgo: 45,
      },
      {
        uid: 'demo_candidate_004',
        tier: 'interviewed',
        rating: 4,
        text: 'Good energy during the on-site. Interviewers were genuinely curious about my background, not just running through a checklist. HR was responsive throughout.',
        daysAgo: 60,
      },
    ],
  },
  {
    id: 'dtoxQCaGjGcO9fqZ4hAHH9W6Y852',
    name: 'Tencent IEG Gaming Group',
    reviews: [
      {
        uid: 'demo_candidate_010',
        tier: 'hired',
        rating: 4,
        text: 'Large company, so the process was more formal than a startup. Four rounds including a panel interview with the team leads. Compensation discussion was transparent and fair.',
        daysAgo: 8,
      },
      {
        uid: 'demo_candidate_011',
        tier: 'interviewed',
        rating: 2,
        text: 'The role description did not match what was discussed in the interview. Expectations around overtime were only mentioned at the final stage, which felt like a bait-and-switch. Proceed with caution.',
        daysAgo: 35,
      },
      {
        uid: 'demo_candidate_012',
        tier: 'offer',
        rating: 5,
        text: 'Excellent experience overall. The team was passionate about their projects and it showed. The technical bar was high but fair, and the interviewers gave hints when I was stuck rather than just watching me struggle.',
        daysAgo: 50,
      },
    ],
  },
];

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  for (const employer of EMPLOYERS) {
    console.log(`\n→ ${employer.name} (${employer.id})`);
    let totalRating = 0;

    for (const r of employer.reviews) {
      const docId = `${employer.id}_${r.uid}`;
      const createdAt = new Date(Date.now() - r.daysAgo * 86400_000);
      await upsert('company_reviews', docId, {
        employer_id: employer.id,
        company_name: employer.name,
        author_uid: r.uid,
        rating: r.rating,
        text: r.text,
        verification_tier: r.tier,
        verified: r.tier === 'hired',
        created_at: createdAt,
        updated_at: createdAt,
      });
      totalRating += r.rating;
      console.log(`  ✓ review by ${r.uid}  [${r.tier}]  ★${r.rating}`);
    }

    // Write the aggregate employer_rating doc (same shape as the Cloud Function trigger).
    const count = employer.reviews.length;
    const avg = Math.round((totalRating / count) * 10) / 10;
    await upsert('employer_rating', employer.id, {
      avg,
      count,
      updated_at: new Date(),
    });
    console.log(`  ✓ employer_rating: avg=${avg} count=${count}`);
  }

  console.log('\nDone. Refresh the app and browse jobs to see ratings and reviews.');
}

main().catch(e => {
  const rawCode = typeof e?.code === 'string' ? e.code : '';
  const code = /^[A-Za-z0-9_./-]{1,64}$/.test(rawCode) ? rawCode : 'unknown';
  console.error(`\nSeed failed (${code}); SDK details were suppressed.`);
  process.exit(1);
});
