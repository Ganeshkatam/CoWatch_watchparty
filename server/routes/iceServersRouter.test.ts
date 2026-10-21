import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createIceServersRouter } from "./iceServersRouter.ts";
import { CoturnHmacProvider } from "../services/turnProvider.ts";
import { generateAdmissionToken } from "../utils/admissionToken.ts";
import { coreRedis, edgeRedis, metricsRedis } from "../utils/redis.ts";

interface MockRequest {
  method?: string;
  url?: string;
  ip?: string;
  headers: Record<string, string | undefined>;
  socket?: { remoteAddress?: string };
}

interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: any;
  status(code: number): MockResponse;
  setHeader(name: string, value: string): MockResponse;
  json(data: any): MockResponse;
}

function createMockRes(onComplete?: (res: MockResponse) => void): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    json(data: any) {
      this.body = data;
      if (onComplete) {
        onComplete(this);
      }
      return this;
    },
  };
  return res;
}

async function invokeHandler(router: any, req: MockRequest): Promise<MockResponse> {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (response: MockResponse) => {
      if (!resolved) {
        resolved = true;
        resolve(response);
      }
    };
    const res = createMockRes(done);
    (router as any).handle(req, res, (err?: any) => {
      if (err) {
        res.statusCode = 500;
        res.body = { error: { message: err?.message || String(err) } };
      }
      done(res);
    });
  });
}

