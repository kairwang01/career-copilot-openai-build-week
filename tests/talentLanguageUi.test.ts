import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import LanguageSwitcher, { SUPPORTED_LANGUAGES } from '../components/LanguageSwitcher';
import { TALENT_PROFILE_SCHEMA } from '../lib/talentProfile';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

const uiKeys = [
  'language_switcher_label',
  'talent_profile_optional',
  'talent_profile_select_placeholder',
  'talent_profile_remove_value',
  'talent_profile_add_item_input',
  'talent_profile_reviewed',
  'talent_profile_add_group_placeholder',
  'talent_profile_group_skills_label',
  'talent_profile_new_item',
  'talent_profile_remove_item',
  'talent_profile_remove',
  'talent_profile_add_item',
  'talent_profile_resume_required',
  'talent_profile_prefill_success',
  'talent_profile_prefill_no_empty',
  'talent_profile_selected_language',
  'talent_profile_prefill_error',
  'talent_profile_draft_cleared',
  'talent_profile_validation_fix',
  'talent_profile_validation_email',
  'talent_profile_validation_date',
  'talent_profile_validation_end_date',
  'talent_profile_validation_gpa',
  'talent_profile_validation_gpa_scale',
  'talent_profile_validation_gpa_exceeds_scale',
  'talent_profile_load_error',
  'talent_profile_retry',
  'talent_profile_loading',
  'talent_profile_save_error',
  'talent_profile_save',
  'talent_profile_save_apply',
  'talent_profile_title',
  'talent_profile_subtitle',
  'talent_profile_reading_your_resume',
  'talent_profile_prefill_from_resume',
  'talent_profile_ready',
  'talent_profile_incomplete',
  'talent_profile_saved',
  'talent_profile_review_title',
  'talent_profile_review_description_one',
  'talent_profile_review_description_many',
  'talent_profile_accept_all',
  'talent_profile_clear_draft',
  'talent_profile_jump_to',
  'talent_profile_show_fewer',
  'talent_profile_show_more',
  'talent_profile_validation_summary_one',
  'talent_profile_validation_summary_many',
  'talent_profile_validation_more',
  'talent_profile_prefill_eyebrow',
  'talent_profile_prefill_dialog_title',
  'talent_profile_prefill_dialog_description',
  'talent_profile_prefill_dialog_close',
  'talent_profile_prefill_output_language',
  'talent_profile_prefill_warning',
  'talent_profile_cancel',
  'talent_profile_reading_resume',
  'talent_profile_prefill_draft',
  ...['en', 'fr', 'zh', 'es', 'de', 'ja', 'vi', 'ar', 'source'].flatMap((language) => [
    `talent_profile_prefill_language_${language}_label`,
    `talent_profile_prefill_language_${language}_note`,
  ]),
] as const;

const schemaKeys = TALENT_PROFILE_SCHEMA.flatMap((section) => {
  const keys: string[] = [`talent_profile_section_${section.id}`];
  if (section.kind === 'skills') {
    section.groups.forEach((group) => keys.push(`talent_profile_skill_${group.key}_label`));
    return keys;
  }
  if (section.kind === 'list') keys.push(`talent_profile_item_${section.id}`);
  section.fields.forEach((field) => {
    const prefix = `talent_profile_field_${section.id}_${field.key}`;
    keys.push(`${prefix}_label`);
    if (field.placeholder) keys.push(`${prefix}_placeholder`);
    if (field.help) keys.push(`${prefix}_help`);
    field.options?.forEach((_, index) => keys.push(`${prefix}_option_${index}`));
  });
  return keys;
});

describe('talent profile and language UI contracts', () => {
  it('renders every supported language with its correct autonym and unique native select labels', () => {
    expect(SUPPORTED_LANGUAGES).toEqual([
      { code: 'en', name: 'English' },
      { code: 'fr', name: 'Français' },
      { code: 'zh', name: '中文' },
      { code: 'ja', name: '日本語' },
      { code: 'de', name: 'Deutsch' },
      { code: 'vi', name: 'Tiếng Việt' },
      { code: 'ar', name: 'العربية' },
    ]);

    const markup = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(LanguageSwitcher, {
          currentLang: 'en',
          onLanguageChange: vi.fn(),
        }),
        React.createElement(LanguageSwitcher, {
          currentLang: 'ar',
          onLanguageChange: vi.fn(),
          variant: 'footer',
        }),
      ),
    );

    const selectIds = [...markup.matchAll(/<select[^>]*\sid="([^"]+)"/g)].map((match) => match[1]);
    const labelTargets = [...markup.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map((match) => match[1]);

    expect(selectIds).toHaveLength(2);
    expect(new Set(selectIds).size).toBe(2);
    expect(labelTargets).toEqual(selectIds);
    expect(markup).not.toContain('role="listbox"');
  });

  it.each(['en', 'fr', 'de', 'ar', 'ja', 'vi', 'zh'])(
    'defines and mirrors all Talent Profile customer-facing copy in %s',
    (locale) => {
      const canonical = JSON.parse(read(`localization/${locale}.json`)) as Record<string, string>;
      const publicMirror = JSON.parse(read(`public/localization/${locale}.json`)) as Record<string, string>;

      const requiredKeys = [...uiKeys, ...schemaKeys];
      expect(
        requiredKeys.filter((key) => typeof canonical[key] !== 'string' || !canonical[key].trim()),
        `${locale} missing or blank keys`,
      ).toEqual([]);
      expect(
        requiredKeys.filter((key) => publicMirror[key] !== canonical[key]),
        `public/${locale} mirror mismatches`,
      ).toEqual([]);
      for (const key of requiredKeys) {
        expect(publicMirror[key], `public/${locale}:${key}`).toBe(canonical[key]);
      }
    },
  );

  it('keeps the long form named, responsive, keyboard-safe, and logical-direction aware', () => {
    const source = read('components/TalentProfileForm.tsx');

    for (const contract of [
      'aria-expanded={isOpen}',
      'aria-controls={panelId}',
      'aria-labelledby={triggerId}',
      'hidden={!isOpen}',
      'aria-busy={saving || withdrawingDiscovery}',
      'role={prefillMsg.kind === \'error\' ? \'alert\' : \'status\'}',
      'min-h-0 flex-1 overflow-y-auto',
      'window.visualViewport',
      'lg:start-64',
      'sm:pe-24',
      'rtl:rotate-180',
    ]) {
      expect(source).toContain(contract);
    }

    for (const physicalOrHardcodedContract of [
      'lg:left-64',
      'sm:pr-24',
      'sm:mr-auto',
      'text-left',
      '>Talent Profile<',
      '>Review filled fields<',
      '>Choose the draft language<',
      '>Output language<',
      '>Save & apply<',
    ]) {
      expect(source).not.toContain(physicalOrHardcodedContract);
    }
  });
});
