import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { createAuthAccountRouter } from "./authAccountRouter.ts";

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

test("authAccountRouter Suite", async (t) => {
  await t.test("POST /api/auth/validate-email validation contracts", async (t) => {
    await t.test("missing or non-string email returns 400 Email is required", async () => {
      const app = express();
      app.use(express.json());
      app.use(createAuthAccountRouter());
      const server = http.createServer(app);
      await new Promise<void>((r) => server.listen(0, r));

      try {
        const resEmpty = await request(server, "/api/auth/validate-email", {
          method: "POST",
          body: {},
        });
        assert.equal(resEmpty.status, 400);
        assert.deepEqual(resEmpty.json, { error: "Email is required" });

        const resNumber = await request(server, "/api/auth/validate-email", {
          method: "POST",
          body: { email: 12345 },
        });
        assert.equal(resNumber.status, 400);
        assert.deepEqual(resNumber.json, { error: "Email is required" });
      } finally {
        server.close();
      }
    });

    await t.test("disallowed domain returns 400 Email provider is not supported.", async () => {
      const app = express();
      app.use(express.json());
      app.use(createAuthAccountRouter({
        isAllowedEmailDomainFn: () => false,
      }));
      const server = http.createServer(app);
      await new Promise<void>((r) => server.listen(0, r));

      try {
        const res = await request(server, "/api/auth/validate-email", {
          method: "POST",
          body: { email: "user@disallowed-temp-mail.com" },
        });
        assert.equal(res.status, 400);
        assert.deepEqual(res.json, { error: "Email provider is not supported." });
      } finally {
        server.close();
      }
    });

    await t.test("allowed domain returns 200 { valid: true }", async () => {
      const app = express();
      app.use(express.json());
      app.use(createAuthAccountRouter({
        isAllowedEmailDomainFn: (e) => e === "alice@gmail.com",
      }));
      const server = http.createServer(app);
      await new Promise<void>((r) => server.listen(0, r));

      try {
        const res = await request(server, "/api/auth/validate-email", {
          method: "POST",
          body: { email: "alice@gmail.com" },
        });
        assert.equal(res.status, 200);
        assert.deepEqual(res.json, { valid: true });
      } finally {
        server.close();
      }
    });
  });

  await t.test("POST /api/auth/duplicate-signup-alert anti-enumeration contracts", async (t) => {
    await t.test("missing or invalid email returns 200 { success: true } without side effects", async () => {
      let rateLimitChecked = false;
      const app = express();
      app.use(express.json());
      app.use(createAuthAccountRouter({
        checkRateLimitFn: async () => {
          rateLimitChecked = true;
          return { allowed: true, retryAfterSeconds: 0, remainingAttempts: 3 };
        },
      }));
      const server = http.createServer(app);
      await new Promise<void>((r) => server.listen(0, r));

      try {
        const res1 = await request(server, "/api/auth/duplicate-signup-alert", {
          method: "POST",
          body: {},
        });
        assert.equal(res1.status, 200);
        assert.deepEqual(res1.json, { success: true });
        assert.equal(rateLimitChecked, false);

        const res2 = await request(server, "/api/auth/duplicate-signup-alert", {
          method: "POST",
          body: { email: 987 },
        });
        assert.equal(res2.status, 200);
        assert.deepEqual(res2.json, { success: true });
        assert.equal(rateLimitChecked, false);
      } finally {
        server.close();
      }
    });

    await t.test("disallowed domain returns 200 { success: true } without rate limiting or dispatch", async () => {
      let rateLimitChecked = false;
      const app = express();
      app.use(express.json());
      app.use(createAuthAccountRouter({
        isAllowedEmailDomainFn: () => false,
        checkRateLimitFn: async () => {
          rateLimitChecked = true;
          return { allowed: true, retryAfterSeconds: 0, remainingAttempts: 3 };
        },
      }));
      const server = http.createServer(app);
      await new Promise<void>((r) => server.listen(0, r));

      try {
        const res = await request(server, "/api/auth/duplicate-signup-alert", {
          method: "POST",
          body: { email: "attacker@temp.org" },
        });
        assert.equal(res.status, 200);
        assert.deepEqual(res.json, { success: true });
        assert.equal(rateLimitChecked, false);
      } finally {
        server.close();
      }
    });

    await t.test("rate limit rejection returns 200 { success: true } without recording attempt", async () => {
      let recorded = false;
      const app = express();
      app.use(express.json());
      app.use(createAuthAccountRouter({
        isAllowedEmailDomainFn: () => true,
        checkRateLimitFn: async (key) => {
          if (key.includes("email")) {
            return { allowed: false, retryAfterSeconds: 900, remainingAttempts: 0 };
          }
          return { allowed: true, retryAfterSeconds: 0, remainingAttempts: 10 };
        },
        recordAttemptFn: async () => {
          recorded = true;
        },
      }));
      const server = http.createServer(app);
      await new Promise<void>((r) => server.listen(0, r));

      try {
        const res = await request(server, "/api/auth/duplicate-signup-alert", {
          method: "POST",
          body: { email: "Spam@example.com" },
        });
        assert.equal(res.status, 200);
        assert.deepEqual(res.json, { success: true });
        assert.equal(recorded, false);
      } finally {
        server.close();
      }
    });

    await t.test("non-existent user returns 200 { success: true } and does not dispatch alert", async () => {
      const recordedKeys: string[] = [];
      let alertDispatched = false;

      const app = express();
      app.use(express.json());
      app.use(createAuthAccountRouter({
        isAllowedEmailDomainFn: () => true,
        checkRateLimitFn: async () => ({ allowed: true, retryAfterSeconds: 0, remainingAttempts: 3 }),
        recordAttemptFn: async (key) => { recordedKeys.push(key); },
        getUserByEmailFn: async () => null,
        sendSecurityAlertFn: async () => {
          alertDispatched = true;
          return null;
        },
      }));
      const server = http.createServer(app);
      await new Promise<void>((r) => server.listen(0, r));

      try {
        const res = await request(server, "/api/auth/duplicate-signup-alert", {
          method: "POST",
          body: { email: "nonexistent@example.com" },
        });
        assert.equal(res.status, 200);
        assert.deepEqual(res.json, { success: true });
        assert.equal(recordedKeys.length, 2);
        assert.equal(alertDispatched, false);
      } finally {
        server.close();
      }
    });

    await t.test("existing user triggers fire-and-forget security alert with parsed headers", async () => {
      const recordedKeys: string[] = [];
      let alertPayload: any = null;

      const app = express();
      app.use(express.json());
      app.use(createAuthAccountRouter({
        isAllowedEmailDomainFn: () => true,
        checkRateLimitFn: async () => ({ allowed: true, retryAfterSeconds: 0, remainingAttempts: 3 }),
        recordAttemptFn: async (key) => { recordedKeys.push(key); },
        getUserByEmailFn: async (email) => ({ uid: "user-123", email }),
        sendSecurityAlertFn: async (payload) => {
          alertPayload = payload;
          return null;
        },
      }));
      const server = http.createServer(app);
      await new Promise<void>((r) => server.listen(0, r));

      try {
        const res = await request(server, "/api/auth/duplicate-signup-alert", {
          method: "POST",
          headers: {
            "x-forwarded-for": "203.0.113.195, 10.0.0.1",
            "user-agent": "Mozilla/5.0 TestBrowser",
          },
          body: { email: "  User.Existing@Example.COM  " },
        });
        assert.equal(res.status, 200);
        assert.deepEqual(res.json, { success: true });
        assert.equal(recordedKeys[0], "dup-signup:email:user.existing@example.com");
        assert.equal(recordedKeys[1], "dup-signup:ip:203.0.113.195");
        assert.ok(alertPayload);
        assert.equal(alertPayload.email, "user.existing@example.com");
        assert.equal(alertPayload.ipAddress, "203.0.113.195");
        assert.equal(alertPayload.userAgent, "Mozilla/5.0 TestBrowser");
        assert.ok(alertPayload.attemptedAt instanceof Date);
      } finally {
        server.close();
      }
    });

    await t.test("handler exception still safely returns 200 { success: true }", async () => {
      const app = express();
      app.use(express.json());
      app.use(createAuthAccountRouter({
        isAllowedEmailDomainFn: () => true,
        checkRateLimitFn: async () => {
          throw new Error("Redis cluster disconnected");
        },
      }));
      const server = http.createServer(app);
      await new Promise<void>((r) => server.listen(0, r));

      try {
        const res = await request(server, "/api/auth/duplicate-signup-alert", {
          method: "POST",
          body: { email: "victim@example.com" },
        });
        assert.equal(res.status, 200);
        assert.deepEqual(res.json, { success: true });
      } finally {
        server.close();
      }
    });
  });

  await t.test("POST /api/account/delete self-service deletion contracts", async (t) => {
    await t.test("missing or invalid authorization header returns 401", async () => {
      const app = express();
      app.use(express.json());
      app.use(createAuthAccountRouter());
      const server = http.createServer(app);
      await new Promise<void>((r) => server.listen(0, r));

      try {
        const resNoAuth = await request(server, "/api/account/delete", { method: "POST" });
        assert.equal(resNoAuth.status, 401);
        assert.deepEqual(resNoAuth.json, { error: "Missing or invalid Authorization header" });

        const resBadHeader = await request(server, "/api/account/delete", {
          method: "POST",
          headers: { authorization: "Basic 12345" },
        });
        assert.equal(resBadHeader.status, 401);
        assert.deepEqual(resBadHeader.json, { error: "Missing or invalid Authorization header" });
      } finally {
        server.close();
      }
    });

    await t.test("invalid or expired token returns 401 Invalid token", async () => {
      const app = express();
      app.use(express.json());
      app.use(createAuthAccountRouter({
        supabaseAdminClient: {
          auth: {
            getUser: async () => ({ data: { user: null }, error: new Error("JWT expired") }),
          },
        } as any,
      }));
      const server = http.createServer(app);
      await new Promise<void>((r) => server.listen(0, r));

      try {
        const res = await request(server, "/api/account/delete", {
          method: "POST",
          headers: { authorization: "Bearer bad-token-123" },
        });
        assert.equal(res.status, 401);
        assert.deepEqual(res.json, { error: "Invalid token" });
      } finally {
        server.close();
      }
    });

    await t.test("storage list error returns 500 Failed to list avatars", async () => {
      const app = express();
      app.use(express.json());
      app.use(createAuthAccountRouter({
        supabaseAdminClient: {
          auth: {
            getUser: async () => ({ data: { user: { id: "uid-abc" } }, error: null }),
          },
          storage: {
            from: () => ({
              list: async () => ({ data: null, error: new Error("S3 bucket unavailable") }),
            }),
          },
        } as any,
      }));
      const server = http.createServer(app);
      await new Promise<void>((r) => server.listen(0, r));

      try {
        const res = await request(server, "/api/account/delete", {
          method: "POST",
          headers: { authorization: "Bearer valid-token" },
        });
        assert.equal(res.status, 500);
        assert.deepEqual(res.json, { error: "Failed to list avatars" });
      } finally {
        server.close();
      }
    });

    await t.test("storage remove error returns 500 Failed to delete avatars", async () => {
      const app = express();
      app.use(express.json());
      app.use(createAuthAccountRouter({
        supabaseAdminClient: {
          auth: {
            getUser: async () => ({ data: { user: { id: "uid-abc" } }, error: null }),
          },
          storage: {
            from: () => ({
              list: async () => ({ data: [{ name: "avatar.png" }], error: null }),
              remove: async () => ({ error: new Error("Permission denied") }),
            }),
          },
        } as any,
      }));
      const server = http.createServer(app);
      await new Promise<void>((r) => server.listen(0, r));

      try {
        const res = await request(server, "/api/account/delete", {
          method: "POST",
          headers: { authorization: "Bearer valid-token" },
        });
        assert.equal(res.status, 500);
        assert.deepEqual(res.json, { error: "Failed to delete avatars" });
      } finally {
        server.close();
      }
    });

    await t.test("deleteUser error returns 500 Failed to delete auth user", async () => {
      const app = express();
      app.use(express.json());
      app.use(createAuthAccountRouter({
        supabaseAdminClient: {
          auth: {
            getUser: async () => ({ data: { user: { id: "uid-abc" } }, error: null }),
          },
          storage: {
            from: () => ({
              list: async () => ({ data: [], error: null }),
            }),
          },
        } as any,
        deleteUserFn: async () => ({ error: new Error("User cannot be deleted") }),
      }));
      const server = http.createServer(app);
      await new Promise<void>((r) => server.listen(0, r));

      try {
        const res = await request(server, "/api/account/delete", {
          method: "POST",
          headers: { authorization: "Bearer valid-token" },
        });
        assert.equal(res.status, 500);
        assert.deepEqual(res.json, { error: "Failed to delete auth user" });
      } finally {
        server.close();
      }
    });

    await t.test("successful deletion with avatars returns 204 No Content", async () => {
      let removedFiles: string[] = [];
      let deletedUid = "";

      const app = express();
      app.use(express.json());
      app.use(createAuthAccountRouter({
        supabaseAdminClient: {
          auth: {
            getUser: async () => ({ data: { user: { id: "uid-success-1" } }, error: null }),
          },
          storage: {
            from: (bucket: string) => {
              assert.equal(bucket, "avatars");
              return {
                list: async (folder: string) => {
                  assert.equal(folder, "uid-success-1");
                  return { data: [{ name: "photo.jpg" }, { name: "thumb.jpg" }], error: null };
                },
                remove: async (paths: string[]) => {
                  removedFiles = paths;
                  return { error: null };
                },
              };
            },
          },
        } as any,
        deleteUserFn: async (uid) => {
          deletedUid = uid;
          return { error: null };
        },
      }));
      const server = http.createServer(app);
      await new Promise<void>((r) => server.listen(0, r));

      try {
        const res = await request(server, "/api/account/delete", {
          method: "POST",
          headers: { authorization: "Bearer valid-token" },
        });
        assert.equal(res.status, 204);
        assert.equal(res.body, "");
        assert.deepEqual(removedFiles, ["uid-success-1/photo.jpg", "uid-success-1/thumb.jpg"]);
        assert.equal(deletedUid, "uid-success-1");
      } finally {
        server.close();
      }
    });

    await t.test("successful deletion without avatars skips storage remove and returns 204", async () => {
      let removeCalled = false;
      let deletedUid = "";

      const app = express();
      app.use(express.json());
      app.use(createAuthAccountRouter({
        supabaseAdminClient: {
          auth: {
            getUser: async () => ({ data: { user: { id: "uid-success-2" } }, error: null }),
          },
          storage: {
            from: () => ({
              list: async () => ({ data: [], error: null }),
              remove: async () => {
                removeCalled = true;
                return { error: null };
              },
            }),
          },
        } as any,
        deleteUserFn: async (uid) => {
          deletedUid = uid;
          return { error: null };
        },
      }));
      const server = http.createServer(app);
      await new Promise<void>((r) => server.listen(0, r));

      try {
        const res = await request(server, "/api/account/delete", {
          method: "POST",
          headers: { authorization: "Bearer valid-token" },
        });
        assert.equal(res.status, 204);
        assert.equal(res.body, "");
        assert.equal(removeCalled, false);
        assert.equal(deletedUid, "uid-success-2");
      } finally {
        server.close();
      }
    });
  });
}).then(() => {
  process.exit(0);
}).catch((err) => {
  console.error("Test failure in authAccountRouter:", err);
  process.exit(1);
});
