import { describe, expect, it } from 'vitest';
import { _testRoutingValidation } from '../functions/src/handlers/adminModels';
import { keyHash } from '../functions/src/llm/keyHash';
import type { ModelEntry, ModelsDoc, RoutingPool } from '../functions/src/admin/schema';

const directModel = (patch: Partial<ModelEntry> = {}): ModelEntry => ({
  id: 'gateway',
  label: 'Gateway',
  provider: 'openai-compatible',
  base_url: 'https://gateway.example/v1',
  api_keys: ['sk-existing-a'],
  providerModel: 'model-a',
  minTier: 'paid',
  enabled: true,
  ...patch,
});

describe('admin model update contract', () => {
  it('appends and de-duplicates new pool keys instead of replacing saved keys', () => {
    const existing = directModel({ api_keys: ['sk-existing-a', 'sk-existing-b'] });
    const incoming = _testRoutingValidation.validateEntry({
      id: existing.id,
      label: existing.label,
      provider: existing.provider,
      base_url: existing.base_url,
      api_keys: ['sk-existing-b', 'sk-new-c'],
      providerModel: existing.providerModel,
      minTier: existing.minTier,
      enabled: existing.enabled,
    }, false);

    expect(_testRoutingValidation.mergeModelEntry(existing, incoming, []).api_keys).toEqual([
      'sk-existing-a',
      'sk-existing-b',
      'sk-new-c',
    ]);
  });

  it('supports explicit clears for fallback, priority, and builtin fields', () => {
    const existing = directModel({
      builtin: 'kairllm',
      base_url: undefined,
      api_keys: undefined,
      fallbackChain: ['backup'],
      priority: 2,
    });
    const incoming = _testRoutingValidation.validateEntry({
      id: existing.id,
      label: existing.label,
      provider: 'openai-compatible',
      base_url: 'https://gateway.example/v1',
      api_key: 'sk-new',
      providerModel: existing.providerModel,
      minTier: existing.minTier,
      enabled: true,
    }, false);

    const merged = _testRoutingValidation.mergeModelEntry(
      existing,
      incoming,
      ['builtin', 'fallbackChain', 'priority'],
    );
    expect(merged.builtin).toBeUndefined();
    expect(merged.fallbackChain).toBeUndefined();
    expect(merged.priority).toBeUndefined();
    expect(merged.base_url).toBe('https://gateway.example/v1');
  });

  it('purges incompatible saved credentials when switching provider modes', () => {
    const existing = directModel({ api_key: 'sk-legacy', api_keys: ['sk-pooled'] });
    const incoming = _testRoutingValidation.validateEntry({
      id: existing.id,
      label: existing.label,
      provider: 'gemini',
      providerModel: 'gemini-flash-latest',
      minTier: existing.minTier,
      enabled: true,
    }, false);

    const merged = _testRoutingValidation.mergeModelEntry(existing, incoming, []);
    expect(merged).not.toHaveProperty('base_url');
    expect(merged).not.toHaveProperty('api_key');
    expect(merged).not.toHaveProperty('api_keys');
    expect(merged).not.toHaveProperty('builtin');
  });

  it('rejects hidden direct credentials on gemini and builtin payloads', () => {
    const common = {
      id: 'bad',
      label: 'Bad',
      providerModel: '',
      minTier: 'free',
      enabled: true,
    };
    expect(() => _testRoutingValidation.validateEntry({
      ...common,
      provider: 'gemini',
      api_key: 'sk-hidden',
    }, true)).toThrow(/Gemini models cannot include/);
    expect(() => _testRoutingValidation.validateEntry({
      ...common,
      provider: 'openai-compatible',
      builtin: 'kairllm',
      base_url: 'https://stale.example/v1',
    }, true)).toThrow(/Builtin models inherit/);
  });

  it('rejects pool additions that exceed the combined ten-key limit', () => {
    const existing = directModel({
      api_keys: Array.from({ length: 9 }, (_, index) => `sk-existing-${index}`),
    });
    const incoming = directModel({ api_keys: ['sk-new-a', 'sk-new-b'] });
    expect(() => _testRoutingValidation.mergeModelEntry(existing, incoming, [])).toThrow(
      /maximum is 10/,
    );
  });

  it('does not allow clearing the last direct credential', () => {
    const existing = directModel({ api_key: undefined, api_keys: ['sk-only'] });
    const incoming = directModel({ api_keys: undefined });
    expect(() => _testRoutingValidation.mergeModelEntry(existing, incoming, ['api_keys'])).toThrow(
      /retain at least one API key/,
    );
  });

  it('rejects ambiguous set-and-clear requests', () => {
    expect(() => _testRoutingValidation.validateClearFields(
      ['priority'],
      false,
      { priority: 3 },
    )).toThrow(/cannot be supplied and cleared/);
  });

  it('makes stale key pins fail validation immediately after credentials are cleared', () => {
    const existing = directModel({ api_keys: ['sk-pinned'] });
    const switched = _testRoutingValidation.mergeModelEntry(
      existing,
      { ...existing, provider: 'gemini', api_keys: undefined, api_key: undefined },
      [],
    );
    expect(() => _testRoutingValidation.validateRoutingPools([{
      id: 'primary',
      label: 'Primary',
      enabled: true,
      members: [{
        modelId: existing.id,
        keyHash: keyHash('sk-pinned'),
        tier: 1,
        weight: 1,
        enabled: true,
      }],
    }], [switched])).toThrow(/pins a key the router would never use/);
  });

  it('deletes every saved fallback and routing reference to a removed model', () => {
    const gateway = directModel({ fallbackChain: ['backup'] });
    const backup = directModel({ id: 'backup', label: 'Backup', api_keys: ['sk-backup'] });
    const routingPools: RoutingPool[] = [{
      id: 'primary',
      label: 'Primary',
      enabled: true,
      members: [
        { modelId: 'gateway', tier: 1, weight: 1, enabled: true },
        { modelId: 'backup', tier: 2, weight: 1, enabled: true },
      ],
    }];
    const doc: ModelsDoc = {
      models: [gateway, backup],
      default_model_id: 'gateway',
      routing_pools: routingPools,
      module_routes: { analyze: 'primary' },
    };

    const mutation = _testRoutingValidation.buildDeleteModelMutation(
      'backup',
      doc,
      routingPools,
      { analyze: 'primary' },
    );

    expect(mutation.models.map((entry) => entry.id)).toEqual(['gateway']);
    expect(mutation.models[0].fallbackChain).toBeUndefined();
    expect(mutation.routingPools[0].members.map((member) => member.modelId)).toEqual(['gateway']);
    expect(mutation.moduleRoutes).toEqual({ analyze: 'primary' });
  });

  it('requires selecting another default before deleting the current one', () => {
    const gateway = directModel();
    expect(() => _testRoutingValidation.buildDeleteModelMutation(
      'gateway',
      { models: [gateway], default_model_id: 'gateway' },
      [],
      {},
    )).toThrow(/set another default/i);
  });

  it('builds an upsert from the latest document registry without dropping concurrent entries', () => {
    const gateway = directModel({ api_keys: ['sk-old'] });
    const concurrentlyAdded = directModel({ id: 'other', label: 'Other', api_keys: ['sk-other'] });
    const mutation = _testRoutingValidation.buildUpsertModelMutation(
      { ...gateway, api_keys: ['sk-new'] },
      [],
      { models: [gateway, concurrentlyAdded], routing_pools: [] },
      [],
    );

    expect(mutation.models.map((entry) => entry.id)).toEqual(['gateway', 'other']);
    expect(mutation.savedEntry.api_keys).toEqual(['sk-old', 'sk-new']);
  });
});
