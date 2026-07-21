import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  exportedFunctionNames,
  validateFunctionTargets,
} from '../scripts/validate-function-targets.mjs';

const root = new URL('../', import.meta.url);
const functionsIndex = readFileSync(
  new URL('functions/src/index.ts', root),
  'utf8',
);
const deploymentRunbook = readFileSync(
  new URL('docs/deployment/README.md', root),
  'utf8',
);
const deployChecklist = readFileSync(
  new URL('docs/deploy-checklist.md', root),
  'utf8',
);

const compiled = `
exports.alpha = exports.beta = void 0;
exports.Alpha = exports.Zeta = void 0;
Object.defineProperty(exports, "alpha", { enumerable: true, get: function () { return alpha; } });
Object.defineProperty(exports, "beta", { enumerable: true, get: function () { return beta; } });
Object.defineProperty(exports, "Alpha", { enumerable: true, get: function () { return Alpha; } });
Object.defineProperty(exports, "Zeta", { enumerable: true, get: function () { return Zeta; } });
`;

describe('Functions deployment target evidence', () => {
  it('keeps the credit-refund scheduler exported and required by reviewed target evidence', () => {
    expect(functionsIndex).toMatch(
      /processCreditRefundReviewsFunction\s+as processCreditRefundReviews/,
    );
    expect(deploymentRunbook).toContain(
      'This launch requires `processCreditRefundReviews` as its own line in `REVIEWED_FUNCTION_TARGETS`.',
    );
    expect(deploymentRunbook).toContain(
      "grep -Fxq 'processCreditRefundReviews' \"$REVIEWED_FUNCTION_TARGETS\"",
    );
    expect(deployChecklist).toContain(
      '`processCreditRefundReviews` as its own line in the reviewed target evidence',
    );
  });

  it('extracts compiled exports and accepts a sorted explicit target list', () => {
    expect([...exportedFunctionNames(compiled)].sort()).toEqual([
      'Alpha',
      'Zeta',
      'alpha',
      'beta',
    ]);
    expect(validateFunctionTargets('alpha\nbeta\n', compiled)).toEqual([
      'alpha',
      'beta',
    ]);
  });

  it('uses locale-independent ASCII code-unit ordering', () => {
    expect(validateFunctionTargets('Alpha\nZeta\nalpha\nbeta\n', compiled)).toEqual([
      'Alpha',
      'Zeta',
      'alpha',
      'beta',
    ]);
    expect(() =>
      validateFunctionTargets('alpha\nAlpha\nZeta\nbeta\n', compiled),
    ).toThrow(/sorted/);
  });

  it.each([
    ['', /one non-empty ASCII/],
    ['alpha\n\nbeta\n', /one non-empty ASCII/],
    ['alpha\nalpha\n', /duplicates/],
    ['beta\nalpha\n', /sorted/],
    ['alpha\ngamma\n', /does not export: gamma/],
    ['alpha\n#comment\n', /one non-empty ASCII/],
  ])('rejects non-canonical target evidence %#', (targets, message) => {
    expect(() => validateFunctionTargets(targets, compiled)).toThrow(message);
  });
});
