# Company Reviews — Graded Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "only platform-hired candidates can review" gate with graded verification (interview / offer / hired tiers) driven by the application-pipeline audit log, lower the write threshold to "interviewed or beyond", and make the rating chip always visible on job cards.

**Architecture:** Server-side callables remain the only path to write/read `company_reviews` (anonymity preserved). `createCompanyReview` now derives a `verification_tier` from the `application_status_events` audit log. A new Firestore trigger maintains an `employer_rating/{employerId}` aggregate so job cards can show the rating without expanding. Frontend reads that aggregate eagerly and renders graded tier badges.

**Tech Stack:** Firebase Cloud Functions v2 (TypeScript), Firestore, React 19 + Vite, Tailwind v4, i18n via `useLocalization`.

## Global Constraints

- **No test runner exists.** Verify frontend with `npm run build` (repo root); verify functions with `cd functions && npm run build` (tsc) and `npm run lint`. Behavior is confirmed by building + manually running the app. (CLAUDE.md)
- **No Claude attribution in commits** — no `Co-Authored-By` / "Generated with" lines. (CLAUDE.md / repo rule)
- **i18n parity:** every new/changed key must be added to all six languages (en, zh, de, fr, ja, vi) in BOTH `localization/<lang>.json` AND `public/localization/<lang>.json`. English is the fallback.
- **No hardcoded user-facing strings** — use `t(...)` keys.
- **Security rules are enforced** — update `firestore.rules` when adding the `employer_rating` collection.
- **`functions/src` cannot import root `lib/`** (its tsconfig only includes `src/**/*`) — status-group knowledge must be inlined in the handler.
- **Default work branch is `dev`; PRs target `main`.** Do not commit the pre-existing unrelated `firestore.rules` working-tree change as part of these tasks unless a task explicitly edits that file.

---

### Task 1: Backend — graded verification + tier in the review callables

Replace the `Signed`-only gate in `createCompanyReview` with a highest-stage-reached
computation from the audit log, store `verification_tier`, and surface it from
`listCompanyReviews`.

**Files:**
- Modify: `functions/src/handlers/companyReviews.ts`

**Interfaces:**
- Consumes: `application_status_events` docs `{ candidate_id, employer_id, to_status, created_at }`; `job_applications` docs `{ candidate_id, employer_id, status }`.
- Produces:
  - `company_reviews/{employerId}_{uid}` now also carries `verification_tier: 'hired' | 'offer' | 'interviewed'` (string) alongside the existing `verified: boolean`.
  - `listCompanyReviews` callable response item shape becomes `{ rating: number; text: string; verified: boolean; verification_tier: 'hired' | 'offer' | 'interviewed'; created_at: string | null }`.

- [ ] **Step 1: Add the status-group helper and tier ranking**

In `functions/src/handlers/companyReviews.ts`, add near the top (after `const db = admin.firestore();`):

```ts
// Pipeline status → group. Mirrors lib/applicationPipeline.ts, inlined because
// functions/src cannot import the root lib/ (tsconfig includes src/** only).
const INTERVIEW_STATUSES = new Set([
  "Group Interview",
  "First Interview",
  "Second Interview",
  "Decision Maker Interview",
  "HR Interview",
]);
const OFFER_STATUSES = new Set([
  "Offer",
  "Hiring Evaluation",
  "Intent Letter",
  "Offer Confirmed",
  "Tripartite Agreement",
]);
const HIRED_STATUSES = new Set(["Signed"]);

type VerificationTier = "interviewed" | "offer" | "hired";

// Rank so we can take the highest stage ever reached. 0 = below threshold.
function statusTierRank(status: string): number {
  if (HIRED_STATUSES.has(status)) return 3;
  if (OFFER_STATUSES.has(status)) return 2;
  if (INTERVIEW_STATUSES.has(status)) return 1;
  return 0;
}

const RANK_TO_TIER: Record<number, VerificationTier> = {
  3: "hired",
  2: "offer",
  1: "interviewed",
};
```

- [ ] **Step 2: Replace the verification block in `createCompanyReview`**

