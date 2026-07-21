import { describe, expect, it, vi } from 'vitest';
import {
  verifyGitReleaseState,
  verifyStripeLiveConfiguration,
} from '../scripts/check-stripe-live.mjs';
import {
  canonicalizeStripeReleaseConfig,
  STRIPE_PRICE_EXPECTATIONS,
} from '../scripts/lib/stripe-release-config.mjs';

const webhookUrl =
  'https://us-central1-career-copilot-a3168.cloudfunctions.net/stripeWebhook';
const stripeApiVersion = '2026-05-27.dahlia';

const config = Object.fromEntries(
  Object.keys(STRIPE_PRICE_EXPECTATIONS).map((key, index) => [
    key,
    `price_LiveContract${String(index).padStart(2, '0')}`,
  ]),
);

function createStripe(overrides: Record<string, Partial<Record<string, unknown>>> = {}) {
  const priceKeyById = new Map(
    Object.entries(config).map(([key, id]) => [id, key]),
  );
  const listWebhookEndpoints = vi.fn<
    () => Promise<{ data: Array<Record<string, unknown>>; has_more?: boolean }>
  >(async () => ({
    data: [
      {
        url: webhookUrl,
        id: 'we_production',
        status: 'enabled',
        livemode: true,
        application: null,
        api_version: stripeApiVersion,
        enabled_events: [
          'checkout.session.completed',
          'checkout.session.async_payment_succeeded',
          'checkout.session.async_payment_failed',
          'customer.subscription.deleted',
          'invoice.payment_failed',
          'invoice.payment_succeeded',
        ],
      },
    ],
  }));
  return {
    prices: {
      retrieve: vi.fn(async (id: string) => {
        const key = priceKeyById.get(id) as keyof typeof STRIPE_PRICE_EXPECTATIONS;
        const expectation = STRIPE_PRICE_EXPECTATIONS[key];
        return {
          id,
          livemode: true,
          active: true,
          currency: 'cad',
          type: expectation.type,
          recurring:
            expectation.type === 'recurring'
              ? { interval: 'month', interval_count: 1, usage_type: 'licensed' }
              : null,
          unit_amount: expectation.unitAmount,
          lookup_key: expectation.lookupKey,
          product: { id: `prod_${id}`, active: true },
          ...overrides[key],
        };
      }),
    },
    webhookEndpoints: {
      list: listWebhookEndpoints,
    },
  };
}

