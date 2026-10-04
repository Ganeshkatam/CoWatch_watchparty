import { strict as assert } from "node:assert";
import express from "express";
import http from "node:http";
import type { Server } from "socket.io";
import type { Pool } from "pg";
import { Room } from "../room.ts";
import { createRoomConfigRouter } from "./roomConfigRouter.ts";

async function runRoomConfigRouterTests() {
  console.log("================================================================");
  console.log("STARTING ROOM CONFIG ROUTER TEST SUITE");
  console.log("================================================================\n");

  let passed = 0;
  let failed = 0;

  function test(desc: string, condition: boolean) {
    if (condition) {
      console.log(`  PASS [${desc}]`);
      passed++;
    } else {
      console.error(`  FAIL [${desc}]`);
      failed++;
    }
  }

  // --- Mock State & Test Helpers ---
  const rooms = new Map<string, Room>();

  // Mock Socket.IO Server
  const mockIo = {
    of: (_nspName: string) => ({
      emit: () => {},
      use: () => {},
      on: () => {},
    }),
  } as unknown as Server;

  // Mock DB query & client handler
  type QueryHandler = (queryText: string, values?: any[]) => Promise<any>;
  let customQueryHandler: QueryHandler | null = null;
  let customClientQueryHandler: QueryHandler | null = null;

  const mockPostgres = {
    query: async (queryText: string, values?: any[]) => {
      if (customQueryHandler) {
        return customQueryHandler(queryText, values);
      }
      return { rows: [], rowCount: 0 };
    },
    connect: async () => ({
      query: async (queryText: string, values?: any[]) => {
        if (customClientQueryHandler) {
          return customClientQueryHandler(queryText, values);
        }
        return { rows: [], rowCount: 0 };
      },
      release: () => {},
    }),
  } as unknown as Pool;

  let mockDbAvailable = true;
  let redisCounterCalls: Record<string, number> = {};
  const mockRedisCount = (prefix: string) => {
    redisCounterCalls[prefix] = (redisCounterCalls[prefix] || 0) + 1;
  };

  // Mock Auth overrides
  const mockValidateUserToken = async (_session: string, token: string) => {
    if (token === "token-unverified") {
      return "EMAIL_NOT_VERIFIED";
    }
    if (token === "token-invalid") {
      return null;
    }
    if (token === "token-alice") {
      return { uid: "uid-alice", email: "alice@test.com" };
    }
    if (token === "token-bob") {
      return { uid: "uid-bob", email: "bob@test.com" };
    }
    return null;
  };

  // Set up Express Test App
  const app = express();
  app.use(express.json());

  app.use(
    (req, res, next) => {
      const activePostgres = mockDbAvailable ? mockPostgres : null;
      const router = createRoomConfigRouter({
        rooms,
        io: mockIo,
        postgres: activePostgres,
        redisCountFn: mockRedisCount,
        validateUserTokenFn: mockValidateUserToken as any,
        makeRoomNameFn: () => "test-room-name",
      });
      router(req, res, next);
    }
  );

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function makeRequest(
    method: "GET" | "POST",
    path: string,
    body?: any,
    headers?: Record<string, string>
  ) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let json: any = null;
    let text = "";
    try {
      text = await res.text();
      json = JSON.parse(text);
    } catch {
      // not JSON
    }
    return { status: res.status, json, text };
  }

  try {
    // =========================================================================
    // 1. GET /roomEntitlements
    // =========================================================================
    console.log("--- Testing GET /roomEntitlements ---");

    const noAuthEnt = await makeRequest("GET", "/roomEntitlements");
    test("GET /roomEntitlements: 401 on missing token", noAuthEnt.status === 401);

    const unverifiedEnt = await makeRequest("GET", "/roomEntitlements", undefined, {
      Authorization: "Bearer token-unverified",
    });
    test("GET /roomEntitlements: 403 on unverified email", unverifiedEnt.status === 403);

    const invalidEnt = await makeRequest("GET", "/roomEntitlements", undefined, {
      Authorization: "Bearer token-invalid",
    });
    test("GET /roomEntitlements: 401 on invalid token", invalidEnt.status === 401);

    mockDbAvailable = false;
    const dbDownEnt = await makeRequest("GET", "/roomEntitlements", undefined, {
      Authorization: "Bearer token-alice",
    });
    test("GET /roomEntitlements: 503 on database unavailable", dbDownEnt.status === 503);
    mockDbAvailable = true;

    // Account not provisioned (0 rows returned)
    customQueryHandler = async () => ({ rows: [] });
    const notFoundEnt = await makeRequest("GET", "/roomEntitlements", undefined, {
      Authorization: "Bearer token-alice",
    });
    test("GET /roomEntitlements: 404 when account not provisioned",
      notFoundEnt.status === 404 && notFoundEnt.json?.error?.code === "ACCOUNT_ENTITLEMENT_NOT_FOUND");

    // Success response with numbers narrowed
    customQueryHandler = async () => ({
      rows: [
        {
          planId: "free",
          planDisplayName: "Free Tier",
          enabled: true,
          maxTotalRooms: "5",
          maxWatchRooms: "3",
          maxPermanentRooms: "2",
          maxParticipantCapacity: "10",
          maxRoomDurationHours: "3",
          hasOverrides: false,
          usageTotalRooms: "1",
          usageWatchRooms: "1",
          usagePermanentRooms: "0",
        },
      ],
    });
    const successEnt = await makeRequest("GET", "/roomEntitlements", undefined, {
      Authorization: "Bearer token-alice",
    });
    test("GET /roomEntitlements: 200 with properly narrowed numbers",
      successEnt.status === 200 &&
      successEnt.json?.planId === "free" &&
      typeof successEnt.json?.maxTotalRooms === "number" &&
      successEnt.json?.maxTotalRooms === 5 &&
      successEnt.json?.maxParticipantCapacity === 10);

    // =========================================================================
    // 2. POST /checkPasscodeAvailability
    // =========================================================================
    console.log("\n--- Testing POST /checkPasscodeAvailability ---");

    const badPasscode = await makeRequest("POST", "/checkPasscodeAvailability", { passcode: "short" });
    test("POST /checkPasscodeAvailability: 400 when passcode is not 8 chars", badPasscode.status === 400);

    mockDbAvailable = false;
    const dbDownAvail = await makeRequest("POST", "/checkPasscodeAvailability", { passcode: "12345678" });
    test("POST /checkPasscodeAvailability: fallback available: true when db unavailable",
      dbDownAvail.status === 200 && dbDownAvail.json?.available === true);
    mockDbAvailable = true;

    // Fingerprint available (no existing room)
    customQueryHandler = async () => ({ rows: [] });
    const availRes = await makeRequest("POST", "/checkPasscodeAvailability", { passcode: "12345678" });
    test("POST /checkPasscodeAvailability: 200 available: true when unused",
      availRes.status === 200 && availRes.json?.available === true);

    // Fingerprint taken
    customQueryHandler = async () => ({ rows: [{ roomId: "existing-r1" }] });
    const takenRes = await makeRequest("POST", "/checkPasscodeAvailability", { passcode: "12345678" });
    test("POST /checkPasscodeAvailability: 200 available: false when taken",
      takenRes.status === 200 && takenRes.json?.available === false);

    // =========================================================================
    // 3. POST /createRoom
    // =========================================================================
    console.log("\n--- Testing POST /createRoom ---");

    const noAuthCreate = await makeRequest("POST", "/createRoom", { roomTitle: "Test", passcode: "12345678" });
    test("POST /createRoom: 401 on missing token", noAuthCreate.status === 401);

    const unverifiedCreate = await makeRequest("POST", "/createRoom", { roomTitle: "Test", passcode: "12345678" }, {
      Authorization: "Bearer token-unverified",
    });
    test("POST /createRoom: 403 on unverified email", unverifiedCreate.status === 403);

    const emptyTitleCreate = await makeRequest("POST", "/createRoom", { roomTitle: "   ", passcode: "12345678" }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /createRoom: 400 on empty roomTitle", emptyTitleCreate.status === 400);

    const longTitleCreate = await makeRequest("POST", "/createRoom", { roomTitle: "A".repeat(51), passcode: "12345678" }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /createRoom: 400 on roomTitle > 50 chars", longTitleCreate.status === 400);

    const shortPassCreate = await makeRequest("POST", "/createRoom", { roomTitle: "Valid Title", passcode: "123" }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /createRoom: 400 on passcode != 8 chars", shortPassCreate.status === 400);

    // Account entitlement not found
    customQueryHandler = async (sql) => {
      if (sql.includes("resolve_account_entitlement")) {
        return { rows: [] };
      }
      return { rows: [] };
    };
    const noEntCreate = await makeRequest("POST", "/createRoom", { roomTitle: "Valid Title", passcode: "12345678" }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /createRoom: 403 when resolve_account_entitlement returns empty", noEntCreate.status === 403);

    // Capacity exceeds plan ceiling
    customQueryHandler = async (sql) => {
      if (sql.includes("resolve_account_entitlement")) {
        return { rows: [{ max_participant_capacity: 10, max_room_duration_hours: 3 }] };
      }
      return { rows: [] };
    };
    const capExceededCreate = await makeRequest("POST", "/createRoom", {
      roomTitle: "Valid Title",
      passcode: "12345678",
      maxParticipants: 15,
    }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /createRoom: 400 when maxParticipants exceeds plan capacity ceiling", capExceededCreate.status === 400);

    // Passcode fingerprint already taken
    customQueryHandler = async (sql) => {
      if (sql.includes("resolve_account_entitlement")) {
        return { rows: [{ max_participant_capacity: 10, max_room_duration_hours: 3 }] };
      }
      if (sql.includes("passcode_fingerprint = $1")) {
        return { rows: [{ roomId: "existing" }] };
      }
      return { rows: [] };
    };
    const dupPassCreate = await makeRequest("POST", "/createRoom", {
      roomTitle: "Valid Title",
      passcode: "12345678",
    }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /createRoom: 409 when passcode fingerprint already taken", dupPassCreate.status === 409);

    // RPC Error mapping tests (TOTAL_ROOM_LIMIT_EXCEEDED, PERMANENT_ROOM_LIMIT_EXCEEDED, etc.)
    customQueryHandler = async (sql) => {
      if (sql.includes("resolve_account_entitlement")) {
        return { rows: [{ max_participant_capacity: 10, max_room_duration_hours: 3 }] };
      }
      if (sql.includes("passcode_fingerprint = $1")) {
        return { rows: [] };
      }
      if (sql.includes("create_room_authoritative")) {
        throw new Error("TOTAL_ROOM_LIMIT_EXCEEDED");
      }
      return { rows: [] };
    };
    const quotaExceededCreate = await makeRequest("POST", "/createRoom", {
      roomTitle: "Valid Title",
      passcode: "12345678",
    }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /createRoom: 409 when create_room_authoritative throws TOTAL_ROOM_LIMIT_EXCEEDED",
      quotaExceededCreate.status === 409 && quotaExceededCreate.json?.error?.code === "TOTAL_ROOM_LIMIT_EXCEEDED");

    // Success Path & Memory Room Construction
    customQueryHandler = async (sql) => {
      if (sql.includes("resolve_account_entitlement")) {
        return { rows: [{ max_participant_capacity: 25, max_room_duration_hours: 3 }] };
      }
      if (sql.includes("passcode_fingerprint = $1")) {
        return { rows: [] };
      }
      if (sql.includes("create_room_authoritative")) {
        return { rows: [{ result: "test-room-name" }] };
      }
      return { rows: [] };
    };
    const successCreate = await makeRequest("POST", "/createRoom", {
      roomTitle: "Grand Cinema",
      passcode: "87654321",
      isPermanent: true,
      maxParticipants: 20,
      isChatDisabled: true,
    }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /createRoom: 200 with name and correctly initializes in-memory Room",
      successCreate.status === 200 &&
      successCreate.json?.name === "test-room-name" &&
      rooms.has("test-room-name") === true);

    const createdMemRoom = rooms.get("test-room-name");
    test("POST /createRoom: in-memory Room has correct properties set",
      createdMemRoom?.owner_id === "uid-alice" &&
      createdMemRoom?.isPermanent === true &&
      createdMemRoom?.maxParticipants === 20 &&
      createdMemRoom?.isChatDisabled === true &&
      createdMemRoom?.status === "inactive");

    // =========================================================================
    // 4. POST /updateRoomCover
    // =========================================================================
    console.log("\n--- Testing POST /updateRoomCover ---");

    const noAuthCover = await makeRequest("POST", "/updateRoomCover", { roomId: "r1", coverPhoto: "img.jpg" });
    test("POST /updateRoomCover: 401 on missing token", noAuthCover.status === 401);

    const unverifiedCover = await makeRequest("POST", "/updateRoomCover", { roomId: "r1", coverPhoto: "img.jpg" }, {
      Authorization: "Bearer token-unverified",
    });
    test("POST /updateRoomCover: 403 on unverified email", unverifiedCover.status === 403 && unverifiedCover.json?.error?.code === "EMAIL_NOT_VERIFIED");

    const missingParamsCover = await makeRequest("POST", "/updateRoomCover", { roomId: "" }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /updateRoomCover: 400 on missing parameters", missingParamsCover.status === 400);

    // Room not owned by caller
    customQueryHandler = async (sql) => {
      if (sql.includes('SELECT status, "expiresAt", "isPermanent" FROM rooms')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [] };
    };
    const notOwnerCover = await makeRequest("POST", "/updateRoomCover", { roomId: "r1", coverPhoto: "img.jpg" }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /updateRoomCover: 403 when room not owned by caller", notOwnerCover.status === 403);

    // Room active in DB -> rejected
    customQueryHandler = async (sql) => {
      if (sql.includes('SELECT status, "expiresAt", "isPermanent" FROM rooms')) {
        return { rows: [{ status: "active", expiresAt: new Date(Date.now() + 3600000).toISOString(), isPermanent: true }], rowCount: 1 };
      }
      return { rows: [] };
    };
    const activeCover = await makeRequest("POST", "/updateRoomCover", { roomId: "r1", coverPhoto: "img.jpg" }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /updateRoomCover: 403 when room is active", activeCover.status === 403);

    // Success Case (inactive room)
    customQueryHandler = async (sql) => {
      if (sql.includes('SELECT status, "expiresAt", "isPermanent" FROM rooms')) {
        return { rows: [{ status: "inactive", expiresAt: null, isPermanent: true }], rowCount: 1 };
      }
      if (sql.includes("update_room_metadata_authoritative")) {
        return { rows: [{ result: true }], rowCount: 1 };
      }
      return { rows: [] };
    };
    const successCover = await makeRequest("POST", "/updateRoomCover", { roomId: "r1", coverPhoto: "img.jpg" }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /updateRoomCover: 200 on successful cover update",
      successCover.status === 200 && successCover.json?.success === true);

    // =========================================================================
    // 5. POST /updateRoomSettings
    // =========================================================================
    console.log("\n--- Testing POST /updateRoomSettings ---");

    const noAuthSettings = await makeRequest("POST", "/updateRoomSettings", { roomId: "r1" });
    test("POST /updateRoomSettings: 401 on missing token", noAuthSettings.status === 401);

    const unverifiedSettings = await makeRequest("POST", "/updateRoomSettings", { roomId: "r1", roomTitle: "Test", isPermanent: false, isChatDisabled: false }, {
      Authorization: "Bearer token-unverified",
    });
    test("POST /updateRoomSettings: 403 on unverified email", unverifiedSettings.status === 403 && unverifiedSettings.json?.error?.code === "EMAIL_NOT_VERIFIED");

    const badPayloadSettings = await makeRequest("POST", "/updateRoomSettings", {
      roomId: "r1",
      roomTitle: 123, // invalid type
    }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /updateRoomSettings: 400 on invalid payload", badPayloadSettings.status === 400);

    const badPasscodeSettings = await makeRequest("POST", "/updateRoomSettings", {
      roomId: "r1",
      roomTitle: "New Title",
      isPermanent: true,
      isChatDisabled: false,
      password: "short",
    }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /updateRoomSettings: 400 when password is not 8 chars", badPasscodeSettings.status === 400);

    // Transaction & Row Lock: Not owner
    customClientQueryHandler = async (sql) => {
      if (sql.includes("SELECT status, \"expiresAt\", \"isSubRoom\", \"isPermanent\" FROM rooms WHERE \"roomId\" = $1 AND owner_id = $2 FOR UPDATE")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    };
    const notOwnerSettings = await makeRequest("POST", "/updateRoomSettings", {
      roomId: "r1",
      roomTitle: "New Title",
      isPermanent: true,
      isChatDisabled: false,
    }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /updateRoomSettings: 403 when row lock fails / room not owned by caller", notOwnerSettings.status === 403);

    // Passcode taken by another room in transaction
    customClientQueryHandler = async (sql) => {
      if (sql.includes("FOR UPDATE")) {
        return { rows: [{ status: "inactive", expiresAt: null, isPermanent: true }], rowCount: 1 };
      }
      if (sql.includes("passcode_fingerprint = $1 AND \"roomId\" != $2")) {
        return { rows: [{ roomId: "other-room" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    };
    const dupPassSettings = await makeRequest("POST", "/updateRoomSettings", {
      roomId: "r1",
      roomTitle: "New Title",
      isPermanent: true,
      isChatDisabled: false,
      password: "87654321",
    }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /updateRoomSettings: 409 when passcode fingerprint taken by another room", dupPassSettings.status === 409);

    // Room active in memory -> rejected
    const activeMemRoom = new Room(mockIo, "active-r1");
    activeMemRoom.status = "active";
    rooms.set("active-r1", activeMemRoom);
    customClientQueryHandler = async (sql) => {
      if (sql.includes("FOR UPDATE")) {
        return { rows: [{ status: "inactive", expiresAt: null, isPermanent: true }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    };
    const activeMemSettings = await makeRequest("POST", "/updateRoomSettings", {
      roomId: "active-r1",
      roomTitle: "New Title",
      isPermanent: true,
      isChatDisabled: false,
    }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /updateRoomSettings: 403 when memory room is active", activeMemSettings.status === 403);

    // Successful update with permanence changed RPC and metadata RPC
    let permanenceRpcCalled = false;
    let metadataRpcCalled = false;
    customClientQueryHandler = async (sql) => {
      if (sql.includes("FOR UPDATE")) {
        return { rows: [{ status: "inactive", expiresAt: null, isPermanent: false }], rowCount: 1 };
      }
      if (sql.includes("set_room_permanence_authoritative")) {
        permanenceRpcCalled = true;
        return { rows: [{ result: true }], rowCount: 1 };
      }
      if (sql.includes("update_room_metadata_authoritative")) {
        metadataRpcCalled = true;
        return { rows: [{ result: true }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    };
    const successSettings = await makeRequest("POST", "/updateRoomSettings", {
      roomId: "r1",
      roomTitle: "Updated Title",
      roomDescription: "Updated Description",
      isPermanent: true, // changed from false to true
      isChatDisabled: true,
      removePassword: true,
    }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /updateRoomSettings: 200 with success: true",
      successSettings.status === 200 && successSettings.json?.success === true);
    test("POST /updateRoomSettings: invokes set_room_permanence_authoritative when permanence changes",
      permanenceRpcCalled);
    test("POST /updateRoomSettings: invokes update_room_metadata_authoritative",
      metadataRpcCalled);

  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log("\n================================================================");
  console.log(`ROOM CONFIG ROUTER TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runRoomConfigRouterTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Test execution aborted:", err);
    process.exit(1);
  });
