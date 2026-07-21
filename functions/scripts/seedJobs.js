/**
 * Seed realistic tech job postings for QA / browsing by Abi.
 *
 * PREREQUISITE
 *   A business/employer account must exist in the local Auth and Firestore
 *   emulators. Use that account's UID as the first argument.
 *
 * USAGE (run from the functions/ directory)
 *   node scripts/seedJobs.js <employerUid> [count=12]          # dry-run
 *   node scripts/seedJobs.js <employerUid> [count=12] --apply  # emulator write
 *
 *   Examples:
 *     node scripts/seedJobs.js abc123UID          # seeds 12 postings
 *     node scripts/seedJobs.js abc123UID 20       # seeds 20 postings
 *
 * NOTES
 *   - Admin SDK bypasses Firestore security rules, but documents are written
 *     with exactly the fields allowed by validJobPosting (firestore.rules):
 *       required : employer_id, title, is_active, created_at, updated_at
 *       optional : description, location, salary_range
 *     NO extra fields (e.g. seeded:true) are added — the hasOnly check in the
 *     update rule would otherwise block employer edits from the client later.
 *   - To clean up, delete the printed document IDs from the Firestore console
 *     (or build a companion deleteSeededJobs.js that accepts the ids).
 *   - Production mode is intentionally refused.
 *   - Deterministic document IDs make repeated runs idempotent for the same count.
 */

const admin = require("firebase-admin");

const SCRIPT_NAME = "seedJobs";

