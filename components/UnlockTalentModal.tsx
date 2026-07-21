import React, { useRef, useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import type { UserProfile } from '../types';
import { ethers } from 'ethers';
import { ViewportAwareDialog } from './ViewportAwareDialog';

interface MatchedCandidate extends UserProfile {
  compatibilityScore: number;
  summary: string;
}

interface UnlockTalentModalProps {
  candidate: MatchedCandidate & { index: number };
  canUnlock: boolean;
  onClose: () => void;
  onUnlocked: (candidate: MatchedCandidate & { index: number }) => void;
  navigateToBusinessPricing: () => void;
  t: (key: string) => string;
}

// NOTE: In a real app, this would be in a shared constants file.
// Reserved Sepolia-compatible address for the live credential unlock flow.
const TALENT_NFT_CONTRACT_ADDRESS =
  '0x2A3b1A43842238321a22542a035921A362358189';

const TALENT_NFT_PREVIEW_MODE = true;

const TALENT_NFT_ABI = [
  'event ProfileUnlocked(uint256 indexed tokenId, address indexed employer, uint256 payment)',
  'function unlockProfile(uint256 tokenId) external payable',
  'function getUnlockFee() external view returns (uint256)',
];

const UnlockTalentModal: React.FC<UnlockTalentModalProps> = ({
  candidate,
  canUnlock,
  onClose,
  onUnlocked,
  navigateToBusinessPricing,
  t,
}) => {
  const [isPaying, setIsPaying] = useState(false);
  const [upgradeConfirmOpen, setUpgradeConfirmOpen] = useState(false);
  const [unlockFee, setUnlockFee] = useState<string>(
    t('unlock_modal_fee_loading'),
  );
  const [error, setError] = useState<string | null>(null);
  const hasWallet =
    typeof window !== 'undefined' &&
    typeof (window as any).ethereum !== 'undefined';
  const mountedRef = useRef(true);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    let active = true;
    const fetchUnlockFee = async () => {
      if (TALENT_NFT_PREVIEW_MODE) {
        if (active) setUnlockFee(t('unlock_modal_fee_preview'));
        return;
      }
      if (!hasWallet) {
        if (active) setUnlockFee(t('unlock_modal_fee_unavailable'));
        return;
      }
      try {
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const contract = new ethers.Contract(
          TALENT_NFT_CONTRACT_ADDRESS,
          TALENT_NFT_ABI,
          provider,
        );
        const feeInWei = await contract.getUnlockFee();
        if (active) setUnlockFee(ethers.formatEther(feeInWei));
      } catch {
        if (active) setUnlockFee(t('unlock_modal_fee_error'));
      }
    };
    fetchUnlockFee();
    return () => {
      active = false;
    };
  }, [hasWallet, t]);

  const handleUnlock = async () => {
    if (isPaying) return;
    if (!canUnlock) {
      setError(null);
      setUpgradeConfirmOpen(true);
      return;
    }
    if (!candidate.nft_token_id) {
      setError(t('unlock_error_invalid_token'));
      return;
    }
    if (TALENT_NFT_PREVIEW_MODE) {
      setIsPaying(true);
      setError(null);
      try {
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (mountedRef.current) onUnlocked(candidate);
      } finally {
        if (mountedRef.current) setIsPaying(false);
      }
      return;
    }
    if (!hasWallet) {
      setError(t('unlock_error_wallet_missing'));
      return;
    }

    setIsPaying(true);
    setError(null);
    try {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(
        TALENT_NFT_CONTRACT_ADDRESS,
        TALENT_NFT_ABI,
        signer,
      );

      const feeInWei = await contract.getUnlockFee();

      const tx = await contract.unlockProfile(candidate.nft_token_id, {
        value: feeInWei,
      });
      await tx.wait();

      if (mountedRef.current) onUnlocked(candidate);
    } catch (err) {
      if (!mountedRef.current) return;
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code)
          : '';
      if (code === 'ACTION_REJECTED') {
        setError(t('unlock_error_rejected'));
      } else {
        setError(t('unlock_error_failed'));
      }
    } finally {
      if (mountedRef.current) setIsPaying(false);
    }
  };

  const handleOpenUpgradeConfirm = () => {
    setError(null);
    setUpgradeConfirmOpen(true);
  };

  const handleConfirmUpgrade = () => {
    if (isPaying) return;
    setIsPaying(true);
    setUpgradeConfirmOpen(false);
    navigateToBusinessPricing();
  };

  return (
    <ViewportAwareDialog open onClose={onClose} closeOnBackdrop labelledBy="unlock-modal-title" maxWidth={448} zIndex={70}>
      <div className="rounded-xl bg-white shadow-2xl dark:bg-slate-800">
        <div className="p-6 text-center">
          <div className="w-16 h-16 mx-auto bg-blue-100 dark:bg-blue-950 rounded-full flex items-center justify-center mb-4 border-4 border-white dark:border-slate-800 shadow-md">
            <LockKeyhole className="h-8 w-8 text-blue-600 dark:text-blue-300" aria-hidden="true" />
          </div>

          <h3
            id="unlock-modal-title"
            className="text-xl font-bold text-gray-800 dark:text-gray-100"
          >
            {t('unlock_modal_title')}
          </h3>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            {t('unlock_modal_candidate_id').replace(
              '{id}',
              String(candidate.index + 1),
            )}
          </p>

          <div className="my-6">
            {upgradeConfirmOpen ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-left dark:border-amber-900/50 dark:bg-amber-950/25">
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                  {t('business_page_pricing_title')}
                </p>
                <p className="mt-2 text-sm leading-6 text-amber-800 dark:text-amber-100/80">
                  {t('site_pricing_business_upsell_banner')}
                </p>
              </div>
            ) : canUnlock ? (
              <p className="text-gray-600 dark:text-gray-300">
                {TALENT_NFT_PREVIEW_MODE
                  ? t('unlock_modal_desc_preview')
                  : t('unlock_modal_desc')}
              </p>
            ) : (
              <p className="text-yellow-800 bg-yellow-50 p-3 rounded-md border border-yellow-200">
                {t('unlock_modal_upgrade_required')}
              </p>
            )}
          </div>

          {canUnlock && !upgradeConfirmOpen && (
            <div className="p-4 bg-gray-100 dark:bg-slate-700 rounded-lg">
              <p className="text-sm text-gray-600 dark:text-gray-300 font-medium">
                {t('unlock_modal_unlock_fee')}
              </p>
              <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                {Number.isFinite(Number(unlockFee))
                  ? `${unlockFee} ETH`
                  : unlockFee}
              </p>
              {!hasWallet && (
                <p className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
                  {TALENT_NFT_PREVIEW_MODE
                    ? t('unlock_modal_wallet_preview_note')
                    : t('unlock_modal_wallet_missing')}
                </p>
              )}
            </div>
          )}

          {error && (
            <p
              className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>
        <div className="p-4 border-t bg-gray-50 rounded-b-xl grid grid-cols-2 gap-3 dark:border-slate-700 dark:bg-slate-900/40">
          <button
            type="button"
            onClick={upgradeConfirmOpen ? () => setUpgradeConfirmOpen(false) : onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-slate-600 dark:bg-slate-700 dark:text-gray-200 dark:hover:bg-slate-600"
          >
            {t('unlock_modal_cancel')}
          </button>
          {upgradeConfirmOpen ? (
            <button
              type="button"
              onClick={handleConfirmUpgrade}
              disabled={isPaying}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPaying ? t('portal_billing_updating') : t('unlock_modal_upgrade_button')}
            </button>
          ) : canUnlock ? (
            <button
              type="button"
              onClick={handleUnlock}
              disabled={isPaying || (!TALENT_NFT_PREVIEW_MODE && !hasWallet)}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:bg-blue-400"
            >
              {!TALENT_NFT_PREVIEW_MODE && !hasWallet
                ? t('unlock_modal_wallet_required')
                : isPaying
                  ? t('unlock_modal_unlocking')
                  : t('unlock_modal_unlock_with_wallet')}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleOpenUpgradeConfirm}
              className="px-4 py-2 text-sm font-medium text-white bg-green-600 border border-transparent rounded-md shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500/40"
            >
              {t('unlock_modal_upgrade_button')}
            </button>
          )}
        </div>
      </div>
    </ViewportAwareDialog>
  );
};

export default UnlockTalentModal;
