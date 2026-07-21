/**
 * Firestore security-rules tests — the P0 trust boundary.
 *
 * Proves the launch-critical invariants against the real firestore.rules in the
 * emulator: a candidate cannot self-escalate role, self-grant credits/plans, or
 * post jobs; only employers post; company identity is employer-only; tool_results
 * saving is paid-tier gated; users can't read each other's docs.
 *
 * Run: firebase emulators:exec --only firestore --project demo-careercopilot \
 *        "npx vitest run tests/firestore.rules.test.ts"
 */
import { readFileSync } from 'fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore';

const PROJECT_ID = 'demo-careercopilot';
let testEnv: RulesTestEnvironment;

const ts = () => Timestamp.fromMillis(1_750_000_000_000);

const CANDIDATE = {
  role: 'candidate', credits: 100, created_at: '2026-01-01T00:00:00Z',
  subscription_status: 'free', full_name: 'Cand Idate',
};
const PAID_CANDIDATE = { ...CANDIDATE, subscription_status: 'accelerator' };
const EMPLOYER = {
  role: 'employer', credits: 100, created_at: '2026-01-01T00:00:00Z',
  subscription_status: 'free', full_name: 'Emp Loyer', company_name: 'Acme',
};

const validJob = (employerId: string) => ({
  employer_id: employerId, title: 'Senior Engineer', company_name: 'Acme',
  description: 'Build things', location: 'Remote', is_active: true,
  created_at: ts(), updated_at: ts(),
});