Replace the current verification block (the `hiredSnap` query through the
`if (!isVerified) { ... }` throw) with a highest-stage computation that reads the
audit log AND the current application status (covers the rare case where an
application was created directly at an interview status without an event):

```ts
    // ── Verification: highest pipeline stage ever reached at this employer ──
    // Use the immutable audit log so a candidate who interviewed and was later
    // rejected still qualifies (their current status would be "Rejected").
    let bestRank = 0;

    const eventsSnap = await db
      .collection("application_status_events")
      .where("candidate_id", "==", uid)
      .where("employer_id", "==", employerId)
      .get();
    eventsSnap.docs.forEach((d) => {
      const toStatus = typeof d.data().to_status === "string" ? d.data().to_status : "";
      bestRank = Math.max(bestRank, statusTierRank(toStatus));
    });

    // Also consider current application statuses (belt-and-suspenders).
    const appsSnap = await db
      .collection("job_applications")
      .where("candidate_id", "==", uid)
      .where("employer_id", "==", employerId)
      .limit(25)
      .get();
    appsSnap.docs.forEach((d) => {
      const status = typeof d.data().status === "string" ? d.data().status : "";
      bestRank = Math.max(bestRank, statusTierRank(status));
    });

    if (bestRank < 1) {
      throw new HttpsError(
        "failed-precondition",
        "Only candidates who interviewed (or progressed further) through the platform can review this company."
      );
    }

    const verificationTier: VerificationTier = RANK_TO_TIER[bestRank];
```

- [ ] **Step 3: Write `verification_tier` into the review doc**

In the `reviewRef.set(...)` object in `createCompanyReview`, change `verified` and add
`verification_tier`:

```ts
    await reviewRef.set(
      {
        employer_id: employerId,
        company_name: companyName,
        author_uid: uid,
        rating: data.rating,
        text,
        verification_tier: verificationTier,
        verified: verificationTier === "hired",
        created_at: createdAt,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
```

- [ ] **Step 4: Return `verification_tier` from `listCompanyReviews`**

In `listCompanyReviewsFunction`'s `.map(...)`, add the tier (with a safe fallback for
legacy docs that only have `verified`):

```ts
      const tier =
        r.verification_tier === "hired" ||
        r.verification_tier === "offer" ||
        r.verification_tier === "interviewed"
          ? r.verification_tier
          : r.verified === true
          ? "hired"
          : "interviewed";
      return {
        rating: typeof r.rating === "number" ? r.rating : 0,
        text: typeof r.text === "string" ? r.text : "",
        verified: r.verified === true,
        verification_tier: tier,
        created_at: createdAt,
      };
```

- [ ] **Step 5: Typecheck + lint**

Run: `cd functions && npm run build && npm run lint`
Expected: `tsc` exits 0, eslint reports no errors.

- [ ] **Step 6: Commit**

```bash
git add functions/src/handlers/companyReviews.ts
git commit -m "feat(reviews): graded verification tiers in company-review callables"
```

---

### Task 2: Backend — employer_rating aggregate trigger + rule + export

Add a Firestore trigger that maintains `employer_rating/{employerId}` `{ avg, count }`
on every `company_reviews` write, export it, and allow signed-in clients to read it.

**Files:**
- Modify: `functions/src/handlers/companyReviews.ts`
- Modify: `functions/src/index.ts`
- Modify: `firestore.rules`

**Interfaces:**
- Produces:
  - Firestore doc `employer_rating/{employerId}` = `{ avg: number (1dp), count: number, updated_at: Timestamp }`.
  - Exported trigger `onCompanyReviewWritten` from `functions/src/index.ts`.

- [ ] **Step 1: Add the trigger to `companyReviews.ts`**

Add the import at the top of `functions/src/handlers/companyReviews.ts`:

```ts
import { onDocumentWritten } from "firebase-functions/v2/firestore";
```

Append the trigger at the end of the file. It recomputes the aggregate from all of
the employer's reviews (simple and correct; review volume per employer is low):

