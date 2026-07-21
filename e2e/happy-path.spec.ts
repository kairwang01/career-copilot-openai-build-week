import { test, expect } from '@playwright/test';

/**
 * SCRUM-42 — core happy path: authenticated candidate runs a tool and reaches
 * My Applications. Uses the pre-seeded (email-verified) candidate from
 * scripts/seed-emulator.mjs because a fresh UI signup requires email verification
 * before workspace access; the seeded account exercises the same authed journey.
 * The LLM is stubbed (E2E_LLM_STUB) so the tool run is deterministic and free.
 */
const CANDIDATE = { email: 'candidate@careercopilot.test', password: 'QaSeed!2026' };

test.beforeEach(async ({ page }) => {
  // Force English so text-based assertions/selectors are deterministic.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('preferred_language', 'en');
    } catch {
      /* ignore */
    }
  });
});

test('candidate can sign in, run a tool, and reach My Applications', async ({ page }) => {
  // 1) Sign in with the seeded, verified candidate.
  await page.goto('/workspace?auth=signin');
  await page.locator('input[type="email"]').first().fill(CANDIDATE.email);
  await page.locator('input[type="password"]').first().fill(CANDIDATE.password);
  await page.locator('form button[type="submit"]').first().click();

  // 2) Authenticated workspace loads (credits badge "… CR" appears post-login).
  await expect(page.getByText(/\bCR\b/).first()).toBeVisible({ timeout: 30_000 });

  // 3) Tool run - the Resume view runs resume analysis on the seeded resume_text.
  //    (The dashboard "Run readiness pass" only navigates here; the real run is here.)
  await page.getByRole('button', { name: 'Resume', exact: true }).click();

  // Dismiss any onboarding/coach prompt that could intercept the click.
  for (const label of ['No thanks', 'Got it']) {
    const b = page.getByRole('button', { name: label, exact: true }).first();
    if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
  }

  // "Run resume analysis" opens the resume workspace; the real metered run is the
  // "Score My Resume" submit on the seeded resume_text.
  const openWorkspace = page.getByRole('button', { name: /run resume analysis/i }).first();
  await openWorkspace.waitFor({ state: 'visible', timeout: 30_000 });
  await openWorkspace.click();

  const scoreBtn = page.getByRole('button', { name: /score my resume/i }).first();
  await scoreBtn.waitFor({ state: 'visible', timeout: 30_000 });
  await scoreBtn.click();

  // Credit confirmation dialog ("Use 10 credits?") -> confirm with "Run it".
  const runIt = page.getByRole('button', { name: /run it/i });
  await runIt.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  if (await runIt.isVisible().catch(() => false)) await runIt.click();

  // Proof the metered tool actually ran end-to-end (auth -> callable -> meterToolRun
  // -> schema-valid stub): resume-analysis costs 10 credits, so the seeded 100 CR
  // balance becomes exactly 90 and the structured result renders. A failed call is
  // refunded to 100, while a no-op/navigation never reaches the result heading.
  await expect(page.getByText('90 CR', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Your Resume Analysis', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: "What's Working", exact: true })).toBeVisible();

  // 4) My Applications renders via the sidebar nav (exact label avoids "Applied pipeline").
  await page.getByRole('button', { name: 'Applications', exact: true }).click();
  await expect(page.getByText(/application/i).first()).toBeVisible({ timeout: 20_000 });
});
