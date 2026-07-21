import { test, expect } from '@playwright/test';

/**
 * Employer ATS smoke: seeded employer can review applicants for a seeded job.
 *
 * This locks the employer-side path that has historically been hard to verify:
 * portal routing, owner-scoped job/application reads, listJobApplicants callable,
 * applicant-funnel rendering, and bulk-selection controls. The LLM is stubbed by
 * the npm script, so the match analysis is deterministic and emulator-safe.
 */
const EMPLOYER = { email: 'employer@careercopilot.test', password: 'QaSeed!2026' };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('preferred_language', 'en');
    } catch {
      /* ignore */
    }
  });
});

test('employer can open applicant funnel for a seeded job', async ({ page }) => {
  await page.goto('/portal?auth=signin');
  await page.locator('input[type="email"]').first().fill(EMPLOYER.email);
  await page.locator('input[type="password"]').first().fill(EMPLOYER.password);
  await page.locator('form button[type="submit"]').first().click();

  await expect(page.locator('[data-qa-employer-page="dashboard"]')).toBeVisible({ timeout: 30_000 });

  await page.locator('[data-qa="employer-nav-job-listings"]').click();
  await expect(page.locator('[data-qa-employer-page="job-listings"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: /job posting queue/i })).toBeVisible();
  await expect(page.getByText('Frontend Engineer').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /review candidates/i }).first()).toBeVisible();

  await page.getByRole('button', { name: /review candidates/i }).first().click();

  await expect(page.locator('[data-qa-employer-page="applicant-funnel"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Hiring funnel for Frontend Engineer/i)).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('button').filter({ hasText: 'Casey Candidate' }).first()).toBeVisible();
  await expect(page.locator('button').filter({ hasText: 'Jordan Lee' }).first()).toBeVisible();
  await expect(page.getByText(/2 of 2 applicants shown/i).first()).toBeVisible();

  const caseyCard = page
    .locator('[data-qa="applicant-card"][data-qa-applicant-id="qa-app-1"], [data-qa="applicant-card"][data-qa-applicant-id="seed-app-casey"]')
    .first();
  await expect(caseyCard).toBeVisible({ timeout: 20_000 });
  await caseyCard.click();
  await expect(page.locator('[data-qa="applicant-interviews-section"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-qa="application-message-thread"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-qa="scorecard-summary"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Applicant details could not be shown/i)).toHaveCount(0);
  await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);

  await page.getByLabel(/select visible/i).check();
  await expect(page.getByText(/2 selected/i).first()).toBeVisible();
  await expect(page.getByLabel(/batch action/i).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /apply/i }).first()).toBeVisible();
});