test("iceServersRouter Test Suite", async (t) => {
  t.after(() => {
    coreRedis.client?.disconnect();
    edgeRedis.client?.disconnect();
    metricsRedis.client?.disconnect();
  });

  const mockRooms = new Map<string, any>();
  const testSharedSecret = "secret-test-turn-key-32-bytes-long!";
  const testTurnHost = "turn.test.cowatch.tv";

  const turnProvider = new CoturnHmacProvider({
    sharedSecret: testSharedSecret,
    turnHost: testTurnHost,
    portUdp: 3478,
    portTls: 443,
  });

  const validJwt = "valid-mock-jwt-token";
  const unverifiedJwt = "unverified-email-jwt";
  const validUid = "usr_authenticated_123";

  const mockValidateUserToken = async (_id: string, token: string) => {
    if (token === validJwt) {
      return { uid: validUid, email: "user@cowatch.tv" };
    }
    if (token === unverifiedJwt) {
      return "EMAIL_NOT_VERIFIED";
    }
    return null;
  };

  const router = createIceServersRouter({
    rooms: mockRooms,
    turnProvider,
    validateUserTokenFn: mockValidateUserToken as any,
    checkRateLimitFn: async (key: string) => {
      if (key.includes("flooded_ip")) {
        return { allowed: false, retryAfterSeconds: 45, remainingAttempts: 0 };
      }
      return { allowed: true, retryAfterSeconds: 0, remainingAttempts: 9 };
    },
    postgres: {
      query: async (sql: string, params: any[]) => {
        if (sql.includes("FROM rooms WHERE")) {
          const roomId = params[0];
          if (roomId === "room_permanent") {
            return { rows: [{ roomId, status: "active", isPermanent: true, expiresAt: null }] };
          }
          if (roomId === "room_expiring_soon") {
            const soon = new Date(Date.now() + 30 * 1000).toISOString(); // 30s
            return { rows: [{ roomId, status: "active", isPermanent: false, expiresAt: soon }] };
          }
          if (roomId === "room_45m") {
            const later = new Date(Date.now() + 2700 * 1000).toISOString(); // 45m
            return { rows: [{ roomId, status: "active", isPermanent: false, expiresAt: later }] };
          }
          if (roomId === "room_corrupted") {
            return { rows: [{ roomId, status: "active", isPermanent: false, expiresAt: null }] };
          }
          if (roomId === "room_ended") {
            return { rows: [{ roomId, status: "ended", isPermanent: false, expiresAt: null }] };
          }
          return { rows: [] };
        }
        if (sql.includes("FROM room_bans")) {
          const uid = params[1];
          if (uid === "usr_banned") {
            return { rows: [{ id: "ban_1" }] };
          }
          return { rows: [] };
        }
        if (sql.includes("FROM room_admissions")) {
          const uid = params[1];
          if (uid === "usr_revoked") {
            return { rows: [{ revoked_at: new Date().toISOString() }] };
          }
          return { rows: [{ revoked_at: null }] };
        }
        return { rows: [] };
      },
    } as any,
  });

  await t.test("1. Rate limit enforcement (429 Too Many Requests)", async () => {
    const req: MockRequest = {
      method: "GET",
      url: "/api/media/ice-servers",
      ip: "flooded_ip",
      headers: {},
    };
    const res = await invokeHandler(router, req);
    assert.equal(res.statusCode, 429);
    assert.equal(res.headers["retry-after"], "45");
    assert.equal(res.body?.error?.code, "RATE_LIMITED");
  });

  await t.test("2. Unauthenticated request without headers returns 401", async () => {
    const req: MockRequest = {
      method: "GET",
      url: "/api/media/ice-servers",
      headers: {},
    };
    const res = await invokeHandler(router, req);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body?.error?.code, "AUTHENTICATION_REQUIRED");
  });

  await t.test("3. Registered user with Bearer token receives valid RFC 5766 credentials", async () => {
    const req: MockRequest = {
      method: "GET",
      url: "/api/media/ice-servers",
      headers: {
        authorization: `Bearer ${validJwt}`,
      },
    };
    const res = await invokeHandler(router, req);
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body?.iceServers));
    assert.equal(res.body?.ttlSeconds, 10800);
    assert.ok(res.body?.expiresAt);
    assert.equal(res.body?.relayStatus, "healthy");

    // Verify RFC 5766 TURN server structure
    const turnEntry = res.body.iceServers.find((s: any) => s.username);
    assert.ok(turnEntry);
    assert.ok(turnEntry.username.endsWith(`:${validUid}`));
    assert.ok(turnEntry.credential);

    // Verify HMAC-SHA1 signature correctness
    const expectedHmac = crypto.createHmac("sha1", testSharedSecret).update(turnEntry.username).digest("base64");
    assert.equal(turnEntry.credential, expectedHmac);
  });

  await t.test("4. Registered user with unverified email token returns 401", async () => {
    const req: MockRequest = {
      method: "GET",
      url: "/api/media/ice-servers",
      headers: {
        authorization: `Bearer ${unverifiedJwt}`,
      },
    };
    const res = await invokeHandler(router, req);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body?.error?.code, "AUTHENTICATION_FAILED");
  });

  await t.test("5. Admitted guest with valid X-Admission-Token returns 200", async () => {
    const guestUid = "usr_guest_456";
    const guestSession = "sess_guest_789";
    const token = generateAdmissionToken({ roomId: "room_permanent", userId: guestUid, sessionId: guestSession, ttlSeconds: 3600 });

    const req: MockRequest = {
      method: "GET",
      url: "/api/media/ice-servers",
      headers: {
        "x-admission-token": token,
        "x-room-id": "room_permanent",
        "x-caller-uid": guestUid,
        "x-session-id": guestSession,
      },
    };
    const res = await invokeHandler(router, req);
    assert.equal(res.statusCode, 200);
    const turnEntry = res.body?.iceServers?.find((s: any) => s.username);
    assert.ok(turnEntry?.username?.endsWith(`:${guestUid}`));
  });

  await t.test("6. Guest missing X-Room-Id header returns 400", async () => {
    const token = generateAdmissionToken({ roomId: "room_permanent", userId: "u1", sessionId: "s1", ttlSeconds: 3600 });
    const req: MockRequest = {
      method: "GET",
      url: "/api/media/ice-servers",
      headers: {
        "x-admission-token": token,
        "x-caller-uid": "u1",
        "x-session-id": "s1",
      },
    };
    const res = await invokeHandler(router, req);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body?.error?.code, "ROOM_ID_REQUIRED");
  });

  await t.test("6B. Guest missing X-Caller-Uid or X-Session-Id header returns 400", async () => {
    const token = generateAdmissionToken({ roomId: "room_permanent", userId: "u1", sessionId: "s1", ttlSeconds: 3600 });
    const reqNoUid: MockRequest = {
      method: "GET",
      url: "/api/media/ice-servers",
      headers: {
        "x-admission-token": token,
        "x-room-id": "room_permanent",
        "x-session-id": "s1",
      },
    };
    const resNoUid = await invokeHandler(router, reqNoUid);
    assert.equal(resNoUid.statusCode, 400);
    assert.equal(resNoUid.body?.error?.code, "IDENTITY_HEADERS_REQUIRED");

    const reqNoSess: MockRequest = {
      method: "GET",
      url: "/api/media/ice-servers",
      headers: {
        "x-admission-token": token,
        "x-room-id": "room_permanent",
        "x-caller-uid": "u1",
      },
    };
    const resNoSess = await invokeHandler(router, reqNoSess);
    assert.equal(resNoSess.statusCode, 400);
    assert.equal(resNoSess.body?.error?.code, "IDENTITY_HEADERS_REQUIRED");
  });

  await t.test("7. Cross-room token misuse is strictly rejected (401)", async () => {
    // Token issued for room_A
    const token = generateAdmissionToken({ roomId: "room_A", userId: "u1", sessionId: "s1", ttlSeconds: 3600 });
    // Presented for room_B
    const req: MockRequest = {
      method: "GET",
      url: "/api/media/ice-servers",
      headers: {
        "x-admission-token": token,
        "x-room-id": "room_B",
        "x-caller-uid": "u1",
        "x-session-id": "s1",
      },
    };
    const res = await invokeHandler(router, req);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body?.error?.code, "ADMISSION_TOKEN_ROOM_MISMATCH");
  });

  await t.test("8. Identity spoofing mismatch between header and token payload returns 403", async () => {
    const token = generateAdmissionToken({ roomId: "room_permanent", userId: "usr_legit", sessionId: "sess_legit", ttlSeconds: 3600 });
    const req: MockRequest = {
      method: "GET",
      url: "/api/media/ice-servers",
      headers: {
        "x-admission-token": token,
        "x-room-id": "room_permanent",
        "x-caller-uid": "usr_attacker", // Spoofed
        "x-session-id": "sess_legit",
      },
    };
    const res = await invokeHandler(router, req);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body?.error?.code, "ADMISSION_TOKEN_USER_MISMATCH");
  });

  await t.test("9. Banned user is rejected with 403 BANNED", async () => {
    const token = generateAdmissionToken({ roomId: "room_permanent", userId: "usr_banned", sessionId: "sess_banned", ttlSeconds: 3600 });
    const req: MockRequest = {
      method: "GET",
      url: "/api/media/ice-servers",
      headers: {
        "x-admission-token": token,
        "x-room-id": "room_permanent",
        "x-caller-uid": "usr_banned",
        "x-session-id": "sess_banned",
      },
    };
    const res = await invokeHandler(router, req);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body?.error?.code, "BANNED");
  });

  await t.test("10. Revoked admission record returns 401 ADMISSION_REVOKED", async () => {
    const token = generateAdmissionToken({ roomId: "room_permanent", userId: "usr_revoked", sessionId: "sess_revoked", ttlSeconds: 3600 });
    const req: MockRequest = {
      method: "GET",
      url: "/api/media/ice-servers",
      headers: {
        "x-admission-token": token,
        "x-room-id": "room_permanent",
        "x-caller-uid": "usr_revoked",
        "x-session-id": "sess_revoked",
      },
    };
    const res = await invokeHandler(router, req);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body?.error?.code, "ADMISSION_REVOKED");
  });

  await t.test("11. Terminal room (ended status) returns 403 ROOM_EXPIRED", async () => {
    const token = generateAdmissionToken({ roomId: "room_ended", userId: "u1", sessionId: "s1", ttlSeconds: 3600 });
    const req: MockRequest = {
      method: "GET",
      url: "/api/media/ice-servers",
      headers: {
        "x-admission-token": token,
        "x-room-id": "room_ended",
        "x-caller-uid": "u1",
        "x-session-id": "s1",
      },
    };
    const res = await invokeHandler(router, req);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body?.error?.code, "ROOM_EXPIRED");
  });

  await t.test("12. Safe rejection threshold: Room expiring in 30s (<60s) returns 403 ROOM_EXPIRING_IMMINENT", async () => {
    const token = generateAdmissionToken({ roomId: "room_expiring_soon", userId: "u1", sessionId: "s1", ttlSeconds: 3600 });
    const req: MockRequest = {
      method: "GET",
      url: "/api/media/ice-servers",
      headers: {
        "x-admission-token": token,
        "x-room-id": "room_expiring_soon",
        "x-caller-uid": "u1",
        "x-session-id": "s1",
      },
    };
    const res = await invokeHandler(router, req);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body?.error?.code, "ROOM_EXPIRING_IMMINENT");
  });

  await t.test("13. TTL clamping: Room expiring in 45m has TTL clamped to 2700s", async () => {
    const token = generateAdmissionToken({ roomId: "room_45m", userId: "u1", sessionId: "s1", ttlSeconds: 3600 });
    const req: MockRequest = {
      method: "GET",
      url: "/api/media/ice-servers",
      headers: {
        "x-admission-token": token,
        "x-room-id": "room_45m",
        "x-caller-uid": "u1",
        "x-session-id": "s1",
      },
    };
    const res = await invokeHandler(router, req);
    assert.equal(res.statusCode, 200);
    // Approximately 2700s (allow +-2s for execution time)
    assert.ok(res.body?.ttlSeconds >= 2698 && res.body?.ttlSeconds <= 2700);
  });

  await t.test("14. Corrupted expiry: Temporary room missing expiresAt fails closed with 500", async () => {
    const token = generateAdmissionToken({ roomId: "room_corrupted", userId: "u1", sessionId: "s1", ttlSeconds: 3600 });
    const req: MockRequest = {
      method: "GET",
      url: "/api/media/ice-servers",
      headers: {
        "x-admission-token": token,
        "x-room-id": "room_corrupted",
        "x-caller-uid": "u1",
        "x-session-id": "s1",
      },
    };
    const res = await invokeHandler(router, req);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body?.error?.code, "CORRUPTED_ROOM_EXPIRY");
  });

  await t.test("15. Unconfigured TURN provider returns STUN-only with relayStatus stun_only", async () => {
    const unconfiguredProvider = new CoturnHmacProvider({
      sharedSecret: "",
      turnHost: "",
    });
    const unconfiguredRouter = createIceServersRouter({
      turnProvider: unconfiguredProvider,
      validateUserTokenFn: mockValidateUserToken as any,
    });
    const req: MockRequest = {
      method: "GET",
      url: "/api/media/ice-servers",
      headers: {
        authorization: `Bearer ${validJwt}`,
      },
    };
    const res = await invokeHandler(unconfiguredRouter, req);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.relayStatus, "stun_only");
    // Verify only STUN servers, no TURN servers with credentials
    const hasTurn = res.body?.iceServers?.some((s: any) => s.username || s.credential);
    assert.equal(hasTurn, false);
  });
});
