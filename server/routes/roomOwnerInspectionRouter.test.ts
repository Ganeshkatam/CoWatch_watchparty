import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { createRoomOwnerInspectionRouter } from "./roomOwnerInspectionRouter.js";

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

test("roomOwnerInspectionRouter Suite", async (t) => {
  await t.test("GET /roomData/:roomId - auth, database and isolation gates", async () => {
    let queriedSql = "";
    let queryParams: any[] = [];

    const mockPostgres = {
      query: async (sql: string, params: any[]) => {
        queriedSql = sql;
        queryParams = params;
        if (params[0] === "my-owned-room") {
          return { rows: [{ data: { videoUrl: "https://example.com/stream.mp4", duration: 120 } }] };
        }
        return { rows: [] };
      },
    } as any;

    const router = createRoomOwnerInspectionRouter({
      postgres: mockPostgres,
      validateUserTokenFn: async (_proj, token) => {
        if (token === "unverified") return "EMAIL_NOT_VERIFIED";
        if (token === "valid") return { uid: "owner-uid-123" };
        return null;
      },
    });

    const app = express();
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      // 1. Missing token
      const res1 = await request(server, "/roomData/some-room");
      assert.equal(res1.status, 401);
      assert.equal(res1.body.error, "Authentication required");

      // 2. Unverified email
      const res2 = await request(server, "/roomData/some-room", {
        headers: { Authorization: "Bearer unverified" },
      });
      assert.equal(res2.status, 403);
      assert.equal(res2.body.error, "Unauthorized or unverified email");

      // 3. Foreign / not found room
      const res3 = await request(server, "/roomData/foreign-room", {
        headers: { Authorization: "Bearer valid" },
      });
      assert.equal(res3.status, 404);
      assert.equal(res3.body.error, "Room not found or unauthorized");
      assert(queriedSql.includes(`WHERE "roomId" = $1 AND owner_id = $2`));
      assert.equal(queryParams[0], "foreign-room");
      assert.equal(queryParams[1], "owner-uid-123");

      // 4. Success returns raw data payload
      const res4 = await request(server, "/roomData/my-owned-room", {
        headers: { Authorization: "Bearer valid" },
      });
      assert.equal(res4.status, 200);
      assert.equal(res4.body.videoUrl, "https://example.com/stream.mp4");
      assert.equal(res4.body.duration, 120);
    } finally {
      server.close();
    }
  });

  await t.test("GET /listRooms - auth and database gates", async () => {
    const routerNoDb = createRoomOwnerInspectionRouter({
      postgres: null,
      validateUserTokenFn: async (_proj, token) => {
        if (token === "unverified") return "EMAIL_NOT_VERIFIED";
        if (token === "valid") return { uid: "owner-1" };
        return null;
      },
    });
    const appNoDb = express();
    appNoDb.use(routerNoDb);
    const serverNoDb = http.createServer(appNoDb);
    await new Promise<void>((resolve) => serverNoDb.listen(0, resolve));

    try {
      // 1. Missing token
      const res1 = await request(serverNoDb, "/listRooms");
      assert.equal(res1.status, 401);

      // 2. EMAIL_NOT_VERIFIED
      const res2 = await request(serverNoDb, "/listRooms", {
        headers: { Authorization: "Bearer unverified" },
      });
      assert.equal(res2.status, 403);
      assert.equal(res2.body.error.code, "EMAIL_NOT_VERIFIED");

      // 3. Database unavailable
      const res3 = await request(serverNoDb, "/listRooms", {
        headers: { Authorization: "Bearer valid" },
      });
      assert.equal(res3.status, 503);
      assert.equal(res3.body.error, "Database unavailable");
    } finally {
      serverNoDb.close();
    }
  });

  await t.test("GET /listRooms - unpaginated vs paginated shapes & passcode decryption", async () => {
    let executedSqlList: string[] = [];

    const mockPostgres = {
      query: async (sql: string) => {
        executedSqlList.push(sql);
        if (sql.includes("COUNT(*)::int AS total")) {
          return { rows: [{ total: 2, active: 1, expiring: 0, finished: 1 }] };
        }
        if (sql.includes("SELECT COUNT(*)::int AS count FROM rooms")) {
          return { rows: [{ count: 2 }] };
        }
        return {
          rows: [
            {
              roomId: "active-room-1",
              roomTitle: "Active Room",
              status: "active",
              isPermanent: true,
              owner_passcode: "enc:secretPass123",
            },
            {
              roomId: "ended-room-2",
              roomTitle: "Ended Room",
              status: "ended",
              isPermanent: false,
              owner_passcode: "enc:secretPass123",
            },
          ],
        };
      },
    } as any;

    const router = createRoomOwnerInspectionRouter({
      postgres: mockPostgres,
      validateUserTokenFn: async () => ({ uid: "owner-1" }),
      decryptPasscodeForOwnerFn: (cipher) => (cipher || "").replace("enc:", "decrypted_"),
    });

    const app = express();
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      // 1. Unpaginated request (no limit or page query param) -> returns raw array
      const resUnpaginated = await request(server, "/listRooms", {
        headers: { Authorization: "Bearer valid" },
      });
      assert.equal(resUnpaginated.status, 200);
      assert(Array.isArray(resUnpaginated.body), "Unpaginated response must be a raw array");
      assert.equal(resUnpaginated.body.length, 2);
      assert.equal(resUnpaginated.body[0].currentPasscode, "decrypted_secretPass123");
      assert.equal(resUnpaginated.body[0].owner_passcode, undefined); // Strip ciphertext
      assert.equal(resUnpaginated.body[1].currentPasscode, null); // Ended room withholds passcode
      assert.equal(resUnpaginated.body[1].owner_passcode, undefined);

      // 2. Paginated request (limit and page query params) -> returns wrapped envelope
      const resPaginated = await request(server, "/listRooms?page=1&limit=10", {
        headers: { Authorization: "Bearer valid" },
      });
      assert.equal(resPaginated.status, 200);
      assert.equal(typeof resPaginated.body, "object");
      assert.equal(resPaginated.body.total, 2);
      assert.equal(resPaginated.body.page, 1);
      assert.equal(resPaginated.body.limit, 10);
      assert.equal(resPaginated.body.totalPages, 1);
      assert.equal(resPaginated.body.stats.active, 1);
      assert.equal(resPaginated.body.stats.finished, 1);
      assert(Array.isArray(resPaginated.body.rooms));
      assert.equal(resPaginated.body.rooms[0].currentPasscode, "decrypted_secretPass123");
      assert.equal(resPaginated.body.rooms[0].owner_passcode, undefined);
    } finally {
      server.close();
    }
  });

  await t.test("GET /roomDetails - full multi-table aggregation, message reversal & security redaction", async () => {
    let capturedRoomSql = "";
    let capturedLifecycleSql = "";
    let capturedMessagesSql = "";

    const mockPostgres = {
      query: async (sql: string, params: any[]) => {
        if (sql.includes(`FROM rooms WHERE "roomId" = $1 AND owner_id = $2`)) {
          capturedRoomSql = sql;
          if (params[0] === "target-room" && params[1] === "owner-bob") {
            return {
              rows: [
                {
                  roomId: "target-room",
                  roomTitle: "Bob Room",
                  status: "active",
                  isPermanent: true,
                  owner_passcode: "enc:bobPass",
                  max_participants: 15,
                },
              ],
            };
          }
          return { rows: [] };
        }
        if (sql.includes("FROM room_lifecycle_events")) {
          capturedLifecycleSql = sql;
          return {
            rows: [
              { id: 101, event: "STARTED", timestamp: "2026-10-03T10:00:00Z" },
            ],
          };
        }
        if (sql.includes("SELECT rm.id, rm.user_id, rm.message")) {
          capturedMessagesSql = sql;
          // Return messages in descending order as DB query outputs
          return {
            rows: [
              { id: 2, message: "newer message" },
              { id: 1, message: "older message" },
            ],
          };
        }
        if (sql.includes("SELECT count(id)::int as \"messagesCount\"")) {
          return {
            rows: [{ messagesCount: 2, lastMessageAt: "2026-10-03T10:05:00Z" }],
          };
        }
        return { rows: [] };
      },
    } as any;

    const router = createRoomOwnerInspectionRouter({
      postgres: mockPostgres,
      validateUserTokenFn: async (_proj, token) => {
        if (token === "bob-token") return { uid: "owner-bob" };
        return null;
      },
      decryptPasscodeForOwnerFn: (cipher) => (cipher || "").replace("enc:", "plain_"),
    });

    const app = express();
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      // 1. Missing roomId parameter (400)
      const resNoParam = await request(server, "/roomDetails", {
        headers: { Authorization: "Bearer bob-token" },
      });
      assert.equal(resNoParam.status, 400);
      assert.equal(resNoParam.body.error, "missing roomId");

      // 2. Foreign / missing room (404)
      const resForeign = await request(server, "/roomDetails?roomId=foreign-room", {
        headers: { Authorization: "Bearer bob-token" },
      });
      assert.equal(resForeign.status, 404);
      assert.equal(resForeign.body.error, "Room not found or unauthorized");

      // 3. Successful deep inspection
      const resSuccess = await request(server, "/roomDetails?roomId=target-room", {
        headers: { Authorization: "Bearer bob-token" },
      });
      assert.equal(resSuccess.status, 200);
      assert.equal(resSuccess.body.roomId, "target-room");
      assert.equal(resSuccess.body.roomTitle, "Bob Room");
      assert.equal(resSuccess.body.currentPasscode, "plain_bobPass");
      assert.equal(resSuccess.body.owner_passcode, undefined); // Stripped

      // Lifecycle events
      assert.equal(resSuccess.body.lifecycleEvents.length, 1);
      assert.equal(resSuccess.body.lifecycleEvents[0].event, "STARTED");

      // Recent messages reversed from DESC to ASC (chronological)
      assert.equal(resSuccess.body.recentMessages.length, 2);
      assert.equal(resSuccess.body.recentMessages[0].id, 1); // Older message first
      assert.equal(resSuccess.body.recentMessages[1].id, 2); // Newer message second

      // Chat summary
      assert.equal(resSuccess.body.chatSummary.messagesCount, 2);
      assert.equal(resSuccess.body.chatSummary.lastMessageAt, "2026-10-03T10:05:00Z");

      assert(capturedRoomSql.includes(`FROM rooms WHERE "roomId" = $1 AND owner_id = $2`));
      assert(capturedLifecycleSql.includes("ORDER BY timestamp DESC"));
      assert(capturedMessagesSql.includes("ORDER BY rm.created_at DESC, rm.id DESC LIMIT 20"));
    } finally {
      server.close();
    }
  });
}).then(() => {
  process.exit(0);
}).catch((err) => {
  console.error("Test failure in roomOwnerInspectionRouter:", err);
  process.exit(1);
});
