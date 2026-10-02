import { strict as assert } from "node:assert";
import express from "express";
import http from "node:http";
import { createSubtitleRouter, computeOpenSubtitlesHash } from "./subtitleRouter.ts";

async function runSubtitleRouterTests() {
  console.log("================================================================");
  console.log("STARTING SUBTITLE ROUTER MODULAR EXTRACTION TEST SUITE");
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

  // Section 1: Pure computeOpenSubtitlesHash function
  {
    const first = Buffer.alloc(65536, 1);
    const last = Buffer.alloc(65536, 2);
    const hash = computeOpenSubtitlesHash(first, last, 131072);
    test("computeOpenSubtitlesHash produces valid 16-character hex hash", typeof hash === "string" && hash.length === 16);
  }

  // Section 2: Mock Redis storage and Router endpoints
  const storage = new Map<string, Buffer>();
  const mockRedis = {
    client: true,
    execute: async (
      _op: string,
      cmd: string,
      fn: (c: any) => Promise<any>
    ) => {
      const mockClient = {
        getBuffer: async (key: string) => storage.get(key) || null,
        setex: async (key: string, _ttl: number, val: Buffer) => {
          storage.set(key, val);
          return "OK";
        },
        expire: async (_key: string, _ttl: number) => 1,
      };
      return fn(mockClient);
    },
  };

  const counterCalls: string[] = [];
  const mockCounter = (name: string) => {
    counterCalls.push(name);
  };

  const app = express();
  app.use(express.raw({ type: "text/plain", limit: 1000000 }));
  app.use(createSubtitleRouter({ redis: mockRedis as any, counter: mockCounter as any }));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Test 1: GET /subtitle/:hash returns 404 for missing hash
    {
      const res = await fetch(`${baseUrl}/subtitle/nonexistenthash`);
      test("GET /subtitle/:hash returns 404 on missing cache", res.status === 404);
    }

    // Test 2: POST /subtitle stores gzipped content and returns hash
    let uploadedHash = "";
    {
      const sampleSrt = "1\n00:00:01,000 --> 00:00:04,000\nHello World\n";
      const res = await fetch(`${baseUrl}/subtitle`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: sampleSrt,
      });
      const data = await res.json();
      uploadedHash = data.hash;
      test(
        "POST /subtitle stores content and returns hash",
        res.status === 200 && typeof uploadedHash === "string" && uploadedHash.length === 64
      );
      test("POST /subtitle increments subUploads counter", counterCalls.includes("subUploads"));
    }

    // Test 3: GET /subtitle/:hash retrieves stored buffer with Content-Encoding gzip
    {
      const res = await fetch(`${baseUrl}/subtitle/${uploadedHash}`);
      const encoding = res.headers.get("Content-Encoding");
      const text = await res.text();
      test(
        "GET /subtitle/:hash retrieves stored gzipped buffer and decodes correctly",
        res.status === 200 && encoding === "gzip" && text.includes("Hello World")
      );
    }

    // Test 4: GET /searchSubtitles with no query or URL returns empty array
    {
      const res = await fetch(`${baseUrl}/searchSubtitles`);
      const data = await res.json();
      test("GET /searchSubtitles returns empty array when no query or url provided", res.status === 200 && Array.isArray(data) && data.length === 0);
    }

    // Test 5: GET /searchSubtitles with private/loopback URL rejects with 400 INVALID_URL (SSRF protection)
    {
      const res = await fetch(`${baseUrl}/searchSubtitles?url=http://127.0.0.1:8080/internal`);
      const data = await res.json();
      test(
        "GET /searchSubtitles rejects SSRF loopback targets with 400 INVALID_URL",
        res.status === 400 && data.error === "INVALID_URL"
      );
    }
  } finally {
    server.close();
  }

  console.log("\n================================================================");
  if (failed === 0) {
    console.log(`ALL SUBTITLE ROUTER TESTS PASSED (${passed}/${passed})`);
    process.exit(0);
  } else {
    console.error(`SUBTITLE ROUTER TESTS FAILED: ${passed} passed, ${failed} failed`);
    process.exit(1);
  }
  console.log("================================================================\n");
}

runSubtitleRouterTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
