import nodemailer, { type Transporter } from 'nodemailer';
import type { DeliveryProfileId, EmailServiceConfig } from './config.ts';

export interface EmailMessage {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}

export interface EmailSendResult {
  accepted: boolean;
  provider: string;
  providerMessageId: string;
}

export interface EmailProvider {
  readonly name: string;
  verifyConfiguration(): Promise<void>;
  send(message: EmailMessage): Promise<EmailSendResult>;
  classifyError(error: unknown): EmailProviderError;
}

export class EmailProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, code: string, retryable: boolean) {
    super(message);
    this.name = 'EmailProviderError';
    this.code = code;
    this.retryable = retryable;
  }
}

export interface EmailDeliveryProfile {
  id: DeliveryProfileId;
  fromAddress: string;
  fromName: string;
}

export function getDeliveryProfile(
  id: DeliveryProfileId,
  config: EmailServiceConfig,
): EmailDeliveryProfile {
  const suffix: Record<DeliveryProfileId, string> = {
    transactional_default: '',
    transactional_security: ' Security',
    transactional_invitation: ' Invites',
    transactional_system: ' Updates',
  };
  return {
    id,
    fromAddress: config.profileSenders[id],
    fromName: config.fromName + suffix[id],
  };
}

export class SMTPEmailProvider implements EmailProvider {
  readonly name: string;
  private transporter: Transporter | undefined;

  constructor(private readonly config: EmailServiceConfig, name = 'smtp', transporter?: Transporter) {
    this.name = name;
    this.transporter = transporter;
  }

  private getTransporter(): Transporter {
    if (!this.transporter) {
      const smtp = this.config.smtp;
      this.transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: smtp.username && smtp.password ? { user: smtp.username, pass: smtp.password } : undefined,
        pool: true,
        maxConnections: 5,
        maxMessages: 100,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
      });
    }
    return this.transporter;
  }

  async verifyConfiguration(): Promise<void> {
    if (!this.config.smtp.host) {
      if (this.config.nodeEnv === 'production') {
        throw new EmailProviderError('SMTP host is required in production', 'SMTP_CONFIG_MISSING_HOST', false);
      }
      return;
    }
    try {
      await this.getTransporter().verify();
    } catch (error) {
      throw this.classifyError(error);
    }
  }

  classifyError(error: unknown): EmailProviderError {
    if (error instanceof EmailProviderError) return error;
    const value = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
    const responseCode = Number(value.responseCode) || 0;
    const code = String(value.code || '');
    if (responseCode === 535 || code === 'EAUTH') {
      return new EmailProviderError('SMTP authentication rejected', 'SMTP_AUTH_FAILURE', false);
    }
    if ([501, 550, 551, 553].includes(responseCode)) {
      return new EmailProviderError('SMTP rejected recipient', 'SMTP_RECIPIENT_' + responseCode, false);
    }
    if (responseCode === 421 || responseCode === 452) {
      return new EmailProviderError('SMTP rate limited', 'SMTP_THROTTLED_' + responseCode, true);
    }
    if ((responseCode >= 400 && responseCode < 500) ||
        ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ESOCKET'].includes(code)) {
      return new EmailProviderError('SMTP transient failure', 'SMTP_TRANSIENT_' + (code || responseCode), true);
    }
    if (responseCode >= 500 && responseCode < 600) {
      return new EmailProviderError('SMTP permanent failure', 'SMTP_PERMANENT_' + responseCode, false);
    }
    return new EmailProviderError('Unexpected SMTP transport error', 'SMTP_UNEXPECTED', true);
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (!this.config.smtp.host) {
      if (this.config.nodeEnv === 'production') {
        throw new EmailProviderError('SMTP is not configured', 'SMTP_CONFIG_MISSING_HOST', false);
      }
      return {
        accepted: true,
        provider: this.name,
        providerMessageId: 'dry-run:smtp:' + message.idempotencyKey,
      };
    }
    try {
      const result = await this.getTransporter().sendMail({
        from: message.from,
        to: message.to,
        replyTo: message.replyTo,
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: { 'X-Idempotency-Key': message.idempotencyKey },
      });
      if (typeof result.messageId !== 'string' || !result.messageId) {
        throw new EmailProviderError('SMTP omitted message ID', 'SMTP_MISSING_MESSAGE_ID', false);
      }
      return { accepted: true, provider: this.name, providerMessageId: result.messageId };
    } catch (error) {
      throw this.classifyError(error);
    }
  }
}

