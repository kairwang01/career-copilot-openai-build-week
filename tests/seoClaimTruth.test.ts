import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const siteSeo = fs.readFileSync(path.join(root, 'marketing/components/SiteSeo.tsx'), 'utf8');
const siteOriginConfig = fs.readFileSync(path.join(root, 'config/site-origin.mjs'), 'utf8');
const sitemap = fs.readFileSync(path.join(root, 'public/sitemap.xml'), 'utf8');
const robots = fs.readFileSync(path.join(root, 'public/robots.txt'), 'utf8');

describe('public SEO claim truth', () => {
  it('does not promise employment, instant output, universal affordability, or real sample data', () => {
    const copy = `${indexHtml}\n${siteSeo}`;
    expect(copy).not.toMatch(/land the job you actually want|get an instant score|all backed by data|every tool is affordable|see a real career copilot resume report/i);
  });

  it('labels AI assistance and illustrative output honestly', () => {
    expect(indexHtml).toContain('AI-Assisted Career and Hiring Workflows');
    expect(siteSeo).toContain('Verify AI suggestions before acting.');
    expect(siteSeo).toContain('Illustrative Resume Report');
    expect(siteSeo).toContain('Generated results vary.');
  });

  it('uses the shared runtime origin and keeps the crawler fallback aligned', () => {
    expect(siteSeo).toContain("import { SITE_ORIGIN } from '../../config/site'");
    const origin = siteOriginConfig.match(/SITE_ORIGIN\s*=\s*'([^']+)'/)?.[1];
    expect(origin).toBeTruthy();
    expect(indexHtml).toContain(`<link rel="canonical" href="${origin}/"`);
    expect(indexHtml).toContain(`<meta property="og:url" content="${origin}/"`);
    expect(indexHtml).toContain(`<meta property="og:image:alt" content="Career CoPilot product overview"`);
    expect(indexHtml).toContain(`"logo": "${origin}/favicon.svg"`);
    expect(siteSeo).toContain("upsertMeta('property', 'og:image:alt', OG_IMAGE_ALT)");
    expect(sitemap).toContain(`<loc>${origin}/</loc>`);
    expect([...sitemap.matchAll(/<loc>(https:\/\/[^/]+)/g)].every((match) => match[1] === origin)).toBe(true);
    expect(robots).toContain(`Sitemap: ${origin}/sitemap.xml`);
  });

  it('keeps authentication and email-action routes out of search indexes', () => {
    expect(siteSeo).toContain("'/auth'");
    expect(siteSeo).toContain("'/__/auth'");
    expect(siteSeo).toContain("noindex ? 'noindex, nofollow'");
  });
});
