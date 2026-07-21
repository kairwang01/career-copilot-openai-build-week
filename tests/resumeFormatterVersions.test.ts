import { describe, expect, it } from 'vitest';
import {
  getPreferredResumeFormatterVersion,
  getResumeFormatterVersions,
  getSavedResumeFormatterVersion,
  removeResumeFormatterVersion,
  upsertResumeFormatterVersion,
} from '../lib/resumeFormatterVersions';

describe('resumeFormatterVersions', () => {
  it('hydrates a legacy single saved resume as one market version', () => {
    const versions = getResumeFormatterVersions({
      formattedText: 'Canada resume',
      targetMarket: 'Canada',
      outputLanguage: 'en',
    });

    expect(Object.keys(versions)).toEqual(['Canada']);
    expect(versions.Canada.formattedText).toBe('Canada resume');
  });

  it('preserves existing markets when adding a new localized version', () => {
    const canada = upsertResumeFormatterVersion(null, {
      formattedText: 'Canada resume',
      targetMarket: 'Canada',
      outputLanguage: 'en',
    });
    const library = upsertResumeFormatterVersion(canada, {
      formattedText: 'UK resume',
      targetMarket: 'United Kingdom',
      outputLanguage: 'en',
    });

    expect(library.activeMarket).toBe('United Kingdom::en');
    expect(getSavedResumeFormatterVersion(library, 'Canada')?.formattedText).toBe('Canada resume');
    expect(getSavedResumeFormatterVersion(library, 'United Kingdom')?.formattedText).toBe('UK resume');
  });

  it('stores separate language versions for the same market', () => {
    const franceEnglish = upsertResumeFormatterVersion(null, {
      formattedText: 'France English resume',
      targetMarket: 'France',
      outputLanguage: 'en',
    });
    const library = upsertResumeFormatterVersion(franceEnglish, {
      formattedText: 'CV français',
      targetMarket: 'France',
      outputLanguage: 'local',
    });

    expect(getSavedResumeFormatterVersion(library, 'France', 'en')?.formattedText).toBe('France English resume');
    expect(getSavedResumeFormatterVersion(library, 'France', 'local')?.formattedText).toBe('CV français');
    expect(getPreferredResumeFormatterVersion(library, 'France', 'local')?.formattedText).toBe('CV français');
  });

  it('does not load a saved English version when the local-language version is requested', () => {
    const library = upsertResumeFormatterVersion(null, {
      formattedText: 'France English resume',
      targetMarket: 'France',
      outputLanguage: 'en',
    });

    expect(getSavedResumeFormatterVersion(library, 'France', 'local')).toBeNull();
    expect(getPreferredResumeFormatterVersion(library, 'France', 'local')).toBeNull();
  });

  it('does not load a saved local-language version when English is requested', () => {
    const library = upsertResumeFormatterVersion(null, {
      formattedText: 'CV français',
      targetMarket: 'France',
      outputLanguage: 'local',
    });

    expect(getSavedResumeFormatterVersion(library, 'France', 'en')).toBeNull();
    expect(getPreferredResumeFormatterVersion(library, 'France', 'en')).toBeNull();
  });

  it('loads the requested market before falling back to the active market', () => {
    const library = upsertResumeFormatterVersion(
      upsertResumeFormatterVersion(null, {
        formattedText: 'Canada resume',
        targetMarket: 'Canada',
        outputLanguage: 'en',
      }),
      {
        formattedText: 'Japan resume',
        targetMarket: 'Japan',
        outputLanguage: 'local',
      },
    );

    expect(getPreferredResumeFormatterVersion(library, 'Canada')?.formattedText).toBe('Canada resume');
    expect(getPreferredResumeFormatterVersion(library, 'Germany')?.formattedText).toBe('Japan resume');
  });

  it('falls back only to a same-language active version', () => {
    const library = upsertResumeFormatterVersion(
      upsertResumeFormatterVersion(null, {
        formattedText: 'Canada English resume',
        targetMarket: 'Canada',
        outputLanguage: 'en',
      }),
      {
        formattedText: 'CV japonais',
        targetMarket: 'Japan',
        outputLanguage: 'local',
      },
    );

    expect(getPreferredResumeFormatterVersion(library, 'Germany', 'local')?.formattedText).toBe('CV japonais');
    expect(getPreferredResumeFormatterVersion(library, 'Germany', 'en')?.formattedText).toBe('Canada English resume');
  });

  it('removes one market without deleting the other saved markets', () => {
    const library = upsertResumeFormatterVersion(
      upsertResumeFormatterVersion(null, {
        formattedText: 'Canada resume',
        targetMarket: 'Canada',
        outputLanguage: 'en',
      }),
      {
        formattedText: 'UK resume',
        targetMarket: 'United Kingdom',
        outputLanguage: 'en',
      },
    );

    const remaining = removeResumeFormatterVersion(library, 'United Kingdom', 'en');
    expect(remaining).not.toBeNull();
    expect(getSavedResumeFormatterVersion(remaining, 'United Kingdom')).toBeNull();
    expect(getSavedResumeFormatterVersion(remaining, 'Canada')?.formattedText).toBe('Canada resume');
  });
});
