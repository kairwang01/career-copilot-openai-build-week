# Company Reviews — Graded Verification

**Date:** 2026-06-18
**Status:** Approved design, pending implementation plan

## Background

A Glassdoor-style company review feature already exists end-to-end but is invisible
in practice:

- **Write entry** (`components/MyApplications.tsx`) only renders for applications
  where `isApplicationHiredStatus(status)` is true (status === `Signed`, i.e. hired
  *through the platform*).
- **Read entry** (`components/BrowseJobs.tsx`) only renders a rating chip when the
  employer already has `count > 0` reviews, and reviews are lazy-loaded only when a
  job card is expanded.

Because almost no application reaches `Signed` on a young platform, nobody can write
a review → review count is always 0 → the rating chip never renders. The whole chain
is empty, so both entries are effectively hidden.

The existing implementation:

- `functions/src/handlers/companyReviews.ts` — `createCompanyReview` (server-only
  write, gated on a `Signed` application) and `listCompanyReviews` (server-only read,
  strips `author_uid` and the identity-encoding doc id for anonymity).
- `lib/companyReviewsData.ts` — `listCompanyReviews`, `aggregateRating`,
  `submitCompanyReview` client helpers.
- `components/CompanyReviewModal.tsx` — 5-star + free-text submission modal.
- `firestore.rules` — `company_reviews/{id}` is deny-all (reads/writes go through
  callables).

## Goal

Replace the single hard gate ("only platform-hired candidates can review") with
**graded verification** based on the real depth of a candidate's relationship with an
employer, as recorded by the platform's own application data. Lower the write
threshold to "interviewed or beyond", and attach a trust-tier badge to each review.
Make the rating always visible on job cards.

This is a differentiator: unlike Glassdoor/Indeed (pure self-attestation), Career
CoPilot already knows each candidate's true relationship to an employer from the
application pipeline, so it can grade trust instead of asking reviewers to self-declare.

## Design Decisions

| Dimension | Decision |
|---|---|
| Who can write | Graded verification driven by platform application data |
| Minimum threshold | Reached the **interview** stage (or beyond) |
| Where reviews surface | Enhance the existing job card (no separate company page) |
| Review structure | Keep the single overall 1–5 rating + free text |

## Verification Tiers

At write time the server snapshots the **highest pipeline stage the candidate ever
reached** for that employer, by querying the `application_status_events` audit log
(fields: `candidate_id`, `employer_id`, `to_status`, `created_at`). Using the audit
trail rather than the application's *current* status means a candidate who interviewed
and was later rejected still qualifies (their current status would be `Rejected`),
which is exactly the value of an interview-stage review.

Each pipeline status maps to a group via `lib/applicationPipeline.ts`
(`getApplicationStatusGroup`). The highest group reached maps to a tier:

| Highest group ever reached | `verification_tier` | Badge (i18n) |
|---|---|---|
| `hired` (Signed) | `hired` | Verified employee |
| `offer` | `offer` | Received offer |
| `interview` | `interviewed` | Interviewed here |
| `applied` only / none | — (not eligible — write rejected) | — |

If the candidate never reached at least the `interview` group, `createCompanyReview`
throws `failed-precondition` (same error the modal already surfaces as an inline
"not verified" message).

## Data Model

- `company_reviews/{employerId}_{uid}` — add
  `verification_tier: 'hired' | 'offer' | 'interviewed'`. Keep the existing `verified`
  boolean (defined as `verification_tier === 'hired'`) for backward compatibility.
  All other fields unchanged. One review per candidate per company; revisions via
  `set(..., { merge: true })`.
- **New** `employer_rating/{employerId}` — a small aggregate document
  `{ avg: number, count: number, updated_at: Timestamp }`, maintained by a Firestore
  trigger on `company_reviews` writes. Mirrors the existing
  `employer_responsiveness/{employerId}` pattern. Lets job cards display the rating
  chip without expanding the card and without an expensive callable per card.

## Backend Changes (`functions/src/handlers/companyReviews.ts`)

1. **`createCompanyReview`** — replace the `status === 'Signed'` check with:
   - Query `application_status_events` for `candidate_id == uid && employer_id == X`.
   - Reduce all `to_status` values to the highest reached group.
   - If below `interview`, throw `failed-precondition`.
   - Otherwise write the review with the derived `verification_tier`.
   - Continue to snapshot `company_name` from `users/{employerId}`.
2. **`listCompanyReviews`** — return `verification_tier` for each review (in addition
   to / replacing the existing `verified`). Continue to strip `author_uid` and never
   expose the raw doc id.
3. **New trigger `onCompanyReviewWritten`** — Firestore trigger on
   `company_reviews/{id}` write. Recomputes/updates `employer_rating/{employerId}`
   (`avg`, `count`). Best-effort, wrapped in try/catch so it never throws into a
   Cloud Function retry loop (consistent with `notifications.ts` / `responsiveness.ts`).
4. **`functions/src/index.ts`** — export the new trigger.

## Frontend Changes

- **`lib/companyReviewsData.ts`**
  - Add `verificationTier: 'hired' | 'offer' | 'interviewed'` to the `CompanyReview`
    type and map it through from the callable response.
  - Add `getEmployerRating(employerId): Promise<{ avg: number; count: number }>` that
    reads the `employer_rating/{employerId}` aggregate document directly (client read
    allowed by rules).
- **`components/MyApplications.tsx`**
  - Add `isApplicationReviewEligible(status)` (true for the `interview`, `offer`, and
    `hired` groups) and gate the review button on it instead of `isHired`. Button copy
    unchanged.
- **`components/BrowseJobs.tsx`**
  - Eager-load `employer_rating` for visible job cards (same shape as the existing
    `employer_responsiveness` eager-load) and render the rating chip **always** — show
    "No reviews yet" when `count === 0`.
  - In the expanded review list, render a tier badge per review based on
    `verificationTier`.
- **`components/CompanyReviewModal.tsx`**
  - Update the verified-employee explanatory note to the graded wording. Structure
    otherwise unchanged.

## Security Rules (`firestore.rules`)

- Add `match /employer_rating/{id}` — `allow read: if request.auth != null;`
  `allow write: if false;` (only the trigger / Admin SDK writes). Mirrors the
  `employer_responsiveness` rule.
- `company_reviews/{id}` stays deny-all.

## i18n

Add keys for the three tier badges and the "No reviews yet" empty state, plus any
updated modal copy. Update **all six languages** (en, zh, de, fr, ja, vi) in **both**
`localization/` and `public/localization/`, keeping full parity.

## Testing / Verification

After implementation, create one test application that reached an interview stage for
a fictional employer (easier to set up than a `Signed` application), then submit a
review through the UI and confirm the rating chip and tier badge render. Whether the
test data goes into the shared test Firestore project (`career-copilot-a3168`) or the
local emulator is a separate decision to make at verification time.

## Out of Scope (YAGNI)

- Multi-dimensional sub-ratings (comp, management, work-life balance) and pros/cons
  fields — kept single overall rating + text.
- A dedicated company detail page / route.
- Work-email-domain verification.
- Moderation tooling and self-attested reviews from non-applicants.
