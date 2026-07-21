#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['components', 'hooks', 'lib'];
const INCLUDE_DUPLICATE_SUBMIT = process.argv.includes('--include-duplicate-submit');
const EXCLUDED = [
  'node_modules',
  'dist',
  '.git',
  'localization',
  'public/localization',
];

const FUNCTIONAL_SIGNATURES = [
  {
    id: 'FUNC-ASYNC-LIFECYCLE:direct-then-setter',
    pattern: /\.then\([^)\n]*=>\s*set[A-Z]/,
    ignores: ['mountedRef', 'isMounted', 'cancelled', 'active', 'if (', 'if('],
    rationale: 'Promise continuation may write React state after unmount unless guarded.',
  },
  {
    id: 'FUNC-ASYNC-LIFECYCLE:timer-state',
    pattern: /setTimeout\([^)\n]*set[A-Z]/,
    ignores: ['clearTimeout', 'TimerRef', 'timerRef', 'const timer', 'const id', 'window.setTimeout'],
    rationale: 'Timer may write React state after unmount unless cleared.',
  },
];

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(process.cwd(), full);
    if (EXCLUDED.some((part) => rel === part || rel.includes(`${part}/`))) continue;
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, files);
    else if (/\.(tsx|ts)$/.test(name)) files.push(full);
  }
  return files;
}

function classifyLine(line) {
  for (const signature of FUNCTIONAL_SIGNATURES) {
    if (!signature.pattern.test(line)) continue;
    if (signature.ignores.some((token) => line.includes(token))) continue;
    return signature;
  }
  return null;
}

const NON_LATCH_REF_NAMES = new Set([
  'mountedRef',
  'isMountedRef',
  'endRef',
  'scrollRef',
  'fileInputRef',
  'videoRef',
  'canvasRef',
  'menuRef',
  'jdPanelRef',
  'answerBoxRef',
]);

function hasDuplicateSubmitGuard(block) {
  const refNames = [...block.matchAll(/\b([A-Za-z0-9_]+Ref)\.current/g)].map((match) => match[1]);
  const hasLatchRef = refNames.some((name) => {
    if (NON_LATCH_REF_NAMES.has(name)) return false;
    if (/TimerRef$/i.test(name)) return false;
    return /(saving|submitting|inFlight|loading|busy|run|apply|scorecard|password|plan|sending|opening|extracting|anonymizing|pitching|prepping|confirming|downloading|generating|upload|hidden|ids|save|copy|paying|creating|processing|unlocking)/i.test(name);
  });
  if (hasLatchRef) return true;

  // Some larger forms centralize the synchronous guard in a helper such as
  // startAiAction("description"), which internally checks a ref before any await.
  if (/if\s*\(\s*!?start[A-Za-z0-9_]*Action\(/.test(block)) return true;

  return /set[A-Za-z0-9_]*(Saving|Submitting|Loading|Busy|Paying|Creating|Parsing|Prefilling|Processing|Opening|Copying)\(true\)/.test(block);
}

const findings = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      const signature = classifyLine(line);
      if (!signature) return;
      findings.push({
        file: relative(process.cwd(), file),
        line: index + 1,
        signature: signature.id,
        rationale: signature.rationale,
        code: line.trim(),
      });
    });

    if (INCLUDE_DUPLICATE_SUBMIT) {
      const handlerPattern = /const\s+(handle[A-Za-z0-9_]+)\s*=\s*async\s*\([^)]*\)\s*=>/g;
      let match;
      while ((match = handlerPattern.exec(text)) !== null) {
        const startLine = text.slice(0, match.index).split(/\r?\n/).length;
        const block = lines.slice(startLine - 1, startLine + 80).join('\n');
        const hasNetworkOrWrite = /await\s+[A-Za-z0-9_.]+\(|await\s+(data|api|admin|set|update|create|delete|remove|save|send|confirm|schedule|upsert)/.test(block);
        if (!hasNetworkOrWrite || hasDuplicateSubmitGuard(block)) continue;
        findings.push({
          file: relative(process.cwd(), file),
          line: startLine,
          signature: 'FUNC-DUPLICATE-SUBMIT:async-handler-needs-review',
          rationale: 'Async handler has a write/network-looking await and no obvious synchronous ref latch in the first 80 lines.',
          code: lines[startLine - 1].trim(),
        });
      }
    }
  }
}

if (findings.length === 0) {
  console.log('No high-signal functional bug signatures found.');
  process.exit(0);
}

console.log(JSON.stringify({
  count: findings.length,
  note: INCLUDE_DUPLICATE_SUBMIT
    ? 'Candidates require manual classification. Translation/localization paths are excluded and do not count as effective rounds.'
    : 'Default mode scans high-signal async lifecycle signatures. Use --include-duplicate-submit for broader duplicate-submit candidates. Translation/localization paths are excluded.',
  findings,
}, null, 2));
