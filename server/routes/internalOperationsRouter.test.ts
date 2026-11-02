import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { createInternalOperationsRouter } from "./internalOperationsRouter.js";

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
    const payload = options.body ? JSON.stringify(options.body) : undefined;
    const headers = {
      ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload).toString() } : {}),
      ...(options.headers || {}),
    };

    const req = http.request(
      `http://127.0.0.1:${port}${path}`,
      {
        method: options.method || "GET",
        headers,
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
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

test("internalOperationsRouter Suite", async (t) => {
  await t.test("GET /ping - returns pong with status 200", async () => {
    const router = createInternalOperationsRouter();
    const app = express();
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      const res = await request(server, "/ping");
      assert.equal(res.status, 200);
      assert.equal(res.body, "pong");
    } finally {
      server.close();
    }
  });

  await t.test("POST /internal/webhooks/email/:provider - delegates to providerWebhookRouter", async () => {
    let capturedProvider = "";
    let capturedBody: any = null;

    const mockWebhookRouter = {
      handleWebhook: async (req: express.Request, res: express.Response) => {
        capturedProvider = req.params.provider;
        capturedBody = req.body;
        res.status(200).json({ status: "processed", provider: capturedProvider });
      },
    };

    const router = createInternalOperationsRouter({
      providerWebhookRouterInstance: mockWebhookRouter,
    });

    const app = express();
    app.use(express.json());
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      const res = await request(server, "/internal/webhooks/email/brevo", {
        method: "POST",
        body: { event: "delivered", email: "user@example.com" },
      });

      assert.equal(res.status, 200);
      assert.equal(capturedProvider, "brevo");
      assert.deepEqual(capturedBody, { event: "delivered", email: "user@example.com" });
      assert.equal(res.body.status, "processed");
    } finally {
      server.close();
    }
  });

  await t.test("GET /internal/health/notifications - auth rejection, success, and error handling", async () => {
    let healthReportCalls = 0;
    const mockReport = {
      healthy: true,
      pendingOutbox: 0,
      activeProvider: "brevo",
    };

    const router = createInternalOperationsRouter({
      requireInternalAuthMiddleware: (req, res, next) => {
        if (req.headers["x-test-auth"] !== "allowed") {
          res.status(401).json({ error: "UNAUTHORIZED: Valid INTERNAL_API_SECRET required" });
          return;
        }
        next();
      },
      getNotificationHealthReportFn: async () => {
        healthReportCalls++;
        if (healthReportCalls === 2) {
          throw new Error("Telemetry failure");
        }
        return mockReport;
      },
    });

    const app = express();
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      // 1. Unauthorized
      const resUnauthorized = await request(server, "/internal/health/notifications");
      assert.equal(resUnauthorized.status, 401);
      assert.equal(resUnauthorized.body.error, "UNAUTHORIZED: Valid INTERNAL_API_SECRET required");

      // 2. Authorized success
      const resSuccess = await request(server, "/internal/health/notifications", {
        headers: { "x-test-auth": "allowed" },
      });
      assert.equal(resSuccess.status, 200);
      assert.deepEqual(resSuccess.body, mockReport);

      // 3. Authorized error handling
      const resError = await request(server, "/internal/health/notifications", {
        headers: { "x-test-auth": "allowed" },
      });
      assert.equal(resError.status, 500);
      assert.equal(resError.body.error, "HEALTH_CHECK_FAILED");
      assert.equal(resError.body.details, "Telemetry failure");
    } finally {
      server.close();
    }
  });

  await t.test("GET /internal/health/relay - auth rejection and relay status reporting", async () => {
    const router = createInternalOperationsRouter({
      requireInternalAuthMiddleware: (req, res, next) => {
        if (req.headers["x-test-auth"] !== "allowed") {
          res.status(401).json({ error: "UNAUTHORIZED: Valid INTERNAL_API_SECRET required" });
          return;
        }
        next();
      },
    });

    const app = express();
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      // 1. Unauthorized
      const resUnauthorized = await request(server, "/internal/health/relay");
      assert.equal(resUnauthorized.status, 401);

      // 2. Authorized
      const resAuthorized = await request(server, "/internal/health/relay", {
        headers: { "x-test-auth": "allowed" },
      });
      assert.equal(resAuthorized.status, 200);
      assert.ok(["healthy", "stun_only", "misconfigured"].includes(resAuthorized.body.status));
      assert.equal(typeof resAuthorized.body.relayConfigured, "boolean");
    } finally {
      server.close();
    }
  });

  await t.test("defaultRequireInternalAuth - loopback spoofing via X-Forwarded-For rejected in production", async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
      let nextCalled = false;
      const req: any = {
        headers: {
          "x-forwarded-for": "127.0.0.1",
        },
        ip: "127.0.0.1",
        socket: {
          remoteAddress: "203.0.113.195", // Physical remote IP
        },
      };
      const res: any = {
        statusCode: 200,
        body: null,
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        json(data: any) {
          this.body = data;
          return this;
        },
      };

      const { defaultRequireInternalAuth } = await import("./internalOperationsRouter.js");
      defaultRequireInternalAuth(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, false);
      assert.equal(res.statusCode, 403);
      assert.ok(res.body?.error?.includes("FORBIDDEN"));
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });

  await t.test("GET /internal/health/database - healthy, unconfigured, and error reporting", async () => {
    // 1. Success case
    const mockPostgresHealthy = {
      query: async (queryArg: any) => {
        const sqlText = typeof queryArg === "string" ? queryArg : queryArg?.text;
        assert.equal(sqlText, "SELECT 1 AS alive");
        if (typeof queryArg === "object") {
          assert.equal(queryArg.statement_timeout, 3000);
          assert.equal(queryArg.query_timeout, 3000);
        }
        return { rows: [{ alive: 1 }] };
      },
    };

    const routerHealthy = createInternalOperationsRouter({
      postgres: mockPostgresHealthy as any,
      requireInternalAuthMiddleware: (_req, _res, next) => next(),
    });

    const appHealthy = express();
    appHealthy.use(routerHealthy);
    const serverHealthy = http.createServer(appHealthy);
    await new Promise<void>((resolve) => serverHealthy.listen(0, resolve));

    try {
      const res = await request(serverHealthy, "/internal/health/database");
      assert.equal(res.status, 200);
      assert.equal(res.body.status, "healthy");
      assert.equal(res.body.database, "connected");
      assert.equal(typeof res.body.latencyMs, "number");
    } finally {
      serverHealthy.close();
    }

    // 2. Disabled / unconfigured case
    const routerDisabled = createInternalOperationsRouter({
      postgres: null,
      requireInternalAuthMiddleware: (_req, _res, next) => next(),
    });
    const appDisabled = express();
    appDisabled.use(routerDisabled);
    const serverDisabled = http.createServer(appDisabled);
    await new Promise<void>((resolve) => serverDisabled.listen(0, resolve));

    try {
      const res = await request(serverDisabled, "/internal/health/database");
      assert.equal(res.status, 200);
      assert.equal(res.body.status, "disabled");
      assert.equal(res.body.database, "not_configured");
    } finally {
      serverDisabled.close();
    }

    // 3. Database query failure case
    const mockPostgresFailing = {
      query: async () => {
        throw new Error("connection terminated unexpectedly");
      },
    };
    const routerFailing = createInternalOperationsRouter({
      postgres: mockPostgresFailing as any,
      requireInternalAuthMiddleware: (_req, _res, next) => next(),
    });
    const appFailing = express();
    appFailing.use(routerFailing);
    const serverFailing = http.createServer(appFailing);
    await new Promise<void>((resolve) => serverFailing.listen(0, resolve));

    try {
      const res = await request(serverFailing, "/internal/health/database");
      assert.equal(res.status, 503);
      assert.equal(res.body.status, "unhealthy");
      assert.equal(res.body.database, "error");
      assert.equal(res.body.error, "DATABASE_UNAVAILABLE");
    } finally {
      serverFailing.close();
    }

    // 4. Stalled database query timeout cancellation case
    const mockPostgresStalled = {
      query: async () => {
        // Simulates query hanging beyond 3000ms bound
        return new Promise((resolve) => setTimeout(resolve, 10000));
      },
    };
    const routerStalled = createInternalOperationsRouter({
      postgres: mockPostgresStalled as any,
      requireInternalAuthMiddleware: (_req, _res, next) => next(),
    });
    const appStalled = express();
    appStalled.use(routerStalled);
    const serverStalled = http.createServer(appStalled);
    await new Promise<void>((resolve) => serverStalled.listen(0, resolve));

    try {
      const res = await request(serverStalled, "/internal/health/database");
      assert.equal(res.status, 503);
      assert.equal(res.body.status, "unhealthy");
      assert.equal(res.body.database, "timeout");
      assert.equal(res.body.error, "DATABASE_UNAVAILABLE");
      assert.ok(res.body.latencyMs >= 2900);
    } finally {
      serverStalled.close();
    }
  });
});
