import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { createRoomDiscoveryRouter } from "./roomDiscoveryRouter.js";
import { Room } from "../room.js";

async function request(
  server: http.Server,
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
  } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }> {
  const address = server.address() as any;
  const port = address.port;
  return new Promise((resolve, reject) => {
    const req = http.request(
      `http://127.0.0.1:${port}${path}`,
      {
        method: options.method || "GET",
        headers: options.headers,
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

test("roomDiscoveryRouter Suite", async (t) => {
  const mockIo = createMockIo();

  await t.test("GET /roomInfo/:roomId - 404 when room not found", async () => {
    const rooms = new Map<string, Room>();
    const mockPostgres = {
      query: async () => ({ rows: [] }),
    } as any;

    const router = createRoomDiscoveryRouter({
      rooms,
      postgres: mockPostgres,
      getOrCreateRoom: async () => null,
    });

    const app = express();
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      const res = await request(server, "/roomInfo/non-existent-room");
      assert.equal(res.status, 404);
      assert.equal(res.body.error, "Room not found");
    } finally {
      server.close();
    }
  });

  await t.test("GET /roomInfo/:roomId - unauthenticated caller: sanitized projection, masked owner_id and no credentials", async () => {
    const rooms = new Map<string, Room>();
    const mockPostgres = {
      query: async () => ({
        rows: [
          {
            roomId: "public-room-1",
            roomTitle: "Movie Party",
            roomDescription: "Watch together",
            coverPhoto: "https://example.com/cover.jpg",
            status: "active",
            expiresAt: null,
            isPermanent: true,
            requiresPasscode: true,
            owner_id: "private-owner-uuid-1234",
            participants_locked: false,
            max_participants: 25,
            hostName: "AliceHost",
          },
        ],
      }),
    } as any;

    const router = createRoomDiscoveryRouter({
      rooms,
      postgres: mockPostgres,
      getOrCreateRoom: async () => null,
    });

    const app = express();
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      const res = await request(server, "/roomInfo/public-room-1");
      assert.equal(res.status, 200);
      assert.equal(res.body.roomId, "public-room-1");
      assert.equal(res.body.roomTitle, "Movie Party");
      assert.equal(res.body.coverPhoto, "https://example.com/cover.jpg");
      assert.equal(res.body.status, "active");
      assert.equal(res.body.requiresPasscode, true);
      assert.equal(res.body.maxParticipants, 25);
      assert.equal(res.body.hostName, "AliceHost");
      assert.equal(res.body.isPermanent, true);
      // Sanitization assertions
      assert.equal(res.body.isOwner, false);
      assert.equal(res.body.isHost, false);
      assert.equal(res.body.owner_id, null); // Masked for non-owners
      assert.equal("passcode" in res.body, false);
      assert.equal("owner_passcode" in res.body, false);
    } finally {
      server.close();
    }
  });

  await t.test("GET /roomInfo/:roomId - authenticated owner reveals owner_id, isOwner=true, isHost=true", async () => {
    const rooms = new Map<string, Room>();
    const mockPostgres = {
      query: async () => ({
        rows: [
          {
            roomId: "owner-room-1",
            roomTitle: "Private Screening",
            roomDescription: "Owner view",
            coverPhoto: null,
            status: "inactive",
            expiresAt: null,
            isPermanent: true,
            requiresPasscode: false,
            owner_id: "owner-alice-uid",
            participants_locked: true,
            max_participants: 10,
            hostName: "AliceHost",
          },
        ],
      }),
    } as any;

    const router = createRoomDiscoveryRouter({
      rooms,
      postgres: mockPostgres,
      getOrCreateRoom: async () => null,
      validateUserTokenFn: async () => ({ uid: "owner-alice-uid" }),
    });

    const app = express();
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      const res = await request(server, "/roomInfo/owner-room-1", {
        headers: { Authorization: "Bearer valid-owner-jwt" },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.isOwner, true);
      assert.equal(res.body.isHost, true);
      assert.equal(res.body.owner_id, "owner-alice-uid"); // Revealed to verified owner
      assert.equal(res.body.participantsLocked, true);
      assert.equal(res.body.requiresPasscode, false);
    } finally {
      server.close();
    }
  });

  await t.test("GET /roomInfo/:roomId - derived expired status for past expiresAt", async () => {
    const rooms = new Map<string, Room>();
    const mockPostgres = {
      query: async () => ({
        rows: [
          {
            roomId: "temp-expired-room",
            roomTitle: "Expired Temp Room",
            status: "active", // DB status says active
            expiresAt: new Date(Date.now() - 60000).toISOString(), // Expired 1 min ago
            isPermanent: false,
            owner_id: "other-owner",
            participants_locked: false,
            max_participants: 10,
            hostName: "HostBob",
          },
        ],
      }),
    } as any;

    const router = createRoomDiscoveryRouter({
      rooms,
      postgres: mockPostgres,
      getOrCreateRoom: async () => null,
    });

    const app = express();
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      const res = await request(server, "/roomInfo/temp-expired-room");
      assert.equal(res.status, 200);
      assert.equal(res.body.status, "expired"); // Derived status correctly overrides DB 'active'
    } finally {
      server.close();
    }
  });

  await t.test("GET /roomInfo/:roomId - live in-memory host presence detection", async () => {
    const memoryRoom = new Room(mockIo, "memory-presence-room");
    (memoryRoom as any).isHostPresent = () => true;
    (memoryRoom as any).isHostUid = (uid: string) => uid === "guest-promoted-to-host";
    const rooms = new Map<string, Room>([["memory-presence-room", memoryRoom]]);

    const mockPostgres = {
      query: async () => ({
        rows: [
          {
            roomId: "memory-presence-room",
            roomTitle: "Active Room",
            status: "active",
            isPermanent: true,
            owner_id: "original-owner",
            participants_locked: false,
            max_participants: 10,
            hostName: "HostOriginal",
          },
        ],
      }),
    } as any;

    const router = createRoomDiscoveryRouter({
      rooms,
      postgres: mockPostgres,
      getOrCreateRoom: async () => memoryRoom,
      validateUserTokenFn: async () => ({ uid: "guest-promoted-to-host" }),
    });

    const app = express();
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      const res = await request(server, "/roomInfo/memory-presence-room", {
        headers: { Authorization: "Bearer promoted-token" },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.isHostPresent, true);
      assert.equal(res.body.isHost, true); // Recognized as host via memoryRoom.isHostUid
      assert.equal(res.body.isOwner, false);
    } finally {
      server.close();
    }
  });

  await t.test("GET /resolveShard/:roomId - returns shard number when enabled, empty string when disabled", async () => {
    const rooms = new Map<string, Room>();

    // Case 1: SHARD enabled
    const routerEnabled = createRoomDiscoveryRouter({
      rooms,
      postgres: null,
      getOrCreateRoom: async () => null,
      configOverride: { SHARD: true },
      resolveShardFn: (roomId) => (roomId === "shard-test-room" ? 3 : 1),
    });
    const appEnabled = express();
    appEnabled.use(routerEnabled);
    const serverEnabled = http.createServer(appEnabled);
    await new Promise<void>((resolve) => serverEnabled.listen(0, resolve));

    try {
      const res = await request(serverEnabled, "/resolveShard/shard-test-room");
      assert.equal(res.status, 200);
      assert.equal(res.body, 3);
    } finally {
      serverEnabled.close();
    }

    // Case 2: SHARD disabled
    const routerDisabled = createRoomDiscoveryRouter({
      rooms,
      postgres: null,
      getOrCreateRoom: async () => null,
      configOverride: { SHARD: false },
      resolveShardFn: () => 3,
    });
    const appDisabled = express();
    appDisabled.use(routerDisabled);
    const serverDisabled = http.createServer(appDisabled);
    await new Promise<void>((resolve) => serverDisabled.listen(0, resolve));

    try {
      const res = await request(serverDisabled, "/resolveShard/shard-test-room");
      assert.equal(res.status, 200);
      assert.equal(res.body, "");
    } finally {
      serverDisabled.close();
    }
  });
}).then(() => {
  process.exit(0);
}).catch((err) => {
  console.error("Test failure in roomDiscoveryRouter:", err);
  process.exit(1);
});
