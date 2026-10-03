import { strict as assert } from "node:assert";
import express from "express";
import http from "node:http";
import type { Server } from "socket.io";
import type { Pool } from "pg";
import type { Room } from "../room.ts";
import { createRoomLifecycleRouter } from "./roomLifecycleRouter.ts";

async function runRoomLifecycleRouterTests() {
  console.log("================================================================");
  console.log("STARTING ROOM LIFECYCLE ROUTER TEST SUITE");
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
  let unregisterCalledWith: string[] = [];
  const unregisterRoomNamespace = (roomId: string) => {
    unregisterCalledWith.push(roomId);
  };

  let getOrCreateResult: Room | null = null;
  const getOrCreateRoom = async (roomId: string): Promise<Room | null> => {
    if (getOrCreateResult) return getOrCreateResult;
    return rooms.get(roomId) || null;
  };

  // Mock Socket.IO Server
  const emittedEvents: { nsp: string; event: string; payload: any }[] = [];
  const mockIo = {
    of: (nspName: string) => ({
      emit: (event: string, payload: any) => {
        emittedEvents.push({ nsp: nspName, event, payload });
      },
    }),
  } as unknown as Server;

  // Mock DB query handler
  type QueryHandler = (queryText: string, values?: any[]) => Promise<any>;
  let customQueryHandler: QueryHandler | null = null;

  const mockPostgres = {
    query: async (queryText: string, values?: any[]) => {
      if (customQueryHandler) {
        return customQueryHandler(queryText, values);
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Pool;

  let mockDbAvailable = true;

  // Mock Auth & Validation overrides
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
    if (token === "token-charlie") {
      return { uid: "uid-charlie", email: "charlie@test.com" };
    }
    return null;
  };

  // Helper to create a dummy memory Room
  function createMockRoom(roomId: string, ownerId: string, currentHostId: string): Room {
    const mock = {
      roomId,
      owner_id: ownerId,
      currentHostUid: currentHostId,
      status: "active" as any,
      expiresAt: new Date(Date.now() + 3600000),
      lastUpdateTime: new Date(),
      isPermanent: false,
      isHostUid: (uid: string) => uid === currentHostId,
      scheduleInactivityTimeoutIfNeeded: () => {},
      addChatMessage: async (_user: any, _msg: any) => {},
      disconnectAllSockets: () => {},
      destroy: () => {},
    };
    return mock as unknown as Room;
  }

  // Set up Express Test App
  const app = express();
  app.use(express.json());

  // Mount with dynamic DB proxy so we can test 503 database unavailable
  app.use(
    (req, res, next) => {
      next();
    },
    (req, res, next) => {
      const activePostgres = mockDbAvailable ? mockPostgres : null;
      const router = createRoomLifecycleRouter({
        rooms,
        io: mockIo,
        postgres: activePostgres,
        getOrCreateRoom,
        unregisterRoomNamespace,
        validateUserTokenFn: mockValidateUserToken as any,
      });
      router(req, res, next);
    }
  );

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function makeRequest(
    method: "POST" | "DELETE",
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
      // not JSON or empty
    }
    return { status: res.status, json, text };
  }

  try {
    // =========================================================================
    // 1. POST /extendRoom
    // =========================================================================
    console.log("--- Testing POST /extendRoom ---");

    // 1.1 Authentication Rejections
    const noAuthExt = await makeRequest("POST", "/extendRoom", { roomId: "r1", durationSeconds: 600 });
    test("POST /extendRoom: 401 on missing Authorization header", noAuthExt.status === 401);

    const unverifiedExt = await makeRequest("POST", "/extendRoom", { roomId: "r1", durationSeconds: 600 }, {
      Authorization: "Bearer token-unverified",
    });
    test("POST /extendRoom: 403 on unverified email", unverifiedExt.status === 403 && unverifiedExt.json?.error?.message === "Email verification is required.");

    const invalidTokenExt = await makeRequest("POST", "/extendRoom", { roomId: "r1", durationSeconds: 600 }, {
      Authorization: "Bearer token-invalid",
    });
    test("POST /extendRoom: 403 on invalid user token", invalidTokenExt.status === 403 && invalidTokenExt.json?.error?.message === "Invalid user token");

    // 1.2 Parameter Validation
    const missingParamsExt = await makeRequest("POST", "/extendRoom", { roomId: "" }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /extendRoom: 400 on missing parameters", missingParamsExt.status === 400 && missingParamsExt.json?.error?.message === "Missing parameters");

    const invalidDurationExt = await makeRequest("POST", "/extendRoom", { roomId: "r1", durationSeconds: 20000 }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /extendRoom: 400 on duration > 10800s", invalidDurationExt.status === 400 && invalidDurationExt.json?.error?.message === "Invalid duration");

    // 1.3 Room State and Authorization
    customQueryHandler = async (sql) => {
      if (sql.includes('SELECT "startedAt", "expiresAt", "status" FROM rooms')) {
        return { rows: [] }; // room not found or not owner
      }
      return { rows: [] };
    };
    const notOwnerExt = await makeRequest("POST", "/extendRoom", { roomId: "r1", durationSeconds: 600 }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /extendRoom: 403 when room row not found for caller", notOwnerExt.status === 403);

    // Status not active/scheduled/inactive
    customQueryHandler = async (sql) => {
      if (sql.includes('SELECT "startedAt", "expiresAt", "status" FROM rooms')) {
        return { rows: [{ startedAt: new Date().toISOString(), expiresAt: new Date().toISOString(), status: "ended" }] };
      }
      return { rows: [] };
    };
    const endedStatusExt = await makeRequest("POST", "/extendRoom", { roomId: "r1", durationSeconds: 600 }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /extendRoom: 403 when room is in ended status", endedStatusExt.status === 403);

    // Max duration exceeded (started 2.5 hours ago, adding 1 hour exceeds 3-hour cap)
    const twoHoursAgo = new Date(Date.now() - 2.5 * 3600000).toISOString();
    customQueryHandler = async (sql) => {
      if (sql.includes('SELECT "startedAt", "expiresAt", "status" FROM rooms')) {
        return { rows: [{ startedAt: twoHoursAgo, expiresAt: new Date().toISOString(), status: "active" }] };
      }
      return { rows: [] };
    };
    const maxExceededExt = await makeRequest("POST", "/extendRoom", { roomId: "r1", durationSeconds: 3600 }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /extendRoom: 400 ROOM_MAX_DURATION_EXCEEDED when proposed expiresAt > maxExpiresAt",
      maxExceededExt.status === 400 && maxExceededExt.json?.error?.code === "ROOM_MAX_DURATION_EXCEEDED");

    // 1.4 Success Case & Memory Update
    const r1 = createMockRoom("r1", "uid-alice", "uid-alice");
    rooms.set("r1", r1);
    const newExpiresDate = new Date(Date.now() + 1800000).toISOString();
    customQueryHandler = async (sql, values) => {
      if (sql.includes('SELECT "startedAt", "expiresAt", "status" FROM rooms')) {
        return { rows: [{ startedAt: new Date().toISOString(), expiresAt: new Date().toISOString(), status: "active" }] };
      }
      if (sql.includes("extend_room_authoritative")) {
        return { rows: [{ new_expires_at: newExpiresDate }], rowCount: 1 };
      }
      return { rows: [] };
    };

    const successExt = await makeRequest("POST", "/extendRoom", { roomId: "r1", durationSeconds: 1800 }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /extendRoom: 200 with expiresAt and mutates memoryRoom.expiresAt",
      successExt.status === 200 &&
      successExt.json?.expiresAt === newExpiresDate &&
      r1.expiresAt?.toISOString() === newExpiresDate);

    // =========================================================================
    // 2. POST /startRoom
    // =========================================================================
    console.log("\n--- Testing POST /startRoom ---");

    // 2.1 Authentication & Input Rejections
    const noAuthStart = await makeRequest("POST", "/startRoom", { roomId: "r2" });
    test("POST /startRoom: 401 on missing Authorization header", noAuthStart.status === 401);

    const unverifiedStart = await makeRequest("POST", "/startRoom", { roomId: "r2" }, {
      Authorization: "Bearer token-unverified",
    });
    test("POST /startRoom: 403 on unverified email", unverifiedStart.status === 403);

    const missingRoomIdStart = await makeRequest("POST", "/startRoom", { roomId: "" }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /startRoom: 400 on missing roomId", missingRoomIdStart.status === 400 && missingRoomIdStart.json?.error?.message === "Missing roomId");

    // 2.2 Database Unavailable
    mockDbAvailable = false;
    const dbDownStart = await makeRequest("POST", "/startRoom", { roomId: "r2" }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /startRoom: 503 when postgres is unavailable", dbDownStart.status === 503);
    mockDbAvailable = true;

    // 2.3 Non-resident Room Database Checks
    customQueryHandler = async (sql) => {
      if (sql.includes("SELECT owner_id FROM public.rooms")) {
        return { rows: [] }; // room does not exist in DB
      }
      return { rows: [] };
    };
    const nonResidentNotFound = await makeRequest("POST", "/startRoom", { roomId: "non-resident-none" }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /startRoom: 404 on non-resident room not found in DB", nonResidentNotFound.status === 404);

    customQueryHandler = async (sql) => {
      if (sql.includes("SELECT owner_id FROM public.rooms")) {
        return { rows: [{ owner_id: "uid-bob" }] };
      }
      return { rows: [] };
    };
    const nonResidentNotOwner = await makeRequest("POST", "/startRoom", { roomId: "non-resident-bob" }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /startRoom: 403 when non-resident caller is not room owner", nonResidentNotOwner.status === 403);

    // 2.4 Resident Room Authorization
    const r2 = createMockRoom("r2", "uid-alice", "uid-alice");
    rooms.set("r2", r2);
    const nonHostResidentStart = await makeRequest("POST", "/startRoom", { roomId: "r2" }, {
      Authorization: "Bearer token-bob",
    });
    test("POST /startRoom: 403 when resident caller is neither host nor owner", nonHostResidentStart.status === 403);

    // 2.5 DB RPC Result Handling
    // Expired
    customQueryHandler = async (sql) => {
      if (sql.includes("set_room_activity_authoritative")) {
        return { rows: [{ result: { status: "expired" } }] };
      }
      return { rows: [] };
    };
    const expiredStart = await makeRequest("POST", "/startRoom", { roomId: "r2" }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /startRoom: 403 when set_room_activity_authoritative returns expired",
      expiredStart.status === 403 && expiredStart.json?.error?.message === "This room has expired.");

    // Status not active
    customQueryHandler = async (sql) => {
      if (sql.includes("set_room_activity_authoritative")) {
        return { rows: [{ result: { status: "failed" } }] };
      }
      return { rows: [] };
    };
    const failStart = await makeRequest("POST", "/startRoom", { roomId: "r2" }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /startRoom: 400 when set_room_activity_authoritative status is not active", failStart.status === 400);

    // 2.6 Success Case
    emittedEvents.length = 0;
    let scheduledTimeout: boolean = false;
    r2.scheduleInactivityTimeoutIfNeeded = () => {
      scheduledTimeout = true;
    };
    const startExpires = new Date(Date.now() + 7200000).toISOString();
    customQueryHandler = async (sql) => {
      if (sql.includes("set_room_activity_authoritative")) {
        return { rows: [{ result: { status: "active", expiresAt: startExpires } }] };
      }
      return { rows: [] };
    };
    const successStart = await makeRequest("POST", "/startRoom", { roomId: "r2" }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /startRoom: 200 with success: true and status: active",
      successStart.status === 200 && successStart.json?.success === true && successStart.json?.status === "active");
    test("POST /startRoom: mutates memoryRoom status to active", r2.status === "active");
    test("POST /startRoom: emits REC:sessionStarted to room namespace",
      emittedEvents.some(
        (e) => e.nsp === "r2" && e.event === "REC:sessionStarted" && e.payload?.status === "active" && e.payload?.startedBy === "uid-alice"
      ));
    test("POST /startRoom: schedules inactivity timeout if needed", scheduledTimeout);

    // =========================================================================
    // 3. POST /endRoom
    // =========================================================================
    console.log("\n--- Testing POST /endRoom ---");

    // 3.1 Authentication & Input Rejections
    const noAuthEnd = await makeRequest("POST", "/endRoom", { roomId: "r3" });
    test("POST /endRoom: 401 on missing Authorization header", noAuthEnd.status === 401);

    const unverifiedEnd = await makeRequest("POST", "/endRoom", { roomId: "r3" }, {
      Authorization: "Bearer token-unverified",
    });
    test("POST /endRoom: 403 on unverified email", unverifiedEnd.status === 403);

    const missingRoomIdEnd = await makeRequest("POST", "/endRoom", { roomId: "" }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /endRoom: 400 on missing roomId", missingRoomIdEnd.status === 400);

    // 3.2 Authorization on memory room
    const r3 = createMockRoom("r3", "uid-alice", "uid-alice");
    rooms.set("r3", r3);
    const nonHostEnd = await makeRequest("POST", "/endRoom", { roomId: "r3" }, {
      Authorization: "Bearer token-bob",
    });
    test("POST /endRoom: 403 when caller is not host or owner of memory room", nonHostEnd.status === 403);

    // 3.3 Database error handling
    customQueryHandler = async (sql) => {
      if (sql.includes("end_room_authoritative")) {
        throw new Error("ROOM_NOT_FOUND: Room does not exist");
      }
      return { rows: [] };
    };
    const dbNotFoundEnd = await makeRequest("POST", "/endRoom", { roomId: "r3" }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /endRoom: 403 when DB throws ROOM_NOT_FOUND", dbNotFoundEnd.status === 403);

    customQueryHandler = async (sql) => {
      if (sql.includes("end_room_authoritative")) {
        throw new Error("DB connection timeout");
      }
      return { rows: [] };
    };
    const dbGenericErrEnd = await makeRequest("POST", "/endRoom", { roomId: "r3" }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /endRoom: 500 when DB throws generic error", dbGenericErrEnd.status === 500);

    // 3.4 Permanent Room End (status becomes 'inactive', isPermanent=true)
    emittedEvents.length = 0;
    let chatMessageAdded: any = null;
    r3.addChatMessage = async (_user, msg) => {
      chatMessageAdded = msg;
    };
    let socketsDisconnected: boolean = false;
    r3.disconnectAllSockets = () => {
      socketsDisconnected = true;
    };

    customQueryHandler = async (sql) => {
      if (sql.includes("end_room_authoritative")) {
        return { rows: [{ result: { status: "inactive", isPermanent: true } }] };
      }
      return { rows: [] };
    };
    const permEnd = await makeRequest("POST", "/endRoom", { roomId: "r3" }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /endRoom: 200 with status: inactive and isPermanent: true",
      permEnd.status === 200 && permEnd.json?.status === "inactive" && permEnd.json?.isPermanent === true);
    test("POST /endRoom: emits SIGNAL:terminateAndExit with reason host_stopped_permanent",
      emittedEvents.some((e) => e.nsp === "r3" && e.event === "SIGNAL:terminateAndExit" && e.payload?.reason === "host_stopped_permanent"));
    test("POST /endRoom: emits ROOM_SESSION_STOPPED with status inactive",
      emittedEvents.some((e) => e.nsp === "r3" && e.event === "ROOM_SESSION_STOPPED" && e.payload?.status === "inactive"));
    test("POST /endRoom: adds permanent room stopped system chat message",
      chatMessageAdded?.msg === "This room session has been stopped by the host.");

    // Wait 150ms for socket disconnection timeout to fire
    await new Promise((r) => setTimeout(r, 150));
    test("POST /endRoom: triggers disconnectAllSockets asynchronously", socketsDisconnected);

    // 3.5 Temporary Room End (status becomes 'ended', isPermanent=false, revokes admissions)
    emittedEvents.length = 0;
    let admissionsRevoked: boolean = false;
    const r4 = createMockRoom("r4", "uid-alice", "uid-alice");
    rooms.set("r4", r4);
    r4.addChatMessage = async (_user, msg) => {
      chatMessageAdded = msg;
    };

    customQueryHandler = async (sql) => {
      if (sql.includes("end_room_authoritative")) {
        return { rows: [{ result: { status: "ended", isPermanent: false } }] };
      }
      if (sql.includes("UPDATE public.room_admissions SET revoked_at = now()")) {
        admissionsRevoked = true;
        return { rowCount: 1 };
      }
      return { rows: [] };
    };
    const tempEnd = await makeRequest("POST", "/endRoom", { roomId: "r4" }, {
      Authorization: "Bearer token-alice",
    });
    test("POST /endRoom: 200 with status: ended and isPermanent: false",
      tempEnd.status === 200 && tempEnd.json?.status === "ended" && tempEnd.json?.isPermanent === false);
    test("POST /endRoom: revokes temporary room admissions in DB", admissionsRevoked);
    test("POST /endRoom: emits SIGNAL:terminateAndExit with reason host_ended_temporary",
      emittedEvents.some((e) => e.nsp === "r4" && e.event === "SIGNAL:terminateAndExit" && e.payload?.reason === "host_ended_temporary"));
    test("POST /endRoom: adds temporary room ended system chat message",
      chatMessageAdded?.msg === "This watch party has been ended by the host.");

    // =========================================================================
    // 4. DELETE /deleteRoom
    // =========================================================================
    console.log("\n--- Testing DELETE /deleteRoom ---");

    // 4.1 Authentication & Input Rejections
    const noAuthDel = await makeRequest("DELETE", "/deleteRoom?roomId=r5");
    test("DELETE /deleteRoom: 401 on missing Authorization header", noAuthDel.status === 401);

    const unverifiedDel = await makeRequest("DELETE", "/deleteRoom?roomId=r5", undefined, {
      Authorization: "Bearer token-unverified",
    });
    test("DELETE /deleteRoom: 403 on unverified email", unverifiedDel.status === 403);

    const missingRoomIdDel = await makeRequest("DELETE", "/deleteRoom", undefined, {
      Authorization: "Bearer token-alice",
    });
    test("DELETE /deleteRoom: 400 on missing roomId", missingRoomIdDel.status === 400);

    // 4.2 Owner Authorization Rejection
    const r5 = createMockRoom("r5", "uid-alice", "uid-alice");
    rooms.set("r5", r5);
    const nonOwnerDel = await makeRequest("DELETE", "/deleteRoom?roomId=r5", undefined, {
      Authorization: "Bearer token-bob",
    });
    test("DELETE /deleteRoom: 403 when caller is not the room owner", nonOwnerDel.status === 403);

    // 4.3 Database RPC error handling
    customQueryHandler = async (sql) => {
      if (sql.includes("delete_room_authoritative")) {
        throw new Error("ROOM_NOT_FOUND: Room does not exist");
      }
      return { rows: [] };
    };
    const dbNotFoundDel = await makeRequest("DELETE", "/deleteRoom?roomId=r5", undefined, {
      Authorization: "Bearer token-alice",
    });
    test("DELETE /deleteRoom: 404 when DB throws ROOM_NOT_FOUND", dbNotFoundDel.status === 404);

    customQueryHandler = async (sql) => {
      if (sql.includes("delete_room_authoritative")) {
        throw new Error("ROOM_ACTIVE_CANNOT_DELETE: Active room must be stopped");
      }
      return { rows: [] };
    };
    const dbActiveDel = await makeRequest("DELETE", "/deleteRoom?roomId=r5", undefined, {
      Authorization: "Bearer token-alice",
    });
    test("DELETE /deleteRoom: 409 when DB throws ROOM_ACTIVE_CANNOT_DELETE", dbActiveDel.status === 409);

    // 4.4 Successful deletion & Teardown
    emittedEvents.length = 0;
    unregisterCalledWith = [];
    let roomDestroyed: boolean = false;
    let delSocketsDisconnected: boolean = false;
    r5.disconnectAllSockets = () => {
      delSocketsDisconnected = true;
    };
    r5.destroy = () => {
      roomDestroyed = true;
    };

    customQueryHandler = async (sql) => {
      if (sql.includes("delete_room_authoritative")) {
        return { rows: [{ result: true }], rowCount: 1 };
      }
      return { rows: [] };
    };

    const successDel = await makeRequest("DELETE", "/deleteRoom?roomId=r5", undefined, {
      Authorization: "Bearer token-alice",
    });
    test("DELETE /deleteRoom: 204 on successful deletion", successDel.status === 204);
    test("DELETE /deleteRoom: emits SIGNAL:terminateAndExit with reason unavailable",
      emittedEvents.some((e) => e.nsp === "r5" && e.event === "SIGNAL:terminateAndExit" && e.payload?.reason === "unavailable"));
    test("DELETE /deleteRoom: emits ROOM_SESSION_STOPPED with status ended",
      emittedEvents.some((e) => e.nsp === "r5" && e.event === "ROOM_SESSION_STOPPED" && e.payload?.status === "ended"));
    test("DELETE /deleteRoom: disconnects all sockets immediately", delSocketsDisconnected);
    test("DELETE /deleteRoom: removes room from memory map", rooms.has("r5") === false);
    test("DELETE /deleteRoom: calls unregisterRoomNamespace", unregisterCalledWith.includes("r5"));
    test("DELETE /deleteRoom: calls memoryRoom.destroy()", roomDestroyed);

  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log("\n================================================================");
  console.log(`ROOM LIFECYCLE ROUTER TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runRoomLifecycleRouterTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Test execution aborted:", err);
    process.exit(1);
  });
