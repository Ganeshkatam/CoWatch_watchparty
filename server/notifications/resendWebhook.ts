/**
 * NOTIFY-001A Resend Webhook Handler
 *
 * Enforces:
 *   1. Cryptographic Svix signature verification (no bypasses).
 *   2. Strict event-id deduplication via public.webhook_events.
 *   3. Matching outbox rows strictly by provider_message_id (data.email_id).
 *   4. Constrained delivery statuses: DELIVERED, DELIVERY_DELAYED, BOUNCED, COMPLAINED.
 *   5. Automatic SHA-256 deliverability suppression on BOUNCED or COMPLAINED.
 *   6. Zero raw payload persistence to protect sensitive data.
 */

import type { Request, Response } from 'express';
import type { WebhookVerifier } from './webhookVerifier.ts';
import {
  updateDeliveryStatusByProviderMessageId,
  recordWebhookEventIdempotent,
  recordEmailSuppression,
} from './emailOutbox.ts';
import { computeEmailHash } from './suppression.ts';
import type { ProviderDeliveryStatus } from './notificationTypes.ts';

export interface ResendWebhookPayload {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface WebhookEventStore {
  recordWebhookEventIdempotent(provider: string, eventId: string, eventType: string): Promise<boolean>;
  updateDeliveryStatusByProviderMessageId(
    providerMessageId: string,
    status: ProviderDeliveryStatus,
    timestamp?: Date,
  ): Promise<boolean>;
  recordEmailSuppression(
    emailHash: string,
    reason: 'bounced' | 'complained' | 'manual',
    source?: string,
  ): Promise<void>;
}

const defaultWebhookEventStore: WebhookEventStore = {
  recordWebhookEventIdempotent,
  updateDeliveryStatusByProviderMessageId,
  recordEmailSuppression,
};

export class ResendWebhookHandler {
  private verifier: WebhookVerifier;
  private store: WebhookEventStore;

  constructor(verifier: WebhookVerifier, store: Partial<WebhookEventStore> = {}) {
    this.verifier = verifier;
    this.store = { ...defaultWebhookEventStore, ...store };
  }

  async handleRequest(req: Request, res: Response): Promise<void> {
    const rawBody = (req as any).rawBody
      ? (req as any).rawBody
      : typeof req.body === 'string'
      ? req.body
      : Buffer.isBuffer(req.body)
      ? req.body.toString('utf8')
      : JSON.stringify(req.body);

    // 1. Signature Verification
    const headers = req.headers as Record<string, string | string[] | undefined>;
    const isValid = this.verifier.verify(rawBody, headers);

    if (!isValid) {
      res.status(401).json({ error: 'INVALID_SIGNATURE' });
      return;
    }

    // 2. Parse JSON
    let payload: ResendWebhookPayload;
    try {
      payload = typeof req.body === 'object' && !Buffer.isBuffer(req.body)
        ? (req.body as ResendWebhookPayload)
        : (JSON.parse(rawBody) as ResendWebhookPayload);
    } catch {
      res.status(400).json({ error: 'INVALID_JSON_PAYLOAD' });
      return;
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      res.status(400).json({ error: 'INVALID_PAYLOAD_STRUCTURE' });
      return;
    }

    const eventType = String(payload.type ?? '');
    const svixIdHeader = req.headers['svix-id'];
    const eventId = String(
      (Array.isArray(svixIdHeader) ? svixIdHeader[0] : svixIdHeader) ?? payload.id ?? '',
    );

    if (!eventId) {
      res.status(400).json({ error: 'MISSING_EVENT_ID' });
      return;
    }

    // 3. Webhook Event Idempotency (Stores minimal metadata, zero payload)
    const isNew = await this.store.recordWebhookEventIdempotent('resend', eventId, eventType);
    if (!isNew) {
      // Already processed; respond 200 idempotently
      res.status(200).json({ status: 'duplicate_ignored' });
      return;
    }

    const providerMessageId = payload.data?.email_id;
    const eventTimestamp = payload.created_at ? new Date(payload.created_at) : new Date();

    // 4. State transition by event type
    let targetStatus: ProviderDeliveryStatus | null = null;
    let isSuppressionEvent: 'bounced' | 'complained' | null = null;

    switch (eventType) {
      case 'email.delivered':
        targetStatus = 'DELIVERED';
        break;
      case 'email.delivery_delayed':
        targetStatus = 'DELIVERY_DELAYED';
        break;
      case 'email.bounced':
        targetStatus = 'BOUNCED';
        isSuppressionEvent = 'bounced';
        break;
      case 'email.complained':
        targetStatus = 'COMPLAINED';
        isSuppressionEvent = 'complained';
        break;
      default:
        // Safely ignore unknown/untracked event types (e.g. email.sent, email.opened, etc.)
        res.status(200).json({ status: 'event_ignored' });
        return;
    }

    // 5. Update outbox row strictly via provider_message_id
    if (providerMessageId && targetStatus) {
      await this.store.updateDeliveryStatusByProviderMessageId(
        providerMessageId,
        targetStatus,
        eventTimestamp,
      );
    }

    // 6. If bounced or complained: auto-suppress recipient email(s) via SHA-256 hash
    if (isSuppressionEvent) {
      const rawRecipients = payload.data?.to;
      const recipientList = Array.isArray(rawRecipients)
        ? rawRecipients
        : typeof rawRecipients === 'string'
        ? [rawRecipients]
        : [];

      for (const email of recipientList) {
        if (typeof email === 'string' && email.includes('@')) {
          const emailHash = computeEmailHash(email);
          await this.store.recordEmailSuppression(emailHash, isSuppressionEvent, 'resend_webhook');
          console.warn(
            `[ResendWebhook] Suppressed recipient ${emailHash.slice(0, 8)}... due to ${isSuppressionEvent}`,
          );
        }
      }
    }

    res.status(200).json({ status: 'processed' });
  }
}
