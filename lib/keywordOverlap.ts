const STOP_WORDS = new Set([
  'about', 'all', 'and', 'are', 'been', 'but', 'can', 'for', 'from', 'has',
  'have', 'into', 'not', 'our', 'over', 'such', 'that', 'the', 'their',
  'they', 'this', 'use', 'were', 'what', 'when', 'which', 'who', 'will',
  'with', 'you', 'your',
]);

const CJK_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

const tokenize = (value: string): Set<string> => {
  const tokens = new Set<string>();
  const words: string[] = [
    ...(value.toLocaleLowerCase().match(/[\p{L}\p{N}+#.]{2,}/gu) ?? []),
  ];

  words.forEach((word) => {
    if (CJK_CHARACTER.test(word)) {
      const characters = Array.from(word);
      if (characters.length === 1) tokens.add(characters[0]);
      for (let index = 0; index < characters.length - 1; index += 1) {
        tokens.add(`${characters[index]}${characters[index + 1]}`);
      }
      return;
    }

    if (word.length > 2 && !STOP_WORDS.has(word)) tokens.add(word);
  });

  return tokens;
};

/**
 * Returns the percentage of unique posting terms found in the resume.
 * This is a lexical estimate, not an AI assessment or hiring prediction.
 */
export const lexicalKeywordOverlapScore = (resume: string, posting: string): number => {
  const resumeTokens = tokenize(resume);
  const postingTokens = tokenize(posting);
  if (resumeTokens.size === 0 || postingTokens.size === 0) return 0;

  let matches = 0;
  postingTokens.forEach((token) => {
    if (resumeTokens.has(token)) matches += 1;
  });

  return Math.round((matches / postingTokens.size) * 100);
};
