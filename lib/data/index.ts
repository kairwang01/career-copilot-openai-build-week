// Single entry point for front-end data access. Components import `data` from here.
// To change backends, point this one binding at a different adapter.

import { isFirebaseConfigured } from '../firebaseClient';
import { firebaseDataClient } from './firebaseDataClient';
import { stubDataClient } from './stubDataClient';
import type { DataClient } from './DataClient';

export const data: DataClient = isFirebaseConfigured ? firebaseDataClient : stubDataClient;

export type {
  DataClient,
  DataResult,
  DataError,
  Subscription,
  AppSession,
  AppUser,
  AppAuthEvent,
  ApiKey,
  AuthApi,
  ProfilesApi,
  ApiKeysApi,
} from './DataClient';