```ts
/**
 * onCompanyReviewWritten — maintains employer_rating/{employerId} = { avg, count }
 * so job cards can show a rating chip without an expensive per-card callable.
 * Mirrors the employer_responsiveness aggregate pattern. Best-effort: never throws
 * into a Cloud Function retry loop.
 */
export const onCompanyReviewWrittenFunction = onDocumentWritten(
  "company_reviews/{id}",
  async (event) => {
    try {
      const after = event.data?.after?.data();
      const before = event.data?.before?.data();
      const employerId =
        (typeof after?.employer_id === "string" && after.employer_id) ||
        (typeof before?.employer_id === "string" && before.employer_id) ||
        "";
      if (!employerId) return;

      const snap = await db
        .collection("company_reviews")
        .where("employer_id", "==", employerId)
        .get();

      const ratings = snap.docs
        .map((d) => d.data().rating)
        .filter((r): r is number => typeof r === "number");
      const count = ratings.length;
      const avg =
        count === 0
          ? 0
          : Math.round((ratings.reduce((a, b) => a + b, 0) / count) * 10) / 10;

      await db.collection("employer_rating").doc(employerId).set({
        avg,
        count,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err) {
      // best-effort; swallow so the function never retries forever
      console.error("onCompanyReviewWritten failed", err);
    }
  }
);
```

- [ ] **Step 2: Export the trigger from `index.ts`**

In `functions/src/index.ts`, after the existing `listCompanyReviews` export (line ~69):

```ts
export { onCompanyReviewWrittenFunction as onCompanyReviewWritten } from "./handlers/companyReviews";
```

- [ ] **Step 3: Add the `employer_rating` rule**

In `firestore.rules`, immediately after the `employer_responsiveness` match block
(around line 644-648), add:

```
    // employer_rating/{employerId} — coarse company-rating aggregate { avg, count }
    // derived server-side from company_reviews (no PII). Any signed-in user may read
    // it for the job-card rating chip. Server-only writes (trigger).
    match /employer_rating/{employerId} {
      allow read: if request.auth != null;
      allow write: if false;
    }
```

- [ ] **Step 4: Typecheck + lint**

Run: `cd functions && npm run build && npm run lint`
Expected: `tsc` exits 0, eslint reports no errors.

- [ ] **Step 5: Commit**

```bash
git add functions/src/handlers/companyReviews.ts functions/src/index.ts firestore.rules
git commit -m "feat(reviews): employer_rating aggregate trigger + read rule"
```

---

### Task 3: Client data layer — verificationTier type + getEmployerRating + eligibility helper

**Files:**
- Modify: `lib/companyReviewsData.ts`
- Modify: `lib/applicationPipeline.ts`

**Interfaces:**
- Consumes: `listCompanyReviews` callable response (now includes `verification_tier`); `employer_rating/{employerId}` Firestore doc.
- Produces:
  - `CompanyReview` type gains `verificationTier: 'hired' | 'offer' | 'interviewed'`.
  - `getEmployerRating(employerId: string): Promise<{ avg: number; count: number }>`.
  - `isApplicationReviewEligible(status: unknown): boolean`.

- [ ] **Step 1: Add `verificationTier` to the `CompanyReview` type and map it through**

In `lib/companyReviewsData.ts`, add to the `CompanyReview` interface:

```ts
  /** Trust tier derived server-side from the candidate's pipeline relationship. */
  verificationTier: 'hired' | 'offer' | 'interviewed';
```

Update the `httpsCallable` generic and the `.map` in `listCompanyReviews`:

```ts
  const fn = httpsCallable<
    { employerId: string },
    { reviews: Array<{ rating: number; text: string; verified: boolean; verification_tier: 'hired' | 'offer' | 'interviewed'; created_at: string | null }> }
  >(firebaseFunctions, "listCompanyReviews");
  const result = await fn({ employerId });
  return (result.data?.reviews ?? []).map((r) => ({
    rating: r.rating,
    text: r.text,
    verified: r.verified,
    verificationTier: r.verification_tier ?? (r.verified ? 'hired' : 'interviewed'),
    created_at: r.created_at ?? undefined,
  }));
```

