import { describe, expect, it } from 'vitest';

import { isSuccessfulProbeResponse } from '../functions/src/handlers/adminTestModel';
import { resolveGeminiApiKey } from '../functions/src/llm/providers/geminiProvider';

describe('admin model connection probe', () => {
  it('accepts only the exact OK probe token apart from case and whitespace', () => {
    expect(isSuccessfulProbeResponse(' OK\n')).toBe(true);
    expect(isSuccessfulProbeResponse('ok')).toBe(true);
    expect(isSuccessfulProbeResponse('OK.')).toBe(false);
    expect(isSuccessfulProbeResponse('<html>OK</html>')).toBe(false);
    expect(isSuccessfulProbeResponse('')).toBe(false);
  });

  it('uses the ad-hoc Gemini key instead of silently testing the saved key', () => {
    expect(resolveGeminiApiKey('new-ad-hoc-key')).toBe('new-ad-hoc-key');
  });
});
