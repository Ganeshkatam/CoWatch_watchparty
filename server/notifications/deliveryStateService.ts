/**
 * NOTIFY-002 Delivery State Service
 *
 * Authoritative central processor for normalized EmailDeliveryEvents.
 * Core domain logic is completely shielded from third-party webhook structures.
 *
 * Responsibilities:
 *   1. Event deduplication via public.webhook_events (idempotency).
 *   2. Outbox status update strictly via (provider, provider_message_id).
 *   3. Deliverability suppression registration (SHA-256) on BOUNCED / COMPLAINED.
 */

import type { EmailDeliveryEvent } from './emailDeliveryEvent.ts';
import type { ProviderDeliveryStatus } from './notificationTypes.ts';
import {
  recordWebhookEventIdempotent,
  updateDeliveryStatusByProviderMessageId,
  recordEmailSuppression,
} from './emailOutbox.ts';
import { computeEmailHash } from './suppression.ts';

export interface ProcessEventResult {
  status: 'processed' | 'duplicate_ignored' | 'ignored';
  updatedOutbox: boolean;
  suppressedRecipient?: string;
}

export interface DeliveryStateStore {
  recordWebhookEventIdempotent(
    provider: string,
    eventId: string,
    eventType: string,
  ): Promise<boolean>;
  updateDeliveryStatusByProviderMessageId(
    providerMessageId: string,
    status: ProviderDeliveryStatus,
    timestamp?: Date,
    provider?: string,
  ): Promise<boolean>;
  recordEmailSuppression(
    emailHash: string,
    reason: 'bounced' | 'complained' | 'manual',
    source?: string,
  ): Promise<void>;
}

const defaultDeliveryStateStore: DeliveryStateStore = {
  recordWebhookEventIdempotent,
  updateDeliveryStatusByProviderMessageId,
  recordEmailSuppression,
};

export class DeliveryStateService {
  private store: DeliveryStateStore;

  constructor(store: Partial<DeliveryStateStore> = {}) {
    this.store = { ...defaultDeliveryStateStore, ...store };
  }

  async processDeliveryEvent(event: EmailDeliveryEvent): Promise<ProcessEventResult> {
    // 1. Idempotency check via minimal webhook_events schema
    const isNew = await this.store.recordWebhookEventIdempotent(
      event.provider,
      event.eventId,
      event.eventType,
    );

    if (!isNew) {
      return { status: 'duplicate_ignored', updatedOutbox: false };
    }

    // 2. State transition strictly via composite (provider, provider_message_id)
    let updatedOutbox = false;
    if (event.providerMessageId && event.normalizedStatus) {
      updatedOutbox = await this.store.updateDeliveryStatusByProviderMessageId(
        event.providerMessageId,
        event.normalizedStatus,
        event.occurredAt,
        event.provider,
      );
    }

    // 3. Automated deliverability suppression on terminal negative events
    let suppressedRecipient: string | undefined;
    if (
      (event.normalizedStatus === 'BOUNCED' || event.normalizedStatus === 'COMPLAINED') &&
      event.recipientEmail &&
      event.recipientEmail.includes('@')
    ) {
      const emailHash = computeEmailHash(event.recipientEmail);
      const reason = event.normalizedStatus === 'BOUNCED' ? 'bounced' : 'complained';
      await this.store.recordEmailSuppression(emailHash, reason, `${event.provider}_webhook`);
      suppressedRecipient = emailHash;
      console.warn(
        `[DeliveryStateService] Suppressed recipient ${emailHash.slice(0, 8)}... (${reason}) via ${event.provider}`,
      );
    }

    return {
      status: 'processed',
      updatedOutbox,
      suppressedRecipient,
    };
  }
}

export const deliveryStateService = new DeliveryStateService();
