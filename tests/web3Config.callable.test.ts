import { beforeEach, describe, expect, it } from 'vitest';
import * as admin from '../functions/node_modules/firebase-admin';
import {
  getWeb3ConfigImpl,
  updateWeb3ConfigImpl,
} from '../functions/src/handlers/web3Config';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-careercopilot';
const db = admin.firestore();

async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
}

beforeEach(clearFirestore);

describe('Web3 platform config', () => {
  it('defaults to disabled and returns only non-sensitive testnet metadata', async () => {
    const cfg = await getWeb3ConfigImpl();
    expect(cfg).toMatchObject({
      enabled: false,
      preview_mode: true,
      network: 'sepolia',
      chain_id: 11155111,
      contract_address: '0x2A3b1A43842238321a22542a035921A362358189',
      updated_at: null,
      updated_by: null,
    });
  });

  it('updates the platform-wide runtime config and writes an admin audit event', async () => {
    const liveAddress = '0x1111111111111111111111111111111111111111';
    const cfg = await updateWeb3ConfigImpl('super-web3', {
      enabled: true,
      preview_mode: false,
      contract_address: liveAddress,
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.preview_mode).toBe(false);
    expect(cfg.contract_address).toBe(liveAddress);
    expect(cfg.updated_by).toBe('super-web3');

    const stored = (await db.collection('platform_config').doc('web3').get()).data()!;
    expect(stored.enabled).toBe(true);
    expect(stored.preview_mode).toBe(false);
    expect(stored.contract_address).toBe(liveAddress);
    expect(stored.network).toBe('sepolia');
    expect(stored.updated_by).toBe('super-web3');

    const readBack = await getWeb3ConfigImpl();
    expect(readBack.enabled).toBe(true);
    expect(readBack.preview_mode).toBe(false);
    expect(readBack.contract_address).toBe(liveAddress);
    expect(readBack.updated_by).toBe('super-web3');

    const audit = await db.collection('admin_audit_log').where('action', '==', 'update_web3_config').get();
    expect(audit.size).toBe(1);
    expect(audit.docs[0].data().details).toMatchObject({
      enabled: true,
      preview_mode: false,
      contract_address: liveAddress,
      network: 'sepolia',
      chain_id: 11155111,
    });
  });

  it('rejects non-boolean enabled values', async () => {
    await expect(updateWeb3ConfigImpl('super-web3', { enabled: 'true' })).rejects.toThrow(/boolean/i);
  });

  it('preserves runtime settings when only the enabled flag changes', async () => {
    const liveAddress = '0x2222222222222222222222222222222222222222';
    await updateWeb3ConfigImpl('super-web3', {
      enabled: true,
      preview_mode: false,
      contract_address: liveAddress,
    });

    const toggled = await updateWeb3ConfigImpl('super-web3', { enabled: false });

    expect(toggled.enabled).toBe(false);
    expect(toggled.preview_mode).toBe(false);
    expect(toggled.contract_address).toBe(liveAddress);
  });

  it('rejects malformed runtime settings', async () => {
    await expect(updateWeb3ConfigImpl('super-web3', { enabled: true, preview_mode: 'yes' })).rejects.toThrow(/preview_mode/i);
    await expect(updateWeb3ConfigImpl('super-web3', { enabled: true, contract_address: '0x123' })).rejects.toThrow(/contract_address/i);
  });
});
