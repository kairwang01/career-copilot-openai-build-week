import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_RESUME_TEXT_CHARS } from '../lib/resumeFileValidation';
import {
  MAX_AI_TOOL_PAYLOAD_CHARS,
  MAX_RESUME_TEXT_CHARS as SERVER_MAX_RESUME_TEXT_CHARS,
  payloadContentCharacterCount,
} from '../functions/src/utils/runtimeLimits';
import { toolPayloadIssues } from '../functions/src/llm/toolPayloadValidation';

const root = new URL('../', import.meta.url);
const aiProxySource = readFileSync(
  new URL('functions/src/handlers/aiProxy.ts', root),
  'utf8',
);
const coverLetterSource = readFileSync(
  new URL('functions/src/handlers/generateCoverLetter.ts', root),
  'utf8',
);
const careerPathSource = readFileSync(
  new URL('functions/src/handlers/generateCareerPath.ts', root),
  'utf8',
);
const mockInterviewSource = readFileSync(
  new URL('functions/src/handlers/mockInterview.ts', root),
  'utf8',
);
const careerCoachSource = readFileSync(
  new URL('functions/src/handlers/careerCoach.ts', root),
  'utf8',
);
const aiProxySmokeSource = readFileSync(
  new URL('scripts/aiproxy-guard-smoke.mjs', root),
  'utf8',
);

