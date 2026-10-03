import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { createRoomAdmissionRouter } from "./roomAdmissionRouter.js";
import { Room } from "../room.js";

async function request(
  server: http.Server,
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: any;
  } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }> {
  const address = server.address() as any;
  const port = address.port;
  return new Promise((resolve, reject) => {
    const data = options.body ? JSON.stringify(options.body) : undefined;
    const req = http.request(
      `http://127.0.0.1:${port}${path}`,
      {
        method: options.method || "GET",
        headers: {
          ...(data
            ? {
                "Content-Type": "application/json",
                "Content-Length": String(Buffer.byteLength(data)),
              }
            : {}),
          ...options.headers,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          let parsed: any;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode || 0, headers: res.headers, body: parsed });
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function createMockIo(): any {
  return {
    of: () => ({
      use: () => {},
      on: () => {},
      emit: () => {},
    }),
    emit: () => {},
  };
}

test("roomAdmissionRouter Suite", async (t) => {
  const mockIo = createMockIo();

  await t.test("POST /verifyPasscode - input validation and auth", async () => {
    const rooms = new Map<string, Room>();
    const router = createRoomAdmissionRouter({
      rooms,
      postgres: null,
      getOrCreateRoom: async () => null,
      validateUserTokenFn: async () => ({ uid: "u1" }),
    });

    const app = express();
    app.use(express.json());
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      // 1. Missing roomId
      const res1 = await request(server, "/verifyPasscode", {
        method: "POST",
        body: {},
      });
      assert.equal(res1.status, 400);
      assert.equal(res1.body.valid, false);
      assert.equal(res1.body.error, "Missing room identifier.");

      // 2. Non-string roomId
      const res2 = await request(server, "/verifyPasscode", {
        method: "POST",
        body: { roomId: 123 },
      });
      assert.equal(res2.status, 400);
      assert.equal(res2.body.valid, false);

      // 3. Missing bearer token
      const res3 = await request(server, "/verifyPasscode", {
        method: "POST",
        body: { roomId: "test-room" },
      });
      assert.equal(res3.status, 401);
      assert.equal(res3.body.valid, false);
      assert.equal(res3.body.code, "AUTH_REQUIRED");

      // 4. EMAIL_NOT_VERIFIED token
      const unverifiedRouter = createRoomAdmissionRouter({
        rooms,
        postgres: null,
        getOrCreateRoom: async () => null,
        validateUserTokenFn: async () => "EMAIL_NOT_VERIFIED",
      });
      const unverifiedApp = express();
      unverifiedApp.use(express.json());
      unverifiedApp.use(unverifiedRouter);
      const unverifiedServer = http.createServer(unverifiedApp);
      await new Promise<void>((resolve) => unverifiedServer.listen(0, resolve));
      try {
        const res4 = await request(unverifiedServer, "/verifyPasscode", {
          method: "POST",
          headers: { Authorization: "Bearer test-token" },
          body: { roomId: "test-room" },
        });
        assert.equal(res4.status, 401);
        assert.equal(res4.body.code, "AUTH_REQUIRED");
      } finally {
        unverifiedServer.close();
      }
    } finally {
      server.close();
    }
  });

  await t.test("POST /verifyPasscode - rate limiting enforcement", async () => {
    const rooms = new Map<string, Room>();
    const router = createRoomAdmissionRouter({
      rooms,
      postgres: null,
      getOrCreateRoom: async () => null,
      validateUserTokenFn: async () => ({ uid: "u1" }),
      checkPasscodeRateLimitsFn: async () => ({ allowed: false, retryAfterSeconds: 42 }),
    });

    const app = express();
    app.use(express.json());
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      const res = await request(server, "/verifyPasscode", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: { roomId: "rate-limited-room" },
      });
      assert.equal(res.status, 429);
      assert.equal(res.body.valid, false);
      assert.equal(res.headers["retry-after"], "42");
      assert.equal(res.body.retryAfterSeconds, 42);
    } finally {
      server.close();
    }
  });

  await t.test("POST /verifyPasscode - anti-enumeration protection and failure recording", async () => {
    let failureRecorded = false;
    let targetRecorded: any = null;

    const mockPostgres = {
      query: async () => ({ rows: [] }),
    } as any;

    const rooms = new Map<string, Room>();
    const router = createRoomAdmissionRouter({
      rooms,
      postgres: mockPostgres,
      getOrCreateRoom: async () => null,
      validateUserTokenFn: async () => ({ uid: "u1" }),
      checkPasscodeRateLimitsFn: async () => ({ allowed: true }),
      recordPasscodeFailureFn: async (target) => {
        failureRecorded = true;
        targetRecorded = target;
      },
    });

    const app = express();
    app.use(express.json());
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      const res = await request(server, "/verifyPasscode", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: { roomId: "non-existent-room", passcode: "12345678" },
      });
      // Generic 401 indistinguishable from wrong passcode to prevent enumeration
      assert.equal(res.status, 401);
      assert.equal(res.body.valid, false);
      assert.equal(res.body.error, "Incorrect room passcode. Please try again.");
      assert.equal(failureRecorded, true);
      assert.equal(targetRecorded.roomId, "non-existent-room");
      assert.equal(targetRecorded.userId, "u1");
    } finally {
      server.close();
    }
  });

  await t.test("POST /verifyPasscode - terminal room check", async () => {
    const mockPostgres = {
      query: async () => ({
        rows: [
          {
            passcode: "87654321",
            status: "ended",
            owner_id: "owner-1",
            participants_locked: false,
            max_participants: 20,
            isPermanent: false,
            expiresAt: new Date(Date.now() - 1000).toISOString(),
          },
        ],
      }),
    } as any;

    const rooms = new Map<string, Room>();
    const router = createRoomAdmissionRouter({
      rooms,
      postgres: mockPostgres,
      getOrCreateRoom: async () => null,
      validateUserTokenFn: async () => ({ uid: "u1" }),
      checkPasscodeRateLimitsFn: async () => ({ allowed: true }),
      isTerminalRoomFn: () => true,
    });

    const app = express();
    app.use(express.json());
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      const res = await request(server, "/verifyPasscode", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: { roomId: "terminal-room", passcode: "87654321" },
      });
      assert.equal(res.status, 401);
      assert.equal(res.body.valid, false);
      assert.equal(res.body.error, "This room has ended or expired.");
    } finally {
      server.close();
    }
  });

  await t.test("POST /verifyPasscode - passcode validation and verification", async () => {
    const mockPostgres = {
      query: async () => ({
        rows: [
          {
            passcode: "$2a$10$encryptedbcryptpasscodehere12345",
            status: "active",
            owner_id: "owner-1",
            participants_locked: false,
            max_participants: 20,
            isPermanent: true,
          },
        ],
      }),
    } as any;

    let failureCount = 0;
    const rooms = new Map<string, Room>();
    const router = createRoomAdmissionRouter({
      rooms,
      postgres: mockPostgres,
      getOrCreateRoom: async () => null,
      validateUserTokenFn: async () => ({ uid: "u1" }),
      checkPasscodeRateLimitsFn: async () => ({ allowed: true }),
      recordPasscodeFailureFn: async () => {
        failureCount++;
      },
      isTerminalRoomFn: () => false,
      isBcryptHashFn: () => true,
      verifyRoomPasscodeFn: async (pass) => pass === "correct8",
    });

    const app = express();
    app.use(express.json());
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      // 1. Passcode not 8 characters
      const resShort = await request(server, "/verifyPasscode", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: { roomId: "passcode-room", passcode: "short" },
      });
      assert.equal(resShort.status, 400);
      assert.equal(resShort.body.error, "Passcode must be strictly 8 characters.");

      // 2. Incorrect passcode (8 chars)
      const resWrong = await request(server, "/verifyPasscode", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: { roomId: "passcode-room", passcode: "wrong000" },
      });
      assert.equal(resWrong.status, 401);
      assert.equal(resWrong.body.error, "Incorrect room passcode. Please try again.");
      assert.equal(failureCount, 1);
    } finally {
      server.close();
    }
  });

  await t.test("POST /verifyPasscode - successful admission token issuance and DB recording", async () => {
    let limitsReset = false;
    let dbInserted = false;
    const memoryRoom = new Room(mockIo, "room-success");
    const rooms = new Map<string, Room>([["room-success", memoryRoom]]);

    const mockPostgres = {
      query: async (sql: string) => {
        if (sql.includes("INSERT INTO public.room_admissions")) {
          dbInserted = true;
          return { rowCount: 1 };
        }
        return {
          rows: [
            {
              passcode: "12345678",
              status: "active",
              owner_id: "owner-1",
              participants_locked: false,
              max_participants: 20,
              isPermanent: true,
            },
          ],
        };
      },
    } as any;

    const router = createRoomAdmissionRouter({
      rooms,
      postgres: mockPostgres,
      getOrCreateRoom: async () => memoryRoom,
      validateUserTokenFn: async () => ({ uid: "u1" }),
      checkPasscodeRateLimitsFn: async () => ({ allowed: true }),
      resetPasscodeLimitsFn: async () => {
        limitsReset = true;
      },
      isTerminalRoomFn: () => false,
      isBcryptHashFn: () => false,
      issueRoomAdmissionTokenFn: () => ({
        allowed: true,
        admissionToken: "mock-signed-admission-token-xyz",
      } as any),
    });

    const app = express();
    app.use(express.json());
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      const res = await request(server, "/verifyPasscode", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: { roomId: "room-success", passcode: "12345678", sessionId: "client-sess-1" },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.valid, true);
      assert.equal(res.body.admissionToken, "mock-signed-admission-token-xyz");
      assert.equal(res.body.sessionId, "client-sess-1");
      assert.equal(limitsReset, true);
      assert.equal(dbInserted, true);
      assert.equal(memoryRoom.admittedMembers.has("u1"), true);
    } finally {
      server.close();
    }
  });

  await t.test("POST /verifyPasscode - lock / capacity gating error mapping", async () => {
    const memoryRoom = new Room(mockIo, "room-locked");
    const rooms = new Map<string, Room>([["room-locked", memoryRoom]]);

    const mockPostgres = {
      query: async () => ({
        rows: [
          {
            passcode: null, // no passcode
            status: "active",
            owner_id: "owner-1",
            participants_locked: true,
            max_participants: 2,
            isPermanent: true,
          },
        ],
      }),
    } as any;

    const router = createRoomAdmissionRouter({
      rooms,
      postgres: mockPostgres,
      getOrCreateRoom: async () => memoryRoom,
      validateUserTokenFn: async () => ({ uid: "guest-user" }),
      checkPasscodeRateLimitsFn: async () => ({ allowed: true }),
      isTerminalRoomFn: () => false,
      issueRoomAdmissionTokenFn: () => ({
        allowed: false,
        status: 403,
        error: "This room is currently locked by the host.",
        code: "PARTICIPANTS_LOCKED",
      } as any),
    });

    const app = express();
    app.use(express.json());
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      const res = await request(server, "/verifyPasscode", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: { roomId: "room-locked" },
      });
      assert.equal(res.status, 403);
      assert.equal(res.body.valid, false);
      assert.equal(res.body.code, "PARTICIPANTS_LOCKED");
      assert.equal(res.body.error, "This room is currently locked by the host.");
    } finally {
      server.close();
    }
  });

  await t.test("POST /room-admission/restore - input validation & auth", async () => {
    const rooms = new Map<string, Room>();
    const router = createRoomAdmissionRouter({
      rooms,
      postgres: null,
      getOrCreateRoom: async () => null,
      validateUserTokenFn: async () => ({ uid: "u1" }),
    });

    const app = express();
    app.use(express.json());
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      // 1. Missing roomId
      const res1 = await request(server, "/room-admission/restore", {
        method: "POST",
        body: {},
      });
      assert.equal(res1.status, 400);
      assert.equal(res1.body.valid, false);

      // 2. Unauthenticated
      const res2 = await request(server, "/room-admission/restore", {
        method: "POST",
        body: { roomId: "restore-room" },
      });
      assert.equal(res2.status, 401);
      assert.equal(res2.body.code, "AUTH_REQUIRED");
    } finally {
      server.close();
    }
  });

  await t.test("POST /room-admission/restore - room not found & terminal checks", async () => {
    const rooms = new Map<string, Room>();
    let returnTerminal = false;

    const mockPostgres = {
      query: async () => {
        if (returnTerminal) {
          return {
            rows: [
              {
                passcode: null,
                status: "ended",
                owner_id: "o1",
                isPermanent: false,
              },
            ],
          };
        }
        return { rows: [] };
      },
    } as any;

    const router = createRoomAdmissionRouter({
      rooms,
      postgres: mockPostgres,
      getOrCreateRoom: async () => null,
      validateUserTokenFn: async () => ({ uid: "u1" }),
      isTerminalRoomFn: () => returnTerminal,
    });

    const app = express();
    app.use(express.json());
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      // 1. Room not found (404)
      const res404 = await request(server, "/room-admission/restore", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: { roomId: "missing-room" },
      });
      assert.equal(res404.status, 404);
      assert.equal(res404.body.code, "ROOM_NOT_FOUND");

      // 2. Terminal room (401)
      returnTerminal = true;
      const resTerminal = await request(server, "/room-admission/restore", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: { roomId: "ended-room" },
      });
      assert.equal(resTerminal.status, 401);
      assert.equal(resTerminal.body.code, "ROOM_TERMINAL");
    } finally {
      server.close();
    }
  });

  await t.test("POST /room-admission/restore - ban enforcement (DB and memory)", async () => {
    const memoryRoom = new Room(mockIo, "banned-room");
    (memoryRoom as any).isBanned = () => true;
    const rooms = new Map<string, Room>([["banned-room", memoryRoom]]);

    let dbBan = true;
    const mockPostgres = {
      query: async (sql: string) => {
        if (sql.includes("FROM rooms")) {
          return {
            rows: [
              {
                passcode: null,
                status: "active",
                owner_id: "other-owner",
                isPermanent: true,
              },
            ],
          };
        }
        if (sql.includes("FROM room_bans")) {
          return dbBan ? { rows: [{ id: "ban-1" }] } : { rows: [] };
        }
        return { rows: [] };
      },
    } as any;

    const router = createRoomAdmissionRouter({
      rooms,
      postgres: mockPostgres,
      getOrCreateRoom: async () => memoryRoom,
      validateUserTokenFn: async () => ({ uid: "banned-user" }),
      isTerminalRoomFn: () => false,
    });

    const app = express();
    app.use(express.json());
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      // 1. Banned in DB
      const resDbBan = await request(server, "/room-admission/restore", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: { roomId: "banned-room" },
      });
      assert.equal(resDbBan.status, 403);
      assert.equal(resDbBan.body.code, "BANNED");
      assert.equal(resDbBan.body.error, "You have been banned from this room.");

      // 2. Banned in memory
      dbBan = false;
      const resMemBan = await request(server, "/room-admission/restore", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: { roomId: "banned-room" },
      });
      assert.equal(resMemBan.status, 403);
      assert.equal(resMemBan.body.code, "BANNED");
      assert.equal(resMemBan.body.error, "You have been removed from this room.");
    } finally {
      server.close();
    }
  });

  await t.test("POST /room-admission/restore - active admission check & revocation", async () => {
    const memoryRoom = new Room(mockIo, "restore-room");
    const rooms = new Map<string, Room>([["restore-room", memoryRoom]]);

    let admissionState: "none" | "revoked" | "active" = "none";
    const mockPostgres = {
      query: async (sql: string) => {
        if (sql.includes("FROM rooms")) {
          return {
            rows: [
              {
                passcode: null,
                status: "active",
                owner_id: "room-owner-uid",
                isPermanent: true,
              },
            ],
          };
        }
        if (sql.includes("FROM room_bans")) {
          return { rows: [] };
        }
        if (sql.includes("FROM room_admissions")) {
          if (admissionState === "none") return { rows: [] };
          if (admissionState === "revoked") {
            return {
              rows: [{ admission_method: "passcode", admitted_at: new Date(), revoked_at: new Date() }],
            };
          }
          return {
            rows: [{ admission_method: "passcode", admitted_at: new Date(), revoked_at: null }],
          };
        }
        return { rows: [] };
      },
    } as any;

    let isRestorationFlagPassed = false;
    const router = createRoomAdmissionRouter({
      rooms,
      postgres: mockPostgres,
      getOrCreateRoom: async () => memoryRoom,
      validateUserTokenFn: async () => ({ uid: "guest-uid" }),
      isTerminalRoomFn: () => false,
      issueRoomAdmissionTokenFn: (opts: any) => {
        isRestorationFlagPassed = opts.isRestoration === true;
        return {
          allowed: true,
          admissionToken: "restored-token-456",
        } as any;
      },
    });

    const app = express();
    app.use(express.json());
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      // 1. No admission record
      const resNoAdm = await request(server, "/room-admission/restore", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: { roomId: "restore-room" },
      });
      assert.equal(resNoAdm.status, 401);
      assert.equal(resNoAdm.body.code, "NO_ACTIVE_ADMISSION");

      // 2. Revoked admission record
      admissionState = "revoked";
      const resRevoked = await request(server, "/room-admission/restore", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: { roomId: "restore-room" },
      });
      assert.equal(resRevoked.status, 401);
      assert.equal(resRevoked.body.code, "NO_ACTIVE_ADMISSION");

      // 3. Active admission record -> restores successfully
      admissionState = "active";
      const resSuccess = await request(server, "/room-admission/restore", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: { roomId: "restore-room" },
      });
      assert.equal(resSuccess.status, 200);
      assert.equal(resSuccess.body.valid, true);
      assert.equal(resSuccess.body.restored, true);
      assert.equal(resSuccess.body.admissionToken, "restored-token-456");
      assert.equal(typeof resSuccess.body.sessionId, "string");
      assert.equal(isRestorationFlagPassed, true);
      assert.equal(memoryRoom.admittedMembers.has("guest-uid"), true);
    } finally {
      server.close();
    }
  });

  await t.test("POST /room-admission/restore - owner bypasses room_admissions table", async () => {
    const memoryRoom = new Room(mockIo, "owner-room");
    const rooms = new Map<string, Room>([["owner-room", memoryRoom]]);

    let queriedRoomAdmissions = false;
    const mockPostgres = {
      query: async (sql: string) => {
        if (sql.includes("FROM rooms")) {
          return {
            rows: [
              {
                passcode: null,
                status: "active",
                owner_id: "owner-uid",
                isPermanent: true,
              },
            ],
          };
        }
        if (sql.includes("FROM room_bans")) {
          return { rows: [] };
        }
        if (sql.includes("FROM room_admissions")) {
          queriedRoomAdmissions = true;
          return { rows: [] };
        }
        return { rows: [] };
      },
    } as any;

    const router = createRoomAdmissionRouter({
      rooms,
      postgres: mockPostgres,
      getOrCreateRoom: async () => memoryRoom,
      validateUserTokenFn: async () => ({ uid: "owner-uid" }),
      isTerminalRoomFn: () => false,
      issueRoomAdmissionTokenFn: () => ({
        allowed: true,
        admissionToken: "owner-token",
      } as any),
    });

    const app = express();
    app.use(express.json());
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      const res = await request(server, "/room-admission/restore", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: { roomId: "owner-room" },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.valid, true);
      assert.equal(res.body.restored, true);
      assert.equal(queriedRoomAdmissions, false); // Owner must never query room_admissions table
    } finally {
      server.close();
    }
  });
}).then(() => {
  process.exit(0);
}).catch((err) => {
  console.error("Test failure:", err);
  process.exit(1);
});
