import config from '../config.ts';

export interface DuplicateSignupAlertOptions {
  email: string;
  ipAddress?: string;
  userAgent?: string;
  attemptedAt?: Date;
}

export interface EmailServiceClientConfig {
  url: string;
  apiSecret: string;
  timeoutMs?: number;
}

export interface EmailSendResult {
  accepted: boolean;
  provider: 'smtp' | 'brevo';
  providerMessageId: string;
}

export async function sendDuplicateSignupSecurityAlert(
  options: DuplicateSignupAlertOptions,
  fetcher: typeof fetch = fetch,
  serviceConfig: EmailServiceClientConfig = {
    url: config.EMAIL_SERVICE_URL || '',
    apiSecret: config.EMAIL_SERVICE_API_SECRET || '',
  },
): Promise<EmailSendResult | null> {
  try {
    if (!serviceConfig.url || !serviceConfig.apiSecret || serviceConfig.apiSecret.length < 32) {
      throw new Error('EMAIL_SERVICE_NOT_CONFIGURED');
    }
    const serviceBase = new URL(serviceConfig.url);
    if (config.NODE_ENV === 'production' && serviceBase.protocol !== 'https:') {
      throw new Error('EMAIL_SERVICE_REQUIRES_HTTPS');
    }
    if (serviceBase.username || serviceBase.password || serviceBase.search || serviceBase.hash || serviceBase.pathname !== '/') {
      throw new Error('EMAIL_SERVICE_URL_MUST_BE_ORIGIN_ONLY');
    }
    const response = await fetcher(
      new URL('/internal/send/duplicate-signup-alert', serviceBase),
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + serviceConfig.apiSecret,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          email: options.email,
          ipAddress: options.ipAddress,
          attemptedAt: (options.attemptedAt ?? new Date()).toISOString(),
        }),
        signal: AbortSignal.timeout(serviceConfig.timeoutMs ?? 5000),
      },
    );
    if (!response.ok) throw new Error('EMAIL_SERVICE_REQUEST_FAILED');

    const payload: unknown = await response.json();
    if (typeof payload !== 'object' || payload === null) {
      throw new Error('INVALID_EMAIL_SERVICE_RESPONSE');
    }
    const result = payload as Record<string, unknown>;
    if (result.accepted !== true || (result.provider !== 'smtp' && result.provider !== 'brevo') ||
        typeof result.providerMessageId !== 'string' || !result.providerMessageId) {
      throw new Error('INVALID_EMAIL_SERVICE_RESPONSE');
    }
    return {
      accepted: true,
      provider: result.provider,
      providerMessageId: result.providerMessageId,
    };
  } catch (error) {
    console.error('[SecurityAlert] Remote email delivery failed:', error instanceof Error ? error.message : 'UNKNOWN_ERROR');
    return null;
  }
}
