import { describe, it, expect, vi } from 'vitest';

// aiClient imports firebaseClient (which initializes a Firebase app on load).
// Stub it so the pure error-mapping function can be unit-tested in isolation.
vi.mock('../lib/firebaseClient', () => ({ firebaseFunctions: {} }));

import {
  clearApiStatusIncident,
  formatCallableError,
  getEffectiveAiModelId,
  reportApiStatusFromError,
  setAiModel,
  setApiStatusUpdater,
} from '../services/aiClient';

describe('formatCallableError — AI unavailable / unconfigured', () => {
  it('never leaks provider-key / Admin Portal config text to end users', () => {
    const msg = formatCallableError({
      code: 'functions/unavailable',
      message: 'GEMINI_API_KEY is not set. Add it via Admin Portal or functions/.env.',
    });
    expect(msg).not.toMatch(/GEMINI|API_KEY|Admin Portal|\.env/i);
    expect(msg.toLowerCase()).toContain('temporarily unavailable');
  });

  it('maps a bare "is not set" message (no code) to neutral copy', () => {
    const msg = formatCallableError({ message: 'KAIRLLM_API_KEY is not set.' });
    expect(msg).not.toMatch(/KAIRLLM|API_KEY/i);
    expect(msg.toLowerCase()).toContain('temporarily unavailable');
  });

  it('redacts the chain-exhausted admin-console instruction', () => {
    const msg = formatCallableError({
      code: 'functions/internal',
      message: 'All configured AI models are currently unavailable; an administrator needs to check the API keys in the admin console.',
    });
    expect(msg).not.toMatch(/administrator|API keys|admin console/i);
    expect(msg.toLowerCase()).toContain('temporarily unavailable');
  });

  it('still maps quota errors to the busy message', () => {
    expect(formatCallableError({ code: 'functions/resource-exhausted', message: 'quota' }).toLowerCase())
      .toContain('busy');
  });

  it('still maps unauthenticated to a sign-in prompt', () => {
    expect(formatCallableError({ code: 'functions/unauthenticated', message: '' }).toLowerCase())
      .toContain('sign in');
  });

  it('still maps insufficient-credits without leaking the tool slug', () => {
    const msg = formatCallableError({
      code: 'functions/failed-precondition',
      message: 'Not enough credits for resume-analysis',
    });
    expect(msg).not.toMatch(/resume-analysis/);
    expect(msg.toLowerCase()).toContain('credit');
  });
});

describe('platform-managed model selection', () => {
  it('omits concrete model ids unless the business BYOA custom model is selected', () => {
    setAiModel(undefined);
    expect(getEffectiveAiModelId()).toBeUndefined();
    setAiModel('gemini');
    expect(getEffectiveAiModelId()).toBeUndefined();
    setAiModel('custom');
    expect(getEffectiveAiModelId()).toBe('custom');
    setAiModel(undefined);
  });
});

describe('transient AI status incidents', () => {
  it('expires a quota incident after the 30-second retry window', () => {
    vi.useFakeTimers();
    const events: Array<{ status: string; error?: string }> = [];
    const unregister = setApiStatusUpdater((status, error) => events.push({ status, error }));

    reportApiStatusFromError({ code: 'functions/resource-exhausted', message: 'quota' });
    expect(events.at(-1)).toMatchObject({ status: 'degraded' });
    vi.advanceTimersByTime(29_999);
    expect(events.at(-1)?.status).toBe('degraded');
    vi.advanceTimersByTime(1);
    expect(events.at(-1)).toEqual({ status: 'online', error: undefined });

    unregister();
    vi.useRealTimers();
  });

  it('does not let an older timer clear a newer incident', () => {
    vi.useFakeTimers();
    const events: Array<{ status: string; error?: string }> = [];
    const unregister = setApiStatusUpdater((status, error) => events.push({ status, error }));

    reportApiStatusFromError({ code: 'functions/unavailable', message: 'temporary provider timeout' });
    vi.advanceTimersByTime(15_000);
    reportApiStatusFromError({ code: 'functions/resource-exhausted', message: 'quota' });
    vi.advanceTimersByTime(15_000);
    expect(events.at(-1)?.status).toBe('degraded');
    vi.advanceTimersByTime(15_000);
    expect(events.at(-1)?.status).toBe('online');

    unregister();
    vi.useRealTimers();
  });

  it('keeps authentication and one-off internal errors local to the tool', () => {
    const events: Array<{ status: string; error?: string }> = [];
    const unregister = setApiStatusUpdater((status, error) => events.push({ status, error }));

    reportApiStatusFromError({ code: 'functions/unauthenticated', message: '' });
    reportApiStatusFromError({ code: 'functions/permission-denied', message: '' });
    reportApiStatusFromError({ code: 'functions/internal', message: 'INTERNAL' });
    expect(events).toEqual([]);

    unregister();
  });

  it('clears an active incident immediately after recovery', () => {
    vi.useFakeTimers();
    const events: Array<{ status: string; error?: string }> = [];
    const unregister = setApiStatusUpdater((status, error) => events.push({ status, error }));

    reportApiStatusFromError({ code: 'functions/unavailable', message: 'temporary provider timeout' });
    clearApiStatusIncident();
    expect(events.at(-1)).toEqual({ status: 'online', error: undefined });
    vi.advanceTimersByTime(30_000);
    expect(events.filter((event) => event.status === 'online')).toHaveLength(1);

    unregister();
    vi.useRealTimers();
  });
});
