import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as admin from '../functions/node_modules/firebase-admin';

if (!admin.apps.length) {
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  admin.initializeApp({ projectId: 'demo-careercopilot' });
}
const db = admin.firestore();

describe('getAppBaseUrl — platform_config/app resolution', () => {
  let saved: string | undefined;
  beforeEach(() => { saved = process.env.APP_BASE_URL; delete process.env.APP_BASE_URL; });
  afterEach(async () => {
    if (saved === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = saved;
    await db.collection('platform_config').doc('app').delete().catch(() => {});
  });

  it('returns the Firestore value when present', async () => {
    const { getAppBaseUrl, refreshPlatformCaches } = await import('../functions/src/admin/platformConfig');
    await db.collection('platform_config').doc('app').set({ app_base_url: 'https://copilot.kairwang.cloud' });
    await refreshPlatformCaches();
    expect(getAppBaseUrl()).toBe('https://copilot.kairwang.cloud');
  });

  it('returns undefined when the doc/field is absent (env fallback handled by caller)', async () => {
    const { getAppBaseUrl, refreshPlatformCaches } = await import('../functions/src/admin/platformConfig');
    await db.collection('platform_config').doc('app').delete().catch(() => {});
    await refreshPlatformCaches();
    expect(getAppBaseUrl()).toBeUndefined();
  });
});
