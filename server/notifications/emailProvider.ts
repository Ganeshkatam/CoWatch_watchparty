/**
 * NOTIFY-002 Email Provider Contract
 *
 * All email provider adapters (SMTP, Brevo, Resend, Amazon SES, Postmark, etc.)
 * must implement this contract.
 */

import type {
  EmailMessage,
  EmailSendResult,
  EmailProviderCapabilities,
} from './emailTypes.ts';
import { EmailProviderError } from './emailErrors.ts';

export * from './emailTypes.ts';
export * from './emailErrors.ts';

export interface EmailProvider {
  readonly name: string;
  readonly capabilities: EmailProviderCapabilities;

  /**
   * Send a single transactional email message.
   * Throws EmailProviderError on failure.
   */
  send(message: EmailMessage): Promise<EmailSendResult>;

  /**
   * Verify provider credentials, connection or configuration at startup.
   * Throws EmailProviderError with category 'CONFIGURATION' or 'AUTHENTICATION' if invalid.
   */
  verifyConfiguration(): Promise<void>;

  /**
   * Classify any native provider or network error into an authoritative EmailProviderError.
   */
  classifyError(err: unknown): EmailProviderError;
}