- [ ] **Step 2: Add `getEmployerRating`**

Add the Firestore imports at the top of `lib/companyReviewsData.ts`:

```ts
import { doc, getDoc } from "firebase/firestore";
import { firestoreDb } from "./firebaseClient";
```

Append:

```ts
/**
 * Reads the employer_rating/{employerId} aggregate { avg, count } maintained by the
 * onCompanyReviewWritten trigger. Returns zeros when the doc is absent (no reviews).
 * Client read is allowed by firestore.rules.
 */
export async function getEmployerRating(
  employerId: string
): Promise<{ avg: number; count: number }> {
  try {
    const snap = await getDoc(doc(firestoreDb, "employer_rating", employerId));
    const d = snap.exists() ? snap.data() : undefined;
    return {
      avg: typeof d?.avg === "number" ? d.avg : 0,
      count: typeof d?.count === "number" ? d.count : 0,
    };
  } catch {
    return { avg: 0, count: 0 };
  }
}
```

- [ ] **Step 3: Add `isApplicationReviewEligible` to the pipeline helpers**

In `lib/applicationPipeline.ts`, after `isApplicationInterviewStatus` (line ~248),
add a helper consistent with the existing exports:

```ts
/**
 * True when the candidate's relationship with the employer is deep enough to review
 * the company: reached the interview, offer, or hired group. Mirrors the server-side
 * write gate in functions/src/handlers/companyReviews.ts.
 */
export function isApplicationReviewEligible(status: unknown): boolean {
  const group = getApplicationStatusGroup(status);
  return group === 'interview' || group === 'offer' || group === 'hired';
}
```

- [ ] **Step 4: Typecheck**

Run (repo root): `npm run build`
Expected: Vite build succeeds (no TS errors).

- [ ] **Step 5: Commit**

```bash
git add lib/companyReviewsData.ts lib/applicationPipeline.ts
git commit -m "feat(reviews): client tier type, getEmployerRating, review-eligibility helper"
```

---

### Task 4: MyApplications — broaden the write entry to "interviewed or beyond"

**Files:**
- Modify: `components/MyApplications.tsx`

**Interfaces:**
- Consumes: `isApplicationReviewEligible` from `lib/applicationPipeline.ts` (Task 3).

- [ ] **Step 1: Import the helper**

In `components/MyApplications.tsx`, add `isApplicationReviewEligible` to the existing
import from `../lib/applicationPipeline` (the file already imports
`isApplicationHiredStatus`, `isApplicationRejectedStatus`, etc.).

- [ ] **Step 2: Compute eligibility and gate the button on it**

Near line 421 where `const isHired = isApplicationHiredStatus(app.status);` is defined,
add:

```ts
  const canReview = isApplicationReviewEligible(app.status);
```

Change the review-button guard (currently `{isHired && app.employer_id && (`) at
line ~519 to:

```tsx
      {canReview && app.employer_id && (
```

Leave the rest of the button and the modal block (line ~551) unchanged. `isHired` is
still used by `ProgressTimeline` and other logic — do not remove it.

- [ ] **Step 3: Typecheck**

Run (repo root): `npm run build`
Expected: Vite build succeeds.

- [ ] **Step 4: Manual verification**

Run `npm run dev`, sign in as a candidate who has an application at an interview-stage
status, open My Applications, and confirm the "Review this company" button appears on
that application card (previously it only appeared for `Signed`).

- [ ] **Step 5: Commit**

```bash
git add components/MyApplications.tsx
git commit -m "feat(reviews): show review entry once a candidate has interviewed"
```

---

### Task 5: BrowseJobs — always-visible rating chip + graded tier badges

Show the rating chip on every job card (eager-loaded from `employer_rating`), with a
"No reviews yet" state at count 0, and render a tier badge per review in the expanded
list.

**Files:**
- Modify: `components/BrowseJobs.tsx`

**Interfaces:**
- Consumes: `getEmployerRating` and `CompanyReview.verificationTier` from
  `lib/companyReviewsData.ts` (Task 3).

- [ ] **Step 1: Import `getEmployerRating`**

