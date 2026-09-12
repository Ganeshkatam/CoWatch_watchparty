/**
 * NOTIFY-002 Provider Webhook Router
 *
 * Universal ingress for provider delivery status webhooks:
 *   POST /internal/webhooks/email/:provider
 *
 * Enforces adapter authentication, delegates payload normalization, and routes
 * canonical EmailDeliveryEvents to DeliveryStateService.
 */

import type { Request, Response } from 'express';
import type { ProviderWebhookAdapter } from './providerWebhookAdapter.ts';
import { ResendWebhookAdapter } from './resendWebhookAdapter.ts';
import { BrevoWebhookAdapter } from './brevoWebhookAdapter.ts';
import { deliveryStateService } from '../deliveryStateService.ts';
import {
  type WebhookVerifier,
  SvixWebhookVerifier,
  MockWebhookVerifier,
} from '../webhookVerifier.ts';
import config from '../../config.ts';

export class ProviderWebhookRouter {
  private adapters: Map<string, ProviderWebhookAdapter> = new Map();

  constructor() {
    this.registerDefaultAdapters();
  }

  private registerDefaultAdapters(): void {
    // 1. Resend adapter
    let resendVerifier: WebhookVerifier;
    if (config.RESEND_WEBHOOK_SECRET) {
      resendVerifier = new SvixWebhookVerifier(config.RESEND_WEBHOOK_SECRET);
    } else {
      resendVerifier = new MockWebhookVerifier(process.env.NODE_ENV !== 'production');
    }
    this.registerAdapter(new ResendWebhookAdapter(resendVerifier));

    // 2. Brevo adapter
    this.registerAdapter(new BrevoWebhookAdapter());
  }

  registerAdapter(adapter: ProviderWebhookAdapter): void {
    this.adapters.set(adapter.provider.toLowerCase(), adapter);
  }

  async handleWebhook(req: Request, res: Response): Promise<void> {
    const rawProvider = req.params?.provider || 'resend';
    const providerKey = rawProvider.toLowerCase();
    const adapter = this.adapters.get(providerKey);

    if (!adapter) {
      res.status(404).json({
        error: 'UNKNOWN_WEBHOOK_PROVIDER',
        message: `No webhook adapter registered for provider: ${providerKey}`,
      });
      return;
    }

    // 1. Authenticate incoming request via provider-specific mechanism
    try {
      const isAuthenticated = await adapter.authenticate(req);
      if (!isAuthenticated) {
        res.status(401).json({ error: 'UNAUTHORIZED_WEBHOOK_SIGNATURE' });
        return;
      }
    } catch {
      res.status(401).json({ error: 'AUTHENTICATION_EXCEPTION' });
      return;
    }

    // 2. Normalize raw payload to canonical EmailDeliveryEvents
    let events;
    try {
      events = await adapter.normalizePayload(req);
    } catch (err: any) {
      res.status(400).json({ error: 'INVALID_WEBHOOK_PAYLOAD', message: err?.message });
      return;
    }

    // 3. Process events through DeliveryStateService
    const results = [];
    for (const event of events) {
      const result = await deliveryStateService.processDeliveryEvent(event);
      results.push(result);
    }

    res.status(200).json({
      status: 'processed',
      eventsReceived: events.length,
      results,
    });
  }
}

export const providerWebhookRouter = new ProviderWebhookRouter();