// ---------------------------------------------------------------------------
// Job templates (ITviec-style realistic tech postings)
// ---------------------------------------------------------------------------
const TEMPLATES = [
  // ── Frontend ────────────────────────────────────────────────────────────
  {
    title: "Senior Frontend Engineer (React / TypeScript)",
    location: "Toronto, ON (Hybrid)",
    salary_range: "CAD 100k–130k/yr",
    description: `We are looking for a Senior Frontend Engineer to join our product team in Toronto. You will own the UI layer for our flagship SaaS dashboard, working closely with Product and Design to ship pixel-perfect features.

**Responsibilities**
- Design and build reusable React / TypeScript components consumed across multiple product surfaces
- Lead frontend architecture decisions: state management, performance budgets, accessibility standards
- Mentor junior engineers through code reviews and pair programming sessions
- Collaborate with the backend team on API contract design (REST + GraphQL)

**Requirements**
- 4+ years of production React experience; strong TypeScript fundamentals
- Familiarity with testing (Vitest / Jest, React Testing Library, Playwright)
- Experience with CI/CD pipelines (GitHub Actions, Vercel / Netlify)
- Nice to have: Tailwind CSS, Storybook, Figma handoffs`,
  },
  {
    title: "Frontend Developer (Vue 3)",
    location: "Ho Chi Minh City, Vietnam",
    salary_range: "USD 2,000–3,200/mo",
    description: `Join a fast-growing fintech startup building the next generation of digital wallet experiences for Southeast Asia. You will work on a high-traffic consumer app touching millions of users.

**Responsibilities**
- Develop and maintain Vue 3 / Pinia components across mobile-web and desktop
- Optimize Lighthouse scores and Core Web Vitals for production
- Integrate with RESTful APIs and WebSocket streams for real-time balance updates
- Write unit and e2e tests; maintain > 80% branch coverage

**Requirements**
- 2+ years experience with Vue 2/3 or similar component framework
- Solid understanding of browser rendering, CSS layout (Grid, Flexbox)
- Experience with i18n libraries (vue-i18n) preferred
- Comfortable reading backend code (Node.js or Python)`,
  },
  {
    title: "Junior Frontend Engineer",
    location: "Remote (Canada)",
    salary_range: "CAD 65k–80k/yr",
    description: `Great opportunity for a new grad or junior developer looking to level up in a supportive, fully-remote environment. You will contribute to an open-source developer tooling product used by thousands of engineers.

**Responsibilities**
- Build features using React and Vite guided by senior team members
- Write clear, readable code with inline documentation
- Participate in sprint planning and retrospectives
- Squash UI bugs reported by the community

**Requirements**
- Proficient in HTML, CSS, JavaScript (ES2020+)
- Some React experience (personal projects or internship counts)
- Familiarity with Git / GitHub workflow
- Strong written communication skills for async remote collaboration`,
  },

  // ── Backend ─────────────────────────────────────────────────────────────
  {
    title: "Backend Engineer – Node.js / Firebase",
    location: "Ottawa, ON (On-site)",
    salary_range: "CAD 90k–115k/yr",
    description: `We are a government-adjacent SaaS company headquartered in Ottawa. As a Backend Engineer you will design and operate Cloud Functions, Firestore data models, and pub/sub pipelines that process thousands of events per minute.

**Responsibilities**
- Author, deploy, and monitor Firebase Cloud Functions (Node.js 20)
- Design Firestore schemas with cost-efficient read/write patterns
- Build secure, tested callable and HTTP functions; maintain security rules
- Participate in on-call rotation and lead incident post-mortems

**Requirements**
- 3+ years Node.js (TypeScript preferred); working knowledge of Firebase ecosystem
- Understanding of NoSQL data modelling trade-offs
- Familiarity with IAM, Secret Manager, and Cloud Monitoring on GCP
- Past experience with security-sensitive government or fintech projects is a plus`,
  },
  {
    title: "Java Backend Developer (Spring Boot)",
    location: "Toronto, ON (Hybrid)",
    salary_range: "CAD 95k–125k/yr",
    description: `Our enterprise analytics platform processes petabytes of financial data daily. We need a Java developer who values clean architecture and is comfortable wading into legacy codebases.

**Responsibilities**
- Develop microservices with Spring Boot 3 and Java 21
- Write JUnit 5 and Testcontainers integration tests to ensure regression safety
- Optimize JDBC / Hibernate queries for multi-million-row tables
- Participate in architecture reviews for new domain services

**Requirements**
- 4+ years Java development with Spring ecosystem (Boot, Data JPA, Security)
- Solid understanding of REST API design and OpenAPI specs
- Experience with message queues (Kafka or RabbitMQ)
- Familiarity with Docker and Kubernetes is a strong asset`,
  },
  {
    title: "Backend Engineer – Python / FastAPI",
    location: "Ho Chi Minh City, Vietnam",
    salary_range: "USD 2,500–4,000/mo",
    description: `Scale-up e-commerce platform serving 5M+ monthly active buyers seeks a Python backend engineer to accelerate our order management and recommendation systems.

**Responsibilities**
- Build and maintain FastAPI services running on Cloud Run
- Design Postgres schemas and write SQLAlchemy ORM migrations
- Integrate with third-party logistics and payment APIs
- Implement background tasks with Celery / Redis for async processing

**Requirements**
- 3+ years Python (asyncio, FastAPI or Flask/Django)
- PostgreSQL query tuning; familiar with EXPLAIN ANALYZE
- Docker-based local development; CI with GitHub Actions
- Experience with feature flags and A/B test infrastructure is a bonus`,
  },

  // ── Full-stack ────────────────────────────────────────────────────────────
  {
    title: "Full-Stack Developer (React + Node.js)",
    location: "Remote (Global)",
    salary_range: "USD 3,000–5,000/mo",
    description: `Early-stage product startup looking for a versatile full-stack developer who thrives in ambiguity and can own features end-to-end.

**Responsibilities**
- Ship features across React frontend and Express / Firebase backend with minimal handoffs
- Design database schemas (Firestore / Postgres) and write migrations
- Implement authentication flows, role-based access control, and billing integrations (Stripe)
- Contribute to DevOps: CI pipelines, preview environments, staging → production deploys

**Requirements**
- 3+ years full-stack experience (any modern framework pair)
- Comfortable switching context between frontend and backend in the same sprint
- Solid grasp of HTTP, JSON APIs, and OAuth 2.0
- Experience with cloud hosting (Firebase, Vercel, Railway, Render, or similar)`,
  },
  {
    title: "Full-Stack Engineer – EdTech Platform",
    location: "Ottawa, ON (Hybrid)",
    salary_range: "CAD 85k–110k/yr",
    description: `We build AI-assisted learning tools for universities across Canada. Join us to work on a mission-driven product that measurably improves student outcomes.

**Responsibilities**
- Develop new LMS integrations (Canvas, Brightspace) using REST and LTI 1.3
- Build instructor dashboards in React with real-time WebSocket updates
- Design and maintain Cloud Functions for automated assessment workflows
- Collaborate with data science team on prompt engineering for AI tutoring features

**Requirements**
- 3+ years full-stack (React + Node.js or Python backend)
- Experience consuming or building REST / GraphQL APIs
- Ability to write clear technical documentation for third-party integrators
- Background in education or EdTech is a strong differentiator`,
  },

  // ── Mobile ───────────────────────────────────────────────────────────────
  {
    title: "React Native Mobile Developer",
    location: "Toronto, ON (Remote-first)",
    salary_range: "CAD 95k–120k/yr",
    description: `Consumer health-tech company building a top-ranked wellness app on iOS and Android. We value product-minded engineers who care about craft and user delight.

**Responsibilities**
- Build and maintain React Native (Expo) features for iOS and Android
- Integrate with REST APIs and Firebase Realtime Database for offline-first data sync
- Optimize app startup time and memory footprint; profile with Xcode Instruments and Android Studio
- Coordinate with App Store / Play Store release pipeline and handle OTA updates

**Requirements**
- 3+ years React Native production experience
- Deep familiarity with native modules, bridging, and platform-specific quirks
- Experience with push notifications (FCM / APNs) and deep links
- Accessibility (a11y) best practices for mobile is a strong asset`,
  },
  {
    title: "iOS Developer (Swift / SwiftUI)",
    location: "Ho Chi Minh City, Vietnam",
    salary_range: "USD 2,200–3,500/mo",
    description: `Fast-growing ride-hailing super-app looking for an iOS developer to work on driver and passenger experiences used by hundreds of thousands of riders daily.

**Responsibilities**
- Build SwiftUI views and UIKit components for high-traffic consumer flows
- Integrate MapKit, CoreLocation, and push notification services
- Write snapshot and UI tests with XCTest
- Profile and fix memory leaks and energy-inefficient background tasks

**Requirements**
- 2+ years Swift / SwiftUI production experience
- Comfortable reading Objective-C for legacy code paths
- Experience submitting and managing releases through App Store Connect
- Knowledge of Combine or async/await concurrency model`,
  },

  // ── DevOps / Platform ────────────────────────────────────────────────────
  {
    title: "DevOps / Platform Engineer",
    location: "Remote (Canada)",
    salary_range: "CAD 105k–135k/yr",
    description: `We run a multi-tenant SaaS platform on GCP and are looking for a platform engineer to harden our infrastructure, improve developer experience, and keep deployments boring.

**Responsibilities**
- Own Terraform modules for GKE clusters, Cloud SQL, and networking
- Build and maintain CI/CD pipelines in GitHub Actions; enforce security scanning gates
- Implement observability stack: Cloud Monitoring, OpenTelemetry, alerting runbooks
- Drive zero-downtime deployment strategies (canary, blue/green) for critical services

**Requirements**
- 4+ years in a DevOps / SRE / Platform role
- Strong GCP or AWS fundamentals; professional cloud certification is a plus
- Terraform or Pulumi IaC experience
- Comfort with Kubernetes operations (Helm, kustomize, pod autoscaling)
- Scripting in Bash and Python`,
  },
  {
    title: "Site Reliability Engineer (SRE)",
    location: "Ottawa, ON (On-site)",
    salary_range: "CAD 110k–140k/yr",
    description: `Critical infrastructure provider for Canadian public services seeks an SRE to ensure five-nines availability for systems that citizens depend on.

**Responsibilities**
- Define and track SLOs / SLAs; lead reliability reviews for new service launches
- Automate toil: write runbooks and self-healing automation in Python / Go
- Conduct blameless post-mortems; drive systemic improvements from incident learnings
- Collaborate with development teams to embed reliability practices earlier in SDLC

**Requirements**
- 5+ years SRE or operations experience in a high-traffic environment
- Proficiency with Kubernetes and containerized workloads at scale
- Experience with APM tools (Datadog, New Relic, or equivalent)
- Government security clearance (Reliability or Secret) is an asset`,
  },

  // ── Data Engineering ─────────────────────────────────────────────────────
  {
    title: "Data Engineer (BigQuery / dbt)",
    location: "Toronto, ON (Hybrid)",
    salary_range: "CAD 100k–125k/yr",
    description: `Retail analytics company powering real-time inventory decisions for major Canadian retailers. We need a data engineer to scale our warehouse and surface clean, reliable data to our BI and ML teams.

**Responsibilities**
- Design and maintain dbt models on BigQuery; enforce data contracts and testing
- Build Dataflow / Cloud Composer pipelines to ingest point-of-sale event streams
- Collaborate with analysts to model star/snowflake schemas aligned to business questions
- Monitor data quality; implement alerting on freshness and completeness SLAs

**Requirements**
- 3+ years data engineering with a cloud warehouse (BigQuery, Snowflake, or Redshift)
- Proficient with dbt (models, tests, macros, packages)
- Python for pipeline scripting and data validation
- Experience with streaming ingestion (Pub/Sub, Kafka) is a plus`,
  },
  {
    title: "Analytics Engineer",
    location: "Remote (Global)",
    salary_range: "USD 2,800–4,500/mo",
    description: `B2B SaaS startup looking for an analytics engineer to sit at the intersection of data engineering and business intelligence. You will be the single source of truth for product and go-to-market metrics.

**Responsibilities**
- Own and extend our dbt + Metabase semantic layer; build certified metrics
- Partner with Product and Finance to define KPIs and implement in the warehouse
- Write clear documentation and data dictionaries; enforce column-level lineage
- Uplift the team on SQL best practices and analytical thinking

**Requirements**
- 2+ years analytics engineering or senior BI analyst experience
- Strong dbt skills; comfortable writing complex SQL window functions
- Data visualization with Metabase, Looker, or Power BI
- Ability to communicate data concepts to non-technical stakeholders`,
  },

  // ── QA ───────────────────────────────────────────────────────────────────
  {
    title: "QA Automation Engineer",
    location: "Ho Chi Minh City, Vietnam",
    salary_range: "USD 1,800–2,800/mo",
    description: `Enterprise SaaS company seeking a QA Automation Engineer to build a comprehensive test suite that catches regressions before they reach production.

**Responsibilities**
- Design and implement end-to-end test suites using Playwright (TypeScript)
- Integrate tests into GitHub Actions CI; report flakiness and maintain < 2% failure rate
- Write API contract tests with Pact or Supertest
- Collaborate with developers during sprint to shift quality left

**Requirements**
- 2+ years test automation experience (Playwright, Cypress, or Selenium)
- Working knowledge of TypeScript or JavaScript
- Understanding of REST API testing concepts
- Experience with BDD / Gherkin notation is a plus`,
  },
  {
    title: "Senior QA / Test Lead",
    location: "Ottawa, ON (Hybrid)",
    salary_range: "CAD 85k–108k/yr",
    description: `Healthcare software company looking for a QA Lead to own quality across two development squads and ensure our regulated product meets PHIPA and HL7 FHIR compliance requirements.

**Responsibilities**
- Define and evolve the test strategy (unit, integration, performance, security)
- Lead a team of 3 QA engineers; review test plans and mentor on automation
- Manage regression suite in Xray / Jira; own release sign-off process
- Coordinate with clinical stakeholders on UAT scenarios

**Requirements**
- 5+ years QA experience, with at least 2 years in a lead or senior role
- Hands-on automation skills (Java/Selenium or TypeScript/Playwright)
- Familiarity with regulated software (ISO 13485, FDA 21 CFR Part 11) is an asset
- Strong communication skills for cross-functional test planning`,
  },

  // ── Product Manager ───────────────────────────────────────────────────────
  {
    title: "Product Manager – Developer Platform",
    location: "Remote (Canada)",
    salary_range: "CAD 110k–140k/yr",
    description: `We build developer tools used by over 50,000 engineers. As Product Manager for the Platform team you will define the roadmap for SDKs, APIs, and the developer portal.

**Responsibilities**
- Drive quarterly roadmap planning; own PRDs and acceptance criteria for platform features
- Conduct user interviews and synthesize feedback from the community into actionable insights
- Define and track product KPIs (activation, API adoption, error rates)
- Partner with Developer Relations to create enablement content and documentation strategy

**Requirements**
- 3+ years PM experience, ideally on a developer-facing or API product
- Ability to read and understand code; comfortable in technical architecture discussions
- Data-driven decision making: experience with Amplitude, Mixpanel, or equivalent
- Strong written communication; experience writing public-facing changelog and release notes`,
  },
  {
    title: "Associate Product Manager",
    location: "Toronto, ON (On-site)",
    salary_range: "CAD 75k–92k/yr",
    description: `High-growth consumer fintech seeking an ambitious APM to join our Lending Products team and help build financial products that improve lives.

**Responsibilities**
- Write and maintain user stories and acceptance criteria in collaboration with engineering and design
- Conduct competitive analysis and market research; present findings to leadership
- Own sprint ceremonies: backlog grooming, stand-ups, retrospectives
- Monitor dashboards and surface anomalies to stakeholders proactively

**Requirements**
- 1–3 years of product or related experience (consulting, business analysis, or PM internship)
- Analytical mindset; comfortable with SQL at a basic query level
- Excellent organizational skills and ability to balance multiple workstreams
- Passion for consumer finance and building for underserved markets`,
  },

  // ── UI/UX ─────────────────────────────────────────────────────────────────
  {
    title: "UI/UX Designer (Product Design)",
    location: "Ho Chi Minh City, Vietnam",
    salary_range: "USD 1,500–2,500/mo",
    description: `Our platform connects freelancers with clients across Southeast Asia. We are hiring a Product Designer to own end-to-end design for the Freelancer Success experience.

**Responsibilities**
- Lead discovery: user interviews, usability testing, journey mapping
- Produce wireframes, high-fidelity mockups, and interactive prototypes in Figma
- Collaborate with frontend engineers during implementation; QA designs in staging
- Contribute to and maintain the design system (components, tokens, documentation)

**Requirements**
- 2+ years product / UX design experience for digital products
- Proficient in Figma; basic familiarity with HTML/CSS is a plus
- Portfolio demonstrating end-to-end design process (discovery → delivery)
- Strong understanding of mobile-first design and accessibility guidelines (WCAG 2.1)`,
  },
  {
    title: "Senior UX Researcher",
    location: "Toronto, ON (Hybrid)",
    salary_range: "CAD 90k–115k/yr",
    description: `B2C marketplace looking for a Senior UX Researcher to run a rigorous mixed-methods research program that keeps our product roadmap grounded in real user needs.

**Responsibilities**
- Plan and execute generative and evaluative research: contextual inquiry, surveys, A/B analysis
- Synthesize findings into clear insights and present to product leadership
- Build and maintain the research repository; socialize learnings across teams
- Partner with data analytics to combine qualitative insight with behavioral data

**Requirements**
- 4+ years UX research experience (agency or in-house)
- Skilled in a range of methods: interviews, diary studies, moderated/unmoderated usability testing
- Proficient with research tools (Maze, UserTesting, Dovetail, or equivalent)
- Ability to influence roadmap decisions with evidence-based storytelling`,
  },

  // ── IT Support ────────────────────────────────────────────────────────────
  {
    title: "IT Support Specialist (Tier 2)",
    location: "Ottawa, ON (On-site)",
    salary_range: "CAD 55k–70k/yr",
    description: `Federal government contractor seeking an IT Support Specialist to join our on-site helpdesk team serving 800+ employees across two Ottawa campuses.

**Responsibilities**
- Resolve Tier 2 escalations for hardware, software, and network issues within SLA
- Image and deploy laptops (Windows 11 / macOS); maintain asset inventory in ServiceNow
- Administer Active Directory / Entra ID accounts, groups, and group policy
- Produce knowledge base articles to reduce repeat ticket volume

**Requirements**
- 2+ years IT support experience in a corporate environment
- CompTIA A+ or Microsoft certifications preferred
- Familiarity with ITIL v4 service management practices
- Reliability-level security clearance (or ability to obtain)
- Bilingualism (English/French) is a strong asset for this Ottawa role`,
  },
  {
    title: "IT Support Engineer – Cloud & SaaS",
    location: "Remote (Canada)",
    salary_range: "CAD 60k–78k/yr",
    description: `Fully-distributed SaaS company looking for a cloud-savvy IT Support Engineer to keep our 200-person remote workforce productive and secure.

**Responsibilities**
- Administer Google Workspace, Okta SSO, Zoom, Slack, and Notion for all employees
- Manage MDM (Jamf for macOS, Intune for Windows) and enforce device compliance policies
- Onboard and offboard employees; manage access lifecycle across 30+ SaaS tools
- Support security incident response: phishing triage, credential rotation, MFA enrollment

**Requirements**
- 2+ years IT administration or support in a cloud-native environment
- Hands-on experience with Google Workspace and at least one MDM solution
- Scripting skills (Bash or Python) for automating provisioning tasks
- Security-minded: understanding of zero-trust principles and IAM best practices`,
  },
];

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
/** Build a deterministic list of exactly `n` templates. */
function buildJobList(n) {
  const result = [];
  while (result.length < n) {
    result.push(...TEMPLATES.slice(0, Math.min(n - result.length, TEMPLATES.length)));
  }
  return result.slice(0, n);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  const {
    assertMaximumPositionals,
    OperationSafetyError,
    parseBoundedInteger,
    positionalArguments,
    prepareFirebaseOperation,
    printDryRun,
    readOption,
    requireFirebaseUid,
    safeFailureMessage,
  } = await import("./guardedFirebaseOperation.mjs");

  try {
    const argv = process.argv.slice(2);
    const positional = positionalArguments(argv, ["--employer-uid", "--count"]);
    assertMaximumPositionals(positional, 2, SCRIPT_NAME);
    const employerUid = requireFirebaseUid(
      readOption(argv, "--employer-uid") || positional[0],
      SCRIPT_NAME,
    );
    const count = parseBoundedInteger(readOption(argv, "--count") || positional[1], {
      scriptName: SCRIPT_NAME,
      label: "count",
      minimum: 1,
      maximum: 200,
      fallback: 12,
    });
    const operation = prepareFirebaseOperation({
      scriptName: SCRIPT_NAME,
      action: "SEED_SYNTHETIC_JOBS",
      subject: `${employerUid}:${count}`,
      argv,
      allowProduction: false,
    });
    if (operation.dryRun) {
      printDryRun(operation);
      console.log(`Planned deterministic job count: ${count}`);
      return;
    }

    admin.initializeApp({ projectId: operation.projectId });
    const db = admin.firestore();
    const employer = await db.collection("users").doc(employerUid).get();
    if (!employer.exists || employer.data()?.role !== "employer") {
      throw new OperationSafetyError(
        SCRIPT_NAME,
        "The target user must exist in the emulator with role 'employer'.",
      );
    }

    const jobs = buildJobList(count);
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();
    const documentIds = [];

    jobs.forEach((job, index) => {
      const ref = db.collection("job_postings").doc(`seed-job-${employerUid}-${index + 1}`);
      const document = {
        employer_id: employerUid,
        title: job.title,
        is_active: true,
        created_at: timestamp,
        updated_at: timestamp,
      };
      if (job.description) document.description = job.description;
      if (job.location) document.location = job.location;
      if (job.salary_range) document.salary_range = job.salary_range;
      batch.set(ref, document);
      documentIds.push(ref.id);
    });

    await batch.commit();
    console.log(
      `Upserted ${documentIds.length} deterministic synthetic jobs for ${employerUid} in ${operation.projectId}.`,
    );
  } catch (error) {
    console.error(safeFailureMessage(error));
    process.exitCode = 1;
  }
})();