async function seed(uid: string, data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), data);
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(process.env.RULES_PATH || 'firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(async () => { await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); });

describe('user-doc trust boundary', () => {
  it('allows a signed-in user to self-heal a missing profile with the canonical initial grant', async () => {
    const db = testEnv.authenticatedContext('new-user').firestore();
    await assertSucceeds(setDoc(doc(db, 'users', 'new-user'), {
      role: 'candidate',
      subscription_status: 'free',
      credits: 150,
      created_at: serverTimestamp(),
      updated_at: ts(),
    }));
  });

  it('requires client-created profiles to use the request-time server timestamp', async () => {
    const db = testEnv.authenticatedContext('timestamp-forger').firestore();
    const baseProfile = {
      role: 'candidate',
      subscription_status: 'free',
      credits: 150,
      updated_at: ts(),
    };

    await assertFails(setDoc(doc(db, 'users', 'timestamp-forger'), {
      ...baseProfile,
      created_at: Timestamp.fromMillis(Date.now() + 60_000),
    }));
    await assertFails(setDoc(doc(db, 'users', 'timestamp-forger'), {
      ...baseProfile,
      created_at: new Date().toISOString(),
    }));
  });

  it('does not let profile self-healing grant more than the canonical initial balance', async () => {
    const db = testEnv.authenticatedContext('greedy-user').firestore();
    await assertFails(setDoc(doc(db, 'users', 'greedy-user'), {
      role: 'candidate',
      subscription_status: 'free',
      credits: 151,
      created_at: serverTimestamp(),
      updated_at: ts(),
    }));
  });

  it('does not let profile self-healing create an employer or agency identity', async () => {
    const db = testEnv.authenticatedContext('role-forger').firestore();
    for (const role of ['employer', 'agency']) {
      await assertFails(setDoc(doc(db, 'users', 'role-forger'), {
        role,
        subscription_status: 'free',
        credits: 150,
        created_at: serverTimestamp(),
        updated_at: ts(),
      }));
    }
  });

  it('does not let profile self-healing forge server-owned role provenance or organization trust', async () => {
    const db = testEnv.authenticatedContext('trust-forger').firestore();
    await assertFails(setDoc(doc(db, 'users', 'trust-forger'), {
      role: 'candidate',
      subscription_status: 'free',
      credits: 150,
      organization_verified: true,
      role_provenance: 'business_signup_callable',
      role_provisioned_at: ts(),
      created_at: serverTimestamp(),
      updated_at: ts(),
    }));
  });

  it('candidate CANNOT self-escalate role to employer', async () => {
    await seed('cand1', CANDIDATE);
    const db = testEnv.authenticatedContext('cand1').firestore();
    await assertFails(updateDoc(doc(db, 'users', 'cand1'), { role: 'employer', updated_at: ts() }));
  });
  it('an owner CANNOT change server-owned organization trust or role provenance', async () => {
    await seed('emp1', {
      ...EMPLOYER,
      organization_verified: false,
      role_provenance: 'business_signup_callable',
      role_provisioned_at: ts(),
    });
    const db = testEnv.authenticatedContext('emp1').firestore();
    await assertFails(updateDoc(doc(db, 'users', 'emp1'), { organization_verified: true, updated_at: ts() }));
    await assertFails(updateDoc(doc(db, 'users', 'emp1'), {
      role_provenance: 'stripe_checkout_webhook',
      updated_at: ts(),
    }));
  });
  it('candidate CANNOT self-grant credits', async () => {
    await seed('cand1', CANDIDATE);
    const db = testEnv.authenticatedContext('cand1').firestore();
    await assertFails(updateDoc(doc(db, 'users', 'cand1'), { credits: 999999 }));
  });
  it('candidate CANNOT self-upgrade subscription_status', async () => {
    await seed('cand1', CANDIDATE);
    const db = testEnv.authenticatedContext('cand1').firestore();
    await assertFails(updateDoc(doc(db, 'users', 'cand1'), { subscription_status: 'executive' }));
  });
  it('candidate CANNOT write employer company_* fields', async () => {
    await seed('cand1', CANDIDATE);
    const db = testEnv.authenticatedContext('cand1').firestore();
    await assertFails(updateDoc(doc(db, 'users', 'cand1'), { company_name: 'Google', updated_at: ts() }));
  });
  it('candidate CAN update an allowed profile field', async () => {
    await seed('cand1', CANDIDATE);
    const db = testEnv.authenticatedContext('cand1').firestore();
    await assertSucceeds(updateDoc(doc(db, 'users', 'cand1'), { full_name: 'New Name', updated_at: ts() }));
  });
  it('candidate CAN save account-backed job preferences', async () => {
    await seed('cand1', CANDIDATE);
    const db = testEnv.authenticatedContext('cand1').firestore();
    await assertSucceeds(updateDoc(doc(db, 'users', 'cand1'), {
      job_preferences: {
        status: 'active',
        roles: 'Frontend Engineer',
        locations: 'Ottawa, Remote',
        salaryMin: '90000',
        availability: '2 weeks',
      },
      updated_at: ts(),
    }));
  });
  it('candidate CANNOT save malformed job preferences', async () => {
    await seed('cand1', CANDIDATE);
    const db = testEnv.authenticatedContext('cand1').firestore();
    await assertFails(updateDoc(doc(db, 'users', 'cand1'), {
      job_preferences: {
        status: 'employer',
        roles: 'Frontend Engineer',
        locations: 'Ottawa',
        salaryMin: '90000',
        availability: '2 weeks',
      },
      updated_at: ts(),
    }));
  });
  it('candidate CAN save account profile fields through merge upsert', async () => {
    await seed('cand1', {
      ...CANDIDATE,
      created_at: ts(),
      updated_at: ts(),
      avatar_url: null,
    });
    const db = testEnv.authenticatedContext('cand1').firestore();
    await assertSucceeds(setDoc(doc(db, 'users', 'cand1'), {
      full_name: 'Runtime Saved Name',
      birth_date: '1999-04-08',
      avatar_url: null,
      updated_at: ts(),
    }, { merge: true }));
  });
  // Decisive: a candidate write that goes through the heavy validUser path (NOT the
  // small legacy path) must still ALLOW — proves the rule stays under Firestore's
  // 1000-expression ceiling for legitimate writes after the role/company hardening.
  it('candidate CAN save resume_text (heavy validUser path)', async () => {
    await seed('cand1', CANDIDATE);
    const db = testEnv.authenticatedContext('cand1').firestore();
    await assertSucceeds(updateDoc(doc(db, 'users', 'cand1'),
      { resume_text: 'x'.repeat(2000), resume_file_name: 'cv.pdf', updated_at: ts() }));
  });
  it('candidate CAN update Web3 credential fields on an extended profile doc', async () => {
    await seed('cand1', {
      ...CANDIDATE,
      phone: '+1 555 0135',
      location: 'Ottawa, ON',
      linkedin: 'https://www.linkedin.com/in/casey-candidate',
      github: 'https://github.com/casey-candidate',
      wallet_address: '0x1111111111111111111111111111111111111111',
      nft_minted: false,
      nft_staked: false,
      nft_token_id: null,
      nft_earnings: 0,
    });
    const db = testEnv.authenticatedContext('cand1').firestore();
    await assertSucceeds(updateDoc(doc(db, 'users', 'cand1'), {
      nft_minted: true,
      nft_token_id: 51153,
      updated_at: ts(),
    }));
  });
  it('candidate CANNOT use a Web3 update to self-escalate role', async () => {
    await seed('cand1', {
      ...CANDIDATE,
      wallet_address: '0x1111111111111111111111111111111111111111',
      nft_minted: false,
    });
    const db = testEnv.authenticatedContext('cand1').firestore();
    await assertFails(updateDoc(doc(db, 'users', 'cand1'), {
      role: 'employer',
      nft_minted: true,
      updated_at: ts(),
    }));
  });
  it('candidate CAN save the English Pro streak pair on an extended profile doc', async () => {
    // Rich documents pushed the full validUser() re-validation over the rules
    // evaluation limit, silently denying every streak save; the narrow delta
    // validator must keep this frequent write cheap and allowed.
    await seed('cand1', {
      ...CANDIDATE,
      phone: '+1 555 0135',
      location: 'Ottawa, ON',
      linkedin: 'https://www.linkedin.com/in/casey-candidate',
      github: 'https://github.com/casey-candidate',
      resume_text: 'Casey Candidate - Frontend Engineer with React and TypeScript delivery.',
      // Real documents carry an ISO-string updated_at from earlier client
      // writes; the streak delta must not re-validate this untouched field.
      updated_at: '2026-07-13T00:00:00.000Z',
      wallet_address: '0x1111111111111111111111111111111111111111',
      nft_minted: false,
      nft_staked: false,
      nft_token_id: null,
      nft_earnings: 0,
      english_pro_streak: 3,
      english_pro_last_practice: '2026-07-13',
    });
    const db = testEnv.authenticatedContext('cand1').firestore();
    // Mirror the real client exactly: lib/data profiles.update appends
    // updated_at, and sanitizeProfileForFirestore converts both updated_at and
    // english_pro_last_practice to Firestore timestamps on the wire.
    await assertSucceeds(updateDoc(doc(db, 'users', 'cand1'), {
      english_pro_streak: 4,
      english_pro_last_practice: new Date('2026-07-14T00:00:00.000Z'),
      updated_at: new Date('2026-07-14T09:30:00.000Z'),
    }));
    // Legacy writers persisted both fields as strings — the dual-shape check
    // must keep accepting that wire format too.
    await assertSucceeds(updateDoc(doc(db, 'users', 'cand1'), {
      english_pro_streak: 5,
      english_pro_last_practice: '2026-07-15',
      updated_at: '2026-07-15T09:30:00.000Z',
    }));
  });
  it('candidate CANNOT smuggle a role change into a streak update', async () => {
    await seed('cand1', { ...CANDIDATE, english_pro_streak: 3 });
    const db = testEnv.authenticatedContext('cand1').firestore();
    await assertFails(updateDoc(doc(db, 'users', 'cand1'), {
      english_pro_streak: 4,
      role: 'employer',
    }));
  });
  it('employer CAN update its own company_* fields', async () => {
    await seed('emp1', {
      ...EMPLOYER,
      organization_verified: false,
      role_provenance: 'business_signup_callable',
      role_provisioned_at: ts(),
    });
    const db = testEnv.authenticatedContext('emp1').firestore();
    await assertSucceeds(updateDoc(doc(db, 'users', 'emp1'), { company_name: 'Acme Corp', updated_at: ts() }));
  });
  it('a user CANNOT read another user doc', async () => {
    await seed('cand1', CANDIDATE);
    await seed('cand2', CANDIDATE);
    const db = testEnv.authenticatedContext('cand1').firestore();
    await assertFails(getDoc(doc(db, 'users', 'cand2')));
  });
});

describe('job-posting writes are server-only (createJobPosting callable)', () => {
  // Direct client writes to job_postings are now denied for EVERYONE — all
  // create/update goes through the entitlement-checked Admin-SDK callables.
  it('candidate CANNOT client-create a job posting', async () => {
    await seed('cand1', CANDIDATE);
    const db = testEnv.authenticatedContext('cand1').firestore();
    await assertFails(setDoc(doc(db, 'job_postings', 'j1'), validJob('cand1')));
  });
  it('employer CANNOT client-create a job posting (must use the callable)', async () => {
    await seed('emp1', EMPLOYER);
    const db = testEnv.authenticatedContext('emp1').firestore();
    await assertFails(setDoc(doc(db, 'job_postings', 'j1'), validJob('emp1')));
  });
  it('employer CANNOT client-update a job posting', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'job_postings', 'j1'), validJob('emp1'));
    });
    await seed('emp1', EMPLOYER);
    const db = testEnv.authenticatedContext('emp1').firestore();
    await assertFails(updateDoc(doc(db, 'job_postings', 'j1'), { title: 'Edited' }));
  });
  it('employer CAN read but CANNOT directly delete its own posting', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'job_postings', 'j1'), validJob('emp1'));
    });
    await seed('emp1', EMPLOYER);
    const db = testEnv.authenticatedContext('emp1').firestore();
    await assertSucceeds(getDoc(doc(db, 'job_postings', 'j1')));
    await assertFails(deleteDoc(doc(db, 'job_postings', 'j1')));
  });
  it('clients CANNOT read/write job_posting_events audit log', async () => {
    await seed('emp1', EMPLOYER);
    const db = testEnv.authenticatedContext('emp1').firestore();
    await assertFails(getDoc(doc(db, 'job_posting_events', 'e1')));
    await assertFails(setDoc(doc(db, 'job_posting_events', 'e1'), { job_id: 'j1', action: 'created' }));
  });
});

