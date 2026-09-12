/**
 * NOTIFY-002 Generic SMTP Email Provider Adapter
 *
 * Generic SMTP adapter utilizing standard SMTP protocol over TLS/STARTTLS.
 * Completely vendor-agnostic (supports Brevo SMTP, Amazon SES SMTP, Postmark, etc.).
 * Normalizes SMTP response codes and network failures into CoWatch EmailProviderError.
 */

import nodemailer, { type Transporter } from 'nodemailer';
import config from '../../config.ts';
import type {
  EmailProvider,
  EmailMessage,
  EmailSendResult,
  EmailProviderCapabilities,
} from '../emailProvider.ts';
import { EmailProviderError } from '../emailErrors.ts';

export class SMTPEmailProvider implements EmailProvider {
  readonly name = 'smtp';

  readonly capabilities: EmailProviderCapabilities = {
    transactionalSending: true,
    deliveryWebhooks: false, // Standard SMTP does not natively provide inbound webhooks
    bounceEvents: false,
  };

  private transporter: Transporter | null = null;

  private get host(): string {
    return config.EMAIL_SMTP_HOST || '';
  }

  private get port(): number {
    return Number(config.EMAIL_SMTP_PORT) || 587;
  }

  private get username(): string {
    return config.EMAIL_SMTP_USERNAME || '';
  }

  private get password(): string {
    return config.EMAIL_SMTP_PASSWORD || '';
  }

  private get secure(): boolean {
    return Boolean(config.EMAIL_SMTP_SECURE) || this.port === 465;
  }

  private get isDryRun(): boolean {
    return !this.host || this.host.trim() === '';
  }

  constructor(customTransporter?: Transporter) {
    if (customTransporter) {
      this.transporter = customTransporter;
    }
  }

  private getTransporter(): Transporter {
    if (!this.transporter) {
      const auth =
        this.username && this.password
          ? {
              user: this.username,
              pass: this.password,
            }
          : undefined;

      this.transporter = nodemailer.createTransport({
        host: this.host,
        port: this.port,
        secure: this.secure,
        auth,
        pool: true,
        maxConnections: 5,
        maxMessages: 100,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      });
    }
    return this.transporter;
  }

  async verifyConfiguration(): Promise<void> {
    if (this.isDryRun) {
      if (process.env.NODE_ENV === 'production') {
        throw new EmailProviderError(
          'EMAIL_SMTP_HOST is required in production when EMAIL_PROVIDER=smtp',
          {
            category: 'CONFIGURATION',
            provider: this.name,
            code: 'SMTP_CONFIG_MISSING_HOST',
          },
        );
      }
      return;
    }

    try {
      await this.getTransporter().verify();
    } catch (err) {
      throw this.classifyError(err);
    }
  }

  classifyError(err: unknown): EmailProviderError {
    if (err instanceof EmailProviderError) {
      return err;
    }

    const errorObj = err as Record<string, unknown>;
    const responseCode = Number(errorObj.responseCode) || 0;
    const code = String(errorObj.code || '');
    const message = err instanceof Error ? err.message : String(err);

    // 535 Authentication failure
    if (responseCode === 535 || code === 'EAUTH') {
      return new EmailProviderError(`SMTP authentication rejected: ${message}`, {
        category: 'AUTHENTICATION',
        provider: this.name,
        code: 'SMTP_AUTH_FAILURE',
        details: err,
      });
    }

    // 550, 551, 553, 501 Invalid recipient address
    if ([501, 550, 551, 553].includes(responseCode)) {
      return new EmailProviderError(`SMTP rejected recipient: ${message}`, {
        category: 'INVALID_RECIPIENT',
        provider: this.name,
        code: `SMTP_RECIPIENT_${responseCode}`,
        details: err,
      });
    }

    // Rate limiting / throttle: 421, 452
    if (responseCode === 421 || responseCode === 452) {
      return new EmailProviderError(`SMTP rate limited / concurrent limit: ${message}`, {
        category: 'RATE_LIMITED',
        provider: this.name,
        code: `SMTP_THROTTLED_${responseCode}`,
        details: err,
      });
    }

    // Transient 4xx codes or socket timeouts
    if (
      (responseCode >= 400 && responseCode < 500) ||
      ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ESOCKET'].includes(code)
    ) {
      return new EmailProviderError(`SMTP transient failure: ${message}`, {
        category: 'TRANSIENT',
        provider: this.name,
        code: `SMTP_TRANSIENT_${code || responseCode}`,
        details: err,
      });
    }

    // Permanent 5xx codes
    if (responseCode >= 500 && responseCode < 600) {
      return new EmailProviderError(`SMTP permanent server failure: ${message}`, {
        category: 'PERMANENT',
        provider: this.name,
        code: `SMTP_PERMANENT_${responseCode}`,
        details: err,
      });
    }

    return new EmailProviderError(`Unexpected SMTP transport error: ${message}`, {
      category: 'UNKNOWN',
      provider: this.name,
      code: 'SMTP_UNEXPECTED',
      details: err,
    });
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (this.isDryRun) {
      console.log(
        `[SMTPEmailProvider] DRY RUN — would send "${message.subject}" to ${message.to}`,
        { idempotencyKey: message.idempotencyKey },
      );
      return {
        accepted: true,
        providerMessageId: `dry-run:smtp:${message.idempotencyKey}`,
        provider: this.name,
      };
    }

    let fromHeader = message.from;
    if (!fromHeader.includes('<') && config.EMAIL_FROM_NAME) {
      fromHeader = `"${config.EMAIL_FROM_NAME}" <${message.from}>`;
    }

    try {
      const info = await this.getTransporter().sendMail({
        from: fromHeader,
        to: message.to,
        replyTo: message.replyTo,
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: {
          ...message.headers,
          'X-Idempotency-Key': message.idempotencyKey,
        },
      });

      const messageId = String(info.messageId || '');
      if (!messageId) {
        throw new EmailProviderError('SMTP server accepted message but returned no messageId', {
          category: 'PERMANENT',
          provider: this.name,
          code: 'SMTP_MISSING_MESSAGE_ID',
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
