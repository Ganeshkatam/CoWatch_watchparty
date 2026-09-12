/**
 * PUB-SURF-02: Standalone In-Memory Rate Limiter for Abuse Reporting API
 *
 * Invariant:
 * Pure in-memory sliding window ensuring zero Redis command involvement and strict abuse intake throttling.
 * Limits users to at most 5 reports per hour and IPs to at most 10 reports per hour.
 */

const abuseIpStore = new Map<string, number[]>();
const abuseUserStore = new Map<string, number[]>();

const ABUSE_REPORT_LIMITS = {
  MAX_PER_USER_WINDOW: 5,
  MAX_PER_IP_WINDOW: 10,
  WINDOW_MS: 60 * 60 * 1000, // 1 hour
};

let cleanupInterval: NodeJS.Timeout | null = null;
function ensureCleanup() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, list] of abuseIpStore.entries()) {
      const valid = list.filter((ts) => now - ts < ABUSE_REPORT_LIMITS.WINDOW_MS);
      if (valid.length === 0) abuseIpStore.delete(key);
      else abuseIpStore.set(key, valid);
    }
    for (const [key, list] of abuseUserStore.entries()) {
      const valid = list.filter((ts) => now - ts < ABUSE_REPORT_LIMITS.WINDOW_MS);
      if (valid.length === 0) abuseUserStore.delete(key);
      else abuseUserStore.set(key, valid);
    }
  }, 60 * 1000);
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }
}

export function checkAbuseReportRateLimit(
  ip: string,
  userId: string
): { allowed: boolean; retryAfterSeconds: number } {
  ensureCleanup();
  const now = Date.now();
  const cleanIp = (ip || "unknown").trim();
  const cleanUser = (userId || "").trim();

  // 1. Check IP limit
  const ipTimestamps = (abuseIpStore.get(cleanIp) || []).filter(
    (ts) => now - ts < ABUSE_REPORT_LIMITS.WINDOW_MS
  );
  abuseIpStore.set(cleanIp, ipTimestamps);

  if (ipTimestamps.length >= ABUSE_REPORT_LIMITS.MAX_PER_IP_WINDOW) {
    const oldest = ipTimestamps[0];
    const retryAfter = Math.max(1, Math.ceil((ABUSE_REPORT_LIMITS.WINDOW_MS - (now - oldest)) / 1000));
    return { allowed: false, retryAfterSeconds: retryAfter };
  }

  // 2. Check User limit
  if (cleanUser) {
    const userTimestamps = (abuseUserStore.get(cleanUser) || []).filter(
      (ts) => now - ts < ABUSE_REPORT_LIMITS.WINDOW_MS
    );
    abuseUserStore.set(cleanUser, userTimestamps);

    if (userTimestamps.length >= ABUSE_REPORT_LIMITS.MAX_PER_USER_WINDOW) {
      const oldest = userTimestamps[0];
      const retryAfter = Math.max(1, Math.ceil((ABUSE_REPORT_LIMITS.WINDOW_MS - (now - oldest)) / 1000));
      return { allowed: false, retryAfterSeconds: retryAfter };
    }
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

export function recordAbuseReportAttempt(ip: string, userId: string): void {
  const now = Date.now();
  const cleanIp = (ip || "unknown").trim();
  const cleanUser = (userId || "").trim();

  const ipList = (abuseIpStore.get(cleanIp) || []).filter(
    (ts) => now - ts < ABUSE_REPORT_LIMITS.WINDOW_MS
  );
  ipList.push(now);
  abuseIpStore.set(cleanIp, ipList);

  if (cleanUser) {
    const userList = (abuseUserStore.get(cleanUser) || []).filter(
      (ts) => now - ts < ABUSE_REPORT_LIMITS.WINDOW_MS
    );
    userList.push(now);
    abuseUserStore.set(cleanUser, userList);
  }
}

export function _resetAbuseReportRateLimits(): void {
  abuseIpStore.clear();
  abuseUserStore.clear();
}
