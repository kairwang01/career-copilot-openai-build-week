/** Keep generated preview documents passive under the application's CSP. */
export function portfolioPreviewHtml(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
}

/** Scripts stay disabled; the parent app wires the small preview interactions. */
export const PORTFOLIO_PREVIEW_SANDBOX = 'allow-same-origin allow-popups';
