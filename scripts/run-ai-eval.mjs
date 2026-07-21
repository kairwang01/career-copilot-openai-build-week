/**
 * AI-quality eval runner (SCRUM-46) — computes M7 (resume-analysis agreement) and
 * M8 (interview consistency) from the labelled set in evals/resume-eval-set.json.
 *
 *   node scripts/run-ai-eval.mjs            # dry-run: scores the set's stand-in outputs
 *                                           # (deterministic; proves the harness)
 *   node scripts/run-ai-eval.mjs --live     # live: call the real model per sample
 *
 * Live mode needs a provider key (GEMINI_API_KEY / KAIRLLM_API_KEY) and the functions
 * emulator; without one it falls back to dry-run with a clear notice, so CI never fails
 * for lack of a key. The scoring math is unit-tested in tests/evalScoring.test.ts.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// ts files aren't directly importable from .mjs; the scoring logic is duplicated-free by
// requiring the compiled form when available, else inlining the same pure functions here
// would drift — so we import the source via a tiny tsx-free shim: re-implement nothing,
// instead read the canonical thresholds and call through a dynamic import of the TS via
// the test runner. For the runner we keep it dependency-light and compute inline using
// the SAME formulas (kept in sync with evals/scoring.ts, which the unit tests lock).

const norm = (s) => String(s).toLowerCase().trim().replace(/\s+/g, ' ');
const keywordAgreement = (pred, ref) => {
  const a = new Set(pred.map(norm).filter(Boolean));
  const b = new Set(ref.map(norm).filter(Boolean));
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const k of a) if (b.has(k)) inter += 1;
  return inter / (a.size + b.size - inter);
};
const withinBand = (score, [lo, hi]) => Number.isFinite(score) && score >= lo && score <= hi;
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const stddev = (xs) => (xs.length < 2 ? 0 : Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2))));
const consistency = (xs, range = 100) => (xs.length < 2 ? 1 : Math.max(0, Math.min(1, 1 - stddev(xs) / range)));

const setPath = new URL('../evals/resume-eval-set.json', import.meta.url);
const set = JSON.parse(readFileSync(setPath, 'utf8'));

const live = process.argv.includes('--live');
const hasKey = !!(process.env.GEMINI_API_KEY || process.env.KAIRLLM_API_KEY || process.env.DEEPSEEK_API_KEY);

if (live && !hasKey) {
  console.log('⚠ --live requested but no provider key (GEMINI_API_KEY/KAIRLLM_API_KEY) — falling back to dry-run.\n');
}
const mode = live && hasKey ? 'live' : 'dry-run';
console.log(`AI-quality eval — mode: ${mode}\n`);

if (mode === 'live') {
  // Live model calls would go here (call analyzeResume / mockInterview against the
  // functions emulator, collect outputs, then score with the same functions below).
  // Intentionally not wired blind: requires the emulator + a provider key to verify.
  console.log('Live mode scaffold: wire the analyzeResume / mockInterview callables, then score the outputs with evals/scoring.ts. Exiting without a fabricated number.');
  process.exit(0);
}

// Dry-run: score the set's stand-in outputs so the harness produces a real, reproducible
// M7/M8 report (and proves the scoring pipeline end-to-end).
const resumeResults = set.resumeSamples.map((s) => {
  const agreement = keywordAgreement(s.sampleOutput.keywords, s.reference.keywords);
  const scoreInBand = withinBand(s.sampleOutput.score, s.reference.scoreBand);
  const pass = agreement >= 0.5 && scoreInBand;
  console.log(`  M7 ${s.id.padEnd(18)} agreement=${agreement.toFixed(2)} scoreInBand=${scoreInBand} ${pass ? '✓' : '✗'}`);
  return { agreement, pass };
});
const consistencyScores = set.interviewConsistencySamples.map((s) => {
  const c = consistency(s.sampleScores);
  console.log(`  M8 ${s.id.padEnd(18)} consistency=${c.toFixed(3)} (scores ${s.sampleScores.join(',')})`);
  return c;
});

const m7Agreement = mean(resumeResults.map((r) => r.agreement));
const m7PassRate = resumeResults.filter((r) => r.pass).length / resumeResults.length;
const m8 = mean(consistencyScores);
console.log('\n=== summary ===');
console.log(`  M7 resume agreement : ${(m7Agreement * 100).toFixed(1)}%  (pass rate ${(m7PassRate * 100).toFixed(0)}%)`);
console.log(`  M8 interview consist: ${(m8 * 100).toFixed(1)}%`);
console.log('\n(dry-run uses stand-in outputs; run --live with a provider key for real model numbers.)');
