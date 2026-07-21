import { describe, expect, it } from 'vitest';
import { isAlreadyExistsError } from '../functions/src/handlers/notifications';

describe('notification delivery idempotency', () => {
  it('recognizes both Firestore duplicate error representations', () => {
    expect(isAlreadyExistsError({ code: 6 })).toBe(true);
    expect(isAlreadyExistsError({ code: 'already-exists' })).toBe(true);
  });

  it('requires transient and permission failures to be retried', () => {
    expect(isAlreadyExistsError({ code: 14 })).toBe(false);
    expect(isAlreadyExistsError({ code: 'unavailable' })).toBe(false);
    expect(isAlreadyExistsError({ code: 'permission-denied' })).toBe(false);
    expect(isAlreadyExistsError(new Error('network down'))).toBe(false);
  });
});
