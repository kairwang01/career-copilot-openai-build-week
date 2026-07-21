/**
 * useSiteSession — back-compat shim.
 *
 * The session / profile / role logic now lives in a single shared SessionProvider
 * (contexts/SessionContext.tsx) so one login no longer fires N parallel users/{uid}
 * reads. This hook just reads that shared state; the return shape is unchanged, so
 * existing consumers (SiteHeader, SiteMobileNav, JobseekerHomePage, PricingPage) need
 * no edits.
 */
export type { SiteSessionState } from '../../contexts/SessionContext';
export { useSession as useSiteSession } from '../../contexts/SessionContext';
