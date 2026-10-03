import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { createMediaProxyRouter } from "./mediaProxyRouter.js";

async function request(
  server: http.Server,
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
  } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any; raw: Buffer }> {
  const address = server.address() as any;
  const port = address.port;
  return new Promise((resolve, reject) => {
    const req = http.request(
      `http://127.0.0.1:${port}${path}`,
      {
        method: options.method || "GET",
        headers: options.headers,
        insecureHTTPParser: true,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const raw = Buffer.concat(chunks);
          let parsed: any;
          try {
            parsed = JSON.parse(raw.toString("utf-8"));
          } catch {
            parsed = raw.toString("utf-8");
          }
          resolve({ status: res.statusCode || 0, headers: res.headers, body: parsed, raw });
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

test("mediaProxyRouter Suite", async (t) => {
  await t.test("1. missing host parameter returns 400", async () => {
    let metricRecorded = "";
    const router = createMediaProxyRouter({
      redisCountFn: (m) => {
        metricRecorded = m;
      },
    });

    const app = express();
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      const res = await request(server, "/proxy/stream.m3u8");
      assert.equal(res.status, 400);
      assert.equal(res.body, "Missing host parameter");
      assert.equal(metricRecorded, "proxyReqs");
    } finally {
      server.close();
    }
  });

  await t.test("2. SSRF validation failure returns 403", async () => {
    let capturedTargetUrl = "";
    let capturedProtocols: ("https:" | "http:")[] | undefined = [];

    const router = createMediaProxyRouter({
      validateExternalUrlFn: async (url, protocols) => {
        capturedTargetUrl = url;
        capturedProtocols = protocols;
        return { valid: false, reason: "Private IP blocked" };
      },
    });

    const app = express();
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      const res = await request(server, "/proxy/video/stream.m3u8?host=internal.lan");
      assert.equal(res.status, 403);
      assert.equal(res.body, "Forbidden proxy target: Private IP blocked");
      assert.equal(capturedTargetUrl, "https://internal.lan/video/stream.m3u8");
      assert.deepEqual(capturedProtocols, ["https:"]);
    } finally {
      server.close();
    }
  });

  await t.test("3. unsupported file extension returns 404", async () => {
    const router = createMediaProxyRouter({
      validateExternalUrlFn: async () => ({ valid: true }),
    });

    const app = express();
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      const res = await request(server, "/proxy/secret.env?host=example.com");
      assert.equal(res.status, 404);
    } finally {
      server.close();
    }
  });

  await t.test("4. live .m3u8 manifest succeeds with exact fetch options", async () => {
    let capturedTarget = "";
    let capturedOptions: any = null;

    const manifestContent = "#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:6.0,\nsegment0.ts\n";

    const router = createMediaProxyRouter({
      validateExternalUrlFn: async () => ({ valid: true }),
      safeExternalGetFn: async (url, options) => {
        capturedTarget = url;
        capturedOptions = options;
        return {
          status: 200,
          statusText: "OK",
          headers: { "content-type": "application/vnd.apple.mpegurl" },
          data: Buffer.from(manifestContent, "utf-8"),
          finalUrl: url,
        };
      },
    });

    const app = express();
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      const res = await request(server, "/proxy/live/playlist.m3u8?host=cdn.video.org");
      assert.equal(res.status, 200);
      assert.equal(res.body, manifestContent);
      assert.equal(capturedTarget, "https://cdn.video.org/live/playlist.m3u8");
      assert.equal(capturedOptions.timeoutMs, 8000);
      assert.equal(capturedOptions.maxBytes, 2 * 1024 * 1024);
    } finally {
      server.close();
    }
  });

  await t.test("5. index-dvr.m3u8 rewrites segment lines with ?host= and appends #EXT-X-ENDLIST", async () => {
    const rawVodManifest = "#EXTM3U\n#EXTINF:4.0,\nseg1.ts\n#EXTINF:4.0,\nseg2.ts\n";

    const router = createMediaProxyRouter({
      validateExternalUrlFn: async () => ({ valid: true }),
      safeExternalGetFn: async (url) => ({
        status: 200,
        statusText: "OK",
        headers: {},
        data: Buffer.from(rawVodManifest, "utf-8"),
        finalUrl: url,
      }),
    });

    const app = express();
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      const res = await request(server, "/proxy/vod/index-dvr.m3u8?host=vod.example.com");
      assert.equal(res.status, 200);
      const body = res.body;
      assert(body.includes("seg1.ts?host=vod.example.com"));
      assert(body.includes("seg2.ts?host=vod.example.com"));
      assert(body.endsWith("#EXT-X-ENDLIST"));
    } finally {
      server.close();
    }
  });

  await t.test("6. .ts segment returns binary data and exact transport headers", async () => {
    const segmentBuffer = Buffer.from([0x47, 0x40, 0x00, 0x10, 0xaa, 0xbb, 0xcc, 0xdd]);
    let capturedOptions: any = null;

    const router = createMediaProxyRouter({
      validateExternalUrlFn: async () => ({ valid: true }),
      safeExternalGetFn: async (url, options) => {
        capturedOptions = options;
        return {
          status: 200,
          statusText: "OK",
          headers: {},
          data: segmentBuffer,
          finalUrl: url,
        };
      },
    });

    const app = express();
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      const res = await request(server, "/proxy/video/chunk_1.ts?host=cdn.example.com");
      assert.equal(res.status, 200);
      assert.equal(res.headers["content-type"], "application/octet-stream");
      assert.equal(res.headers["accept-ranges"], "bytes");
      assert.equal(res.headers["content-length"], segmentBuffer.length.toString());
      assert.deepEqual(res.raw, segmentBuffer);
      assert.equal(capturedOptions.timeoutMs, 15000);
      assert.equal(capturedOptions.maxBytes, 25 * 1024 * 1024);
    } finally {
      server.close();
    }
  });

  await t.test("7. upstream fetch error returns 502 Bad Gateway", async () => {
    const router = createMediaProxyRouter({
      validateExternalUrlFn: async () => ({ valid: true }),
      safeExternalGetFn: async () => {
        throw new Error("Connection reset by peer");
      },
    });

    const app = express();
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      const res = await request(server, "/proxy/stream.m3u8?host=broken.example.com");
      assert.equal(res.status, 502);
      assert.equal(res.body, "Bad Gateway");
    } finally {
      server.close();
    }
  });

  await t.test("8. proxyReqs metric is invoked on every incoming request", async () => {
    let proxyCount = 0;
    const router = createMediaProxyRouter({
      validateExternalUrlFn: async () => ({ valid: false, reason: "Mocked" }),
      redisCountFn: (metric) => {
        if (metric === "proxyReqs") proxyCount++;
      },
    });

    const app = express();
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      await request(server, "/proxy/invalid");
      await request(server, "/proxy/stream.m3u8?host=example.com");
      assert.equal(proxyCount, 2);
    } finally {
      server.close();
    }
  });

  await t.test("9. path parsing preserves nested path segments", async () => {
    let capturedUrl = "";
    const router = createMediaProxyRouter({
      validateExternalUrlFn: async (url) => {
        capturedUrl = url;
        return { valid: false, reason: "Stop here" };
      },
    });

    const app = express();
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      await request(server, "/proxy/hls/subfolder/2026/stream.m3u8?host=media.storage.com");
      assert.equal(capturedUrl, "https://media.storage.com/hls/subfolder/2026/stream.m3u8");
    } finally {
      server.close();
    }
  });
}).then(() => {
  process.exit(0);
}).catch((err) => {
  console.error("Test failure in mediaProxyRouter:", err);
  process.exit(1);
});
