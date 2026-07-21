import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');

describe('API documentation mirror', () => {
  it('matches the canonical source byte-for-byte', () => {
    const canonical = fs.readFileSync(path.join(root, 'docs/api.md'), 'utf8');
    const publicCopy = fs.readFileSync(path.join(root, 'public/docs/api.md'), 'utf8');
    expect(publicCopy).toBe(canonical);
  });

  it('is enforced by the prebuild gate', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.prebuild).toContain('sync-api-docs.mjs --check');
    expect(() => execFileSync(process.execPath, ['scripts/sync-api-docs.mjs', '--check'], {
      cwd: root,
      stdio: 'pipe',
    })).not.toThrow();
  });
});
