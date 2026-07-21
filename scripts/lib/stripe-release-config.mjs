export const STRIPE_PRICE_EXPECTATIONS = Object.freeze({
  STRIPE_PRICE_ESSENTIALS: {
    type: 'recurring',
    unitAmount: 1900,
    lookupKey: 'career_copilot_essentials_cad_monthly',
  },
  STRIPE_PRICE_ACCELERATOR: {
    type: 'recurring',
    unitAmount: 3900,
    lookupKey: 'career_copilot_accelerator_cad_monthly',
  },
  STRIPE_PRICE_EXECUTIVE: {
    type: 'recurring',
    unitAmount: 7900,
    lookupKey: 'career_copilot_executive_cad_monthly',
  },
  STRIPE_PRICE_STARTER: {
    type: 'recurring',
    unitAmount: 7900,
    lookupKey: 'career_copilot_starter_cad_monthly',
  },
  STRIPE_PRICE_GROWTH: {
    type: 'recurring',
    unitAmount: 19900,
    lookupKey: 'career_copilot_growth_cad_monthly',
  },
  STRIPE_PRICE_PRO: {
    type: 'recurring',
    unitAmount: 49900,
    lookupKey: 'career_copilot_pro_cad_monthly',
  },
  STRIPE_PRICE_PACK_100: {
    type: 'one_time',
    unitAmount: 300,
    lookupKey: 'career_copilot_pack_100_cad_once',
  },
  STRIPE_PRICE_PACK_500: {
    type: 'one_time',
    unitAmount: 900,
    lookupKey: 'career_copilot_pack_500_cad_once',
  },
  STRIPE_PRICE_PACK_1000: {
    type: 'one_time',
    unitAmount: 1500,
    lookupKey: 'career_copilot_pack_1000_cad_once',
  },
});

export const REQUIRED_PRICE_KEYS = Object.freeze(
  Object.keys(STRIPE_PRICE_EXPECTATIONS),
);

const RELEASE_CONFIG_KEYS = Object.freeze([
  'APP_BASE_URL',
  'BILLING_SIMULATION',
  ...REQUIRED_PRICE_KEYS,
]);

export function canonicalizeStripeReleaseConfig(config) {
  return `${RELEASE_CONFIG_KEYS.map(
    (key) => `${key}=${String(config[key] ?? '')}`,
  ).join('\n')}\n`;
}

export function parseDotEnvText(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) continue;
    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}