describe('resume input limit contract', () => {
  it('does not reject a frontend-valid resume at either callable boundary', () => {
    expect(MAX_RESUME_TEXT_CHARS).toBe(200_000);
    expect(MAX_RESUME_TEXT_CHARS).toBe(SERVER_MAX_RESUME_TEXT_CHARS);
    expect(aiProxySource).toContain('MAX_AI_TOOL_PAYLOAD_CHARS');
    expect(aiProxySource).not.toContain('const MAX_PAYLOAD_CHARS = 100_000');
    expect(coverLetterSource).toContain('MAX_RESUME_TEXT_CHARS');
    expect(coverLetterSource).not.toContain('data.resumeText.length > 100_000');
    expect(coverLetterSource).toContain('typeof data.resumeText !== "string"');
    expect(coverLetterSource).toContain('MAX_COVER_LETTER_JOB_DESCRIPTION_CHARS');
  });

  it('accepts the largest legal UI resume with bounded companion inputs', () => {
    const resumeText = 'R'.repeat(MAX_RESUME_TEXT_CHARS);
    const payload = {
      resumeText,
      jobDescription: 'J'.repeat(20_000),
      sourceNotes: 'N'.repeat(12_000),
      targetRole: 'Software Engineer',
      marketName: 'Canada',
    };

    expect(toolPayloadIssues('generateCandidatePrepKit', payload)).toEqual([]);
    expect(payloadContentCharacterCount(payload)).toBeLessThanOrEqual(
      MAX_AI_TOOL_PAYLOAD_CHARS,
    );
  });

  it('uses the shared 200k resume contract in every dedicated AI handler', () => {
    for (const source of [careerPathSource, mockInterviewSource, careerCoachSource]) {
      expect(source).toContain('MAX_RESUME_TEXT_CHARS');
      expect(source).not.toMatch(/resumeText[^\n]{0,100}> 100_000/);
    }
    expect(mockInterviewSource).toContain(
      'data.resumeText.length > MAX_RESUME_TEXT_CHARS',
    );
  });

  it('keeps the runtime smoke synchronized and isolates the envelope rejection', () => {
    const otherwiseValidPayload = {
      resumeText: 'R'.repeat(MAX_RESUME_TEXT_CHARS),
      skillToLearn: 'S'.repeat(
        MAX_AI_TOOL_PAYLOAD_CHARS - MAX_RESUME_TEXT_CHARS,
      ),
      marketName: 'Canada',
    };

    expect(MAX_AI_TOOL_PAYLOAD_CHARS).toBe(300_000);
    expect(toolPayloadIssues('generateLearningPlan', otherwiseValidPayload)).toEqual([]);
    expect(payloadContentCharacterCount(otherwiseValidPayload)).toBeGreaterThan(
      MAX_AI_TOOL_PAYLOAD_CHARS,
    );
    expect(aiProxySmokeSource).toContain(
      'const MAX_AI_TOOL_PAYLOAD_CHARS = 300_000;',
    );
    expect(aiProxySmokeSource).toContain(
      'const MAX_RESUME_TEXT_CHARS = 200_000;',
    );
    expect(aiProxySmokeSource).toContain(
      "resumeText: 'R'.repeat(MAX_RESUME_TEXT_CHARS)",
    );
    expect(aiProxySmokeSource).toContain(
      "skillToLearn: 'S'.repeat(MAX_AI_TOOL_PAYLOAD_CHARS - MAX_RESUME_TEXT_CHARS)",
    );
    expect(aiProxySmokeSource).toContain("marketName: 'Canada'");
    expect(aiProxySmokeSource).toContain(
      '/request payload exceeds the 300000 character content limit/i',
    );
    expect(aiProxySmokeSource).not.toContain('const MAX_PAYLOAD_CHARS = 100_000');
  });

  it('counts deserialized content instead of JSON escaping overhead', () => {
    const resumeText = '\n"'.repeat(MAX_RESUME_TEXT_CHARS / 2);
    const payload = { resumeText, marketName: 'Canada' };

    expect(resumeText).toHaveLength(MAX_RESUME_TEXT_CHARS);
    expect(JSON.stringify(payload).length).toBeGreaterThan(MAX_AI_TOOL_PAYLOAD_CHARS);
    expect(payloadContentCharacterCount(payload)).toBeLessThanOrEqual(
      MAX_AI_TOOL_PAYLOAD_CHARS,
    );
    expect(toolPayloadIssues('findOpportunities', payload)).toEqual([]);
  });

  it('rejects over-limit resume fields and oversized non-resume envelopes', () => {
    expect(toolPayloadIssues('findOpportunities', {
      resumeText: 'R'.repeat(MAX_RESUME_TEXT_CHARS + 1),
      marketName: 'Canada',
    })).toContain(
      `resumeText exceeds the ${MAX_RESUME_TEXT_CHARS} character limit`,
    );
    expect(toolPayloadIssues('generateOutreachEmail', {
      candidateResumeText: 'R'.repeat(MAX_RESUME_TEXT_CHARS + 1),
      jobDescription: 'Role',
      employerProfile: {},
      marketName: 'Canada',
    })).toContain(
      `candidateResumeText exceeds the ${MAX_RESUME_TEXT_CHARS} character limit`,
    );
    expect(payloadContentCharacterCount({ blob: 'x'.repeat(MAX_AI_TOOL_PAYLOAD_CHARS) }))
      .toBeGreaterThan(MAX_AI_TOOL_PAYLOAD_CHARS);
  });

  it('fails closed for non-JSON values and cyclic objects', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(payloadContentCharacterCount({ bad: Number.NaN })).toBe(Number.MAX_SAFE_INTEGER);
    expect(payloadContentCharacterCount({ bad: undefined })).toBe(Number.MAX_SAFE_INTEGER);
    expect(payloadContentCharacterCount(cyclic)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('type-checks every trimmed dedicated-handler field before metering', () => {
    expect(careerPathSource).toContain(
      'typeof data.desiredRole !== "string" || !data.desiredRole.trim()',
    );
    expect(careerPathSource).toContain(
      'typeof data.marketName !== "string" || !data.marketName.trim()',
    );
    expect(mockInterviewSource).toContain(
      'data.jobDescription !== undefined && typeof data.jobDescription !== "string"',
    );
    expect(mockInterviewSource).toContain(
      'typeof data.question !== "string" || !data.question.trim()',
    );
    expect(mockInterviewSource).toContain(
      'typeof data.answer !== "string" || !data.answer.trim()',
    );
    expect(mockInterviewSource.indexOf('jobDescription must be a string.'))
      .toBeLessThan(mockInterviewSource.indexOf('const metered = await claimMeteredToolRun'));
  });
});
