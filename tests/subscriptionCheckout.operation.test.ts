import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/subscriptionClient', () => ({
  createCheckoutOperationId: vi.fn(() => 'checkout_default_1234567890'),
  createEmbeddedSubscriptionCheckout: vi.fn(),
  createEmbeddedCreditPackCheckout: vi.fn(),
  confirmSimulatedCheckout: vi.fn(),
  confirmSimulatedCreditPack: vi.fn(),
}));

import { selectCheckoutOperation } from '../contexts/SubscriptionCheckoutContext';

describe('SubscriptionCheckoutContext operation reuse', () => {
  it('keeps the same operation id for a retry of the same checkout item', () => {
    const generate = vi.fn()
      .mockReturnValueOnce('checkout_first_1234567890')
      .mockReturnValueOnce('checkout_second_1234567890');

    const first = selectCheckoutOperation(null, 'plan', 'accelerator', 'embedded', generate);
    const retried = selectCheckoutOperation(first, 'plan', 'accelerator', 'hosted', generate);
    const different = selectCheckoutOperation(retried, 'pack', 'pack_100', 'hosted', generate);

    expect(retried).toBe(first);
    expect(retried.operationId).toBe('checkout_first_1234567890');
    expect(retried.uiMode).toBe('embedded');
    expect(different.operationId).toBe('checkout_second_1234567890');
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
