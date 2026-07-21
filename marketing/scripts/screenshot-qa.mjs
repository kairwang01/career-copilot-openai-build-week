/**
 * Public-site screenshot QA — desktop + mobile viewports.
 *
 * Hardened so a stale MVP dev server cannot produce false-green results:
 *  - Reserves a free port and starts the current default Vite UI with --strictPort.
 *  - Fails if a marketing route does not render its stable legacy QA marker.
 *  - Fails if a marketing route exposes the wrong data-beta-page id.
 *  - Fails if forbidden stale marketing strings leak into current routes.
 *  - Confirms /workspace stays isolated from the marketing shell.
 *
 * Usage:
 *   npm run marketing:qa              # starts its own dev server on a free port
 *   QA_SKIP_DEV=1 QA_BASE_URL=...   # inspect an explicit already-running candidate
 */
import { mkdir, writeFile } from 'fs/promises';
import { spawn } from 'child_process';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '../..');
const outDir = path.join(__dirname, '../qa-screenshots');

const viewports = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
];

/** Marketing routes carry a stable legacy data-beta-page id; app routes intentionally do not. */
const marketingRoutes = [
  { route: '/', pageId: 'jobseeker-home' },
  { route: '/employers', pageId: 'employer-landing' },
  { route: '/sample-report', pageId: 'sample-report' },
  { route: '/pricing', pageId: 'pricing' },
];
const appRoutes = [
  { route: '/workspace', expectAppShell: true },
  { route: '/portal', expectAppShell: true },
];

