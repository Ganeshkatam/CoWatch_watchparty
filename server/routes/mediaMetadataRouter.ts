import express, { type Request, type Response, Router } from "express";
import config from "../config.ts";
import { searchYoutube as defaultSearchYoutube, youtubePlaylist as defaultYoutubePlaylist } from "../utils/youtube.ts";
import { redisCount as defaultRedisCount } from "../utils/redis.ts";
import { validateUserToken as defaultValidateUserToken } from "../utils/supabase.ts";
import { postgres as defaultPostgres, upsertObject as defaultUpsertObject } from "../utils/postgres.ts";

export function extractBearerToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    return token || undefined;
  }
  return undefined;
}

export interface MediaMetadataRouterOptions {
  searchYoutubeFn?: typeof defaultSearchYoutube;
  youtubePlaylistFn?: typeof defaultYoutubePlaylist;
  redisCountFn?: (prefix: string) => Promise<void> | void;
  validateUserTokenFn?: typeof defaultValidateUserToken;
  postgres?: typeof defaultPostgres | null;
  upsertObjectFn?: typeof defaultUpsertObject;
  configOverride?: Partial<typeof config>;
}

export function createMediaMetadataRouter(options?: MediaMetadataRouterOptions): Router {
  const router = express.Router();
  const searchYoutube = options?.searchYoutubeFn ?? defaultSearchYoutube;
  const youtubePlaylist = options?.youtubePlaylistFn ?? defaultYoutubePlaylist;
  const redisCount = options?.redisCountFn ?? defaultRedisCount;
  const validateUserToken = options?.validateUserTokenFn ?? defaultValidateUserToken;
  const db = options?.postgres !== undefined ? options.postgres : defaultPostgres;
  const upsertObject = options?.upsertObjectFn ?? defaultUpsertObject;
  const cfg = options?.configOverride ? { ...config, ...options.configOverride } : config;

  // ============================================================================
  // YOUTUBE SEARCH & PLAYLIST ENDPOINTS
  // ============================================================================

  router.get("/youtube", async (req: Request, res: Response) => {
    if (typeof req.query.q === "string") {
      try {
        redisCount("youtubeSearch");
        const pageToken = typeof req.query.pageToken === "string" ? req.query.pageToken : undefined;
        const result = await searchYoutube(req.query.q, pageToken);
        if (req.query.paginated === "1" || req.query.pageToken) {
          res.json({
            items: result.items,
            nextPageToken: result.nextPageToken,
          });
        } else {
          res.json(result.items);
        }
      } catch {
        res.status(500).json({ error: "youtube error" });
      }
    } else {
      res.status(500).json({ error: "query must be a string" });
    }
  });

  router.get("/youtubePlaylist/:playlistId", async (req: Request, res: Response) => {
    try {
      const items = await youtubePlaylist(req.params.playlistId);
      res.json(items);
    } catch {
      res.status(500).json({ error: "youtube error" });
    }
  });

  // ============================================================================
  // RUNTIME CLIENT METADATA & ACTIVE USER SIGNAL
  // ============================================================================

  router.get("/metadata", async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    let decoded: { uid: string; email?: string; email_verified?: boolean } | undefined;
    if (token) {
      const valResult = await validateUserToken("", token);
      if (valResult === "EMAIL_NOT_VERIFIED") {
        res.status(403).json({ error: { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required." } });
        return;
      }
      if (valResult) {
        decoded = valResult;
      }
    }

    const beta =
      decoded?.email != null &&
      Boolean(cfg.BETA_USER_EMAILS.split(",").includes(decoded?.email));
    const streamPath = beta ? cfg.STREAM_PATH : undefined;
    // Available to all authenticated users
    const convertPath = decoded ? cfg.CONVERT_PATH : undefined;

    // Log metrics but don't wait for it
    if (db && decoded?.uid) {
      upsertObject(
        db,
        "active_user",
        { uid: decoded?.uid, lastActiveTime: new Date() },
        { uid: true },
      ).catch((e: any) => {
        console.warn("[WARNING]: active_user upsert failed:", e.message);
      });
    }

    res.json({
      beta,
      streamPath,
      convertPath,
    });
  });

  return router;
}
