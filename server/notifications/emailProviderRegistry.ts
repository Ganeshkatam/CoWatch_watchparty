/**
 * NOTIFY-002 Provider Registry & Dispatcher
 *
 * Enforces strict startup validation and lifecycle management for email providers.
 * Completely eliminates silent fallbacks: an unknown provider or missing credential
 * causes an immediate startup failure.
 */

import config from '../config.ts';
import type { EmailProvider, EmailMessage, EmailSendResult } from './emailProvider.ts';
import { EmailProviderError } from './emailErrors.ts';
import { BrevoEmailProvider } from './providers/brevoEmailProvider.ts';
import { ResendEmailProvider } from './providers/resendEmailProvider.ts';
import { SMTPEmailProvider } from './providers/smtpEmailProvider.ts';

export class EmailProviderRegistry {
  private static providers: Map<string, EmailProvider> = new Map();

  static {
    this.register(new SMTPEmailProvider());
    this.register(new BrevoEmailProvider());
    this.register(new ResendEmailProvider());
  }

  static register(provider: EmailProvider): void {
    this.providers.set(provider.name.toLowerCase(), provider);
  }

  static getProvider(name?: string): EmailProvider {
    const providerKey = (name || config.EMAIL_PROVIDER || 'smtp').toLowerCase();
    const provider = this.providers.get(providerKey);

    if (!provider) {
      throw new EmailProviderError(
        `Unsupported or unregistered EMAIL_PROVIDER: "${providerKey}". Supported providers: ${Array.from(
          this.providers.keys(),
        ).join(', ')}`,
        {
          category: 'CONFIGURATION',
          provider: providerKey,
          code: 'UNSUPPORTED_EMAIL_PROVIDER',
        },
      );
    }

    return provider;
  }

  /**
   * Validate configuration for the active provider.
   * Throws if required credentials or options are absent.
   */
  static async validateActiveProvider(): Promise<EmailProvider> {
    const activeProvider = this.getProvider();
    await activeProvider.verifyConfiguration();
    return activeProvider;
  }
}

/**
 * Dispatcher facade delegating sending to the active registered provider.
 */
export class EmailDispatcher {
  private provider: EmailProvider;

  constructor(provider?: EmailProvider) {
    this.provider = provider ?? EmailProviderRegistry.getProvider();
  }

  setProvider(provider: EmailProvider): void {
    this.provider = provider;
  }

  getProvider(): EmailProvider {
    return this.provider;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    return this.provider.send(message);
  }
}

export const emailDispatcher = new EmailDispatcher();
