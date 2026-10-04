import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { createAccountTeardownRouter } from "./accountTeardownRouter.ts";
import type { Room } from "../room.ts";

// ---------------------------------------------------------------------------
// HTTP request helper (matches project convention)
// ---------------------------------------------------------------------------
function request(
  server: http.Server,
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: any;
  } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string; json: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      return reject(new Error("Server address is not available"));
    }

    const payload = options.body !== undefined
      ? (typeof options.body === "string" ? options.body : JSON.stringify(options.body))
      : undefined;

    const headers: Record<string, string> = {
      ...(options.headers || {}),
    };
    if (payload && !headers["content-type"] && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    if (payload) {
      headers["Content-Length"] = Buffer.byteLength(payload).toString();
    }

    const req = http.request(
      {
        host: "127.0.0.1",
        port: addr.port,
        path,
        method: options.method || "GET",
        headers,
        insecureHTTPParser: true,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          let json: any = null;
          try {
            json = JSON.parse(body);
          } catch {
            json = null;
          }
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body,
            json,
          });
        });
      }
    );

    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------
function createMockRoom(roomId: string): Room & { _destroyCalls: string[] } {
  const destroyCalls: string[] = [];
  return {
    roomId,
    destroy: () => { destroyCalls.push(roomId); },
    _destroyCalls: destroyCalls,
  } as unknown as Room & { _destroyCalls: string[] };
}