In the existing import block from `../lib/companyReviewsData` (lines ~28-31), add
`getEmployerRating`.

- [ ] **Step 2: Add an eager rating cache (mirrors respCache)**

Near the review/responsiveness cache declarations (lines ~209-216), add:

```tsx
  // Eager rating aggregate per employer, for the always-visible card chip.
  type RatingEntry = { avg: number; count: number };
  const [ratingCache, setRatingCache] = useState<Record<string, RatingEntry>>({});
  const ratingCacheRef = useRef<Record<string, RatingEntry>>({});
  const fetchingRatings = useRef<Set<string>>(new Set());
```

- [ ] **Step 3: Eager-load ratings for visible jobs**

Immediately after the existing responsiveness eager-load `useEffect` (the one ending
around line 343, keyed on `[jobs]`), add a sibling effect:

```tsx
  // ── eager-load company rating aggregate for the visible jobs ────────────────
  useEffect(() => {
    const eids = Array.from(new Set(jobs.map((j) => j.employer_id).filter((e): e is string => !!e)));
    eids.forEach((eid) => {
      if (ratingCacheRef.current[eid] !== undefined || fetchingRatings.current.has(eid)) return;
      fetchingRatings.current.add(eid);
      (async () => {
        try {
          const entry = await getEmployerRating(eid);
          ratingCacheRef.current = { ...ratingCacheRef.current, [eid]: entry };
          setRatingCache((prev) => ({ ...prev, [eid]: entry }));
        } catch {
          const entry = { avg: 0, count: 0 };
          ratingCacheRef.current = { ...ratingCacheRef.current, [eid]: entry };
          setRatingCache((prev) => ({ ...prev, [eid]: entry }));
        } finally {
          fetchingRatings.current.delete(eid);
        }
      })();
    });
  }, [jobs]);
```

- [ ] **Step 4: Replace the header rating chip with an always-on chip**

Find the per-card derivation (line ~886-887):

```tsx
            const employerReviews = eid ? (reviewCache[eid] ?? null) : null;
            const showRatingChip = employerReviews && employerReviews.count > 0;
```

Add the eager rating below it:

```tsx
            const employerRating = eid ? (ratingCache[eid] ?? null) : null;
```

Replace the header chip block (lines ~924-929, the `{showRatingChip && ( ... )}`)
with an always-rendered chip that uses the eager aggregate:

```tsx
                        {/* Rating chip — always shown once the aggregate loads */}
                        {employerRating && (
                          employerRating.count > 0 ? (
                            <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700/50 rounded-full px-2 py-0.5 whitespace-nowrap">
                              <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                              {employerRating.avg.toFixed(1)}&nbsp;({employerRating.count})
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-slate-400 dark:text-slate-500 whitespace-nowrap">
                              <Star className="h-3 w-3" />
                              {t('browse_jobs_no_reviews')}
                            </span>
                          )
                        )}
```

(The `showRatingChip` constant is now unused — remove its declaration to keep the
build clean.)

- [ ] **Step 5: Add a tier-badge helper and render it per review**

Add a small helper near the top of `components/BrowseJobs.tsx` (module scope, after
imports), keyed by the i18n keys defined in Task 6:

```tsx
function reviewTierBadge(
  tier: 'hired' | 'offer' | 'interviewed',
  t: (k: string) => string
): { label: string; className: string } {
  switch (tier) {
    case 'hired':
      return { label: t('review_tier_hired'), className: 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-100 dark:border-green-800/50' };
    case 'offer':
      return { label: t('review_tier_offer'), className: 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-800/50' };
    default:
      return { label: t('review_tier_interviewed'), className: 'text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-600' };
  }
}
```

In the expanded review list (lines ~1137-1141), replace the `{rv.verified && ( ... )}`
badge with a tier badge:

```tsx
                                  {(() => {
                                    const badge = reviewTierBadge(rv.verificationTier, t);
                                    return (
                                      <span className={`ml-2 text-[10px] font-semibold border rounded-full px-2 py-0.5 ${badge.className}`}>
                                        {badge.label}
                                      </span>
                                    );
                                  })()}
```

