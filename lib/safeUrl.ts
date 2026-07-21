/**
 * safeUrl — sanitize an untrusted (AI-generated or grounding-chunk) URL before it
 * is rendered as an `href`. Blocks `javascript:`/`data:`/`vbscript:` scheme
 * injection, passes through http(s)/mailto/tel, upgrades bare domains to https,
 * and returns '' for anything else so callers can drop or disable the link.
 *
 * Mirrors `normalizeExternalUrl` in components/tools/PortfolioWebsiteBuilder.tsx;
 * extracted here so every tool that renders model output shares one guard.
 */
export const safeUrl = (unsafe: string | null | undefined): string => {
  const value = unsafe?.trim();
  if (!value) return '';
  if (/^(javascript|data|vbscript):/i.test(value)) return '';
  if (/^(mailto:|tel:)/i.test(value)) return /[\r\n]/.test(value) ? '' : value;
  const candidate = /^(www\.|[a-z0-9.-]+\.[a-z]{2,})(\/.*)?$/i.test(value)
    ? `https://${value}`
    : value;
  try {
    const parsed = new URL(candidate);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname
      ? candidate
      : '';
  } catch {
    return '';
  }
};

/** Network-navigation variant for links that must never become mailto/tel. */
export const safeHttpUrl = (unsafe: string | null | undefined): string => {
  const normalized = safeUrl(unsafe);
  return /^https?:\/\//i.test(normalized) ? normalized : '';
};
