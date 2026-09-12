/**
 * NOTIFY-001 Resend Email Provider
 *
 * Sends transactional emails via the Resend API.
 * https://resend.com/docs/api-reference/emails/send-email
 *
 * When RESEND_API_KEY is not configured, the provider operates in dry-run mode:
 * it logs the would-be email but does not make an HTTP call, and returns a
 * synthetic messageId. This allows full outbox/worker testing without credentials.
 */

import axios, { isAxiosError } from 'axios';
import config from '../../config.ts';
import { NotificationDeliveryError } from '../notificationErrors.ts';
import type { EmailProvider, EmailMessage, EmailSendResult } from '../emailProvider.ts';

const RESEND_API_URL = 'https://api.resend.com/emails';

export class ResendProvider implements EmailProvider {
  readonly name = 'resend';

  private get apiKey(): string {
    return config.RESEND_API_KEY || '';
  }

  private get isDryRun(): boolean {
    return !this.apiKey || this.apiKey.trim() === '';
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (this.isDryRun) {
      // Dry-run mode: log and return synthetic ID
      console.log(
        `[ResendProvider] DRY RUN — would send "${message.subject}" to ${message.to}`,
        { idempotencyKey: message.idempotencyKey },
      );
      return { success: true, messageId: `dry-run:${message.idempotencyKey}` };
    }

    try {
      const response = await axios.post<{ id: string }>(
        RESEND_API_URL,
        {
          from: message.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            // Resend idempotency header: prevents duplicate delivery on retry
            'Idempotency-Key': message.idempotencyKey,
          },
          timeout: 15_000,
        },
      );

      const messageId = response.data?.id;
      if (!messageId) {
        throw new NotificationDeliveryError(
          'Resend returned success but no message ID',
          'RESEND_NO_ID',
          false,
        );
      }

      return { success: true, messageId };
    } catch (err) {
      if (isAxiosError(err)) {
        const status = err.response?.status ?? 0;
        const body = err.response?.data;

        // 429 or 503: transient, retryable
        if (status === 429 || status === 503 || status === 504) {
          throw new NotificationDeliveryError(
            `Resend rate limited or unavailable (HTTP ${status})`,
            `RESEND_HTTP_${status}`,
            true,
          );
        }

        // 400 / 422: invalid payload — not retryable
        if (status === 400 || status === 422) {
          throw new NotificationDeliveryError(
            `Resend rejected message (HTTP ${status}): ${JSON.stringify(body)}`,
            `RESEND_HTTP_${status}`,
            false,
          );
        }

        // 401 / 403: credential problem — not retryable
        if (status === 401 || status === 403) {
          throw new NotificationDeliveryError(
            `Resend authentication failed (HTTP ${status})`,
            `RESEND_HTTP_${status}`,
            false,
          );
        }

        // Network / timeout errors
        if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
          throw new NotificationDeliveryError(
            `Resend connection timed out`,
            'RESEND_TIMEOUT',
            true,
          );
        }

        // Unknown HTTP error — treat as retryable
        throw new NotificationDeliveryError(
          `Resend HTTP error (${status}): ${err.message}`,
          `RESEND_HTTP_${status}`,
          true,
        );
      }

      // Unknown error — propagate as retryable
      throw new NotificationDeliveryError(
        `Resend provider unexpected error: ${String(err)}`,
        'RESEND_UNKNOWN',
        true,
      );
    }
  }
}