describe('career_path_analyses (My Roadmaps) — owner-scoped', () => {
  const validRoadmap = () => ({
    desired_role: 'Senior Product Manager',
    summary: 'A path to PM.',
    skill_gaps: [{ skill: 'Roadmapping', reason: 'Needed for PM' }],
    actionable_steps: [{ phaseTitle: 'Phase 1', estimatedDuration: '3 months', goal: 'Learn', actionableSteps: [], milestones: [] }],
    bridge_roles: [{ title: 'Associate PM', reason: 'Stepping stone' }],
    created_at: ts(),
  });

  it('owner CAN save a generated roadmap', async () => {
    await seed('cand1', CANDIDATE);
    const db = testEnv.authenticatedContext('cand1').firestore();
    await assertSucceeds(setDoc(doc(db, 'users', 'cand1', 'career_path_analyses', 'r1'), validRoadmap()));
  });
  it('owner CAN read + delete their own roadmap', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'cand1', 'career_path_analyses', 'r1'), validRoadmap());
    });
    await seed('cand1', CANDIDATE);
    const db = testEnv.authenticatedContext('cand1').firestore();
    await assertSucceeds(getDoc(doc(db, 'users', 'cand1', 'career_path_analyses', 'r1')));
  });
  it('a user CANNOT read another user roadmap', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'cand2', 'career_path_analyses', 'r1'), validRoadmap());
    });
    await seed('cand1', CANDIDATE);
    const db = testEnv.authenticatedContext('cand1').firestore();
    await assertFails(getDoc(doc(db, 'users', 'cand2', 'career_path_analyses', 'r1')));
  });
  it('roadmap save is REJECTED without desired_role / created_at (shape validation)', async () => {
    await seed('cand1', CANDIDATE);
    const db = testEnv.authenticatedContext('cand1').firestore();
    await assertFails(setDoc(doc(db, 'users', 'cand1', 'career_path_analyses', 'r1'), { summary: 'no role' }));
  });
});

