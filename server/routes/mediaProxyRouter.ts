import { Router, type Request, type Response } from "express";
import { redisCount as defaultRedisCount } from "../utils/redis.js";
import {
  validateExternalUrl as defaultValidateExternalUrl,
  safeExternalGet as defaultSafeExternalGet,
} from "../utils/ssrfValidator.js";

const SEGMENT_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ts: "application/octet-stream",
  m4s: "video/iso.segment",
  mp4: "video/mp4",
  cmfv: "video/iso.segment",
  cmfa: "audio/iso.segment",
  aac: "audio/aac",
  vtt: "text/vtt; charset=utf-8",
};

function rewriteHlsManifest(content: string, host: string): string {
  const addHost = (uri: string): string => {
    if (!uri || uri.startsWith("#") || /^(?:https?:|data:|blob:)/i.test(uri)) return uri;
    return uri + (uri.includes("?") ? "&" : "?") + "host=" + encodeURIComponent(host);
  };
  return content
    .replace(/URI="([^"]+)"/g, (_match, uri: string) => 'URI="' + addHost(uri) + '"')
    .replace(/^([^#\r\n][^\r\n]*)$/gm, (line) => addHost(line.trim()));
}

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
      const upstreamParams = new URLSearchParams(parsed.searchParams);
      upstreamParams.delete("host");
      const upstreamQuery = upstreamParams.toString();
      const targetUrl = "https://" + host + pathname + (upstreamQuery ? "?" + upstreamQuery : "");
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
        let repl = rewriteHlsManifest(resp.data.toString("utf-8"), host);
        // Mark this as a VOD
        repl += "#EXT-X-ENDLIST";
        res.send(repl);
      } else if (pathname.endsWith(".m3u8")) {
        // Stream
        const resp = await safeExternalGet(targetUrl, {
          timeoutMs: 8000,
          maxBytes: 2 * 1024 * 1024,
        });
        res.send(rewriteHlsManifest(resp.data.toString("utf-8"), host));
      } else {
        const extension = pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
        const contentType = extension ? SEGMENT_CONTENT_TYPES[extension] : undefined;
        if (!contentType) {
          res.status(404).end();
          return;
        }
        const resp = await safeExternalGet(targetUrl, {
          timeoutMs: 15000,
          maxBytes: extension === "vtt" ? 2 * 1024 * 1024 : 25 * 1024 * 1024,
        });
        res.writeHead(200, {
          "Content-Type": contentType,
          "Accept-Ranges": "bytes",
          "Content-Length": resp.data.length,
        });
        res.end(resp.data);
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
