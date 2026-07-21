import { describe, expect, it, vi } from 'vitest';
import { ThinkingLevel } from '@google/genai';
import { extractJson, resolveThinkingLevel } from '../functions/src/llm/providers/geminiProvider';
import { buildProvider, modelSupportsGoogleSearch } from '../functions/src/llm/models';
import { isLatencyPriorityPool, routingAttemptTimeoutMs } from '../functions/src/llm/routingPools';
import { mapSettledWithConcurrency } from '../functions/src/utils/asyncPool';
import { buildToolResponse } from '../functions/src/llm/toolResponse';
import { outputTokenBudgetForTool, thinkingLevelForTool } from '../functions/src/llm/toolBudgets';
import type { ModelEntry } from '../functions/src/admin/schema';

describe('LLM latency controls', () => {
  it('uses low thinking by default for Gemini 3.5 and the current Flash alias', () => {
    expect(resolveThinkingLevel('gemini-3.5-flash')).toBe(ThinkingLevel.LOW);
    expect(resolveThinkingLevel('gemini-flash-latest')).toBe(ThinkingLevel.LOW);
    expect(resolveThinkingLevel('gemini-3.5-flash', 'minimal')).toBe(ThinkingLevel.MINIMAL);
    expect(resolveThinkingLevel('gemini-2.5-flash', 'low')).toBeUndefined();
  });

  it('passes model, low thinking, timeout, and bounded SDK retries to Gemini', async () => {
    process.env.GEMINI_API_KEY ||= 'test-gemini-key';
    const entry: ModelEntry = {
      id: 'gemini-fast',
      label: 'Gemini Fast',
      provider: 'gemini',
      providerModel: 'gemini-3.5-flash',
      minTier: 'free',
      enabled: true,
    };

    const provider = buildProvider(entry) as unknown as {
      model: string;
      ai: { models: { generateContent: ReturnType<typeof vi.fn> } };
      generate: (request: Record<string, unknown>) => Promise<unknown>;
    };
    expect(provider.model).toBe('gemini-3.5-flash');
    const generateContent = vi.fn().mockResolvedValue({
      text: '{"ok":true}',
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 4 },
    });
    provider.ai.models.generateContent = generateContent;

    await provider.generate({
      system: 'Follow the system policy.',
      prompt: 'synthetic',
      responseSchema: { type: 'OBJECT' },
      useGoogleSearch: true,
      timeoutMs: 9_000,
    });
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-3.5-flash',
      config: expect.objectContaining({
        systemInstruction: 'Follow the system policy.',
        tools: [{ googleSearch: {} }],
        responseMimeType: 'application/json',
        responseSchema: { type: 'OBJECT' },
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        httpOptions: { timeout: 9_000, retryOptions: { attempts: 1 } },
      }),
    }));
  });

  it('keeps Google Search tools off providers that silently ignore grounding', () => {
    expect(modelSupportsGoogleSearch({
      id: 'gemini', label: 'Gemini', provider: 'gemini', providerModel: '', minTier: 'free', enabled: true,
    })).toBe(true);
    expect(modelSupportsGoogleSearch({
      id: 'gateway', label: 'Gateway', provider: 'openai-compatible', providerModel: 'auto', minTier: 'free', enabled: true,
    })).toBe(false);
  });

  it('extracts the first complete JSON value without swallowing trailing grounding prose', () => {
    expect(extractJson('Result: {"message":"brace } in text","items":[1,2]}\nSources: example')).toEqual({
      message: 'brace } in text',
      items: [1, 2],
    });
  });

  it('recognizes custom speed-pool ids and labels', () => {
    expect(isLatencyPriorityPool({ id: 'speed1', label: 'Custom pool' })).toBe(true);
    expect(isLatencyPriorityPool({ id: 'custom', label: '⚡ Fast responses' })).toBe(true);
    expect(isLatencyPriorityPool({ id: 'quality1', label: 'Quality priority' })).toBe(false);
  });

  it('never lets one route candidate exceed the attempt, remaining, or caller budget', () => {
    expect(routingAttemptTimeoutMs(30_000, 45_000)).toBe(30_000);
    expect(routingAttemptTimeoutMs(30_000, 8_000)).toBe(8_000);
    expect(routingAttemptTimeoutMs(30_000, 45_000, 5_000)).toBe(5_000);
  });

  it('caps fan-out concurrency and preserves result order', async () => {
    let active = 0;
    let maxActive = 0;
    const settled = await mapSettledWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (value === 4) throw new Error('synthetic failure');
      return value * 10;
    });

    expect(maxActive).toBe(2);
    expect(settled.map((item) => item.status)).toEqual([
      'fulfilled',
      'fulfilled',
      'fulfilled',
      'rejected',
      'fulfilled',
    ]);
    expect(settled[0]).toEqual({ status: 'fulfilled', value: 10 });
    expect(settled[4]).toEqual({ status: 'fulfilled', value: 50 });
  });

  it('does not transfer a second full copy of structured tool output', () => {
    const structured = buildToolResponse({ summary: 'ready' }, '{"summary":"ready"}', undefined, {});
    expect(structured).toEqual({ data: { summary: 'ready' }, groundingChunks: undefined, meta: {} });

    const unstructured = buildToolResponse(undefined, 'plain text', undefined, {});
    expect(unstructured.text).toBe('plain text');
  });

  it('keeps full-document tools out of truncation-prone short budgets', () => {
    expect(outputTokenBudgetForTool('applyResumeImprovements')).toBe(8_192);
    expect(outputTokenBudgetForTool('extractTalentProfile')).toBe(8_192);
    expect(outputTokenBudgetForTool('formatJobDescription')).toBe(4_096);
    expect(outputTokenBudgetForTool('generateVocabularyFlashcards')).toBe(4_096);
    expect(outputTokenBudgetForTool('calculateCompatibility')).toBe(1_024);
  });

  it('uses minimal thinking only for deterministic resume reformatting', () => {
    expect(thinkingLevelForTool('convertResumeFormat')).toBe('minimal');
    expect(thinkingLevelForTool('generateCoverLetter')).toBe('low');
    expect(thinkingLevelForTool('calculateCompatibility')).toBe('low');
  });
});
