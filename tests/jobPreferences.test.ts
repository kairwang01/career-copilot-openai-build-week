import { describe, expect, it } from 'vitest';
import {
  normalizeJobPreferences,
  preferencesToPromptBlock,
  prefsSummaryLine,
} from '../hooks/useJobPreferences';

describe('job preferences helpers', () => {
  it('normalizes account-stored preferences before reuse in tools', () => {
    expect(normalizeJobPreferences({
      status: 'active',
      roles: '  Frontend Engineer  ',
      locations: '  Ottawa, Remote  ',
      salaryMin: '90000',
      availability: '  2 weeks  ',
      ignored: 'field',
    })).toEqual({
      status: 'active',
      roles: 'Frontend Engineer',
      locations: 'Ottawa, Remote',
      salaryMin: '90000',
      availability: '2 weeks',
    });
  });

  it('rejects malformed preferences instead of feeding bad data to search', () => {
    expect(normalizeJobPreferences({ status: 'admin', roles: 'CEO' })).toBeNull();
    expect(normalizeJobPreferences(null)).toBeNull();
  });

  it('renders a concise prompt block and visible summary from saved preferences', () => {
    const prefs = normalizeJobPreferences({
      status: 'open',
      roles: 'Product Manager',
      locations: 'Toronto',
      salaryMin: '110000 CAD',
      availability: '',
    });

    expect(prefs).not.toBeNull();
    expect(prefsSummaryLine(prefs!)).toBe('Product Manager · Toronto · 110000 CAD');
    expect(preferencesToPromptBlock(prefs!)).toContain('Target roles: Product Manager');
  });
});
