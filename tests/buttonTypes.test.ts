import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const rootPath = fileURLToPath(new URL('../', import.meta.url));

function collectTsx(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) return collectTsx(child);
    return entry.isFile() && entry.name.endsWith('.tsx') ? [child] : [];
  });
}

describe('button form behavior', () => {
  it('declares an explicit type on every JSX button', () => {
    const files = [
      join(rootPath, 'CareerApp.tsx'),
      ...collectTsx(join(rootPath, 'components')),
      ...collectTsx(join(rootPath, 'marketing')),
    ];
    const violations: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node) => {
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(tree) === 'button') {
          const hasType = node.attributes.properties.some(
            (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === 'type',
          );
          if (!hasType) {
            const { line } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
            violations.push(`${relative(rootPath, file)}:${line + 1}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(tree);
    }

    expect(violations).toEqual([]);
  });

  it('keeps generated portfolio filter controls non-submitting', () => {
    const source = readFileSync(join(rootPath, 'components/tools/PortfolioWebsiteBuilder.tsx'), 'utf8');
    expect(source).not.toMatch(/<button class="filter-btn/);
    expect(source.match(/<button type="button" class="filter-btn/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
