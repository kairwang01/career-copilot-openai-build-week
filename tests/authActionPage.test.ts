import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const actionPageSource = readFileSync(
  new URL('../marketing/pages/AuthActionPage.tsx', import.meta.url),
  'utf8',
);

describe('/auth/action user flow', () => {
  it('offers an in-app password reset form and consumes the validated code', () => {
    expect(actionPageSource).toContain('completePasswordReset(firebaseAuth, oobCode, newPassword)');
    expect(actionPageSource).toContain('id="auth-action-new-password"');
    expect(actionPageSource).toContain('id="auth-action-confirm-password"');
    expect(actionPageSource).toContain('autoComplete="new-password"');
    expect(actionPageSource).not.toContain("t('auth_action_reset_use_app')");
  });

  it('removes a consumed out-of-band code instead of following continueUrl', () => {
    expect(actionPageSource).toContain("window.history.replaceState(window.history.state, '', SITE_ROUTES.authAction)");
    expect(actionPageSource).not.toMatch(/continueUrl|continueURL/);
  });

  it('provides labelled errors, busy states, and mobile-safe controls', () => {
    expect(actionPageSource).toContain('role="alert"');
    expect(actionPageSource).toContain('aria-busy={submitting}');
    expect(actionPageSource).toContain('htmlFor="auth-action-new-password"');
    expect(actionPageSource).toContain('htmlFor="auth-action-confirm-password"');
    expect(actionPageSource).toContain('min-h-dvh');
    expect(actionPageSource).toContain('px-3 py-5 sm:items-center');
    expect(actionPageSource).toContain('min-h-11 w-full');
  });

  it('offers an explicit retry only for transient action failures', () => {
    expect(actionPageSource).toContain("outcome.reason === 'apply_failed'");
    expect(actionPageSource).toContain("t('action_retry')");
    expect(actionPageSource).toContain('setAttempt((value) => value + 1)');
  });
});