describe('job-application writes are server-only', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'job_applications', 'app1'), {
        candidate_id: 'cand1',
        employer_id: 'emp1',
        job_id: 'j1',
        status: 'applied',
      });
    });
    await seed('cand1', CANDIDATE);
    await seed('emp1', EMPLOYER);
  });

  it('candidate CAN read but CANNOT directly delete their application', async () => {
    const db = testEnv.authenticatedContext('cand1').firestore();
    await assertSucceeds(getDoc(doc(db, 'job_applications', 'app1')));
    await assertFails(deleteDoc(doc(db, 'job_applications', 'app1')));
  });

  it('employer CAN read but CANNOT directly delete an application', async () => {
    const db = testEnv.authenticatedContext('emp1').firestore();
    await assertSucceeds(getDoc(doc(db, 'job_applications', 'app1')));
    await assertFails(deleteDoc(doc(db, 'job_applications', 'app1')));
  });
});

describe('saved tool_results tier gate', () => {
  it('free candidate CANNOT save a tool result', async () => {
    await seed('cand1', CANDIDATE);
    const db = testEnv.authenticatedContext('cand1').firestore();
    await assertFails(setDoc(doc(db, 'users', 'cand1', 'tool_results', 'salary-negotiation'),
      { tool_key: 'salary-negotiation', result: { plan: 'x' } }));
  });
  it('paid candidate CAN save a tool result', async () => {
    await seed('paid1', PAID_CANDIDATE);
    const db = testEnv.authenticatedContext('paid1').firestore();
    await assertSucceeds(setDoc(doc(db, 'users', 'paid1', 'tool_results', 'salary-negotiation'),
      { tool_key: 'salary-negotiation', result: { plan: 'x' } }));
  });
});

