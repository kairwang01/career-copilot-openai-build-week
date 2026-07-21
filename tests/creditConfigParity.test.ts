import { describe, expect, it } from 'vitest';
import {
  CREDIT_PACKS,
  INITIAL_USER_CREDITS,
  TOOL_CREDIT_COSTS as FRONTEND_TOOL_COSTS,
} from '../config/credits';
import {
  CREDIT_PACK_CREDITS,
  INITIAL_CREDITS,
  TOOL_CREDIT_COSTS as SERVER_TOOL_COSTS,
} from '../functions/src/credits/schema';

describe('frontend and server credit-contract parity', () => {
  it('keeps the initial account grant identical', () => {
    expect(INITIAL_CREDITS).toBe(INITIAL_USER_CREDITS);
  });

  it('keeps every tool price identical', () => {
    expect(SERVER_TOOL_COSTS).toEqual(FRONTEND_TOOL_COSTS);
  });

  it('keeps every one-off pack grant identical', () => {
    expect(CREDIT_PACK_CREDITS).toEqual(
      Object.fromEntries(CREDIT_PACKS.map((pack) => [pack.key, pack.credits])),
    );
  });
});
