import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { SITE_ORIGIN } from '../../config/site';

/**
 * SiteSeo — headless per-route SEO for the public marketing site (SCRUM-83).
 *
 * The site is a single-page app with client-side language switching (one URL per
 * page across all locales), so search engines index one canonical URL per page.
 * This component keeps the document head correct as the SPA navigates: per-route
 * <title> / description / canonical, Open Graph + Twitter cards for link
 * previews, `noindex` on the private app routes, and a dynamic <html lang>.
 *
 * index.html carries sensible static defaults so scrapers that don't run JS still
 * get a title, description, and social card; this component upgrades them at runtime.
 */

const SITE_NAME = 'Career CoPilot';
const OG_IMAGE = `${SITE_ORIGIN}/og-cover.png`;
const OG_IMAGE_ALT = 'Career CoPilot product overview';

interface PageMeta {
  title: string;
  description: string;
}

const PAGE_META: Record<string, PageMeta> = {
  '/': {
    title: 'Career CoPilot — AI-Assisted Career and Hiring Workflows',
    description:
      'Review resume drafts, practise interviews, plan career steps, and manage hiring workflows with AI-assisted tools. Review generated output before relying on it.',
  },
  '/employers': {
    title: 'Career CoPilot for Employers — Structured Hiring Workflows',
    description:
      'Post roles, review applications, manage opted-in outreach, and record screener, interview, and scorecard decisions. Verify AI suggestions before acting.',
  },
  '/pricing': {
    title: 'Pricing — Career CoPilot',
    description:
      'Compare the listed credit and subscription plans for candidates and hiring teams. Checkout availability and final terms are shown before confirmation.',
  },
  '/sample-report': {
    title: 'Illustrative Resume Report — Career CoPilot',
    description:
      'Review an explicitly illustrative resume-report example with an advisory score, possible keyword gaps, and suggested next steps. Generated results vary.',
  },
};

// Private / app surfaces that must never be indexed.
const NOINDEX_PREFIXES = ['/workspace', '/portal', '/admin', '/billing', '/auth', '/__/auth'];

function upsertMeta(attr: 'name' | 'property', key: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertCanonical(href: string): void {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

export const SiteSeo: React.FC = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    const meta = PAGE_META[pathname];
    const noindex = NOINDEX_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
    const title = meta?.title ?? SITE_NAME;
    const description = meta?.description ?? PAGE_META['/'].description;
    const url = `${SITE_ORIGIN}${pathname === '/' ? '/' : pathname}`;

    document.title = title;
    upsertMeta('name', 'description', description);
    upsertMeta('name', 'robots', noindex ? 'noindex, nofollow' : 'index, follow');
    upsertCanonical(url);

    upsertMeta('property', 'og:type', 'website');
    upsertMeta('property', 'og:site_name', SITE_NAME);
    upsertMeta('property', 'og:title', title);
    upsertMeta('property', 'og:description', description);
    upsertMeta('property', 'og:url', url);
    upsertMeta('property', 'og:image', OG_IMAGE);
    upsertMeta('property', 'og:image:alt', OG_IMAGE_ALT);

    upsertMeta('name', 'twitter:card', 'summary_large_image');
    upsertMeta('name', 'twitter:title', title);
    upsertMeta('name', 'twitter:description', description);
    upsertMeta('name', 'twitter:image', OG_IMAGE);
    upsertMeta('name', 'twitter:image:alt', OG_IMAGE_ALT);
  }, [pathname]);

  return null;
};

export default SiteSeo;
