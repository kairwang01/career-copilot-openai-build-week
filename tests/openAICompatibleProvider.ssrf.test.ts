import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock, safeHttpsRequestMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  safeHttpsRequestMock: vi.fn(),
}));

vi.mock('../functions/src/utils/safeHttpsTransport', () => ({
  safeHttpsRequest: safeHttpsRequestMock,
}));

import { OpenAICompatibleProvider } from '../functions/src/llm/providers/openAICompatibleProvider';

const providerResponse = {
  ok: true,
  status: 200,
  text: async () => '',
  json: async () => ({
    choices: [{ message: { content: 'Safe response' } }],
    model: 'custom-model',
    usage: { prompt_tokens: 2, completion_tokens: 3 },
  }),
};

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(providerResponse);
  safeHttpsRequestMock.mockReset().mockResolvedValue(providerResponse);
  vi.stubGlobal('fetch', fetchMock);
});

describe('OpenAICompatibleProvider custom transport', () => {
  it('routes business custom-provider calls through the DNS-pinned HTTPS transport', async () => {
    const provider = new OpenAICompatibleProvider({
      name: 'custom',
      baseUrl: 'https://provider.example/v1',
      apiKey: 'business-secret',
      model: 'custom-model',
    });

    await expect(provider.generate({ prompt: 'Hello' })).resolves.toMatchObject({
      text: 'Safe response',
      model: 'custom-model',
      provider: 'custom',
    });

    expect(safeHttpsRequestMock).toHaveBeenCalledWith(
      'https://provider.example/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer business-secret' }),
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps platform-managed providers on their existing fetch transport', async () => {
    const provider = new OpenAICompatibleProvider({
      name: 'platform-model',
      baseUrl: 'https://platform.example/v1',
      apiKey: 'platform-secret',
      model: 'platform-model',
    });

    await expect(provider.generate({ prompt: 'Hello' })).resolves.toMatchObject({
      text: 'Safe response',
      provider: 'platform-model',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(safeHttpsRequestMock).not.toHaveBeenCalled();
  });
});
