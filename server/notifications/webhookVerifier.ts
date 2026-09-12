/**
 * NOTIFY-001A Webhook Signature Verification
 *
 * Implements standard Svix / Resend HMAC-SHA256 webhook signature verification.
 * Injected as a dependency with no hardcoded bypasses.
 */

import crypto from 'node:crypto';

export interface WebhookVerifier {
  verify(payload: string, headers: Record<string, string | string[] | undefined>): boolean;
}

export class SvixWebhookVerifier implements WebhookVerifier {
  private secretKeyBytes: Buffer;

  constructor(secret: string) {
    if (!secret || typeof secret !== 'string' || secret.trim() === '') {
      throw new Error('MISSING_WEBHOOK_SECRET: A non-empty webhook secret is required');
    }
    const cleanSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret;
    this.secretKeyBytes = Buffer.from(cleanSecret, 'base64');
  }

  verify(payload: string, headers: Record<string, string | string[] | undefined>): boolean {
    const svixId = this.getHeader(headers, 'svix-id');
    const svixTimestamp = this.getHeader(headers, 'svix-timestamp');
    const svixSignature = this.getHeader(headers, 'svix-signature');

    if (!svixId || !svixTimestamp || !svixSignature) {
      return false;
    }

    // Timestamp freshness check (anti-replay: 5 minute tolerance)
    const timestampSec = parseInt(svixTimestamp, 10);
    if (isNaN(timestampSec)) return false;
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - timestampSec) > 300) {
      return false;
    }

    const toSign = `${svixId}.${svixTimestamp}.${payload}`;
    const expectedSig = crypto
      .createHmac('sha256', this.secretKeyBytes)
      .update(toSign, 'utf8')
      .digest('base64');

    // svix-signature header may contain multiple signatures (e.g. "v1,abc v1,xyz")
    const signatures = svixSignature.split(' ');
    for (const versionedSig of signatures) {
      const parts = versionedSig.split(',');
      if (parts.length === 2 && parts[0] === 'v1') {
        const sig = parts[1];
        if (sig.length === expectedSig.length) {
          try {
            if (crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
              return true;
            }
          } catch {
            // length mismatch handled above
          }
        }
      }
    }

    return false;
  }

  private getHeader(
    headers: Record<string, string | string[] | undefined>,
    key: string,
  ): string | null {
    const val = headers[key] ?? headers[key.toLowerCase()];
    if (!val) return null;
    return Array.isArray(val) ? val[0] : val;
  }
}

/**
 * Explicit test mock verifier used in unit/integration tests
 */
export class MockWebhookVerifier implements WebhookVerifier {
  private shouldPass: boolean;

  constructor(shouldPass = true) {
    this.shouldPass = shouldPass;
  }

  setShouldPass(pass: boolean) {
    this.shouldPass = pass;
  }

  verify(): boolean {
    return this.shouldPass;
  }
}
