import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const callable = vi.fn();
  return {
    callable,
    httpsCallable: vi.fn(() => callable),
  };
});

vi.mock('firebase/functions', () => ({
  httpsCallable: mocks.httpsCallable,
}));

vi.mock('../lib/firebaseClient', () => ({
  firebaseFunctions: {},
}));

import {
  createEmbeddedCreditPackCheckout,
  createEmbeddedSubscriptionCheckout,
  createSubscriptionCheckout,
} from '../services/subscriptionClient';

describe('subscription checkout operation ids', () => {
  beforeEach(() => {
    mocks.callable.mockReset();
    mocks.callable.mockResolvedValue({
      data: { mode: 'hosted', id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' },
    });
  });

  it('passes an explicit operation id through subscription and credit-pack wrappers', async () => {
    const operationId = 'checkout_123e4567-e89b-12d3-a456-426614174000';

    await createEmbeddedSubscriptionCheckout('accelerator', 'embedded', operationId);
    await createEmbeddedCreditPackCheckout('pack_100', 'hosted', operationId);

    expect(mocks.callable).toHaveBeenNthCalledWith(1, {
      planKey: 'accelerator',
      uiMode: 'embedded',
      operationId,
    });
    expect(mocks.callable).toHaveBeenNthCalledWith(2, {
      planKey: 'pack_100',
      uiMode: 'hosted',
      operationId,
    });
  });

  it('generates a fresh valid operation id for each new wrapper call', async () => {
    await createSubscriptionCheckout('accelerator');
    await createEmbeddedCreditPackCheckout('pack_100', 'hosted');

    const first = mocks.callable.mock.calls[0]?.[0]?.operationId;
    const second = mocks.callable.mock.calls[1]?.[0]?.operationId;
    expect(first).toMatch(/^checkout_[A-Za-z0-9._:-]{16,127}$/);
    expect(second).toMatch(/^checkout_[A-Za-z0-9._:-]{16,127}$/);
    expect(first).not.toBe(second);
    expect(mocks.callable.mock.calls[0]?.[0]).toMatchObject({ uiMode: 'hosted' });
  });
});
