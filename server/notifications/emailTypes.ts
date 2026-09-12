/**
 * NOTIFY-002 Canonical Email Domain Types
 *
 * Provider-agnostic message, result, and capability contracts.
 */

export interface EmailMessage {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  /**
   * Deterministic idempotency key for provider submission.
   */
  idempotencyKey: string;
}

export interface EmailSendResult {
  accepted: boolean;
  providerMessageId?: string;
  provider: string;
}

export interface EmailProviderCapabilities {
  /**
   * Supports transactional sending via API or SMTP transport.
   */
  transactionalSending: boolean;
  /**
   * Supports inbound delivery status webhooks (delivered, delayed).
   */
  deliveryWebhooks: boolean;
  /**
   * Supports inbound bounce and spam complaint notification events.
   */
  bounceEvents: boolean;
}
