import { expect, test } from '@playwright/test';

const ROUTES = [
  '/',
  '/pricing',
  '/employers',
  '/sample-report',
  '/workspace?auth=signin',
  '/privacy.html',
] as const;

const MARKETING_PAGE_BY_ROUTE: Partial<Record<(typeof ROUTES)[number], string>> = {
  '/': 'jobseeker-home',
  '/pricing': 'pricing',
  '/employers': 'employer-landing',
  '/sample-report': 'sample-report',
};

const FORBIDDEN_PUBLIC_COPY = [
  'Beta 预览版。功能和数据可能会在正式发布前调整。',
  '渥太华大学 · ELG 5902 — 王凯尔、许敬轩、张晓艺、毕骄阳、赵翔、杨晓燕',
] as const;
const ARTIFACT_ORIGIN = `http://127.0.0.1:${process.env.E2E_ARTIFACT_PORT || '5180'}`;

for (const route of ROUTES) {
  test(`${route} loads from the sealed artifact without runtime or layout failures`, async ({
    page,
  }) => {
    const runtimeErrors: string[] = [];
    const failedResources: string[] = [];

    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') runtimeErrors.push(message.text());
    });
    page.on('requestfailed', (request) => {
      const url = new URL(request.url());
      if (url.origin === ARTIFACT_ORIGIN) {
        failedResources.push(`${request.method()} ${url.pathname}`);
      }
    });
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (url.origin === ARTIFACT_ORIGIN && response.status() >= 400) {
        failedResources.push(`${response.status()} ${url.pathname}`);
      }
    });

    const response = await page.goto(route, { waitUntil: 'networkidle' });
    expect(response?.ok()).toBe(true);
    await expect(page.locator('body')).toBeVisible();

    if (route === '/privacy.html') {
      await expect(page.locator('h1')).toContainText('Privacy & Cookie Policy');
    } else {
      const root = page.locator('#root');
      await expect(root).toBeVisible();
      await expect
        .poll(async () =>
          root.evaluate(
            (element) =>
              element.childElementCount > 0 &&
              (element.textContent?.trim().length || 0) > 20,
          ),
        )
        .toBe(true);

      if (route === '/workspace?auth=signin') {
        await expect(page.locator('#auth-signin-email')).toBeVisible();
        await expect(page.locator('#auth-signin-password')).toBeVisible();
      } else {
        const pageId = MARKETING_PAGE_BY_ROUTE[route];
        expect(pageId).toBeTruthy();
        await expect(
          page.locator(`[data-beta-page="${pageId}"] main h1`),
        ).toBeVisible();
      }
    }

    const layout = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      brokenImages: Array.from(document.images)
        .filter((image) => image.complete && image.naturalWidth === 0)
        .map((image) => image.currentSrc || image.src),
    }));
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.brokenImages).toEqual([]);

    const bodyText = await page.locator('body').innerText();
    for (const forbidden of FORBIDDEN_PUBLIC_COPY) {
      expect(bodyText).not.toContain(forbidden);
    }

    expect(failedResources).toEqual([]);
    expect(runtimeErrors).toEqual([]);
  });
}
