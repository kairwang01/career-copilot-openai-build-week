/**
 * Console noise the runtime smokes treat as non-blocking. Every other console
 * error still fails the zero-console-error contracts.
 */

/**
 * Full-page navigations and reloads abort in-flight localization fetches; the
 * app logs that failure and falls back to English by design. A served-but-missing
 * translation file logs "Could not load <file>" instead and stays blocking.
 */
export function isAbortedTranslationFallbackError(message) {
  return (
    typeof message === 'string' &&
    message.startsWith('Error fetching translation file, falling back to English') &&
    message.includes('Failed to fetch')
  );
}

/**
 * Under CI load the Firestore web SDK occasionally loses its first stream
 * attempt against the emulator, logs this error, and reconnects on its own —
 * the smoke's functional assertions prove the recovery. Only the first-failure
 * message ("failed 1 times") is exempt; a persistent outage keeps counting up
 * and still blocks.
 */
export function isTransientFirestoreBackendRetry(message) {
  return (
    typeof message === 'string' &&
    message.includes('@firebase/firestore') &&
    message.includes('Could not reach Cloud Firestore backend. Connection failed 1 times')
  );
}

export function isNonBlockingSmokeConsoleError(message) {
  return isAbortedTranslationFallbackError(message) || isTransientFirestoreBackendRetry(message);
}
