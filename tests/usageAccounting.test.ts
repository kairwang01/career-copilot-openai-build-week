import { describe, expect, it, vi } from 'vitest';

import {
  usageEventCountsAsMeteredAttempt,
  usageEventCreditsAreBillable,
  usageEventNetCreditCost,
} from '../functions/src/admin/usageLog';

describe('usage accounting semantics', () => {
  it('counts an unsettled paid claim as one attempt and net credit spend', () => {
    const event = { status: 'deducted', credit_cost: 10 };
    expect(usageEventCountsAsMeteredAttempt(event)).toBe(true);
    expect(usageEventCreditsAreBillable(event)).toBe(true);
    expect(usageEventNetCreditCost(event)).toBe(10);
  });

  it('keeps a refunded paid claim as an attempt but removes its credit spend', () => {
    const event = { status: 'deducted', credit_cost: 10, refund_status: 'refunded' };
    expect(usageEventCountsAsMeteredAttempt(event)).toBe(true);
    expect(usageEventCreditsAreBillable(event)).toBe(false);
    expect(usageEventNetCreditCost(event)).toBe(0);
  });

  it('counts a free claim as an attempt without credit spend', () => {
    const event = { status: 'free', credit_cost: 0 };
    expect(usageEventCountsAsMeteredAttempt(event)).toBe(true);
    expect(usageEventCreditsAreBillable(event)).toBe(false);
    expect(usageEventNetCreditCost(event)).toBe(0);
  });

  it.each(['observed', 'refunded'])('excludes %s records from metered attempts and spend', (status) => {
    const event = { status, credit_cost: 10 };
    expect(usageEventCountsAsMeteredAttempt(event)).toBe(false);
    expect(usageEventCreditsAreBillable(event)).toBe(false);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, 'bad'])(
    'fails closed for invalid billable credit cost %s',
    (creditCost) => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        expect(() => usageEventNetCreditCost({ status: 'deducted', credit_cost: creditCost }))
          .toThrow('Usage metering is temporarily unavailable');
      } finally {
        log.mockRestore();
      }
    },
  );
});
