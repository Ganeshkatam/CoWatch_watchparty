/**
 * NOTIFY-002 Brevo Email Provider Adapter
 *
 * Dispatches transactional emails via Brevo's HTTP API (v3/smtp/email).
 * Translates native Brevo HTTP status codes and responses to normalized
 * CoWatch EmailProviderError categories.
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

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

export class BrevoEmailProvider implements EmailProvider {
  readonly name = 'brevo';

  readonly capabilities: EmailProviderCapabilities = {
    transactionalSending: true,
    deliveryWebhooks: true,
    bounceEvents: true,
  };

  private get apiKey(): string {
    return config.BREVO_API_KEY || '';
  }

  private get isDryRun(): boolean {
    return !this.apiKey || this.apiKey.trim() === '';
  }

  async verifyConfiguration(): Promise<void> {
    if (process.env.NODE_ENV === 'production' && this.isDryRun) {
      throw new EmailProviderError(
        'BREVO_API_KEY is required in production when EMAIL_PROVIDER=brevo',
        {
          category: 'CONFIGURATION',
          provider: this.name,
          code: 'BREVO_CONFIG_MISSING_API_KEY',
        },
      );
    }
  }

  classifyError(err: unknown): EmailProviderError {
    if (err instanceof EmailProviderError) {
      return err;
    }

    if (isAxiosError(err)) {
      const status = err.response?.status ?? 0;
      const data = err.response?.data;

      if (status === 429) {
        return new EmailProviderError(`Brevo rate limited (HTTP 429)`, {
          category: 'RATE_LIMITED',
          provider: this.name,
          code: 'BREVO_RATE_LIMITED',
          details: data,
        });
      }

      if (status === 401 || status === 403) {
        return new EmailProviderError(`Brevo authentication failed (HTTP ${status})`, {
          category: 'AUTHENTICATION',
          provider: this.name,
          code: `BREVO_AUTH_${status}`,
          details: data,
        });
      }

      if (status === 400 || status === 422) {
        return new EmailProviderError(`Brevo rejected invalid recipient or schema (HTTP ${status})`, {
          category: 'INVALID_RECIPIENT',
          provider: this.name,
          code: `BREVO_PAYLOAD_${status}`,
          details: data,
        });
      }

      if (status >= 500 || status === 0 || err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        return new EmailProviderError(`Brevo server or network timeout (${status || err.code})`, {
          category: 'TRANSIENT',
          provider: this.name,
          code: 'BREVO_TRANSIENT_FAILURE',
          details: data ?? err.message,
        });
      }

      return new EmailProviderError(`Brevo permanent rejection (HTTP ${status})`, {
        category: 'PERMANENT',
        provider: this.name,
        code: `BREVO_HTTP_${status}`,
        details: data,
      });
    }

    return new EmailProviderError(
      `Unexpected Brevo provider error: ${err instanceof Error ? err.message : String(err)}`,
      {
        category: 'UNKNOWN',
        provider: this.name,
        code: 'BREVO_UNEXPECTED',
        details: err,
      },
    );
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (this.isDryRun) {
      console.log(
        `[BrevoEmailProvider] DRY RUN — would send "${message.subject}" to ${message.to}`,
        { idempotencyKey: message.idempotencyKey },
      );
      return {
        accepted: true,
        providerMessageId: `dry-run:brevo:${message.idempotencyKey}`,
        provider: this.name,
      };
    }

    // Parse sender name and email
    let senderName = config.EMAIL_FROM_NAME || 'CoWatch';
    let senderEmail = config.EMAIL_FROM_ADDRESS || 'noreply@cowatch.tv';

    if (message.from.includes('<') && message.from.includes('>')) {
      const match = message.from.match(/^(.*?)\s*<(.+?)>$/);
      if (match) {
        senderName = match[1].trim();
        senderEmail = match[2].trim();
      }
    } else if (message.from.includes('@')) {
      senderEmail = message.from.trim();
    }

    const payload: Record<string, unknown> = {
      sender: { name: senderName, email: senderEmail },
      to: [{ email: message.to }],
      subject: message.subject,
      htmlContent: message.html,
      textContent: message.text,
      headers: {
        ...message.headers,
        'X-Idempotency-Key': message.idempotencyKey,
      },
    };

    if (message.replyTo) {
      payload.replyTo = { email: message.replyTo };
    }

    try {
      const response = await axios.post<{ messageId?: string; id?: string }>(
        BREVO_API_URL,
        payload,
        {
          headers: {
            'api-key': this.apiKey,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          timeout: 15_000,
        },
      );

      const messageId = response.data?.messageId ?? response.data?.id;
      if (!messageId) {
        throw new EmailProviderError('Brevo returned success but omitted messageId', {
          category: 'PERMANENT',
          provider: this.name,
          code: 'BREVO_MISSING_MESSAGE_ID',
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