describe('saved Showcase portfolios access', () => {
  const validPortfolio = (uid: string, id = 'portfolio_1') => ({
    version: 1,
    name: 'June Portfolio',
    theme: 'sapphire',
    html_path: `portfolio-sites/${uid}/${id}/showcase.html`,
    resume_fingerprint: '12:abc',
    created_at: ts(),
    updated_at: ts(),
  });

  it('owner CAN save and read a portfolio metadata document', async () => {
    await seed('cand1', CANDIDATE);
    const db = testEnv.authenticatedContext('cand1').firestore();
    await assertSucceeds(setDoc(doc(db, 'users', 'cand1', 'portfolios', 'portfolio_1'), validPortfolio('cand1')));
    await assertSucceeds(getDoc(doc(db, 'users', 'cand1', 'portfolios', 'portfolio_1')));
  });

  it('another user CANNOT read or write your portfolio metadata', async () => {
    await seed('cand1', CANDIDATE);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'cand1', 'portfolios', 'portfolio_1'), validPortfolio('cand1'));
    });
    const other = testEnv.authenticatedContext('other').firestore();
    await assertFails(getDoc(doc(other, 'users', 'cand1', 'portfolios', 'portfolio_1')));
    await assertFails(setDoc(doc(other, 'users', 'cand1', 'portfolios', 'portfolio_2'), validPortfolio('cand1', 'portfolio_2')));
    await assertFails(deleteDoc(doc(other, 'users', 'cand1', 'portfolios', 'portfolio_1')));
  });

  it('owner CAN delete a saved portfolio metadata document', async () => {
    await seed('cand1', CANDIDATE);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'cand1', 'portfolios', 'portfolio_1'), validPortfolio('cand1'));
    });
    const db = testEnv.authenticatedContext('cand1').firestore();
    await assertSucceeds(deleteDoc(doc(db, 'users', 'cand1', 'portfolios', 'portfolio_1')));
  });

  it('owner CANNOT update or schema-pollute saved portfolio metadata', async () => {
    await seed('cand1', CANDIDATE);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'cand1', 'portfolios', 'portfolio_1'), validPortfolio('cand1'));
    });
    const db = testEnv.authenticatedContext('cand1').firestore();
    await assertFails(updateDoc(doc(db, 'users', 'cand1', 'portfolios', 'portfolio_1'), { name: 'Edited' }));
    await assertFails(setDoc(doc(db, 'users', 'cand1', 'portfolios', 'portfolio_2'), {
      ...validPortfolio('cand1', 'portfolio_2'),
      extra: 'nope',
    }));
  });
});

