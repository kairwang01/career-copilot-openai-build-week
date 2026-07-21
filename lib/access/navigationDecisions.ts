import { SITE_ROUTES } from '../../config/site';
import { hasBusinessPortalAccess } from './businessAccess';

export type WorkspaceEntry = 'workspace' | 'portal';
export type WorkspaceShellDecision = 'loading' | 'candidate' | 'employer' | 'unsupported' | 'embedded';

export interface SignedInHomeRedirectInput {
  ready: boolean;
  hasSession: boolean;
  forceHomeView: boolean;
  isBusiness: boolean;
}

export interface WorkspaceShellDecisionInput {
  entry: WorkspaceEntry;
  hasSession: boolean;
  profileLoaded: boolean;
  languageLoaded: boolean;
  showHomePageOverride: boolean;
  currentView: string;
  role?: string | null;
  subscriptionStatus?: string | null;
}

export function signedInHomeRedirectPath(input: SignedInHomeRedirectInput): string | null {
  if (!input.ready || !input.hasSession || input.forceHomeView) return null;
  return input.isBusiness ? SITE_ROUTES.portal : SITE_ROUTES.workspace;
}

export function businessPortalNavPath(isBusiness: boolean): string {
  return isBusiness ? SITE_ROUTES.portal : SITE_ROUTES.employers;
}

/**
 * Decides which authenticated product shell should render.
 *
 * Keep this pure and covered by tests: it protects the fragile workspace/portal
 * boundary where admin authority, employer role, business plans, and candidate
 * workspace access used to race each other across duplicated session reads.
 */
export function decideWorkspaceShell(input: WorkspaceShellDecisionInput): WorkspaceShellDecision {
  if (input.hasSession && (!input.profileLoaded || !input.languageLoaded)) return 'loading';

  const canShowProductShell =
    input.hasSession &&
    !input.showHomePageOverride &&
    input.currentView !== 'business' &&
    input.profileLoaded &&
    input.languageLoaded;

  if (!canShowProductShell) return 'embedded';

  const isCandidate = input.role === 'candidate';
  const isBusiness = hasBusinessPortalAccess(input.role, input.subscriptionStatus);
  const isAgency = input.role === 'agency';
  const isKnownWorkspaceRole = isCandidate || isBusiness || isAgency;

  if (input.entry === 'portal' && isBusiness) return 'employer';
  if (input.entry === 'workspace' && isCandidate) return 'candidate';
  if (!isKnownWorkspaceRole) return 'unsupported';

  return 'embedded';
}
