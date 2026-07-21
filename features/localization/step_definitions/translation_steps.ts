
import {After, Given, Then} from '@cucumber/cucumber';
import {OurWorld} from '../types';
import {strict as assert} from 'assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TRANSLATION_DIR = 'localization';

const loadTranslations = () => {
  const translations: {[key: string]: any} = {};
  const files = readdirSync(TRANSLATION_DIR);
  for (const file of files) {
    if (file.endsWith('.json')) {
      const lang = file.split('.')[0];
      const data = readFileSync(join(TRANSLATION_DIR, file), 'utf8');
      translations[lang] = JSON.parse(data);
    }
  }
  return translations;
};

const allTranslations = loadTranslations();
const englishKeys = new Set(Object.keys(allTranslations['en']));

// Validate that all language files have the same keys as the English file
for (const lang in allTranslations) {
  if (lang !== 'en') {
    const langKeys = new Set(Object.keys(allTranslations[lang]));
    for (const key of englishKeys) {
      if (!langKeys.has(key)) {
        throw new Error(`Missing key in ${lang}.json: ${key}`);
      }
    }
    for (const key of langKeys) {
      if (!englishKeys.has(key)) {
        throw new Error(`Extra key in ${lang}.json: ${key}`);
      }
    }
  }
}

Given('the user selects the language {string}', async function (this: OurWorld, lang: string) {
  const {
    page,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    playwright,
  } = this;
  await page.waitForLoadState('networkidle');

  const openMenuButton = await page.locator('button:has(img.rounded-full)');
  if (await openMenuButton.isVisible()) {
    await openMenuButton.click();
    await page.selectOption('select#language-select', lang);
  } else {
    // If not logged in, we can't switch languages via UI.
    // Instead, we'll set it in localStorage and reload.
    await page.evaluate(
      (langToSet: string) => {
        localStorage.setItem('preferred_language', langToSet);
      },
      [lang],
    );
    await page.reload();
  }
});

Then('the text {string} should be translated to {string} in {string}', async function (this: OurWorld, key: string, expectedText: string, lang: string) {
  const {
    page,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    playwright,
  } = this;
  await page.waitForLoadState('networkidle');

  // Verify the translation from the loaded JSON files
  const translatedText = allTranslations[lang][key];
  assert.equal(translatedText, expectedText, `Translation for key "${key}" in "${lang}" does not match.`);

  // Additionally, check if the text appears correctly on the page
  // This is more of an integration test, but useful here.
  const element = await page.locator(`text=${expectedText}`);
  await element.waitFor({state: 'visible', timeout: 5000});
  assert.ok(await element.isVisible(), `Expected text "${expectedText}" not visible on page.`);
});
