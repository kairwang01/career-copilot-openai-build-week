import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('public-site release contract', () => {
  it('documents the default public UI without a stale beta feature flag', () => {
    const design = read('marketing/Design.md');
    const qa = read('marketing/docs/QA.md');

    expect(design).toContain('There is no marketing feature flag');
    expect(design).toContain('University, course-team, customer, or third-party approval copy is not part');
    expect(qa).not.toContain('VITE_BETA_REDESIGN');
    expect(qa).not.toContain('npm run beta:qa');
  });

  it('starts screenshot QA portably and rejects the removed public footer copy', () => {
    const script = read('marketing/scripts/screenshot-qa.mjs');

    expect(script).toContain("spawn(process.execPath, [viteEntrypoint");
    expect(script).toContain('shell: false');
    expect(script).toContain('Beta 预览版。功能和数据可能会在正式发布前调整。');
    expect(script).toContain('渥太华大学 · ELG 5902');
    expect(script).not.toContain('VITE_BETA_REDESIGN');
  });

  it('keeps the token mirror aligned with the local system font policy', () => {
    const tokens = read('marketing/design-tokens.ts');
    const css = read('marketing/site-theme.css');

    expect(tokens).toContain('system-ui, -apple-system');
    expect(tokens).not.toContain('DM Sans');
    expect(css).toContain('system-ui, -apple-system');
  });

  it('treats verified email delivery as a real password-onboarding gate', () => {
    const emailGate = read('docs/email-deliverability.md');
    const checklist = read('docs/deploy-checklist.md');

    expect(emailGate).toContain('emailVerified === false');
    expect(emailGate).toMatch(/NO-GO\s+for password-based customer onboarding/);
    expect(emailGate).not.toContain('verification is **non-blocking**');
    expect(checklist).toContain('successful send API response alone is not enough');
  });

  it('uses one normalized and storage-safe marketing language state', () => {
    const localizationHook = read('hooks/useLocalization.ts');
    const provider = read('marketing/contexts/MarketingI18nContext.tsx');
    const seo = read('marketing/components/SiteSeo.tsx');

    expect(localizationHook.match(/normalizeUiLanguage\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(provider).toContain('useLocalization()');
    expect(provider).not.toContain("localStorage.getItem('preferred_language')");
    expect(seo).not.toContain('LANGUAGE_STORAGE_KEY');
    expect(seo).not.toContain("addEventListener('storage'");
  });
});
