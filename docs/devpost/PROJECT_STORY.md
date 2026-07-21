# Career CoPilot — Devpost Project Story

## Inspiration

Finding a job is not a single action. Candidates move between resume editors, job boards, spreadsheets, interview-preparation tools, and career advice—often without a clear connection between them. Employers face the other side of the same problem: applications contain plenty of information, but not always the structured context needed to make consistent hiring decisions.

Career CoPilot was inspired by this fragmentation. We wanted a guided workspace that helps candidates move from career intent to stronger applications and interview readiness, while giving employers a more structured way to discover, review, and advance talent.

Instead of replacing platforms such as LinkedIn or Indeed, Career CoPilot complements them by focusing on what happens before, during, and after an application.

## What it does

Career CoPilot connects career development and hiring in one multilingual workflow.

Candidates can analyze a resume, plan a career path, discover opportunities, understand why a role fits, track applications, practice timed interviews, and create supporting career materials. Employers can publish jobs, discover opted-in talent, request limited candidate packets, review evidence-based matches, and manage applicants through interviews, scorecards, messages, and hiring stages.

The platform also includes an administration surface for model routing, prompts, quotas, permissions, API access, billing controls, and audit records. The interface supports English, French, Chinese, Japanese, German, Vietnamese, and Arabic.

## How we built it

The frontend is a React 19 and TypeScript single-page application built with Vite and Tailwind CSS. It is divided into four role-aware surfaces: the public website, candidate workspace, employer portal, and administration portal.

Firebase provides Authentication, Firestore, Cloud Storage, and Cloud Functions. Privileged operations—including AI execution, credit accounting, job-application transitions, billing entitlements, and administrative actions—run through server-side functions instead of trusting the browser.

We built a provider abstraction that supports Gemini and OpenAI-compatible Chat Completions providers. The platform can apply model tiers, administrator-controlled routing, key rotation, availability-based fallback, and business bring-your-own-provider configurations.

AI requests pass through authentication, validation, idempotency, metering, server-side model selection, structured-output validation, and usage recording. If a charged execution fails, the credit refund is idempotent; transient failures enter a durable recovery queue for later reconciliation.

Firestore and Storage rules enforce owner-only and server-only boundaries. Provider credentials, frozen application resumes, billing records, credit ledgers, and privileged hiring state are not directly writable by clients.

## How Codex and GPT-5.6 were used

During the Build Week submission and hardening workflow, Codex with GPT-5.6 acted as an agentic engineering collaborator. It read the repository before drafting claims, traced frontend-to-function-to-database flows, inspected trust boundaries, connected failures to focused tests, and turned verified product evidence into the README and submission story.

Codex was especially useful for maintaining context across a large TypeScript/Firebase codebase: candidate, employer, agency, admin, AI routing, billing, credits, rules, and CI all influence one another. GPT-5.6 helped reason across those boundaries and compare documentation with live source instead of treating old plans as current fact.

Humans retained control of product direction, scope, code acceptance, deployment authority, and launch decisions. We used Codex output as reviewable engineering work—not as unquestioned truth—and required source, tests, screenshots, or release evidence for important claims.

## Challenges we faced

### Making AI output dependable

Generative output is variable, while product interfaces need stable data. We introduced structured schemas, validation, correction passes, and quality checks so resume reports, interview evaluations, and career plans can be rendered consistently.

### Designing trustworthy permission boundaries

Career CoPilot serves candidates, employers, agencies, reviewers, administrators, and super administrators. Preventing clients from changing roles, credits, subscriptions, or hiring states required carefully separated UI permissions, callable authorization, Firestore rules, and server-owned records.

### Coordinating a two-sided workflow

A candidate action can affect an employer pipeline, while an employer decision updates candidate history. These transitions needed to be traceable, idempotent, and resistant to retries and race conditions.

### Protecting consent and personal information

Talent discovery cannot expose a candidate's changing live profile. Candidates opt in, and an employer receives a minimal frozen packet only after explicit consent. The packet expires and can be revoked.

### Handling money-equivalent failures

AI credits and billing entitlements behave like financial state. Failed AI requests must not silently consume credits, while repeated checkouts or webhooks must not grant an entitlement twice. We used transaction-backed ledgers, deterministic identifiers, recovery queues, and reconciliation records.

## What we learned

The biggest lesson was that an AI product is not mainly a prompt. Reliability comes from the system around the model: authentication, authorization, input limits, schemas, retries, idempotency, observability, cost controls, and honest failure states.

We also learned that an explainable decision is more useful than an isolated AI score. Candidates and employers need to see what resume evidence supports a match, which requirements remain unmet, and what action comes next.

Finally, we learned to separate engineering readiness from production readiness. Automated gates can prove behavior in controlled environments, but public launch approval still needs real payment, email, cloud configuration, monitoring, privacy, and device evidence.

## Accomplishments we are proud of

- A connected candidate-to-employer workflow rather than disconnected AI tools
- Server-controlled AI credentials, routing, quotas, and structured outputs
- Evidence-based matching instead of unexplained scores
- Consent-gated talent discovery with revocable, time-limited packets
- Transactional credits with idempotent failure recovery
- A layered release gate covering source, emulator, runtime, and browser behavior
- Product screenshots captured from the running application rather than conceptual mockups

## What's next

Before broad public traffic, the next priorities are live Stripe and signed-webhook validation, transactional email and DNS testing, production Firebase rules/indexes/TTL/IAM verification, real-provider quality and cost evaluation, representative device and accessibility testing, and approved privacy/retention operations.

On the product side, we plan to run pilots with candidates, career advisors, and employers; improve evaluation and latency; and break the largest portal modules into smaller maintainable components.

Our long-term goal is to make Career CoPilot a trusted decision-support layer between career intent and hiring—not an AI system that makes decisions for people, but one that helps both sides make better-informed decisions.
