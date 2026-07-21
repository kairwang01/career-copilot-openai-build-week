import { test, expect } from '@playwright/test';

/**
 * Web3 credential smoke: with the module enabled, a mint-eligible candidate can
 * connect a wallet and issue the Proof-of-Talent credential. The contract address
 * is a placeholder, so the app runs its labelled "testnet preview" path — the
 * wallet connection is real (ethers + injected provider) but issue/stake/claim are
 * simulated and persisted to the profile. This locks the Web3 闭环 end to end.
 *
 * window.ethereum is mocked (no real wallet/extension in CI). The seed provides
 * platform_config/web3.enabled + a score-90 resume analysis so the mint CTA shows.
 */
// Dedicated mint-eligible candidate (seeded with a score-90 analysis), kept
// separate from the happy-path's candidate so neither fixture disturbs the other.
const CANDIDATE = { email: 'web3@careercopilot.test', password: 'QaSeed!2026' };
const WALLET = '0x1111111111111111111111111111111111111111';

test.beforeEach(async ({ page }) => {
  await page.addInitScript((wallet) => {
    try {
      localStorage.setItem('preferred_language', 'en');
      localStorage.setItem('feature_web3_enabled', 'true');
    } catch {
      /* ignore */
    }
    // Minimal EIP-1193 provider so ethers' BrowserProvider can resolve a signer.
    (window as unknown as { ethereum: unknown }).ethereum = {
      isMetaMask: true,
      request: async ({ method }: { method: string }) => {
        if (method === 'eth_chainId') return '0xaa36a7'; // Sepolia
        if (method === 'net_version') return '11155111';
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [wallet];
        if (method === 'eth_blockNumber') return '0x1';
        return null;
      },
      on: () => {},
      removeListener: () => {},
    };
  }, WALLET);
});

test('candidate connects a wallet and issues the testnet-preview credential', async ({ page }) => {
  await page.goto('/workspace?auth=signin');
  const signInForm = page.locator('form').filter({ has: page.locator('input[type="password"]') });
  await signInForm.locator('input[type="email"]').fill(CANDIDATE.email);
  await signInForm.locator('input[type="password"]').fill(CANDIDATE.password);
  await signInForm.locator('button[type="submit"]').click();

  await expect(page.locator('[data-qa-shell="candidate"]')).toBeVisible({ timeout: 30_000 });

  // The consent choice must remain readable and actionable without obscuring
  // workspace controls. Resolve it explicitly before exercising the credential.
  const consent = page.getByRole('region', { name: /cookie and optional monitoring settings/i });
  await expect(consent).toBeVisible({ timeout: 20_000 });
  const consentBounds = await consent.boundingBox();
  expect(consentBounds?.width ?? 0).toBeGreaterThan(560);
  expect(consentBounds?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(120);
  await consent.getByRole('button', { name: /decline optional monitoring/i }).click();
  await expect(consent).toBeHidden();

  // Open Account settings, where the Web3 credential lives.
  await page.locator('[data-qa="candidate-nav-account"]').click();

  // Module is clearly labelled as a testnet preview (never claims on-chain value).
  await expect(page.locator('[data-qa="web3-preview-notice"]')).toContainText(/Sepolia preview/i, { timeout: 30_000 });

  // Connect the mocked wallet → status flips to Connected + address is shown.
  await page.getByRole('button', { name: /connect wallet/i }).click();
  const walletStatus = page.locator('[data-qa="web3-status-wallet"]');
  await expect(walletStatus).toHaveAttribute('data-state', 'connected', { timeout: 20_000 });
  await expect(walletStatus).toContainText('Connected');
  await expect(page.getByRole('link', { name: WALLET })).toBeVisible();

  // Eligible (seeded score 90) → issue the preview credential.
  const credentialStatus = page.locator('[data-qa="web3-status-credential"]');
  await expect(credentialStatus).toHaveAttribute('data-state', 'eligible', { timeout: 20_000 });
  const offer = page.locator('[data-qa="web3-credential-offer"][data-state="eligible"]');
  await expect(offer).toBeVisible();
  const issueButton = offer.locator('[data-qa="web3-credential-issue"]');
  await expect(issueButton).toBeEnabled();
  await issueButton.click();

  const confirmation = page.getByRole('dialog', { name: /issue credential/i });
  await expect(confirmation).toBeVisible();
  const continueButton = confirmation.getByRole('button', { name: /^continue$/i });
  await expect(continueButton).toBeEnabled();
  await continueButton.click();

  // Credential issued + persisted → the credential status becomes issued.
  await expect(credentialStatus).toHaveAttribute('data-state', 'issued', { timeout: 20_000 });
  await expect(page.locator('[data-qa="web3-credential-issued"][data-state="issued"]')).toBeVisible();
});
