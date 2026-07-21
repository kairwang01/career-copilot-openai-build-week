import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const missingFirebaseConfig = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

/** False when any VITE_FIREBASE_* var is unset — marketing can still render via stubDataClient. */
export const isFirebaseConfigured = missingFirebaseConfig.length === 0;

export const missingFirebaseConfigKeys = missingFirebaseConfig;

export let app!: ReturnType<typeof initializeApp>;
export let firebaseAuth!: ReturnType<typeof getAuth>;
export let firestoreDb!: ReturnType<typeof getFirestore>;
export let firebaseStorage!: ReturnType<typeof getStorage>;
export let firebaseFunctions!: ReturnType<typeof getFunctions>;

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);
  firebaseAuth = getAuth(app);
  firestoreDb = getFirestore(app);
  firebaseStorage = getStorage(app);
  firebaseFunctions = getFunctions(
    app,
    import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || 'us-central1',
  );
} else if (import.meta.env.DEV) {
  console.warn(
    '[Career CoPilot] Missing Firebase config (%s). Public marketing pages will render in logged-out mode; auth and data features need .env.local.',
    missingFirebaseConfig.join(', '),
  );
}

declare global {
  // Vite HMR can re-run this module in dev; Firebase only allows each emulator
  // connection to be registered once per app instance.
  // eslint-disable-next-line no-var
  var __careerCopilotFirebaseEmulatorsConnected: boolean | undefined;
}

if (
  isFirebaseConfigured &&
  import.meta.env.VITE_FIREBASE_USE_EMULATOR === 'true' &&
  !globalThis.__careerCopilotFirebaseEmulatorsConnected
) {
  connectAuthEmulator(
    firebaseAuth,
    import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL || 'http://127.0.0.1:9199',
    { disableWarnings: true },
  );
  connectFirestoreEmulator(
    firestoreDb,
    import.meta.env.VITE_FIRESTORE_EMULATOR_HOST || '127.0.0.1',
    Number(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT || 8080),
  );
  connectFunctionsEmulator(
    firebaseFunctions,
    import.meta.env.VITE_FIREBASE_FUNCTIONS_EMULATOR_HOST || '127.0.0.1',
    Number(import.meta.env.VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT || 5001),
  );
  connectStorageEmulator(
    firebaseStorage,
    import.meta.env.VITE_FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1',
    Number(import.meta.env.VITE_FIREBASE_STORAGE_EMULATOR_PORT || 9197),
  );
  globalThis.__careerCopilotFirebaseEmulatorsConnected = true;
}
