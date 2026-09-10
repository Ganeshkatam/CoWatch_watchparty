import { redis } from "./redis.ts";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remainingAttempts: number;
}

// In-memory fallback map: key -> Array of millisecond timestamps
const inMemoryStore = new Map<string, number[]>();

const CLEANUP_INTERVAL_MS = 60 * 1000;
let cleanupTimer: NodeJS.Timeout | null = null;

function ensureCleanupTimer() {
  if (!cleanupTimer) {
    cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, timestamps] of inMemoryStore.entries()) {
        const valid = timestamps.filter((t) => now - t < 10 * 60 * 1000);
        if (valid.length === 0) {
          inMemoryStore.delete(key);
        } else {
          inMemoryStore.set(key, valid);
        }
      }
    }, CLEANUP_INTERVAL_MS);
    if (cleanupTimer.unref) {
      cleanupTimer.unref();
    }
  }
}

export async function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;

  if (redis) {
    try {
      const redisKey = `ratelimit:${key}`;
      const count = await redis.get(redisKey);
      const currentCount = Number(count) || 0;

      if (currentCount >= maxAttempts) {
        const ttl = await redis.ttl(redisKey);
        return {
          allowed: false,
          retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
          remainingAttempts: 0,
        };
      }

      return {
        allowed: true,
        retryAfterSeconds: 0,
        remainingAttempts: Math.max(0, maxAttempts - currentCount),
      };
    } catch (err) {
      console.warn("Redis rate limit check error, falling back to memory:", err);
    }
  }

  ensureCleanupTimer();
  const timestamps = (inMemoryStore.get(key) || []).filter(
    (t) => now - t < windowMs,
  );
  inMemoryStore.set(key, timestamps);

  if (timestamps.length >= maxAttempts) {
    const oldest = timestamps[0];
    const elapsed = now - oldest;
    const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - elapsed) / 1000));
    return {
      allowed: false,
      retryAfterSeconds,
      remainingAttempts: 0,
    };
  }

  return {
    allowed: true,
    retryAfterSeconds: 0,
    remainingAttempts: maxAttempts - timestamps.length,
  };
}

export async function recordAttempt(
  key: string,
  windowSeconds: number,
): Promise<void> {
  const now = Date.now();

  if (redis) {
    try {
      const redisKey = `ratelimit:${key}`;
      const multi = redis.multi();
      multi.incr(redisKey);
      multi.expire(redisKey, windowSeconds);
      await multi.exec();
      return;
    } catch (err) {
      console.warn("Redis rate limit record error, falling back to memory:", err);
    }
  }

  ensureCleanupTimer();
  const timestamps = inMemoryStore.get(key) || [];
  timestamps.push(now);
  inMemoryStore.set(key, timestamps);
}

export async function resetRateLimit(key: string): Promise<void> {
  if (redis) {
    try {
      await redis.del(`ratelimit:${key}`);
    } catch (err) {
      console.warn("Redis rate limit reset error:", err);
    }
  }
  inMemoryStore.delete(key);
}

// Passcode-specific limits (5-minute sliding window)
export const PASSCODE_LIMITS = {
  PER_IP: { max: 15, windowSeconds: 300 },
  PER_ROOM: { max: 30, windowSeconds: 300 },
  PER_USER: { max: 10, windowSeconds: 300 },
};

export interface PasscodeRateLimitKeys {
  ip: string;
  roomId: string;
  userId?: string;
}

export async function checkPasscodeRateLimits(
  targets: PasscodeRateLimitKeys,
): Promise<RateLimitResult> {
  const cleanIp = (targets.ip || "unknown").trim();
  const cleanRoomId = (targets.roomId || "unknown").trim();

  // 1. Check IP limit
  const ipResult = await checkRateLimit(
    `passcode:ip:${cleanIp}`,
    PASSCODE_LIMITS.PER_IP.max,
    PASSCODE_LIMITS.PER_IP.windowSeconds,
  );
  if (!ipResult.allowed) {
    return ipResult;
  }

  // 2. Check Room limit
  const roomResult = await checkRateLimit(
    `passcode:room:${cleanRoomId}`,
    PASSCODE_LIMITS.PER_ROOM.max,
    PASSCODE_LIMITS.PER_ROOM.windowSeconds,
  );
  if (!roomResult.allowed) {
    return roomResult;
  }

  // 3. Check User limit if authenticated
  if (targets.userId) {
    const userResult = await checkRateLimit(
      `passcode:user:${targets.userId.trim()}`,
      PASSCODE_LIMITS.PER_USER.max,
      PASSCODE_LIMITS.PER_USER.windowSeconds,
    );
    if (!userResult.allowed) {
      return userResult;
    }
  }

  return {
    allowed: true,
    retryAfterSeconds: 0,
    remainingAttempts: Math.min(
      ipResult.remainingAttempts,
      roomResult.remainingAttempts,
    ),
  };
}

export async function recordPasscodeFailure(
  targets: PasscodeRateLimitKeys,
): Promise<void> {
  const cleanIp = (targets.ip || "unknown").trim();
  const cleanRoomId = (targets.roomId || "unknown").trim();

  await Promise.all([
    recordAttempt(`passcode:ip:${cleanIp}`, PASSCODE_LIMITS.PER_IP.windowSeconds),
    recordAttempt(`passcode:room:${cleanRoomId}`, PASSCODE_LIMITS.PER_ROOM.windowSeconds),
    targets.userId
      ? recordAttempt(`passcode:user:${targets.userId.trim()}`, PASSCODE_LIMITS.PER_USER.windowSeconds)
      : Promise.resolve(),
  ]);
}

export async function resetPasscodeLimits(
  targets: PasscodeRateLimitKeys,
): Promise<void> {
  const cleanIp = (targets.ip || "unknown").trim();
  const cleanRoomId = (targets.roomId || "unknown").trim();

  await Promise.all([
    resetRateLimit(`passcode:ip:${cleanIp}`),
    resetRateLimit(`passcode:room:${cleanRoomId}`),
    targets.userId
      ? resetRateLimit(`passcode:user:${targets.userId.trim()}`)
      : Promise.resolve(),
  ]);
}