describe('interview_sessions history access', () => {
  const validSession = {
    started_at: ts(),
    market_name: 'Canada',
    job_description: 'Job Title: Product Manager',
    overall_summary: 'Clear STAR structure with one measurable result.',
    exchanges: [
      { question: 'Tell me about a project.', answer: 'I led the launch.', score: 82, feedback: 'Good structure.' },
    ],
  };

  it('the owner CAN save and read a mock-interview session', async () => {
    const db = testEnv.authenticatedContext('cand1').firestore();
    await assertSucceeds(setDoc(doc(db, 'users', 'cand1', 'interview_sessions', 'session1'), validSession));
    await assertSucceeds(getDoc(doc(db, 'users', 'cand1', 'interview_sessions', 'session1')));
  });

  it('another user CANNOT read or write your mock-interview history', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'cand1', 'interview_sessions', 'session1'), validSession);
    });
    const other = testEnv.authenticatedContext('other').firestore();
    await assertFails(getDoc(doc(other, 'users', 'cand1', 'interview_sessions', 'session1')));
    await assertFails(setDoc(doc(other, 'users', 'cand1', 'interview_sessions', 'session2'), validSession));
  });
});

describe('application_interviews access', () => {
  async function seedInterview() {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'application_interviews', 'iv1'),
        { application_id: 'app1', employer_id: 'emp1', candidate_id: 'cand1', interview_status: 'scheduled' });
    });
  }
  it('the candidate on the interview can read it', async () => {
    await seedInterview();
    await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('cand1').firestore(), 'application_interviews', 'iv1')));
  });
  it('the owning employer can read it', async () => {
    await seedInterview();
    await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('emp1').firestore(), 'application_interviews', 'iv1')));
  });
  it('the owning employer can list interviews when the query is scoped to their uid', async () => {
    await seedInterview();
    const db = testEnv.authenticatedContext('emp1').firestore();
    await assertSucceeds(getDocs(query(
      collection(db, 'application_interviews'),
      where('application_id', '==', 'app1'),
      where('employer_id', '==', 'emp1'),
    )));
  });
  it('clients CANNOT list application interviews without participant scoping', async () => {
    await seedInterview();
    const db = testEnv.authenticatedContext('emp1').firestore();
    await assertFails(getDocs(query(
      collection(db, 'application_interviews'),
      where('application_id', '==', 'app1'),
    )));
  });
  it('an unrelated user CANNOT read it', async () => {
    await seedInterview();
    await assertFails(getDoc(doc(testEnv.authenticatedContext('other').firestore(), 'application_interviews', 'iv1')));
  });
  it('clients CANNOT write interviews directly (server-only)', async () => {
    await seedInterview();
    const db = testEnv.authenticatedContext('emp1').firestore();
    await assertFails(setDoc(doc(db, 'application_interviews', 'iv2'), { application_id: 'app1', employer_id: 'emp1', candidate_id: 'cand1' }));
    await assertFails(updateDoc(doc(db, 'application_interviews', 'iv1'), { interview_status: 'cancelled' }));
  });
});

describe('API platform registry is server-only', () => {
  it('clients CANNOT read or write API applications, keys, or usage logs directly', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'api_applications', 'app1'), { name: 'Partner', created_at: ts() });
      await setDoc(doc(ctx.firestore(), 'api_keys', 'key1'), { prefix: 'cc_dev_abcd', secret_hash: 'x', created_at: ts() });
      await setDoc(doc(ctx.firestore(), 'api_usage_logs', 'log1'), { endpoint: '/v1/jobs', timestamp: ts() });
    });
    const db = testEnv.authenticatedContext('adminish').firestore();
    await assertFails(getDoc(doc(db, 'api_applications', 'app1')));
    await assertFails(setDoc(doc(db, 'api_applications', 'app2'), { name: 'Forged' }));
    await assertFails(getDoc(doc(db, 'api_keys', 'key1')));
    await assertFails(updateDoc(doc(db, 'api_keys', 'key1'), { status: 'active' }));
    await assertFails(getDoc(doc(db, 'api_usage_logs', 'log1')));
    await assertFails(setDoc(doc(db, 'api_usage_logs', 'log2'), { endpoint: '/v1/users' }));
  });
});

