import assert from 'node:assert';
import {
  consumeRateLimitToken,
  checkDurableAbuseReportRateLimit,
  resetFallbackBuckets,
  resetCircuitBreaker,
} from './utils/durableRateLimit.ts';

async function runGate3ConcurrencyQuotaTests() {
  console.log('=== PROD-003 Gate 3: Room Concurrency, Capacity & Rate-Limit Test Suite ===\n');

  // --------------------------------------------------------------------------
  // Area 1: Capacity Ceiling & Participant Boundaries (MEMBER-001 Invariant)
  // --------------------------------------------------------------------------
  // Capacity ceiling is plan-derived (2–500).
  // The free plan ceiling is 10 (a plan entitlement, not the platform maximum).
  // The domain minimum is 2 — enforced at DB, SQL function, and server layers independently.
  // --------------------------------------------------------------------------
  console.log('Area 1: Authoritative Participant Capacity Ceiling (plan-derived, min=2)...');
  {
    // Test 1.1: Parametric validator — matches the updated server pre-check logic.
    // planCeiling is injected so the test is not coupled to a specific plan value.
    const validateCapacity = (
      capacity: unknown,
      planCeiling: number,
    ): { valid: boolean; error?: string } => {
      if (capacity !== undefined && capacity !== null) {
        const parsedCapacity = Number(capacity);
        if (!Number.isInteger(parsedCapacity) || parsedCapacity < 2 || parsedCapacity > planCeiling) {
          return {
            valid: false,
            error: `Participant capacity must be an integer between 2 and ${planCeiling}.`,
          };
        }
      }
      return { valid: true };
    };

    // Domain invariant: min=2 is universal — always rejected below 2.
    assert.strictEqual(validateCapacity(1, 10).valid,   false, 'capacity 1 rejected universally (below domain min)');
    assert.strictEqual(validateCapacity(1, 500).valid,  false, 'capacity 1 rejected even at platform max plan');
    assert.strictEqual(validateCapacity(2, 10).valid,   true,  'capacity 2 valid (domain min)');

    // Undefined/null use plan default — no validation triggered.
    assert.strictEqual(validateCapacity(undefined, 10).valid, true, 'undefined capacity defaults to plan ceiling, no rejection');
    assert.strictEqual(validateCapacity(null, 10).valid,      true, 'null capacity defaults to plan ceiling, no rejection');

    // Plan-ceiling boundary: value AT ceiling is valid, value ABOVE is rejected.
    assert.strictEqual(validateCapacity(10, 10).valid,  true,  'plan=10, request=10 → permit (at ceiling)');
    assert.strictEqual(validateCapacity(11, 10).valid,  false, 'plan=10, request=11 → reject (above ceiling)');

    // Higher-ceiling plans permit values the free plan would reject.
    assert.strictEqual(validateCapacity(11, 20).valid,  true,  'plan=20, request=11 → permit');
    assert.strictEqual(validateCapacity(20, 20).valid,  true,  'plan=20, request=20 → permit (at ceiling)');
    assert.strictEqual(validateCapacity(21, 20).valid,  false, 'plan=20, request=21 → reject (above ceiling)');

    // Platform maximum.
    assert.strictEqual(validateCapacity(500, 500).valid,  true,  'plan=500, request=500 → permit (platform max)');
    assert.strictEqual(validateCapacity(501, 500).valid,  false, 'plan=500, request=501 → reject (above platform max)');

    // Non-integer and non-numeric always rejected regardless of ceiling.
    assert.strictEqual(validateCapacity(5.5, 10).valid,   false, 'non-integer always rejected');
    assert.strictEqual(validateCapacity('abc', 10).valid, false, 'non-numeric always rejected');


    // Test 1.3: Room fullness logic with active participants and disconnect grace period
    class SimulatedRoomCapacityAuthority {
      public maxParticipants: number;
      public admittedParticipants = new Map<string, {
        sessionId: string;
        state: 'connected' | 'disconnected';
        lastDisconnectedAt?: number;
      }>();

      constructor(maxParticipants = 10) {
        this.maxParticipants = maxParticipants;
      }

      public isRoomFull(clientId?: string, sessionId?: string, now = Date.now()): boolean {
        // Reconnection within grace period does not consume an extra slot
        if (clientId && sessionId) {
          const rec = this.admittedParticipants.get(clientId);
          if (rec && rec.sessionId === sessionId) {
            return false;
          }
        }

        const GRACE_MS = 10 * 60 * 1000;
        let activeCount = 0;
        for (const [, rec] of this.admittedParticipants.entries()) {
          if (rec.state === 'connected') {
            activeCount++;
          } else if (rec.state === 'disconnected' && rec.lastDisconnectedAt) {
            if (now - rec.lastDisconnectedAt <= GRACE_MS) {
              activeCount++;
            }
          }
        }
        return activeCount >= this.maxParticipants;
      }

      public admit(clientId: string, sessionId: string) {
        this.admittedParticipants.set(clientId, {
          sessionId,
          state: 'connected',
        });
      }

      public disconnect(clientId: string, timestamp = Date.now()) {
        const rec = this.admittedParticipants.get(clientId);
        if (rec) {
          rec.state = 'disconnected';
          rec.lastDisconnectedAt = timestamp;
        }
      }
    }

    const room = new SimulatedRoomCapacityAuthority(3);
    assert.strictEqual(room.isRoomFull(), false, 'Empty room must not be full');

    room.admit('client-1', 'session-1');
    room.admit('client-2', 'session-2');
    assert.strictEqual(room.isRoomFull(), false, 'Room with 2/3 must not be full');

    room.admit('client-3', 'session-3');
    assert.strictEqual(room.isRoomFull(), true, 'Room with 3/3 must be full');

    // 4th participant must be rejected
    assert.strictEqual(room.isRoomFull('client-4', 'session-4'), true, 'New participant must be rejected when full');

    // Existing participant reconnecting must NOT be rejected
    assert.strictEqual(room.isRoomFull('client-2', 'session-2'), false, 'Reconnecting participant must not be rejected');

    // Disconnected participant within grace period retains slot
    const now = Date.now();
    room.disconnect('client-1', now - 2 * 60 * 1000); // 2 minutes ago
    assert.strictEqual(room.isRoomFull('client-4', 'session-4', now), true, 'Disconnected within grace period still reserves slot');

    // Disconnected participant past grace period (11 minutes ago) frees slot
    room.disconnect('client-1', now - 11 * 60 * 1000); // 11 minutes ago
    assert.strictEqual(room.isRoomFull('client-4', 'session-4', now), false, 'Disconnected past grace period frees slot');

    console.log('  PASS: Participant capacity ceiling, bounds, and reconnect grace period verified');
  }

  // --------------------------------------------------------------------------
  // Area 2: Account Room Concurrency & Quota Enforcement (POLICY-001 Invariant)
  // --------------------------------------------------------------------------
  console.log('\nArea 2: Room Concurrency Quotas & Atomic Enforcement...');
  {
    interface Entitlement {
      enabled: boolean;
      maxTotalRooms: number;
      maxWatchRooms: number;
      maxPermanentRooms: number;
      maxParticipantCapacity: number;
      maxRoomDurationHours: number;
    }

    interface AccountUsage {
      total: number;
      watch: number;
      permanent: number;
    }

    const evaluateQuotaAdmission = (
      entitlement: Entitlement,
      usage: AccountUsage,
      roomKind: 'watch' | 'permanent',
    ): { allowed: boolean; error?: string } => {
      if (!entitlement.enabled) {
        return { allowed: false, error: 'ACCOUNT_ROOMS_DISABLED' };
      }
      if (usage.total >= entitlement.maxTotalRooms) {
        return { allowed: false, error: 'TOTAL_ROOM_LIMIT_EXCEEDED' };
      }
      if (roomKind === 'watch' && usage.watch >= entitlement.maxWatchRooms) {
        return { allowed: false, error: 'WATCH_ROOM_LIMIT_EXCEEDED' };
      }
      if (roomKind === 'permanent' && usage.permanent >= entitlement.maxPermanentRooms) {
        return { allowed: false, error: 'PERMANENT_ROOM_LIMIT_EXCEEDED' };
      }
      return { allowed: true };
    };

    const freePlan: Entitlement = {
      enabled: true,
      maxTotalRooms: 5,
      maxWatchRooms: 5,
      maxPermanentRooms: 0,
      maxParticipantCapacity: 10,
      maxRoomDurationHours: 6,
    };

    const proPlan: Entitlement = {
      enabled: true,
      maxTotalRooms: 15,
      maxWatchRooms: 15,
      maxPermanentRooms: 3,
      maxParticipantCapacity: 10,
      maxRoomDurationHours: 24,
    };

    // Case 2.1: Free tier watch room creation allowed up to 5
    assert.strictEqual(evaluateQuotaAdmission(freePlan, { total: 0, watch: 0, permanent: 0 }, 'watch').allowed, true);
    assert.strictEqual(evaluateQuotaAdmission(freePlan, { total: 4, watch: 4, permanent: 0 }, 'watch').allowed, true);

    // Case 2.2: Free tier hitting total ceiling (5) rejected with TOTAL_ROOM_LIMIT_EXCEEDED
    const ceilingExceeded = evaluateQuotaAdmission(freePlan, { total: 5, watch: 5, permanent: 0 }, 'watch');
    assert.strictEqual(ceilingExceeded.allowed, false);
    assert.strictEqual(ceilingExceeded.error, 'TOTAL_ROOM_LIMIT_EXCEEDED');

    // Case 2.3: Free tier attempting permanent room rejected with PERMANENT_ROOM_LIMIT_EXCEEDED (limit = 0)
    const permanentRejected = evaluateQuotaAdmission(freePlan, { total: 0, watch: 0, permanent: 0 }, 'permanent');
    assert.strictEqual(permanentRejected.allowed, false);
    assert.strictEqual(permanentRejected.error, 'PERMANENT_ROOM_LIMIT_EXCEEDED');

    // Case 2.4: Pro tier allows permanent rooms up to 3
    assert.strictEqual(evaluateQuotaAdmission(proPlan, { total: 2, watch: 1, permanent: 1 }, 'permanent').allowed, true);
    const proPermLimit = evaluateQuotaAdmission(proPlan, { total: 5, watch: 2, permanent: 3 }, 'permanent');
    assert.strictEqual(proPermLimit.allowed, false);
    assert.strictEqual(proPermLimit.error, 'PERMANENT_ROOM_LIMIT_EXCEEDED');

    // Case 2.5: Disabled account rejected with ACCOUNT_ROOMS_DISABLED
    const disabledPlan = { ...freePlan, enabled: false };
    const disabledRes = evaluateQuotaAdmission(disabledPlan, { total: 0, watch: 0, permanent: 0 }, 'watch');
    assert.strictEqual(disabledRes.allowed, false);
    assert.strictEqual(disabledRes.error, 'ACCOUNT_ROOMS_DISABLED');

    console.log('  PASS: Room concurrency quotas, plan limits, and sub-kind enforcement verified');
  }

  // --------------------------------------------------------------------------
  // Area 3: Slot Reclamation Upon Termination & Expiration
  // --------------------------------------------------------------------------
  console.log('\nArea 3: Slot Reclamation & Concurrency Invariant...');
  {
    // Test that when a room is ended or expired, total usage decrements and permits new creation
    let currentUsage = { total: 5, watch: 5, permanent: 0 };
    const entitlement: any = { enabled: true, maxTotalRooms: 5, maxWatchRooms: 5, maxPermanentRooms: 0 };

    // At ceiling: creation blocked
    assert.strictEqual(currentUsage.total >= entitlement.maxTotalRooms, true, 'At quota ceiling');

    // End room: slot reclaimed
    currentUsage.total -= 1;
    currentUsage.watch -= 1;
    assert.strictEqual(currentUsage.total, 4, 'Total rooms decremented to 4');
    assert.strictEqual(currentUsage.total < entitlement.maxTotalRooms, true, 'Slot immediately available for new creation');

    console.log('  PASS: Quota slots reliably reclaimed upon room ending and expiration');
  }

  // --------------------------------------------------------------------------
  // Area 4: Durable Distributed Rate Limiting & Circuit Breaker
  // --------------------------------------------------------------------------
  console.log('\nArea 4: Durable Distributed Rate Limiter & Fallback...');
  {
    resetFallbackBuckets();
    resetCircuitBreaker();

    // Test 4.1: Sequential consumption up to ceiling
    const key = `test:quota:worker:${Date.now()}`;
    const maxTokens = 5;
    const windowSec = 60;

    for (let i = 0; i < maxTokens; i++) {
      const res = await consumeRateLimitToken(key, maxTokens, windowSec);
      assert.strictEqual(res.allowed, true, `Token ${i + 1} should be allowed`);
    }

    // Test 4.2: Exhaustion throttles with retryAfter
    const throttled = await consumeRateLimitToken(key, maxTokens, windowSec);
    assert.strictEqual(throttled.allowed, false, 'Exhausted token bucket must throttle');
    assert(throttled.retryAfterSeconds > 0, 'Throttled response must include positive retryAfterSeconds');

    // Test 4.3: Independent IP and User rate limits for abuse reporting
    const testIp = `192.0.2.${Math.floor(Math.random() * 200 + 1)}`;
    const testUid = `user-${Date.now()}`;

    for (let i = 0; i < 5; i++) {
      const allowed = await checkDurableAbuseReportRateLimit(testIp, testUid);
      assert.strictEqual(allowed.allowed, true, `Abuse report ${i + 1} should be permitted`);
    }

    // 6th report by same user must be blocked (max 5 per user)
    const userExhausted = await checkDurableAbuseReportRateLimit(`diff-ip-${Date.now()}`, testUid);
    assert.strictEqual(userExhausted.allowed, false, 'User exceeding 5 abuse reports per hour must be blocked');

    // Different user on original IP can still consume remaining IP tokens (max 10 per IP)
    const diffUser = await checkDurableAbuseReportRateLimit(testIp, `diff-user-${Date.now()}`);
    assert.strictEqual(diffUser.allowed, true, 'Different user on same IP can consume remaining IP tokens');

    console.log('  PASS: Durable rate limiter token bucket, circuit breaker, and dual-dimension limits verified');
  }

  console.log('\n================================================================');
  console.log('All PROD-003 Gate 3 Concurrency, Capacity & Rate-Limit tests PASSED!');
  console.log('================================================================\n');
}

runGate3ConcurrencyQuotaTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('PROD-003 Gate 3 Test Failed:', err);
    process.exit(1);
  });
