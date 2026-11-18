import test, { after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import type { Server } from "socket.io";
import { Room } from "./room.ts";
import { createRoomDiscoveryRouter } from "./routes/roomDiscoveryRouter.ts";
import { createRoomConfigRouter } from "./routes/roomConfigRouter.ts";
import { createRoomLifecycleRouter } from "./routes/roomLifecycleRouter.ts";
import { createRoomAdmissionRouter } from "./routes/roomAdmissionRouter.ts";
import { createRoomOwnerInspectionRouter } from "./routes/roomOwnerInspectionRouter.ts";
import { authorizeRoomAction, type AuthorizationContext, type ActionTarget } from "./roomAuthorization.ts";
import { isValidCanonicalUuid, isValidJoiningCode } from "./utils/roomIdentifier.ts";

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
    of: (nspName: string) => ({
      use: () => {},
      on: () => {},
      emit: () => {},
      disconnectSockets: () => {},
    }),
    emit: () => {},
  };
}

test("Phase 3: Application Boundary & Internal Identity Migration Suite", async (t) => {
  const mockIo = createMockIo() as unknown as Server;

  // =========================================================================
  // 1. DUAL-IDENTITY ROOM CREATION & ALIASED IN-MEMORY REGISTRATION
  // =========================================================================
  await t.test("POST /createRoom returns dual identity & indexes memory map under all aliases", async () => {
    const rooms = new Map<string, Room>();
    const testUuid = "3f82e6d9-8397-4028-98e3-05cfcf858d4a";
    const testJoiningId = "0123456789";

    const mockPostgres = {
      query: async (sql: string, params: any[]) => {
        if (sql.includes("resolve_account_entitlement")) {
          return { rows: [{ max_participant_capacity: 50, max_room_duration_hours: 3 }] };
        }
        if (sql.includes("FROM rooms WHERE passcode_fingerprint = $1")) {
          return { rows: [] };
        }
        if (sql.includes("create_room_authoritative")) {
          return {
            rows: [
              {
                result: {
                  id: testUuid,
                  joiningId: testJoiningId,
                  roomId: params[1],
                  status: "inactive",
                },
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [] };
      },
    } as any;

    const router = createRoomConfigRouter({
      rooms,
      io: mockIo,
      postgres: mockPostgres,
      validateUserTokenFn: async () => ({ uid: "owner-alice", email: "alice@test.com", email_verified: true } as any),
      hashRoomPasscodeFn: async () => "hashed_12345678",
      encryptPasscodeForOwnerFn: () => "encrypted_12345678",
    });

    const app = express();
    app.use(express.json());
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      const res = await request(server, "/createRoom", {
        method: "POST",
        headers: { Authorization: "Bearer token-alice" },
        body: {
          roomTitle: "Dual Identity Test Room",
          passcode: "12345678",
          isPermanent: false,
          durationHours: 2,
        },
      });

      assert.equal(res.status, 200);
      assert.ok(res.body.name, "Response must include moniker name for backward-compatibility");
      assert.equal(res.body.roomId, testUuid, "Response includes canonical UUID roomId");
      assert.equal(res.body.joiningId, testJoiningId, "Response includes 10-digit joiningId");
      assert.ok(isValidCanonicalUuid(res.body.roomId), "roomId must be valid canonical UUID");
      assert.ok(isValidJoiningCode(res.body.joiningId), "joiningId must be valid 10-digit joining code");

      // Verify in-memory aliases all point to the EXACT same Room instance
      const roomByName = rooms.get(res.body.name);
      const roomByUuid = rooms.get(testUuid);
      const roomByCode = rooms.get(testJoiningId);

      assert.ok(roomByName, "Room must be registered in memory by moniker name");
      assert.ok(roomByUuid, "Room must be registered in memory by canonical UUID");
      assert.ok(roomByCode, "Room must be registered in memory by public joining code");
      assert.strictEqual(roomByName, roomByUuid, "Moniker and UUID must resolve to exact same Room reference");
      assert.strictEqual(roomByName, roomByCode, "Moniker and Joining Code must resolve to exact same Room reference");
      assert.equal(roomByName?.roomId, testUuid);
      assert.equal(roomByName?.joiningId, testJoiningId);
    } finally {
      server.close();
    }
  });

  // =========================================================================
  // 2. UNIVERSAL ROOM DISCOVERY (UUID, JOINING CODE, MONIKER)
  // =========================================================================
  await t.test("GET /roomInfo/:roomId resolves across UUID, joining code, and legacy moniker", async () => {
    const rooms = new Map<string, Room>();
    const testUuid = "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d";
    const testJoiningId = "9876543210";
    const testMoniker = "retro-movie-night";

    const mockDbRow = {
      joining_id: testJoiningId,
      roomId: testUuid,
      roomTitle: "Retro Movie Night",
      roomDescription: "Watching 80s classics",
      coverPhoto: "https://example.com/cover.jpg",
      status: "active",
      expiresAt: null,
      isPermanent: true,
      requiresPasscode: false,
      owner_id: "owner-bob",
      participants_locked: false,
      max_participants: 20,
    };

    const mockPostgres = {
      query: async (sql: string, params: any[]) => {
        const identifier = params[0];
        if (
          identifier === testUuid ||
          identifier === testJoiningId ||
          identifier === testMoniker
        ) {
          return { rows: [mockDbRow] };
        }
        return { rows: [] };
      },
    } as any;

    const router = createRoomDiscoveryRouter({
      rooms,
      postgres: mockPostgres,
      getOrCreateRoom: async () => null,
      validateUserTokenFn: async () => null,
    });

    const app = express();
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      // 2.1 Resolution by canonical UUID
      const resByUuid = await request(server, `/roomInfo/${testUuid}`);
      assert.equal(resByUuid.status, 200);
      assert.equal(resByUuid.body.roomId, testUuid);
      assert.equal(resByUuid.body.joiningId, testJoiningId);
      assert.equal(resByUuid.body.roomTitle, "Retro Movie Night");

      // 2.2 Resolution by 10-digit public joining code
      const resByCode = await request(server, `/roomInfo/${testJoiningId}`);
      assert.equal(resByCode.status, 200);
      assert.equal(resByCode.body.roomId, testUuid);
      assert.equal(resByCode.body.joiningId, testJoiningId);

      // 2.3 Resolution by legacy moniker
      const resByMoniker = await request(server, `/roomInfo/${testMoniker}`);
      assert.equal(resByMoniker.status, 200);
      assert.equal(resByMoniker.body.roomId, testUuid);
      assert.equal(resByMoniker.body.joiningId, testJoiningId);

      // 2.4 Non-existent identifier returns 404
      const resNotFound = await request(server, `/roomInfo/non-existent-room-999`);
      assert.equal(resNotFound.status, 404);
      assert.equal(resNotFound.body.error, "Room not found");
    } finally {
      server.close();
    }
  });

  // =========================================================================
  // 3. LIFECYCLE ROUTER (UUID & MONIKER CALLERS WITH MULTI-KEY TEARDOWN)
  // =========================================================================
  await t.test("Room lifecycle endpoints accept UUID & cleanly tear down all memory aliases", async () => {
    const rooms = new Map<string, Room>();
    const testUuid = "d7c8b9a0-1234-4567-89ab-cdef01234567";
    const testJoiningId = "5556667777";
    const testMoniker = "lifecycle-room-test";

    const memoryRoom = new Room(mockIo, testUuid);
    memoryRoom.joiningId = testJoiningId;
    memoryRoom.owner_id = "owner-carol";
    memoryRoom.status = "inactive";
    memoryRoom.isPermanent = false;

    // Register under all 3 keys
    rooms.set(testMoniker, memoryRoom);
    rooms.set(testUuid, memoryRoom);
    rooms.set(testJoiningId, memoryRoom);

    const unregisteredNamespaces: string[] = [];
    const unregisterRoomNamespace = (id: string) => {
      unregisteredNamespaces.push(id);
    };

    let authoritativelyDeleted = false;
    let authoritativelyStarted = false;
    let authoritativelyExtended = false;
    let authoritativelyEnded = false;

    const mockPostgres = {
      query: async (sql: string, params: any[]) => {
        if (sql.includes('SELECT "startedAt", "expiresAt", "status" FROM rooms')) {
          return {
            rows: [
              {
                startedAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 3600000).toISOString(),
                status: "active",
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes("extend_room_authoritative")) {
          authoritativelyExtended = true;
          return { rows: [{ new_expires_at: new Date(Date.now() + 7200000).toISOString() }], rowCount: 1 };
        }
        if (sql.includes("set_room_activity_authoritative")) {
          authoritativelyStarted = true;
          return { rows: [{ result: { status: "active", expiresAt: new Date(Date.now() + 7200000).toISOString() } }] };
        }
        if (sql.includes("end_room_authoritative")) {
          authoritativelyEnded = true;
          return { rows: [{ result: { status: "ended", isPermanent: false } }] };
        }
        if (sql.includes("delete_room_authoritative")) {
          authoritativelyDeleted = true;
          return { rows: [{ result: true }], rowCount: 1 };
        }
        if (sql.includes("UPDATE public.room_admissions SET revoked_at = now()")) {
          return { rowCount: 1 };
        }
        return { rows: [] };
      },
    } as any;

    const router = createRoomLifecycleRouter({
      rooms,
      io: mockIo,
      postgres: mockPostgres,
      getOrCreateRoom: async () => memoryRoom,
      unregisterRoomNamespace,
      validateUserTokenFn: async () => ({ uid: "owner-carol", email: "carol@test.com", email_verified: true } as any),
    });

    const app = express();
    app.use(express.json());
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      // 3.1 Start Room using UUID
      const startRes = await request(server, "/startRoom", {
        method: "POST",
        headers: { Authorization: "Bearer token-carol" },
        body: { roomId: testUuid },
      });
      assert.equal(startRes.status, 200);
      assert.equal(startRes.body.success, true);
      assert.equal(startRes.body.status, "active");
      assert.equal(startRes.body.roomId, testUuid);
      assert.ok(authoritativelyStarted);

      // 3.2 Extend Room using UUID
      const extRes = await request(server, "/extendRoom", {
        method: "POST",
        headers: { Authorization: "Bearer token-carol" },
        body: { roomId: testUuid, durationSeconds: 3600 },
      });
      assert.equal(extRes.status, 200);
      assert.ok(extRes.body.expiresAt);
      assert.equal(extRes.body.roomId, testUuid);
      assert.ok(authoritativelyExtended);

      // 3.3 End Room using UUID
      const endRes = await request(server, "/endRoom", {
        method: "POST",
        headers: { Authorization: "Bearer token-carol" },
        body: { roomId: testUuid },
      });
      assert.equal(endRes.status, 200);
      assert.equal(endRes.body.status, "ended");
      assert.equal(endRes.body.roomId, testUuid);
      assert.ok(authoritativelyEnded);

      // 3.4 Delete Room using UUID -> Must clean up ALL 3 memory map aliases
      const delRes = await request(server, `/deleteRoom?roomId=${testUuid}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer token-carol" },
      });
      assert.equal(delRes.status, 204);
      assert.ok(authoritativelyDeleted);

      // Verification: Map must be completely free of ALL alias keys
      assert.equal(rooms.has(testUuid), false, "Canonical UUID key removed from rooms map");
      assert.equal(rooms.has(testJoiningId), false, "Joining code key removed from rooms map");
      assert.equal(rooms.has(testMoniker), false, "Moniker key removed from rooms map");

      // Verification: Socket.IO namespaces unregistered
      assert.ok(unregisteredNamespaces.includes(testUuid) || unregisteredNamespaces.includes(testMoniker));
    } finally {
      server.close();
    }
  });

  // =========================================================================
  // 4. ADMISSION ROUTER DUAL-IDENTITY RECORDING & RESTORATION
  // =========================================================================
  await t.test("Passcode verification records room_uuid and restore checks by room_uuid", async () => {
    const rooms = new Map<string, Room>();
    const testUuid = "99999999-8888-7777-6666-555555555555";
    const testMoniker = "passcode-room-test";

    let insertedRoomUuid: string | null = null;
    let checkedBanUuid: string | null = null;
    let checkedAdmUuid: string | null = null;

    const mockPostgres = {
      query: async (sql: string, params: any[]) => {
        if (sql.includes("FROM rooms")) {
          return {
            rows: [
              {
                roomId: testUuid,
                joining_id: "1231231234",
                passcode: "12345678",
                status: "active",
                owner_id: "owner-dan",
                participants_locked: false,
                max_participants: 10,
                isPermanent: true,
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes("INSERT INTO public.room_admissions")) {
          insertedRoomUuid = params[0] === testUuid ? params[0] : params[1];
          return { rowCount: 1 };
        }
        if (sql.includes("FROM room_bans")) {
          checkedBanUuid = params[0] === testUuid ? params[0] : (params[1] || params[0]);
          return { rows: [] };
        }
        if (sql.includes("FROM room_admissions")) {
          checkedAdmUuid = params[0] === testUuid ? params[0] : (params[1] || params[0]);
          return { rows: [{ admission_method: "passcode", admitted_at: new Date().toISOString(), revoked_at: null }] };
        }
        return { rows: [] };
      },
    } as any;

    const memoryRoom = new Room(mockIo, testUuid);
    rooms.set(testMoniker, memoryRoom);
    rooms.set(testUuid, memoryRoom);

    const router = createRoomAdmissionRouter({
      rooms,
      postgres: mockPostgres,
      getOrCreateRoom: async () => memoryRoom,
      validateUserTokenFn: async () => ({ uid: "guest-eric" }),
      checkPasscodeRateLimitsFn: async () => ({ allowed: true }),
      recordPasscodeFailureFn: async () => {},
      resetPasscodeLimitsFn: async () => {},
      isTerminalRoomFn: () => false,
      verifyRoomPasscodeFn: async () => true,
      issueRoomAdmissionTokenFn: () => ({ allowed: true, status: 200, admissionToken: "test-token-jwt" }),
    });

    const app = express();
    app.use(express.json());
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      // 4.1 Verify passcode passing UUID as identifier
      const verifyRes = await request(server, "/verifyPasscode", {
        method: "POST",
        headers: { Authorization: "Bearer token-eric" },
        body: { roomId: testUuid, passcode: "12345678" },
      });
      assert.equal(verifyRes.status, 200);
      assert.equal(verifyRes.body.valid, true);
      assert.equal(insertedRoomUuid, testUuid, "room_uuid strictly recorded in DB admission insert");

      // 4.2 Restore admission passing UUID
      const restoreRes = await request(server, "/room-admission/restore", {
        method: "POST",
        headers: { Authorization: "Bearer token-eric" },
        body: { roomId: testUuid },
      });
      assert.equal(restoreRes.status, 200);
      assert.equal(restoreRes.body.valid, true);
      assert.equal(checkedAdmUuid, testUuid, "room_uuid verified in DB admission restore check");
    } finally {
      server.close();
    }
  });

  // =========================================================================
  // 5. PURE ROOM AUTHORIZATION CROSS-ROOM SCOPE WITH DUAL IDENTITY
  // =========================================================================
  await t.test("authorizeRoomAction validates UUID and moniker target equality", async () => {
    const baseContext: AuthorizationContext = {
      actorUid: "uid-host",
      actorClientId: "client-1",
      roomId: "my-moniker-room",
      roomUuid: "e2f1a0b3-4c5d-6e7f-8a9b-0c1d2e3f4a5b",
      isMember: true,
      isHost: true,
      isOwner: true,
      isLockHolder: true,
      chatEnabled: true,
      playbackLocked: false,
      hostEpoch: 1,
    };

    // 5.1 Moniker match -> allowed
    const targetWithMoniker: ActionTarget = {
      targetMessage: {
        id: "msg-1",
        roomId: "my-moniker-room",
        authorUid: "uid-other",
      },
    };
    const resMoniker = authorizeRoomAction(baseContext, "chat:delete_other", targetWithMoniker);
    assert.equal(resMoniker.allowed, true);
    assert.equal(resMoniker.code, "OK");

    // 5.2 Canonical UUID match -> allowed
    const targetWithUuid: ActionTarget = {
      targetMessage: {
        id: "msg-2",
        roomId: "any-moniker",
        roomUuid: "e2f1a0b3-4c5d-6e7f-8a9b-0c1d2e3f4a5b",
        authorUid: "uid-other",
      },
    };
    const resUuid = authorizeRoomAction(baseContext, "chat:delete_other", targetWithUuid);
    assert.equal(resUuid.allowed, true);
    assert.equal(resUuid.code, "OK");

    // 5.3 Cross-room probe mismatch -> ROOM_MISMATCH
    const foreignTarget: ActionTarget = {
      targetMessage: {
        id: "msg-3",
        roomId: "foreign-room",
        roomUuid: "00000000-0000-0000-0000-000000000000",
        authorUid: "uid-other",
      },
    };
    const resMismatch = authorizeRoomAction(baseContext, "chat:delete_other", foreignTarget);
    assert.equal(resMismatch.allowed, false);
    assert.equal(resMismatch.code, "ROOM_MISMATCH");
    assert.equal(resMismatch.reason, "ROOM_MISMATCH");
  });
});

after(() => {
  process.exit(0);
});

