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
});
