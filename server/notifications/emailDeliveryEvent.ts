/**
 * NOTIFY-002 Normalized Delivery Events
 *
 * Canonical representation of lifecycle events emitted by email providers or
 * webhooks. The core system processes this format without parsing raw payloads.
 */

export type EmailDeliveryEventType =
  | 'SENT'
  | 'DELIVERED'
  | 'DELIVERY_DELAYED'
  | 'BOUNCED'
  | 'COMPLAINED';

export interface EmailDeliveryEvent {
  provider: string;
  providerMessageId: string;
  eventId: string;
  eventType: EmailDeliveryEventType;
  normalizedStatus: EmailDeliveryEventType;
  occurredAt: Date;
  recipientEmail?: string;
  rawReason?: string;
}
