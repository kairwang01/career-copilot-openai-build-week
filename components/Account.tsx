import React, { useState, useEffect, useCallback, useRef } from 'react';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { data } from '@/lib/data';
import { firestoreDb } from '@/lib/firebaseClient';
import type { AppSession as Session } from '../lib/data';
import Avatar from './Avatar';
import { ethers } from 'ethers';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleDot,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';
// TEMP HIDDEN: user-facing API keys + BYOA custom endpoint are hidden from the
// settings page. Model/endpoint config is superadmin-only via the Admin Console.
// To restore, re-enable these imports and the two JSX blocks below.
// import ApiKeyManager from './ApiKeyManager';
// import { BusinessCustomApi } from './BusinessCustomApi';
import { listModels } from '../services/aiClient';
import { isWeb3Enabled, onWeb3FlagChange, refreshWeb3Config, type Web3Config } from '../config/featureFlags';
import { loadBirthdayLocal, saveBirthdayLocal } from '../lib/onboarding';
import type { UserProfile } from '../types';
import { ViewportAwareDialog } from './ViewportAwareDialog';
import {
  SEPOLIA_CHAIN_ID,
  SEPOLIA_EXPLORER_ORIGIN,
  getSepoliaAddressUrl,
} from '../lib/web3Links';

// The ABI for the smart contract, defining its functions and events
const TALENT_NFT_ABI = [
  'event Minted(address indexed to, uint256 indexed tokenId)',
  'event Staked(address indexed owner, uint256 indexed tokenId)',
  'event Unstaked(address indexed owner, uint256 indexed tokenId)',
  'event RewardsClaimed(address indexed to, uint256 amount)',
  'function mint(address to) external returns (uint256)',
  'function stake(uint256 tokenId) external',
  'function unstake(uint256 tokenId) external',
  'function claimRewards() external',
  'function getRewards(address account) external view returns (uint256)',
  'function isStaked(uint256 tokenId) external view returns (bool)',
  'function getTokenIdOfOwner(address owner) external view returns (uint256)',
  'function balanceOf(address owner) external view returns (uint256)',
  'function getUnlockFee() external view returns (uint256)',
];

const TARGET_CHAIN_ID = SEPOLIA_CHAIN_ID; // Sepolia Testnet Chain ID
const TARGET_CHAIN_ID_HEX = '0xaa36a7'; // Sepolia Chain ID in Hex

const WEB3_CONFIG_FALLBACK: Web3Config = {
  enabled: false,
  preview_mode: true,
  network: 'sepolia',
  chain_id: SEPOLIA_CHAIN_ID,
  contract_address: '0x2A3b1A43842238321a22542a035921A362358189',
  updated_at: null,
  updated_by: null,
};

// Deterministic per-wallet token id for the preview credential, so re-opening
// the page shows a stable id and re-mints don't churn.
const previewTokenIdFor = (address: string): number =>
  (parseInt(address.replace(/^0x/i, '').slice(0, 8) || '0', 16) % 90000) + 10000;

type AccountNotice = {
  type: 'success' | 'error' | 'info';
  text: string;
};

type Web3ConfirmAction = 'mint' | 'stake' | 'unstake' | 'claim';

type EthereumProviderLike = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

const getEthereumProvider = (): EthereumProviderLike | null => {
  const maybe = (window as unknown as { ethereum?: EthereumProviderLike }).ethereum;
  return maybe && typeof maybe.request === 'function' ? maybe : null;
};

const normalizeWalletAddress = (address: string | null | undefined): string =>
  typeof address === 'string' ? address.trim().toLowerCase() : '';

const readConnectedWalletAccounts = async (ethereum: EthereumProviderLike): Promise<string[]> => {
  const raw = await ethereum.request({ method: 'eth_accounts' });
  return Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === 'string')
    : [];
};

const withTimeout = async <T,>(promise: Promise<T>, ms: number): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Request timed out.')), ms);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const normalizeDateInput = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function') {
    return normalizeDateInput(value.toDate());
  }
  return '';
};

const accountDraftKey = (uid: string) => `account_profile_draft_${uid}`;

const loadAccountDraft = (uid: string): { fullName: string; birthDate: string } => {
  try {
    const raw = localStorage.getItem(accountDraftKey(uid));
    if (!raw) return { fullName: '', birthDate: '' };
    const draft = JSON.parse(raw) as { fullName?: unknown; birthDate?: unknown };
    return {
      fullName: typeof draft.fullName === 'string' ? draft.fullName : '',
      birthDate: normalizeDateInput(draft.birthDate),
    };
  } catch {
    return { fullName: '', birthDate: '' };
  }
};

const saveAccountDraft = (uid: string, fullName: string, birthDate: string): void => {
  try {
    localStorage.setItem(accountDraftKey(uid), JSON.stringify({ fullName, birthDate }));
  } catch {
    // Local cache is best-effort; Firestore remains the source of truth.
  }
};

const AccountNoticeBanner: React.FC<{ notice: AccountNotice | null; qa: string }> = ({ notice, qa }) => {
  if (!notice) return null;

  const toneClass = notice.type === 'success'
    ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800/50 dark:bg-green-900/25 dark:text-green-200'
    : notice.type === 'error'
      ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-800/50 dark:bg-red-900/25 dark:text-red-200'
      : 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800/50 dark:bg-blue-900/25 dark:text-blue-200';

  return (
    <div
      className={`rounded-lg border px-3 py-2 text-sm leading-6 ${toneClass}`}
      role={notice.type === 'error' ? 'alert' : 'status'}
      aria-live={notice.type === 'error' ? 'assertive' : 'polite'}
      data-qa={qa}
    >
      {notice.text}
    </div>
  );
};

/**
 * Shown to non-business users in place of the removed model picker.
 * BusinessCustomApi (rendered just before this) renders nothing for non-business
 * users, so this note fills that slot with a one-liner instead.
 * Both components read isBusiness from listModels(); they coordinate so that
 * a business user sees only the BYOA form and a non-business user sees only this note.
 */
