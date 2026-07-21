/**
 * seedCandidates.js — provision TEST candidate accounts with realistic resumes
 * so the employer "Discover Talent" search has data to match against.
 *
 * Talent discovery reads candidates SERVER-SIDE (discoverTalent callable); it
 * needs users with role 'candidate' and a non-trivial resume_text. A couple of
 * seeds are nft_staked so the "Verified Talent" rail is populated too.
 *
 * Usage (dry-run by default):
 *   cd functions
 *   node scripts/seedCandidates.js [count=6]
 *   TEST_CANDIDATE_PASSWORD='<strong-local-password>' \
 *     node scripts/seedCandidates.js [count=6] --apply
 *
 * This script is emulator-only. Passwords are accepted only through the
 * TEST_CANDIDATE_PASSWORD environment variable and are never printed.
 */

/* eslint-disable no-console */
const admin = require("firebase-admin");

const SCRIPT_NAME = "seedCandidates";

const PROFILES = [
  {
    name: "Linh Tran",
    staked: true,
    resume: `Linh Tran — Senior Frontend Engineer (Ho Chi Minh City)

SUMMARY
Frontend engineer with 6 years building consumer web apps. Led the React migration of an e-commerce platform serving 2M MAU; cut LCP from 4.1s to 1.8s.

EXPERIENCE
Senior Frontend Engineer, ShopViet (2022–present)
- Led a 5-person squad rebuilding checkout in React 18 + TypeScript; conversion +12%.
- Introduced design tokens and a shared component library used by 4 teams.
- Drove Core Web Vitals work: code-splitting, image CDN, optimistic UI.

Frontend Engineer, FinPay (2019–2022)
- Built the KYC onboarding flow (React, Redux) used by 800k users.
- Paired with designers on a WCAG 2.1 AA accessibility pass.

SKILLS
React, TypeScript, Next.js, Tailwind, Vitest, Playwright, GraphQL, CI/CD (GitHub Actions)

EDUCATION
B.Sc. Computer Science, Vietnam National University`,
  },
  {
    name: "Carlos Mendoza",
    staked: true,
    resume: `Carlos Mendoza — Backend Engineer (Toronto, ON)

SUMMARY
Backend engineer, 5 years, Node.js/Java microservices on AWS. Strong on payments and reliability (on-call lead, 99.95% SLO).

EXPERIENCE
Backend Engineer II, NorthPay (2021–present)
- Owns the settlement service (Node.js, PostgreSQL, SQS); processes $40M/month.
- Designed idempotent retry/ledger reconciliation; chargeback errors -70%.
- Mentors 2 juniors; runs the team's incident reviews.

Software Developer, LogiTrack (2019–2021)
- Built route-optimization APIs (Java, Spring Boot, Redis) for 1,200 fleet vehicles.

SKILLS
Node.js, TypeScript, Java, Spring Boot, PostgreSQL, Redis, AWS (ECS, SQS, Lambda), Terraform, Datadog

EDUCATION
B.Eng. Software Engineering, University of Ottawa`,
  },
  {
    name: "Aisha Patel",
    staked: false,
    resume: `Aisha Patel — Data Engineer (Remote, Canada)

SUMMARY
Data engineer with 4 years building lakehouse pipelines. Migrated a retailer's nightly ETL to streaming, freshness from 24h to 15min.

EXPERIENCE
Data Engineer, RetailCo (2022–present)
- Built CDC ingestion (Debezium → Kafka → Spark) across 30 sources.
- dbt models powering finance dashboards; documented 200+ models.
- Cut warehouse spend 35% via clustering and incremental models.

Analytics Engineer, AdSight (2020–2022)
- Owned attribution pipelines (Airflow, BigQuery); SLA 99.9%.

SKILLS
Python, SQL, Spark, Kafka, dbt, Airflow, BigQuery, Snowflake, Terraform

EDUCATION
B.Sc. Statistics, University of Waterloo`,
  },
  {
    name: "Minh Nguyen",
    staked: false,
    resume: `Minh Nguyen — Full-stack Developer (Hanoi / Remote)

SUMMARY
Full-stack developer, 3 years, React + Node. Shipped a B2B SaaS dashboard end-to-end as employee #3 at a startup.

EXPERIENCE
Full-stack Developer, CloudDesk (2022–present)
- Built multi-tenant auth (Firebase), billing (Stripe), and an admin console.
- Wrote the public REST API + docs; 40 external integrations.

Junior Developer, WebStudio (2021–2022)
- Delivered 10+ client sites (Next.js, Tailwind); Lighthouse 95+.

SKILLS
React, Node.js, TypeScript, Firebase, Stripe, PostgreSQL, Docker, Next.js

EDUCATION
B.Sc. Information Technology, Hanoi University of Science and Technology`,
  },
  {
    name: "Sofia Rossi",
    staked: false,
    resume: `Sofia Rossi — Product Designer → UX Engineer (Ottawa, ON)

SUMMARY
Hybrid designer-engineer, 4 years. Designs in Figma, ships in React. Led the design system that cut feature design-to-dev handoff from 2 weeks to 3 days.

EXPERIENCE
UX Engineer, HealthHub (2022–present)
- Owns the 80-component design system (React, Storybook, tokens).
- Ran 20+ usability sessions; redesigned onboarding, activation +18%.

Product Designer, Apply (2020–2022)
- End-to-end design for a job-application tracker (10k users).

SKILLS
Figma, React, TypeScript, Storybook, CSS architecture, usability testing, WCAG accessibility

EDUCATION
B.Des. Interaction Design, Carleton University`,
  },
  {
    name: "David Kim",
    staked: false,
    resume: `David Kim — DevOps / Platform Engineer (Vancouver, BC)

SUMMARY
Platform engineer, 7 years. Built internal developer platforms on Kubernetes; deploy frequency from weekly to 30+/day.

EXPERIENCE
Staff Platform Engineer, StreamWorks (2021–present)
- Designed the golden-path CI/CD (GitHub Actions, ArgoCD, Helm) for 25 teams.
- Cut cloud spend 28% (rightsizing, spot, autoscaling); SOC 2 controls owner.

DevOps Engineer, GameForge (2018–2021)
- Ran game backend infra (GKE, Terraform) for 5M players; led zero-downtime migrations.

SKILLS
Kubernetes, Terraform, AWS/GCP, ArgoCD, Helm, GitHub Actions, Prometheus/Grafana, Go, Python

EDUCATION
B.Sc. Computer Science, UBC`,
  },
];

