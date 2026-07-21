import { beforeEach, describe, expect, it } from 'vitest';
import * as admin from '../functions/node_modules/firebase-admin';
import { adminAdjustCreditsImpl } from '../functions/src/handlers/adminPortal';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-careercopilot';
const db = admin.firestore();

async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, {
    method: 'DELETE',
  });
}

const utcDayKey = () => {
  const now = new Date();
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
};

beforeEach(clearFirestore);

describe('adminAdjustCredits atomic accounting', () => {
  it('updates the balance, operator cap, ledger, and audit log together', async () => {
    await db.collection('users').doc('candidate').set({ credits: 100 });

    await expect(
      adminAdjustCreditsImpl('operator', 'admin', 'candidate', 25, 'Customer support correction'),
    ).resolves.toEqual({ uid: 'candidate', credits: 125 });

    const [user, daily, ledger, audit] = await Promise.all([
      db.collection('users').doc('candidate').get(),
      db.collection('admin_daily_totals').doc(`operator_${utcDayKey()}`).get(),
      db.collection('credit_ledger').get(),
      db.collection('admin_audit_log').get(),
    ]);
    expect(user.get('credits')).toBe(125);
    expect(daily.get('total')).toBe(25);
    expect(ledger.docs[0]?.data()).toMatchObject({
      uid: 'candidate', amount: 25, balance_after: 125, admin_uid: 'operator',
    });
    expect(audit.docs[0]?.data()).toMatchObject({
      action: 'adjust_credits', target_uid: 'candidate', admin_uid: 'operator',
    });
  });

  it('does not consume the daily cap or write audit records when the balance would be negative', async () => {
    await db.collection('users').doc('candidate').set({ credits: 10 });

    await expect(
      adminAdjustCreditsImpl('operator', 'admin', 'candidate', -11, 'Reverse an invalid grant'),
    ).rejects.toThrow(/negative/i);

    const [user, daily, ledger, audit] = await Promise.all([
      db.collection('users').doc('candidate').get(),
      db.collection('admin_daily_totals').doc(`operator_${utcDayKey()}`).get(),
      db.collection('credit_ledger').get(),
      db.collection('admin_audit_log').get(),
    ]);
    expect(user.get('credits')).toBe(10);
    expect(daily.exists).toBe(false);
    expect(ledger.empty).toBe(true);
    expect(audit.empty).toBe(true);
  });

  it('rejects fractional credits and daily-cap overflow without partial writes', async () => {
    await db.collection('users').doc('candidate').set({ credits: 100 });
    await expect(
      adminAdjustCreditsImpl('operator', 'admin', 'candidate', 1.5, 'Fractional adjustment request'),
    ).rejects.toThrow(/integer/i);

    await db.collection('admin_daily_totals').doc(`operator_${utcDayKey()}`).set({
      total: 19_999,
      operator_uid: 'operator',
      date: utcDayKey(),
    });
    await expect(
      adminAdjustCreditsImpl('operator', 'admin', 'candidate', 2, 'Daily limit boundary test'),
    ).rejects.toThrow(/cap exceeded/i);

    expect((await db.collection('users').doc('candidate').get()).get('credits')).toBe(100);
    expect((await db.collection('admin_daily_totals').doc(`operator_${utcDayKey()}`).get()).get('total')).toBe(19_999);
    expect((await db.collection('credit_ledger').get()).empty).toBe(true);
    expect((await db.collection('admin_audit_log').get()).empty).toBe(true);
  });

  it('serializes concurrent adjustments without losing credits or audit entries', async () => {
    await db.collection('users').doc('candidate').set({ credits: 100 });

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        adminAdjustCreditsImpl('operator', 'admin', 'candidate', 1, `Concurrent support correction ${index}`),
      ),
    );

    expect((await db.collection('users').doc('candidate').get()).get('credits')).toBe(108);
    expect((await db.collection('admin_daily_totals').doc(`operator_${utcDayKey()}`).get()).get('total')).toBe(8);
    expect((await db.collection('credit_ledger').get()).size).toBe(8);
    expect((await db.collection('admin_audit_log').get()).size).toBe(8);
  });
});