const ModelRoutingManagedNote: React.FC<{ t: (key: string) => string }> = ({
  t,
}) => {
  const [isBusiness, setIsBusiness] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    listModels()
      .then(({ isBusiness: biz }) => {
        if (active) setIsBusiness(!!biz);
      })
      .catch(() => {
        if (active) setIsBusiness(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Hide while loading or if business (BusinessCustomApi handles that case)
  if (isBusiness === null || isBusiness) return null;

  return (
    <p className="mt-6 text-xs text-gray-400 dark:text-slate-500 italic">
      {t('account_model_managed')}
    </p>
  );
};

interface AccountProps {
  session: Session;
  profile?: UserProfile | null;
  onSetView: (
    view: 'home' | 'auth' | 'account' | 'business' | 'agency' | 'api_docs',
  ) => void;
  t: (key: string) => string;
  onBack?: () => void;
}

const Account: React.FC<AccountProps> = ({
  session,
  profile,
  onSetView,
  t,
  onBack,
}) => {
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  // False once unmounted — Account loads/saves async and is remounted on session change,
  // so a late resolve must not setState. passwordSavingRef latches a synchronous double-Enter.
  const mountedRef = useRef(true);
  const profileSavingRef = useRef(false);
  const passwordSavingRef = useRef(false);
  const web3SyncRunRef = useRef(0);
  const walletAddressRef = useRef<string | null>(null);
  const [web3Busy, setWeb3Busy] = useState(false);
  const [fullName, setFullName] = useState<string>(profile?.full_name || '');
  const [birthDate, setBirthDate] = useState<string>(normalizeDateInput(profile?.birth_date));
  const [avatarUrl, setAvatarUrl] = useState<string>(profile?.avatar_url || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [profileNotice, setProfileNotice] = useState<AccountNotice | null>(null);
  const [passwordNotice, setPasswordNotice] = useState<AccountNotice | null>(null);
  const [web3Notice, setWeb3Notice] = useState<AccountNotice | null>(null);
  const [web3ConfirmAction, setWeb3ConfirmAction] = useState<Web3ConfirmAction | null>(null);

  // Web3 State
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [nftMinted, setNftMinted] = useState<boolean | null>(null);
  const [nftStaked, setNftStaked] = useState<boolean | null>(null);
  const [nftEarnings, setNftEarnings] = useState<number | null>(null);
  const [tokenId, setTokenId] = useState<number | null>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [isEligibleForNFT, setIsEligibleForNFT] = useState(false);
  const [resumeText, setResumeText] = useState<string | null>(null);
  const [isWrongNetwork, setIsWrongNetwork] = useState(false);
  // Web3 is an experimental, admin-toggleable module — the whole section hides
  // when disabled and nothing else on this page depends on wallet state.
  const [web3Enabled, setWeb3Enabled] = useState(isWeb3Enabled());
  const [web3Config, setWeb3Config] = useState<Web3Config>(() => ({
    ...WEB3_CONFIG_FALLBACK,
    enabled: isWeb3Enabled(),
  }));
  const web3PreviewMode = web3Config.preview_mode !== false;
  const talentNftContractAddress = web3Config.contract_address || WEB3_CONFIG_FALLBACK.contract_address;

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = onWeb3FlagChange(setWeb3Enabled);
    refreshWeb3Config()
      .then((config) => {
        if (cancelled) return;
        setWeb3Config(config);
        setWeb3Enabled(config.enabled);
      })
      .catch(() => { /* keep cached fallback */ });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    getProfile();
  }, [session]);

  useEffect(() => {
    if (!profile) return;
    const resolvedBirthDate = normalizeDateInput(profile.birth_date);
    setFullName(profile.full_name || '');
    setBirthDate(resolvedBirthDate);
    setAvatarUrl(profile.avatar_url || '');
    setWalletAddress(profile.wallet_address || null);
    setNftMinted(profile.nft_minted || false);
    setNftStaked(profile.nft_staked || false);
    setNftEarnings(profile.nft_earnings || 0);
    setTokenId(profile.nft_token_id);
    setResumeText(profile.resume_text || null);
    saveAccountDraft(session.user.id, profile.full_name || '', resolvedBirthDate);
  }, [profile, session.user.id]);

  useEffect(() => {
    walletAddressRef.current = walletAddress;
  }, [walletAddress]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const syncWithBlockchain = useCallback(async (options: { interactive?: boolean } = {}) => {
    if (!walletAddress) return;
    const runId = ++web3SyncRunRef.current;
    const savedAddress = walletAddress;
    const isCurrentRun = () =>
      mountedRef.current &&
      web3SyncRunRef.current === runId &&
      normalizeWalletAddress(walletAddressRef.current) === normalizeWalletAddress(savedAddress);

    setIsSyncing(true);
    setIsWrongNetwork(false);
    if (options.interactive) {
      setWeb3Notice({ type: 'info', text: t('account_web3_syncing') });
    }

    try {
      const ethereum = getEthereumProvider();
      if (!ethereum) {
        if (options.interactive) {
          setWeb3Notice({ type: 'error', text: t('account_web3_no_wallet') });
        }
        if (isCurrentRun()) setIsSyncing(false);
        return;
      }

      // Passive sync must never prompt the wallet. `eth_accounts` only returns
      // already-authorized accounts; explicit user actions request access later.
      const accounts = await readConnectedWalletAccounts(ethereum);
      if (!isCurrentRun()) return;
      const hasSavedWalletConnected = accounts.some(
        (account) => normalizeWalletAddress(account) === normalizeWalletAddress(savedAddress),
      );
      if (!hasSavedWalletConnected) {
        if (options.interactive) {
          setWeb3Notice({ type: 'error', text: t('account_web3_connect_first') });
        }
        if (isCurrentRun()) setIsSyncing(false);
        return;
      }

      if (web3PreviewMode) {
        // No deployed contract yet: skip on-chain reads (they would throw and
        // wrongly wipe the credential). The wallet is connected (checked above)
        // and the nft_* values from the profile, already in local state, are the
        // source of truth. Treat the network as ready so the preview flow works
        // on any chain.
        if (isCurrentRun()) {
          setIsWrongNetwork(false);
          if (options.interactive) setWeb3Notice(null);
          setIsSyncing(false);
        }
        return;
      }

      const provider = new ethers.BrowserProvider(ethereum);
      const network = await provider.getNetwork();
      if (!isCurrentRun()) return;

      if (network.chainId !== BigInt(TARGET_CHAIN_ID)) {
        setIsWrongNetwork(true);
        setWeb3Notice({
          type: 'error',
          text: t('account_web3_wrong_network_message'),
        });
        setIsSyncing(false); // Stop syncing process
        return;
      }

      // Correct network, proceed with sync
      const contract = new ethers.Contract(
        talentNftContractAddress,
        TALENT_NFT_ABI,
        provider,
      );
      const balance = await contract.balanceOf(savedAddress);
      if (!isCurrentRun()) return;

      if (balance > 0) {
        const userTokenId = await contract.getTokenIdOfOwner(savedAddress);
        const staked = await contract.isStaked(userTokenId);
        const rewards = await contract.getRewards(savedAddress);
        if (!isCurrentRun()) return;

        const newValues = {
          nft_minted: true,
          nft_staked: staked,
          nft_token_id: Number(userTokenId),
          nft_earnings: parseFloat(ethers.formatEther(rewards)),
        };

        setTokenId(newValues.nft_token_id);
        setNftMinted(newValues.nft_minted);
        setNftStaked(newValues.nft_staked);
        setNftEarnings(newValues.nft_earnings);

        await updateProfileOrThrow(newValues);
      } else {
        const newValues = {
          nft_minted: false,
          nft_staked: false,
          nft_token_id: null,
          nft_earnings: 0,
        };

        setTokenId(newValues.nft_token_id);
        setNftMinted(newValues.nft_minted);
        setNftStaked(newValues.nft_staked);
        setNftEarnings(newValues.nft_earnings);

        await updateProfileOrThrow(newValues);
      }
      if (!isCurrentRun()) return;
      setWeb3Notice(null); // Clear info message on successful sync
    } catch (err) {
      console.error('Error syncing with blockchain:', err);
      if (isCurrentRun()) {
        setWeb3Notice({ type: 'error', text: t('account_web3_sync_failed') });
      }
    } finally {
      if (isCurrentRun()) setIsSyncing(false);
    }
  }, [walletAddress, session.user.id, t, web3PreviewMode, talentNftContractAddress]);

  useEffect(() => {
    if (walletAddress) {
      syncWithBlockchain();
    } else {
      web3SyncRunRef.current += 1;
      setIsSyncing(false);
      setIsWrongNetwork(false);
    }
  }, [walletAddress, syncWithBlockchain]);

  useEffect(() => {
    let active = true;
    const checkEligibility = async () => {
      if (walletAddress && resumeText) {
        const analysesQuery = query(
          collection(firestoreDb, 'users', session.user.id, 'resume_analyses'),
          orderBy('created_at', 'desc'),
          limit(1),
        );
        const analysesSnapshot = await getDocs(analysesQuery);
        if (!active) return;
        const latestScore = analysesSnapshot.empty
          ? 0
          : Number(analysesSnapshot.docs[0].data().score ?? 0);
        setIsEligibleForNFT(latestScore >= 85);
      } else {
        setIsEligibleForNFT(false);
      }
    };
    checkEligibility();
    return () => {
      active = false;
    };
  }, [walletAddress, resumeText, session.user.id]);

  const getProfile = async () => {
    try {
      setProfileLoading(true);
      const { user } = session;
      if (!profile) {
        const localDraft = loadAccountDraft(user.id);
        if (localDraft.fullName) setFullName(localDraft.fullName);
        if (localDraft.birthDate) setBirthDate(localDraft.birthDate);
      }

      const { data: profileData, error } = await withTimeout(data.profiles.get(user.id), 8_000);
      if (!mountedRef.current) return; // navigated away / remounted mid-load

      if (error && !error.message.includes('not found')) {
        throw new Error(error.message);
      }

      if (profileData) {
        setFullName(profileData.full_name || '');
        const resolvedBirthDate = normalizeDateInput(profileData.birth_date) || normalizeDateInput(loadBirthdayLocal(user.id));
        setBirthDate(resolvedBirthDate);
        saveAccountDraft(user.id, profileData.full_name || '', resolvedBirthDate);
        if (resolvedBirthDate && !profileData.birth_date) {
          data.profiles.update(user.id, {
            birth_date: resolvedBirthDate,
            updated_at: new Date().toISOString(),
          }).catch(() => { /* best-effort migration; the local fallback still displays */ });
        }
        setAvatarUrl(profileData.avatar_url || '');
        setWalletAddress(profileData.wallet_address || null);
        setNftMinted(profileData.nft_minted || false);
        setNftStaked(profileData.nft_staked || false);
        setNftEarnings(profileData.nft_earnings || 0);
        setTokenId(profileData.nft_token_id);
        setResumeText(profileData.resume_text || null);
      }
    } catch (error: any) {
      console.error('Error getting profile:', error);
      if (mountedRef.current) {
        setProfileNotice({
          type: 'error',
          text: t('account_profile_load_error'),
        });
      }
    } finally {
      if (mountedRef.current) setProfileLoading(false);
    }
  };

  const updateProfile = async (
    event: React.FormEvent | null,
    { fullName, avatarUrl, birthDate }: { fullName: string; avatarUrl: string; birthDate: string },
  ): Promise<boolean> => {
    if (event) {
      event.preventDefault();
    }
    if (profileSavingRef.current) return false;
    profileSavingRef.current = true;
    setProfileSaving(true);
    setProfileNotice(null);
    const { user } = session;
    const normalizedBirthDate = normalizeDateInput(birthDate);
    setFullName(fullName);
    setBirthDate(normalizedBirthDate);
    saveBirthdayLocal(user.id, normalizedBirthDate);
    saveAccountDraft(user.id, fullName, normalizedBirthDate);

    const updates = {
      id: user.id,
      full_name: fullName,
      birth_date: normalizedBirthDate || null,
      avatar_url: avatarUrl,
      updated_at: new Date().toISOString(),
    };

    try {
      const { error } = await withTimeout(data.profiles.upsert(updates), 8_000);
      if (!mountedRef.current) return false;
      if (error) throw new Error(error.message);
      setProfileNotice({
        type: 'success',
        text: t('account_profile_updated_success'),
      });
      return true;
    } catch (error) {
      console.error('Error updating profile:', error);
      if (mountedRef.current) {
        setProfileNotice({
          type: 'error',
          text: t('account_profile_updated_error'),
        });
      }
      return false;
    } finally {
      profileSavingRef.current = false;
      if (mountedRef.current) setProfileSaving(false);
    }
  };

  const handleUpdatePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      setPasswordNotice({ type: 'error', text: t('account_password_mismatch_error') });
      return;
    }
    if (password.length > 0 && password.length < 6) {
      setPasswordNotice({ type: 'error', text: t('account_password_length_error') });
      return;
    }

    if (passwordSavingRef.current) return; // block synchronous double-submit (a double Enter)
    passwordSavingRef.current = true;
    setPasswordSaving(true);
    setPasswordNotice(null);
    try {
      const { error } = await data.auth.updatePassword(password);
      if (!mountedRef.current) return;
      if (error) {
        setPasswordNotice({ type: 'error', text: error.message });
      } else {
        setPasswordNotice({
          type: 'success',
          text: t('account_password_updated_success'),
        });
        setPassword('');
        setConfirmPassword('');
      }
    } finally {
      passwordSavingRef.current = false;
      if (mountedRef.current) setPasswordSaving(false);
    }
  };

  const updateWallet = async (address: string | null) => {
    try {
      setWeb3Busy(true);
      const { user } = session;
      const { error } = await data.profiles.update(user.id, {
        wallet_address: address,
      });

      if (error) {
        console.error('Error updating wallet:', error);
        throw error;
      }

      if (!mountedRef.current) return;
      web3SyncRunRef.current += 1; // cancel any passive sync tied to the previous wallet
      walletAddressRef.current = address;
      setWalletAddress(address);
      setWeb3Notice({
        type: 'success',
        text: t(
          address
            ? 'account_web3_wallet_connected_success'
            : 'account_web3_wallet_disconnected_success',
        ),
      });
    } catch (error: any) {
      console.error('Error updating wallet:', error);
      if (mountedRef.current) {
        setWeb3Notice({
          type: 'error',
          text: t('account_web3_wallet_update_failed'),
        });
      }
    } finally {
      if (mountedRef.current) setWeb3Busy(false);
    }
  };

  const handleConnectWallet = async () => {
    const ethereum = getEthereumProvider();
    if (ethereum) {
      setWeb3Busy(true);
      try {
        const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
        const address = Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0] : '';
        if (!mountedRef.current) return;

        if (address) {
          await updateWallet(address);
        } else {
          setWeb3Notice({ type: 'error', text: t('account_web3_connect_failed') });
        }
      } catch (error) {
        if (!mountedRef.current) return;
        if ((error as any).code === 4001) {
          setWeb3Notice({
            type: 'error',
            text: t('account_web3_connection_rejected'),
          });
        } else {
          setWeb3Notice({ type: 'error', text: t('account_web3_connect_failed') });
          console.error(error);
        }
      } finally {
        if (mountedRef.current) setWeb3Busy(false);
      }
    } else {
      setWeb3Notice({ type: 'error', text: t('account_web3_no_wallet') });
    }
  };

  const handleDisconnectWallet = async () => {
    await updateWallet(null);
  };

  const handleSwitchNetwork = async () => {
    const ethereum = getEthereumProvider();
    if (!ethereum) {
      setWeb3Notice({ type: 'error', text: t('account_web3_no_wallet') });
      return;
    }
    setWeb3Busy(true);
    setWeb3Notice({ type: 'info', text: t('account_web3_switch_approve') });
    try {
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: TARGET_CHAIN_ID_HEX }],
      });
      if (!mountedRef.current) return;
      syncWithBlockchain({ interactive: true });
    } catch (switchError: any) {
      if (!mountedRef.current) return;
      if (switchError.code === 4902) {
        try {
          await ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: TARGET_CHAIN_ID_HEX,
                chainName: 'Sepolia',
                rpcUrls: ['https://rpc.sepolia.org'],
                nativeCurrency: {
                  name: 'Sepolia Ether',
                  symbol: 'ETH',
                  decimals: 18,
                },
                blockExplorerUrls: [SEPOLIA_EXPLORER_ORIGIN],
              },
            ],
          });
        } catch (addError) {
          if (!mountedRef.current) return;
          setWeb3Notice({
            type: 'error',
            text: t('account_web3_add_network_failed'),
          });
        }
      } else {
        setWeb3Notice({ type: 'error', text: t('account_web3_switch_failed') });
      }
    } finally {
      if (mountedRef.current) setWeb3Busy(false);
    }
  };

  const getWeb3ActionErrorText = (error: unknown, fallbackKey: string): string => {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
    if (code === 4001 || code === 'ACTION_REJECTED') {
      return t('account_web3_connection_rejected');
    }
    return t(fallbackKey);
  };

  const updateProfileOrThrow = async (patch: Partial<UserProfile>) => {
    const { error } = await data.profiles.update(session.user.id, patch);
    if (error) throw new Error(error.message);
  };

  const getSignerForSavedWallet = async (): Promise<ethers.JsonRpcSigner | null> => {
    if (!walletAddress) {
      setWeb3Notice({ type: 'error', text: t('account_web3_connect_first') });
      return null;
    }

    const ethereum = getEthereumProvider();
    if (!ethereum) {
      setWeb3Notice({ type: 'error', text: t('account_web3_no_wallet') });
      return null;
    }

    try {
      const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
      const activeAddress = Array.isArray(accounts) && typeof accounts[0] === 'string'
        ? accounts[0]
        : '';

      if (!mountedRef.current) return null;

      if (!activeAddress) {
        setWeb3Notice({ type: 'error', text: t('account_web3_connect_failed') });
        return null;
      }

      if (normalizeWalletAddress(activeAddress) !== normalizeWalletAddress(walletAddress)) {
        setWeb3Notice({ type: 'error', text: t('account_web3_connect_first') });
        return null;
      }

      const provider = new ethers.BrowserProvider(ethereum);
      return provider.getSigner();
    } catch (error) {
      if (mountedRef.current) {
        setWeb3Notice({
          type: 'error',
          text: getWeb3ActionErrorText(error, 'account_web3_connect_failed'),
        });
      }
      return null;
    }
  };

  const handleMintNFT = async () => {
    if (!walletAddress) {
      setWeb3Notice({ type: 'error', text: t('account_web3_connect_first') });
      return;
    }
    setWeb3Busy(true);
    if (web3PreviewMode) {
      setWeb3Notice({ type: 'info', text: t('account_web3_minting_wait') });
      const prevTokenId = tokenId;
      const prevMinted = nftMinted;
      try {
        const newTokenId = previewTokenIdFor(walletAddress);
        setTokenId(newTokenId);
        setNftMinted(true);
        await updateProfileOrThrow({
          nft_minted: true,
          nft_token_id: newTokenId,
        });
        if (!mountedRef.current) return;
        setWeb3Notice({
          type: 'success',
          text: t('account_web3_mint_success').replace('{id}', String(newTokenId)),
        });
      } catch (error: any) {
        if (mountedRef.current) {
          setTokenId(prevTokenId);
          setNftMinted(prevMinted);
          setWeb3Notice({
            type: 'error',
            text: getWeb3ActionErrorText(error, 'account_web3_mint_failed'),
          });
        }
      } finally {
        if (mountedRef.current) setWeb3Busy(false);
      }
      return;
    }
    setWeb3Notice({ type: 'info', text: t('account_web3_approve_transaction') });
    try {
      const signer = await getSignerForSavedWallet();
      if (!signer || !mountedRef.current) return;
      const contract = new ethers.Contract(
        talentNftContractAddress,
        TALENT_NFT_ABI,
        signer,
      );

      const tx = await contract.mint(walletAddress);
      if (!mountedRef.current) return;
      setWeb3Notice({ type: 'info', text: t('account_web3_minting_wait') });
      const receipt = await tx.wait();
      if (!mountedRef.current) return;

      const mintEvent = receipt.logs.find((log: any) => {
        try {
          const p = contract.interface.parseLog(log);
          return p?.name === 'Minted';
        } catch (e) {
          return false;
        }
      });

      if (mintEvent) {
        const parsedLog = contract.interface.parseLog(mintEvent);
        const newTokenId = Number(parsedLog.args.tokenId);
        setTokenId(newTokenId);
        setNftMinted(true);
        await updateProfileOrThrow({
          nft_minted: true,
          nft_token_id: newTokenId,
        });
        if (!mountedRef.current) return;
        setWeb3Notice({
          type: 'success',
          text: t('account_web3_mint_success').replace(
            '{id}',
            String(newTokenId),
          ),
        });
      } else {
        throw new Error(t('account_web3_mint_missing_event'));
      }
    } catch (error: any) {
      if (mountedRef.current) {
        setWeb3Notice({
          type: 'error',
          text: getWeb3ActionErrorText(error, 'account_web3_mint_failed'),
        });
      }
    } finally {
      if (mountedRef.current) setWeb3Busy(false);
    }
  };

  const handleToggleStake = async () => {
    if (tokenId === null) return;
    setWeb3Busy(true);
    const newStakedStatus = !nftStaked;
    if (web3PreviewMode) {
      const prevStaked = nftStaked;
      setWeb3Notice({
        type: 'info',
        text: t(nftStaked ? 'account_web3_unstake_wait' : 'account_web3_stake_wait'),
      });
      try {
        setNftStaked(newStakedStatus);
        await updateProfileOrThrow({ nft_staked: newStakedStatus });
        if (!mountedRef.current) return;
        setWeb3Notice({
          type: 'success',
          text: t(newStakedStatus ? 'account_web3_stake_success' : 'account_web3_unstake_success'),
        });
      } catch (error: any) {
        if (mountedRef.current) {
          setNftStaked(prevStaked);
          setWeb3Notice({
            type: 'error',
            text: getWeb3ActionErrorText(
              error,
              nftStaked ? 'account_web3_unstake_failed' : 'account_web3_stake_failed',
            ),
          });
        }
      } finally {
        if (mountedRef.current) setWeb3Busy(false);
      }
      return;
    }
    const action = nftStaked ? 'unstake' : 'stake';
    setWeb3Notice({
      type: 'info',
      text: t(
        nftStaked
          ? 'account_web3_approve_unstake'
          : 'account_web3_approve_stake',
      ),
    });
    try {
      const signer = await getSignerForSavedWallet();
      if (!signer || !mountedRef.current) return;
      const contract = new ethers.Contract(
        talentNftContractAddress,
        TALENT_NFT_ABI,
        signer,
      );
      const tx = await contract[action](tokenId);
      if (!mountedRef.current) return;
      setWeb3Notice({
        type: 'info',
        text: t(
          nftStaked ? 'account_web3_unstake_wait' : 'account_web3_stake_wait',
        ),
      });
      await tx.wait();
      if (!mountedRef.current) return;

      setNftStaked(newStakedStatus);
      await updateProfileOrThrow({
        nft_staked: newStakedStatus,
      });
      if (!mountedRef.current) return;
      setWeb3Notice({
        type: 'success',
        text: t(
          newStakedStatus
            ? 'account_web3_stake_success'
            : 'account_web3_unstake_success',
        ),
      });
    } catch (error: any) {
      if (mountedRef.current) {
        setWeb3Notice({
          type: 'error',
          text: getWeb3ActionErrorText(
            error,
            nftStaked
              ? 'account_web3_unstake_failed'
              : 'account_web3_stake_failed',
          ),
        });
      }
    } finally {
      if (mountedRef.current) setWeb3Busy(false);
    }
  };

  const handleClaimRewards = async () => {
    if (!walletAddress) {
      setWeb3Notice({ type: 'error', text: t('account_web3_connect_first') });
      return;
    }
    setWeb3Busy(true);
    if (web3PreviewMode) {
      setWeb3Notice({ type: 'info', text: t('account_web3_preview_notice') });
      setWeb3Busy(false);
      return;
    }
    setWeb3Notice({ type: 'info', text: t('account_web3_claim_approve') });
    try {
      const signer = await getSignerForSavedWallet();
      if (!signer || !mountedRef.current) return;
      const contract = new ethers.Contract(
        talentNftContractAddress,
        TALENT_NFT_ABI,
        signer,
      );

      const tx = await contract.claimRewards();
      if (!mountedRef.current) return;
      setWeb3Notice({ type: 'info', text: t('account_web3_claim_wait') });
      await tx.wait();
      if (!mountedRef.current) return;

      const rewards = await contract.getRewards(walletAddress);
      const newEarnings = parseFloat(ethers.formatEther(rewards));
      if (!mountedRef.current) return;
      setNftEarnings(newEarnings);

      await updateProfileOrThrow({
        nft_earnings: newEarnings,
      });
      if (!mountedRef.current) return;
      setWeb3Notice({ type: 'success', text: t('account_web3_claim_success') });
    } catch (error: any) {
      if (mountedRef.current) {
        setWeb3Notice({
          type: 'error',
          text: getWeb3ActionErrorText(error, 'account_web3_claim_failed'),
        });
      }
    } finally {
      if (mountedRef.current) setWeb3Busy(false);
    }
  };

  const web3ActionBusy = web3Busy || isSyncing;
  const hasWallet = Boolean(walletAddress);
  const walletExplorerUrl = getSepoliaAddressUrl(walletAddress);

  const openWeb3Confirm = (action: Web3ConfirmAction) => {
    if (web3ActionBusy) return;
    setWeb3ConfirmAction(action);
  };

  const closeWeb3Confirm = () => {
    if (!web3ActionBusy) setWeb3ConfirmAction(null);
  };

  const confirmWeb3Action = async () => {
    const action = web3ConfirmAction;
    if (!action || web3ActionBusy) return;

    setWeb3ConfirmAction(null);

    if (action === 'mint') {
      await handleMintNFT();
      return;
    }

    if (action === 'stake' || action === 'unstake') {
      await handleToggleStake();
      return;
    }

    await handleClaimRewards();
  };

  const hasCredential = Boolean(nftMinted);
  const web3NextStep = isSyncing
    ? t('account_web3_syncing')
    : !hasWallet
      ? t('account_web3_next_connect')
      : isWrongNetwork
        ? t('account_web3_next_switch')
        : hasCredential
          ? t('account_web3_next_active')
          : isEligibleForNFT
            ? t('account_web3_next_mint')
            : t('account_web3_next_improve');
  const web3StatusItems: Array<{
    id: 'wallet' | 'network' | 'credential';
    state: string;
    label: string;
    value: string;
    tone: 'done' | 'attention' | 'pending';
  }> = [
    {
      id: 'wallet',
      state: hasWallet ? 'connected' : 'disconnected',
      label: t('account_web3_status_wallet'),
      value: hasWallet
        ? t('account_web3_status_connected')
        : t('account_web3_status_not_connected'),
      tone: hasWallet ? 'done' : 'pending',
    },
    {
      id: 'network',
      state: !hasWallet ? 'waiting' : isWrongNetwork ? 'wrong-network' : 'ready',
      label: t('account_web3_status_network'),
      value: !hasWallet
        ? t('account_web3_status_waiting')
        : isWrongNetwork
          ? t('account_web3_status_wrong_network')
          : t('account_web3_status_ready'),
      tone: !hasWallet ? 'pending' : isWrongNetwork ? 'attention' : 'done',
    },
    {
      id: 'credential',
      state: hasCredential ? 'issued' : isEligibleForNFT ? 'eligible' : 'ineligible',
      label: t('account_web3_status_credential'),
      value: hasCredential
        ? t('account_web3_status_minted')
        : isEligibleForNFT
          ? t('account_web3_status_eligible')
          : t('account_web3_status_not_eligible'),
      tone: hasCredential ? 'done' : isEligibleForNFT ? 'attention' : 'pending',
    },
  ];
  const web3ToneClass = (tone: 'done' | 'attention' | 'pending') => {
    if (tone === 'done') {
      return 'border-green-200 bg-green-50 text-green-800 dark:border-green-800/50 dark:bg-green-900/20 dark:text-green-200';
    }
    if (tone === 'attention') {
      return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-200';
    }
    return 'border-gray-200 bg-gray-50 text-gray-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
  };
  const renderWeb3StatusIcon = (tone: 'done' | 'attention' | 'pending') => {
    if (tone === 'done') return <CheckCircle2 className="h-4 w-4" aria-hidden="true" />;
    if (tone === 'attention') return <AlertTriangle className="h-4 w-4" aria-hidden="true" />;
    return <CircleDot className="h-4 w-4" aria-hidden="true" />;
  };
  const web3IntroText = web3PreviewMode
    ? t('account_web3_optional_note')
    : hasWallet
      ? t('account_web3_desc_connected')
      : t('account_web3_desc_unconnected');
  const credentialEligibilityText = web3PreviewMode
    ? t('account_web3_preview_notice')
    : t('account_web3_nft_eligible_desc');
  const web3ConfirmTitle = web3ConfirmAction === 'mint'
    ? t('account_web3_nft_mint_button')
    : web3ConfirmAction === 'claim'
      ? t('account_web3_claim_rewards_button')
      : web3ConfirmAction === 'unstake'
        ? t('account_web3_approve_unstake')
        : t('account_web3_stake_label');
  const web3ConfirmDescription = web3PreviewMode
    ? t('account_web3_preview_notice')
    : web3ConfirmAction === 'claim'
      ? t('account_web3_claim_approve')
      : web3ConfirmAction === 'stake'
        ? t('account_web3_approve_stake')
        : web3ConfirmAction === 'unstake'
          ? t('account_web3_approve_unstake')
          : t('account_web3_approve_transaction');
  const web3ConfirmDialog = web3ConfirmAction ? (
    <ViewportAwareDialog
      open
      onClose={closeWeb3Confirm}
      closeOnBackdrop
      labelledBy="account-web3-confirm-title"
      maxWidth={448}
      zIndex={96}
    >
      <div className="rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h3 id="account-web3-confirm-title" className="text-lg font-bold text-gray-950 dark:text-gray-50">
              {web3ConfirmTitle}
            </h3>
            <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-slate-300">
              {web3ConfirmDescription}
            </p>
          </div>
        </div>
        <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-100">
          {t('account_web3_optional_note')}
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={closeWeb3Confirm}
            disabled={web3ActionBusy}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {t('action_cancel')}
          </button>
          <button
            type="button"
            onClick={confirmWeb3Action}
            disabled={web3ActionBusy}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {web3Busy ? '...' : t('ob_continue')}
          </button>
        </div>
      </div>
    </ViewportAwareDialog>
  ) : null;

  const labelClass = 'block text-xs font-semibold text-gray-600 dark:text-slate-300';
  const inputClass = 'mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-100';

  return (
    <div className="mx-auto max-w-4xl overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm animate-fade-in dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-4 dark:border-slate-700">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          {t('account_title')}
        </h1>
        <button
          type="button"
          onClick={onBack ?? (() => onSetView('home'))}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-950 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('account_back_button')}
        </button>
      </div>

      {/* Profile Details Form */}
      <form
        onSubmit={(e) => updateProfile(e, { fullName, avatarUrl, birthDate })}
        className="space-y-4 px-5 py-5"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
          {t('account_profile_details')}
        </h2>
        <AccountNoticeBanner notice={profileNotice} qa="account-profile-notice" />
        <div className="grid gap-5 lg:grid-cols-[120px_minmax(0,1fr)]">
        <Avatar
          url={avatarUrl}
          size={96}
          onUpload={async ({ url }) => {
            const ok = await updateProfile(null, { fullName, avatarUrl: url, birthDate });
            if (ok && mountedRef.current) setAvatarUrl(url);
            return ok;
          }}
          altText={t('ws_profile_avatar_alt')}
          uploadLabel={t('account_avatar_upload')}
          uploadingLabel={t('account_avatar_uploading')}
          selectImageMessage={t('account_avatar_select_required')}
          signInRequiredMessage={t('account_avatar_signin_required')}
          maxSizeMessage={t('account_avatar_size_error')}
          timeoutMessage={t('account_avatar_timeout_error')}
          uploadControlClassName="p-1.5"
          uploadIconClassName="h-4 w-4"
          showUploadLabel={false}
        />
        <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label
            htmlFor="email"
            className={labelClass}
          >
            {t('account_email_label')}
          </label>
          <input
            id="email"
            type="text"
            value={session.user.email || ''}
            disabled
            className={`${inputClass} bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400`}
          />
        </div>
        <div>
          <label
            htmlFor="fullName"
            className={labelClass}
          >
            {t('account_fullname_label')}
          </label>
          <input
            id="fullName"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            disabled={profileLoading || profileSaving}
            className={inputClass}
          />
        </div>
        <div>
          <label
            htmlFor="birthDate"
            className={labelClass}
          >
            {t('account_birth_date_label')}
          </label>
          <input
            id="birthDate"
            type="date"
            value={birthDate}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setBirthDate(e.target.value)}
            disabled={profileLoading || profileSaving}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{t('account_birth_date_hint')}</p>
        </div>
        <div className="flex items-end sm:col-span-2">
          <button
            type="submit"
            className="inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-800 disabled:bg-blue-400 sm:w-auto"
            disabled={profileLoading || profileSaving}
          >
            {profileSaving
              ? t('account_saving_button')
              : t('account_update_profile_button')}
          </button>
        </div>
        </div>
        </div>
      </form>

      {/* TEMP HIDDEN: API Access (user API keys) — config is superadmin-only
          via the Admin Console. Restore by uncommenting this block + the import.
      <div className="space-y-6 mt-10">
        <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300 border-b dark:border-slate-700 pb-2">
          {t('account_api_access_title')}
        </h2>
        <ApiKeyManager
          session={session}
          onViewDocs={() => onSetView('api_docs')}
        />
      </div>
      */}

      {/* TEMP HIDDEN: BYOA custom endpoint — not part of our model right now.
          Restore by uncommenting this line + the import.
      <BusinessCustomApi className="mt-10 max-w-md" t={t} />
      */}

      {/* Model routing is admin-controlled server-side.
            Non-business users see a muted info line. */}
      <ModelRoutingManagedNote t={t} />

      {/* Web3 Identity Section — experimental, feature-flagged */}
      {web3Enabled && (
        <div className="space-y-4 border-t border-gray-200 px-5 py-5 dark:border-slate-700">
          <div className="flex items-center gap-2 border-b dark:border-slate-700 pb-2">
            <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300">
              {t('account_web3_title')}
            </h2>
            <span className="inline-block rounded-full border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
              {t('account_web3_experimental_badge')}
            </span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 -mt-3">
            {t('account_web3_optional_note')}
          </p>
          {web3PreviewMode && (
            <div
              className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-200"
              role="note"
              data-qa="web3-preview-notice"
            >
              <span
                aria-hidden="true"
                className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-amber-300 text-[10px] font-bold"
              >
                i
              </span>
              <span>{t('account_web3_preview_notice')}</span>
            </div>
          )}
          <AccountNoticeBanner notice={web3Notice} qa="account-web3-notice" />
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/70 space-y-4">
            <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 gap-3">
                  <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200">
                    <WalletCards className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {web3IntroText}
                    </p>
                    {walletAddress && walletExplorerUrl ? (
                      <a
                        href={walletExplorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 block break-all font-mono text-xs text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {walletAddress}
                      </a>
                    ) : walletAddress ? (
                      <code
                        aria-label={t('account_web3_status_wallet')}
                        className="mt-2 block break-all font-mono text-xs text-gray-600 dark:text-slate-400"
                      >
                        {walletAddress}
                      </code>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  {!hasWallet ? (
                    <button
                      type="button"
                      onClick={handleConnectWallet}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-black disabled:bg-gray-400 sm:w-auto dark:bg-blue-600 dark:hover:bg-blue-500"
                      disabled={web3ActionBusy}
                    >
                      <WalletCards className="h-5 w-5" aria-hidden="true" />
                      {t('account_web3_connect_button')}
                    </button>
                  ) : isWrongNetwork ? (
                    <button
                      type="button"
                      onClick={handleSwitchNetwork}
                      disabled={web3ActionBusy}
                      className="inline-flex w-full items-center justify-center rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-amber-600 disabled:bg-amber-300 sm:w-auto"
                    >
                      {web3ActionBusy
                        ? t('account_web3_switching_button')
                        : t('account_web3_switch_network_button')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleDisconnectWallet}
                      className="inline-flex w-full items-center justify-center rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60 sm:w-auto dark:border-red-900/60 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950/30"
                      disabled={web3ActionBusy}
                    >
                      {web3ActionBusy ? '...' : t('account_web3_disconnect_button')}
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {web3StatusItems.map((item) => (
                  <div
                    key={item.id}
                    className={`rounded-xl border px-3 py-2 ${web3ToneClass(item.tone)}`}
                    data-qa={`web3-status-${item.id}`}
                    data-state={item.state}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wide opacity-75">
                        {item.label}
                      </span>
                      {renderWeb3StatusIcon(item.tone)}
                    </div>
                    <p className="mt-1 text-sm font-semibold">{item.value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-100">
                <span className="font-semibold">{t('account_web3_next_step_label')}:</span>{' '}
                {web3NextStep}
              </div>
            </div>

            {isEligibleForNFT &&
              !nftMinted &&
              !isWrongNetwork &&
              walletAddress && (
                <section
                  className="rounded-2xl border border-blue-200 bg-white p-4 shadow-sm animate-fade-in dark:border-blue-900/50 dark:bg-slate-900"
                  aria-labelledby="web3-credential-offer-title"
                  data-qa="web3-credential-offer"
                  data-state="eligible"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 gap-3 text-left">
                      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
                        <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <div>
                        <h3 id="web3-credential-offer-title" className="font-bold text-lg text-gray-950 dark:text-gray-100">
                          {t('account_web3_nft_eligible_title')}
                        </h3>
                        <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-slate-300">
                          {credentialEligibilityText}
                        </p>
                      </div>
                    </div>
                    <button type="button"
                      onClick={() => openWeb3Confirm('mint')}
                      disabled={web3ActionBusy}
                      data-qa="web3-credential-issue"
                      className="inline-flex shrink-0 items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:bg-blue-400"
                    >
                      {web3Busy
                        ? t('account_web3_nft_minting_button')
                        : t('account_web3_nft_mint_button')}
                    </button>
                  </div>
                </section>
              )}

            {nftMinted && !isWrongNetwork && walletAddress && (
              <section
                className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm animate-fade-in dark:border-emerald-900/50 dark:bg-slate-900"
                aria-labelledby="web3-credential-issued-title"
                data-qa="web3-credential-issued"
                data-state="issued"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 gap-3">
                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm">
                      <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
                        Proof-of-Talent
                      </p>
                      <h3 id="web3-credential-issued-title" className="mt-1 text-lg font-bold text-gray-950 dark:text-gray-100">
                        {t('account_web3_your_nft')}
                      </h3>
                      <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-slate-300">
                        {t('account_web3_verified_candidate')}
                        {fullName ? ` · ${fullName}` : ''}
                      </p>
                    </div>
                  </div>
                  <span className="inline-flex shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
                    ID #{tokenId}
                  </span>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                      {t('account_web3_status_credential')}
                    </p>
                    <p className="mt-1 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-200">
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      {t('account_web3_status_minted')}
                    </p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                      {t('account_web3_stake_label')}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {nftStaked
                        ? t('account_web3_status_ready')
                        : t('account_web3_status_waiting')}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-slate-700 dark:bg-slate-800/70 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <label
                      htmlFor="stake-toggle"
                      className="font-semibold text-gray-900 dark:text-gray-100"
                    >
                      {t('account_web3_stake_label')}
                    </label>
                    <p className="mt-1 text-xs leading-5 text-gray-600 dark:text-slate-300">
                      {web3PreviewMode
                        ? t('account_web3_preview_notice')
                        : t('account_web3_stake_desc')}
                    </p>
                  </div>
                  <button
                    id="stake-toggle"
                    type="button"
                    onClick={() => openWeb3Confirm(nftStaked ? 'unstake' : 'stake')}
                    disabled={web3ActionBusy}
                    aria-pressed={Boolean(nftStaked)}
                    className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 dark:focus:ring-offset-slate-900 ${nftStaked ? 'bg-blue-600' : 'bg-gray-300 dark:bg-slate-600'}`}
                  >
                    <span className="sr-only">{t('account_web3_stake_label')}</span>
                    <span
                      className={`inline-block h-6 w-6 transform rounded-full bg-white shadow-sm transition-transform ${nftStaked ? 'translate-x-7' : 'translate-x-1'}`}
                    />
                  </button>
                </div>

                {!web3PreviewMode && (
                  <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-center dark:border-green-900/50 dark:bg-green-950/20">
                    <h4 className="font-semibold text-gray-800 dark:text-gray-200">
                      {t('account_web3_earnings_title')}
                    </h4>
                    <p className="mt-1 text-3xl font-bold text-green-600 dark:text-green-400">
                      {(nftEarnings || 0).toFixed(4)} ETH
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {t('account_web3_earnings_desc')}
                    </p>
                    {nftEarnings && nftEarnings > 0 && (
                      <button
                        type="button"
                        onClick={() => openWeb3Confirm('claim')}
                        disabled={web3ActionBusy}
                        className="mt-2 rounded-full bg-green-100 px-3 py-1 text-sm font-semibold text-green-800 hover:bg-green-200 disabled:opacity-50"
                      >
                        {web3Busy
                          ? t('account_web3_claiming_button')
                          : t('account_web3_claim_rewards_button')}
                      </button>
                    )}
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      )}

      {web3ConfirmDialog}

      <form onSubmit={handleUpdatePassword} className="space-y-4 border-t border-gray-200 px-5 py-5 dark:border-slate-700">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
          {t('account_change_password')}
        </h2>
        <AccountNoticeBanner notice={passwordNotice} qa="account-password-notice" />
        <div className="grid max-w-xl gap-3">
        <div>
          <label
            htmlFor="newPassword"
            className={labelClass}
          >
            {t('account_new_password_label')}
          </label>
          <input
            id="newPassword"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            placeholder="••••••••"
          />
        </div>
        <div>
          <label
            htmlFor="confirmPassword"
            className={labelClass}
          >
            {t('account_confirm_password_label')}
          </label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={inputClass}
            placeholder="••••••••"
          />
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            className="inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-gray-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-gray-800 disabled:bg-gray-400 sm:w-auto"
            disabled={passwordSaving || !password}
          >
            {passwordSaving
              ? t('account_saving_button')
              : t('account_update_password_button')}
          </button>
        </div>
        </div>
      </form>

      {/* Subscription / plan management lives on the dedicated "Billing & Plan"
          page (sidebar) — removed here to avoid a redundant second entry point. */}
    </div>
  );
};

export default Account;
