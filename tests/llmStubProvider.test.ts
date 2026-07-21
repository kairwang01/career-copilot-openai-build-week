import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import { ANALYSIS_SCHEMA } from '../functions/src/handlers/analyzeResume';
import { sessionEvalSchemaFor } from '../functions/src/handlers/mockInterview';
import { validateAgainstSchema } from '../functions/src/llm/schemaValidation';
import { makeStubProvider } from '../functions/src/llm/stubProvider';
import { buildWeb3EligibleAnalysis } from '../scripts/lib/resume-analysis-fixtures.mjs';

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');

describe('E2E LLM stub provider', () => {
  it('synthesizes a schema-valid resume analysis response', async () => {
    const result = await makeStubProvider().generate({
      prompt: 'Analyze this seeded resume.',
      responseSchema: ANALYSIS_SCHEMA,
    });

    expect(validateAgainstSchema(result.raw, ANALYSIS_SCHEMA)).toEqual([]);
    expect(result.model).toBe('e2e-stub');
  });

  it('keeps the shared Web3 resume fixture aligned with the production schema', () => {
    const createdAt = admin.firestore.Timestamp.fromDate(new Date('2026-07-13T00:00:00.000Z'));
    const fixture = buildWeb3EligibleAnalysis({ createdAt });

    expect(validateAgainstSchema(fixture, ANALYSIS_SCHEMA)).toEqual([]);
    expect(fixture).toMatchObject({ market_name: 'Canada', created_at: createdAt });
    expect(fixture.created_at.toMillis()).toBe(createdAt.toMillis());
    expect(fixture.strengths).toHaveLength(4);
    expect(fixture.improvements).toHaveLength(4);
    expect(fixture.keywords).toHaveLength(8);
  });

  it('rejects non-Timestamp dates in Firestore-backed fixtures', () => {
    expect(() => buildWeb3EligibleAnalysis({ createdAt: '2026-07-13T00:00:00.000Z' })).toThrow(
      /Firestore Timestamp/,
    );
  });

  it('honors array, enum, and numeric constraints for arbitrary tool schemas', async () => {
    const schema = {
      type: 'OBJECT',
      properties: {
        status: { type: 'STRING', enum: ['ready', 'blocked'] },
        scores: {
          type: 'ARRAY',
          items: { type: 'INTEGER', minimum: 2, maximum: 3 },
          minItems: '2',
          maxItems: '2',
        },
        empty: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          maxItems: '0',
        },
        nullable: { type: 'NULL' },
        rounded: { type: 'INTEGER', minimum: 2.5, maximum: 3.5 },
      },
      required: ['status', 'scores', 'empty'],
    };

    const result = await makeStubProvider().generate({
      prompt: 'Return constrained test data.',
      responseSchema: schema,
    });

    expect(validateAgainstSchema(result.raw, schema)).toEqual([]);
    expect(result.raw).toMatchObject({
      status: 'ready',
      scores: [3, 3],
      empty: [],
      nullable: null,
      rounded: 3,
    });
  });

  it('cites a deterministic source only for search-grounded requests', async () => {
    // aiProxy replaces an uncited result on requiresGrounding tools with their
    // empty fallback, which would blank every grounded tool in E2E.
    const grounded = await makeStubProvider().generate({
      prompt: 'Find events.',
      responseSchema: { type: 'OBJECT', properties: { events: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['events'] },
      useGoogleSearch: true,
    });
    expect(Array.isArray(grounded.groundingChunks)).toBe(true);
    expect((grounded.groundingChunks as unknown[]).length).toBeGreaterThan(0);

    const ungrounded = await makeStubProvider().generate({ prompt: 'Plain generation.' });
    expect(ungrounded.groundingChunks).toBeUndefined();
  });

  it('covers every interview question when the session schema pins the count', async () => {
    // The evaluate_session handler rejects a report whose perQuestion length
    // differs from the submitted transcript, so the per-request schema must
    // force the stub (and constrain real providers) to exactly that length.
    for (const questionCount of [1, 8]) {
      const schema = sessionEvalSchemaFor(questionCount);
      const result = await makeStubProvider().generate({
        prompt: 'Evaluate the interview session.',
        responseSchema: schema,
      });

      expect(validateAgainstSchema(result.raw, schema)).toEqual([]);
      const raw = result.raw as { perQuestion: unknown[] };
      expect(raw.perQuestion).toHaveLength(questionCount);
    }
  });
});
