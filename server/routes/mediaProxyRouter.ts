import { Router, type Request, type Response } from "express";
import { redisCount as defaultRedisCount } from "../utils/redis.js";
import {
  validateExternalUrl as defaultValidateExternalUrl,
  safeExternalGet as defaultSafeExternalGet,
} from "../utils/ssrfValidator.js";

export interface MediaProxyRouterOptions {
  validateExternalUrlFn?: typeof defaultValidateExternalUrl;
  safeExternalGetFn?: typeof defaultSafeExternalGet;
  redisCountFn?: (metric: string) => Promise<void> | void;
}

export function createMediaProxyRouter(options: MediaProxyRouterOptions = {}): Router {
  const router = Router();
  const validateExternalUrl = options.validateExternalUrlFn || defaultValidateExternalUrl;
  const safeExternalGet = options.safeExternalGetFn || defaultSafeExternalGet;
  const redisCount = options.redisCountFn || defaultRedisCount;

  // Proxy video segments
  router.get("/proxy/*splat", async (req: Request, res: Response) => {
    redisCount("proxyReqs");
    try {
      const parsed = new URL("http://localhost" + req.url);
      const pathname = parsed.pathname.slice("/proxy".length);
      const host = parsed.searchParams.get("host");
      if (!host) {
        res.status(400).send("Missing host parameter");
        return;
      }
      const targetUrl = "https://" + host + pathname;
      const validation = await validateExternalUrl(targetUrl, ["https:"]);
      if (!validation.valid) {
        res.status(403).send(`Forbidden proxy target: ${validation.reason || "Disallowed host"}`);
        return;
      }

      if (pathname.endsWith("index-dvr.m3u8")) {
        // VOD
        const resp = await safeExternalGet(targetUrl, {
          timeoutMs: 8000,
          maxBytes: 2 * 1024 * 1024,
        });
        const re2 = /(.*\.ts)/g;
        let repl = resp.data.toString("utf-8").replaceAll(re2, `$1?host=${encodeURIComponent(host)}`);
        // Mark this as a VOD
        repl += "#EXT-X-ENDLIST";
        res.send(repl);
      } else if (pathname.endsWith(".m3u8")) {
        // Stream
        const resp = await safeExternalGet(targetUrl, {
          timeoutMs: 8000,
          maxBytes: 2 * 1024 * 1024,
        });
        const repl = resp.data.toString("utf-8");
        res.send(repl);
      } else if (pathname.endsWith(".ts")) {
        // Segment
        const resp = await safeExternalGet(targetUrl, {
          timeoutMs: 15000,
          maxBytes: 25 * 1024 * 1024,
        });
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Accept-Ranges": "bytes",
          "Content-Length": resp.data.length,
          "Transfer-Encoding": "chunked",
        });
        res.write(resp.data);
        res.end();
      } else {
        res.status(404).end();
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Proxy request failed";
      console.log("proxy failed: %s - %s", req.url, message);
      if (!res.headersSent) {
        res.status(502).send("Bad Gateway");
      }
    }
  });

  return router;
}
