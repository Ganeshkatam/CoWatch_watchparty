/**
 * NOTIFY-002 Resend Email Provider Adapter
 *
 * Dispatches transactional emails via the Resend HTTP API.
 * Maps native HTTP errors to normalized CoWatch EmailProviderError categories.
 */

import axios, { isAxiosError } from 'axios';
import config from '../../config.ts';
import type {
  EmailProvider,
  EmailMessage,
  EmailSendResult,
  EmailProviderCapabilities,
} from '../emailProvider.ts';
import { EmailProviderError } from '../emailErrors.ts';

const RESEND_API_URL = 'https://api.resend.com/emails';

export class ResendEmailProvider implements EmailProvider {
  readonly name: string;
  private customApiKey?: string;

  constructor(options?: { name?: string; apiKey?: string }) {
    this.name = options?.name || 'resend';
    this.customApiKey = options?.apiKey;
  }

  readonly capabilities: EmailProviderCapabilities = {
    transactionalSending: true,
    nativeIdempotency: true,
    deliveryWebhooks: true,
    bounceEvents: true,
  };

  private get apiKey(): string {
    return this.customApiKey || config.RESEND_API_KEY || '';
  }

  private get isDryRun(): boolean {
    return !this.apiKey || this.apiKey.trim() === '';
  }

  async verifyConfiguration(): Promise<void> {
    if (process.env.NODE_ENV === 'production' && this.isDryRun) {
      throw new EmailProviderError(
        'RESEND_API_KEY is required in production when EMAIL_PROVIDER=resend',
        {
          category: 'CONFIGURATION',
          provider: this.name,
          code: 'RESEND_CONFIG_MISSING_API_KEY',
        },
      );
    }
  }

  classifyError(err: unknown): EmailProviderError {
    if (err instanceof EmailProviderError) {
      return err;
    }

    const anyErr = err as any;
    if (isAxiosError(err) || (anyErr && typeof anyErr === 'object' && ('response' in anyErr || 'code' in anyErr))) {
      const status = anyErr.response?.status ?? 0;
      const data = anyErr.response?.data;

      if (status === 429) {
        return new EmailProviderError(`Resend rate limited (HTTP 429)`, {
          category: 'RATE_LIMITED',
          provider: this.name,
          code: 'RESEND_RATE_LIMITED',
          details: data,
        });
      }

      if (status === 401 || status === 403) {
        return new EmailProviderError(`Resend authentication failed (HTTP ${status})`, {
          category: 'AUTHENTICATION',
          provider: this.name,
          code: `RESEND_AUTH_${status}`,
          details: data,
        });
      }

      if (status === 400 || status === 422) {
        return new EmailProviderError(`Resend invalid recipient or payload (HTTP ${status})`, {
          category: 'INVALID_RECIPIENT',
          provider: this.name,
          code: `RESEND_PAYLOAD_${status}`,
          details: data,
        });
      }

      if (status >= 500 || status === 0 || anyErr.code === 'ECONNABORTED' || anyErr.code === 'ETIMEDOUT') {
        return new EmailProviderError(`Resend upstream or connection error (${status || anyErr.code})`, {
          category: 'TRANSIENT',
          provider: this.name,
          code: 'RESEND_TRANSIENT_FAILURE',
          details: data ?? anyErr.message,
        });
      }

      return new EmailProviderError(`Resend permanent failure (HTTP ${status})`, {
        category: 'PERMANENT',
        provider: this.name,
        code: `RESEND_HTTP_${status}`,
        details: data,
      });
    }

    return new EmailProviderError(
      `Unexpected Resend provider error: ${err instanceof Error ? err.message : String(err)}`,
      {
        category: 'UNKNOWN',
        provider: this.name,
        code: 'RESEND_UNEXPECTED',
        details: err,
      },
    );
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (this.isDryRun) {
      console.log(
        `[ResendEmailProvider] DRY RUN — would send "${message.subject}" to ${message.to}`,
        { idempotencyKey: message.idempotencyKey },
      );
      return {
        accepted: true,
        providerMessageId: `dry-run:${message.idempotencyKey}`,
        provider: this.name,
      };
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
          reply_to: message.replyTo,
          headers: message.headers,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': message.idempotencyKey,
          },
          timeout: 15_000,
        },
      );

      const messageId = response.data?.id;
      if (!messageId) {
        throw new EmailProviderError('Resend returned 200 OK but missing message ID', {
          category: 'PERMANENT',
          provider: this.name,
          code: 'RESEND_MISSING_MESSAGE_ID',
        });
      }

      return {
        accepted: true,
        providerMessageId: messageId,
        provider: this.name,
      };
    } catch (err) {
      throw this.classifyError(err);
    }
  }
}
