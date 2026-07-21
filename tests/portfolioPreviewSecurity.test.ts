import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PORTFOLIO_PREVIEW_SANDBOX, portfolioPreviewHtml } from '../lib/portfolioPreview';

const root = process.cwd();

describe('portfolio preview isolation', () => {
  it('removes inline and external scripts while preserving document content', () => {
    const html = '<style>body{color:red}</style><main>Preview</main><script>alert(1)</script><SCRIPT src="/x.js"></SCRIPT>';

    expect(portfolioPreviewHtml(html)).toBe('<style>body{color:red}</style><main>Preview</main>');
  });

  it('keeps scripts disabled in the iframe sandbox and wires controlled interactions from the parent', () => {
    const source = fs.readFileSync(path.join(root, 'components/showcase/PortfolioPreviewViewer.tsx'), 'utf8');

    expect(PORTFOLIO_PREVIEW_SANDBOX).not.toContain('allow-scripts');
    expect(PORTFOLIO_PREVIEW_SANDBOX).not.toContain('allow-popups-to-escape-sandbox');
    expect(source).toContain('srcDoc={previewHtmlContent}');
    expect(source).toContain('onLoad={wirePreviewInteractions}');
    expect(source).toContain('sandbox={PORTFOLIO_PREVIEW_SANDBOX}');
  });
});
