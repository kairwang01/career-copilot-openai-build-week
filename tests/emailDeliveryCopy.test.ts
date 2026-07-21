import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const locales = ['en', 'fr', 'de', 'ar', 'ja', 'vi', 'zh'] as const;
const root = new URL('../', import.meta.url);

const dictionaries = Object.fromEntries(
  locales.map((locale) => [
    locale,
    JSON.parse(readFileSync(new URL(`localization/${locale}.json`, root), 'utf8')) as Record<string, string>,
  ]),
) as Record<(typeof locales)[number], Record<string, string>>;

const sentClaims: Record<(typeof locales)[number], RegExp> = {
  en: /\b(?:sent|we sent)\b/i,
  fr: /envoyé|nous avons envoyé/i,
  de: /gesendet|haben.+gesendet/i,
  ar: /تم الإرسال|أرسلنا/u,
  ja: /送信しました|お送りしました/u,
  vi: /đã gửi|chúng tôi đã gửi/iu,
  zh: /已发送|发送了/u,
};

const conditionalReset: Record<(typeof locales)[number], RegExp> = {
  en: /if this address/i,
  fr: /si cette adresse/i,
  de: /wenn diese adresse/i,
  ar: /إذا كان/u,
  ja: /場合/u,
  vi: /nếu địa chỉ/iu,
  zh: /如果该地址/u,
};

describe('transactional email copy', () => {
  it.each(locales)('does not claim inbox delivery in %s', (locale) => {
    const dictionary = dictionaries[locale];
    for (const key of [
      'verify_gate_resent',
      'auth_signup_success_verify',
      'auth_message_reset_link_sent',
    ]) {
      expect(dictionary[key], `${locale}:${key}`).not.toMatch(sentClaims[locale]);
    }
  });

  it.each(locales)('keeps reset confirmation non-enumerating in %s', (locale) => {
    expect(dictionaries[locale].auth_message_reset_link_sent).toMatch(conditionalReset[locale]);
  });

  it.each(locales)('keeps the generated public mirror exact in %s', (locale) => {
    const published = JSON.parse(
      readFileSync(new URL(`public/localization/${locale}.json`, root), 'utf8'),
    ) as Record<string, string>;
    expect(published).toEqual(dictionaries[locale]);
  });
});