export class BrevoEmailProvider implements EmailProvider {
  readonly name: string;

  constructor(
    private readonly config: EmailServiceConfig,
    name: string,
    private readonly apiKey: string,
  ) {
    this.name = name;
  }

  async verifyConfiguration(): Promise<void> {
    if (!this.apiKey && this.config.nodeEnv === 'production') {
      throw new EmailProviderError('Brevo API key is required in production', 'BREVO_CONFIG_MISSING_API_KEY', false);
    }
  }

  classifyError(error: unknown): EmailProviderError {
    if (error instanceof EmailProviderError) return error;
    const value = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
    const status = Number(value.status) || 0;
    const code = String(value.code || '');
    if (status === 429) return new EmailProviderError('Brevo rate limited', 'BREVO_RATE_LIMITED', true);
    if (status === 401 || status === 403) return new EmailProviderError('Brevo authentication failed', 'BREVO_AUTH_' + status, false);
    if (status === 400 || status === 422) return new EmailProviderError('Brevo rejected message payload', 'BREVO_PAYLOAD_' + status, false);
    if (status >= 500 || status === 0 || code === 'ETIMEDOUT' || code === 'ECONNRESET') {
      return new EmailProviderError('Brevo transient failure', 'BREVO_TRANSIENT_FAILURE', true);
    }
    return new EmailProviderError('Brevo permanent rejection', 'BREVO_HTTP_' + status, false);
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (!this.apiKey) {
      if (this.config.nodeEnv === 'production') {
        throw new EmailProviderError('Brevo is not configured', 'BREVO_CONFIG_MISSING_API_KEY', false);
      }
      return {
        accepted: true,
        provider: this.name,
        providerMessageId: 'dry-run:brevo:' + message.idempotencyKey,
      };
    }

    const sender = message.from.match(/^(.*?)\s*<(.+?)>$/);
    const payload = {
      sender: {
        name: sender ? sender[1].replace(/^"|"$/g, '').trim() : this.config.fromName,
        email: sender ? sender[2].trim() : message.from,
      },
      to: [{ email: message.to }],
      subject: message.subject,
      htmlContent: message.html,
      textContent: message.text,
      headers: { 'X-Idempotency-Key': message.idempotencyKey },
      ...(message.replyTo ? { replyTo: { email: message.replyTo } } : {}),
    };

    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      const responseBody: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error('BREVO_REQUEST_FAILED'), { status: response.status });
      if (typeof responseBody !== 'object' || responseBody === null) {
        throw new EmailProviderError('Brevo returned an invalid response', 'BREVO_INVALID_RESPONSE', false);
      }
      const body = responseBody as Record<string, unknown>;
      const messageId = body.messageId ?? body.id;
      if (typeof messageId !== 'string' || !messageId) {
        throw new EmailProviderError('Brevo omitted message ID', 'BREVO_MISSING_MESSAGE_ID', false);
      }
      return { accepted: true, provider: this.name, providerMessageId: messageId };
    } catch (error) {
      throw this.classifyError(error);
    }
  }
}

export class EmailProviderRegistry {
  private readonly providers = new Map<string, EmailProvider>();

  constructor(private readonly config: EmailServiceConfig) {}

  getProviderForProfile(profileId: DeliveryProfileId): EmailProvider {
    const binding = this.config.profileBindings[profileId];
    const providerName = (this.config.bindingProviders[binding] || this.config.defaultProvider).toLowerCase();
    const key = providerName + ':' + binding;
    const existing = this.providers.get(key);
    if (existing) return existing;

    let provider: EmailProvider;
    if (providerName === 'smtp') {
      provider = new SMTPEmailProvider(this.config);
    } else if (providerName === 'brevo') {
      provider = new BrevoEmailProvider(this.config, key, this.config.brevoKeys[binding] || this.config.brevoKeys.default);
    } else {
      throw new EmailProviderError('Unsupported email provider binding', 'UNSUPPORTED_EMAIL_PROVIDER', false);
    }
    this.providers.set(key, provider);
    return provider;
  }

  async validateConfiguredProviders(): Promise<void> {
    const unique = new Set<EmailProvider>();
    const profiles: DeliveryProfileId[] = [
      'transactional_default',
      'transactional_security',
      'transactional_invitation',
      'transactional_system',
    ];
    for (const profile of profiles) unique.add(this.getProviderForProfile(profile));
    for (const provider of unique) await provider.verifyConfiguration();
  }
}
