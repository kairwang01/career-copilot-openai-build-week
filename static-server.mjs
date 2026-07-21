// Minimal zero-dependency static file server with SPA fallback.
// Serves STATIC_ROOT (or ./dist) on 127.0.0.1:PORT for the VM runtime and
// release-artifact browser checks.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT) || 9050;
const HOST = process.env.HOST || '127.0.0.1';
const APP_ROOT = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(APP_ROOT, process.env.STATIC_ROOT || 'dist');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

const firebaseConfig = JSON.parse(await readFile(join(APP_ROOT, 'firebase.json'), 'utf8'));
const sharedHeaderRule = firebaseConfig.hosting?.headers?.find((rule) => rule.source === '**');
if (!sharedHeaderRule?.headers?.length) {
  throw new Error('firebase.json must define the shared hosting security headers.');
}
const SECURITY_HEADERS = Object.fromEntries(
  sharedHeaderRule.headers.map(({ key, value }) => [key.toLowerCase(), value]),
);

async function tryFile(p) {
  try {
    const s = await stat(p);
    if (s.isFile()) return p;
  } catch {}
  return null;
}

const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...SECURITY_HEADERS, allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' });
      res.end('405 Method Not Allowed');
      return;
    }

    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    // Prevent path traversal: normalize and strip leading slashes.
    const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '');
    let filePath = join(ROOT, safe);
    const relativeTarget = relative(ROOT, filePath);
    if (relativeTarget.startsWith('..') || isAbsolute(relativeTarget)) filePath = ROOT;

    let resolved = await tryFile(filePath);
    if (!resolved && (urlPath === '/' || urlPath.endsWith('/'))) {
      resolved = await tryFile(join(filePath, 'index.html'));
    }
    // SPA fallback: any unmatched, non-asset route serves index.html.
    if (!resolved && !extname(safe)) {
      resolved = await tryFile(join(ROOT, 'index.html'));
    }
    if (!resolved) {
      res.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    const body = await readFile(resolved);
    const type = TYPES[extname(resolved).toLowerCase()] || 'application/octet-stream';
    const relativePath = relative(ROOT, resolved);
    const cache = relativePath.split(sep).includes('assets')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache';
    res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': type, 'cache-control': cache });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (err) {
    res.writeHead(500, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' });
    res.end('500 Internal Server Error');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`uottawa-copilot static server on http://${HOST}:${PORT} (root: ${ROOT})`);
});
