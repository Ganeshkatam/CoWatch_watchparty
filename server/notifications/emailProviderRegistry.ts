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
import type { DeliveryProfileId } from './deliveryProfiles.ts';

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
   * NOTIFY-004: Resolve configured EmailProvider for a canonical delivery profile.
   * Maps DeliveryProfileId -> ProviderBinding -> EmailProvider instance.
   */
  static getProviderForProfile(profileId?: DeliveryProfileId | string): EmailProvider {
    if (!profileId) {
      return this.getProvider();
    }

    // 1. Resolve configured binding for the profile
    let bindingName = 'default';
    switch (profileId) {
      case 'transactional_invitation':
        bindingName = config.EMAIL_PROFILE_INVITATION_BINDING || 'invitation';
        break;
      case 'transactional_security':
        bindingName = config.EMAIL_PROFILE_SECURITY_BINDING || 'security';
        break;
      case 'transactional_system':
        bindingName = config.EMAIL_PROFILE_SYSTEM_BINDING || 'system';
        break;
      default:
        bindingName = config.EMAIL_PROFILE_DEFAULT_BINDING || 'default';
        break;
    }

    // 2. Resolve provider adapter configured for that binding
    let providerName = '';
    if (bindingName === 'invitation') {
      providerName = config.EMAIL_BINDING_INVITATION_PROVIDER;
    } else if (bindingName === 'security') {
      providerName = config.EMAIL_BINDING_SECURITY_PROVIDER;
    } else if (bindingName === 'system') {
      providerName = config.EMAIL_BINDING_SYSTEM_PROVIDER;
    } else if (bindingName === 'default') {
      providerName = config.EMAIL_BINDING_DEFAULT_PROVIDER;
    }

    const effectiveProvider = (providerName || config.EMAIL_PROVIDER || 'smtp').toLowerCase();

    // 3. Multi-account credential resolution (e.g. Brevo account per binding)
    const customInstanceKey = `${effectiveProvider}:${bindingName}`.toLowerCase();
    if (this.providers.has(customInstanceKey)) {
      return this.providers.get(customInstanceKey)!;
    }

    if (effectiveProvider === 'brevo') {
      let customKey = '';
      if (bindingName === 'invitation' && config.BREVO_API_KEY_INVITATIONS) {
        customKey = config.BREVO_API_KEY_INVITATIONS;
      } else if (bindingName === 'security' && config.BREVO_API_KEY_SECURITY) {
        customKey = config.BREVO_API_KEY_SECURITY;
      } else if (bindingName === 'system' && config.BREVO_API_KEY_SYSTEM) {
        customKey = config.BREVO_API_KEY_SYSTEM;
      }

      if (customKey) {
        const customProvider = new BrevoEmailProvider({
          name: customInstanceKey,
          apiKey: customKey,
        });
        this.register(customProvider);
        return customProvider;
      }
    }

    // 4. Fall back to standard registered provider for that provider name
    return this.getProvider(effectiveProvider);
  }

  /**
   * Validate configuration for the active provider and all configured profiles.
   * Throws if required credentials or options are absent.
   */
  static async validateActiveProvider(): Promise<EmailProvider> {
    const activeProvider = this.getProvider();
    await activeProvider.verifyConfiguration();

    const profiles: DeliveryProfileId[] = [
      'transactional_default',
      'transactional_invitation',
      'transactional_security',
      'transactional_system',
    ];
    for (const p of profiles) {
      const profileProvider = this.getProviderForProfile(p);
      await profileProvider.verifyConfiguration();
    }

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