function buildApp(overrides: {
  rooms?: Map<string, Room>;
  postgres?: any;
  unregisterRoomNamespaceFn?: (roomId: string) => void;
  validateUserTokenFn?: any;
  deleteUserFn?: any;
  redisCountFn?: (metric: string) => void;
} = {}) {
  const rooms = overrides.rooms ?? new Map<string, Room>();
  const unregisterCalls: string[] = [];
  const deleteUserCalls: string[] = [];
  const redisCountCalls: string[] = [];

  const validateUserTokenFn = overrides.validateUserTokenFn ?? (async (_uid: string, token?: string, _requireConfirmation?: boolean) => {
    if (token === "valid-token") return { uid: "user-123", email: "user@test.com", email_verified: true };
    if (token === "unverified-token") return { uid: "user-456", email: "unverified@test.com", email_verified: false };
    if (token === "email-not-verified-token") return "EMAIL_NOT_VERIFIED" as const;
    return undefined;
  });

  const deleteUserFn = overrides.deleteUserFn ?? (async (uid: string) => { deleteUserCalls.push(uid); });
  const redisCountFn = overrides.redisCountFn ?? ((metric: string) => { redisCountCalls.push(metric); });
  const unregisterRoomNamespaceFn = overrides.unregisterRoomNamespaceFn ?? ((roomId: string) => { unregisterCalls.push(roomId); });

  const app = express();
  app.use(express.json());
  app.use(createAccountTeardownRouter({
    rooms,
    postgres: overrides.postgres ?? null,
    unregisterRoomNamespaceFn,
    validateUserTokenFn,
    deleteUserFn,
    redisCountFn,
  }));

  return { app, rooms, unregisterCalls, deleteUserCalls, redisCountCalls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test("accountTeardownRouter Suite", async (t) => {
  // T2: Missing Authorization header returns 401
  await t.test("returns 401 when no Authorization header is present", async () => {
    const { app } = buildApp();
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, r));

    try {
      const res = await request(server, "/deleteAccount", { method: "DELETE" });
      assert.equal(res.status, 401);
      assert.deepEqual(res.json, { error: "invalid user token" });
    } finally {
      server.close();
    }
  });

  // T2: Empty bearer token returns 401
  await t.test("returns 401 when Authorization header has empty bearer token", async () => {
    const { app } = buildApp();
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, r));

    try {
      const res = await request(server, "/deleteAccount", {
        method: "DELETE",
        headers: { Authorization: "Bearer " },
      });
      assert.equal(res.status, 401);
      assert.deepEqual(res.json, { error: "invalid user token" });
    } finally {
      server.close();
    }
  });

  // T3: Invalid/expired token returns 400
  await t.test("returns 400 when token is invalid", async () => {
    const { app } = buildApp();
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, r));

    try {
      const res = await request(server, "/deleteAccount", {
        method: "DELETE",
        headers: { Authorization: "Bearer invalid-token" },
      });
      assert.equal(res.status, 400);
      assert.deepEqual(res.json, { error: "invalid user token" });
    } finally {
      server.close();
    }
  });

  // T3, T4: EMAIL_NOT_VERIFIED returns 400
  await t.test("returns 400 when validateUserToken returns EMAIL_NOT_VERIFIED", async () => {
    const { app } = buildApp();
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, r));

    try {
      const res = await request(server, "/deleteAccount", {
        method: "DELETE",
        headers: { Authorization: "Bearer email-not-verified-token" },
      });
      assert.equal(res.status, 400);
      assert.deepEqual(res.json, { error: "invalid user token" });
    } finally {
      server.close();
    }
  });

  // T4: requireConfirmation: false -- valid unverified account CAN delete
  await t.test("valid unverified account can successfully execute deletion (requireConfirmation: false)", async () => {
    const callOrder: string[] = [];
    const validateUserTokenFn = async (_uid: string, token?: string, requireConfirmation?: boolean) => {
      // Verify requireConfirmation is passed as false
      assert.equal(requireConfirmation, false, "requireConfirmation must be false");
      if (token === "unverified-valid-token") {
        return { uid: "user-unverified", email: "noconfirm@test.com", email_verified: false };
      }
      return undefined;
    };
    const deleteUserFn = async (uid: string) => { callOrder.push(`deleteUser:${uid}`); };
    const redisCountFn = (metric: string) => { callOrder.push(`redisCount:${metric}`); };

    const { app } = buildApp({ validateUserTokenFn, deleteUserFn, redisCountFn });
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, r));

    try {
      const res = await request(server, "/deleteAccount", {
        method: "DELETE",
        headers: { Authorization: "Bearer unverified-valid-token" },
      });
      assert.equal(res.status, 200);
      assert.deepEqual(res.json, {});
      assert.deepEqual(callOrder, ["deleteUser:user-unverified", "redisCount:deleteAccount"]);
    } finally {
      server.close();
    }
  });

  // T5, T9, T10, T11: Successful teardown without postgres
  await t.test("successful teardown without postgres skips DB operations", async () => {
    const { app, deleteUserCalls, redisCountCalls } = buildApp({ postgres: null });
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, r));

    try {
      const res = await request(server, "/deleteAccount", {
        method: "DELETE",
        headers: { Authorization: "Bearer valid-token" },
      });
      assert.equal(res.status, 200);
      assert.deepEqual(res.json, {});
      assert.deepEqual(deleteUserCalls, ["user-123"]);
      assert.deepEqual(redisCountCalls, ["deleteAccount"]);
    } finally {
      server.close();
    }
  });

  // T6, T7, T8, T9, T10, T11, T13: Full teardown with postgres and rooms in memory
  await t.test("full teardown: purges rooms, destroys in-memory, deletes link_account, deletes user", async () => {
    const callOrder: string[] = [];
    const rooms = new Map<string, Room>();
    const room1 = createMockRoom("room-a");
    const room2 = createMockRoom("room-b");
    rooms.set("room-a", room1);
    rooms.set("room-b", room2);

    const queryCalls: { text: string; params: any[] }[] = [];
    const mockPostgres = {
      query: async (text: string, params: any[]) => {
        queryCalls.push({ text, params });
        if (text.includes("purge_account_rooms_authoritative")) {
          callOrder.push("sql:purge_account_rooms_authoritative");
          return { rows: [{ deleted_ids: ["room-a", "room-b"] }] };
        }
        if (text.includes("DELETE FROM link_account")) {
          callOrder.push("sql:DELETE FROM link_account");
        }
        return { rows: [] };
      },
    };

    const unregisterCalls: string[] = [];
    const unregisterRoomNamespaceFn = (roomId: string) => {
      unregisterCalls.push(roomId);
      callOrder.push(`unregister:${roomId}`);
    };
    const deleteUserFn = async (uid: string) => { callOrder.push(`deleteUser:${uid}`); };
    const redisCountFn = (metric: string) => { callOrder.push(`redisCount:${metric}`); };

    const { app } = buildApp({
      rooms,
      postgres: mockPostgres,
      unregisterRoomNamespaceFn,
      deleteUserFn,
      redisCountFn,
    });
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, r));

    try {
      const res = await request(server, "/deleteAccount", {
        method: "DELETE",
        headers: { Authorization: "Bearer valid-token" },
      });

      assert.equal(res.status, 200);
      assert.deepEqual(res.json, {});

      // T6: Verify purge SQL
      assert.equal(queryCalls[0].text, "SELECT public.purge_account_rooms_authoritative($1) AS deleted_ids");
      assert.deepEqual(queryCalls[0].params, ["user-123"]);

      // T8: Verify link_account deletion
      assert.equal(queryCalls[1].text, "DELETE FROM link_account WHERE uid = $1");
      assert.deepEqual(queryCalls[1].params, ["user-123"]);

      // T7: Verify in-memory cleanup
      assert.equal(rooms.has("room-a"), false);
      assert.equal(rooms.has("room-b"), false);
      assert.deepEqual(room1._destroyCalls, ["room-a"]);
      assert.deepEqual(room2._destroyCalls, ["room-b"]);
      assert.deepEqual(unregisterCalls, ["room-a", "room-b"]);

      // T13: Verify side-effect ordering
      assert.deepEqual(callOrder, [
        "sql:purge_account_rooms_authoritative",
        "unregister:room-a",
        "unregister:room-b",
        "sql:DELETE FROM link_account",
        "deleteUser:user-123",
        "redisCount:deleteAccount",
      ]);
    } finally {
      server.close();
    }
  });

  // T7 no-op branch: Purge returns IDs but none are in memory
  await t.test("purge returns room IDs not present in memory -- no destroy/unregister calls", async () => {
    const rooms = new Map<string, Room>();
    const unregisterCalls: string[] = [];

    const mockPostgres = {
      query: async (text: string, _params: any[]) => {
        if (text.includes("purge_account_rooms_authoritative")) {
          return { rows: [{ deleted_ids: ["ghost-room-1", "ghost-room-2"] }] };
        }
        return { rows: [] };
      },
    };

    const { app } = buildApp({
      rooms,
      postgres: mockPostgres,
      unregisterRoomNamespaceFn: (roomId: string) => { unregisterCalls.push(roomId); },
    });
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, r));

    try {
      const res = await request(server, "/deleteAccount", {
        method: "DELETE",
        headers: { Authorization: "Bearer valid-token" },
      });

      assert.equal(res.status, 200);
      assert.deepEqual(res.json, {});
      assert.equal(rooms.size, 0);
      assert.deepEqual(unregisterCalls, []);
    } finally {
      server.close();
    }
  });

  // T9: deleteUser called with correct uid
  await t.test("deleteUser is called with the decoded uid", async () => {
    const deleteUserCalls: string[] = [];
    const { app } = buildApp({
      deleteUserFn: async (uid: string) => { deleteUserCalls.push(uid); },
    });
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, r));

    try {
      const res = await request(server, "/deleteAccount", {
        method: "DELETE",
        headers: { Authorization: "Bearer valid-token" },
      });

      assert.equal(res.status, 200);
      assert.deepEqual(deleteUserCalls, ["user-123"]);
    } finally {
      server.close();
    }
  });

  // T10: redisCount metric
  await t.test("redisCount is called with 'deleteAccount' metric", async () => {
    const redisCountCalls: string[] = [];
    const { app } = buildApp({
      redisCountFn: (metric: string) => { redisCountCalls.push(metric); },
    });
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, r));

    try {
      const res = await request(server, "/deleteAccount", {
        method: "DELETE",
        headers: { Authorization: "Bearer valid-token" },
      });

      assert.equal(res.status, 200);
      assert.deepEqual(redisCountCalls, ["deleteAccount"]);
    } finally {
      server.close();
    }
  });

  // T5: Purge returns empty array -- no rooms to clean
  await t.test("purge returns empty deleted_ids array -- no memory cleanup needed", async () => {
    const unregisterCalls: string[] = [];
    const mockPostgres = {
      query: async (text: string, _params: any[]) => {
        if (text.includes("purge_account_rooms_authoritative")) {
          return { rows: [{ deleted_ids: [] }] };
        }
        return { rows: [] };
      },
    };

    const { app } = buildApp({
      postgres: mockPostgres,
      unregisterRoomNamespaceFn: (roomId: string) => { unregisterCalls.push(roomId); },
    });
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, r));

    try {
      const res = await request(server, "/deleteAccount", {
        method: "DELETE",
        headers: { Authorization: "Bearer valid-token" },
      });

      assert.equal(res.status, 200);
      assert.deepEqual(unregisterCalls, []);
    } finally {
      server.close();
    }
  });
}).then(() => {
  process.exit(0);
}).catch((err) => {
  console.error("Test failure in accountTeardownRouter:", err);
  process.exit(1);
});
