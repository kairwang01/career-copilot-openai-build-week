import { beforeEach, describe, expect, it, vi } from 'vitest';

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));

vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));

import { validateBusinessProviderUrl } from '../functions/src/handlers/businessLlm';

beforeEach(() => {
  lookupMock.mockReset();
});

describe('business custom-provider URL validation', () => {
  it('rejects a public-looking hostname that resolves to loopback before saving it', async () => {
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

    await expect(validateBusinessProviderUrl('https://provider.example/v1'))
      .rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('accepts a valid public HTTPS provider URL', async () => {
    lookupMock.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);

    await expect(validateBusinessProviderUrl('  https://provider.example/v1  '))
      .resolves.toBe('https://provider.example/v1');
  });
});
