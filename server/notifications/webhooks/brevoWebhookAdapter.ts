/**
 * NOTIFY-002 Brevo Webhook Adapter
 *
 * Authenticates incoming Brevo transactional email webhooks and translates
 * native Brevo event schemas into canonical EmailDeliveryEvents.
 */

import crypto from 'node:crypto';
import type { Request } from 'express';
import config from '../../config.ts';
import type { ProviderWebhookAdapter } from './providerWebhookAdapter.ts';
import type { EmailDeliveryEvent, EmailDeliveryEventType } from '../emailDeliveryEvent.ts';

export class BrevoWebhookAdapter implements ProviderWebhookAdapter {
  readonly provider = 'brevo';

  private get configuredSecret(): string {
    return config.BREVO_WEBHOOK_SECRET || '';
  }

  authenticate(req: Request): boolean {
    const secret = this.configuredSecret;

    // If secret is configured, require match via header or query token
    if (secret && secret.trim() !== '') {
      const headerToken =
        req.headers['x-brevo-webhook-token'] ||
        req.headers['x-webhook-token'] ||
        req.headers['authorization']?.replace(/^Bearer\s+/i, '');

      const queryToken = req.query?.token as string | undefined;
      const provided = String(headerToken || queryToken || '');

      if (!provided || provided.length !== secret.length) {
        return false;
      }

      try {
        return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
      } catch {
        return false;
      }
    }

    // In production without configured secret, reject unauthorized inbound webhooks
    if (process.env.NODE_ENV === 'production') {
      return false;
    }

    return true;
  }

  normalizePayload(req: Request): EmailDeliveryEvent[] {
    const rawBody = req.body;
    if (!rawBody) {
      throw new Error('MISSING_WEBHOOK_BODY');
    }

    const eventsList = Array.isArray(rawBody) ? rawBody : [rawBody];
    const normalized: EmailDeliveryEvent[] = [];

    for (const item of eventsList) {
      if (!item || typeof item !== 'object') continue;

      const rawEvent = String(item.event ?? '').toLowerCase();
      let normalizedStatus: EmailDeliveryEventType | null = null;

      switch (rawEvent) {
        case 'delivered':
          normalizedStatus = 'DELIVERED';
          break;
        case 'deferred':
          normalizedStatus = 'DELIVERY_DELAYED';
          break;
        case 'hard_bounce':
        case 'soft_bounce':
        case 'blocked':
        case 'invalid_email':
          normalizedStatus = 'BOUNCED';
          break;
        case 'spam':
        case 'complaint':
          normalizedStatus = 'COMPLAINED';
          break;
        default:
          // Ignore non-terminal or non-tracked events (e.g. 'request', 'opened', 'click')
          continue;
      }

      const messageId = String(
        item['message-id'] || item.messageId || item.message_id || '',
      );

      const eventId = String(
        item.id || item.event_id || `${messageId}-${rawEvent}-${item.date || Date.now()}`,
      );

      const occurredAt = item.date ? new Date(item.date) : new Date();
      const recipientEmail = item.email ? String(item.email) : undefined;
      const rawReason = item.reason ? String(item.reason) : undefined;

      normalized.push({
        provider: this.provider,
        providerMessageId: messageId,
        eventId,
        eventType: normalizedStatus,
        normalizedStatus,
        occurredAt,
        recipientEmail,
        rawReason,
      });
    }

    return normalized;
  }
}
