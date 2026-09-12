/**
 * NOTIFY-002 Brevo End-to-End Simulation Test
 *
 * Verifies the complete lifecycle:
 *   1. BrevoEmailProvider dispatch.
 *   2. Outbox provider & provider_message_id matching.
 *   3. Inbound Brevo webhook normalization via BrevoWebhookAdapter.
 *   4. DeliveryStateService state transition to DELIVERED with delivered_at.
 *   5. Inbound Brevo bounce webhook triggering SHA-256 suppression.
 */

import { BrevoEmailProvider } from './providers/brevoEmailProvider.ts';
import { BrevoWebhookAdapter } from './webhooks/brevoWebhookAdapter.ts';
import { DeliveryStateService } from './deliveryStateService.ts';
import { computeEmailHash } from './suppression.ts';
import type { EmailMessage } from './emailProvider.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[BrevoE2EAssertion] ${message}`);
  }
}

async function runBrevoE2ETest(): Promise<void> {
  console.log('=== NOTIFY-002 Brevo E2E Lifecycle Simulation Test ===\n');

  // In-memory audit tracking
  const recordedEvents = new Set<string>();
  const outboxUpdates: Array<{ id: string; status: string; provider?: string }> = [];
  const recordedSuppressions: Array<{ emailHash: string; reason: string }> = [];

  const mockStore = {
    async recordWebhookEventIdempotent(provider: string, eventId: string): Promise<boolean> {
      const key = `${provider}:${eventId}`;
      if (recordedEvents.has(key)) return false;
      recordedEvents.add(key);
      return true;
    },
    async updateDeliveryStatusByProviderMessageId(
      providerMessageId: string,
      status: any,
      _timestamp?: Date,
      provider?: string,
    ): Promise<boolean> {
      outboxUpdates.push({ id: providerMessageId, status, provider });
      return true;
    },
    async recordEmailSuppression(emailHash: string, reason: any): Promise<void> {
      recordedSuppressions.push({ emailHash, reason });
    },
  };

  // 1. Transactional Sending
  console.log('Step 1: Dispatching transactional message via BrevoEmailProvider...');
  const provider = new BrevoEmailProvider();

  const message: EmailMessage = {
    to: 'recipient@cowatch.tv',
    from: 'CoWatch <noreply@cowatch.tv>',
    subject: 'Watch Party Ready',
    html: '<h1>Your room is ready</h1>',
    text: 'Your room is ready',
    idempotencyKey: `brevo-e2e-${Date.now()}`,
  };

  const sendResult = await provider.send(message);
  assert(sendResult.accepted === true, 'Brevo must accept message');
  assert(sendResult.provider === 'brevo', 'Provider must be brevo');
  assert(
    typeof sendResult.providerMessageId === 'string' && sendResult.providerMessageId.length > 0,
    'Provider message ID must be present',
  );
  console.log(`  PASS: Brevo accepted message with ID: ${sendResult.providerMessageId}`);

  // 2. Webhook Ingress & Normalization
  console.log('Step 2: Simulating inbound Brevo delivered webhook...');
  const brevoAdapter = new BrevoWebhookAdapter();

  const deliveredWebhookReq: any = {
    headers: {},
    body: {
      event: 'delivered',
      email: message.to,
      'message-id': sendResult.providerMessageId,
      id: `evt_brevo_del_${Date.now()}`,
      date: new Date().toISOString(),
    },
  };

  const normalizedDeliveredEvents = brevoAdapter.normalizePayload(deliveredWebhookReq);
  assert(normalizedDeliveredEvents.length === 1, 'Must normalize 1 delivery event');
  const delEvent = normalizedDeliveredEvents[0];
  assert(delEvent.provider === 'brevo', 'Event provider must be brevo');
  assert(delEvent.providerMessageId === sendResult.providerMessageId, 'Message ID must correlate');
  assert(delEvent.normalizedStatus === 'DELIVERED', 'Status must be DELIVERED');
  console.log('  PASS: Delivered webhook normalized to canonical EmailDeliveryEvent');

  // 3. DeliveryStateService Processing
  console.log('Step 3: Processing normalized delivery event through DeliveryStateService...');
  const deliveryService = new DeliveryStateService(mockStore);
  const deliveryResult = await deliveryService.processDeliveryEvent(delEvent);
  assert(
    deliveryResult.status === 'processed',
    'DeliveryStateService must successfully handle event',
  );
  assert(
    outboxUpdates.some((u) => u.id === sendResult.providerMessageId && u.status === 'DELIVERED'),
    'Outbox status must be updated to DELIVERED via composite provider key',
  );
  console.log(`  PASS: DeliveryStateService processed event and updated outbox status to DELIVERED`);

  // 4. Negative Event & Automated Suppression
  console.log('Step 4: Simulating inbound Brevo hard_bounce webhook and SHA-256 suppression...');
  const bounceWebhookReq: any = {
    headers: {},
    body: {
      event: 'hard_bounce',
      email: 'invalid-user@external-bounce.com',
      'message-id': `<bounce-${Date.now()}@brevo.com>`,
      id: `evt_brevo_bnc_${Date.now()}`,
      date: new Date().toISOString(),
      reason: '550 5.1.1 User unknown',
    },
  };

  const normalizedBounceEvents = brevoAdapter.normalizePayload(bounceWebhookReq);
  assert(normalizedBounceEvents.length === 1, 'Must normalize 1 bounce event');
  const bounceEvent = normalizedBounceEvents[0];
  assert(bounceEvent.normalizedStatus === 'BOUNCED', 'Must map to BOUNCED');

  const expectedSuppressionHash = computeEmailHash('invalid-user@external-bounce.com');
  const bounceResult = await deliveryService.processDeliveryEvent(bounceEvent);
  assert(bounceResult.status === 'processed', 'Bounce event must be processed');
  assert(
    recordedSuppressions.some((s) => s.emailHash === expectedSuppressionHash && s.reason === 'bounced'),
    'Recipient email must be hashed with SHA-256 and added to suppressions',
  );
  console.log(`  PASS: Bounce event computed suppression hash: ${expectedSuppressionHash.slice(0, 8)}... and auto-suppressed`);

  console.log('\nBrevo End-to-End Simulation Test Passed with Zero Failures!\n');
}

runBrevoE2ETest().catch((err) => {
  console.error('Brevo E2E test failure:', err);
  process.exit(1);
});
