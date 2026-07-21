export const STRIPE_WEBHOOK_RELEASE_EVENTS = Object.freeze([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'customer.subscription.deleted',
  'invoice.payment_failed',
  'invoice.payment_succeeded',
]);

function parseTimestamp(value, label, issues) {
  const timestamp = Date.parse(typeof value === 'string' ? value : '');
  if (!Number.isFinite(timestamp)) issues.push(`${label} must be an ISO timestamp.`);
  return timestamp;
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

export function validateStripeWebhookReleaseEvidence(
  evidence,
  {
    approvedSha,
    now = Date.now(),
    endpointUrl,
    endpointId,
    expectedHashes,
  },
) {
  const issues = [];
  if (evidence?.schemaVersion !== 1) issues.push('schemaVersion must be 1.');
  if (evidence?.status !== 'passed') issues.push('status must be passed.');
  if (evidence?.approvedSha !== approvedSha) {
    issues.push('approvedSha does not match this release.');
  }
  if (evidence?.project !== 'career-copilot-a3168') {
    issues.push('project does not match production.');
  }
  if (evidence?.region !== 'us-central1') {
    issues.push('region does not match production.');
  }
  if (!/^we_[A-Za-z0-9]+$/.test(evidence?.endpointId || '')) {
    issues.push('endpointId must be a Stripe webhook endpoint ID.');
  }
  if (evidence?.endpointId !== endpointId) {
    issues.push('endpointId does not match the live Stripe preflight.');
  }
  if (evidence?.endpointUrl !== endpointUrl) {
    issues.push('endpointUrl does not match the production Function.');
  }
  if (!/^[a-z0-9][a-z0-9-]{2,127}$/.test(evidence?.functionRevision || '')) {
    issues.push('functionRevision must identify the deployed revision.');
  }
  if (!/^[A-Za-z0-9._:@\/-]{3,128}$/.test(evidence?.operatorRef || '')) {
    issues.push('operatorRef must identify the approved operator.');
  }
  if (!/^[A-Za-z0-9._:@\/-]{3,128}$/.test(evidence?.changeRecord || '')) {
    issues.push('changeRecord must identify the reviewed release record.');
  }
  if (!/^evt_[A-Za-z0-9]+$/.test(evidence?.eventId || '')) {
    issues.push('eventId must be a Stripe event ID.');
  }
  if (!STRIPE_WEBHOOK_RELEASE_EVENTS.includes(evidence?.eventType)) {
    issues.push('eventType is not handled by the production webhook.');
  }
  if (evidence?.livemode !== true) issues.push('livemode must be true.');
  if (evidence?.workbenchDeliveryVerified !== true) {
    issues.push('Stripe Workbench delivery verification is required.');
  }
  if (evidence?.firestoreLedgerVerified !== true) {
    issues.push('Firestore ledger verification is required.');
  }
  if (
    !Number.isInteger(evidence?.firstDeliveryHttpStatus) ||
    evidence.firstDeliveryHttpStatus < 200 ||
    evidence.firstDeliveryHttpStatus >= 300
  ) {
    issues.push('firstDeliveryHttpStatus must be 2xx.');
  }
  if (
    !Number.isInteger(evidence?.replayDeliveryHttpStatus) ||
    evidence.replayDeliveryHttpStatus < 200 ||
    evidence.replayDeliveryHttpStatus >= 300
  ) {
    issues.push('replayDeliveryHttpStatus must be 2xx.');
  }
  if (evidence?.ledgerStatus !== 'completed') {
    issues.push('The webhook ledger must remain completed.');
  }
  if (evidence?.ledgerStripeEventId !== evidence?.eventId) {
    issues.push('The ledger Stripe event ID does not match.');
  }
  if (evidence?.ledgerEventType !== evidence?.eventType) {
    issues.push('The ledger event type does not match.');
  }
  if (evidence?.ledgerLivemode !== true) {
    issues.push('The ledger must record a live event.');
  }

  const attempts = [
    evidence?.ledgerAttemptsBefore,
    evidence?.ledgerAttemptsAfterFirst,
    evidence?.ledgerAttemptsAfterReplay,
  ];
  if (!attempts.every((value) => Number.isInteger(value) && value >= 1)) {
    issues.push('Ledger attempt counts must be positive integers.');
  } else if (attempts[0] !== attempts[1] || attempts[1] !== attempts[2]) {
    issues.push('Webhook replay changed the completed ledger attempt count.');
  }
  if (
    evidence?.ledgerCompletedAtBefore !== evidence?.ledgerCompletedAtAfterReplay
  ) {
    issues.push('Webhook replay changed the ledger completion timestamp.');
  }

  const completedAt = parseTimestamp(
    evidence?.ledgerCompletedAtBefore,
    'ledgerCompletedAtBefore',
    issues,
  );
  const stripeEventCreatedAt = parseTimestamp(
    evidence?.stripeEventCreatedAt,
    'stripeEventCreatedAt',
    issues,
  );
  const firstResentAt = parseTimestamp(
    evidence?.firstResentAt,
    'firstResentAt',
    issues,
  );
  const replayResentAt = parseTimestamp(
    evidence?.replayResentAt,
    'replayResentAt',
    issues,
  );
  const checkedAt = parseTimestamp(evidence?.checkedAt, 'checkedAt', issues);
  if (
    Number.isFinite(firstResentAt) &&
    Number.isFinite(replayResentAt) &&
    firstResentAt > replayResentAt
  ) {
    issues.push('The replay timestamp precedes the first resend.');
  }
  for (const [label, timestamp] of [
    ['firstResentAt', firstResentAt],
    ['replayResentAt', replayResentAt],
  ]) {
    if (
      !Number.isFinite(timestamp) ||
      timestamp > now + 5 * 60_000 ||
      now - timestamp > 6 * 60 * 60_000
    ) {
      issues.push(`${label} is stale or from the future.`);
    }
  }
  if (
    Number.isFinite(replayResentAt) &&
    Number.isFinite(checkedAt) &&
    replayResentAt > checkedAt
  ) {
    issues.push('The evidence was checked before the replay.');
  }
  if (
    Number.isFinite(replayResentAt) &&
    Number.isFinite(checkedAt) &&
    checkedAt - replayResentAt > 30 * 60_000
  ) {
    issues.push('The replay was not recorded within the 30-minute evidence window.');
  }
  if (
    Number.isFinite(completedAt) &&
    Number.isFinite(firstResentAt) &&
    completedAt > firstResentAt
  ) {
    issues.push('Use an event whose completed ledger existed before the resend.');
  }
  if (
    Number.isFinite(stripeEventCreatedAt) &&
    Number.isFinite(firstResentAt) &&
    stripeEventCreatedAt > firstResentAt
  ) {
    issues.push('The Stripe event creation timestamp follows the resend.');
  }
  if (
    !Number.isFinite(checkedAt) ||
    checkedAt > now + 5 * 60_000 ||
    now - checkedAt > 6 * 60 * 60_000
  ) {
    issues.push('Webhook evidence is stale or from the future.');
  }

  for (const [key, expected] of Object.entries(expectedHashes)) {
    if (!isSha256(evidence?.[key]) || evidence[key] !== expected) {
      issues.push(`${key} does not match this release.`);
    }
  }

  if (issues.length > 0) throw new Error(issues.join('\n'));
  return {
    checkedAt: evidence.checkedAt,
    eventType: evidence.eventType,
    functionRevision: evidence.functionRevision,
  };
}
