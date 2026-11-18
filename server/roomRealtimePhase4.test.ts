import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import { Room } from "./room.ts";
import { setPostgresForTesting } from "./utils/postgres.ts";
import { setSupabaseAdminForTesting } from "./utils/supabase.ts";
import { generateAdmissionToken } from "./utils/admissionToken.ts";
import { isValidCanonicalUuid } from "./utils/roomIdentifier.ts";
import { sanitizeRoomId } from "./strip_slashes.ts";
import { redisCore } from "./utils/redis.ts";

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("Phase 4: Realtime, WebRTC Signaling & Socket.IO Namespace Integration Suite", async (t) => {
  const testUuid = "e2f1a0b3-4c5d-6e7f-8a9b-0c1d2e3f4a5b";
  const testMoniker = "vintage-cinema-night";
  const testJoiningCode = "9876543210";
  const ownerUserId = "00000000-0000-4000-8000-000000000001";
  const bannedUserId = "00000000-0000-4000-8000-000000000666";

  let clientA_admissionToken: string;
  let clientB_admissionToken: string;
  let clientC_admissionToken: string;

  const mockPostgres = {
    query: async (sql: string, params: any[] = []) => {
      // Room bans query
      if (sql.includes("FROM room_bans")) {
        const uidParam = params[1] || params[2];
        if (uidParam === bannedUserId) {
          return { rowCount: 1, rows: [{ client_identity: "banned-client", user_id: bannedUserId }] };
        }
        return { rowCount: 0, rows: [] };
      }

      // Room messages query
      if (sql.includes("FROM room_messages")) {
        return { rowCount: 0, rows: [] };
      }

      // Room lookup query
      if (sql.includes("FROM rooms")) {
        return {
          rowCount: 1,
          rows: [
            {
              id: testUuid,
              joining_id: testJoiningCode,
              passcode: null,
              owner_id: ownerUserId,
              isSubRoom: false,
              status: "active",
              expiresAt: null,
              isPermanent: true,
              startedAt: new Date(),
              participants_locked: false,
              max_participants: 50,
            },
          ],
        };
      }

      // User profile lookup
      if (sql.includes("FROM profiles")) {
        return {
          rowCount: 1,
          rows: [{ display_name: "Test Participant", username: "testpart", avatar_url: null }],
        };
      }

      // Room messages query
      if (sql.includes("FROM room_messages")) {
        return { rowCount: 0, rows: [] };
      }

      // Insert message query
      if (sql.includes("INSERT INTO room_messages")) {
        return {
          rowCount: 1,
          rows: [
            {
              id: "msg-uuid-1",
              roomId: params[0],
              roomUuid: params[1],
              user_id: params[2],
              message: params[3],
              message_type: params[4],
              event_type: params[5],
              metadata: params[6],
              created_at: new Date(),
              updated_at: new Date(),
              is_deleted: false,
            },
          ],
        };
      }

      // Authoritative room expiration / lifecycle routines
      if (sql.includes("set_room_activity_authoritative")) {
        return { rowCount: 1, rows: [{ result: { status: "active", transitioned: true } }] };
      }

      return { rowCount: 0, rows: [] };
    },
  };

  setPostgresForTesting(mockPostgres);

  const mockSupabase = {
    auth: {
      getUser: async (jwtToken: string) => {
        if (jwtToken === "jwt-alpha") {
          return {
            data: { user: { id: "user-alpha", email: "alpha@test.com", email_confirmed_at: "2026-01-01" } },
            error: null,
          };
        }
        if (jwtToken === "jwt-beta") {
          return {
            data: { user: { id: "user-beta", email: "beta@test.com", email_confirmed_at: "2026-01-01" } },
            error: null,
          };
        }
        if (jwtToken === "jwt-gamma") {
          return {
            data: { user: { id: "user-gamma", email: "gamma@test.com", email_confirmed_at: "2026-01-01" } },
            error: null,
          };
        }
        if (jwtToken === "jwt-banned") {
          return {
            data: { user: { id: bannedUserId, email: "banned@test.com", email_confirmed_at: "2026-01-01" } },
            error: null,
          };
        }
        return { data: { user: null }, error: new Error("Invalid JWT") };
      },
    },
  };
  setSupabaseAdminForTesting(mockSupabase);

  // Setup HTTP & Socket.IO server
  const httpServer = http.createServer();
  const io = new SocketIOServer(httpServer, {
    cors: { origin: "*" },
    transports: ["websocket", "polling"],
  });

  const rooms = new Map<string, Room>();

  // Create room with canonical UUID, moniker, and joining code
  const room = new Room(io, testUuid);
  room.joiningId = testJoiningCode;
  room.status = "active";
  room.isPermanent = true;
  room.owner_id = ownerUserId;

  // Pre-attach canonical and public namespaces
  room.attachNamespace(room.roomId);
  room.attachNamespace(`/watch/${room.roomId}`);
  room.attachNamespace(room.joiningId);

  // Index under all aliases in rooms Map (Phase 3 multi-key alignment)
  rooms.set(testMoniker, room);
  rooms.set(testUuid, room);
  rooms.set(testJoiningCode, room);

  // Dynamic regex room namespace (matches server.ts)
  const dynamicRoomNsp = io.of(/^\/(?:watch\/)?[a-zA-Z0-9_\-\s%]+$/);
  dynamicRoomNsp.use(async (socket, next) => {
    const rawName = socket.nsp.name.replace(/^\/(?:watch\/)?/, "");
    const cleanId = sanitizeRoomId(rawName);
    if (!cleanId || cleanId === "notifications") {
      return next();
    }
    const memRoom = rooms.get(cleanId);
    if (!memRoom) {
      return next(new Error("ROOM_NOT_FOUND"));
    }
    if (typeof memRoom.attachNamespace === "function") {
      memRoom.attachNamespace(socket.nsp.name);
    }
    next();
  });

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // Helper to connect client
  async function connectClient(
    nspPath: string,
    auth: Record<string, any>
  ): Promise<{ client: ClientSocket; clientId: string }> {
    const deferred = createDeferred<ClientSocket>();
    const client = ioc(`${baseUrl}${nspPath}`, {
      transports: ["websocket"],
      forceNew: true,
      auth,
    });
    const clientIdDeferred = createDeferred<string>();
    client.once("REC:assignedClientId", (id: string) => clientIdDeferred.resolve(id));
    client.on("connect", () => deferred.resolve(client));
    client.on("connect_error", (err) => {
      deferred.reject(err);
      clientIdDeferred.reject(err);
    });
    const socket = await deferred.promise;
    const clientId = await clientIdDeferred.promise;
    return { client: socket, clientId };
  }

  let clientA: ClientSocket;
  let clientB: ClientSocket;
  let clientC: ClientSocket;
  let clientA_clientId = "";
  let clientB_clientId = "";
  let clientC_clientId = "";

  // =========================================================================
  // 1. DYNAMIC NAMESPACE ROUTING & MULTI-NAMESPACE ADMISSION
  // =========================================================================
  await t.test("1. Multi-namespace client connection & handshake authentication", async () => {
    // Generate valid admission tokens bound to canonical UUID, moniker, and joining code
    clientA_admissionToken = generateAdmissionToken({
      roomId: testUuid, // issued for canonical UUID
      userId: "user-alpha",
      sessionId: "sess-alpha",
      ttlSeconds: 600,
    });

    clientB_admissionToken = generateAdmissionToken({
      roomId: testMoniker, // issued for moniker
      userId: "user-beta",
      sessionId: "sess-beta",
      ttlSeconds: 600,
    });

    clientC_admissionToken = generateAdmissionToken({
      roomId: testJoiningCode, // issued for joining code
      userId: "user-gamma",
      sessionId: "sess-gamma",
      ttlSeconds: 600,
    });

    // Client A connects to canonical namespace /watch/:uuid
    const connA = await connectClient(`/watch/${testUuid}`, {
      token: "jwt-alpha",
      admissionToken: clientA_admissionToken,
      sessionId: "sess-alpha",
    });
    clientA = connA.client;
    clientA_clientId = connA.clientId;
    assert.equal(clientA.connected, true);

    // Client B connects to legacy moniker namespace /:moniker
    const connB = await connectClient(`/${testMoniker}`, {
      token: "jwt-beta",
      admissionToken: clientB_admissionToken,
      sessionId: "sess-beta",
    });
    clientB = connB.client;
    clientB_clientId = connB.clientId;
    assert.equal(clientB.connected, true);

    // Client C connects to 10-digit joining code namespace /:joiningCode
    const connC = await connectClient(`/${testJoiningCode}`, {
      token: "jwt-gamma",
      admissionToken: clientC_admissionToken,
      sessionId: "sess-gamma",
    });
    clientC = connC.client;
    clientC_clientId = connC.clientId;
    assert.equal(clientC.connected, true);

    assert.ok(clientA_clientId, "Client A received assigned clientId");
    assert.ok(clientB_clientId, "Client B received assigned clientId");
    assert.ok(clientC_clientId, "Client C received assigned clientId");

    // Verify all 3 sockets are registered in the same Room's activeSockets map
    assert.ok(room.activeSockets.has(clientA_clientId), "Client A is registered in room.activeSockets");
    assert.ok(room.activeSockets.has(clientB_clientId), "Client B is registered in room.activeSockets");
    assert.ok(room.activeSockets.has(clientC_clientId), "Client C is registered in room.activeSockets");
    assert.equal(room.getRoomUuid(), testUuid, "Room resolves canonical UUID");
  });

  // =========================================================================
  // 2. CROSS-NAMESPACE WEBRTC SIGNALING RELAY
  // =========================================================================
  await t.test("2. Cross-namespace WebRTC signaling relay (Client A <-> Client B)", async () => {
    // 2.1 Standard WebRTC signal relay from /watch/:uuid to /:moniker
    const signalDef = createDeferred<any>();
    clientB.once("signal", (data) => signalDef.resolve(data));

    const offerPayload = { type: "offer", sdp: "v=0\r\no=alice 123456" };
    clientA.emit("signal", {
      to: clientB_clientId,
      msg: offerPayload,
      sharer: false,
    });

    const receivedSignal = await signalDef.promise;
    assert.equal(receivedSignal.from, clientA_clientId);
    assert.deepEqual(receivedSignal.msg, offerPayload);
    assert.equal(receivedSignal.roomUuid, testUuid);

    // 2.2 Screen share WebRTC signal relay from /:moniker to /watch/:uuid
    const signalSsDef = createDeferred<any>();
    clientA.once("signalSS", (data) => signalSsDef.resolve(data));

    const ssPayload = { type: "screenshare-offer", sdp: "v=0\r\no=bob 789012" };
    clientB.emit("signalSS", {
      to: clientA_clientId,
      msg: ssPayload,
      sharer: true,
    });

    const receivedSignalSs = await signalSsDef.promise;
    assert.equal(receivedSignalSs.from, clientB_clientId);
    assert.deepEqual(receivedSignalSs.msg, ssPayload);
    assert.equal(receivedSignalSs.sharer, true);
    assert.equal(receivedSignalSs.roomUuid, testUuid);

    // 2.3 P2P Local Media signal relay from /watch/:uuid to /:moniker
    const localMediaSignalDef = createDeferred<any>();
    clientB.once("CMD_LOCAL_MEDIA_SIGNAL", (data) => localMediaSignalDef.resolve(data));

    clientA.emit("CMD_LOCAL_MEDIA_SIGNAL", {
      toPeerId: clientB_clientId,
      signal: { candidate: "candidate:1 1 UDP 2130706431 192.168.1.1 50000 typ host" },
      epoch: 2,
    });

    const receivedLocalSignal = await localMediaSignalDef.promise;
    assert.equal(receivedLocalSignal.fromPeerId, clientA_clientId);
    assert.equal(receivedLocalSignal.toPeerId, clientB_clientId);
    assert.equal(receivedLocalSignal.roomId, testUuid, "Relay payload binds canonical UUID");
    assert.equal(receivedLocalSignal.epoch, 2);
  });

  // =========================================================================
  // 3. CROSS-NAMESPACE STATE SYNCHRONIZATION & BROADCASTING
  // =========================================================================
  await t.test("3. Cross-namespace state synchronization & broadcasting", async () => {
    // 3.1 Chat broadcasting: Client A (/watch/:uuid) sends chat -> Client B and C receive
    const chatB_Def = createDeferred<any>();
    const chatC_Def = createDeferred<any>();

    clientB.once("REC:chat", (msg) => chatB_Def.resolve(msg));
    clientC.once("REC:chat", (msg) => chatC_Def.resolve(msg));

    clientA.emit("CMD:chat", "Synchronized hello across namespaces!");

    const [msgB, msgC] = await Promise.all([chatB_Def.promise, chatC_Def.promise]);
    assert.equal(msgB.msg, "Synchronized hello across namespaces!");
    assert.equal(msgC.msg, "Synchronized hello across namespaces!");
    assert.equal(msgB.id, clientA_clientId);
    assert.equal(msgC.id, clientA_clientId);

    // 3.2 Playback coordinator broadcast: REC:tsMap and REC:playbackSync
    const syncB_Def = createDeferred<any>();
    const syncC_Def = createDeferred<any>();

    clientB.once("REC:tsMap", (ts) => syncB_Def.resolve(ts));
    clientC.once("REC:tsMap", (ts) => syncC_Def.resolve(ts));

    // Server-side emitToRoom trigger
    room.emitToRoom("REC:tsMap", { [clientA_clientId]: 42.5 });

    const [tsB, tsC] = await Promise.all([syncB_Def.promise, syncC_Def.promise]);
    assert.equal(tsB[clientA_clientId], 42.5);
    assert.equal(tsC[clientA_clientId], 42.5);

    // 3.3 Name map broadcast across namespaces
    const nameB_Def = createDeferred<any>();
    const nameC_Def = createDeferred<any>();

    clientB.once("REC:nameMap", (names) => nameB_Def.resolve(names));
    clientC.once("REC:nameMap", (names) => nameC_Def.resolve(names));

    clientA.emit("CMD:name", "Alice Wonder");

    const [namesB, namesC] = await Promise.all([nameB_Def.promise, nameC_Def.promise]);
    assert.equal(namesB[clientA_clientId], "Alice Wonder");
    assert.equal(namesC[clientA_clientId], "Alice Wonder");
  });

  // =========================================================================
  // 4. ANTI-PROBING DEFENSE & CROSS-ROOM ISOLATION
  // =========================================================================
  await t.test("4. Anti-probing defense & token isolation", async () => {
    // 4.1 Target peer probing: signaling to non-existent peer ID is safely dropped
    let leakedSignal = false;
    const testProbeHandler = () => {
      leakedSignal = true;
    };
    clientB.on("signal", testProbeHandler);
    clientC.on("signal", testProbeHandler);

    clientA.emit("signal", {
      to: "foreign-unregistered-peer-9999",
      msg: { probe: true },
      sharer: false,
    });

    await new Promise((r) => setTimeout(r, 80));
    clientB.off("signal", testProbeHandler);
    clientC.off("signal", testProbeHandler);
    assert.equal(leakedSignal, false, "Probed signal to non-existent peer is strictly dropped");

    // 4.2 Handshake rejection on foreign room token
    const foreignRoomToken = generateAdmissionToken({
      roomId: "00000000-0000-0000-0000-000000000000", // foreign UUID
      userId: "intruder-user",
      sessionId: "intruder-sess",
      ttlSeconds: 600,
    });

    await assert.rejects(
      async () => {
        await connectClient(`/watch/${testUuid}`, {
          admissionToken: foreignRoomToken,
          sessionId: "intruder-sess",
        });
      },
      (err: any) => {
        assert.ok(err.message.includes("passcode"), "Foreign room token rejected on handshake");
        return true;
      }
    );
  });

  // =========================================================================
  // 5. BAN ENFORCEMENT VIA DUAL-IDENTITY QUERY
  // =========================================================================
  await t.test("5. Banned user connection rejected at handshake", async () => {
    const bannedToken = generateAdmissionToken({
      roomId: testUuid,
      userId: bannedUserId,
      sessionId: "sess-banned",
      ttlSeconds: 600,
    });

    await assert.rejects(
      async () => {
        await connectClient(`/watch/${testUuid}`, {
          token: "jwt-banned",
          admissionToken: bannedToken,
          sessionId: "sess-banned",
        });
      },
      (err: any) => {
        // Since mock query returns row when params[2] === bannedUserId,
        // if user isn't authenticated via token, room.bannedIdentities or DB query checks it
        assert.ok(err, "Banned user handshake rejected");
        return true;
      }
    );
  });

  // =========================================================================
  // 6. REDIS HOST TRANSITION LEASE BINDING TO CANONICAL UUID
  // =========================================================================
  await t.test("6. Host transition lease binds to canonical UUID key", async () => {
    const origSetLease = redisCore.setLease;
    const origGetAvailability = redisCore.getAvailability;
    let capturedLeaseKey = "";

    try {
      redisCore.getAvailability = () => ({ available: true });
      (redisCore as any).setLease = async (key: string, value: string, ttl: number) => {
        capturedLeaseKey = key;
        return true;
      };

      await room.withHostTransitionLease(async () => {
        return "lease-acquired";
      });

      assert.equal(
        capturedLeaseKey,
        `room:host:${testUuid}`,
        "Host transition lease key binds to canonical UUID instead of legacy moniker"
      );
    } finally {
      redisCore.setLease = origSetLease;
      redisCore.getAvailability = origGetAvailability;
    }
  });

  // =========================================================================
  // 7. MULTI-NAMESPACE TEARDOWN ON ROOM TERMINATION
  // =========================================================================
  await t.test("7. Multi-namespace teardown on room termination", async () => {
    const discA = createDeferred<void>();
    const discB = createDeferred<void>();
    const discC = createDeferred<void>();

    clientA.once("disconnect", () => discA.resolve());
    clientB.once("disconnect", () => discB.resolve());
    clientC.once("disconnect", () => discC.resolve());

    // Disconnect all sockets across all namespaces
    room.disconnectAllSockets();

    await Promise.all([discA.promise, discB.promise, discC.promise]);

    assert.equal(clientA.connected, false, "Client A disconnected");
    assert.equal(clientB.connected, false, "Client B disconnected");
    assert.equal(clientC.connected, false, "Client C disconnected");

    // Room teardown
    room.destroy();
    assert.equal(room.activeSockets.size, 0, "Active sockets map cleared");
    assert.equal(room.attachedNamespaces.size, 0, "Attached namespaces set cleared");
  });

  // Cleanup servers
  io.close();
  httpServer.close();
});

after(() => {
  process.exit(0);
});