describe('platform Web3 config is callable-only', () => {
  it('clients CANNOT read or write platform_config/web3 directly', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'platform_config', 'web3'), { enabled: true, updated_at: ts() });
    });
    const db = testEnv.authenticatedContext('super-looking-user').firestore();
    await assertFails(getDoc(doc(db, 'platform_config', 'web3')));
    await assertFails(setDoc(doc(db, 'platform_config', 'web3'), { enabled: false }));
    await assertFails(updateDoc(doc(db, 'platform_config', 'web3'), { enabled: false }));
  });
});

describe('application_scorecards access', () => {
  async function seedScorecard() {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'application_scorecards', 'sc1'),
        { application_id: 'app1', employer_id: 'emp1', candidate_id: 'cand1', interview_id: 'iv1', recommendation: 'hire' });
    });
  }
  it('the owning employer can read a scorecard', async () => {
    await seedScorecard();
    await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('emp1').firestore(), 'application_scorecards', 'sc1')));
  });
  it('the candidate CANNOT read the employer scorecard', async () => {
    await seedScorecard();
    await assertFails(getDoc(doc(testEnv.authenticatedContext('cand1').firestore(), 'application_scorecards', 'sc1')));
  });
  it('an unrelated employer CANNOT read it', async () => {
    await seedScorecard();
    await assertFails(getDoc(doc(testEnv.authenticatedContext('emp2').firestore(), 'application_scorecards', 'sc1')));
  });
  it('clients CANNOT write scorecards directly (server-only)', async () => {
    await seedScorecard();
    const db = testEnv.authenticatedContext('emp1').firestore();
    await assertFails(setDoc(doc(db, 'application_scorecards', 'sc2'), { application_id: 'app1', employer_id: 'emp1', candidate_id: 'cand1' }));
    await assertFails(updateDoc(doc(db, 'application_scorecards', 'sc1'), { recommendation: 'strong_hire' }));
  });
});

describe('hidden_candidates (Talent Discovery hide) access', () => {
  it('the owner can hide, read, and un-hide a candidate', async () => {
    const db = testEnv.authenticatedContext('emp1').firestore();
    await assertSucceeds(setDoc(doc(db, 'users', 'emp1', 'hidden_candidates', 'cand9'), { hidden_at: ts() }));
    await assertSucceeds(getDoc(doc(db, 'users', 'emp1', 'hidden_candidates', 'cand9')));
  });
  it('another employer CANNOT read or write your hidden set', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'emp1', 'hidden_candidates', 'cand9'), { hidden_at: ts() });
    });
    const other = testEnv.authenticatedContext('emp2').firestore();
    await assertFails(getDoc(doc(other, 'users', 'emp1', 'hidden_candidates', 'cand9')));
    await assertFails(setDoc(doc(other, 'users', 'emp1', 'hidden_candidates', 'cand10'), { hidden_at: ts() }));
  });
});

describe('application_messages access', () => {
  async function seedMessage() {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'application_messages', 'msg1'),
        { application_id: 'app1', employer_id: 'emp1', candidate_id: 'cand1', sender_role: 'employer', body: 'Hello', created_at: ts() });
    });
  }
  it('the candidate on the application can read the message', async () => {
    await seedMessage();
    await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('cand1').firestore(), 'application_messages', 'msg1')));
  });
  it('the owning employer can read the message', async () => {
    await seedMessage();
    await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('emp1').firestore(), 'application_messages', 'msg1')));
  });
  it('the owning employer can list a thread when the query is scoped to their uid', async () => {
    await seedMessage();
    const db = testEnv.authenticatedContext('emp1').firestore();
    await assertSucceeds(getDocs(query(
      collection(db, 'application_messages'),
      where('application_id', '==', 'app1'),
      where('employer_id', '==', 'emp1'),
      orderBy('created_at', 'asc'),
    )));
  });
  it('the candidate can list a thread when the query is scoped to their uid', async () => {
    await seedMessage();
    const db = testEnv.authenticatedContext('cand1').firestore();
    await assertSucceeds(getDocs(query(
      collection(db, 'application_messages'),
      where('application_id', '==', 'app1'),
      where('candidate_id', '==', 'cand1'),
      orderBy('created_at', 'asc'),
    )));
  });
  it('clients CANNOT list application messages without participant scoping', async () => {
    await seedMessage();
    const db = testEnv.authenticatedContext('emp1').firestore();
    await assertFails(getDocs(query(
      collection(db, 'application_messages'),
      where('application_id', '==', 'app1'),
      orderBy('created_at', 'asc'),
    )));
  });
  it('an unrelated user CANNOT read the thread', async () => {
    await seedMessage();
    await assertFails(getDoc(doc(testEnv.authenticatedContext('other').firestore(), 'application_messages', 'msg1')));
  });
  it('clients CANNOT write messages directly (server-only — sendApplicationMessage callable)', async () => {
    await seedMessage();
    const db = testEnv.authenticatedContext('emp1').firestore();
    await assertFails(setDoc(doc(db, 'application_messages', 'msg2'), { application_id: 'app1', employer_id: 'emp1', candidate_id: 'cand1', body: 'forged' }));
    await assertFails(updateDoc(doc(db, 'application_messages', 'msg1'), { body: 'edited' }));
  });
});

