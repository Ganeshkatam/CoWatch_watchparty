/**
 * NOTIFY-001 Email Provider Interface
 *
 * All email providers must implement this interface. This allows swapping
 * Resend for another provider without touching the outbox worker logic.
 */

export interface EmailMessage {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  /** Provider-level idempotency key (passed directly to the upstream API) */
  idempotencyKey: string;
}

export interface EmailSendResult {
  messageId: string;
  success: true;
}

export interface EmailProvider {
  /**
   * Send a single transactional email.
   * Must throw on failure; the caller (worker) handles retry state transitions.
   */
  send(message: EmailMessage): Promise<EmailSendResult>;
  readonly name: string;
}
