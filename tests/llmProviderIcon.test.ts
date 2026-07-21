import { describe, expect, it } from 'vitest';
import { getLlmProviderIconMeta } from '../components/admin/LlmProviderIcon';

describe('getLlmProviderIconMeta', () => {
  it('matches common LLM provider keywords and keeps custom names on the default icon', () => {
    expect(getLlmProviderIconMeta('gpt-4o').src).toBe('/llm-icons/chatgpt.svg');
    expect(getLlmProviderIconMeta('Gemini Flash').src).toBe('/llm-icons/gemini.svg');
    expect(getLlmProviderIconMeta('deepseek-chat').src).toBe('/llm-icons/deepseek.svg');
    expect(getLlmProviderIconMeta('Anthropic Claude Sonnet').src).toBe('/llm-icons/claude.svg');
    expect(getLlmProviderIconMeta('moonshot kimi').src).toBe('/llm-icons/kimi.ico');
    expect(getLlmProviderIconMeta('kairllm custom gateway').mark).toBe('AI');
  });
});
