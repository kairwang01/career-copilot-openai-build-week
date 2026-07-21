# AI-quality evals (M7 / M8)

Measures two product-quality metrics with a labelled set:

- **M7 — Resume-analysis agreement**: does `analyzeResume`'s score + keywords agree with
  a human-labelled reference? Scored by keyword overlap (Jaccard) + score-in-band.
- **M8 — Interview consistency**: repeated runs of the same answer should score similarly
  (low variance ⇒ high consistency).

## Files
- `scoring.ts` — pure, unit-tested scoring (`tests/evalScoring.test.ts`).
- `resume-eval-set.json` — labelled samples (+ stand-in outputs for a deterministic dry-run).

## Run
```
npm run eval:ai            # dry-run: scores the stand-in outputs (reproducible)
node scripts/run-ai-eval.mjs --live   # real model runs (needs GEMINI_API_KEY/KAIRLLM_API_KEY + emulator)
```
Dry-run proves the harness end-to-end; the live M7/M8 numbers require a provider key
(and ideally a human rater to expand the labelled set).
