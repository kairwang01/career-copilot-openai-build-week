import { describe, expect, it } from 'vitest';
import { withInFlightDedupe } from '../lib/inFlightDedupe';

describe('withInFlightDedupe — double-charge guard for AI callables', () => {
  it('collapses concurrent calls with the same key onto ONE execution', async () => {
    const map = new Map<string, Promise<unknown>>();
    let runs = 0;
    let resolveInner!: (v: string) => void;
    const make = () =>
      withInFlightDedupe(map, 'cover:abc', () => {
        runs += 1;
        return new Promise<string>((r) => { resolveInner = r; });
      });

    const a = make(); // first click — starts the work
    const b = make(); // rapid second click — must NOT start a second run/charge
    resolveInner('letter');

    expect(await a).toBe('letter');
    expect(await b).toBe('letter');
    expect(runs).toBe(1); // one network call → one charge
    expect(map.size).toBe(0); // key released after settle
  });

  it('runs fresh once the prior call has settled (sequential re-runs still bill)', async () => {
    const map = new Map<string, Promise<unknown>>();
    let runs = 0;
    const run = () => withInFlightDedupe(map, 'path:xyz', async () => { runs += 1; return runs; });

    expect(await run()).toBe(1);
    expect(await run()).toBe(2); // intentional re-run after completion is NOT deduped
    expect(runs).toBe(2);
  });

  it('does not dedupe across different keys (distinct inputs both run)', async () => {
    const map = new Map<string, Promise<unknown>>();
    let runs = 0;
    const run = (key: string) => withInFlightDedupe(map, key, async () => { runs += 1; return key; });

    const [r1, r2] = await Promise.all([run('a'), run('b')]);
    expect(r1).toBe('a');
    expect(r2).toBe('b');
    expect(runs).toBe(2);
  });

  it('releases the key when the underlying call rejects (no stuck dedupe)', async () => {
    const map = new Map<string, Promise<unknown>>();
    await expect(withInFlightDedupe(map, 'k', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(map.size).toBe(0);
    // a retry after failure runs fresh
    await expect(withInFlightDedupe(map, 'k', async () => 'ok')).resolves.toBe('ok');
  });

  it('without a key, every call runs (no dedupe)', async () => {
    const map = new Map<string, Promise<unknown>>();
    let runs = 0;
    const run = () => withInFlightDedupe(map, undefined, async () => { runs += 1; return runs; });
    await Promise.all([run(), run()]);
    expect(runs).toBe(2);
  });
});
