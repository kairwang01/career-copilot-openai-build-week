import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  sentryClose,
  sentryInit,
  stripePureLoad,
  stripePureModuleLoaded,
  stripeReactModuleLoaded,
  stripeStandardLoad,
  stripeStandardModuleLoaded,
} = vi.hoisted(() => ({
  sentryClose: vi.fn(() => Promise.resolve(true)),
  sentryInit: vi.fn(),
  stripePureLoad: vi.fn(() => Promise.resolve(null)),
  stripePureModuleLoaded: vi.fn(),
  stripeReactModuleLoaded: vi.fn(),
  stripeStandardLoad: vi.fn(() => Promise.resolve(null)),
  stripeStandardModuleLoaded: vi.fn(),
}));

vi.mock('@sentry/react', () => ({ close: sentryClose, init: sentryInit }));
vi.mock('@stripe/stripe-js', () => {
  stripeStandardModuleLoaded();
  return { loadStripe: stripeStandardLoad };
});
vi.mock('@stripe/stripe-js/pure', () => {
  stripePureModuleLoaded();
  return { loadStripe: stripePureLoad };
});
vi.mock('@stripe/react-stripe-js', () => {
  stripeReactModuleLoaded();
  return {
    EmbeddedCheckout: () => null,
    EmbeddedCheckoutProvider: ({ children }: { children?: unknown }) => children,
  };
});

describe('optional integration consent', () => {
  let cookie = '';

  beforeEach(() => {
    cookie = '';
    const documentStub = {} as Document;
    Object.defineProperty(documentStub, 'cookie', {
      configurable: true,
      get: () => cookie,
      set: (value: string) => {
        cookie = value;
      },
    });
    vi.stubGlobal('document', documentStub);
    vi.stubGlobal('window', new EventTarget());
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.invalid/1');
    vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', 'pk_test_explicit_checkout');
    sentryInit.mockClear();
    sentryClose.mockClear();
    stripePureLoad.mockClear();
    stripePureModuleLoaded.mockClear();
    stripeReactModuleLoaded.mockClear();
    stripeStandardLoad.mockClear();
    stripeStandardModuleLoaded.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses one cookie-backed unknown, accepted, or declined consent state', async () => {
    const { getConsentState } = await import('../lib/consent');

    expect(getConsentState()).toBe('unknown');
    cookie = 'session=value; cookie_consent=accepted';
    expect(getConsentState()).toBe('accepted');
    cookie = 'cookie_consent=declined';
    expect(getConsentState()).toBe('declined');
    cookie = 'cookie_consent=unexpected';
    expect(getConsentState()).toBe('unknown');
  });

  it('persists a choice and notifies this browser session immediately', async () => {
    const { getConsentState, onConsentChange, setConsentState } = await import('../lib/consent');
    const observed: string[] = [];
    const unsubscribe = onConsentChange((state) => observed.push(state));

    setConsentState('accepted');

    expect(cookie).toContain('cookie_consent=accepted');
    expect(getConsentState()).toBe('accepted');
    expect(observed).toEqual(['accepted']);

    unsubscribe();
    setConsentState('declined');
    expect(observed).toEqual(['accepted']);
  });

  it('does not initialize Sentry while consent is unknown or declined', async () => {
    const { initObservability } = await import('../lib/observability');
    const { setConsentState } = await import('../lib/consent');

    await initObservability();
    setConsentState('declined');
    await initObservability();

    expect(sentryInit).not.toHaveBeenCalled();
  });

  it('starts Sentry once when the user accepts in the current session', async () => {
    const { startObservabilityWhenConsented } = await import('../lib/observability');
    const { setConsentState } = await import('../lib/consent');
    const stop = startObservabilityWhenConsented();

    expect(sentryInit).not.toHaveBeenCalled();
    setConsentState('accepted');
    await vi.waitFor(() => expect(sentryInit).toHaveBeenCalledOnce());

    setConsentState('accepted');
    await vi.waitFor(() => expect(sentryInit).toHaveBeenCalledOnce());
    stop();
  });

  it('stops optional monitoring on withdrawal and can restart after consent', async () => {
    const { startObservabilityWhenConsented } = await import('../lib/observability');
    const { setConsentState } = await import('../lib/consent');
    const stop = startObservabilityWhenConsented();

    setConsentState('accepted');
    await vi.waitFor(() => expect(sentryInit).toHaveBeenCalledOnce());

    setConsentState('declined');
    await vi.waitFor(() => expect(sentryClose).toHaveBeenCalledOnce());

    setConsentState('accepted');
    await vi.waitFor(() => expect(sentryInit).toHaveBeenCalledTimes(2));
    stop();
  });

  it('does not load Stripe when an ordinary route imports the checkout provider', async () => {
    await import('../contexts/SubscriptionCheckoutContext');

    expect(stripeStandardModuleLoaded).not.toHaveBeenCalled();
    expect(stripePureModuleLoaded).not.toHaveBeenCalled();
    expect(stripeReactModuleLoaded).not.toHaveBeenCalled();
    expect(stripeStandardLoad).not.toHaveBeenCalled();
    expect(stripePureLoad).not.toHaveBeenCalled();
  });

  it('loads the pure Stripe runtime once after an explicit checkout action', async () => {
    const { setConsentState } = await import('../lib/consent');
    const { loadStripeCheckoutRuntime } = await import('../contexts/SubscriptionCheckoutContext');
    setConsentState('declined');

    const first = await loadStripeCheckoutRuntime();
    const second = await loadStripeCheckoutRuntime();

    expect(first).toBe(second);
    expect(stripeStandardModuleLoaded).not.toHaveBeenCalled();
    expect(stripePureModuleLoaded).toHaveBeenCalledOnce();
    expect(stripeReactModuleLoaded).toHaveBeenCalledOnce();
    expect(stripeStandardLoad).not.toHaveBeenCalled();
    expect(stripePureLoad).toHaveBeenCalledOnce();
    expect(stripePureLoad).toHaveBeenCalledWith('pk_test_explicit_checkout');
  });
});
