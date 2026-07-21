import { describe, expect, it } from 'vitest';
import {
  candidatesForPoolTier,
  implicitFallbackCandidates,
  pinnableKeysForModel,
  routingPoolForRoute,
  routingPoolTiers,
  selectWeightedCandidate,
} from '../functions/src/llm/routingPools';
import { keyHash } from '../functions/src/llm/keyHash';
import { _testRoutingValidation } from '../functions/src/handlers/adminModels';
import { DEFAULT_MODULE_ROUTES, defaultRoutingPoolsForRegistry } from '../functions/src/admin/platformConfig';
import { TOOL_REGISTRY } from '../functions/src/llm/toolRegistry';
import type { ModelEntry, RoutingPool } from '../functions/src/admin/schema';

const model = (id: string, minTier: ModelEntry['minTier'] = 'free'): ModelEntry => ({
  id,
  label: id,
  provider: 'openai-compatible',
  providerModel: 'auto',
  minTier,
  enabled: true,
});

describe('LLM routing pools', () => {
  it('selects weighted members inside the same tier', () => {
    const pool: RoutingPool = {
      id: 'speed',
      label: 'Speed',
      enabled: true,
      members: [
        { modelId: 'key-a', tier: 1, weight: 80, enabled: true },
        { modelId: 'key-b', tier: 1, weight: 20, enabled: true },
      ],
    };
    const candidates = candidatesForPoolTier(
      pool,
      [model('key-a'), model('key-b')],
      new Set(['key-a', 'key-b']),
      1,
    );

    expect(selectWeightedCandidate(candidates, () => 0.79)?.member.modelId).toBe('key-a');
    expect(selectWeightedCandidate(candidates, () => 0.8)?.member.modelId).toBe('key-b');
  });

  it('orders tiers ascending for fallback', () => {
    const pool: RoutingPool = {
      id: 'quality',
      label: 'Quality',
      enabled: true,
      members: [
        { modelId: 'backup', tier: 2, weight: 100, enabled: true },
        { modelId: 'primary', tier: 1, weight: 100, enabled: true },
      ],
    };

    expect(routingPoolTiers(pool)).toEqual([1, 2]);
  });

  it('filters out models the user tier cannot access', () => {
    const pool: RoutingPool = {
      id: 'quality',
      label: 'Quality',
      enabled: true,
      members: [
        { modelId: 'free-model', tier: 1, weight: 50, enabled: true },
        { modelId: 'paid-model', tier: 1, weight: 50, enabled: true },
      ],
    };

    const candidates = candidatesForPoolTier(
      pool,
      [model('free-model'), model('paid-model', 'paid')],
      new Set(['free-model']),
      1,
    );

    expect(candidates.map((candidate) => candidate.member.modelId)).toEqual(['free-model']);
  });

  it('returns no pool for unconfigured route keys', () => {
    const pools: RoutingPool[] = [{ id: 'speed', label: 'Speed', enabled: true, members: [] }];

    expect(routingPoolForRoute('missingTool', { mockInterview: 'speed' }, pools)).toBeNull();
  });

  it('builds implicit fallback candidates by priority and excludes unusable entries', () => {
    const registry: ModelEntry[] = [
      { ...model('chosen'), priority: 0 },
      { ...model('third'), priority: 3 },
      { ...model('first'), priority: 1 },
      { ...model('disabled'), priority: 0, enabled: false },
      { ...model('custom', 'business'), priority: 0 },
      { ...model('second'), priority: 2 },
      { ...model('fourth'), priority: 4 },
    ];

    expect(implicitFallbackCandidates(registry, 'chosen').map((m) => m.id)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('rejects routing members that reference unknown models or keys', () => {
    const registry: ModelEntry[] = [{ ...model('deep'), api_keys: ['sk-live-a'] }];
    const validHash = keyHash('sk-live-a');

    expect(() => _testRoutingValidation.validateRoutingPools([
      { id: 'quality', label: 'Quality', enabled: true, members: [{ modelId: 'missing', tier: 1, weight: 1, enabled: true }] },
    ], registry)).toThrow(/unknown model/);

    expect(() => _testRoutingValidation.validateRoutingPools([
      { id: 'quality', label: 'Quality', enabled: true, members: [{ modelId: 'deep', keyHash: 'bad-hash', tier: 1, weight: 1, enabled: true }] },
    ], registry)).toThrow(/pins a key the router would never use/);

    expect(_testRoutingValidation.validateRoutingPools([
      { id: 'quality', label: 'Quality', enabled: true, members: [{ modelId: 'deep', keyHash: validHash, tier: 1, weight: 1, enabled: true }] },
    ], registry)[0].members[0].keyHash).toBe(validHash);
  });

  it('only accepts pins on keys the runtime pool would use (resolveKeyPool parity)', () => {
    // Legacy api_key is shadowed by a non-empty api_keys pool at runtime — a
    // pin on it must be rejected, not saved and silently skipped.
    const shadowed: ModelEntry[] = [{ ...model('deep'), api_key: 'sk-legacy', api_keys: ['sk-pool-a'] }];
    expect(pinnableKeysForModel(shadowed[0]).map((k) => k.key)).toEqual(['sk-pool-a']);
    expect(() => _testRoutingValidation.validateRoutingPools([
      { id: 'q', label: 'Q', enabled: true, members: [{ modelId: 'deep', keyHash: keyHash('sk-legacy'), tier: 1, weight: 1, enabled: true }] },
    ], shadowed)).toThrow(/pins a key the router would never use/);

    // Without an api_keys pool, the legacy api_key IS the runtime pool.
    const legacyOnly: ModelEntry[] = [{ ...model('deep'), api_key: 'sk-legacy' }];
    expect(_testRoutingValidation.validateRoutingPools([
      { id: 'q', label: 'Q', enabled: true, members: [{ modelId: 'deep', keyHash: keyHash('sk-legacy'), tier: 1, weight: 1, enabled: true }] },
    ], legacyOnly)[0].members[0].keyHash).toBe(keyHash('sk-legacy'));

    // Gemini models have an empty runtime key pool — nothing is pinnable.
    const gemini: ModelEntry[] = [{ ...model('gem'), provider: 'gemini', api_key: 'sk-gem' }];
    expect(pinnableKeysForModel(gemini[0])).toEqual([]);
    expect(() => _testRoutingValidation.validateRoutingPools([
      { id: 'q', label: 'Q', enabled: true, members: [{ modelId: 'gem', keyHash: keyHash('sk-gem'), tier: 1, weight: 1, enabled: true }] },
    ], gemini)).toThrow(/pins a key the router would never use/);
  });

  it('rejects custom BYOA as an explicit model fallback', () => {
    expect(() => _testRoutingValidation.validateEntry({
      ...model('hunyuan'),
      provider: 'gemini',
      fallbackChain: ['custom'],
    }, false)).toThrow(/custom BYOA/);
  });

  it('rejects non-positive tier and weight values', () => {
    const registry: ModelEntry[] = [model('fast')];

    expect(() => _testRoutingValidation.validateRoutingPools([
      { id: 'speed', label: 'Speed', enabled: true, members: [{ modelId: 'fast', tier: 0, weight: 1, enabled: true }] },
    ], registry)).toThrow(/tier/);

    expect(() => _testRoutingValidation.validateRoutingPools([
      { id: 'speed', label: 'Speed', enabled: true, members: [{ modelId: 'fast', tier: 1, weight: 0, enabled: true }] },
    ], registry)).toThrow(/weight/);
  });

  it('builds fresh-install speed and quality pools from stable model ids', () => {
    const registry: ModelEntry[] = [
      { ...model('gemini'), provider: 'gemini', label: 'Gemini (Google direct)' },
      { ...model('hunyuan'), label: 'Tencent Hunyuan 3' },
      { ...model('auto'), label: 'Auto · multi-model (legacy)' },
      { ...model('deepseek-flash'), label: 'Deepseek V4 Flash(Limited Testing)' },
      { ...model('deepseek'), label: 'DeepSeek label renamed by an admin' },
    ];

    const pools = defaultRoutingPoolsForRegistry(registry);

    expect(pools.find((pool) => pool.id === 'speed')?.members).toEqual([
      { modelId: 'gemini', tier: 1, weight: 100, enabled: true },
    ]);
    expect(pools.find((pool) => pool.id === 'quality')?.members).toEqual([
      { modelId: 'deepseek', tier: 1, weight: 100, enabled: true },
    ]);
  });

  it('has default module routes for every LLM-backed tool surface', () => {
    const dedicatedRoutes = [
      'careerCoach',
      'mockInterview',
      'analyzeResume',
      'generateCoverLetter',
      'generateCareerPath',
      'discoverTalent',
      'listJobApplicants',
      'extractTextFromUrl',
      'apiResumeAnalyze',
      'apiCoverLetter',
    ];
    const expected = [...Object.keys(TOOL_REGISTRY), ...dedicatedRoutes].sort();
    const actual = Object.keys(DEFAULT_MODULE_ROUTES).filter((key) => expected.includes(key)).sort();

    expect(actual).toEqual(expected);
  });
});

describe('admin model key health aggregation', () => {
  const ts = (iso: string) => ({
    toMillis: () => new Date(iso).getTime(),
    toDate: () => new Date(iso),
  });

  it('aggregates runtime key_health docs by model', () => {
    const now = new Date('2026-07-07T12:00:00.000Z').getTime();
    const health = _testRoutingValidation.aggregateKeyHealth([
      {
        modelId: 'deep',
        failureCount: 2,
        cooldownUntil: ts('2026-07-07T12:05:00.000Z'),
        lastFailureAt: ts('2026-07-07T11:50:00.000Z'),
        lastErrorCode: '429',
      },
      {
        modelId: 'deep',
        failureCount: 3,
        cooldownUntil: ts('2026-07-07T11:55:00.000Z'),
        lastFailureAt: ts('2026-07-07T11:59:00.000Z'),
        lastErrorCode: '401',
      },
      {
        modelId: 'fast',
        lastSuccessAt: ts('2026-07-07T11:58:00.000Z'),
        cooldownUntil: null,
      },
      {
        modelId: '',
        failureCount: 99,
      },
    ], now);

    expect(health.deep).toEqual({
      failureCount: 5,
      cooldownUntil: '2026-07-07T12:05:00.000Z',
      lastErrorCode: '401',
      lastFailureAt: '2026-07-07T11:59:00.000Z',
      anyCooled: true,
    });
    expect(health.fast).toEqual({
      failureCount: 0,
      cooldownUntil: null,
      lastErrorCode: null,
      lastFailureAt: null,
      anyCooled: false,
    });
    expect(health.missing).toBeUndefined();
  });
});

describe('admin implicit fallback preview', () => {
  it('returns tier-specific previews only when no explicit fallback is configured', () => {
    const registry: ModelEntry[] = [
      { ...model('chosen'), priority: 9 },
      { ...model('free-a'), priority: 2 },
      { ...model('paid-a', 'paid'), priority: 1 },
      { ...model('business-a', 'business'), priority: 0 },
      { ...model('auto', 'paid'), priority: 0 },
      { ...model('custom', 'business'), priority: 0 },
    ];

    expect(_testRoutingValidation.implicitFallbackPreviewByTier(registry, registry[0])).toEqual({
      free: ['free-a'],
      paid: ['auto', 'paid-a', 'free-a'],
      business: ['business-a', 'free-a'],
    });
    expect(
      _testRoutingValidation.implicitFallbackPreviewByTier(
        registry,
        { ...registry[0], fallbackChain: ['free-a'] },
      ),
    ).toBeUndefined();
  });
});

describe('LLM routing pools — load-balancer edge cases', () => {
  const twoModels = [model('key-a'), model('key-b')];
  const allowAll = new Set(['key-a', 'key-b']);

  it('selectWeightedCandidate returns null for an empty candidate list', () => {
    expect(selectWeightedCandidate([], () => 0.5)).toBeNull();
  });

  it('selectWeightedCandidate returns null when every weight is zero (loop-break branch)', () => {
    const candidates = [
      { member: { weight: 0 } },
      { member: { weight: 0 } },
    ];
    expect(selectWeightedCandidate(candidates, () => 0.5)).toBeNull();
  });

  it('candidatesForPoolTier drops a member that is disabled', () => {
    const pool: RoutingPool = {
      id: 'p',
      label: 'P',
      enabled: true,
      members: [
        { modelId: 'key-a', tier: 1, weight: 50, enabled: false },
        { modelId: 'key-b', tier: 1, weight: 50, enabled: true },
      ],
    };
    const candidates = candidatesForPoolTier(pool, twoModels, allowAll, 1);
    expect(candidates.map((c) => c.member.modelId)).toEqual(['key-b']);
  });

  it('candidatesForPoolTier drops a member whose referenced MODEL is disabled', () => {
    const disabledModel: ModelEntry = { ...model('key-a'), enabled: false };
    const pool: RoutingPool = {
      id: 'p',
      label: 'P',
      enabled: true,
      members: [
        { modelId: 'key-a', tier: 1, weight: 50, enabled: true },
        { modelId: 'key-b', tier: 1, weight: 50, enabled: true },
      ],
    };
    const candidates = candidatesForPoolTier(pool, [disabledModel, model('key-b')], allowAll, 1);
    expect(candidates.map((c) => c.member.modelId)).toEqual(['key-b']);
  });

  it('rejects the per-user "custom" BYOA sentinel as a pool member', () => {
    const registry: ModelEntry[] = [model('key-a'), { ...model('custom'), minTier: 'business' }];
    expect(() =>
      _testRoutingValidation.validateRoutingPools(
        [{ id: 'p', label: 'P', enabled: true, members: [{ modelId: 'custom', tier: 1, weight: 100, enabled: true }] }],
        registry,
      ),
    ).toThrow(/cannot include the per-user "custom"/i);
  });
});
