

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ArrowRight, BarChart3, Menu, MessageSquareText } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { AnalysisResult, ResumeImage, UserProfile } from './types';
import { analyzeResume, clearApiStatusIncident, setApiStatusUpdater, setAiModel, setErrorTranslator } from './services/aiClient';
import { DEFAULT_MARKET } from './config';
import { data } from './lib/data';
import { logToolUsage, logResumeAnalysis } from './lib/analytics';
import { setUserSubscription } from './services/subscriptionClient';
import { useLocalization } from './hooks/useLocalization';
import { useToast } from './components/Toast';
import { useCredits } from './contexts/CreditsContext';
import { useApiStatus } from './contexts/ApiStatusContext';
import { useModalBehavior } from './hooks/useModalBehavior';
import ApiStatusBanner from './components/ApiStatusBanner';
import CreditModal from './components/modals/CreditModal';
import { TOOL_CREDIT_COSTS } from './config/credits';

import CookieConsent from './components/CookieConsent';
import UploadSection from './components/UploadSection';
import { uploadResumeFile, deleteResumeFile, MAX_RESUME_BYTES, isSupportedResumeFile } from './services/resumeStorage';
import { commitResumeFileReplacement } from './lib/resumeFileCommit';
import EmptyState from './components/EmptyState';
// Lazy: the analysis result screen (with docx/pdf export) only mounts after a
// run; the coach bot only mounts when opened.
const AnalysisDisplay = React.lazy(() => import('./components/AnalysisDisplay'));
import LoadingSpinner from './components/LoadingSpinner';
import StagedLoader from './components/StagedLoader';
import Auth from './components/Auth';
// Lazy: Account pulls in ethers (Web3) and is only opened from settings, so it
// shouldn't weigh down the initial workspace bundle.
const Account = React.lazy(() => import('./components/Account'));
const ShowcasePage = React.lazy(() => import('./components/ShowcasePage'));
import Dashboard from './components/dashboard/Dashboard';
import {
  CandidateBillingPage,
  CareerPlanPage,
  InterviewPracticePage,
  JobMatchPage,
  ResumeReadinessPage,
} from './components/dashboard/CandidateWorkspacePages';
import Sidebar from './components/Sidebar';
import MyApplications from './components/MyApplications';
import TalentProfileForm from './components/TalentProfileForm';
import { VerifyEmailGate } from './components/VerifyEmailGate';
import type { PortalPage } from './components/employer/EmployerPortal';
const CareerCoachBot = React.lazy(() => import('./components/CareerCoachBot'));
import VerifiedTalentSection from './components/VerifiedTalentSection';
import ApiDocsViewer from './components/ApiDocsViewer';
import { SiteLayout } from './marketing/components/SiteLayout';
import { isWeb3Enabled, onWeb3FlagChange, refreshWeb3Enabled } from './config/featureFlags';
import OnboardingFlow from './components/onboarding/OnboardingFlow';
import WorkspaceTour from './components/onboarding/WorkspaceTour';
import { isOnboardingDue, isTourDone, loadBirthdayLocal, loadPendingOnboardingName, markTourDone } from './lib/onboarding';
import { hasBusinessPortalAccess, normalizeBusinessSubscriptionStatus } from './lib/access/businessAccess';
import {
  DEFAULT_BUSINESS_ENTRY_PLAN,
  shouldRedirectBusinessPlanToCheckout,
} from './lib/access/businessEntryDecisions';
import { decideWorkspaceShell } from './lib/access/navigationDecisions';
import { decideSessionTransition } from './lib/access/sessionTransitions';
import { useSession } from './contexts/SessionContext';
import { useSubscriptionCheckout } from './contexts/SubscriptionCheckoutContext';
import { ALL_TOOLS_CONFIG } from './constants/tools';
import { LanguageSyncBanner } from './components/LanguageSyncBanner';
import {
  LanguageVersionLibrary,
  getLanguageVersion,
  isLanguageVersionLibrary,
  listVersionLanguages,
  upsertLanguageVersion,
} from './lib/languageVersions';
import { canSaveResults, loadToolResult, saveToolResult } from './services/toolResults';
import {
  resolvePricingIntent,
  searchWithoutParams,
  type CandidatePricingPlanKey,
  type CandidatePricingSelection,
} from './lib/pricingIntent';
import './marketing/site-theme.css';

const BusinessPage = React.lazy(() => import('./components/BusinessPage'));
const EmployerPortal = React.lazy(() =>
  import('./components/employer/EmployerPortal').then((module) => ({
    default: module.EmployerPortal,
  })),
);
const AgencyHub = React.lazy(() => import('./components/AgencyHub'));

interface AppContentProps {
  entry?: 'workspace' | 'portal';
}

type DashboardView =
  | 'dashboard' | 'toolkit' | 'resume' | 'talent_profile' | 'jobs' | 'applications'
  | 'interview' | 'plan' | 'portfolio' | 'billing' | 'account' | 'credentials';
type CandidatePlanKey = CandidatePricingPlanKey;

// Breadcrumb i18n keys for the workspace header (mirrors Sidebar labels).
const DASHBOARD_VIEW_LABEL_KEYS: Record<DashboardView, string> = {
  dashboard: 'ws_nav_dashboard',
  toolkit: 'ws_nav_toolkit',
  resume: 'ws_nav_resume',
  talent_profile: 'ws_nav_talent_profile',
  jobs: 'ws_nav_jobs',
  applications: 'ws_nav_applications',
  interview: 'ws_nav_interview',
  plan: 'ws_nav_plan',
  portfolio: 'ws_nav_portfolio',
  billing: 'ws_nav_billing',
  account: 'ws_nav_account',
  credentials: 'ws_nav_credentials',
};

const DASHBOARD_VIEW_PATHS: Record<DashboardView, string> = {
  dashboard: '',
  toolkit: 'tools',
  resume: 'resume',
  talent_profile: 'talent-profile',
  jobs: 'jobs',
  applications: 'applications',
  interview: 'interview',
  plan: 'career-plan',
  portfolio: 'portfolio',
  billing: 'billing',
  account: 'account',
  credentials: 'credentials',
};

const DASHBOARD_PATH_TO_VIEW = Object.entries(DASHBOARD_VIEW_PATHS).reduce<Record<string, DashboardView>>(
  (acc, [view, path]) => {
    acc[path] = view as DashboardView;
    return acc;
  },
  {},
);

const DASHBOARD_PATH_ALIASES: Record<string, DashboardView> = {
  plan: 'plan',
  career: 'plan',
  'talent-profile': 'talent_profile',
  profile: 'talent_profile',
  tools: 'toolkit',
  showcase: 'portfolio',
};

const dashboardViewFromPath = (pathname: string): DashboardView | null => {
  if (!pathname.startsWith('/workspace')) return null;
  const rest = pathname.replace(/^\/workspace\/?/, '');
  const segment = rest.split('/')[0] ?? '';
  return DASHBOARD_PATH_TO_VIEW[segment] ?? DASHBOARD_PATH_ALIASES[segment] ?? null;
};

const dashboardPathForView = (view: DashboardView): string => {
  const segment = DASHBOARD_VIEW_PATHS[view];
  return segment ? `/workspace/${segment}` : '/workspace';
};

const INTERNAL_WORKSPACE_TOOL_KEYS = ['website-builder'] as const;
const WORKSPACE_TOOL_KEYS = new Set([
  ...ALL_TOOLS_CONFIG.map((tool) => tool.key),
  ...INTERNAL_WORKSPACE_TOOL_KEYS,
]);

const workspaceToolFromSearch = (search: string): string | null => {
  const tool = new URLSearchParams(search).get('tool');
  return tool && WORKSPACE_TOOL_KEYS.has(tool) ? tool : null;
};

const FIRESTORE_RESUME_TEXT_LIMIT = 200_000;
const resumeTextForProfile = (text: string): string => text.trim().slice(0, FIRESTORE_RESUME_TEXT_LIMIT);

