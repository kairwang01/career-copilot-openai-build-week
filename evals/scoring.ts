/**
 * Deterministic scoring for the AI-quality eval harness (SCRUM-46).
 *
 * Pure functions only — no LLM, no I/O — so the scoring logic is unit-testable and the
 * M7/M8 numbers are reproducible given the same model outputs. The actual model runs
 * live in scripts/run-ai-eval.mjs (provider-gated). Lives under evals/, not lib/, so it
 * never ships in the app bundle.
 *
 *   M7 — Resume-analysis agreement: do the model's keywords/score agree with a labelled
 *        reference? (keyword overlap + score within an expected band)
 *   M8 — Interview consistency: repeated runs of the same answer should score similarly
 *        (low variance ⇒ high consistency).
 */

const norm = (s: string): string => s.toLowerCase().trim().replace(/\s+/g, ' ');

/** Symmetric overlap (Jaccard) of two keyword sets, 0..1. Case/space-insensitive. */
export function keywordAgreement(predicted: string[], reference: string[]): number {
  const a = new Set(predicted.map(norm).filter(Boolean));
  const b = new Set(reference.map(norm).filter(Boolean));
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const k of a) if (b.has(k)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 1 : inter / union;
}

export const withinScoreBand = (score: number, band: readonly [number, number]): boolean =>
  Number.isFinite(score) && score >= band[0] && score <= band[1];

export interface ResumeAgreementResult {
  keywordAgreement: number;
  scoreInBand: boolean;
  pass: boolean;
}

/**
 * M7 per-sample agreement. Passes when keyword overlap clears `minKeyword` (default 0.5)
 * AND the model score sits inside the labelled band.
 */
export function scoreResumeAgreement(
  output: { score: number; keywords: string[] },
  reference: { keywords: string[]; scoreBand: readonly [number, number] },
  minKeyword = 0.5,
): ResumeAgreementResult {
  const agreement = keywordAgreement(output.keywords, reference.keywords);
  const scoreInBand = withinScoreBand(output.score, reference.scoreBand);
  return { keywordAgreement: agreement, scoreInBand, pass: agreement >= minKeyword && scoreInBand };
}

export const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

export function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/**
 * M8 consistency across repeated runs of the same input, 0..1 (1 = identical scores).
 * Normalizes the score stddev by `range` (default 100 for a 0–100 score) so it's
 * comparable across metrics.
 */
export function interviewConsistency(scores: number[], range = 100): number {
  if (scores.length < 2) return 1;
  const normalized = stddev(scores) / range;
  return Math.max(0, Math.min(1, 1 - normalized));
}

export interface EvalSummary {
  m7Agreement: number; // mean keyword agreement across the set
  m7PassRate: number; // fraction of samples that passed
  m8Consistency: number; // mean consistency across repeated-run groups
}

export function summarize(
  resumeResults: ResumeAgreementResult[],
  consistencyScores: number[],
): EvalSummary {
  return {
    m7Agreement: mean(resumeResults.map((r) => r.keywordAgreement)),
    m7PassRate: resumeResults.length ? resumeResults.filter((r) => r.pass).length / resumeResults.length : 0,
    m8Consistency: mean(consistencyScores),
  };
}
