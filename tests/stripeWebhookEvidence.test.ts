import { describe, expect, it } from 'vitest';
import { validateStripeWebhookReleaseEvidence } from '../scripts/lib/stripe-webhook-release-evidence.mjs';

const approvedSha = 'a'.repeat(40);
const expectedHashes = {
  configSha256: '1'.repeat(64),
  contractSha256: '2'.repeat(64),
  recorderSha256: '3'.repeat(64),
  validatorSha256: '4'.repeat(64),
  webhookSourceSha256: '5'.repeat(64),
  stripeLiveEvidenceSha256: '6'.repeat(64),
  workbenchArtifactSha256: '7'.repeat(64),
  firestoreArtifactSha256: '8'.repeat(64),
};
const endpointUrl =
  'https://us-central1-career-copilot-a3168.cloudfunctions.net/stripeWebhook';
const now = Date.parse('2026-07-13T22:00:00.000Z');

function validEvidence() {
  return {
    schemaVersion: 1,
    status: 'passed',
    approvedSha,
    checkedAt: '2026-07-13T21:59:00.000Z',
    project: 'career-copilot-a3168',
    region: 'us-central1',
    endpointId: 'we_123456789',
    endpointUrl,
    functionRevision: 'stripewebhook-00042-abc',
    operatorRef: 'operator-42',
    changeRecord: 'CHG-2026-0713',
    eventId: 'evt_123456789',
    eventType: 'checkout.session.completed',
    stripeEventCreatedAt: '2026-07-13T20:45:00.000Z',
    livemode: true,
    firstResentAt: '2026-07-13T21:55:00.000Z',
    replayResentAt: '2026-07-13T21:57:00.000Z',
    firstDeliveryHttpStatus: 200,
    replayDeliveryHttpStatus: 200,
    workbenchDeliveryVerified: true,
    firestoreLedgerVerified: true,
    ledgerStatus: 'completed',
    ledgerStripeEventId: 'evt_123456789',
    ledgerEventType: 'checkout.session.completed',
    ledgerLivemode: true,
    ledgerAttemptsBefore: 1,
    ledgerAttemptsAfterFirst: 1,
    ledgerAttemptsAfterReplay: 1,
    ledgerCompletedAtBefore: '2026-07-13T21:00:00.000Z',
    ledgerCompletedAtAfterReplay: '2026-07-13T21:00:00.000Z',
    ...expectedHashes,
  };
}

describe('Stripe signed-webhook release evidence', () => {
  it('accepts a fresh live event with two 2xx resends and an unchanged ledger', () => {
    expect(
      validateStripeWebhookReleaseEvidence(validEvidence(), {
        approvedSha,
        now,
        endpointUrl,
        endpointId: 'we_123456789',
        expectedHashes,
      }),
    ).toMatchObject({
      eventType: 'checkout.session.completed',
      functionRevision: 'stripewebhook-00042-abc',
    });
  });

  it('rejects stale, non-live, non-2xx, or mutating replay evidence', () => {
    const evidence = {
      ...validEvidence(),
      checkedAt: '2026-07-13T12:00:00.000Z',
      livemode: false,
      firstDeliveryHttpStatus: 500,
      ledgerAttemptsAfterReplay: 2,
      contractSha256: 'f'.repeat(64),
    };
    expect(() =>
      validateStripeWebhookReleaseEvidence(evidence, {
        approvedSha,
        now,
        endpointUrl,
        endpointId: 'we_123456789',
        expectedHashes,
      }),
    ).toThrow(/livemode must be true[\s\S]*firstDeliveryHttpStatus[\s\S]*attempt count[\s\S]*stale[\s\S]*contractSha256/);
  });

  it('rejects old resend timestamps even when the JSON was recorded recently', () => {
    const evidence = {
      ...validEvidence(),
      firstResentAt: '2026-07-01T10:00:00.000Z',
      replayResentAt: '2026-07-01T10:01:00.000Z',
    };
    expect(() =>
      validateStripeWebhookReleaseEvidence(evidence, {
        approvedSha,
        now,
        endpointUrl,
        endpointId: 'we_123456789',
        expectedHashes,
      }),
    ).toThrow(/firstResentAt is stale[\s\S]*replayResentAt is stale[\s\S]*30-minute/);
  });
});
