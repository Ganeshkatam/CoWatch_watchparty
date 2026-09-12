/**
 * NOTIFY-002 Provider Error Normalization
 *
 * Normalizes all third-party provider failures into authoritative CoWatch
 * error categories so worker retry decisions are strictly provider-agnostic.
 */

export type ProviderErrorCategory =
  | 'TRANSIENT'
  | 'PERMANENT'
  | 'RATE_LIMITED'
  | 'AUTHENTICATION'
  | 'INVALID_RECIPIENT'
  | 'CONFIGURATION'
  | 'UNKNOWN';

export class EmailProviderError extends Error {
  readonly category: ProviderErrorCategory;
  readonly provider: string;
  readonly isRetryable: boolean;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    message: string,
    options: {
      category: ProviderErrorCategory;
      provider: string;
      code?: string;
      details?: unknown;
    },
  ) {
    super(message);
    this.name = 'EmailProviderError';
    this.category = options.category;
    this.provider = options.provider;
    this.code = options.code ?? `EMAIL_ERR_${options.category}`;
    this.details = options.details;

    // Retryable categories: TRANSIENT, RATE_LIMITED
    // Non-retryable categories: PERMANENT, AUTHENTICATION, INVALID_RECIPIENT, CONFIGURATION, UNKNOWN
    this.isRetryable = options.category === 'TRANSIENT' || options.category === 'RATE_LIMITED';
  }
}
