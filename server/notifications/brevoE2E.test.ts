import { BrevoWebhookAdapter } from './webhooks/brevoWebhookAdapter.ts';
import { DeliveryStateService, type DeliveryStateStore } from './deliveryStateService.ts';
import type { ProviderDeliveryStatus } from './notificationTypes.ts';
import { computeEmailHash } from './suppression.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('[BrevoWebhookTest] ' + message);
}

async function runBrevoWebhookTests(): Promise<void> {
  const recordedEvents = new Set<string>();
  const outboxUpdates: Array<{ id: string; status: string; provider?: string }> = [];
  const recordedSuppressions: Array<{ emailHash: string; reason: string }> = [];

  const mockStore: Partial<DeliveryStateStore> = {
    async recordWebhookEventIdempotent(provider: string, eventId: string, _eventType: string): Promise<boolean> {
      const key = provider + ':' + eventId;
      if (recordedEvents.has(key)) return false;
      recordedEvents.add(key);
      return true;
    },
    async updateDeliveryStatusByProviderMessageId(
      providerMessageId: string,
      status: ProviderDeliveryStatus,
      _timestamp?: Date,
      provider?: string,
    ): Promise<boolean> {
      outboxUpdates.push({ id: providerMessageId, status, provider });
      return true;
    },
    async recordEmailSuppression(emailHash: string, reason: 'bounced' | 'complained' | 'manual'): Promise<void> {
      recordedSuppressions.push({ emailHash, reason });
    },
  };

  const adapter = new BrevoWebhookAdapter();
  const deliveryService = new DeliveryStateService(mockStore);
  const messageId = 'brevo-message-1';
  const deliveredRequest = {
    headers: {},
    body: {
      event: 'delivered',
      email: 'recipient@cowatch.tv',
      'message-id': messageId,
      id: 'evt-delivered-1',
      date: new Date().toISOString(),
    },
  };
  const deliveredEvents = adapter.normalizePayload(deliveredRequest as never);
  assert(deliveredEvents.length === 1, 'Delivered event must normalize');
  assert(deliveredEvents[0].provider === 'brevo', 'Canonical provider must be brevo');
  assert(deliveredEvents[0].providerMessageId === messageId, 'Provider message ID must be retained');
  assert(deliveredEvents[0].normalizedStatus === 'DELIVERED', 'Delivered event must map to DELIVERED');

  const delivered = await deliveryService.processDeliveryEvent(deliveredEvents[0]);
  assert(delivered.status === 'processed', 'Delivered event must process');
  assert(outboxUpdates.some((row) => row.id === messageId && row.status === 'DELIVERED' && row.provider === 'brevo'),
    'Delivery update must correlate by canonical provider and message ID');

  const duplicate = await deliveryService.processDeliveryEvent(deliveredEvents[0]);
  assert(duplicate.status === 'duplicate_ignored', 'Duplicate webhook event must be ignored');

  const bouncedRequest = {
    headers: {},
    body: {
      event: 'hard_bounce',
      email: 'invalid-user@external-bounce.com',
      'message-id': 'bounce-message-1',
      id: 'evt-bounce-1',
      date: new Date().toISOString(),
      reason: '550 5.1.1 User unknown',
    },
  };
  const bounceEvents = adapter.normalizePayload(bouncedRequest as never);
  assert(bounceEvents.length === 1, 'Bounce event must normalize');
  assert(bounceEvents[0].normalizedStatus === 'BOUNCED', 'Hard bounce must map to BOUNCED');

  const bounce = await deliveryService.processDeliveryEvent(bounceEvents[0]);
  assert(bounce.status === 'processed', 'Bounce event must process');
  const expectedHash = computeEmailHash('invalid-user@external-bounce.com');
  assert(recordedSuppressions.some((row) => row.emailHash === expectedHash && row.reason === 'bounced'),
    'Bounce must create a SHA-256 suppression record');

  console.log('Brevo webhook delivery, duplicate, and suppression tests passed.');
}

runBrevoWebhookTests().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
