import React from 'react';

/**
 * MarkdownLite — a tiny, dependency-free renderer for the Markdown subset that
 * AI-generated job descriptions actually use: ##/### headings, **bold**,
 * *italic*, `code`, "-"/"*" bullets, "1." numbered lists, and blank-line
 * paragraphs.
 *
 * Output is plain React elements (text nodes only — no dangerouslySetInnerHTML),
 * so untrusted input cannot inject HTML. Unknown syntax degrades gracefully to
 * plain text, which is exactly what the previous whitespace-pre-line rendering
 * showed.
 */

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'p'; lines: string[] };

const HEADING_RE = /^(#{1,4})\s+(.*)$/;
const BULLET_RE = /^\s*[-*•]\s+(.*)$/;
const ORDERED_RE = /^\s*\d{1,3}[.)]\s+(.*)$/;

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) { blocks.push({ kind: 'p', lines: para }); para = []; }
  };

  for (const rawLine of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trimEnd();
    if (!line.trim()) { flushPara(); continue; }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushPara();
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() });
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      flushPara();
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'ul') last.items.push(bullet[1]);
      else blocks.push({ kind: 'ul', items: [bullet[1]] });
      continue;
    }

    const ordered = ORDERED_RE.exec(line);
    if (ordered) {
      flushPara();
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'ol') last.items.push(ordered[1]);
      else blocks.push({ kind: 'ol', items: [ordered[1]] });
      continue;
    }

    para.push(line);
  }
  flushPara();
  return blocks;
}

/** Inline pass: **bold**, *italic*, `code`. Everything else stays a text node. */
function renderInline(text: string): React.ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g);
  return tokens.map((tok, i) => {
    if (tok.startsWith('**') && tok.endsWith('**') && tok.length > 4) {
      return <strong key={i} className="font-semibold">{tok.slice(2, -2)}</strong>;
    }
    if (tok.startsWith('`') && tok.endsWith('`') && tok.length > 2) {
      return (
        <code key={i} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-slate-800">
          {tok.slice(1, -1)}
        </code>
      );
    }
    if (tok.startsWith('*') && tok.endsWith('*') && tok.length > 2) {
      return <em key={i}>{tok.slice(1, -1)}</em>;
    }
    return tok;
  });
}

const HEADING_CLASS: Record<number, string> = {
  1: 'text-base font-bold text-slate-900 dark:text-slate-100',
  2: 'text-[15px] font-semibold text-slate-900 dark:text-slate-100',
  3: 'text-sm font-semibold text-slate-800 dark:text-slate-200',
  4: 'text-sm font-semibold text-slate-700 dark:text-slate-300',
};

export const MarkdownLite: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => {
  const blocks = React.useMemo(() => parseBlocks(text), [text]);
  return (
    <div className={`space-y-2.5 text-sm leading-relaxed text-slate-700 dark:text-slate-300 ${className}`}>
      {blocks.map((block, i) => {
        if (block.kind === 'heading') {
          return (
            <p key={i} className={`${HEADING_CLASS[block.level] ?? HEADING_CLASS[4]} ${i > 0 ? 'pt-1.5' : ''}`}>
              {renderInline(block.text)}
            </p>
          );
        }
        if (block.kind === 'ul') {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {block.items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
            </ul>
          );
        }
        if (block.kind === 'ol') {
          return (
            <ol key={i} className="list-decimal space-y-1 pl-5">
              {block.items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
            </ol>
          );
        }
        return (
          <p key={i}>
            {block.lines.map((line, j) => (
              <React.Fragment key={j}>
                {j > 0 && <br />}
                {renderInline(line)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
};

/**
 * Strips MarkdownLite syntax for one-line/clamped previews so a collapsed job
 * card shows "Role Overview We are looking…" instead of "## Role Overview…".
 */
export const stripMarkdownLite = (text: string): string =>
  text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) =>
      line
        .replace(HEADING_RE, '$2')
        .replace(BULLET_RE, '$1')
        .replace(ORDERED_RE, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*\s][^*]*)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .trim(),
    )
    .filter(Boolean)
    .join(' ');

export default MarkdownLite;
