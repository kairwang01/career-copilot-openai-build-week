import { describe, expect, it, vi } from 'vitest';
import { resolveHydratedValue } from '../lib/sessionHydration';

describe('initial session hydration', () => {
  it('does not read the current session until auth persistence has settled', async () => {
    const events: string[] = [];
    const waitUntilReady = vi.fn(async () => { events.push('ready'); });
    const readCurrent = vi.fn(() => {
      events.push('read');
      return { uid: 'restored-user' };
    });

    await expect(resolveHydratedValue(waitUntilReady, readCurrent))
      .resolves.toEqual({ uid: 'restored-user' });
    expect(events).toEqual(['ready', 'read']);
  });
});