async function upsertCandidate(i, password, isAuthUserNotFound) {
  const p = PROFILES[i % PROFILES.length];
  const email = `candidate-test-${i + 1}@career-copilot.test`;
  const auth = admin.auth();

  let user;
  try {
    user = await auth.getUserByEmail(email);
    console.log(`  • exists: ${email} (${user.uid})`);
  } catch (error) {
    if (!isAuthUserNotFound(error)) throw error;
    user = await auth.createUser({ email, password, displayName: p.name });
    console.log(`  + created: ${email} (${user.uid})`);
  }

  // Rules-shape-compliant candidate doc (admin writes bypass rules, but later
  // client edits must still validate against validUser).
  await admin.firestore().collection("users").doc(user.uid).set(
    {
      role: "candidate",
      full_name: p.name,
      email,
      resume_text: p.resume,
      nft_staked: p.staked,
      english_pro_streak: 0,
      credits: 100,
      subscription_status: "free",
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return { email, uid: user.uid, staked: p.staked };
}

(async () => {
  const {
    assertMaximumPositionals,
    isAuthUserNotFound,
    OperationSafetyError,
    parseBoundedInteger,
    positionalArguments,
    prepareFirebaseOperation,
    printDryRun,
    readOption,
    requirePasswordFromEnvironment,
    safeFailureMessage,
  } = await import("./guardedFirebaseOperation.mjs");

  try {
    const argv = process.argv.slice(2);
    if (readOption(argv, "--password") !== undefined) {
      throw new OperationSafetyError(
        SCRIPT_NAME,
        "Command-line passwords are refused; use TEST_CANDIDATE_PASSWORD.",
      );
    }
    const positional = positionalArguments(argv, ["--count", "--password"]);
    assertMaximumPositionals(positional, 1, SCRIPT_NAME);
    const count = parseBoundedInteger(readOption(argv, "--count") || positional[0], {
      scriptName: SCRIPT_NAME,
      label: "count",
      minimum: 1,
      maximum: 20,
      fallback: 6,
    });
    const operation = prepareFirebaseOperation({
      scriptName: SCRIPT_NAME,
      action: "SEED_SYNTHETIC_CANDIDATES",
      subject: `${count}-candidates`,
      argv,
      allowProduction: false,
    });
    if (operation.dryRun) {
      printDryRun(operation);
      console.log(`Planned synthetic candidate count: ${count}`);
      return;
    }

    const password = requirePasswordFromEnvironment({
      env: process.env,
      name: "TEST_CANDIDATE_PASSWORD",
      scriptName: SCRIPT_NAME,
      apply: true,
    });
    admin.initializeApp({ projectId: operation.projectId });

    const out = [];
    for (let index = 0; index < count; index += 1) {
      out.push(await upsertCandidate(index, password, isAuthUserNotFound));
    }
    const staked = out.filter((candidate) => candidate.staked).length;
    console.log(
      `Seeded ${out.length} candidates (${staked} verified/staked) in the local emulator.`,
    );
    console.log("The shared password was read from TEST_CANDIDATE_PASSWORD and not printed.");
  } catch (error) {
    console.error(safeFailureMessage(error));
    process.exitCode = 1;
  }
})();
