/**
 * NOTIFY-004 Durable PostgreSQL Shared Rate Limiter Test Suite
 *
 * Verifies:
 * 1. Single-instance token consumption and exhaustion.
 * 2. Multi-instance concurrency without counter drift.
 * 3. IP and user dimensional limits separation.
 */

import {
  consumeRateLimitToken,
  checkDurableAbuseReportRateLimit,
  resetFallbackBuckets,
} from './utils/durableRateLimit.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[DurableRateLimitTest] Assertion Failed: ${message}`);
  }
}

async function runDurableRateLimitTests() {
  console.log('=== NOTIFY-004 Durable Rate Limiter Test Suite ===\n');

  console.log('Case 1: Consumption up to maximum tokens and throttling when exhausted...');
  resetFallbackBuckets();
  const key = `test:single-user:${Date.now()}`;
  const maxTokens = 3;
  const refillSeconds = 60;

  const res1 = await consumeRateLimitToken(key, maxTokens, refillSeconds);
  assert(res1.allowed === true, 'Token 1 must be allowed');
  assert(res1.remaining === 2, 'Remaining must be 2 after 1st token');

  const res2 = await consumeRateLimitToken(key, maxTokens, refillSeconds);
  assert(res2.allowed === true, 'Token 2 must be allowed');
  assert(res2.remaining === 1, 'Remaining must be 1 after 2nd token');

  const res3 = await consumeRateLimitToken(key, maxTokens, refillSeconds);
  assert(res3.allowed === true, 'Token 3 must be allowed');
  assert(res3.remaining === 0, 'Remaining must be 0 after 3rd token');

  const res4 = await consumeRateLimitToken(key, maxTokens, refillSeconds);
  assert(res4.allowed === false, '4th token must be throttled');
  assert(res4.retryAfterSeconds > 0, 'Retry-after must be positive seconds');
  console.log('  PASS: Single-instance token consumption and rejection verified');

  console.log('Case 2: Shared multi-instance concurrency limits...');
  resetFallbackBuckets();
  const sharedKey = `test:multi-instance:${Date.now()}`;
  const concurrencyMaxTokens = 5;
  const concurrencyRefill = 300;

  const instanceA = () => consumeRateLimitToken(sharedKey, concurrencyMaxTokens, concurrencyRefill);
  const instanceB = () => consumeRateLimitToken(sharedKey, concurrencyMaxTokens, concurrencyRefill);

  const results = await Promise.all([
    instanceA(),
    instanceB(),
    instanceA(),
    instanceB(),
    instanceA(),
    instanceB(), // 6th attempt across both instances
  ]);

  const allowedCount = results.filter((r) => r.allowed).length;
  const rejectedCount = results.filter((r) => !r.allowed).length;

  assert(allowedCount === 5, `Expected exactly 5 allowed requests, got ${allowedCount}`);
  assert(rejectedCount === 1, `Expected exactly 1 rejected request, got ${rejectedCount}`);
  console.log('  PASS: Concurrency test across simulated backend instances passed with zero drift');

  console.log('Case 3: Independent IP and user limits for abuse reports...');
  resetFallbackBuckets();
  const testIp = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
  const userA = `user-${Date.now()}-a`;
  const userB = `user-${Date.now()}-b`;

  for (let i = 0; i < 5; i++) {
    const res = await checkDurableAbuseReportRateLimit(testIp, userA);
    assert(res.allowed === true, `User A attempt ${i + 1} must be allowed`);
  }

  const userABlocked = await checkDurableAbuseReportRateLimit(testIp, userA);
  assert(userABlocked.allowed === false, 'User A 6th attempt must be throttled');
  assert(userABlocked.retryAfterSeconds > 0, 'Retry-After must be positive');

  const userBAllowed = await checkDurableAbuseReportRateLimit(testIp, userB);
  assert(userBAllowed.allowed === true, 'User B from same IP must be allowed before IP threshold');
  console.log('  PASS: IP and user limits evaluated independently without cross-leakage');

  console.log('\nAll NOTIFY-004 Durable Rate Limiter tests PASSED successfully!\n');
}

runDurableRateLimitTests().catch((err) => {
  console.error('\nDurable rate limiter tests failed:', err);
  process.exit(1);
});
