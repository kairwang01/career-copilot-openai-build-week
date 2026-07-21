import { describe, expect, it } from 'vitest';

import {
  createSecureRandomId,
  createSecureRandomToken,
  type SecureRandomSource,
} from '../lib/secureRandomId';

describe('secure random operation ids', () => {
  it('uses randomUUID when the runtime provides it', () => {
    expect(createSecureRandomToken({
      randomUUID: () => '00000000-0000-4000-8000-000000000001',
    })).toBe('00000000-0000-4000-8000-000000000001');
    expect(createSecureRandomId('checkout', {
      randomUUID: () => '00000000-0000-4000-8000-000000000001',
    })).toBe('checkout_00000000-0000-4000-8000-000000000001');
  });

  it('falls back to cryptographic bytes, never Math.random', () => {
    const source: SecureRandomSource = {
      getRandomValues: (array) => {
        if (array instanceof Uint8Array) array.fill(0xab);
        return array;
      },
    };
    expect(createSecureRandomId('ai', source)).toBe(`ai_${'ab'.repeat(16)}`);
  });

  it('fails closed when secure randomness is unavailable', () => {
    expect(() => createSecureRandomToken(null))
      .toThrow('Secure random identifier generation is unavailable.');
    expect(() => createSecureRandomId('checkout', null))
      .toThrow('Secure random identifier generation is unavailable.');
    expect(() => createSecureRandomId('../checkout', {})).toThrow('prefix is invalid');
  });

  it('keeps persisted and server-sensitive identifiers off Math.random fallbacks', () => {
    const root = new URL('../', import.meta.url);
    const paths = [
      'components/Avatar.tsx',
      'components/CompanyLogo.tsx',
      'components/AgencyHub.tsx',
      'components/JobPostForm.tsx',
      'services/resumeStorage.ts',
      'services/savedPortfolios.ts',
      'marketing/pages/SimulatedCheckoutPage.tsx',
      'functions/src/handlers/stripeBilling.ts',
    ];
    return Promise.all(paths.map(async (path) => {
      const { readFile } = await import('node:fs/promises');
      const source = await readFile(new URL(path, root), 'utf8');
      expect(source, path).not.toContain('Math.random()');
    }));
  });
});
