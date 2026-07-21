import { beforeEach, describe, expect, it } from 'vitest';
import * as admin from '../functions/node_modules/firebase-admin';
import {
  applyApiUsageSummaryForLog,
  apiPlatformCreateApplicationImpl,
  apiPlatformCreateKeyImpl,
  apiPlatformGetUsageImpl,
  apiPlatformListApplicationsImpl,
  apiPlatformListKeysImpl,
  apiPlatformListUsageLogsImpl,
  apiPlatformRevokeKeyImpl,
  apiPlatformUpdateKeyStatusImpl,
} from '../functions/src/handlers/apiPlatform';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-careercopilot';
const db = admin.firestore();

async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
}

beforeEach(clearFirestore);

describe('API Platform callables', () => {
  it('creates an application and writes an admin audit entry', async () => {
    const app = await apiPlatformCreateApplicationImpl('super1', {
      name: 'Partner portal',
      description: 'Server-to-server integration',
      environment: 'development',
    });

    expect(app).toMatchObject({
      name: 'Partner portal',
      environment: 'development',
      created_by: 'super1',
      key_count: 0,
    });

    const apps = await apiPlatformListApplicationsImpl('admin1');
    expect(apps).toHaveLength(1);
    expect(apps[0].id).toBe(app.id);

    const audit = await db.collection('admin_audit_log').where('action', '==', 'api_app_create').get();
    expect(audit.size).toBe(1);
    expect(audit.docs[0].data().details).toMatchObject({ app_id: app.id, environment: 'development' });
  });

  it('creates a key with one-time secret, stores only hash, and hides secrets from list/audit', async () => {
    const app = await apiPlatformCreateApplicationImpl('super1', {
      name: 'Production partner',
      description: '',
      environment: 'production',
    });

    const { key, secret } = await apiPlatformCreateKeyImpl('super1', {
      app_id: app.id,
      name: 'Backend key',
      scopes: ['jobs.read', 'usage.read'],
    });

    expect(secret).toMatch(/^cc_live_[a-f0-9]{48}$/);
    expect(key.prefix).toMatch(/^cc_live_[a-f0-9]{4}$/);
    expect(key.status).toBe('active');
    expect(key.scopes).toEqual(['jobs.read', 'usage.read']);
    expect(JSON.stringify(key)).not.toContain(secret);

    const stored = (await db.collection('api_keys').doc(key.id).get()).data()!;
    expect(stored.secret_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(secret);

    const listed = await apiPlatformListKeysImpl('admin1');
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain('secret_hash');
    expect(JSON.stringify(listed)).not.toContain(secret);

    const audit = await db.collection('admin_audit_log').where('action', '==', 'api_key_create').get();
    expect(JSON.stringify(audit.docs[0].data())).toContain(key.prefix);
    expect(JSON.stringify(audit.docs[0].data())).not.toContain(secret);
    expect(JSON.stringify(audit.docs[0].data())).not.toContain(stored.secret_hash);

    const apps = await apiPlatformListApplicationsImpl('admin1');
    expect(apps[0].key_count).toBe(1);
  });

  it('rejects unsupported scopes and revoked keys cannot be re-enabled', async () => {
    const app = await apiPlatformCreateApplicationImpl('super1', {
      name: 'Partner',
      description: '',
      environment: 'development',
    });

    await expect(apiPlatformCreateKeyImpl('super1', {
      app_id: app.id,
      name: 'Bad key',
      scopes: ['unknown.scope'],
    })).rejects.toThrow(/unsupported scope/i);

    const { key } = await apiPlatformCreateKeyImpl('super1', {
      app_id: app.id,
      name: 'Good key',
      scopes: ['jobs.read'],
    });
    await apiPlatformUpdateKeyStatusImpl('super1', { keyId: key.id, status: 'disabled' });
    expect((await apiPlatformListKeysImpl('admin1'))[0].status).toBe('disabled');

    await apiPlatformRevokeKeyImpl('super1', { keyId: key.id });
    await expect(apiPlatformUpdateKeyStatusImpl('super1', { keyId: key.id, status: 'active' })).rejects.toThrow(/revoked/i);
    expect((await apiPlatformListApplicationsImpl('admin1'))[0].key_count).toBe(0);
  });

  it('returns real usage summary and recent logs from api_usage_logs', async () => {
    const successLog = await db.collection('api_usage_logs').add({
      timestamp: admin.firestore.Timestamp.fromDate(new Date()),
      key_prefix: 'cc_dev_abcd',
      endpoint: '/v1/jobs',
      status: 200,
      latency_ms: 120,
    });
    const errorLog = await db.collection('api_usage_logs').add({
      timestamp: admin.firestore.Timestamp.fromDate(new Date()),
      key_prefix: 'cc_dev_abcd',
      endpoint: '/v1/resume/analyze',
      status: 429,
      latency_ms: 80,
    });
    await Promise.all([
      applyApiUsageSummaryForLog(successLog.id),
      applyApiUsageSummaryForLog(errorLog.id),
    ]);
    expect(await applyApiUsageSummaryForLog(errorLog.id)).toBe('already_applied');
    await db.collection('api_usage_summary_state').doc('rollout_v1').set({ summary_version: 1 });

    const summary = await apiPlatformGetUsageImpl('admin1');
    expect(summary.month_requests).toBe(2);
    expect(summary.month_errors).toBe(1);
    expect(summary.daily.reduce((sum, row) => sum + row.requests, 0)).toBe(2);

    const logs = await apiPlatformListUsageLogsImpl('admin1');
    expect(logs).toHaveLength(2);
    expect(logs.map((log) => log.endpoint).sort()).toEqual(['/v1/jobs', '/v1/resume/analyze']);
  });
});
