import { describe, expect, it } from 'vitest';
import {
  candidateAnalysisLanguageProtocol,
  chatLanguageProtocol,
  coverLetterLanguageProtocol,
  employerAnalysisLanguageProtocol,
  interviewLanguageProtocol,
  languageNameFromCode,
} from '../functions/src/llm/languageProtocol';

describe('multilingual prompt protocol', () => {
  it('maps UI language codes (with regions) to language names', () => {
    expect(languageNameFromCode('zh')).toBe('Simplified Chinese');
    expect(languageNameFromCode('zh-CN')).toBe('Simplified Chinese');
    expect(languageNameFromCode('fr-CA')).toBe('French');
    expect(languageNameFromCode('en')).toBe('English');
    expect(languageNameFromCode('')).toBeNull();
    expect(languageNameFromCode(undefined)).toBeNull();
    expect(languageNameFromCode('xx-unknown')).toBeNull();
  });

  it('candidate protocol: prose in UI language, keywords in the market hiring language', () => {
    const block = candidateAnalysisLanguageProtocol({ outputLanguage: 'zh', marketName: 'Canada' });
    expect(block).toContain('Simplified Chinese');
    expect(block).toContain('Canada');
    expect(block).toMatch(/hiring language/);
    expect(block).toMatch(/top improvement/); // language-mismatch must be surfaced
    expect(block).toMatch(/never let the document's language lower/);
  });

  it('candidate protocol falls back to mirroring the input language when no UI language is known', () => {
    const block = candidateAnalysisLanguageProtocol({});
    expect(block).toMatch(/dominant language of the user's input/);
  });

  it('employer protocol: fairness across document languages', () => {
    const block = employerAnalysisLanguageProtocol({ outputLanguage: 'fr' });
    expect(block).toContain('French');
    expect(block).toMatch(/not on the language their documents are written in/);
    expect(block).toMatch(/explicitly requires proficiency/);
  });

  it('chat protocol mirrors the user and uses the UI language only as a tiebreaker', () => {
    const block = chatLanguageProtocol({ outputLanguage: 'ja' });
    expect(block).toMatch(/language of the user's most recent message/);
    expect(block).toContain('default to Japanese');
    const noHint = chatLanguageProtocol({});
    expect(noHint).not.toMatch(/default to/);
  });

  it('interview protocol: questions in the job language, coaching in the UI language', () => {
    const block = interviewLanguageProtocol({ outputLanguage: 'zh' });
    expect(block).toContain('Simplified Chinese');
    expect(block).toMatch(/job description's language/);
    expect(block).toMatch(/do not translate the interview itself/i);
    expect(block).toMatch(/do not penalize grammar/);
  });

  it('cover letter protocol: explicit user language wins, else market business language', () => {
    const explicit = coverLetterLanguageProtocol({ outputLanguage: 'zh', marketName: 'Canada' });
    expect(explicit).toMatch(/entirely in Simplified Chinese/);
    const marketDefault = coverLetterLanguageProtocol({ marketName: 'Germany' });
    expect(marketDefault).toMatch(/Germany job market/);
    expect(marketDefault).toMatch(/primary business language is not English/);
  });
});
