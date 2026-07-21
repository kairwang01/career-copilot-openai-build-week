export type ConsentState = 'unknown' | 'accepted' | 'declined';
export type ConsentChoice = Exclude<ConsentState, 'unknown'>;

export const CONSENT_COOKIE = 'cookie_consent';
export const CONSENT_CHANGE_EVENT = 'career-copilot:consent-change';
export const CONSENT_SYNC_KEY = 'career-copilot:consent-sync';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function getConsentState(): ConsentState {
  if (typeof document === 'undefined') return 'unknown';
  try {
    const pair = document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${CONSENT_COOKIE}=`));
    const value = pair?.slice(CONSENT_COOKIE.length + 1);
    return value === 'accepted' || value === 'declined' ? value : 'unknown';
  } catch {
    return 'unknown';
  }
}

export function setConsentState(value: ConsentChoice): void {
  if (typeof document === 'undefined') return;
  try {
    const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${CONSENT_COOKIE}=${value}; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax${secure}`;
  } catch (error) {
    console.error('Could not save cookie consent preference:', error);
    return;
  }

  if (getConsentState() !== value || typeof window === 'undefined') return;
  window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
  try {
    window.localStorage?.setItem(CONSENT_SYNC_KEY, String(Date.now()));
  } catch {
    // The cookie remains the authority when cross-tab storage is unavailable.
  }
}

export function onConsentChange(listener: (state: ConsentState) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handleChange = () => listener(getConsentState());
  const handleStorage = (event: StorageEvent) => {
    if (event.key === CONSENT_SYNC_KEY) handleChange();
  };
  window.addEventListener(CONSENT_CHANGE_EVENT, handleChange);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(CONSENT_CHANGE_EVENT, handleChange);
    window.removeEventListener('storage', handleStorage);
  };
}