describe('Stripe live production preflight', () => {
  it('normalizes release configuration deterministically without secret values', () => {
    const normalized = canonicalizeStripeReleaseConfig({
      STRIPE_SECRET_KEY: 'sk_live_must_not_be_serialized',
      STRIPE_PRICE_ESSENTIALS: 'price_essential',
      APP_BASE_URL: 'https://copilot.kairwang.cloud',
    });
    expect(normalized).toContain('APP_BASE_URL=https://copilot.kairwang.cloud');
    expect(normalized).toContain('STRIPE_PRICE_ESSENTIALS=price_essential');
    expect(normalized).not.toContain('sk_live_');
  });

  it('binds live checks to the approved clean Git revision', () => {
    const approvedSha = 'a'.repeat(40);
    expect(() =>
      verifyGitReleaseState({ approvedSha, head: approvedSha, porcelain: '' }),
    ).not.toThrow();
    expect(() =>
      verifyGitReleaseState({ approvedSha, head: 'b'.repeat(40), porcelain: '' }),
    ).toThrow(/not the current Git HEAD/);
    expect(() =>
      verifyGitReleaseState({ approvedSha, head: approvedSha, porcelain: ' M file' }),
    ).toThrow(/clean Git worktree/);
  });

  it('accepts distinct active CAD live Prices and the required live webhook', async () => {
    const stripe = createStripe();
    await expect(
      verifyStripeLiveConfiguration({ stripe, config, webhookUrl, stripeApiVersion }),
    ).resolves.toEqual({
      pricesChecked: 9,
      webhookEventsChecked: 6,
      webhookEndpointId: 'we_production',
      stripeApiVersion,
    });
    expect(stripe.prices.retrieve).toHaveBeenCalledTimes(9);
  });

  it('rejects sandbox, inactive, wrong-mode, and incomplete webhook configuration', async () => {
    const stripe = createStripe({
      STRIPE_PRICE_ESSENTIALS: { livemode: false },
      STRIPE_PRICE_ACCELERATOR: { active: false },
      STRIPE_PRICE_EXECUTIVE: { type: 'one_time', recurring: null },
      STRIPE_PRICE_STARTER: {
        recurring: { interval: 'month', interval_count: 3, usage_type: 'licensed' },
      },
      STRIPE_PRICE_GROWTH: { unit_amount: 19800 },
      STRIPE_PRICE_PRO: { lookup_key: 'career_copilot_wrong_plan' },
    });
    stripe.webhookEndpoints.list.mockResolvedValueOnce({
      data: [
        {
          url: webhookUrl,
          status: 'enabled',
          livemode: true,
          application: null,
          api_version: stripeApiVersion,
          enabled_events: ['checkout.session.completed'],
        },
      ],
    });

    await expect(
      verifyStripeLiveConfiguration({ stripe, config, webhookUrl, stripeApiVersion }),
    ).rejects.toThrow(/sandbox Price[\s\S]*inactive Price[\s\S]*must be recurring[\s\S]*one-month licensed[\s\S]*amount does not match[\s\S]*wrong or missing stable lookup key[\s\S]*customer\.subscription\.deleted/);
  });

  it('rejects a reused Price ID and missing live endpoint', async () => {
    const duplicated = {
      ...config,
      STRIPE_PRICE_ACCELERATOR: config.STRIPE_PRICE_ESSENTIALS,
    };
    const stripe = createStripe();
    stripe.webhookEndpoints.list.mockResolvedValueOnce({ data: [] });

    await expect(
      verifyStripeLiveConfiguration({
        stripe,
        config: duplicated,
        webhookUrl,
        stripeApiVersion,
      }),
    ).rejects.toThrow(/distinct Price ID[\s\S]*live Stripe webhook endpoint is missing/);
  });

  it('rejects a Connect endpoint or an unpinned webhook API version', async () => {
    const stripe = createStripe();
    stripe.webhookEndpoints.list.mockResolvedValueOnce({
      data: [
        {
          url: webhookUrl,
          status: 'enabled',
          livemode: true,
          application: 'ca_connected_app',
          api_version: null,
          enabled_events: ['*'],
        },
      ],
    });

    await expect(
      verifyStripeLiveConfiguration({ stripe, config, webhookUrl, stripeApiVersion }),
    ).rejects.toThrow(/platform-account endpoint[\s\S]*API version must be pinned/);
  });

  it('paginates and accepts a later exact endpoint instead of a stale URL match', async () => {
    const stripe = createStripe();
    stripe.webhookEndpoints.list
      .mockResolvedValueOnce({
        has_more: true,
        data: [
          {
            id: 'we_stale',
            url: webhookUrl,
            status: 'enabled',
            livemode: true,
            application: null,
            api_version: '2025-01-01.old',
            enabled_events: ['*'],
          },
        ],
      })
      .mockResolvedValueOnce({
        has_more: false,
        data: [
          {
            id: 'we_current',
            url: webhookUrl,
            status: 'enabled',
            livemode: true,
            application: null,
            api_version: stripeApiVersion,
            enabled_events: ['*'],
          },
        ],
      });

    await expect(
      verifyStripeLiveConfiguration({ stripe, config, webhookUrl, stripeApiVersion }),
    ).resolves.toMatchObject({ pricesChecked: 9, webhookEventsChecked: 6 });
    expect(stripe.webhookEndpoints.list).toHaveBeenNthCalledWith(2, {
      limit: 100,
      starting_after: 'we_stale',
    });
  });

  it('accepts a later complete endpoint when an earlier exact endpoint is incomplete', async () => {
    const stripe = createStripe();
    stripe.webhookEndpoints.list.mockResolvedValueOnce({
      has_more: false,
      data: [
        {
          id: 'we_incomplete',
          url: webhookUrl,
          status: 'enabled',
          livemode: true,
          application: null,
          api_version: stripeApiVersion,
          enabled_events: ['checkout.session.completed'],
        },
        {
          id: 'we_complete',
          url: webhookUrl,
          status: 'enabled',
          livemode: true,
          application: null,
          api_version: stripeApiVersion,
          enabled_events: ['*'],
        },
      ],
    });

    await expect(
      verifyStripeLiveConfiguration({ stripe, config, webhookUrl, stripeApiVersion }),
    ).resolves.toMatchObject({ pricesChecked: 9, webhookEventsChecked: 6 });
  });
});
