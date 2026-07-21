import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseApiDocsMarkdown } from '../components/ApiDocsViewer';

describe('API documentation renderer', () => {
  it('parses fenced code and tables without turning source text into HTML', () => {
    const blocks = parseApiDocsMarkdown('# Docs\n\n```html\n<script>alert(1)</script>\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |');
    expect(blocks).toContainEqual({ kind: 'code', language: 'html', text: '<script>alert(1)</script>' });
    expect(blocks).toContainEqual({ kind: 'table', headers: ['A', 'B'], rows: [['1', '2']] });
  });

  it('keeps the viewer free of raw HTML injection sinks', () => {
    const source = readFileSync(new URL('../components/ApiDocsViewer.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('dangerouslySetInnerHTML');
    expect(source).not.toContain('document.write');
  });
});