describe('sourcing_outreach access', () => {
  async function seedOutreach() {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'sourcing_outreach', 'out1'),
        { employer_id: 'emp1', candidate_id: 'cand1', status: 'requested', message: 'Interested in connecting' });
    });
  }
  it('the requested candidate can read the outreach request', async () => {
    await seedOutreach();
    await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('cand1').firestore(), 'sourcing_outreach', 'out1')));
  });
  it('the requesting employer can read the outreach request', async () => {
    await seedOutreach();
    await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('emp1').firestore(), 'sourcing_outreach', 'out1')));
  });
  it('the requested candidate can list their outreach requests', async () => {
    await seedOutreach();
    const db = testEnv.authenticatedContext('cand1').firestore();
    await assertSucceeds(getDocs(query(
      collection(db, 'sourcing_outreach'),
      where('candidate_id', '==', 'cand1'),
      limit(200),
    )));
  });
  it('the requesting employer can list their outreach requests', async () => {
    await seedOutreach();
    const db = testEnv.authenticatedContext('emp1').firestore();
    await assertSucceeds(getDocs(query(
      collection(db, 'sourcing_outreach'),
      where('employer_id', '==', 'emp1'),
      limit(200),
    )));
  });
  it('an unrelated user CANNOT read the outreach request', async () => {
    await seedOutreach();
    await assertFails(getDoc(doc(testEnv.authenticatedContext('other').firestore(), 'sourcing_outreach', 'out1')));
  });
  it('clients CANNOT create or mutate consent state directly', async () => {
    await seedOutreach();
    const emp = testEnv.authenticatedContext('emp1').firestore();
    const cand = testEnv.authenticatedContext('cand1').firestore();
    await assertFails(setDoc(doc(emp, 'sourcing_outreach', 'out2'), { employer_id: 'emp1', candidate_id: 'cand1', status: 'requested' }));
    await assertFails(updateDoc(doc(cand, 'sourcing_outreach', 'out1'), { status: 'accepted' }));
  });
});

describe('server-only compensation and consent packet records', () => {
  const collections = [
    'sourcing_candidate_packets',
    'sourcing_outreach_pair_guards',
    'sourcing_outreach_daily_quotas',
    'billing_fulfillment_reviews',
    'credit_refund_reviews',
    'usage_counter_reconciliation_reviews',
  ];

  it('denies every signed-in client read and write even when its uid is on the record', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      for (const collectionName of collections) {
        await setDoc(doc(ctx.firestore(), collectionName, 'record1'), {
          uid: 'cand1',
          candidate_id: 'cand1',
          employer_id: 'emp1',
          status: 'pending',
        });
      }
    });

    for (const collectionName of collections) {
      for (const uid of ['cand1', 'emp1']) {
        const db = testEnv.authenticatedContext(uid).firestore();
        await assertFails(getDoc(doc(db, collectionName, 'record1')));
        await assertFails(setDoc(doc(db, collectionName, 'record2'), { uid, status: 'resolved' }));
      }
    }
  });
});
