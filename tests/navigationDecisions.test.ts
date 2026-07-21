import { describe, expect, it } from 'vitest';
import {
  businessPortalNavPath,
  decideWorkspaceShell,
  signedInHomeRedirectPath,
} from '../lib/access/navigationDecisions';

describe('navigation decisions', () => {
  it('does not redirect the public home before session hydration', () => {
    expect(signedInHomeRedirectPath({
      ready: false,
      hasSession: true,
      forceHomeView: false,
      isBusiness: true,
    })).toBeNull();
  });

  it('routes signed-in candidate home visits to workspace, not admin', () => {
    expect(signedInHomeRedirectPath({
      ready: true,
      hasSession: true,
      forceHomeView: false,
      isBusiness: false,
    })).toBe('/workspace');
  });

  it('routes signed-in business home visits to the employer portal', () => {
    expect(signedInHomeRedirectPath({
      ready: true,
      hasSession: true,
      forceHomeView: false,
      isBusiness: true,
    })).toBe('/portal');
  });

  it('honours explicit home view override from the workspace home button', () => {
    expect(signedInHomeRedirectPath({
      ready: true,
      hasSession: true,
      forceHomeView: true,
      isBusiness: true,
    })).toBeNull();
  });

  it('keeps business nav path explicit and shared', () => {
    expect(businessPortalNavPath(true)).toBe('/portal');
    expect(businessPortalNavPath(false)).toBe('/employers');
  });

  it('renders candidate shell for candidate workspace, including admin-candidate accounts', () => {
    expect(decideWorkspaceShell({
      entry: 'workspace',
      hasSession: true,
      profileLoaded: true,
      languageLoaded: true,
      showHomePageOverride: false,
      currentView: 'home',
      role: 'candidate',
      subscriptionStatus: 'free',
    })).toBe('candidate');
  });

  it('renders employer shell only on the portal entry for business accounts', () => {
    expect(decideWorkspaceShell({
      entry: 'portal',
      hasSession: true,
      profileLoaded: true,
      languageLoaded: true,
      showHomePageOverride: false,
      currentView: 'home',
      role: 'employer',
      subscriptionStatus: 'free',
    })).toBe('employer');
  });

  it('does not treat stale candidate business subscriptions as employer portal access', () => {
    expect(decideWorkspaceShell({
      entry: 'portal',
      hasSession: true,
      profileLoaded: true,
      languageLoaded: true,
      showHomePageOverride: false,
      currentView: 'home',
      role: 'candidate',
      subscriptionStatus: 'starter',
    })).toBe('embedded');
  });

  it('keeps unpaid pending business plans on the embedded portal page, not the employer shell', () => {
    expect(decideWorkspaceShell({
      entry: 'portal',
      hasSession: true,
      profileLoaded: true,
      languageLoaded: true,
      showHomePageOverride: false,
      currentView: 'home',
      role: 'candidate',
      subscriptionStatus: 'pending_biz_starter',
    })).toBe('embedded');
  });

  it('does not force the employer portal while the user is explicitly on workspace', () => {
    expect(decideWorkspaceShell({
      entry: 'workspace',
      hasSession: true,
      profileLoaded: true,
      languageLoaded: true,
      showHomePageOverride: false,
      currentView: 'home',
      role: 'employer',
      subscriptionStatus: 'pro',
    })).toBe('embedded');
  });

  it('shows loading while authenticated workspace profile or language state is unsettled', () => {
    expect(decideWorkspaceShell({
      entry: 'workspace',
      hasSession: true,
      profileLoaded: false,
      languageLoaded: true,
      showHomePageOverride: false,
      currentView: 'home',
      role: null,
      subscriptionStatus: null,
    })).toBe('loading');
  });

  it('keeps agency accounts in the embedded app path instead of unsupported fallback', () => {
    expect(decideWorkspaceShell({
      entry: 'workspace',
      hasSession: true,
      profileLoaded: true,
      languageLoaded: true,
      showHomePageOverride: false,
      currentView: 'home',
      role: 'agency',
      subscriptionStatus: 'free',
    })).toBe('embedded');
  });

  it('returns unsupported for unknown signed-in product roles', () => {
    expect(decideWorkspaceShell({
      entry: 'workspace',
      hasSession: true,
      profileLoaded: true,
      languageLoaded: true,
      showHomePageOverride: false,
      currentView: 'home',
      role: 'reviewer',
      subscriptionStatus: 'free',
    })).toBe('unsupported');
  });
});
