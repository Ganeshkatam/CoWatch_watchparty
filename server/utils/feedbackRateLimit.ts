/**
 * FEEDBACK-001: Standalone In-Memory Rate Limiter for Feedback API
 *
 * Invariant:
 * Pure in-memory sliding window ensuring zero Redis command involvement (0 Redis commands).
 */

const feedbackIpStore = new Map<string, number[]>();
const feedbackUserStore = new Map<string, number[]>();

const FEEDBACK_LIMITS = {
  MAX_PER_WINDOW: 5,
  WINDOW_MS: 10 * 60 * 1000, // 10 minutes
};

// Cleanup interval
let cleanupInterval: NodeJS.Timeout | null = null;
function ensureCleanup() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, list] of feedbackIpStore.entries()) {
      const valid = list.filter((ts) => now - ts < FEEDBACK_LIMITS.WINDOW_MS);
      if (valid.length === 0) feedbackIpStore.delete(key);
      else feedbackIpStore.set(key, valid);
    }
    for (const [key, list] of feedbackUserStore.entries()) {
      const valid = list.filter((ts) => now - ts < FEEDBACK_LIMITS.WINDOW_MS);
      if (valid.length === 0) feedbackUserStore.delete(key);
      else feedbackUserStore.set(key, valid);
    }
  }, 60 * 1000);
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }
}

export function checkFeedbackRateLimit(ip: string, userId?: string | null): { allowed: boolean; retryAfterSeconds: number } {
  ensureCleanup();
  const now = Date.now();
  const cleanIp = (ip || "unknown").trim();

  // 1. Check IP rate limit
  const ipTimestamps = (feedbackIpStore.get(cleanIp) || []).filter((ts) => now - ts < FEEDBACK_LIMITS.WINDOW_MS);
  feedbackIpStore.set(cleanIp, ipTimestamps);

  if (ipTimestamps.length >= FEEDBACK_LIMITS.MAX_PER_WINDOW) {
    const oldest = ipTimestamps[0];
    const retryAfter = Math.max(1, Math.ceil((FEEDBACK_LIMITS.WINDOW_MS - (now - oldest)) / 1000));
    return { allowed: false, retryAfterSeconds: retryAfter };
  }

  // 2. Check User rate limit if authenticated
  if (userId) {
    const cleanUser = userId.trim();
    const userTimestamps = (feedbackUserStore.get(cleanUser) || []).filter(
      (ts) => now - ts < FEEDBACK_LIMITS.WINDOW_MS
    );
    feedbackUserStore.set(cleanUser, userTimestamps);

    if (userTimestamps.length >= FEEDBACK_LIMITS.MAX_PER_WINDOW) {
      const oldest = userTimestamps[0];
      const retryAfter = Math.max(1, Math.ceil((FEEDBACK_LIMITS.WINDOW_MS - (now - oldest)) / 1000));
      return { allowed: false, retryAfterSeconds: retryAfter };
    }
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

export function recordFeedbackAttempt(ip: string, userId?: string | null): void {
  ensureCleanup();
  const now = Date.now();
  const cleanIp = (ip || "unknown").trim();

  const ipList = feedbackIpStore.get(cleanIp) || [];
  ipList.push(now);
  feedbackIpStore.set(cleanIp, ipList);

  if (userId) {
    const cleanUser = userId.trim();
    const userList = feedbackUserStore.get(cleanUser) || [];
    userList.push(now);
    feedbackUserStore.set(cleanUser, userList);
  }
}
