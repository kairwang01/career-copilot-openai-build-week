import { describe, expect, it } from 'vitest';
import {
  SEPOLIA_CHAIN_ID,
  SEPOLIA_EXPLORER_ORIGIN,
  getSepoliaAddressUrl,
  normalizeWalletAddressForDisplay,
} from '../lib/web3Links';

describe('web3 testnet links', () => {
  it('uses Sepolia as the only explorer target', () => {
    expect(SEPOLIA_CHAIN_ID).toBe(11155111);
    expect(SEPOLIA_EXPLORER_ORIGIN).toBe('https://sepolia.etherscan.io');
  });

  it('normalizes and links wallet addresses to Sepolia Etherscan', () => {
    const address = '0x1234567890abcdef1234567890ABCDEF12345678';
    expect(normalizeWalletAddressForDisplay(` ${address} `)).toBe(address);
    expect(getSepoliaAddressUrl(` ${address} `)).toBe(
      `https://sepolia.etherscan.io/address/${address}`,
    );
  });

  it('does not create explorer links for missing or malformed addresses', () => {
    expect(getSepoliaAddressUrl('   ')).toBeNull();
    expect(getSepoliaAddressUrl(null)).toBeNull();
    expect(getSepoliaAddressUrl('0xabcDEF')).toBeNull();
    expect(getSepoliaAddressUrl('javascript:alert(1)')).toBeNull();
  });
});
