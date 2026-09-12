/**
 * NOTIFY-004: Durable PostgreSQL-Backed Rate Limiting
 *
 * Provides atomic, cross-instance rate limiting backed by public.durable_rate_limits.
 * Operates without Redis dependency while ensuring zero multi-instance drift.
 * Includes graceful in-memory circuit-breaker fallback if the database pool is unavailable.
 */

import { postgres } from './postgres.ts';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

// In-memory fallback if postgres is disconnected
const fallbackBuckets = new Map<string, { tokens: number; lastRefill: number }>();

function consumeFallback(
  key: string,
  maxTokens: number,
  refillIntervalSeconds: number,
  cost: number,
): RateLimitResult {
  const now = Date.now();
  let bucket = fallbackBuckets.get(key);
  if (!bucket) {
    bucket = { tokens: maxTokens, lastRefill: now };
    fallbackBuckets.set(key, bucket);
  }

  const elapsedSeconds = (now - bucket.lastRefill) / 1000;
  if (elapsedSeconds > 0 && refillIntervalSeconds > 0) {
    const refill = Math.floor((elapsedSeconds / refillIntervalSeconds) * maxTokens);
    if (refill > 0) {
      bucket.tokens = Math.min(maxTokens, bucket.tokens + refill);
      bucket.lastRefill = now;
    }
  }

  if (bucket.tokens >= cost) {
    bucket.tokens -= cost;
    return { allowed: true, remaining: bucket.tokens, retryAfterSeconds: 0 };
  } else {
    const needed = cost - bucket.tokens;
    const retryAfter = Math.max(1, Math.ceil((needed / maxTokens) * refillIntervalSeconds));
    return { allowed: false, remaining: bucket.tokens, retryAfterSeconds: retryAfter };
  }
}

let dbFunctionUnavailable = false;

export function resetCircuitBreaker(): void {
  dbFunctionUnavailable = false;
}

/**
 * Atomically consume rate limit token(s) against PostgreSQL public.durable_rate_limits.
 */
export async function consumeRateLimitToken(
  key: string,
  maxTokens: number,
  refillIntervalSeconds: number,
  cost = 1,
): Promise<RateLimitResult> {
  if (!postgres || dbFunctionUnavailable) {
    return consumeFallback(key, maxTokens, refillIntervalSeconds, cost);
  }

  try {
    const result = await postgres.query<{
      allowed: boolean;
      remaining: number;
      retry_after_seconds: number;
    }>(
      `SELECT allowed, remaining, retry_after_seconds
       FROM public.consume_durable_rate_limit($1, $2, $3, $4)`,
      [key, maxTokens, refillIntervalSeconds, cost],
    );

    const row = result.rows[0];
    if (!row) {
      return consumeFallback(key, maxTokens, refillIntervalSeconds, cost);
    }

    return {
      allowed: Boolean(row.allowed),
      remaining: Number(row.remaining) || 0,
      retryAfterSeconds: Number(row.retry_after_seconds) || 0,
    };
  } catch (err: any) {
    if (err && (err.code === '42883' || err.code === '42P01')) {
      dbFunctionUnavailable = true;
      console.warn('[DurableRateLimit] PostgreSQL rate limit function/table unavailable, tripping circuit breaker to in-memory fallback.');
    } else {
      console.error(`[DurableRateLimit] Database rate limit query failed for key "${key}", using fallback:`, err);
    }
    return consumeFallback(key, maxTokens, refillIntervalSeconds, cost);
  }
}

export const ABUSE_REPORT_DURABLE_LIMITS = {
  MAX_PER_USER: 5,
  MAX_PER_IP: 10,
  WINDOW_SECONDS: 3600, // 1 hour
};

/**
 * Check durable rate limit for abuse reports across both IP and user dimensions.
 */
export async function checkDurableAbuseReportRateLimit(
  ip: string,
  userId: string,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const cleanIp = (ip || 'unknown').trim();
  const cleanUser = (userId || '').trim();

  // 1. IP rate limit check
  const ipKey = `rate:abuse:ip:${cleanIp}`;
  const ipResult = await consumeRateLimitToken(
    ipKey,
    ABUSE_REPORT_DURABLE_LIMITS.MAX_PER_IP,
    ABUSE_REPORT_DURABLE_LIMITS.WINDOW_SECONDS,
  );
  if (!ipResult.allowed) {
    return { allowed: false, retryAfterSeconds: ipResult.retryAfterSeconds };
  }

  // 2. User rate limit check
  if (cleanUser) {
    const userKey = `rate:abuse:user:${cleanUser}`;
    const userResult = await consumeRateLimitToken(
      userKey,
      ABUSE_REPORT_DURABLE_LIMITS.MAX_PER_USER,
      ABUSE_REPORT_DURABLE_LIMITS.WINDOW_SECONDS,
    );
    if (!userResult.allowed) {
      return { allowed: false, retryAfterSeconds: userResult.retryAfterSeconds };
    }
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Test helper to reset fallback buckets in memory
 */
export function resetFallbackBuckets(): void {
  fallbackBuckets.clear();
}