/** Stale strings that must never appear on current public routes. */
const FORBIDDEN_MARKETING_STRINGS = [
  'Go Beyond the Resume',
  'Beta 预览版。功能和数据可能会在正式发布前调整。',
  '渥太华大学 · ELG 5902',
];

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, attempts = 40, getStartupError = () => null) {
  for (let i = 0; i < attempts; i++) {
    const startupError = getStartupError();
    if (startupError) throw startupError;
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server not ready at ${url}`);
}

async function main() {
  const skipDev = process.env.QA_SKIP_DEV === '1';
  let dev = null;
  let base;

  if (skipDev) {
    base = process.env.QA_BASE_URL || 'http://localhost:3000';
    await waitForServer(base);
  } else {
    const port = Number(process.env.QA_PORT) || (await getFreePort());
    base = `http://localhost:${port}`;
    const viteEntrypoint = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
    let startupError = null;
    dev = spawn(process.execPath, [viteEntrypoint, '--port', String(port), '--strictPort'], {
      cwd: projectRoot,
      env: { ...process.env },
      shell: false,
      stdio: 'pipe',
    });
    dev.once('error', (error) => {
      startupError = error;
    });
    dev.stderr?.on('data', (d) => process.stderr.write(`[vite] ${d}`));
    await waitForServer(base, 40, () => startupError);
  }

  const { chromium } = await import('playwright');
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();

  const results = [];
  const failures = [];

  for (const vp of viewports) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();

    for (const target of [...marketingRoutes, ...appRoutes]) {
      const { route } = target;
      const slug = route === '/' ? 'home' : route.replace(/^\//, '').replace(/\//g, '-');
      const file = path.join(outDir, `${slug}-${vp.name}.png`);
      const checks = [];
      let ok = true;

      const fail = (msg) => {
        ok = false;
        failures.push(`${route} @ ${vp.name}: ${msg}`);
        checks.push(`FAIL ${msg}`);
      };

      try {
        await page.goto(`${base}${route}`, { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForTimeout(500);

        const hasMarketingMarker = (await page.locator('[data-beta-app="true"]').count()) > 0;

        if (target.expectAppShell) {
          if (hasMarketingMarker) fail(`Marketing marker present on ${route} (app route isolation broken)`);
          else checks.push('OK app shell route (no marketing marker)');
        } else {
          if (!hasMarketingMarker) {
            fail('missing marketing QA marker (wrong or stale server?)');
          } else {
            const pageId = await page.locator('[data-beta-app="true"]').first().getAttribute('data-beta-page');
            if (pageId !== target.pageId) fail(`data-beta-page="${pageId}" != "${target.pageId}"`);
            else checks.push(`OK data-beta-page=${pageId}`);
          }

          const bodyText = await page.evaluate(() => document.body.innerText);
          for (const forbidden of FORBIDDEN_MARKETING_STRINGS) {
            if (bodyText.includes(forbidden)) fail(`forbidden stale string present: "${forbidden}"`);
          }
          if (ok) checks.push('OK no forbidden stale strings');
        }

        const overflow = await page.evaluate(() => ({
          sw: document.documentElement.scrollWidth,
          cw: document.documentElement.clientWidth,
        }));
        if (overflow.sw > overflow.cw + 2) {
          fail(`horizontal overflow (${overflow.sw}px > ${overflow.cw}px)`);
        } else {
          checks.push('OK no horizontal overflow');
        }

        if (target.expectAppShell && route === '/workspace') {
          const cookieOverlap = await page.evaluate(() => {
            const cookie = document.querySelector('[data-qa="cookie-consent-banner"]')?.getBoundingClientRect();
            if (!cookie) return { maxArea: 0, label: 'no banner' };
            const viewport = { width: window.innerWidth, height: window.innerHeight };
            const controls = [...document.querySelectorAll('#upload-section button, #upload-section textarea, #upload-section select')]
              .filter((element) => {
                const rect = element.getBoundingClientRect();
                const style = window.getComputedStyle(element);
                return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < viewport.height;
              })
              .map((element) => {
                const rect = element.getBoundingClientRect();
                const width = Math.max(0, Math.min(cookie.right, rect.right) - Math.max(cookie.left, rect.left));
                const height = Math.max(0, Math.min(cookie.bottom, rect.bottom) - Math.max(cookie.top, rect.top));
                return {
                  area: Math.round(width * height),
                  label: element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 48) || element.tagName.toLowerCase(),
                };
              })
              .sort((a, b) => b.area - a.area);
            return controls[0] ?? { maxArea: 0, label: 'no visible controls' };
          });
          if (cookieOverlap.maxArea > 0 || cookieOverlap.area > 0) {
            fail(`cookie banner overlaps upload control: ${cookieOverlap.label}`);
          } else {
            checks.push('OK cookie banner avoids upload controls');
          }
        }

        await page.screenshot({ path: file, fullPage: true });
      } catch (err) {
        fail(err.message);
      }

      results.push({ route, viewport: vp.name, ok, checks });
      console.log(`${ok ? '✓' : '✗'} ${route} @ ${vp.name}`);
      checks.forEach((c) => console.log(`    ${c}`));
    }

    await context.close();
  }

  // Locale smoke test: switch to zh, confirm translated copy renders and no raw beta_ keys leak.
  const localeChecks = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(`${base}/`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.evaluate(() => localStorage.setItem('preferred_language', 'zh'));
    await page.goto(`${base}/`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(800);
    const bodyText = await page.evaluate(() => document.body.innerText);

    if (bodyText.includes('上传简历')) localeChecks.push('OK zh hero copy rendered');
    else {
      localeChecks.push('FAIL zh hero copy missing');
      failures.push('locale zh: expected translated hero copy not found');
    }

    const rawKeyLeak = /\bsite_[a-z0-9_]+\b/.test(bodyText);
    if (rawKeyLeak) {
      localeChecks.push('FAIL raw site_ key leaked in zh render');
      failures.push('locale zh: raw site_* key visible (missing translation)');
    } else {
      localeChecks.push('OK no raw site_ keys in zh render');
    }
    await ctx.close();
  } catch (err) {
    localeChecks.push(`FAIL ${err.message}`);
    failures.push(`locale zh: ${err.message}`);
  }
  console.log(`\nLocale smoke (zh):`);
  localeChecks.forEach((c) => console.log(`    ${c}`));

  await browser.close();
  if (dev) dev.kill('SIGTERM');

  const lines = results.map(
    (r) => `### \`${r.route}\` @ ${r.viewport} — ${r.ok ? 'PASS' : 'FAIL'}\n${r.checks.map((c) => `- ${c}`).join('\n')}`,
  );
  const report = `# Public-site screenshot QA

Generated: ${new Date().toISOString()}
Server: ${base} (${skipDev ? 'explicit reused candidate' : 'isolated Vite process'})

## Summary

- Routes checked: ${marketingRoutes.length} marketing + ${appRoutes.length} app shell
- Viewports: ${viewports.map((v) => `${v.name} ${v.width}x${v.height}`).join(', ')}
- Result: ${failures.length === 0 ? 'ALL PASS' : `${failures.length} failure(s)`}

## Assertions per route

- stable legacy data-beta-app marker present (marketing routes) / absent (app routes)
- data-beta-page matches expected id
- no forbidden stale strings: ${FORBIDDEN_MARKETING_STRINGS.map((s) => `"${s}"`).join(', ')}
- no horizontal overflow

## Results

${lines.join('\n\n')}

## Locale smoke (zh)

${localeChecks.map((c) => `- ${c}`).join('\n')}

${failures.length ? `## Failures\n\n${failures.map((f) => `- ${f}`).join('\n')}` : '## Failures\n\nNone.'}
`;

  await writeFile(path.join(outDir, 'QA-REPORT.md'), report);
  console.log(`\nReport: ${path.join(outDir, 'QA-REPORT.md')}`);

  if (failures.length) {
    console.error(`\n${failures.length} QA failure(s).`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
