/**
 * Front-end error/performance monitoring (Sentry), env-gated.
 *
 * No-op unless optional-integration consent is accepted and VITE_SENTRY_DSN is set.
 * Sentry is dynamically imported only then, so unconsented and DSN-less sessions pay
 * zero bundle/runtime cost. Wire a DSN in the host env to activate (SCRUM-39).
 */
import { getConsentState, onConsentChange } from './consent';

type ImportMetaEnvLike = { VITE_SENTRY_DSN?: string; VITE_SENTRY_TRACES_RATE?: string; MODE?: string };
type SentryRuntime = typeof import('@sentry/react');

const viteEnv = ((import.meta as unknown as { env?: ImportMetaEnvLike }).env) ?? {};
const processEnv = typeof process !== 'undefined' ? process.env : {};
const env: ImportMetaEnvLike = {
  VITE_SENTRY_DSN: viteEnv.VITE_SENTRY_DSN ?? processEnv.VITE_SENTRY_DSN,
  VITE_SENTRY_TRACES_RATE: viteEnv.VITE_SENTRY_TRACES_RATE ?? processEnv.VITE_SENTRY_TRACES_RATE,
  MODE: viteEnv.MODE ?? processEnv.NODE_ENV,
};
let initializationPromise: Promise<void> | null = null;
let sentryRuntime: SentryRuntime | null = null;
let closePromise: Promise<unknown> = Promise.resolve();
let observabilityGeneration = 0;

export async function initObservability(): Promise<void> {
  if (getConsentState() !== 'accepted') return;
  const dsn = env.VITE_SENTRY_DSN;
  if (!dsn) return; // unconfigured → no-op
  if (!initializationPromise) {
    const generation = observabilityGeneration;
    initializationPromise = (async () => {
      try {
        await closePromise;
        const Sentry = await import('@sentry/react');
        // Consent may have been withdrawn while the optional chunk was loading.
        if (generation !== observabilityGeneration || getConsentState() !== 'accepted') return;
        Sentry.init({
          dsn,
          environment: env.MODE ?? 'production',
          // Conservative perf sampling; override via VITE_SENTRY_TRACES_RATE.
          tracesSampleRate: Number(env.VITE_SENTRY_TRACES_RATE ?? 0.1),
          // Don't ship PII to the error backend — this app handles resumes/contact data.
          sendDefaultPii: false,
        });
        sentryRuntime = Sentry;
      } catch {
        // Monitoring must never break app boot.
      }
    })();
  }
  const attempt = initializationPromise;
  await attempt;
  if (!sentryRuntime && initializationPromise === attempt) initializationPromise = null;
}

export async function stopObservability(): Promise<void> {
  observabilityGeneration += 1;
  initializationPromise = null;
  const runtime = sentryRuntime;
  sentryRuntime = null;
  if (!runtime) return;
  closePromise = Promise.resolve(runtime.close(2_000)).catch(() => false);
  await closePromise;
}

export function startObservabilityWhenConsented(): () => void {
  if (getConsentState() === 'accepted') void initObservability();
  return onConsentChange((state) => {
    if (state === 'accepted') void initObservability();
    if (state !== 'accepted') void stopObservability();
  });
}
