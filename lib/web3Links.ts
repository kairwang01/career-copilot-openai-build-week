export const SEPOLIA_CHAIN_ID = 11155111;
export const SEPOLIA_EXPLORER_ORIGIN = 'https://sepolia.etherscan.io';

export function normalizeWalletAddressForDisplay(address: string | null | undefined): string {
  return typeof address === 'string' ? address.trim() : '';
}

export function getSepoliaAddressUrl(address: string | null | undefined): string | null {
  const normalized = normalizeWalletAddressForDisplay(address);
  if (!/^0x[0-9a-fA-F]{40}$/.test(normalized)) return null;
  return `${SEPOLIA_EXPLORER_ORIGIN}/address/${encodeURIComponent(normalized)}`;
}
