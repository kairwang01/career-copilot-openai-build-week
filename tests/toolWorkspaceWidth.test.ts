import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const analysisDisplay = readFileSync(
  new URL('../components/AnalysisDisplay.tsx', import.meta.url),
  'utf8',
);

describe('tool workspace width contract', () => {
  it('does not force wide responsive tool layouts into the former 4xl wrapper', () => {
    expect(analysisDisplay).toContain("activeTool === 'mock-interview' ? 'max-w-[1440px]' : 'max-w-7xl'");
    expect(analysisDisplay).not.toContain("activeTool === 'mock-interview' ? 'max-w-[1440px]' : 'max-w-4xl'");
  });
});
