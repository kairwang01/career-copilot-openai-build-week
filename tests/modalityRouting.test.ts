import { describe, expect, it } from 'vitest';
import { modelSupportsImageInput } from '../functions/src/llm/models';
import { _testRoutingValidation } from '../functions/src/handlers/adminModels';
import type { ModelEntry } from '../functions/src/admin/schema';

const entry = (patch: Partial<ModelEntry>): ModelEntry => ({
  id: 'm',
  label: 'm',
  provider: 'openai-compatible',
  providerModel: 'auto',
  minTier: 'free',
  enabled: true,
  ...patch,
});

describe('image-input modality routing', () => {
  it('gemini models are implicitly image-capable; gateway models are not', () => {
    expect(modelSupportsImageInput(entry({ provider: 'gemini' }))).toBe(true);
    expect(modelSupportsImageInput(entry({ provider: 'openai-compatible' }))).toBe(false);
  });

  it('gateway models can be explicitly marked image-capable', () => {
    expect(modelSupportsImageInput(entry({ supportsImageInput: true }))).toBe(true);
    // Anything other than boolean true must not count.
    expect(modelSupportsImageInput(entry({ supportsImageInput: undefined }))).toBe(false);
  });

  it('validateEntry persists explicit supportsImageInput booleans', () => {
    const base = {
      id: 'gw',
      label: 'Gateway',
      provider: 'openai-compatible',
      providerModel: 'auto',
      minTier: 'free',
      base_url: 'https://gw.example.com/v1',
      api_key: 'sk-test',
    };
    const marked = _testRoutingValidation.validateEntry({ ...base, supportsImageInput: true }, true);
    expect(marked.supportsImageInput).toBe(true);

    const unmarked = _testRoutingValidation.validateEntry(base, true);
    expect(unmarked.supportsImageInput).toBeUndefined();

    const disabled = _testRoutingValidation.validateEntry({ ...base, supportsImageInput: false }, true);
    expect(disabled.supportsImageInput).toBe(false);

    const truthyButNotTrue = _testRoutingValidation.validateEntry({ ...base, supportsImageInput: 'yes' }, true);
    expect(truthyButNotTrue.supportsImageInput).toBeUndefined();
  });
});
