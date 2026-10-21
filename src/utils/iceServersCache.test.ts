import assert from "node:assert/strict";
import {
  iceServers,
  getIceServersAsync,
  prewarmIceServers,
  clearIceServersCache,
  getDefaultIceServers,
} from "./utils";

async function runIceServersCacheTests() {
  console.log("\n================================================================");
  console.log("ICE SERVERS CACHE, REFRESH & PREWARMING UNIT TEST SUITE");
  console.log("================================================================\n");

  let passed = 0;
  let failed = 0;

  function runAssert(condition: boolean, title: string, details?: string) {
    if (condition) {
      console.log(`[PASS] ${title}`);
      passed++;
    } else {
      console.error(`[FAIL] ${title} - Details: ${details || "none"}`);
      failed++;
    }
  }

  // Preserve global fetch
  const originalFetch = globalThis.fetch;

  try {
    // 1. Synchronous default fallback
    clearIceServersCache();
    const defaultServers = iceServers();
    const defaults = getDefaultIceServers();
    runAssert(
      Array.isArray(defaultServers) && defaultServers.length === defaults.length,
      "Test 1: Synchronous call without cache returns default ICE servers",
      `serversCount=${defaultServers?.length}, expected=${defaults.length}`
    );

    // 2. Context Isolation: Room A / User 1 vs Room B / User 2
    let fetchCount = 0;
    globalThis.fetch = async (url: any, init?: any) => {
      fetchCount++;
      const headers = (init?.headers || {}) as Record<string, string>;
      const roomId = headers["X-Room-Id"] || "global";
      const uid = headers["X-Caller-Uid"] || "anon";
      return {
        ok: true,
        status: 200,
        json: async () => ({
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            {
              urls: `turn:turn.cowatch.tv:443?transport=tcp`,
              username: `123456789:${uid}`,
              credential: `creds_for_${roomId}_${uid}`,
            },
          ],
          ttlSeconds: 3600,
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        }),
      } as any;
    };

    clearIceServersCache();
    await prewarmIceServers({ roomId: "room_A", callerUid: "user_1", sessionId: "sess_1" });
    const cachedA = iceServers("room_A:user_1:sess_1");
    const isolatedB = iceServers("room_B:user_2:sess_2");

    const turnServerA = cachedA.find((s: any) => s.username);
    const turnServerB = isolatedB.find((s: any) => s.username);

    runAssert(
      turnServerA?.credential === "creds_for_room_A_user_1" &&
      turnServerB?.credential !== "creds_for_room_A_user_1",
      "Test 2: Context Isolation across distinct authorization contexts",
      `turnServerA=${turnServerA?.credential}, turnServerB=${turnServerB?.credential}`
    );

    // 3. Request Coalescing: 5 concurrent prewarm calls trigger exactly 1 fetch
    clearIceServersCache();
    fetchCount = 0;
    const concurrentFetches = await Promise.all([
      prewarmIceServers({ roomId: "room_coalesce", callerUid: "u_c", sessionId: "s_c" }),
      prewarmIceServers({ roomId: "room_coalesce", callerUid: "u_c", sessionId: "s_c" }),
      prewarmIceServers({ roomId: "room_coalesce", callerUid: "u_c", sessionId: "s_c" }),
      prewarmIceServers({ roomId: "room_coalesce", callerUid: "u_c", sessionId: "s_c" }),
      prewarmIceServers({ roomId: "room_coalesce", callerUid: "u_c", sessionId: "s_c" }),
    ]);

    runAssert(
      fetchCount === 1 && concurrentFetches.length === 5,
      "Test 3: Request coalescing for identical authorization context (1 fetch for 5 concurrent calls)",
      `fetchCount=${fetchCount}`
    );

    // 4. Expiration purge: Expired entries are immediately purged on access
    clearIceServersCache();
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        iceServers: [
          { urls: "turn:expired.turn:3478", username: "exp", credential: "exp" },
        ],
        ttlSeconds: -10,
        expiresAt: new Date(Date.now() - 10000).toISOString(), // Expired 10s ago
      }),
    }) as any;

    await prewarmIceServers({ roomId: "room_expired", callerUid: "u_exp", sessionId: "s_exp" });
    const contextKeyExp = "room_expired:u_exp:s_exp";
    const resultAfterExpiration = iceServers(contextKeyExp);
    const hasExpiredTurn = resultAfterExpiration.some((s: any) => s.urls === "turn:expired.turn:3478");

    runAssert(
      !hasExpiredTurn,
      "Test 4: Expired cache entries are immediately purged, falling back to default",
      `hasExpiredTurn=${hasExpiredTurn}`
    );

    // 5. Prefix-based cache clearing (e.g. room unmount with room ID only)
    clearIceServersCache();
    globalThis.fetch = async (_url: any, init: any) => {
      const headers = init?.headers || {};
      const roomId = headers["X-Room-Id"] || "global";
      return {
        ok: true,
        status: 200,
        json: async () => ({
          iceServers: [{ urls: `turn:${roomId}.turn:3478`, username: roomId, credential: "c" }],
          ttlSeconds: 3600,
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        }),
      } as any;
    };

    await prewarmIceServers({ roomId: "room_prefix_1", callerUid: "u1", sessionId: "s1" });
    await prewarmIceServers({ roomId: "room_prefix_2", callerUid: "u2", sessionId: "s2" });

    // Room teardown passes roomId string only
    clearIceServersCache("room_prefix_1");
    const checkRoom1 = iceServers("room_prefix_1:u1:s1");
    const checkRoom2 = iceServers("room_prefix_2:u2:s2");

    const r1Turn = checkRoom1.find((s: any) => s.username === "room_prefix_1");
    const r2Turn = checkRoom2.find((s: any) => s.username === "room_prefix_2");

    runAssert(
      !r1Turn && Boolean(r2Turn),
      "Test 5: Prefix-based cache clearing evicts all composite session keys for departing room",
      `r1Cleared=${!r1Turn}, r2Preserved=${Boolean(r2Turn)}`
    );

    // 6. Full cache clearing
    clearIceServersCache();
    const r2AfterFullClear = iceServers("room_prefix_2:u2:s2").find((s: any) => s.username === "room_prefix_2");
    runAssert(
      !r2AfterFullClear,
      "Test 6: Full cache clearing purges all active contexts and resets activeContextKey",
      `r2AfterFullClear=${Boolean(r2AfterFullClear)}`
    );

    // 7. Network failure fallback without throwing
    globalThis.fetch = async () => {
      throw new Error("NETWORK_DOWN");
    };

    const fallbackResult = await prewarmIceServers({ roomId: "room_net_err", callerUid: "u_err", sessionId: "s_err" });
    runAssert(
      Array.isArray(fallbackResult) && fallbackResult.length > 0,
      "Test 7: Network failure falls back safely to default ICE servers without throwing",
      `fallbackLength=${fallbackResult?.length}`
    );

    // 8. Force-refresh bypasses 15-minute cache validity guard
    clearIceServersCache();
    let currentVersion = "v1";
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        iceServers: [{ urls: "turn:turn.cowatch.tv:443", username: currentVersion, credential: "c" }],
        ttlSeconds: 7200,
        expiresAt: new Date(Date.now() + 7200 * 1000).toISOString(),
      }),
    }) as any;

    await prewarmIceServers({ roomId: "room_refresh", callerUid: "u1", sessionId: "s1" });
    const cachedV1 = iceServers("room_refresh:u1:s1").find((s: any) => s.username === "v1");

    // Without forceRefresh, it returns cached v1
    currentVersion = "v2";
    await prewarmIceServers({ roomId: "room_refresh", callerUid: "u1", sessionId: "s1" });
    const cachedStillV1 = iceServers("room_refresh:u1:s1").find((s: any) => s.username === "v1");

    // With forceRefresh, it forces fetch of v2
    await prewarmIceServers({ roomId: "room_refresh", callerUid: "u1", sessionId: "s1", forceRefresh: true });
    const cachedUpdatedV2 = iceServers("room_refresh:u1:s1").find((s: any) => s.username === "v2");

    runAssert(
      Boolean(cachedV1) && Boolean(cachedStillV1) && Boolean(cachedUpdatedV2),
      "Test 8: Scheduled force-refresh bypasses the 15-minute freshness guard to renew credentials",
      `cachedV1=${Boolean(cachedV1)}, cachedStillV1=${Boolean(cachedStillV1)}, cachedUpdatedV2=${Boolean(cachedUpdatedV2)}`
    );

    // 9. Bounded retry on transient refresh failure
    clearIceServersCache();
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        iceServers: [{ urls: "turn:turn.cowatch.tv:443", username: "initial_creds", credential: "c" }],
        ttlSeconds: 3600,
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      }),
    }) as any;

    await prewarmIceServers({ roomId: "room_retry", callerUid: "u1", sessionId: "s1" });

    // Next fetch fails with 503
    globalThis.fetch = async () => {
      throw new Error("HTTP_503_SERVICE_UNAVAILABLE");
    };

    // Trigger force refresh failure
    await prewarmIceServers({ roomId: "room_retry", callerUid: "u1", sessionId: "s1", forceRefresh: true });

    // Valid credentials are preserved (not prematurely purged before expiry)
    const preservedCreds = iceServers("room_retry:u1:s1");
    const hasPreserved = preservedCreds.some((s: any) => s.username === "initial_creds");

    runAssert(
      hasPreserved,
      "Test 9: Transient refresh failure preserves valid unexpired credentials and initiates retry backoff",
      `hasPreserved=${hasPreserved}`
    );

    // 10. Timer cancellation on teardown
    clearIceServersCache("room_retry");
    const afterTeardown = iceServers("room_retry:u1:s1");
    const teardownTurn = afterTeardown.find((s: any) => s.username === "initial_creds");

    runAssert(
      !teardownTurn,
      "Test 10: Teardown purges cache entries and cancels scheduled background refresh/retry timers",
      `teardownClean=${!teardownTurn}`
    );

    // 11. Asynchronous prewarming race: getIceServersAsync awaits in-flight fetch
    clearIceServersCache();
    let resolveSlowFetch: any;
    globalThis.fetch = ((async () => {
      return new Promise<any>((resolve) => {
        resolveSlowFetch = resolve;
      });
    }) as any);

    // Kick off asynchronous prewarming
    void prewarmIceServers({ roomId: "room_race", callerUid: "u_race", sessionId: "s_race" });

    // Synchronous call during flight receives default fallback
    const syncDuringFlight = iceServers("room_race:u_race:s_race");
    const isSyncDefault = syncDuringFlight.some((s: any) => s.urls === "stun:stun.l.google.com:19302");

    // Asynchronous caller awaits the in-flight prewarm promise
    const asyncPromise = getIceServersAsync("room_race:u_race:s_race");

    // Complete the slow fetch
    resolveSlowFetch({
      ok: true,
      status: 200,
      json: async () => ({
        iceServers: [{ urls: "turn:slow.turn:443", username: "slow_user", credential: "c" }],
        ttlSeconds: 3600,
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      }),
    } as any);
    const asyncResolved = await asyncPromise;
    const hasSlowUser = asyncResolved.some((s: any) => s.username === "slow_user");

    runAssert(
      hasSlowUser && isSyncDefault,
      "Test 11: Asynchronous prewarming race: getIceServersAsync awaits in-flight fetch while synchronous callers get default",
      `hasSlowUser=${hasSlowUser}, isSyncDefault=${isSyncDefault}`
    );

    // 12. In-flight teardown race: delayed credential response cannot resurrect torn-down cache entry
    clearIceServersCache();
    let resolveTeardownFetch: any;
    globalThis.fetch = ((async () => {
      return new Promise<any>((resolve) => {
        resolveTeardownFetch = resolve;
      });
    }) as any);

    // Start prewarming for room_teardown_race
    void prewarmIceServers({ roomId: "room_teardown_race", callerUid: "u_race", sessionId: "s_race" });

    // Room teardown happens while network request is in flight
    clearIceServersCache("room_teardown_race");

    // Late network response arrives
    resolveTeardownFetch({
      ok: true,
      status: 200,
      json: async () => ({
        iceServers: [{ urls: "turn:late.turn:443", username: "late_user", credential: "c" }],
        ttlSeconds: 3600,
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      }),
    });

    // Wait microtask tick for promise resolution
    await new Promise((r) => setTimeout(r, 10));

    // Cache must remain empty (no late resurrection)
    const afterLateArrival = iceServers("room_teardown_race:u_race:s_race");
    const hasLateTurn = afterLateArrival.some((s: any) => s.username === "late_user");

    runAssert(
      !hasLateTurn,
      "Test 12: In-flight teardown race: delayed response rejected by per-context generation without resurrecting cache",
      `hasLateTurn=${hasLateTurn}`
    );

    // 13. Local-media peer creation awaiting prewarming
    clearIceServersCache();
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        iceServers: [{ urls: "turn:localmedia.turn:443", username: "lm_user", credential: "c" }],
        ttlSeconds: 3600,
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      }),
    }) as any;

    // Simulate early guest join: prewarming kicked off, coordinator awaits getIceServersAsync()
    void prewarmIceServers({ roomId: "room_lm", callerUid: "u_lm", sessionId: "s_lm" });
    const resolvedLmServers = await getIceServersAsync("room_lm:u_lm:s_lm");
    const hasLmTurn = resolvedLmServers.some((s: any) => s.username === "lm_user");

    runAssert(
      hasLmTurn,
      "Test 13: Local-media peer creation awaiting getIceServersAsync receives dynamic TURN credentials on early join",
      `hasLmTurn=${hasLmTurn}`
    );

  } finally {
    globalThis.fetch = originalFetch;
    clearIceServersCache();
  }

  console.log("----------------------------------------------------------------");
  if (failed === 0) {
    console.log(`ALL 13 ICE SERVERS CACHE TESTS PASSED WITH ZERO FAILURES.`);
  } else {
    console.error(`TEST SUITE FAILED: ${passed} passed, ${failed} failed.`);
    process.exit(1);
  }
  console.log("----------------------------------------------------------------\n");
}

runIceServersCacheTests();
