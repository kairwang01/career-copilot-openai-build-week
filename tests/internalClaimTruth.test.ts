import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const locales = ['en', 'fr', 'de', 'ar', 'ja', 'vi', 'zh'] as const;

const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const dictionary = (locale: (typeof locales)[number], published = false) =>
  JSON.parse(
    read(published ? `public/localization/${locale}.json` : `localization/${locale}.json`),
  ) as Record<string, string>;

const previewSource = read('marketing/components/FeatureShowcase.tsx');
const toolSource = read('marketing/components/ToolLibrary.tsx');

const previewKeys = [...new Set(previewSource.match(/site_preview_[a-z0-9_]+/g) ?? [])].sort();
const toolIds = [...toolSource.matchAll(/key:\s*'([a-z0-9_]+)'/g)].map((match) => match[1]);
const toolCardKeys = toolIds.flatMap((id) =>
  ['name', 'desc', 'result'].map((field) => `site_tool_card_${id}_${field}`),
);
const runtimeMarketingKeys = [...previewKeys, ...toolCardKeys];

describe('internal and marketing claim truth', () => {
  it('discovers every runtime-generated preview and tool-card key from the components', () => {
    expect(previewKeys).toHaveLength(35);
    expect(toolIds).toHaveLength(15);
    expect(new Set(toolIds)).toHaveLength(15);
    expect(toolCardKeys).toHaveLength(45);
    expect(runtimeMarketingKeys).toHaveLength(80);
  });

  it.each(locales)('defines all runtime marketing keys in canonical %s', (locale) => {
    const values = dictionary(locale);

    for (const key of runtimeMarketingKeys) {
      expect(values[key], `${locale}:${key}`).toBeTypeOf('string');
      expect(values[key]?.trim(), `${locale}:${key}`).not.toBe('');
      expect(values[key], `${locale}:${key}`).not.toBe(key);
    }
  });

  it.each(locales)('keeps canonical and published %s dictionaries identical', (locale) => {
    expect(dictionary(locale, true)).toEqual(dictionary(locale));
  });

  it.each(locales.filter((locale) => locale !== 'en'))(
    'provides localized copy instead of wholesale English fallback in %s',
    (locale) => {
      const english = dictionary('en');
      const translated = dictionary(locale);
      const localizedCount = runtimeMarketingKeys.filter(
        (key) => translated[key] !== english[key],
      ).length;

      expect(localizedCount).toBeGreaterThanOrEqual(75);
    },
  );

  it.each(locales)('removes obsolete footer fragments and the stale six-tool count in %s', (locale) => {
    const values = dictionary(locale);

    expect(values.footer_launch_prefix).toBeUndefined();
    expect(values.footer_launch_suffix).toBeUndefined();
    expect(values.site_tool_library_title).not.toMatch(
      /\bsix\b|\b6\b|六件|六个|sechs|ست أدوات|6つ|sáu công cụ/i,
    );
  });

  it('keeps English tool cards within implemented and reviewable boundaries', () => {
    const english = dictionary('en');

    expect(english.site_tool_card_mock_interview_desc).toMatch(
      /does not predict or represent an employer decision/i,
    );
    expect(english.site_tool_card_opportunity_finder_desc).toMatch(
      /confirm availability on the original listing/i,
    );
    expect(english.site_tool_card_event_scout_desc).toMatch(
      /verify organizer, date, price, and availability/i,
    );
    expect(english.site_tool_card_agile_prep_desc).toMatch(/unofficial practice/i);
    expect(english.site_tool_card_english_coach_desc).toMatch(
      /not an official test, score, or certification/i,
    );
    expect(english.site_preview_jobs_review).toMatch(/fictional.*not a verified employee review/i);
    expect(english.site_preview_tracking_update_body).toMatch(/confirm.*with the employer/i);
  });

  it.each(locales)('presents mock-interview output as practice feedback in %s', (locale) => {
    const values = dictionary(locale);
    const mockInterviewCopy = Object.entries(values)
      .filter(([key]) => key.startsWith('mi_'))
      .map(([, value]) => value)
      .join(' ');
    const verdictCopy = Object.entries(values)
      .filter(([key]) => key.startsWith('mi_verdict_'))
      .map(([, value]) => value)
      .join(' ');

    expect(mockInterviewCopy).not.toMatch(
      /100[,.]?000\+?|100\.000|10\s*万|95\s*%|90\s*%|prediction accuracy|预测准确率|命中率|senior interviewers|interviewers calibrate/i,
    );
    expect(verdictCopy).not.toMatch(
      /Strong Hire|Forte recommandation|Stark empfehlenswert|توظيف بقوة|強く推す|Rất tiềm năng|强烈推荐/i,
    );
  });
});
