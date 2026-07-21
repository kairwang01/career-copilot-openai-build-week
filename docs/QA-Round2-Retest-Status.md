# QA / Product Issues Report (Round 2) — Dev Verification

> **Dev verification — 2026-06-16 (branch `dev`).** Every Round-2 item was re-checked against the current code.
> This file mirrors the verified Retest Status for the Confluence page
> [QA / Product Issues Report (Round 2)](https://5902team1-careercopilot.atlassian.net/wiki/spaces/TCC/pages/13565954/QA+Product+Issues+Report+Round+2)
> (the live-page API was in an outage when this was generated; paste/sync when it recovers).
>
> **Legend**
> - **✅ Fixed (dev)** — resolved in code; appears on the live site after the next production rebuild on the host (`git pull && npm run build`). Backend/Firebase fixes (Storage CORS, Cloud Functions) are **already live** in prod.
> - **🟡 Frontend (external)** — UI complete & honest, but full function needs a third-party service not wired now (email delivery, Stripe payment, paid AI image-model quota). Frontend kept per scope.
> - **ℹ️ Infra** — not a code bug (e.g. LLM response latency).
>
> Several prior "Fail" retest results were against a **stale deployed build**.

## 1. Job Seeker Flow

| ID | Status | Resolution / evidence |
| --- | --- | --- |
| JS1 | 🟡 Frontend (external) | Firebase `sendEmailVerification` sent on signup (non-blocking) + notice — `Auth.tsx`. Hard gate needs an email/identity decision. |
| JS2 | ✅ Fixed (dev) | Exiting Career Studio routes to `/?home=1` → the same public homepage as `/`. |
| JS3 | ✅ Fixed (dev) | Top-bar CTA → "Get Started" → sign-up, desktop **and** mobile (`SiteHeader.tsx` / `SiteMobileNav.tsx`). |
| JS4 | ✅ Fixed (dev) | Top-bar "Sample Report" → "Job Search" → workspace job-search tool. |
| JS5 | ✅ Fixed (dev) | "BACK TO HOMEPAGE" → "Career Studio" (`Sidebar.tsx`). |
| JS6 | ✅ Fixed (dev) | Sidebar logo returns to the public homepage. (Matching the portal landing *style* = optional polish.) |
| JS7 | ✅ Pass | — |
| JS8 | ✅ Fixed (dev) | Top-right account menu removed; consolidated into sidebar "My Profile". |
| JS9 | ✅ Fixed (dev) | Renamed to "Billing & Plan"; redundant Account-Settings billing block removed. |
| JS10 | 🟡 Frontend (external) | Honest copy + "Manage Subscription" guarded against the dead `/test_` portal (`Account.tsx`). Real charging needs a Stripe webhook (Phase C). |
| JS11 | ✅ Pass | — |
| JS12 | ✅ Pass | — |
| JS13 | ✅ Pass | — |
| JS14 | ✅ Pass | — |
| JS15 | ✅ Fixed (dev + bucket) | **Root cause: Storage CORS** lacked the active demo VM origin, so all uploads were blocked. Added the environment origin to `storage.cors.json` and applied it to the live bucket. |
| JS16 | ℹ️ Infra | LLM inference latency; bounded by timeouts + staged loaders. Tunable via model routing. |
| JS17 | 🟡 Frontend (external) | Gemini image model has 0 free-tier quota (needs billing). Clear "quota reached" message instead of a 500 (`generateHeadshot.ts`). |
| JS18 | ✅ Pass | — |
| JS19 | ✅ Pass | — |
| JS20 | ✅ Fixed (dev) | `resume_text` auto-persists + original resume **file** now stored in Firebase Storage (owner-only, `services/resumeStorage.ts`); `discoverTalent` reads `resume_text` for Talent Discovery. |

## 2. Business Flow

| ID | Status | Resolution / evidence |
| --- | --- | --- |
| Biz1 | 🟡 Frontend (external) | Same as JS1 — Firebase email verification sent on signup. |
| Biz2 | ✅ Fixed (dev) | `/portal` and `/employers` render through the shared `SiteLayout`/`SiteHeader` → consistent. |
| Biz3 | ✅ Fixed (dev) | "For Business" nav renamed to "How It Works". |
| Biz4 | ✅ Pass | Business users default to employer plans (`PricingPage.tsx`). |
| Biz5 | ✅ Fixed (dev) | Top-bar "Post a Job" → "Discover Talent" → portal. |
| Biz6 | ✅ Fixed (dev) | `darkMode` wired through `PortalSidebar` + `PortalTopBar` (toggle). Default-dark is a design decision. |
| Biz7 | ✅ Pass | — |
| Biz8 | ✅ Fixed (dev) | Top-right menu removed from `PortalTopBar`; consolidated into `PortalSidebar` "My Profile". |
| Biz9 | ✅ Pass | — |
| Biz10 | ✅ Fixed (dev + bucket) | Same Storage-CORS fix as JS15 (covers `Avatar` + `CompanyLogo`). |
| Biz11 | ✅ Pass | — |
| Biz12 | ✅ Fixed (dev) | Save-to-shortlist on the Review Candidate page (`ApplicantFunnel.tsx` → `saveToShortlist`). Employers can also download an applicant's resume file. |
| Biz13 | ✅ Fixed (dev) | Duplicate command button hidden when the only action is upload (`AgencyHub.tsx` `showPrimaryAction`). |
| Biz14 | ✅ Pass | — |
| Biz15 | ✅ Fixed (dev) | "Show Full Summary" now opens in a modal (`role="dialog"`), matching Blind Resume / Prep Kit. |
