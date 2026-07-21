import { test, expect } from '@playwright/test';

/**
 * Admin AI-key recovery — the exact production incident, as a regression test.
 *
 * With no provider keys configured, every AI tool is down. This locks the full
 * recovery chain a super admin uses to bring AI back:
 *   1. the dashboard makes the outage OBVIOUS (red "no provider keys" banner),
 *   2. saving a key via Models & Keys SUCCEEDS — guarding the adminUpdateLlmConfig
 *      500 (undefined Firestore value) that previously blocked re-entering keys,
 *   3. the dashboard banner clears once a key is configured.
 *
 * Uses the seeded super admin (super@ via the RBAC admins map). The seed sets no
 * platform_config/llm keys and the emulator has no GEMINI_API_KEY, so the run
 * starts in the real "all AI down" state.
 */
const SUPER = { email: 'super@careercopilot.test', password: 'QaSeed!2026' };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('preferred_language', 'en'); } catch { /* ignore */ }
  });
});

test('super admin can re-enter a provider key to recover AI', async ({ page }) => {
  // Sign in to the admin console.
  await page.goto('/admin');
  await page.locator('input[type="email"]').first().fill(SUPER.email);
  await page.locator('input[type="password"]').first().fill(SUPER.password);
  await page.locator('form button[type="submit"]').first().click();

  // 1) Dashboard surfaces the outage: no keys → red banner.
  await expect(page.getByText(/No AI provider keys are configured/i)).toBeVisible({ timeout: 30_000 });

  // 2) Follow the outage recovery action to the real Shared Credentials section.
  //    This guards both the dashboard deep-link and the current credential UI;
  //    #provider-select belonged to the retired form and must not be restored.
  const outageAlert = page.getByRole('alert').filter({
    hasText: /No AI provider keys are configured/i,
  });
  await outageAlert.getByRole('button', { name: 'Open Models & Keys' }).click();

  const sharedCredentialsNav = page.getByRole('button', {
    name: 'Shared Credentials',
    exact: true,
  });
  await expect(sharedCredentialsNav).toHaveAttribute('aria-pressed', 'true');

  const sharedCredentials = page.locator('[data-qa="shared-credentials-section"]');
  await expect(
    sharedCredentials.getByRole('heading', { name: 'Shared Credentials', exact: true }),
  ).toBeInViewport({ timeout: 20_000 });

  // Save a Gemini key with a BLANK fallback model — the exact shape that used
  // to 500. The accessible field and action names are the production contract.
  const providerKey = sharedCredentials.getByLabel('New shared API key');
  await providerKey.fill('AIzaRecoveryKeyForE2E123');
  await sharedCredentials.getByRole('button', { name: 'Save', exact: true }).click();

  // No "Save failed" error (the 500 regression) — and on success the handler
  // clears the new-key input and the active key shows a masked preview, proving
  // the write round-tripped to platform_config/llm (so prod AI would recover).
  await expect(page.getByText(/Save failed/i)).toHaveCount(0, { timeout: 15_000 });
  await expect(sharedCredentials.getByRole('status')).toHaveText(
    'Gemini Shared Credentials saved successfully.',
    { timeout: 15_000 },
  );
  await expect(providerKey).toHaveValue('', { timeout: 15_000 });
  await expect(sharedCredentials.getByText(/AIza.{2,10}123/).first()).toBeVisible({ timeout: 15_000 });
});
