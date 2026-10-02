import express, { type Request, type Response, Router } from "express";
import crypto from "node:crypto";
import { gzipSync } from "node:zlib";
import axios, { isAxiosError } from "axios";
import config from "../config.ts";
import { edgeRedis, redisCount } from "../utils/redis.ts";
import { validateExternalUrl, safeExternalGet } from "../utils/ssrfValidator.ts";

export function computeOpenSubtitlesHash(first: Buffer, last: Buffer, size: number): string {
  let temp = BigInt(size);
  processChunk(first);
  processChunk(last);

  temp = temp & BigInt("0xffffffffffffffff");
  return temp.toString(16).padStart(16, "0");

  function processChunk(chunk: Buffer) {
    for (let i = 0; i < chunk.length; i += 8) {
      const long = chunk.readBigUInt64LE(i);
      temp += long;
    }
  }
}

export interface SubtitleRouterOptions {
  redis?: typeof edgeRedis;
  counter?: typeof redisCount;
}

export function createSubtitleRouter(options?: SubtitleRouterOptions): Router {
  const router = express.Router();
  const redis = options?.redis ?? edgeRedis;
  const counter = options?.counter ?? redisCount;

  // Data's already compressed so caller should mount before or ensure raw buffer bypass
  router.get("/subtitle/:hash", async (req: Request, res: Response) => {
    const key = "subtitle:" + req.params.hash;
    const buf = await redis.execute("subtitle", "getBuffer", (c) => c.getBuffer(key));
    if (!buf) {
      res.status(404).end("not found");
      return;
    }
    await redis.execute("subtitle", "expire", (c) => c.expire(key, 24 * 60 * 60));
    res.setHeader("Content-Encoding", "gzip");
    res.end(buf);
  });

  router.post("/subtitle", async (req: Request, res: Response) => {
    const data = req.body;
    if (!redis.client) {
      return;
    }
    // calculate hash, gzip and save to redis
    const hash = crypto
      .createHash("sha256")
      .update(data, "utf8")
      .digest()
      .toString("hex");
    const gzipData = gzipSync(data);
    redis.execute("subtitle", "setex", (c) => c.setex("subtitle:" + hash, 24 * 60 * 60, gzipData));
    counter("subUploads");
    res.json({ hash });
  });

  router.get("/downloadSubtitles", async (req: Request, res: Response) => {
    // Request the URL from OS
    try {
      const urlResp = await axios<{ link: string }>({
        url: "https://api.opensubtitles.com/api/v1/download",
        method: "POST",
        headers: {
          "User-Agent": "cowatch v1",
          "Api-Key": config.OPENSUBTITLES_KEY,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        data: {
          file_id: req.query.file_id,
        },
      });
      counter("subDownloadsOS");
      if (!redis.client) {
        // Return the direct link to the user, will work for about 3 hours
        res.json(urlResp.data);
        return;
      }
      // Cache the contents in Redis (longer retention)
      const subResp = await axios.get(urlResp.data.link, {
        responseType: "arraybuffer",
      });
      const data = subResp.data;
      const hash = crypto
        .createHash("sha256")
        .update(data, "utf8")
        .digest()
        .toString("hex");
      const gzipData = gzipSync(data);
      redis.execute("subtitle", "setex", (c) => c.setex("subtitle:" + hash, 24 * 60 * 60, gzipData));
      res.json({ link: "/subtitle/" + hash });
    } catch (e) {
      if (isAxiosError(e)) {
        console.log(e.response);
      }
      throw e;
    }
  });

  router.get("/searchSubtitles", async (req: Request, res: Response) => {
    try {
      const title = req.query.title ? String(req.query.title) : "";
      const url = req.query.url ? String(req.query.url) : "";
      let subUrl = "";
      if (url) {
        const validation = await validateExternalUrl(url, ["https:", "http:"]);
        if (!validation.valid) {
          res.status(400).json({ error: "INVALID_URL", message: validation.reason || "Disallowed target URL" });
          return;
        }
        const startResp = await safeExternalGet(url, {
          headers: { Range: "bytes=0-65535" },
          maxBytes: 128 * 1024,
          timeoutMs: 5000,
          allowedProtocols: ["https:", "http:"],
        });
        const start = startResp.data;
        const contentRange = startResp.headers["content-range"] || "";
        const sizeMatch = contentRange.match(/\/(\d+)$/);
        const size = sizeMatch ? Number(sizeMatch[1]) : 0;
        let end: Buffer = Buffer.alloc(0);
        if (size > 65536) {
          const endResp = await safeExternalGet(url, {
            headers: { Range: `bytes=${size - 65536}-` },
            maxBytes: 128 * 1024,
            timeoutMs: 5000,
            allowedProtocols: ["https:", "http:"],
          });
          end = endResp.data;
        }
        const hash = computeOpenSubtitlesHash(start, end, size);
        subUrl = `https://api.opensubtitles.com/api/v1/subtitles?moviehash=${hash}&languages=en`;
      } else if (title) {
        subUrl = `https://api.opensubtitles.com/api/v1/subtitles?query=${encodeURIComponent(title)}&languages=en`;
      }
      if (!subUrl) {
        res.json([]);
        return;
      }
      const response = await axios.get(subUrl, {
        headers: {
          "User-Agent": "cowatch v1",
          "Api-Key": config.OPENSUBTITLES_KEY,
        },
        timeout: 5000,
      });
      const subtitles = response.data;
      res.json(subtitles?.data || []);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Subtitle search failed";
      console.error("searchSubtitles error:", message);
      res.json([]);
    }
    counter("subSearchesOS");
  });

  return router;
}
