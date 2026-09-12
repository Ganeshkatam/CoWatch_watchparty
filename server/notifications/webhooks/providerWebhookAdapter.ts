/**
 * NOTIFY-002 Provider Webhook Adapter Contract
 *
 * Each email provider capable of dispatching webhooks implements this contract.
 * Webhook authentication and payload schema translation are fully encapsulated
 * within the adapter.
 */

import type { Request } from 'express';
import type { EmailDeliveryEvent } from '../emailDeliveryEvent.ts';

export interface ProviderWebhookAdapter {
  readonly provider: string;

  /**
   * Cryptographically authenticate or verify the incoming webhook request.
   * Returns true if valid, false if unauthorized.
   */
  authenticate(req: Request): Promise<boolean> | boolean;

  /**
   * Parse and normalize the raw request into one or more canonical EmailDeliveryEvents.
   * Throws if the payload structure is invalid.
   */
  normalizePayload(req: Request): Promise<EmailDeliveryEvent[]> | EmailDeliveryEvent[];
}