const AppContent: React.FC<AppContentProps> = ({ entry = 'workspace' }) => {
  const navigate = useNavigate();
  const location = useLocation();
  // Session now comes from the shared SessionProvider (single auth subscription for
  // the whole app) — `authHydrated` is the provider's settled flag, `sessionResolved`
  // fires earlier (first session value known) and gates sign-in/out detection below.
  const {
    session,
    profile: sharedProfile,
    profileError: sharedProfileError,
    retryProfile,
    ready: authHydrated,
    sessionResolved,
  } = useSession();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [view, setView] = useState<'home' | 'auth' | 'account' | 'business' | 'agency' | 'api_docs'>('home');
  const [initialAuthView, setInitialAuthView] = useState<'sign_in' | 'sign_up' | 'forgot_password'>('sign_in');
  const [authMode, setAuthMode] = useState<'candidate' | 'business'>('candidate');

  const [resumeText, setResumeText] = useState<string>('');
  const [isSavingResumeFile, setIsSavingResumeFile] = useState(false);
  const [resumeImages, setResumeImages] = useState<ResumeImage[] | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  // Language of the currently-shown analysis, the accumulated per-language
  // version library, and the target language the user dismissed the sync banner
  // for (so we don't re-nag). Powers the "switch vs regenerate" language banner.
  const [analysisLang, setAnalysisLang] = useState<string | null>(null);
  const [analysisLib, setAnalysisLib] = useState<LanguageVersionLibrary<AnalysisResult> | null>(null);
  const [langSyncDismissed, setLangSyncDismissed] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [market, setMarket] = useState<string>(DEFAULT_MARKET);
  const [isUpdatingResume, setIsUpdatingResume] = useState(false);
  const [showHomePageOverride, setShowHomePageOverride] = useState(false);
  const [isProfileLoaded, setIsProfileLoaded] = useState(false);
  const [dashboardView, setDashboardView] = useState<DashboardView>('dashboard');
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [showcaseHasUnsavedPortfolio, setShowcaseHasUnsavedPortfolio] = useState(false);
  const [candidatePlanSaving, setCandidatePlanSaving] = useState<CandidatePlanKey | null>(null);
  const [pendingCandidatePricingIntent, setPendingCandidatePricingIntent] = useState<CandidatePricingSelection | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    // Match the pre-paint bootstrap in index.html so React's first commit agrees
    // with the class already on <html> — otherwise dark-mode users flash light.
    try {
      const stored = localStorage.getItem('theme');
      if (stored === 'light' || stored === 'dark') return stored;
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  // Deep-link target page for the employer hiring portal
  const [portalInitialPage, setPortalInitialPage] = useState<PortalPage>('dashboard');
  // Experimental Web3 module flag — gates the Identity & Wallet view.
  const [web3Enabled, setWeb3Enabled] = useState(isWeb3Enabled());
  // Post-signup guided setup + one-time workspace tour (candidates only).
  const [onboardingActive, setOnboardingActive] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const roleStateKeyRef = useRef<string | null>(null);
  const resumeSaveWarningShownRef = useRef(false);

  const { credits, setCredits } = useCredits();
  const { addToast } = useToast();
  const { startSubscriptionCheckout } = useSubscriptionCheckout();
  const [isCreditModalOpen, setIsCreditModalOpen] = useState(false);
  const analysisCost = TOOL_CREDIT_COSTS['resume-analysis'];

  const { t, isLoaded: isLangLoaded, currentLang, changeLanguage } = useLocalization();
  const { setApiStatus, setLastError } = useApiStatus();
  const isPortalEntry = entry === 'portal';
  const profileRole = profile?.role as string | undefined;
  const normalizedSubscriptionStatus = normalizeBusinessSubscriptionStatus(profile?.subscription_status);
  const isCandidate = profile?.role === 'candidate';
  const isEmployer = hasBusinessPortalAccess(profile?.role, profile?.subscription_status);
  // Admin authority is handled by the dedicated /admin route. It must not
  // override the user's product role here: admin-candidates still need the
  // candidate workspace, and admin-employers still need the hiring portal.
  const candidateMobileNavRef = useRef<HTMLDivElement | null>(null);
  const closeMobileNav = useCallback(() => setIsMobileNavOpen(false), []);
  useModalBehavior(closeMobileNav, isMobileNavOpen, true, candidateMobileNavRef);

  const confirmShowcaseLeave = useCallback(() => {
    if (dashboardView !== 'portfolio' || !showcaseHasUnsavedPortfolio) return true;
    if (!window.confirm(latestTRef.current('showcase_unsaved_leave_confirm'))) return false;
    setShowcaseHasUnsavedPortfolio(false);
    return true;
  }, [dashboardView, showcaseHasUnsavedPortfolio]);

  const setWorkspaceView = useCallback((nextView: DashboardView, options: { replace?: boolean } = {}) => {
    if (nextView !== 'portfolio' && !confirmShowcaseLeave()) return false;
    setDashboardView(nextView);
    if (entry !== 'workspace') return true;
    const nextPath = dashboardPathForView(nextView);
    if (location.pathname !== nextPath) {
      navigate(nextPath, { replace: options.replace ?? false });
    }
    return true;
  }, [confirmShowcaseLeave, entry, location.pathname, navigate]);

  // Keep the Web3 flag in sync and bounce off the credentials view if the
  // module is switched off while the user is on it.
  useEffect(() => {
    let cancelled = false;
    const unsubscribe = onWeb3FlagChange(setWeb3Enabled);
    refreshWeb3Enabled()
      .then((enabled) => { if (!cancelled) setWeb3Enabled(enabled); })
      .catch(() => { /* keep cached fallback */ });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Open the guided setup once for freshly-registered candidates (the pending
  // marker is set by the sign-up form; completion clears it permanently).
  useEffect(() => {
    if (session?.user && isProfileLoaded && isCandidate && isOnboardingDue(session.user.id)) {
      setOnboardingActive(true);
    }
  }, [session, isProfileLoaded, isCandidate]);
  useEffect(() => {
    if (!web3Enabled && dashboardView === 'credentials') setWorkspaceView('dashboard', { replace: true });
  }, [web3Enabled, dashboardView, setWorkspaceView]);

  useEffect(() => {
    const unregister = setApiStatusUpdater((status, errorMsg) => {
        setApiStatus(status);
        setLastError(errorMsg ?? null);
    });
    const handleOnline = () => clearApiStatusIncident();
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
      unregister();
    };
  }, [setApiStatus, setLastError]);

  // A prior account's transient AI failure must not leak into a new session.
  useEffect(() => {
    clearApiStatusIncident();
  }, [session?.user?.id]);

  // Localize callable-error copy: resolve the key, but fall back to the baked-in
  // English when a locale is missing the key (t returns the key itself on a miss).
  useEffect(() => {
    latestTRef.current = t;
    setErrorTranslator((key, fallback) => {
      const resolved = t(key);
      return resolved && resolved !== key ? resolved : fallback;
    });
  }, [t]);


  const uploadSectionRef = useRef<HTMLDivElement>(null);
  // Latches a resume analysis as in-flight so a double-click / repeat keypress on the
  // confirm control can't fire a second charged run before the first resolves.
  const analysisInFlightRef = useRef(false);
  // Business plan changes may redirect to checkout. Keep this synchronous so a
  // double-confirm cannot create two checkout sessions before React disables UI.
  const businessPlanSelectionRef = useRef(false);
  // Tracks the signed-in user so token refreshes / tab refocus don't reset the view.
  const currentUserIdRef = useRef<string | null>(null);
  // Serialize original-file replacements and invalidate superseded selections.
  const resumeFileSelectionRef = useRef(0);
  const resumeFileCommitQueueRef = useRef<Promise<void>>(Promise.resolve());
  const authoritativeResumePathRef = useRef<string | null>(null);
  const profileSyncWarningShownRef = useRef(false);
  // Guards the provider's first resolved session as a no-side-effect baseline (a
  // returning user's restore must not be treated as a fresh sign-in).
  const sessionBaselineSetRef = useRef(false);
  // Prevents React effect replays from reopening the same pricing intent while
  // its URL-backed confirmation is already visible.
  const pricingIntentHandledRef = useRef<string | null>(null);
  // Latest t() for use inside the auth listener (whose deps stay minimal so it
  // doesn't re-subscribe on every locale change).
  const latestTRef = useRef(t);

  useEffect(() => {
    authoritativeResumePathRef.current = profile?.resume_file_path ?? null;
  }, [profile?.resume_file_path]);
  
  // Apply theme class to HTML element and persist changes. Initial theme is
  // resolved synchronously in useState above (matching the index.html bootstrap),
  // so this only re-applies on an explicit toggle — no flash on first paint.
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove(theme === 'dark' ? 'light' : 'dark');
    root.classList.add(theme);
    root.style.colorScheme = theme;
    try { localStorage.setItem('theme', theme); } catch { /* storage unavailable */ }
  }, [theme]);
  
  const toggleTheme = () => {
    setTheme(prevTheme => prevTheme === 'light' ? 'dark' : 'light');
  };

  useEffect(() => {
    // Honour ?auth=signin|signup|forgot on the /workspace surface. Reads react-router's
    // reactive location.search (NOT window.location) and depends on it, so clicking the
    // header "Sign In" link AGAIN — e.g. after signing out while still mounted on
    // /workspace — re-opens the auth view. (Previously a one-shot ref + non-reactive
    // window.location.search meant the second click did nothing.)
    //
    // Wait for Firebase to restore a persisted session first: a returning, already
    // signed-in user must not be shown the modal (session guard below).
    if (entry !== 'workspace' || !authHydrated || session) return;

    const params = new URLSearchParams(location.search);
    const auth = params.get('auth');
    if (auth !== 'signin' && auth !== 'signup' && auth !== 'forgot') return;

    setAuthMode('candidate');
    setInitialAuthView(auth === 'signup' ? 'sign_up' : auth === 'forgot' ? 'forgot_password' : 'sign_in');
    setView('auth');
    // A pricing choice remains URL-backed until the user confirms or dismisses
    // it. This keeps the exact choice across sign-in, registration and refresh.
    if (params.has('pricing_intent')) return;

    // Remove only the handled auth parameter. Campaign/deep-link parameters must
    // survive opening the modal.
    navigate(
      {
        pathname: location.pathname,
        search: searchWithoutParams(location.search, ['auth']),
        hash: location.hash,
      },
      { replace: true },
    );
  }, [entry, session, authHydrated, location.search, location.pathname, location.hash, navigate]);

  useEffect(() => {
    if (entry !== 'workspace' || !authHydrated) return;

    const resolution = resolvePricingIntent(location.search);
    if (resolution.state === 'none') {
      pricingIntentHandledRef.current = null;
      setPendingCandidatePricingIntent((current) => current ? null : current);
      return;
    }

    const sessionId = session?.user?.id ?? 'signed-out';
    const fingerprint = `${sessionId}:${resolution.source}`;
    const clearRejectedIntent = () => {
      if (pricingIntentHandledRef.current === fingerprint) return;
      pricingIntentHandledRef.current = fingerprint;
      setPendingCandidatePricingIntent(null);
      navigate(
        {
          pathname: location.pathname,
          search: searchWithoutParams(location.search, session ? ['pricing_intent', 'auth'] : ['pricing_intent']),
          hash: location.hash,
        },
        { replace: true },
      );
    };

    if (resolution.state === 'invalid' || resolution.selection.audience !== 'candidate') {
      clearRejectedIntent();
      return;
    }

    if (!session) {
      if (pricingIntentHandledRef.current === fingerprint) return;
      pricingIntentHandledRef.current = fingerprint;
      const requestedAuth = new URLSearchParams(location.search).get('auth');
      setAuthMode('candidate');
      setInitialAuthView(
        requestedAuth === 'signin'
          ? 'sign_in'
          : requestedAuth === 'forgot'
            ? 'forgot_password'
            : 'sign_up',
      );
      setView('auth');
      return;
    }

    // Role and onboarding state are authoritative only after the profile has
    // loaded. Keep the intent in the URL while either is still being resolved.
    if (!isProfileLoaded) return;
    if (!isCandidate) {
      clearRejectedIntent();
      return;
    }
    if (session.user.emailVerified === false || onboardingActive || isOnboardingDue(session.user.id)) return;
    if (pricingIntentHandledRef.current === fingerprint) return;

    pricingIntentHandledRef.current = fingerprint;
    setPendingCandidatePricingIntent(resolution.selection);
    setDashboardView('billing');
    navigate(
      {
        pathname: dashboardPathForView('billing'),
        // The pricing token remains until the confirmation is explicitly closed.
        search: searchWithoutParams(location.search, ['auth']),
        hash: location.hash,
      },
      { replace: true },
    );
  }, [
    entry,
    authHydrated,
    session,
    isProfileLoaded,
    isCandidate,
    onboardingActive,
    location.pathname,
    location.search,
    location.hash,
    navigate,
  ]);

  const handleCandidatePricingIntentHandled = useCallback(() => {
    setPendingCandidatePricingIntent(null);
    pricingIntentHandledRef.current = null;
    navigate(
      {
        pathname: location.pathname,
        search: searchWithoutParams(location.search, ['pricing_intent', 'auth']),
        hash: location.hash,
      },
      { replace: true },
    );
  }, [location.pathname, location.search, location.hash, navigate]);

  // Email "view application" deep-link: the status-change email links to
  // /workspace?app=<id>. A signed-in candidate arriving with it should land on
  // My Applications (it was previously ignored → dropped them on the dashboard).
  useEffect(() => {
    if (entry !== 'workspace' || !session || !isProfileLoaded) return;
    const appParam = new URLSearchParams(location.search).get('app');
    if (!appParam) return;
    setWorkspaceView('applications', { replace: true });
  }, [entry, session, isProfileLoaded, location.search, setWorkspaceView]);

  // URL-backed candidate workspace: refresh/back/forward must preserve the
  // active section instead of falling back to the dashboard-only state.
  useEffect(() => {
    if (entry !== 'workspace') return;
    const pathView = dashboardViewFromPath(location.pathname);
    if (pathView) {
      if (pathView !== dashboardView) {
        if (dashboardView === 'portfolio' && pathView !== 'portfolio' && showcaseHasUnsavedPortfolio) {
          if (!window.confirm(latestTRef.current('showcase_unsaved_leave_confirm'))) {
            navigate(dashboardPathForView('portfolio'), { replace: true });
            return;
          }
          setShowcaseHasUnsavedPortfolio(false);
        }
        setDashboardView(pathView);
        if (pathView !== 'toolkit') setActiveTool(null);
        setAnalysisResult(null);
        if (pathView !== 'resume') setIsUpdatingResume(false);
      }
      if (pathView === 'toolkit') {
        const rawTool = new URLSearchParams(location.search).get('tool');
        const nextTool = workspaceToolFromSearch(location.search);
        setActiveTool(nextTool);
        if (rawTool && !nextTool) {
          navigate(dashboardPathForView('toolkit'), { replace: true });
        }
      }
      return;
    }
    if (location.pathname.startsWith('/workspace/')) {
      navigate('/workspace', { replace: true });
    }
  }, [entry, location.pathname, location.search, dashboardView, navigate, showcaseHasUnsavedPortfolio]);

  // Close the auth modal as soon as a session exists (login success or async restore).
  useEffect(() => {
    if (session?.user && view === 'auth') {
      setView('home');
    }
  }, [session, view]);

  // Effect to determine and set the UI language based on user preferences or browser settings
  useEffect(() => {
    const storedLang = localStorage.getItem('preferred_language');
    const profileLang = profile?.preferred_language;
    const browserLang = navigator.language.split('-')[0];
    const targetLang = storedLang || profileLang || browserLang || 'en';

    if (targetLang && targetLang !== currentLang) {
        changeLanguage(targetLang);
    }
  }, [profile, currentLang, changeLanguage]);


  // Debounced effect to save resume text to the database (candidates only — employers have no resume)
  useEffect(() => {
    if (session && isProfileLoaded && profile?.role === 'candidate') {
      const handler = setTimeout(async () => {
        if (!session.user) return;
        const showResumeSaveWarning = () => {
          if (resumeSaveWarningShownRef.current) return;
          resumeSaveWarningShownRef.current = true;
          addToast(t('dashboard_resume_save_warning'), 'info');
        };
        try {
          const { error } = await data.profiles.update(session.user.id, { resume_text: resumeTextForProfile(resumeText) });
          if (error) {
            showResumeSaveWarning();
          }
        } catch {
          showResumeSaveWarning();
        }
      }, 1500);

      return () => {
        clearTimeout(handler);
      };
    }
  }, [resumeText, session, isProfileLoaded, profile?.role, addToast, t]);

  // Load the persisted per-language analysis versions for this user, so the
  // language-sync banner can offer a free switch to an already-generated
  // language instead of a paid re-run.
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) { setAnalysisLib(null); return; }
    let cancelled = false;
    loadToolResult<LanguageVersionLibrary<AnalysisResult>>(uid, 'resume-analysis').then((saved) => {
      if (!cancelled && saved && isLanguageVersionLibrary<AnalysisResult>(saved.result)) {
        setAnalysisLib(saved.result);
      }
    });
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  const getProfile = useCallback(async () => {
    try {
      if (!session?.user) return;
      const user = session.user;

      const { data: profileData, error } = await data.profiles.get(user.id);

      if (error && !error.message.includes('not found') && !error.message.includes('not-found')) {
        // Real Firestore error (e.g. permission-denied) — surface it.
        throw new Error(error.message);
      }

      const applyProfile = async (p: UserProfile | null) => {
        if (!p) return;
        // Account switched/signed out while we awaited the read — don't write a stale
        // user's profile/credits/resume into the now-current session.
        if (currentUserIdRef.current !== user.id) return;
        let resolvedProfile = p;
        const legacyBirthDate = p.role === 'candidate' && !p.birth_date ? loadBirthdayLocal(user.id) : '';
        if (legacyBirthDate) {
          resolvedProfile = { ...p, birth_date: legacyBirthDate };
          data.profiles
            .update(user.id, { birth_date: legacyBirthDate, updated_at: new Date().toISOString() })
            .catch(() => {
              // Non-fatal: the Account page will still show the local fallback in this browser.
            });
        }
        setProfile(resolvedProfile);
        setResumeText(resolvedProfile.role === 'candidate' ? resolvedProfile.resume_text || '' : '');

        const userCredits = resolvedProfile.credits || 0;
        setCredits(userCredits);

        const pendingPlan = sessionStorage.getItem('pending_plan');
        const pendingMode = sessionStorage.getItem('pending_mode');
        if (!pendingMode) return;

        try {
          if (pendingPlan) {
            const planKey = pendingMode === 'business'
              ? `pending_biz_${pendingPlan}`
              : pendingPlan === 'free' ? 'free' : `pending_${pendingPlan}`;
            // Carry the OAuth display name so it persists even if the doc is
            // created by this call rather than the onUserCreated trigger.
            const subscriptionResult = await setUserSubscription(planKey, {
              fullName: user.user_metadata?.full_name || loadPendingOnboardingName(),
            });
            if (shouldRedirectBusinessPlanToCheckout(pendingPlan, subscriptionResult.status)) {
              await startSubscriptionCheckout(planKey, { onComplete: getProfile });
              sessionStorage.removeItem('pending_plan');
              sessionStorage.removeItem('pending_mode');
              return;
            }
          }

          // Consume the handoff only after the server accepted it. A transient
          // callable/checkout error must leave the intent available for retry.
          sessionStorage.removeItem('pending_plan');
          sessionStorage.removeItem('pending_mode');

          const { data: refreshed } = await data.profiles.get(user.id);
          if (refreshed) {
            setProfile(refreshed);
            setCredits(refreshed.credits || userCredits);
          }
        } catch (planErr) {
          const message = planErr instanceof Error ? planErr.message : String(planErr);
          addToast(latestTRef.current('selected_plan_apply_failed').replace('{error}', message), 'error');
        }
      };

      if (profileData) {
        await applyProfile(profileData);
      } else {
        // Profile not found — onUserCreated trigger may still be in flight.
        // Retry after 1.5s before giving up.
        await new Promise(r => setTimeout(r, 1500));
        const { data: retryData } = await data.profiles.get(user.id);
        if (retryData) {
          await applyProfile(retryData);
        } else {
          const pendingPlan = sessionStorage.getItem('pending_plan');
          const pendingMode = sessionStorage.getItem('pending_mode');
          const planKey = pendingPlan
            ? pendingMode === 'business'
              ? `pending_biz_${pendingPlan}`
              : pendingPlan === 'free' ? 'free' : `pending_${pendingPlan}`
            : 'free';
          const pendingOnboardingName = loadPendingOnboardingName();
          // A missing profile is repaired by the same server-side bootstrap used
          // during signup. Never recreate role/subscription/credits from the
          // browser: those fields are authorization and billing state.
          const subscriptionResult = await setUserSubscription(planKey, {
            fullName: user.user_metadata?.full_name || pendingOnboardingName || undefined,
          });
          const { data: provisionedProfile, error: provisionError } = await data.profiles.get(user.id);
          if (provisionError || !provisionedProfile) {
            throw new Error(provisionError?.message || 'Profile provisioning did not produce a readable profile.');
          }

          sessionStorage.removeItem('pending_plan');
          sessionStorage.removeItem('pending_mode');
          await applyProfile(provisionedProfile);
          if (
            pendingPlan &&
            subscriptionResult.status === 'pending_payment' &&
            (
              pendingMode !== 'business' ||
              shouldRedirectBusinessPlanToCheckout(pendingPlan, subscriptionResult.status)
            )
          ) {
            await startSubscriptionCheckout(planKey, { onComplete: getProfile });
          }
        }
      }
    } catch {
      setError(latestTRef.current('profile_load_error'));
    } finally {
        setIsProfileLoaded(true);
    }
  }, [session, setCredits, addToast]);

  // Persist the ORIGINAL uploaded resume file to Storage (keeps a downloadable
  // copy of exactly what the candidate submitted). Text extraction + the
  // resume_text auto-save are unchanged; this is purely additive and never
  // blocks analysis. Replacing a file cleans up the previous object.
  const handleResumeFileSelected = useCallback(async (file: File, isSelectionCurrent: () => boolean) => {
    if (!session?.user) return;
    const uid = session.user.id;
    if (file.size >= MAX_RESUME_BYTES) {
      addToast(t('resume_file_too_large'), 'error');
      return;
    }
    if (!isSupportedResumeFile(file)) {
      addToast(t('resume_file_unsupported'), 'error');
      return;
    }
    const selection = ++resumeFileSelectionRef.current;
    setIsSavingResumeFile(true);

    const isCurrent = () => (
      selection === resumeFileSelectionRef.current
      && currentUserIdRef.current === uid
      && isSelectionCurrent()
    );
    const task = resumeFileCommitQueueRef.current.then(async () => {
      if (!isCurrent()) return;
      const result = await commitResumeFileReplacement({
        uid,
        file,
        previousPath: authoritativeResumePathRef.current,
        isCurrent,
        uploadResume: uploadResumeFile,
        saveProfile: async (profileUid, meta) => {
          const { error } = await data.profiles.update(profileUid, {
            ...meta,
            updated_at: new Date().toISOString(),
          });
          if (error) throw new Error(error.message);
        },
        deleteResume: deleteResumeFile,
      });

      if (result.status !== 'saved') return;
      authoritativeResumePathRef.current = result.meta.resume_file_path;
      if (!isCurrent()) return;
      // Patch locally instead of re-fetching: getProfile() could restore a
      // debounced, older resume_text value and visibly revert the editor.
      setProfile((prev) => (prev ? { ...prev, ...result.meta } : prev));
      addToast(t('resume_file_saved_toast'), 'success');
    });
    resumeFileCommitQueueRef.current = task.then(() => undefined, () => undefined);

    try {
      await task;
    } catch (err) {
      // Non-fatal — the extracted text is already saved; only the file copy failed.
      if (isCurrent()) addToast(t('resume_file_upload_failed'), 'error');
      console.error('Resume file upload failed:', err);
    } finally {
      if (selection === resumeFileSelectionRef.current) setIsSavingResumeFile(false);
    }
  }, [session, addToast, t]);

  const handleRemoveResumeFile = useCallback(async () => {
    if (!session?.user) return;
    const uid = session.user.id;
    const operation = ++resumeFileSelectionRef.current;
    setIsSavingResumeFile(true);
    const task = resumeFileCommitQueueRef.current.then(async () => {
      // A newer selection supersedes this queued removal before it mutates data.
      if (operation !== resumeFileSelectionRef.current || currentUserIdRef.current !== uid) return;
      const path = authoritativeResumePathRef.current;
      const { error } = await data.profiles.update(uid, {
        resume_file_url: null,
        resume_file_name: null,
        resume_file_path: null,
        resume_file_size: null,
        resume_file_uploaded_at: null,
        updated_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
      authoritativeResumePathRef.current = null;
      await deleteResumeFile(path);
      if (operation !== resumeFileSelectionRef.current || currentUserIdRef.current !== uid) return;
      setProfile((prev) => (prev ? {
        ...prev,
        resume_file_url: null,
        resume_file_name: null,
        resume_file_path: null,
        resume_file_size: null,
        resume_file_uploaded_at: null,
      } : prev));
      addToast(t('resume_file_removed_toast'), 'info');
    });
    resumeFileCommitQueueRef.current = task.then(() => undefined, () => undefined);

    try {
      await task;
    } catch (err) {
      if (operation === resumeFileSelectionRef.current && currentUserIdRef.current === uid) {
        addToast(t('resume_file_upload_failed'), 'error');
      }
      console.error('Resume file removal failed:', err);
    } finally {
      if (operation === resumeFileSelectionRef.current) setIsSavingResumeFile(false);
    }
  }, [session, addToast, t]);

  const handleBusinessPlanSelection = async (planKey: string) => {
    if (!session || businessPlanSelectionRef.current) return;
    businessPlanSelectionRef.current = true;
    try {
      const pendingPlanKey = `pending_biz_${planKey}`;
      const result = await setUserSubscription(pendingPlanKey);
      if (shouldRedirectBusinessPlanToCheckout(planKey, result.status)) {
        await startSubscriptionCheckout(pendingPlanKey, { onComplete: getProfile });
        return;
      }
      await getProfile();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addToast(t('business_plan_set_failed').replace('{error}', message), 'error');
    } finally {
      businessPlanSelectionRef.current = false;
    }
  };

  const handleCandidatePlanSelection = async (planKey: CandidatePlanKey) => {
    if (!session || candidatePlanSaving) return;
    setCandidatePlanSaving(planKey);
    try {
      const pendingPlanKey = planKey === 'free' ? 'free' : `pending_${planKey}`;
      const result = await setUserSubscription(pendingPlanKey);
      if (result.status === 'pending_payment') {
        await startSubscriptionCheckout(pendingPlanKey, { onComplete: getProfile });
        return;
      }
      await getProfile();
      addToast(t('portal_toast_plan_updated'), 'success');
    } catch (error) {
      addToast(t('portal_toast_plan_update_failed').replace('{error}', (error as Error).message), 'error');
    } finally {
      setCandidatePlanSaving(null);
    }
  };

  // React to the SHARED session (SessionProvider) instead of owning a private auth
  // subscription. The provider emits session VALUES, not SIGNED_IN/SIGNED_OUT events,
  // so intent is reconstructed via decideSessionTransition. The provider's first
  // resolved session is a BASELINE — a returning user's restore — and fires no sign-in
  // reset; only genuine transitions after the baseline do. Token refresh / tab refocus
  // re-emit the same user id → 'none', so the user stays on their current page.
  useEffect(() => {
    if (!sessionResolved) return; // wait for the provider's first session value
    const nextUserId = session?.user?.id ?? null;

    if (!sessionBaselineSetRef.current) {
      sessionBaselineSetRef.current = true;
      currentUserIdRef.current = nextUserId;
      return; // baseline established — no side-effects on the initial restore
    }

    const transition = decideSessionTransition(currentUserIdRef.current, nextUserId);
    currentUserIdRef.current = nextUserId;

    if (transition === 'signed_out') {
      setView('home');
      setProfile(null);
      setAnalysisResult(null);
      setResumeText('');
      setOnboardingActive(false);
      setShowTour(false);
      setCredits(0);
      sessionStorage.clear();
      try {
        localStorage.removeItem('preferred_ai_model');
      } catch { /* storage unavailable */ }
      setAiModel(undefined);
    } else if (transition === 'signed_in') {
      setIsProfileLoaded(false);
      // Checkout success/cancel is handled in the mount effect below (runs on every
      // load), since the full-page redirect back from checkout is a RESTORE, not a
      // sign-in transition — handling it here would never fire after that reload.
      if (session?.user && session.user.emailVerified === false) {
        // Surface the "verify your email" reminder the signup modal can't show
        // (the auth listener navigates away before it renders). Fires only on a
        // genuine sign-in transition, never on reload or token refresh.
        addToast(latestTRef.current('auth_signup_success_verify'), 'info');
      }
      setView('home');
    }
  }, [sessionResolved, session, setCredits, addToast]);

  // Consume the provider's single live profile source. Credits deducted
  // server-side, tier changes, and payment upgrades now reach marketing and the
  // workspace from the same snapshot instead of two independent listeners.
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid || sharedProfile?.id !== uid) return;
    setProfile((previous) => ({
      ...sharedProfile,
      birth_date: sharedProfile.birth_date ?? previous?.birth_date ?? null,
    }));
    if (typeof sharedProfile.credits === 'number') setCredits(sharedProfile.credits);
  }, [session?.user?.id, sharedProfile, setCredits]);

  useEffect(() => {
    if (!sharedProfileError) {
      profileSyncWarningShownRef.current = false;
      return;
    }
    if (!profileSyncWarningShownRef.current) {
      profileSyncWarningShownRef.current = true;
      addToast(latestTRef.current('profile_updates_unavailable'), 'info');
    }
    const retryTimer = window.setTimeout(retryProfile, 5_000);
    return () => window.clearTimeout(retryTimer);
  }, [sharedProfileError, retryProfile, addToast]);

  useEffect(() => {
    if (!session || (session && isProfileLoaded && !isCandidate)) {
        setIsUpdatingResume(false);
    }
  }, [session, isProfileLoaded, isCandidate]);

  useEffect(() => {
    const roleKey = `${session?.user?.id ?? 'signed-out'}:${profile?.role ?? 'no-role'}:${normalizedSubscriptionStatus}`;
    if (roleStateKeyRef.current === roleKey) return;
    roleStateKeyRef.current = roleKey;

    const nextDashboardView = dashboardViewFromPath(location.pathname) ?? 'dashboard';
    const nextActiveTool = nextDashboardView === 'toolkit'
      ? workspaceToolFromSearch(location.search)
      : null;

    setDashboardView(nextDashboardView);
    setActiveTool(nextActiveTool);
    setAnalysisResult(null);
    setResumeImages(null);
    setIsUpdatingResume(false);

    if (profile?.role === 'candidate') {
      setPortalInitialPage('dashboard');
    }
  }, [session?.user?.id, profile?.role, normalizedSubscriptionStatus, location.pathname, location.search]);


  useEffect(() => {
    // Runs on EVERY load (not only the sign-in transition), so the full-page redirect
    // back from checkout still surfaces feedback AND refreshes the plan/credits via
    // getProfile() — covers both /workspace?checkout=success and /portal?checkout=success.
    const handleCheckoutReturn = () => {
        const urlParams = new URLSearchParams(window.location.search);
        const checkout = urlParams.get('checkout');
        const paid = urlParams.get('payment_success') === 'true' || checkout === 'success';
        const cancelled = urlParams.get('payment_cancelled') === 'true' || checkout === 'cancel';
        const subCancelled = urlParams.get('cancelled') === 'success';
        // Stripe Customer Portal return for business users (return_url is /portal?billing=return).
        // Land on the billing sub-page they launched the portal from (not the default dashboard),
        // and confirm the round-trip with a neutral toast — getProfile() above already refreshes
        // any plan/payment change made inside the portal.
        const billingReturn = urlParams.get('billing') === 'return';
        if (paid) {
            addToast(latestTRef.current('payment_success_plan_upgraded'), 'success');
            window.history.replaceState({}, document.title, window.location.pathname);
        } else if (cancelled) {
            addToast(latestTRef.current('payment_cancelled_try_again'), 'info');
            window.history.replaceState({}, document.title, window.location.pathname);
        } else if (subCancelled) {
            addToast(latestTRef.current('ws_billing_cancel_success'), 'success');
            window.history.replaceState({}, document.title, window.location.pathname);
        } else if (billingReturn) {
            setPortalInitialPage('billing');
            addToast(latestTRef.current('ws_billing_portal_returned'), 'info');
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    };
    if (session) { getProfile(); }
    handleCheckoutReturn();
  }, [session, getProfile]);
  
  const navigateToPricing = () => {
    // The app only ever mounts inside the marketing shell (SiteRouter), so pricing
    // lives on its own route — no in-page scroll target anymore.
    setAnalysisResult(null);
    navigate('/pricing');
  };
  
  const navigateToBusinessPricing = () => {
    navigate('/pricing?from=business-upsell');
  };
  const navigateToAccount = () => { setShowHomePageOverride(false); setView('account'); };

  const handleSetView = (view: 'home' | 'auth' | 'account' | 'business' | 'agency' | 'api_docs', authView: 'sign_in' | 'sign_up' | 'forgot_password' = 'sign_in', mode: 'candidate' | 'business' = 'candidate') => {
    // A signed-in user has no use for the auth modal: opening it just flashes and is
    // instantly closed again by the "session exists" effect, which reads as a frozen,
    // unresponsive click (e.g. a logged-in candidate pressing "Enter Portal" on the
    // employer page). Skip the dead modal. Do NOT send them straight to checkout:
    // non-employers should land on the business page/access prompt, and only an
    // explicit plan-selection action should start payment.
    if (view === 'auth' && session) {
      if (mode === 'business' && !isEmployer) {
        setShowHomePageOverride(false);
        setView('business');
      }
      return;
    }
    if (view !== 'home') { setShowHomePageOverride(false); }
    else { setWorkspaceView('dashboard', { replace: true }); setShowHomePageOverride(false); }
    if (view === 'auth') { setInitialAuthView(authView); setAuthMode(mode); }
    setView(view);
  };


  const userPlan = profile?.subscription_status || 'free';

  const performAnalysis = async () => {
    if (!resumeText.trim() && (!resumeImages || resumeImages.length === 0)) {
      setError(t('resume_analysis_required'));
      return;
    }
    if (analysisInFlightRef.current) return; // double-submit guard
    analysisInFlightRef.current = true;
    const uidAtStart = session?.user?.id ?? null;
    setIsLoading(true);
    setError(null);
    setAnalysisResult(null);

    try {
      const result = await analyzeResume(resumeText, resumeImages, market, currentLang);

      // If the user signed out or switched accounts mid-call, don't render results
      // into — or write the profile of — a session that's no longer current.
      if (currentUserIdRef.current !== uidAtStart) return;

      setAnalysisResult(result);
      // Track the analysis language and fold it into the per-language version
      // library (persisted for paid tiers), so switching UI language can offer a
      // free swap to this version later instead of a paid re-run.
      setAnalysisLang(currentLang);
      setLangSyncDismissed(null);
      setAnalysisLib((prev) => {
        const nextLib = upsertLanguageVersion(prev, currentLang, result, Date.now());
        if (session?.user && canSaveResults(userPlan)) {
          void saveToolResult(session.user.id, 'resume-analysis', nextLib);
        }
        return nextLib;
      });
      let extractedResumeText = '';
      if (result.extractedText) {
        extractedResumeText = resumeTextForProfile(result.extractedText);
        setResumeText(extractedResumeText);
      }
      setIsUpdatingResume(false);

      // History and profile persistence are non-critical follow-up work. Launch
      // them without awaiting so the completed model result can render as soon as
      // this function reaches finally and clears the loader.
      if (uidAtStart) {
        void (async () => {
          try {
            const eventId = await logToolUsage(uidAtStart, 'resume-analysis', { market });
            await logResumeAnalysis(uidAtStart, eventId, {
              score: result.score,
              market_name: market,
              summary: result.summary,
              strengths: result.strengths,
              improvements: result.improvements,
              keywords: result.keywords,
            });
          } catch {
            // Do not surface a stale toast after an account switch.
            if (currentUserIdRef.current === uidAtStart) {
              addToast(t('analysis_history_update_failed'), 'info');
            }
          }
        })();

        void (async () => {
          if (extractedResumeText) {
            try {
              const { error: updateError } = await data.profiles.update(uidAtStart, {
                resume_text: extractedResumeText,
                updated_at: new Date().toISOString(),
              });
              if (updateError) throw new Error(updateError.message);
            } catch {
              // The write targets the original user; only show feedback if that
              // account is still active in this tab.
              if (currentUserIdRef.current === uidAtStart) {
                addToast(t('dashboard_resume_save_warning'), 'info');
              }
            }
          }

          // Resume analysis is metered server-side. Preserve ordering with the
          // extracted-resume save, then refresh credits without blocking results.
          if (currentUserIdRef.current === uidAtStart) {
            await getProfile();
          }
        })();
      }

    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(t('unexpected_error'));
      }
    } finally {
      setIsLoading(false);
      analysisInFlightRef.current = false;
    }
  };

  const handleInitiateAnalysis = (e: React.FormEvent) => {
      e.preventDefault();
      if (!session) {
          handleSetView('auth', 'sign_up');
          return;
      }
      setIsCreditModalOpen(true);
  };
  
  const handleReset = () => {
    setAnalysisResult(null);
    setError(null);
    setResumeImages(null);
    setShowHomePageOverride(false);
    setWorkspaceView('dashboard', { replace: true });
  };

  const handleApplyImprovements = (newText: string) => {
    const reviewedText = resumeTextForProfile(newText);
    setResumeText(reviewedText);
    if (session?.user && reviewedText) {
      data.profiles
        .update(session.user.id, {
          resume_text: reviewedText,
          updated_at: new Date().toISOString(),
        })
        .catch(() => {
          addToast(t('dashboard_resume_save_warning'), 'info');
        });
    }
    handleReset();
  };

  const uploadVariant = 'site' as const;

  const renderAppEntry = () => (
    <>
      <div className="text-center mb-8 sm:mb-10 max-w-2xl mx-auto">
        <h1 className="text-[clamp(1.5rem,3vw,2.25rem)] font-semibold tracking-tight text-[var(--site-text)] mb-3">
          {t('site_app_entry_title')}
        </h1>
        <p className="text-[var(--site-text-muted)]">
          {t('site_app_entry_subtitle')}
        </p>
      </div>
      <div id="upload-section" ref={uploadSectionRef} className="scroll-mt-20">
        <UploadSection
          t={t}
          resumeText={resumeText}
          setResumeText={setResumeText}
          resumeImages={resumeImages}
          setResumeImages={setResumeImages}
          onInitiateAnalysis={handleInitiateAnalysis}
          isLoading={isLoading}
          error={error}
          setError={setError}
          market={market}
          setMarket={setMarket}
          variant={uploadVariant}
          onResumeFileSelected={handleResumeFileSelected}
          isSavingResumeFile={isSavingResumeFile}
          storedResumeFile={profile?.resume_file_url
            ? { name: profile.resume_file_name ?? null, url: profile.resume_file_url, uploadedAt: profile.resume_file_uploaded_at ?? null }
            : null}
          onRemoveResumeFile={handleRemoveResumeFile}
        />
      </div>
    </>
  );

  const renderPortalEntry = () => (
    <React.Suspense fallback={<LoadingSpinner market={market} />}>
      <BusinessPage
        t={t}
        session={session}
        profile={profile}
        onSelectBusinessPlan={handleBusinessPlanSelection}
        onBack={() => navigate('/employers')}
        onEnterPortal={(page) => {
          setPortalInitialPage(page);
          if (isEmployer) {
            handleSetView('home');
          } else {
            handleSetView('auth', 'sign_in', 'business');
          }
        }}
        refreshProfile={getProfile}
        authHydrated={authHydrated}
      />
    </React.Suspense>
  );

  const renderWorkspaceBody = () => (
    <section className="pb-[calc(2.5rem+var(--cookie-consent-bottom-space,0px))] pt-[calc(2.5rem+var(--cookie-consent-top-space,0px))] transition-[padding] duration-200 sm:pb-[calc(3.5rem+var(--cookie-consent-bottom-space,0px))] sm:pt-[calc(3.5rem+var(--cookie-consent-top-space,0px))]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <ApiStatusBanner />
        {isPortalEntry ? renderPortalEntry() : renderContent()}
      </div>
    </section>
  );

  const openWorkspaceTool = (tool: string) => {
    if (!confirmShowcaseLeave()) return;
    if (!WORKSPACE_TOOL_KEYS.has(tool)) {
      setActiveTool(null);
      setDashboardView('toolkit');
      setAnalysisResult(null);
      setIsUpdatingResume(false);
      if (entry === 'workspace') {
        navigate(dashboardPathForView('toolkit'), { replace: true });
      }
      return;
    }

    setActiveTool(tool);
    setDashboardView('toolkit');
    setAnalysisResult(null);
    setIsUpdatingResume(false);
    if (entry === 'workspace') {
      navigate(`${dashboardPathForView('toolkit')}?tool=${encodeURIComponent(tool)}`);
    }
  };

  const setWorkspaceActiveTool = (tool: string | null) => {
    if (tool) {
      openWorkspaceTool(tool);
      return;
    }

    setActiveTool(null);
    if (entry === 'workspace' && dashboardViewFromPath(location.pathname) === 'toolkit') {
      navigate(dashboardPathForView('toolkit'), { replace: true });
    }
  };

  const openResumeUpload = () => {
    setActiveTool(null);
    setWorkspaceView('resume');
    setIsUpdatingResume(true);
  };

  const renderDashboard = () => (
    // key replays the entrance animation on every view switch — quick fade keeps
    // navigation feeling responsive instead of content snapping in place.
    <div key={dashboardView} className="flex flex-col gap-6 animate-view-fade">
        {dashboardView === 'dashboard' && (
            <div id="dashboard-panel">
              <Dashboard
                session={session}
                profile={profile}
                t={t}
                hasResume={!!resumeText.trim()}
                onNavigate={(nextView) => {
                  setWorkspaceView(nextView);
                  if (nextView === 'resume' && !resumeText.trim()) setIsUpdatingResume(true);
                }}
              />
            </div>
        )}
        
        {dashboardView === 'toolkit' && (
            <div id="toolkit-panel">
                {!resumeText ? (
                    <EmptyState
                        title={t('ws_toolkit_empty_title')}
                        description={t('ws_toolkit_empty_desc')}
                        action={{ label: t('ws_upload_resume'), onClick: () => { setActiveTool(null); setWorkspaceView('resume'); setIsUpdatingResume(true); } }}
                    />
                ) : (
                    <AnalysisDisplay
                        t={t}
                        result={null}
                        onReset={handleReset}
                        resumeText={resumeText}
                        userPlan={userPlan}
                        market={market}
                        navigateToPricing={navigateToPricing}
                        session={session}
                        profile={profile}
                        refreshProfile={getProfile}
                        onApplyImprovements={handleApplyImprovements}
                        activeTool={activeTool}
                        setActiveTool={setWorkspaceActiveTool}
                    />
                )}
            </div>
        )}
        
        {dashboardView === 'resume' && (
            <div id="resume-panel">
              <ResumeReadinessPage
                resumeText={resumeText}
                market={market}
                t={t}
                onUploadResume={openResumeUpload}
                onOpenTool={openWorkspaceTool}
                onViewChange={setWorkspaceView}
                session={session}
                profile={profile}
                refreshProfile={getProfile}
              />
            </div>
        )}

        {dashboardView === 'jobs' && (
            <div id="jobs-panel">
              <JobMatchPage
                resumeText={resumeText}
                market={market}
                t={t}
                onUploadResume={openResumeUpload}
                onOpenTool={openWorkspaceTool}
                onViewChange={setWorkspaceView}
                session={session}
              />
            </div>
        )}

        {dashboardView === 'talent_profile' && session?.user && (
          <div id="talent-profile-panel">
            <TalentProfileForm
              uid={session.user.id}
              seed={{ name: profile?.full_name ?? undefined, email: session.user.email ?? undefined }}
              resumeText={resumeText}
              currentLang={currentLang}
              t={t}
              subscriptionStatus={userPlan}
            />
          </div>
        )}

        {dashboardView === 'applications' && (
          <div id="applications-panel">
            <MyApplications
              session={session}
              t={t}
              onFindSimilar={() => openWorkspaceTool('opportunity-finder')}
            />
          </div>
        )}

        {dashboardView === 'interview' && (
            <div id="interview-panel">
              <InterviewPracticePage
                resumeText={resumeText}
                market={market}
                t={t}
                onUploadResume={openResumeUpload}
                onOpenTool={openWorkspaceTool}
                onViewChange={setWorkspaceView}
                session={session}
              />
            </div>
        )}

        {dashboardView === 'plan' && (
            <div id="plan-panel">
              <CareerPlanPage
                resumeText={resumeText}
                market={market}
                t={t}
                onUploadResume={openResumeUpload}
                onOpenTool={openWorkspaceTool}
                onViewChange={setWorkspaceView}
                session={session}
              />
            </div>
        )}

        {dashboardView === 'portfolio' && (
            <div id="portfolio-panel">
                 {!resumeText ? (
                    <EmptyState
                        title={t('ws_portfolio_empty_title')}
                        description={t('ws_portfolio_empty_desc')}
                        action={{ label: t('ws_upload_resume'), onClick: () => { setWorkspaceView('resume'); setIsUpdatingResume(true); } }}
                    />
                 ) : (
                    <React.Suspense fallback={<LoadingSpinner market={market} />}>
                      <ShowcasePage
                        resumeText={resumeText}
                        session={session}
                        profile={profile}
                        t={t}
                        onUnsavedChange={setShowcaseHasUnsavedPortfolio}
                      />
                    </React.Suspense>
                 )}
            </div>
        )}

        {dashboardView === 'billing' && profile && (
            <div id="billing-panel">
              <CandidateBillingPage
                profile={profile}
                credits={credits}
                t={t}
                onSelectPlan={handleCandidatePlanSelection}
                savingPlan={candidatePlanSaving}
                onViewPricing={navigateToPricing}
                onPurchaseComplete={getProfile}
                initialPricingIntent={pendingCandidatePricingIntent}
                onPricingIntentHandled={handleCandidatePricingIntentHandled}
              />
            </div>
        )}

        {dashboardView === 'credentials' && session && web3Enabled && (
            <div id="credentials-panel" className="space-y-10 animate-slide-in-up">
                {/* Identity & Wallet shows verification only. Account settings live in their
                    own view — rendering Account here too duplicated the whole panel (QA C13). */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl overflow-hidden border border-gray-100 dark:border-slate-800 shadow-sm">
                    <VerifiedTalentSection t={t} />
                </div>
                {/* VerifiedTalentSection is informational only; the wallet connect + credential
                    mint live in Account settings. Without this CTA the page is a dead end —
                    the user has no path from the value prop to the actual action. */}
                <div className="flex justify-center">
                    <button
                        type="button"
                        onClick={() => setWorkspaceView('account')}
                        className="inline-flex items-center gap-2 rounded-xl bg-blue-700 px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-800"
                    >
                        {t('ws_credentials_manage_cta')}
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                </div>
            </div>
        )}

        {dashboardView === 'account' && session && (
            <div id="account-panel">
                <React.Suspense fallback={<LoadingSpinner market={market} />}>
                    <Account key={session.user.id} session={session} profile={profile} onSetView={handleSetView} t={t} onBack={() => setWorkspaceView('dashboard')} />
                </React.Suspense>
            </div>
        )}
    </div>
  );

  const workspaceMainWidthClass = dashboardView === 'resume'
    ? 'max-w-[1360px]'
    : dashboardView === 'interview'
      ? 'max-w-[1440px]'
      : 'max-w-6xl';

  const renderEmployerShell = () => {
    if (!session || !profile || !isEmployer) return null;

    return (
      <React.Suspense fallback={<LoadingSpinner market={market} />}>
        <EmployerPortal
          session={session}
          profile={profile}
          refreshProfile={getProfile}
          navigateToBusinessPricing={navigateToBusinessPricing}
          onGoHome={() => handleSetView('business')}
          onSignOut={() => data.auth.signOut()}
          t={t}
          initialPage={portalInitialPage}
          theme={theme}
          onToggleTheme={toggleTheme}
          currentLang={currentLang}
          onLanguageChange={changeLanguage}
        />
      </React.Suspense>
    );
  };

  const renderRoleFallback = () => (
    <div className="max-w-xl mx-auto my-16 rounded-[var(--site-radius)] border border-[var(--site-border)] bg-[var(--site-surface)] p-6 text-center">
      <h2 className="text-xl font-semibold text-[var(--site-text)]">We could not open the right workspace</h2>
      <p className="mt-2 text-sm text-[var(--site-text-muted)]">
        Your account role is missing or unsupported. Please sign out and sign in again, or contact support if this continues.
      </p>
      <div className="mt-5 flex flex-col sm:flex-row justify-center gap-3">
        <button
          type="button"
          onClick={() => data.auth.signOut()}
          className="rounded-[var(--site-radius)] bg-[var(--site-action)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--site-action-hover)]"
        >
          Sign out
        </button>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="rounded-[var(--site-radius)] border border-[var(--site-border)] px-4 py-2 text-sm font-semibold text-[var(--site-text)] hover:bg-[var(--site-surface-muted)]"
        >
          Back to home
        </button>
      </div>
    </div>
  );

  const renderCandidateShell = () => {
    if (!session || !profile || !isCandidate) return renderRoleFallback();

    // Guided setup takes over the whole screen for fresh sign-ups; the normal
    // shell mounts when it finishes (or is skipped) and offers the tour once.
    if (onboardingActive) {
      return (
        <OnboardingFlow
          uid={session.user.id}
          profile={profile}
          t={t}
          theme={theme}
          onComplete={({ skipped, resumeText: importedResume }) => {
            if (importedResume) {
              // The workspace's debounced auto-save persists this to the profile.
              setResumeText(importedResume);
              setIsUpdatingResume(false);
            }
            setOnboardingActive(false);
            getProfile();
            if (!skipped && !isTourDone(session.user.id)) setShowTour(true);
          }}
        />
      );
    }

    const sidebarProps = {
      activeView: dashboardView,
      onViewChange: (v: DashboardView) => {
        if (!setWorkspaceView(v)) return;
        setIsUpdatingResume(false);
        setIsMobileNavOpen(false);
        // Sidebar navigation must take over the main panel immediately. A lingering
        // analysisResult would otherwise keep the analysis screen mounted (renderContent
        // short-circuits on it), making the sidebar feel inactive after an analysis.
        setAnalysisResult(null);
      },
      profile,
      credits,
      theme,
      onToggleTheme: toggleTheme,
      activeTool,
      onToolSelect: (tool: string | null) => {
        // Route through openWorkspaceTool so the ?tool= query is written — otherwise the
        // URL-sync effect re-reads an empty query and immediately clears activeTool.
        if (tool) {
          openWorkspaceTool(tool);
        } else {
          setActiveTool(null);
        }
        setIsMobileNavOpen(false);
      },
      onLogout: () => data.auth.signOut(),
      t,
      currentLang,
      onLanguageChange: changeLanguage,
      onHome: () => {
        if (!setWorkspaceView('dashboard')) return;
        setIsMobileNavOpen(false);
        setActiveTool(null);
        setAnalysisResult(null);
        setIsUpdatingResume(false);
      },
    };

    return (
      <>
        <Sidebar {...sidebarProps} />
        {/* Mobile navigation drawer — the sidebar is hidden below lg */}
        {isMobileNavOpen && (
          <div
            ref={candidateMobileNavRef}
            className="fixed inset-0 z-50 lg:hidden"
            role="dialog"
            aria-modal="true"
            aria-label={t('portal_open_navigation')}
            tabIndex={-1}
            data-qa="candidate-mobile-nav-drawer"
          >
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
              onClick={() => setIsMobileNavOpen(false)}
              aria-hidden="true"
            />
            <div className="absolute inset-y-0 left-0 animate-slide-in-left">
              <Sidebar {...sidebarProps} mobile onCloseMobile={closeMobileNav} />
            </div>
          </div>
        )}
        <div className="flex-1 flex h-dvh flex-col overflow-hidden">
          <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 sm:px-8 shrink-0">
            <button
              type="button"
              onClick={() => setIsMobileNavOpen(true)}
              className="lg:hidden p-2 -ml-2 mr-2 text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg"
              aria-label={t('portal_open_navigation')}
              data-qa="candidate-mobile-nav-open"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
            {/* Profile access is consolidated into the sidebar "My Profile" block
                (bottom-left) — no duplicate top-right account menu. */}
            <div className="flex items-center gap-3 ml-auto">
              <span className="text-xs font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500 hidden sm:block">
                {t(DASHBOARD_VIEW_LABEL_KEYS[dashboardView])}
              </span>
            </div>
          </header>
          <ApiStatusBanner />
          <main
            className="flex-1 overflow-y-auto bg-slate-50 px-6 pb-[calc(1.5rem+var(--cookie-consent-bottom-space,0px))] pt-6 transition-[padding-bottom] duration-200 dark:bg-slate-950 md:px-10 md:pb-10 md:pt-10"
            data-qa-workspace-view={dashboardView}
          >
            <div className={`${workspaceMainWidthClass} mx-auto`} data-tour="main">
              {isUpdatingResume && (dashboardView === 'dashboard' || dashboardView === 'resume') ? (
                <div className="mt-4 animate-slide-in-up">
                  <div className="text-center mb-10">
                    <h2 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">{t('dashboard_resume_lab_title')}</h2>
                    <p className="text-gray-600 dark:text-gray-400">{resumeText ? t('dashboard_update_prompt') : t('dashboard_new_user_prompt')}</p>
                  </div>
                  <div id="upload-section" ref={uploadSectionRef} className="scroll-mt-20">
                    <UploadSection
                      t={t}
                      resumeText={resumeText}
                      setResumeText={setResumeText}
                      resumeImages={resumeImages}
                      setResumeImages={setResumeImages}
                      onInitiateAnalysis={handleInitiateAnalysis}
                      isLoading={isLoading}
                      error={error}
                      setError={setError}
                      market={market}
                      setMarket={setMarket}
                      variant={uploadVariant}
                      onResumeFileSelected={handleResumeFileSelected}
                      storedResumeFile={profile?.resume_file_url ? {
                        name: profile.resume_file_name ?? null,
                        url: profile.resume_file_url,
                        uploadedAt: profile.resume_file_uploaded_at ?? null,
                      } : null}
                      onRemoveResumeFile={handleRemoveResumeFile}
                      isSavingResumeFile={isSavingResumeFile}
                    />
                  </div>
                  {resumeText && (<div className="text-center mt-6"><button type="button" onClick={() => setIsUpdatingResume(false)} className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 font-semibold bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 px-6 py-2 rounded-lg transition-colors">{t('dashboard_cancel_update')}</button></div>)}
                </div>
              ) : renderContent()}
            </div>
          </main>
        </div>

        {/* One-time workspace tour, offered right after the guided setup. */}
        {showTour && (
          <WorkspaceTour
            t={t}
            onClose={() => {
              setShowTour(false);
              markTourDone(session.user.id);
            }}
          />
        )}
      </>
    );
  };

  const renderContent = () => {
    if (view === 'auth') {
      return (
        <Auth
          t={t}
          onClose={() => {
            setView('home');
            if (new URLSearchParams(location.search).has('pricing_intent')) {
              handleCandidatePricingIntentHandled();
            }
          }}
          initialView={initialAuthView}
          mode={authMode}
        />
      );
    }
    if (view === 'account' && session) { return <React.Suspense fallback={<LoadingSpinner market={market} />}><Account key={session.user.id} session={session} profile={profile} onSetView={handleSetView} t={t} /></React.Suspense>; }
    if (view === 'api_docs') { return <ApiDocsViewer onClose={() => setView('account')} />; }
    if (view === 'business') {
        return (
            <React.Suspense fallback={<LoadingSpinner market={market} />}>
                <BusinessPage t={t} session={session} profile={profile} onSelectBusinessPlan={handleBusinessPlanSelection} onBack={() => handleSetView('home')} onEnterPortal={(page) => { setPortalInitialPage(page); handleSetView('home'); }} refreshProfile={getProfile} authHydrated={authHydrated} />
            </React.Suspense>
        );
    }
    if (view === 'agency' && session && profile) {
        return (
            <React.Suspense fallback={<LoadingSpinner market={market} />}>
                <AgencyHub session={session} profile={profile} t={t} />
            </React.Suspense>
        );
    }
    if (isLoading) {
      return (
        <StagedLoader
          icon={<BarChart3 />}
          accent="blue"
          title={t('analysis_loader_title')}
          steps={[
            t('analysis_loader_step_submit'),
            t('analysis_loader_step_reading'),
            t('analysis_loader_step_market').replace('{market}', market),
            t('analysis_loader_step_scoring'),
          ]}
          intervalMs={2200}
        />
      );
    }
    if (analysisResult) {
      return (
        <>
          {analysisLang && analysisLang !== currentLang && langSyncDismissed !== currentLang && (
            <LanguageSyncBanner
              contentLang={analysisLang}
              uiLang={currentLang}
              availableLangs={listVersionLanguages(analysisLib)}
              creditCost={analysisCost}
              canPersist={canSaveResults(userPlan)}
              t={t}
              onSwitch={(lang) => {
                const v = getLanguageVersion(analysisLib, lang);
                if (v) { setAnalysisResult(v.result); setAnalysisLang(lang); }
              }}
              onRegenerate={() => { void performAnalysis(); }}
              onDismiss={() => setLangSyncDismissed(currentLang)}
            />
          )}
          <React.Suspense fallback={<LoadingSpinner market={market} />}><AnalysisDisplay t={t} result={analysisResult} onReset={handleReset} resumeText={resumeText} userPlan={userPlan} market={market} navigateToPricing={navigateToPricing} session={session} profile={profile} refreshProfile={getProfile} onApplyImprovements={handleApplyImprovements} activeTool={activeTool} setActiveTool={setActiveTool} onContinueToToolkit={() => { setAnalysisResult(null); setActiveTool(null); setWorkspaceView('toolkit'); }} /></React.Suspense>
        </>
      );
    }
    if (session && !showHomePageOverride) {
        if (!isProfileLoaded || !isLangLoaded) { return <div className="flex flex-col items-center justify-center space-y-4 my-24"><div className="w-16 h-16 border-4 border-blue-200 border-t-blue-700 rounded-full animate-spin"></div><p className="text-lg text-gray-600 dark:text-gray-400">{t('dashboard_loading')}</p></div>; }
        if (profile?.role === 'agency') {
            return (
                <React.Suspense fallback={<LoadingSpinner market={market} />}>
                    <AgencyHub session={session} profile={profile} t={t} />
                </React.Suspense>
            );
        }
        if (!isCandidate) return renderRoleFallback();
        return renderDashboard();
    }
    if (!isLangLoaded) { return <div className="flex flex-col items-center justify-center space-y-4 my-24"><div className="w-16 h-16 border-4 border-blue-200 border-t-blue-700 rounded-full animate-spin"></div><p className="text-lg text-gray-600">{t('app_loading')}</p></div>; }
    return renderAppEntry();
  };

  const workspaceShell = decideWorkspaceShell({
    entry,
    hasSession: Boolean(session),
    profileLoaded: isProfileLoaded,
    languageLoaded: isLangLoaded,
    showHomePageOverride,
    currentView: view,
    role: profileRole,
    subscriptionStatus: profile?.subscription_status,
  });
  const isWorkspaceSessionLoading = workspaceShell === 'loading';
  const showCandidateShell = workspaceShell === 'candidate';
  const showEmployerShell = workspaceShell === 'employer';
  const showUnsupportedRole = workspaceShell === 'unsupported';
  // Keep the pricing resolver mounted after an employer signs in. Without this
  // override the employer shell would replace BusinessPage before it can show
  // the exact plan confirmation (or the blocked add-on notice).
  const shouldResolvePortalPricingIntent = isPortalEntry
    && new URLSearchParams(location.search).has('pricing_intent');
  const showEmployerPortalShell = showEmployerShell && !shouldResolvePortalPricingIntent;
  // The career coach is a candidate-only assistant (resume/career advice, and
  // onLaunchTool opens candidate workspace tools). Gate it to the candidate
  // shell so it never floats over the employer portal, where it's nonsensical
  // and its tool-launch would target views the employer doesn't have.
  const canUseCareerCoach = Boolean(session && isLangLoaded && !isWorkspaceSessionLoading && showCandidateShell);
  const hasCandidateStickyActionBar = showCandidateShell && dashboardView === 'talent_profile';
  const useTopCookieConsent = !showCandidateShell && !showEmployerPortalShell && (entry === 'workspace' || entry === 'portal');

  const rootClass = `beta-root min-h-screen w-full ${showCandidateShell || showEmployerPortalShell ? 'flex' : 'block'}`;

  if (session?.user && session.user.emailVerified === false) {
    return <VerifyEmailGate email={session.user.email ?? null} t={t} />;
  }

  return (
      <div className={rootClass} data-qa-shell={workspaceShell} data-qa-auth={session ? 'signed-in' : 'signed-out'}>
        <CreditModal isOpen={isCreditModalOpen} onClose={() => setIsCreditModalOpen(false)} onConfirm={() => { setIsCreditModalOpen(false); performAnalysis(); }} onNavigateToPricing={navigateToPricing} cost={analysisCost} currentCredits={credits} />
        
        {isWorkspaceSessionLoading ? (
            <div className="flex min-h-screen w-full items-center justify-center">
              <LoadingSpinner market={market} />
            </div>
        ) : showEmployerPortalShell ? (
            renderEmployerShell()
        ) : showCandidateShell ? (
            renderCandidateShell()
        ) : showUnsupportedRole ? (
            renderRoleFallback()
        ) : (
            <SiteLayout pageId={isPortalEntry ? 'portal' : 'workspace'} marketingShell={false}>
              {renderWorkspaceBody()}
            </SiteLayout>
        )}

        {!isChatOpen && (
          <CookieConsent
            t={t}
            avoidSidebar={showCandidateShell || showEmployerPortalShell}
            placement={useTopCookieConsent ? 'top' : 'default'}
          />
        )}

        {canUseCareerCoach && !isChatOpen && (
          <button type="button"
            onClick={() => setIsChatOpen(true)}
            className={`fixed right-4 top-[calc(4.75rem+env(safe-area-inset-top))] bottom-auto z-40 flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-lg transition-all duration-300 hover:scale-105 hover:shadow-xl sm:top-auto sm:right-6 sm:h-16 sm:w-16 ${
              hasCandidateStickyActionBar
                ? 'sm:bottom-[calc(5.75rem+env(safe-area-inset-bottom))]'
                : 'sm:bottom-6'
            }`}
            aria-label={t('coach_open_label')}
            aria-expanded={isChatOpen}
            data-qa="career-coach-launcher"
          >
            <MessageSquareText className="h-6 w-6 sm:h-8 sm:w-8" aria-hidden="true" />
          </button>
        )}
        {canUseCareerCoach && isChatOpen && (
          <React.Suspense fallback={null}>
            <CareerCoachBot isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} session={session} profile={profile} resumeText={resumeText} t={t} onLaunchTool={(target) => { setWorkspaceView(target); setIsChatOpen(false); }} />
          </React.Suspense>
        )}
      </div>
  );
};

interface AppWrapperProps {
  entry?: 'workspace' | 'portal';
}

// Api/Credits/Settings providers come from SiteApp (the only mount point), so the
// workspace shares one state instance with the marketing shell instead of shadowing it.
const AppWrapper: React.FC<AppWrapperProps> = ({ entry }) => (
    <AppContent entry={entry} />
);

export default AppWrapper;
