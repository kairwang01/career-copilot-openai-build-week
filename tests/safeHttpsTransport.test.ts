import { describe, expect, it, vi } from 'vitest';
import { createSafeHttpsTransport } from '../functions/src/utils/safeHttpsTransport';

const request = {
  method: 'POST' as const,
  headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
  body: '{"model":"test"}',
  timeoutMs: 10_000,
};

describe('business custom-provider safe HTTPS transport', () => {
  it('rejects hostnames whose DNS answers point to private IPv4 networks', async () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.10', '169.254.169.254']) {
      const requestHop = vi.fn();
      const transport = createSafeHttpsTransport({
        lookup: async () => [{ address, family: 4 }],
        requestHop,
      });

      await expect(transport('https://provider.example/v1/chat/completions', request))
        .rejects.toMatchObject({ code: 'invalid-argument' });
      expect(requestHop).not.toHaveBeenCalled();
    }
  });

  it('rejects hostnames whose DNS answers point to private IPv6 networks', async () => {
    for (const address of ['::1', 'fc00::1', 'fd00::1', 'fe80::1', '::ffff:a9fe:a9fe']) {
      const requestHop = vi.fn();
      const transport = createSafeHttpsTransport({
        lookup: async () => [{ address, family: 6 }],
        requestHop,
      });

      await expect(transport('https://provider.example/v1/chat/completions', request))
        .rejects.toMatchObject({ code: 'invalid-argument' });
      expect(requestHop).not.toHaveBeenCalled();
    }
  });

  it('revalidates DNS on every redirect hop before sending provider credentials', async () => {
    const lookup = vi.fn(async (hostname: string) => hostname === 'provider.example'
      ? [{ address: '203.0.113.10', family: 4 }]
      : [{ address: '169.254.169.254', family: 4 }]);
    const requestHop = vi.fn().mockResolvedValue({
      status: 307,
      headers: { location: 'https://redirect-target.example/v1/chat/completions' },
      body: '',
    });
    const transport = createSafeHttpsTransport({ lookup, requestHop });

    await expect(transport('https://provider.example/v1/chat/completions', request))
      .rejects.toMatchObject({ code: 'invalid-argument' });

    expect(requestHop).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith('redirect-target.example', { all: true, order: 'verbatim' });
  });

  it('pins the validated address so a later DNS rebinding answer cannot replace it', async () => {
    const lookup = vi.fn()
      .mockResolvedValueOnce([{ address: '203.0.113.20', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    const requestHop = vi.fn(async (_url, _init, pinnedAddress) => ({
      status: 200,
      headers: {},
      body: JSON.stringify({ connectedTo: pinnedAddress.address }),
    }));
    const transport = createSafeHttpsTransport({ lookup, requestHop });

    const response = await transport('https://rebind.example/v1/chat/completions', request);

    await expect(response.json()).resolves.toEqual({ connectedTo: '203.0.113.20' });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(requestHop).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: 'rebind.example' }),
      request,
      { address: '203.0.113.20', family: 4 },
    );
  });

  it('allows a normal public HTTPS provider response', async () => {
    const requestHop = vi.fn().mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"choices":[{"message":{"content":"ok"}}]}',
    });
    const transport = createSafeHttpsTransport({
      lookup: async () => [{ address: '8.8.8.8', family: 4 }],
      requestHop,
    });

    const response = await transport('https://api.provider.example/v1/chat/completions', request);

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ choices: [{ message: { content: 'ok' } }] });
    expect(requestHop).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: 'https:', hostname: 'api.provider.example' }),
      request,
      { address: '8.8.8.8', family: 4 },
    );
  });
});
