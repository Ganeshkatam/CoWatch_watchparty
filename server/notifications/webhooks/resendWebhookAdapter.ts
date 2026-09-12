/**
 * NOTIFY-002 Resend Webhook Adapter
 *
 * Implements Svix signature verification and translates Resend webhook payloads
 * into normalized EmailDeliveryEvents.
 */

import type { Request } from 'express';
import type { ProviderWebhookAdapter } from './providerWebhookAdapter.ts';
import type { EmailDeliveryEvent, EmailDeliveryEventType } from '../emailDeliveryEvent.ts';
import type { WebhookVerifier } from '../webhookVerifier.ts';

export class ResendWebhookAdapter implements ProviderWebhookAdapter {
  readonly provider = 'resend';
  private verifier: WebhookVerifier;

  constructor(verifier: WebhookVerifier) {
    this.verifier = verifier;
  }

  authenticate(req: Request): boolean {
    const rawBody = (req as any).rawBody
      ? (req as any).rawBody
      : typeof req.body === 'string'
      ? req.body
      : Buffer.isBuffer(req.body)
      ? req.body.toString('utf8')
      : JSON.stringify(req.body);

    const headers = req.headers as Record<string, string | string[] | undefined>;
    return this.verifier.verify(rawBody, headers);
  }

  normalizePayload(req: Request): EmailDeliveryEvent[] {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      throw new Error('INVALID_PAYLOAD_STRUCTURE');
    }

    const eventType = String(body.type ?? '');
    const svixIdHeader = req.headers['svix-id'];
    const eventId = String(
      (Array.isArray(svixIdHeader) ? svixIdHeader[0] : svixIdHeader) ?? body.id ?? '',
    );

    if (!eventId) {
      throw new Error('MISSING_EVENT_ID');
    }

    let normalizedStatus: EmailDeliveryEventType | null = null;
    switch (eventType) {
      case 'email.delivered':
        normalizedStatus = 'DELIVERED';
        break;
      case 'email.delivery_delayed':
        normalizedStatus = 'DELIVERY_DELAYED';
        break;
      case 'email.bounced':
        normalizedStatus = 'BOUNCED';
        break;
      case 'email.complained':
        normalizedStatus = 'COMPLAINED';
        break;
      default:
        // Safely ignore untracked events (email.sent, email.opened, etc.)
        return [];
    }

    const providerMessageId = String(body.data?.email_id ?? '');
    const occurredAt = body.created_at ? new Date(body.created_at) : new Date();

    const rawRecipients = body.data?.to;
    const recipientEmail = Array.isArray(rawRecipients)
      ? rawRecipients[0]
      : typeof rawRecipients === 'string'
      ? rawRecipients
      : undefined;

    return [
      {
        provider: this.provider,
        providerMessageId,
        eventId,
        eventType: normalizedStatus,
        normalizedStatus,
        occurredAt,
        recipientEmail,
      },
    ];
  }
}