- [ ] **Step 6: Typecheck**

Run (repo root): `npm run build`
Expected: Vite build succeeds, no unused-variable errors.

- [ ] **Step 7: Manual verification**

Run `npm run dev`, open Browse Jobs. Confirm every job card shows either a star rating
chip (when the employer has reviews) or a muted "No reviews yet" chip — without needing
to expand the card. Expand a card with reviews and confirm each review shows the
correct tier badge (Verified employee / Received offer / Interviewed here).

- [ ] **Step 8: Commit**

```bash
git add components/BrowseJobs.tsx
git commit -m "feat(reviews): always-visible rating chip and graded tier badges"
```

---

### Task 6: Modal copy + i18n keys across all six languages

Add the new tier-badge and empty-state keys, update the modal/verification copy to the
graded wording, in all six languages and both localization directories.

**Files:**
- Modify: `components/CompanyReviewModal.tsx`
- Modify: `localization/{en,zh,de,fr,ja,vi}.json`
- Modify: `public/localization/{en,zh,de,fr,ja,vi}.json`

**Interfaces:**
- Produces i18n keys consumed by Task 5 (`review_tier_hired`, `review_tier_offer`,
  `review_tier_interviewed`, `browse_jobs_no_reviews`).

- [ ] **Step 1: Update the modal verification note**

In `components/CompanyReviewModal.tsx` the note already uses `t('review_verified_note')`
and the inline error uses `t('review_not_verified')`. No code change is needed — only
the string values change (Step 2). Confirm no hardcoded copy is introduced.

- [ ] **Step 2: Add/update keys in `localization/en.json` AND `public/localization/en.json`**

Add these keys (next to the existing `review_*` keys, ~line 1762-1776) and update the
two existing values noted:

```json
  "review_tier_hired": "Verified employee",
  "review_tier_offer": "Received offer",
  "review_tier_interviewed": "Interviewed here",
  "browse_jobs_no_reviews": "No reviews yet",
  "review_verified_note": "Reviews are posted anonymously. Your trust tier (interviewed, received offer, or hired) is shown based on how far you progressed with this company on the platform.",
  "review_not_verified": "Only candidates who interviewed or progressed further with this company through the platform can review it."
```

(The existing `review_verified_badge` key may remain; it is no longer referenced once
Task 5 lands, but leaving it does no harm. Remove it only if you also confirm no other
file references it.)

- [ ] **Step 3: Add/update the same keys in `zh`**

In `localization/zh.json` AND `public/localization/zh.json`:

```json
  "review_tier_hired": "已验证·入职",
  "review_tier_offer": "拿到 Offer",
  "review_tier_interviewed": "面试候选人",
  "browse_jobs_no_reviews": "暂无评价",
  "review_verified_note": "评价以匿名方式发布。系统会根据你在平台上与该公司的推进程度（面试、拿到 Offer 或已入职）显示你的可信等级。",
  "review_not_verified": "只有通过平台与该公司面试过或推进得更深入的候选人才能评价它。"
```

- [ ] **Step 4: Add/update the same keys in `de`**

In `localization/de.json` AND `public/localization/de.json`:

```json
  "review_tier_hired": "Verifizierte:r Mitarbeiter:in",
  "review_tier_offer": "Angebot erhalten",
  "review_tier_interviewed": "Hier interviewt",
  "browse_jobs_no_reviews": "Noch keine Bewertungen",
  "review_verified_note": "Bewertungen werden anonym veröffentlicht. Deine Vertrauensstufe (interviewt, Angebot erhalten oder eingestellt) wird anhand deines Fortschritts mit diesem Unternehmen auf der Plattform angezeigt.",
  "review_not_verified": "Nur Kandidat:innen, die über die Plattform bei diesem Unternehmen interviewt wurden oder weiter gekommen sind, können es bewerten."
```

- [ ] **Step 5: Add/update the same keys in `fr`**

In `localization/fr.json` AND `public/localization/fr.json`:

