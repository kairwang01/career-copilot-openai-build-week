import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);

describe('environment-file source control safety', () => {
  it('ignores real root and Functions env files while retaining templates', () => {
    const cwd = decodeURIComponent(root.pathname).replace(/^\/(?:([A-Za-z]:))/, '$1');
    const ignored = execFileSync('git', ['check-ignore', '--no-index', '.env', 'functions/.env'], {
      cwd,
      encoding: 'utf8',
    });
    expect(ignored).toContain('.env');
    expect(ignored).toContain('functions/.env');

    const gitignore = readFileSync(new URL('.gitignore', root), 'utf8');
    expect(gitignore).toContain('!.env.example');
    expect(gitignore).toContain('!functions/.env.example');
  });

  it('keeps the checked-in project env file limited to non-secret switches', () => {
    const text = readFileSync(new URL('functions/.env.demo-careercopilot', root), 'utf8');
    const keys = text
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trim().startsWith('#'))
      .map((line) => line.split('=', 1)[0]);
    expect(keys.sort()).toEqual(['APP_BASE_URL', 'BILLING_SIMULATION']);
  });

  it('fails closed for simulation, test-mode, placeholder, and escaped Stripe config', () => {
    const cwd = decodeURIComponent(root.pathname).replace(/^\/(?:([A-Za-z]:))/, '$1');
    const relativeEnv = `functions/.stripe-release-test-${process.pid}.env`;
    const envPath = resolve(cwd, relativeEnv);
    const script = resolve(cwd, 'scripts/check-stripe-env.mjs');
    const cleanEnv = { ...process.env };
    for (const key of [
      'APP_BASE_URL',
      'BILLING_SIMULATION',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'STRIPE_PRICE_ESSENTIALS',
      'STRIPE_PRICE_ACCELERATOR',
      'STRIPE_PRICE_EXECUTIVE',
      'STRIPE_PRICE_STARTER',
      'STRIPE_PRICE_GROWTH',
      'STRIPE_PRICE_PRO',
      'STRIPE_PRICE_PACK_100',
      'STRIPE_PRICE_PACK_500',
      'STRIPE_PRICE_PACK_1000',
    ]) {
      delete cleanEnv[key];
    }
    const base = [
      'APP_BASE_URL=https://copilot.kairwang.cloud',
      'BILLING_SIMULATION=false',
      'STRIPE_PRICE_ESSENTIALS=price_Essentials123456',
      'STRIPE_PRICE_ACCELERATOR=price_Accelerator12345',
      'STRIPE_PRICE_EXECUTIVE=price_Executive1234567',
      'STRIPE_PRICE_STARTER=price_Starter123456789',
      'STRIPE_PRICE_GROWTH=price_Growth1234567890',
      'STRIPE_PRICE_PRO=price_Pro1234567890123',
      'STRIPE_PRICE_PACK_100=price_Pack100123456789',
      'STRIPE_PRICE_PACK_500=price_Pack500123456789',
      'STRIPE_PRICE_PACK_1000=price_Pack100012345678',
    ];

    try {
      writeFileSync(envPath, `${base.join('\n')}\n`, 'utf8');
      const accepted = spawnSync(
        process.execPath,
        [script, '--production', `--config-file=${relativeEnv}`],
        { cwd, encoding: 'utf8', env: cleanEnv },
      );
      expect(accepted.status).toBe(0);

      writeFileSync(
        envPath,
        `${base
          .map((line) =>
            line.startsWith('APP_BASE_URL=')
              ? 'APP_BASE_URL=https://wrong.example.edu/path?next=1'
              : line,
          )
          .join('\n')}\n`,
        'utf8',
      );
      const wrongOrigin = spawnSync(
        process.execPath,
        [script, '--production', `--config-file=${relativeEnv}`],
        { cwd, encoding: 'utf8', env: cleanEnv },
      );
      expect(wrongOrigin.status).toBe(1);
      expect(wrongOrigin.stderr).toContain('must equal the canonical SITE_ORIGIN');

      writeFileSync(
        envPath,
        `${base
          .map((line) =>
            line === 'BILLING_SIMULATION=false'
              ? 'BILLING_SIMULATION=true'
              : line,
          )
          .join('\n')}\n`,
        'utf8',
      );
      const simulated = spawnSync(
        process.execPath,
        [script, '--production', `--config-file=${relativeEnv}`],
        { cwd, encoding: 'utf8', env: cleanEnv },
      );
      expect(simulated.status).toBe(1);
      expect(simulated.stderr).toContain('real Stripe Checkout is bypassed');

      writeFileSync(
        envPath,
        `${[...base, 'STRIPE_SECRET_KEY=sk_live_ContractValue123456789'].join('\n')}\n`,
        'utf8',
      );
      const duplicatedSecret = spawnSync(
        process.execPath,
        [script, '--production', `--config-file=${relativeEnv}`],
        { cwd, encoding: 'utf8', env: cleanEnv },
      );
      expect(duplicatedSecret.status).toBe(1);
      expect(duplicatedSecret.stderr).toContain('must stay in Secret Manager');

      writeFileSync(envPath, `${base.join('\n')}\n`, 'utf8');
      const testMode = spawnSync(
        process.execPath,
        [script, '--production', `--config-file=${relativeEnv}`],
        {
          cwd,
          encoding: 'utf8',
          env: {
            ...cleanEnv,
            STRIPE_SECRET_KEY: 'sk_test_ContractValue123456789',
          },
        },
      );
      expect(testMode.status).toBe(1);
      expect(testMode.stderr).toContain('live-mode key');

      writeFileSync(
        envPath,
        `${base
          .map((line) =>
            line.startsWith('STRIPE_PRICE_PRO=')
              ? 'STRIPE_PRICE_PRO=price_replace_me'
              : line,
          )
          .join('\n')}\n`,
        'utf8',
      );
      const placeholder = spawnSync(
        process.execPath,
        [script, '--production', `--config-file=${relativeEnv}`],
        { cwd, encoding: 'utf8', env: cleanEnv },
      );
      expect(placeholder.status).toBe(1);
      expect(placeholder.stderr).toContain('still contains a placeholder value');

      const escaped = spawnSync(
        process.execPath,
        [script, '--production', '--config-file=../outside.env'],
        { cwd, encoding: 'utf8', env: cleanEnv },
      );
      expect(escaped.status).toBe(1);
      expect(escaped.stderr).toContain('must stay within functions/');
    } finally {
      rmSync(envPath, { force: true });
    }
  });
});
