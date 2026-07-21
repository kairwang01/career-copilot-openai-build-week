export interface SecureRandomSource {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView | null>(array: T) => T;
}

export function createSecureRandomToken(
  source: SecureRandomSource | null | undefined = globalThis.crypto,
): string {
  if (typeof source?.randomUUID === 'function') {
    return source.randomUUID();
  }
  if (typeof source?.getRandomValues === 'function') {
    const bytes = source.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('Secure random identifier generation is unavailable.');
}

/**
 * Creates a collision-resistant client operation id. Billing and AI
 * idempotency must fail closed when the browser has no secure random source.
 */
export function createSecureRandomId(
  prefix: string,
  source: SecureRandomSource | null | undefined = globalThis.crypto,
): string {
  if (!/^[a-z0-9_-]+$/i.test(prefix)) {
    throw new Error('Secure random id prefix is invalid.');
  }
  return `${prefix}_${createSecureRandomToken(source)}`;
}
