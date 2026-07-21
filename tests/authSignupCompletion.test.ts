import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const authSource = readFileSync(new URL('../components/Auth.tsx', import.meta.url), 'utf8');
const businessSignupSource = readFileSync(new URL('../components/business/BusinessSignUpModal.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../CareerApp.tsx', import.meta.url), 'utf8');

describe('candidate signup completion state', () => {
  it('replaces and locks the create-account form as soon as Auth succeeds', () => {
    expect(authSource).toContain('const [signupComplete, setSignupComplete] = useState(false);');
    expect(authSource).toContain('if (signupComplete) return;');
    expect(authSource).toMatch(/if \(authData\) \{[\s\S]*?setSignupComplete\(true\);/);
    expect(authSource).toMatch(/case 'sign_up':[\s\S]*?if \(signupComplete\)[\s\S]*?onClick=\{onClose\}/);
    expect(authSource).toMatch(/disabled=\{loading\}[\s\S]*?auth_creating_account/);
  });

  it('also locks the form after a successful Google handoff', () => {
    expect(authSource).toMatch(/if \(error\) \{[\s\S]*?\} else \{\s*setSignupComplete\(true\);/);
  });

  it('only offers implemented recurring plans in the legacy employer signup path', () => {
    expect(authSource).toContain('[BUSINESS_PLANS.starter, BUSINESS_PLANS.growth, BUSINESS_PLANS.pro]');
    expect(authSource).not.toContain('BUSINESS_PLANS.single_post');
    expect(authSource).not.toContain('BUSINESS_PLANS.job_pack');
    expect(authSource).not.toContain("mode === 'business' ? 'single_post'");
  });

  it('bootstraps business identity only through the server callable', () => {
    expect(authSource).toContain("const [companyName, setCompanyName] = useState('');");
    expect(authSource).toContain("{ companyName: trimmedCompanyName }");
    expect(authSource).not.toContain('data.profiles.upsert({');
    expect(businessSignupSource).toContain('companyName: trimmedOrgName');
    expect(businessSignupSource).not.toContain('data.profiles.upsert({');
  });

  it('never repairs a missing profile by writing trusted fields from the browser', () => {
    expect(appSource).not.toMatch(/data\.profiles\.(?:update|upsert)\([^)]*\{\s*role\b/s);
    expect(appSource).not.toMatch(/data\.profiles\.upsert\([\s\S]*?\bcredits\s*:/);
    expect(appSource).toContain('const subscriptionResult = await setUserSubscription(planKey');
  });

  it('uses the shared icon library instead of an inline hand-drawn provider asset', () => {
    expect(authSource).toContain('<LogIn');
    expect(authSource).not.toContain('<svg');
  });
});
