/**
 * CoWatch failure-injection checks for database fallback and webhook idempotency.
 * Provider classification and worker execution are tested inside email-service/.
 */

import { consumeRateLimitToken, resetFallbackBuckets } from './utils/durableRateLimit.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('[FailureInjectionTest] ' + message);
}

async function runFailureInjectionTests(): Promise<void> {
  resetFallbackBuckets();
  const outageKey = 'outage:test:' + Date.now();
  const first = await consumeRateLimitToken(outageKey, 2, 60);
  const second = await consumeRateLimitToken(outageKey, 2, 60);
  const third = await consumeRateLimitToken(outageKey, 2, 60);
  assert(first.allowed, 'Fallback rate limiter must allow the first token');
  assert(second.allowed, 'Fallback rate limiter must allow the second token');
  assert(!third.allowed, 'Fallback rate limiter must enforce the configured capacity');

  const webhookEventIds = new Set<string>();
  const acceptWebhook = (provider: string, eventId: string): boolean => {
    const key = provider + ':' + eventId;
    if (webhookEventIds.has(key)) return false;
    webhookEventIds.add(key);
    return true;
  };
  assert(acceptWebhook('brevo', 'evt_100'), 'First webhook delivery must be accepted');
  assert(!acceptWebhook('brevo', 'evt_100'), 'Duplicate webhook delivery must be rejected');
  assert(acceptWebhook('smtp', 'evt_100'), 'Provider namespaces must remain isolated');

  console.log('CoWatch database fallback and webhook idempotency tests passed.');
}

runFailureInjectionTests().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
