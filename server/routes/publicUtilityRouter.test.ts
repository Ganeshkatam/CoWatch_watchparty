import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { createPublicUtilityRouter, defaultSanitizeActionUrl } from "./publicUtilityRouter.js";

async function request(
  server: http.Server,
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
  } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any; raw: string }> {
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
          resolve({ status: res.statusCode || 0, headers: res.headers, body: parsed, raw });
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

test("publicUtilityRouter Suite", async (t) => {
  await t.test("defaultSanitizeActionUrl unit tests", () => {
    assert.equal(defaultSanitizeActionUrl(null), null);
    assert.equal(defaultSanitizeActionUrl(undefined), null);
    assert.equal(defaultSanitizeActionUrl(""), null);
    assert.equal(defaultSanitizeActionUrl("   "), null);

    // Valid relative paths
    assert.equal(defaultSanitizeActionUrl("/rooms/my-room"), "/rooms/my-room");
    assert.equal(defaultSanitizeActionUrl("/help"), "/help");

    // Invalid relative paths (open redirect vectors)
    assert.equal(defaultSanitizeActionUrl("//evil.com"), null);
    assert.equal(defaultSanitizeActionUrl("/\\evil.com"), null);
    assert.equal(defaultSanitizeActionUrl("/evil.com\\sub"), null);

    // Absolute URLs
    assert.equal(defaultSanitizeActionUrl("https://cowatch.org/release-notes"), "https://cowatch.org/release-notes");
    assert.equal(defaultSanitizeActionUrl("javascript:alert(1)"), null);
    assert.equal(defaultSanitizeActionUrl("data:text/html,bad"), null);
    assert.equal(defaultSanitizeActionUrl("ftp://files.example.com"), null);
  });

  await t.test("GET /announcements - when postgres is not configured", async () => {
    const router = createPublicUtilityRouter({
      postgres: null,
    });

    const app = express();
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      const res = await request(server, "/announcements");
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { announcements: [] });
    } finally {
      server.close();
    }
  });

  await t.test("GET /announcements - when postgres throws an error", async () => {
    const mockPostgres = {
      query: async () => {
        throw new Error("Connection failed");
      },
    } as any;

    const router = createPublicUtilityRouter({
      postgres: mockPostgres,
    });

    const app = express();
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      const res = await request(server, "/announcements");
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { announcements: [] });
    } finally {
      server.close();
    }
  });

  await t.test("GET /announcements - successful query, ordering, filtering, and sanitization", async () => {
    let capturedSql = "";
    const mockRows = [
      {
        id: "ann-1",
        title: "Platform Maintenance",
        body: "Scheduled maintenance tomorrow.",
        level: "warning",
        action_label: "Learn More",
        action_url: "/docs/maintenance",
        published_at: "2026-10-01T10:00:00Z",
        updated_at: "2026-10-01T10:00:00Z",
      },
      {
        id: "ann-2",
        title: "Security Update",
        body: "New features live.",
        level: "info",
        action_label: null,
        action_url: "//evil.com", // should be sanitized to null
        published_at: "2026-09-30T10:00:00Z",
        updated_at: "2026-09-30T10:00:00Z",
      },
    ];

    const mockPostgres = {
      query: async (sql: string) => {
        capturedSql = sql;
        return { rows: mockRows };
      },
    } as any;

    const router = createPublicUtilityRouter({
      postgres: mockPostgres,
    });

    const app = express();
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      const res = await request(server, "/announcements");
      assert.equal(res.status, 200);
      assert(capturedSql.includes("WHERE is_active = true"));
      assert(capturedSql.includes("AND published_at <= NOW()"));
      assert(capturedSql.includes("ORDER BY published_at DESC"));
      assert(capturedSql.includes("LIMIT 10"));

      assert.equal(res.body.announcements.length, 2);
      assert.equal(res.body.announcements[0].id, "ann-1");
      assert.equal(res.body.announcements[0].action_label, "Learn More");
      assert.equal(res.body.announcements[0].action_url, "/docs/maintenance");

      assert.equal(res.body.announcements[1].id, "ann-2");
      assert.equal(res.body.announcements[1].action_label, null);
      assert.equal(res.body.announcements[1].action_url, null); // sanitized
    } finally {
      server.close();
    }
  });

  await t.test("GET /generateName - returns plain string from makeUserName", async () => {
    const router = createPublicUtilityRouter({
      postgres: null,
      makeUserNameFn: () => "CosmicOtter42",
    });

    const app = express();
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      const res = await request(server, "/generateName");
      assert.equal(res.status, 200);
      assert.equal(res.raw, "CosmicOtter42");
    } finally {
      server.close();
    }
  });
});
