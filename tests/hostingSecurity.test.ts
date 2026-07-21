import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const rootPath = fileURLToPath(root);
const publicPath = join(rootPath, 'public');

const firebase = JSON.parse(readFileSync(new URL('firebase.json', root), 'utf8'));
const headers = firebase.hosting.headers[0].headers as Array<{ key: string; value: string }>;
const csp = headers.find((header) => header.key === 'Content-Security-Policy')?.value ?? '';
const scriptSrc = csp.split(';').find((directive: string) => directive.trim().startsWith('script-src')) ?? '';

function listHtmlFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return listHtmlFiles(path);
      return entry.isFile() && entry.name.toLowerCase().endsWith('.html') ? [path] : [];
    })
    .sort();
}

function attributeValue(attributes: string, name: string): string | null {
  const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function isExecutableScriptType(type: string | null): boolean {
  if (!type) return true;
  const essence = type.split(';', 1)[0].trim().toLowerCase();
  return essence === 'module' || essence === 'importmap' || essence === 'speculationrules' ||
    /(?:java|ecma)script$/.test(essence);
}

describe('production hosting security', () => {
  it('keeps production typography self-hosted under the font CSP', () => {
    const css = readFileSync(new URL('index.css', root), 'utf8');
    const fontSrc = csp.split(';').find((directive: string) => directive.trim().startsWith('font-src')) ?? '';

    expect(css).not.toMatch(/@import\s+url\(['"]?https?:\/\//i);
    expect(css).not.toMatch(/fonts\.(?:googleapis|gstatic)\.com/i);
    expect(fontSrc).toContain("'self'");
  });

  it('keeps the inline structured-data hash synchronized with the CSP', () => {
    const html = readFileSync(new URL('index.html', root), 'utf8');
    const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(match).not.toBeNull();
    const hash = `sha256-${createHash('sha256').update(match![1]).digest('base64')}`;

    expect(csp).toContain(`'${hash}'`);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it('does not reintroduce CDN import maps or inline executable boot code', () => {
    const html = readFileSync(new URL('index.html', root), 'utf8');
    expect(html).not.toContain('type="importmap"');
    expect(html).toContain('<script src="/theme-init.js"></script>');
  });

  it('rejects unapproved inline executable scripts in every public HTML file', () => {
    const violations = listHtmlFiles(publicPath).flatMap((path) => {
      const html = readFileSync(path, 'utf8');
      const scripts = html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi);
      return Array.from(scripts).flatMap((match, index) => {
        const attributes = match[1];
        const body = match[2];
        if (attributeValue(attributes, 'src') !== null || !isExecutableScriptType(attributeValue(attributes, 'type'))) {
          return [];
        }

        const nonce = attributeValue(attributes, 'nonce');
        const hash = `sha256-${createHash('sha256').update(body).digest('base64')}`;
        const approved =
          (nonce !== null && scriptSrc.includes(`'nonce-${nonce}'`)) ||
          scriptSrc.includes(`'${hash}'`);

        return approved ? [] : [`${relative(rootPath, path)} script #${index + 1}`];
      });
    });

    expect(violations).toEqual([]);
  });

  it('loads the privacy consent reset behavior from a same-origin script', () => {
    const privacy = readFileSync(new URL('public/privacy.html', root), 'utf8');
    const resetScript = readFileSync(new URL('public/privacy-consent-reset.js', root), 'utf8');
    const storageWrites: Array<[string, string]> = [];
    const status = { textContent: '' };
    let clickHandler: (() => void) | undefined;
    let cookie = '';

    expect(privacy).toContain('<script src="/privacy-consent-reset.js" defer></script>');
    runInNewContext(resetScript, {
      Date: { now: () => 1234 },
      document: {
        getElementById(id: string) {
          if (id === 'reset-consent') {
            return {
              addEventListener(event: string, handler: () => void) {
                if (event === 'click') clickHandler = handler;
              },
              getAttribute(name: string) {
                return name === 'data-reset-cookie'
                  ? 'cookie_consent=; path=/; max-age=0; SameSite=Lax'
                  : null;
              },
            };
          }
          return id === 'reset-consent-status' ? status : null;
        },
        set cookie(value: string) {
          cookie = value;
        },
      },
      localStorage: {
        setItem(key: string, value: string) {
          storageWrites.push([key, value]);
        },
      },
    });

    expect(clickHandler).toBeTypeOf('function');
    clickHandler?.();
    expect(cookie).toBe('cookie_consent=; path=/; max-age=0; SameSite=Lax');
    expect(storageWrites).toEqual([['career-copilot:consent-sync', '1234']]);
    expect(status.textContent).toContain('choice was reset');
  });
});
