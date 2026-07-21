import React, { useEffect, useMemo, useState } from 'react';

interface ApiDocsViewerProps {
  onClose: () => void;
}

type DocsBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; language: string; text: string }
  | { kind: 'table'; headers: string[]; rows: string[][] };

const splitTableRow = (line: string): string[] =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());

const isTableDivider = (line: string): boolean =>
  splitTableRow(line).length > 0 && splitTableRow(line).every((cell) => /^:?-{3,}:?$/.test(cell));

export const parseApiDocsMarkdown = (markdown: string): DocsBlock[] => {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: DocsBlock[] = [];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', lines: paragraph });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = /^```([\w-]*)\s*$/.exec(line.trim());
    if (fence) {
      flushParagraph();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index].trim())) {
        code.push(lines[index]);
        index += 1;
      }
      blocks.push({ kind: 'code', language: fence[1], text: code.join('\n') });
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() });
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      flushParagraph();
      const headers = splitTableRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      index -= 1;
      blocks.push({ kind: 'table', headers, rows });
      continue;
    }

    const unordered = /^\s*[-*]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      const orderedList = !!ordered;
      const item = (ordered ?? unordered)![1];
      const previous = blocks[blocks.length - 1];
      if (previous?.kind === 'list' && previous.ordered === orderedList) previous.items.push(item);
      else blocks.push({ kind: 'list', ordered: orderedList, items: [item] });
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
};

const renderInline = (text: string): React.ReactNode[] =>
  text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g).map((token, index) => {
    if (token.startsWith('**') && token.endsWith('**')) {
      return <strong key={index}>{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith('`') && token.endsWith('`')) {
      return <code key={index} className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[0.9em] text-red-600 dark:bg-slate-700 dark:text-red-300">{token.slice(1, -1)}</code>;
    }
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(token);
    if (link) {
      return <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline-offset-2 hover:underline dark:text-blue-400">{link[1]}</a>;
    }
    return token;
  });

const ApiDocsContent: React.FC<{ markdown: string }> = ({ markdown }) => {
  const blocks = useMemo(() => parseApiDocsMarkdown(markdown), [markdown]);
  return (
    <div className="space-y-4 text-sm leading-7 text-gray-700 dark:text-gray-300">
      {blocks.map((block, index) => {
        if (block.kind === 'heading') {
          const classes = block.level === 1
            ? 'pt-2 text-3xl font-bold text-gray-900 dark:text-white'
            : block.level === 2
              ? 'border-b border-gray-200 pt-4 pb-2 text-2xl font-bold text-gray-900 dark:border-slate-700 dark:text-white'
              : 'pt-3 text-xl font-semibold text-gray-900 dark:text-white';
          return React.createElement(`h${Math.min(block.level, 4)}`, { key: index, className: classes }, renderInline(block.text));
        }
        if (block.kind === 'code') {
          return <pre key={index} dir="ltr" className="max-w-full overflow-x-auto rounded-lg bg-gray-900 p-4 text-left text-sm text-gray-100"><code data-language={block.language || undefined}>{block.text}</code></pre>;
        }
        if (block.kind === 'list') {
          const Tag = block.ordered ? 'ol' : 'ul';
          return <Tag key={index} className={`${block.ordered ? 'list-decimal' : 'list-disc'} space-y-1 ps-6`}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}</Tag>;
        }
        if (block.kind === 'table') {
          return (
            <div key={index} className="max-w-full overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
              <table className="min-w-[36rem] border-collapse text-left text-sm">
                <thead className="bg-gray-50 dark:bg-slate-900/60"><tr>{block.headers.map((header, cellIndex) => <th key={cellIndex} scope="col" className="px-3 py-2 font-semibold text-gray-900 dark:text-white">{renderInline(header)}</th>)}</tr></thead>
                <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex} className="border-t border-gray-200 dark:border-slate-700">{block.headers.map((_, cellIndex) => <td key={cellIndex} className="px-3 py-2 align-top">{renderInline(row[cellIndex] ?? '')}</td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        }
        return <p key={index}>{block.lines.map((line, lineIndex) => <React.Fragment key={lineIndex}>{lineIndex > 0 && <br />}{renderInline(line)}</React.Fragment>)}</p>;
      })}
    </div>
  );
};

const ApiDocsViewer: React.FC<ApiDocsViewerProps> = ({ onClose }) => {
  const [docContent, setDocContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    fetch('/docs/api.md', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Failed to load documentation file.');
        return response.text();
      })
      .then((markdown) => {
        if (active) setDocContent(markdown);
      })
      .catch((fetchError: unknown) => {
        if (active && !(fetchError instanceof DOMException && fetchError.name === 'AbortError')) {
          setError(true);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [reload]);

  return (
    <section aria-labelledby="api-docs-title" className="mx-auto w-full max-w-4xl animate-fade-in rounded-lg border border-gray-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 p-4 dark:border-slate-700">
        <h2 id="api-docs-title" className="text-xl font-bold text-gray-800 dark:text-gray-100">API Documentation</h2>
        <button type="button" onClick={onClose} className="min-h-11 rounded-md px-3 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-600 dark:text-gray-300 dark:hover:bg-slate-700 dark:hover:text-white">&larr; Back to Account</button>
      </header>
      <div className="max-h-[calc(100dvh-10rem)] overflow-y-auto p-4 sm:p-6">
        {loading ? <p role="status" aria-live="polite">Loading documentation...</p> : error ? (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            <p>Error loading documentation. Please try again.</p>
            <button type="button" onClick={() => setReload((value) => value + 1)} className="mt-3 min-h-11 rounded-md bg-red-700 px-4 py-2 font-semibold text-white hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2">Retry</button>
          </div>
        ) : <ApiDocsContent markdown={docContent} />}
      </div>
    </section>
  );
};

export default ApiDocsViewer;
