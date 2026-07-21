import React, { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { data } from '../lib/data';
import type { AppSession } from '../lib/data';
import type { UserProfile } from '../types';
import { adminCheckAccess } from '../services/adminClient';
import { hasBusinessPortalAccess } from '../lib/access/businessAccess';
import { applyProfileSnapshotResult, type ProfileSnapshotState } from '../lib/profileSnapshotState';

export interface SiteSessionState {
  /** Firebase auth session, or null when signed out. */
  session: AppSession | null;
  /** The signed-in user's profile (role / subscription), or null. */
  profile: UserProfile | null;
  /** Live profile read failure; null is distinct from a truly absent document. */
  profileError: string | null;
  /** Reconnect the live profile listener after a transient failure. */
  retryProfile: () => void;
  /** True once we've resolved the initial auth state (avoids a logged-out flash). */
  ready: boolean;
  /**
   * True once the FIRST session value (logged-in or out) has resolved — earlier than
   * `ready`, which also waits for profile + admin. Consumers that must react to
   * sign-in/out transitions (not just first paint) gate on this so they don't treat
   * the provider's transient initial null as a sign-out.
   */
  sessionResolved: boolean;
  isAdmin: boolean;
  /** Employer product role. */
  isBusiness: boolean;
}

const SessionContext = createContext<SiteSessionState | undefined>(undefined);

/**
 * Single source of session / profile / role for the whole app.
 *
 * Previously every marketing surface (SiteHeader, SiteMobileNav, JobseekerHomePage,
 * PricingPage) called the useSiteSession HOOK independently, so a single login fired
 * N parallel `users/{uid}` reads, each settling its own `ready` flag on its own clock
 * — the race behind the recurring redirect mismatches. Lifting the identical logic
 * into ONE provider gives every consumer the same settled state from a single read.
 *
 * `ready` / `isAdmin` mirror the old hook's settled-state behavior. `isBusiness`
 * intentionally means active employer access; unpaid pending business checkout
 * intents stay on the embedded portal/pricing path until payment completes.
 */
export const SessionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<AppSession | null>(null);
  const [profileState, setProfileState] = useState<ProfileSnapshotState>({
    ownerId: null,
    profile: null,
    error: null,
  });
  const [isAdmin, setIsAdmin] = useState(false);
  const [sessionResolved, setSessionResolved] = useState(false);
  const [profileSettled, setProfileSettled] = useState(false);
  const [adminSettled, setAdminSettled] = useState(true);
  const [profileRetry, setProfileRetry] = useState(0);
  const retryProfile = useCallback(() => setProfileRetry((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    data.auth.getSession()
      .then((s) => {
        if (!active) return;
        setSession(s);
        setSessionResolved(true);
        // No session means no profile fetch will happen — settle immediately.
        if (!s?.user) {
          setProfileSettled(true);
          setAdminSettled(true);
        }
      })
      .catch(() => {
        // The auth listener below remains the authoritative recovery path.
      });
    const { unsubscribe } = data.auth.onAuthStateChange((_event, s) => {
      if (!active) return;
      setSession(s);
      setSessionResolved(true);
      if (!s?.user) {
        setProfileSettled(true);
        setAdminSettled(true);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!session?.user) {
      setProfileState({ ownerId: null, profile: null, error: null });
      setIsAdmin(false);
      setAdminSettled(true);
      // profileSettled is already set by the session effect for the no-session path.
      return;
    }
    const uid = session.user.id;
    // Reset settled while connecting. Preserve the last good snapshot only when
    // retrying the same account; never leak one account's profile into another.
    setProfileSettled(false);
    setProfileState((previous) => previous.ownerId === uid
      ? { ...previous, error: null }
      : { ownerId: uid, profile: null, error: null });
    setAdminSettled(false);
    const profileSubscription = data.profiles.onChange(uid, (result) => {
      if (!active) return;
      setProfileState((previous) => applyProfileSnapshotResult(previous, uid, result));
      setProfileSettled(true);
    });
    adminCheckAccess()
      .then((r) => {
        if (active) setIsAdmin(!!r.admin);
      })
      .catch(() => {
        if (active) setIsAdmin(false);
      })
      .finally(() => {
        if (active) setAdminSettled(true);
      });
    return () => {
      active = false;
      profileSubscription.unsubscribe();
    };
  }, [session?.user?.id, profileRetry]);

  const profile = profileState.profile;
  const isBusiness = hasBusinessPortalAccess(profile?.role, profile?.subscription_status);
  const ready = sessionResolved && profileSettled && adminSettled;

  return (
    <SessionContext.Provider value={{
      session,
      profile,
      profileError: profileState.error,
      retryProfile,
      ready,
      sessionResolved,
      isAdmin,
      isBusiness,
    }}>
      {children}
    </SessionContext.Provider>
  );
};

/** Read the shared session state. Must be used within <SessionProvider>. */
export function useSession(): SiteSessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return ctx;
}
