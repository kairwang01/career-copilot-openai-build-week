/** Top-level marketing and workspace routes for the public site shell. */
export { SITE_ORIGIN } from './site-origin.mjs';

export const SITE_ROUTES = {
  home: '/',
  employers: '/employers',
  sampleReport: '/sample-report',
  pricing: '/pricing',
  portal: '/portal',
  /** Firebase email-action links (verify email, etc.) land here for in-app handling. */
  authAction: '/auth/action',
  /** Resume analysis and signed-in candidate tools (avoid `/app` — conflicts with App.tsx on macOS). */
  workspace: '/workspace',
  admin: '/admin',
} as const;