```json
  "review_tier_hired": "Employé vérifié",
  "review_tier_offer": "Offre reçue",
  "review_tier_interviewed": "Entretien passé ici",
  "browse_jobs_no_reviews": "Pas encore d'avis",
  "review_verified_note": "Les avis sont publiés de façon anonyme. Votre niveau de confiance (entretien, offre reçue ou embauché) s'affiche selon votre progression avec cette entreprise sur la plateforme.",
  "review_not_verified": "Seuls les candidats ayant passé un entretien ou progressé davantage avec cette entreprise via la plateforme peuvent l'évaluer."
```

- [ ] **Step 6: Add/update the same keys in `ja`**

In `localization/ja.json` AND `public/localization/ja.json`:

```json
  "review_tier_hired": "認証済み社員",
  "review_tier_offer": "オファー獲得",
  "review_tier_interviewed": "面接経験あり",
  "browse_jobs_no_reviews": "まだレビューがありません",
  "review_verified_note": "レビューは匿名で公開されます。プラットフォーム上でこの企業とどこまで進んだか（面接・オファー獲得・入社）に応じて信頼ランクが表示されます。",
  "review_not_verified": "プラットフォーム経由でこの企業の面接を受けた、またはそれ以上進んだ候補者のみがレビューできます。"
```

- [ ] **Step 7: Add/update the same keys in `vi`**

In `localization/vi.json` AND `public/localization/vi.json`:

```json
  "review_tier_hired": "Nhân viên đã xác minh",
  "review_tier_offer": "Đã nhận offer",
  "review_tier_interviewed": "Đã phỏng vấn",
  "browse_jobs_no_reviews": "Chưa có đánh giá",
  "review_verified_note": "Đánh giá được đăng ẩn danh. Mức độ tin cậy của bạn (đã phỏng vấn, đã nhận offer hoặc đã được tuyển) hiển thị dựa trên mức độ bạn tiến xa với công ty này trên nền tảng.",
  "review_not_verified": "Chỉ những ứng viên đã phỏng vấn hoặc tiến xa hơn với công ty này qua nền tảng mới có thể đánh giá."
```

- [ ] **Step 8: Verify JSON validity + parity**

Run:

```bash
for f in en zh de fr ja vi; do node -e "JSON.parse(require('fs').readFileSync('localization/$f.json'))" && node -e "JSON.parse(require('fs').readFileSync('public/localization/$f.json'))"; done && echo "all valid"
```

Expected: `all valid`. Then spot-check that `review_tier_hired` exists in all 12 files:

```bash
grep -l "review_tier_hired" localization/*.json public/localization/*.json | wc -l
```

Expected: `12`.

- [ ] **Step 9: Typecheck**

Run (repo root): `npm run build`
Expected: Vite build succeeds.

- [ ] **Step 10: Commit**

```bash
git add components/CompanyReviewModal.tsx localization public/localization
git commit -m "i18n(reviews): graded tier badges, no-reviews state, updated modal copy"
```

---

## Verification (whole feature)

After all tasks, optionally exercise end-to-end against the Firebase emulators
(`cd functions && npm run dev`) or the shared test project: create an interview-stage
application for a test employer, submit a review via My Applications, and confirm the
rating chip + tier badge appear in Browse Jobs. The data-target decision (emulator vs
`career-copilot-a3168`) is made at verification time.

## Self-Review Notes

- **Spec coverage:** verification tiers (Task 1), data model `verification_tier` +
  `employer_rating` (Tasks 1-2), backend callable + trigger (Tasks 1-2), client layer
  (Task 3), MyApplications entry (Task 4), BrowseJobs always-visible chip + badges
  (Task 5), rules (Task 2), i18n in 6 langs × 2 dirs (Task 6). All spec sections map to
  a task.
- **Type consistency:** `verification_tier` (server/JSON wire) ↔ `verificationTier`
  (client type) used consistently; `getEmployerRating` returns `{ avg, count }` matching
  `RatingEntry` in BrowseJobs; tier union `'hired' | 'offer' | 'interviewed'` identical
  across handler, client type, and badge helper.
- **No automated tests** by project convention; verification is build + lint + manual.
