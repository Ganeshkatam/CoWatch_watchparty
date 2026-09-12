import config from "./config.ts"; // force reload
import fs from "node:fs";
import express, { type Response } from "express";
import bodyParser from "body-parser";
import compression from "compression";
import cors from "cors";
import https from "node:https";
import http from "node:http";
import { Server } from "socket.io";
import { searchYoutube, youtubePlaylist } from "./utils/youtube.ts";
import { Room } from "./room.ts";
import { redis, redisCount, redisCache, RedisMetrics } from "./utils/redis.ts";
import { deleteUser, validateUserToken, supabaseAdmin } from "./utils/supabase.ts";
import { getStartOfDay } from "./utils/time.ts";
import { getSessionLimitSeconds } from "./vm/utils.ts";
import { postgres, upsertObject } from "./utils/postgres.ts";
import axios, { isAxiosError } from "axios";
import crypto from "node:crypto";
import { gzipSync } from "node:zlib";
import { resolveShard } from "./utils/resolveShard.ts";
import { makeRoomName, makeUserName } from "./utils/moniker.ts";
import { getStats } from "./utils/getStats.ts";
import {
  hashRoomPasscode,
  verifyRoomPasscode,
  isBcryptHash,
  encryptPasscodeForOwner,
  decryptPasscodeForOwner,
  computePasscodeFingerprint,
} from "./utils/roomPasscode.ts";
import {
  checkPasscodeRateLimits,
  recordPasscodeFailure,
  resetPasscodeLimits,
} from "./utils/rateLimit.ts";
import {
  checkFeedbackRateLimit,
  recordFeedbackAttempt,
} from "./utils/feedbackRateLimit.ts";
import { feedbackTelemetry } from "./utils/feedbackTelemetry.ts";
import { getVBrowserProvider } from "./vm/provider.ts";
import { sanitizeRoomId } from "./strip_slashes.ts";
import { isAllowedEmailDomain } from "./utils/emailDomain.ts";
import { bootstrapProviderRegistry } from "./vm/provider-bootstrap.ts";

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception in server process:", err);
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled promise rejection at:", promise, "reason:", reason);
});

// Populate provider registry from VM_MANAGER_CONFIG before any allocation can occur.
bootstrapProviderRegistry();

if (process.env.NODE_ENV === "development") {
  axios.interceptors.request.use(
    (config) => {
      // console.log(config);
      return config;
    },
    (error) => {
      console.error(error);
    },
  );
}

const releaseInterval = 5 * 60 * 1000;
const app = express();
let server = null as https.Server | http.Server | null;
if (config.SSL_KEY_FILE && config.SSL_CRT_FILE) {
  const key = fs.readFileSync(config.SSL_KEY_FILE);
  const cert = fs.readFileSync(config.SSL_CRT_FILE);
  server = https.createServer({ key: key, cert: cert }, app);
} else {
  server = new http.Server(app);
}
const listenPort = Number(process.env.PORT || config.PORT || 8080);
const listenHost = config.HOST || "0.0.0.0";
server?.listen(listenPort, listenHost, () => {
  console.log(`Server listening on ${listenHost}:${listenPort}`);
});
server?.on("error", (err: any) => {
  console.error("Server listen error:", err);
});

const io = new Server(server, { cors: {}, transports: ["websocket"] });
io.engine.use(async (req: any, res: Response, next: () => void) => {
  const rawRoomId = req._query.roomId;
  if (!rawRoomId) {
    return next();
  }
  const roomId = sanitizeRoomId(rawRoomId);
  req._query.roomId = roomId;
  // Attempt to ensure the room being connected to is loaded in memory
  // If it doesn't exist, we may fail later with "invalid namespace"
  const shard = resolveShard(roomId);
  const key = roomId;
  // Check to make sure this shard should load this room
  const isCorrectShard = !config.SHARD || shard === Number(config.SHARD);
  // Get the room data from postgres
  const persistedRoom = (
    await postgres?.query<PersistentRoom>(
      `SELECT * from rooms where "roomId" = $1`,
      [key],
    )
  )?.rows?.[0];
  // Don't await after this because we may have a race condition where 2 rquests both try to load the room
  if (isCorrectShard && !rooms.has(key)) {
    if (persistedRoom) {
      const data = persistedRoom.data
        ? JSON.stringify(persistedRoom.data)
        : undefined;
      const room = new Room(io, key, data);
      room.status = persistedRoom.status || 'active';
      room.expiresAt = persistedRoom.expiresAt ? new Date(persistedRoom.expiresAt as string) : undefined;
      room.owner_id = persistedRoom.owner_id;
      room.isPermanent = persistedRoom.isPermanent || false;
      room.participantsLocked = Boolean(persistedRoom.participants_locked);
      rooms.set(key, room);
      console.log(
        "loading room %s into memory on shard %s",
        roomId,
        config.SHARD,
      );
    }
  }
  next();
});

const rooms = new Map<string, Room>();
// Following functions iterate over in-memory rooms
setInterval(minuteMetrics, 60 * 1000);
setInterval(release, releaseInterval);
setInterval(saveRooms, 1000);
setInterval(expireRooms, 60 * 1000);
if (process.env.NODE_ENV === "development") {
  try {
    import("./vmWorker.ts");
    // import('./syncSubs.ts');
    // import('./timeSeries.ts');
  } catch (e) {
    console.error(e);
  }
}

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.raw({ type: "text/plain", limit: 1000000 }));

app.get("/ping", (_req, res) => {
  res.json("pong");
});

// Data's already compressed so go before the compression middleware
app.get("/subtitle/:hash", async (req, res) => {
  const key = "subtitle:" + req.params.hash;
  const buf = await redis?.getBuffer(key);
  if (!buf) {
    res.status(404).end("not found");
    return;
  }
  await redis?.expire(key, 24 * 60 * 60);
  res.setHeader("Content-Encoding", "gzip");
  res.end(buf);
});

app.use(compression());

app.post("/subtitle", async (req, res) => {
  const data = req.body;
  if (!redis) {
    return;
  }
  // calculate hash, gzip and save to redis
  const hash = crypto
    .createHash("sha256")
    .update(data, "utf8")
    .digest()
    .toString("hex");
  let gzipData = gzipSync(data);
  await redis.setex("subtitle:" + hash, 24 * 60 * 60, gzipData);
  redisCount("subUploads");
  res.json({ hash });
});

app.get("/downloadSubtitles", async (req, res) => {
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
        // 'Authorization': 'Bearer ' + config.OPENSUBTITLES_KEY,
      },
      data: {
        file_id: req.query.file_id,
        // sub_format: 'srt',
      },
    });
    redisCount("subDownloadsOS");
    if (!redis) {
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
    let gzipData = gzipSync(data);
    await redis.setex("subtitle:" + hash, 24 * 60 * 60, gzipData);
    res.json({ link: "/subtitle/" + hash });
  } catch (e) {
    if (isAxiosError(e)) {
      console.log(e.response);
    }
    throw e;
  }
});

app.get("/searchSubtitles", async (req, res) => {
  try {
    const title = req.query.title ? String(req.query.title) : "";
    const url = req.query.url ? String(req.query.url) : "";
    let subUrl = "";
    if (url) {
      const startResp = await axios({
        method: "get",
        url: url,
        headers: {
          Range: "bytes=0-65535",
        },
        responseType: "arraybuffer",
      });
      const start = startResp.data;
      const size = Number(startResp.headers["content-range"].split("/")[1]);
      const endResp = await axios({
        method: "get",
        url: url,
        headers: {
          Range: `bytes=${size - 65536}-`,
        },
        responseType: "arraybuffer",
      });
      const end = endResp.data;
      // console.log(start, end, size);
      let hash = computeOpenSubtitlesHash(start, end, size);
      // hash = 'f65334e75574f00f';
      // Search API for subtitles by hash
      subUrl = `https://api.opensubtitles.com/api/v1/subtitles?moviehash=${hash}&languages=en`;
    } else if (title) {
      subUrl = `https://api.opensubtitles.com/api/v1/subtitles?query=${title}&languages=en`;
    }
    // Alternative, web client calls this to get back some JS with the download URL embedded
    // https://www.opensubtitles.com/nocache/download/7585196/subreq.js?file_name=Borgen.S04E01.en&locale=en&np=true&sub_frmt=srt&subtitle_id=6615808&ext_installed=false
    // Up to 10 downloads per IP per day, but proxyable and doesn't require key
    const response = await axios.get(subUrl, {
      headers: {
        "User-Agent": "cowatch v1",
        "Api-Key": config.OPENSUBTITLES_KEY,
      },
    });
    // console.log(subUrl, response.data);
    const subtitles = response.data;
    res.json(subtitles.data);
  } catch (e: any) {
    console.error(e.message);
    res.json([]);
  }
  redisCount("subSearchesOS");
});

app.get("/stats", async (req, res) => {
  if (req.query.key && req.query.key === config.STATS_KEY) {
    const stats = await getStats();
    res.json(stats);
  } else {
    res.status(403).json({ error: "Access Denied" });
  }
});

app.get("/stats/redis", (req, res) => {
  if (config.STATS_KEY && req.headers["x-stats-key"] !== config.STATS_KEY && req.query.key !== config.STATS_KEY) {
    res.status(403).json({ error: "Access Denied" });
    return;
  }
  res.json(RedisMetrics.getSnapshot());
});

app.post("/api/auth/validate-email", async (req, res) => {
  const email = req.body?.email;
  if (!email || typeof email !== "string") {
    res.status(400).json({ error: "Email is required" });
    return;
  }
  const isAllowed = isAllowedEmailDomain(email);
  if (!isAllowed) {
    res.status(400).json({ error: "Email provider is not supported." });
    return;
  }
  res.json({ valid: true });
});

app.post("/api/account/delete", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or invalid Authorization header" });
      return;
    }
    const token = authHeader.split(" ")[1];

    // Authenticate and get uid
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }
    const uid = user.id;

    // Clean up Storage (avatars bucket)
    const { data: existingFiles, error: listError } = await supabaseAdmin.storage.from("avatars").list(uid);
    if (listError) {
      console.error("Storage list error during account deletion:", listError);
      res.status(500).json({ error: "Failed to list avatars" });
      return;
    }

    if (existingFiles && existingFiles.length > 0) {
      const filesToRemove = existingFiles.map((f: any) => `${uid}/${f.name}`);
      const { error: removeError } = await supabaseAdmin.storage.from("avatars").remove(filesToRemove);
      if (removeError) {
        console.error("Storage remove error during account deletion:", removeError);
        res.status(500).json({ error: "Failed to delete avatars" });
        return;
      }
    }

    // Delete Auth User (Postgres handles cascades automatically)
    const { error: deleteError } = await deleteUser(uid);
    if (deleteError) {
      console.error("Auth delete error during account deletion:", deleteError);
      res.status(500).json({ error: "Failed to delete auth user" });
      return;
    }

    res.status(204).send();
  } catch (e: any) {
    console.error("Error during account deletion:", e);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/feedback", async (req, res) => {
  const startTime = Date.now();
  feedbackTelemetry.recordSubmissionAttempt();

  try {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || req.socket.remoteAddress || "unknown";

    // 1. Strict Payload & Schema Guard: Reject malformed JSON, non-objects, or arrays
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      feedbackTelemetry.recordValidationFailure();
      res.status(400).json({ error: "Invalid request payload format" });
      return;
    }

    // 2. Reject unexpected / forbidden / internal fields before processing
    const allowedKeys = new Set(["type", "rating", "message", "context", "app_version", "platform", "idempotency_key"]);
    const bodyKeys = Object.keys(req.body);
    const hasForbiddenKeys = bodyKeys.some((k) => !allowedKeys.has(k));
    if (hasForbiddenKeys) {
      feedbackTelemetry.recordValidationFailure();
      res.status(400).json({ error: "Payload contains unrecognized or forbidden fields" });
      return;
    }

    // 3. Zero-Trust Identity: Strictly derive from verified server session, NEVER from client body or header
    let userId: string | null = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      try {
        const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
        if (!error && user?.id) {
          userId = user.id;
        }
      } catch (authErr) {
        userId = null;
      }
    }

    // 4. Rate limiting check (In-memory sliding window, 0 Redis commands)
    const rateLimit = checkFeedbackRateLimit(ip, userId);
    if (!rateLimit.allowed) {
      feedbackTelemetry.recordRateLimitDrop();
      res.status(429).json({
        error: "Too many feedback submissions. Please try again later.",
        retryAfter: rateLimit.retryAfterSeconds,
      });
      return;
    }

    // 5. Input Validation & Strict Enums
    const {
      type: rawType,
      context: rawContext,
      rating: rawRating,
      message: rawMessage,
      app_version: rawAppVersion,
      platform: rawPlatform,
      idempotency_key: rawIdempotencyKey,
    } = req.body;

    const allowedTypes = ["bug", "suggestion", "problem", "experience"];
    const allowedContexts = [
      "room",
      "playback",
      "host",
      "participants",
      "chat",
      "video",
      "virtual-browser",
      "connection",
    ];

    if (!rawType || typeof rawType !== "string" || !allowedTypes.includes(rawType)) {
      feedbackTelemetry.recordValidationFailure();
      res.status(400).json({ error: "Invalid feedback type" });
      return;
    }

    if (!rawMessage || typeof rawMessage !== "string") {
      feedbackTelemetry.recordValidationFailure();
      res.status(400).json({ error: "Feedback message is required" });
      return;
    }

    // Unicode normalization (NFC) & whitespace trim
    const normalizedMessage = rawMessage.normalize("NFC").trim();
    if (!normalizedMessage) {
      feedbackTelemetry.recordValidationFailure();
      res.status(400).json({ error: "Feedback message cannot be empty or whitespace only" });
      return;
    }

    if (normalizedMessage.length > 2000) {
      feedbackTelemetry.recordValidationFailure();
      res.status(400).json({ error: "Feedback message must not exceed 2000 characters" });
      return;
    }

    const context = rawContext && typeof rawContext === "string" && allowedContexts.includes(rawContext)
      ? rawContext
      : "room";

    let rating: number | null = null;
    if (rawRating !== undefined && rawRating !== null) {
      if (typeof rawRating !== "number" || !Number.isInteger(rawRating) || rawRating < 1 || rawRating > 5) {
        feedbackTelemetry.recordValidationFailure();
        res.status(400).json({ error: "Rating must be an integer between 1 and 5" });
        return;
      }
      rating = rawRating;
    }

    const appVersion = typeof rawAppVersion === "string" ? rawAppVersion.slice(0, 50) : "1.0.3";
    const platform = typeof rawPlatform === "string" ? rawPlatform.slice(0, 50) : "web";
    const idempotencyKey = typeof rawIdempotencyKey === "string" && rawIdempotencyKey.trim().length > 0
      ? rawIdempotencyKey.trim().slice(0, 100)
      : (typeof req.headers["x-idempotency-key"] === "string" ? (req.headers["x-idempotency-key"] as string).slice(0, 100) : null);

    // 6. Privacy & Redaction Barrier: Strip sensitive credentials, JWTs, keys, and connection URIs
    const sanitizedMessage = normalizedMessage
      .replace(/\bBearer\s+[A-Za-z0-9-_=.]+\b/gi, "[TOKEN_REDACTED]")
      .replace(/\b(sk_[a-zA-Z0-9_-]{20,}|sbp_[a-zA-Z0-9_-]{20,}|eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,})\b/g, "[TOKEN_REDACTED]")
      .replace(/\b(redis|postgres|postgresql|mongodb):\/\/[^\s]+/gi, "[URI_REDACTED]")
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "[SCRIPT_REMOVED]");

    if (!postgres) {
      feedbackTelemetry.recordDbFailure();
      res.status(503).json({ error: "Database service unavailable" });
      return;
    }

    // 7. Idempotency Check: Short-circuit if identical idempotency key already persisted
    if (idempotencyKey) {
      try {
        const existingResult = await postgres.query(
          `SELECT id, created_at FROM public.feedback WHERE idempotency_key = $1`,
          [idempotencyKey]
        );
        if (existingResult.rows.length > 0) {
          const existing = existingResult.rows[0];
          feedbackTelemetry.recordSubmissionSuccess(true, Date.now() - startTime);
          res.status(200).json({
            success: true,
            id: existing.id,
            created_at: existing.created_at,
            deduped: true,
          });
          return;
        }
      } catch (checkErr) {
        console.warn("Idempotency check query failed, proceeding to insert:", checkErr);
      }
    }

    // 8. Direct PostgreSQL insert with authoritative default status = 'new'
    let insertResult;
    try {
      insertResult = await postgres.query(
        `INSERT INTO public.feedback (user_id, type, rating, message, context, app_version, platform, status, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'new', $8)
         ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
         RETURNING id, created_at`,
        [userId, rawType, rating, sanitizedMessage, context, appVersion, platform, idempotencyKey]
      );
    } catch (dbErr) {
      console.error("Feedback database insert error:", dbErr);
      feedbackTelemetry.recordDbFailure();
      res.status(503).json({ error: "Database service unavailable" });
      return;
    }

    recordFeedbackAttempt(ip, userId);

    let inserted = insertResult.rows[0];
    let isDeduped = false;

    // In case of concurrent race on same idempotency key
    if (!inserted && idempotencyKey) {
      const fallbackResult = await postgres.query(
        `SELECT id, created_at FROM public.feedback WHERE idempotency_key = $1`,
        [idempotencyKey]
      );
      inserted = fallbackResult.rows[0];
      isDeduped = true;
    }

    if (!inserted) {
      feedbackTelemetry.recordDbFailure();
      res.status(500).json({ error: "Failed to persist feedback" });
      return;
    }

    feedbackTelemetry.recordSubmissionSuccess(isDeduped, Date.now() - startTime);

    res.status(200).json({
      success: true,
      id: inserted.id,
      created_at: inserted.created_at,
      ...(isDeduped ? { deduped: true } : {}),
    });
  } catch (err: any) {
    console.error("Feedback submission error:", err);
    feedbackTelemetry.recordDbFailure();
    res.status(500).json({ error: "Failed to submit feedback" });
  }
});

// ============================================================================
// FEEDBACK-003: Internal Operations, Review Boundary & Signal Aggregation
// ============================================================================

async function authenticateOperator(req: any): Promise<{ authorized: boolean; operatorId?: string }> {
  const operatorKey = req.headers["x-operator-key"] || req.headers["x-stats-key"] || req.query.key;
  if (config.STATS_KEY && operatorKey === config.STATS_KEY) {
    return { authorized: true, operatorId: "system-operator" };
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    try {
      const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
      if (!error && user) {
        const isAdmin = user.app_metadata?.role === "admin" || user.user_metadata?.is_admin === true;
        if (isAdmin) {
          return { authorized: true, operatorId: user.id };
        }
      }
    } catch {
      // ignore
    }
  }

  return { authorized: false };
}

// 1. Operational List Query (Paginated, Filtered, Operator-Only)
app.get("/api/admin/feedback", async (req, res) => {
  try {
    const auth = await authenticateOperator(req);
    if (!auth.authorized) {
      res.status(403).json({ error: "Unauthorized operator access" });
      return;
    }

    if (!postgres) {
      res.status(503).json({ error: "Database unavailable" });
      return;
    }

    const rawPage = Number(req.query.page) || 1;
    const rawLimit = Number(req.query.limit) || 20;

    const page = Math.max(1, Number.isInteger(rawPage) ? rawPage : 1);
    const limit = Math.min(50, Math.max(1, Number.isInteger(rawLimit) ? rawLimit : 20));
    const offset = (page - 1) * limit;

    const rawStatus = req.query.status as string | undefined;
    const rawType = req.query.type as string | undefined;
    const rawContext = req.query.context as string | undefined;
    const rawRating = req.query.rating ? Number(req.query.rating) : null;

    const allowedStatuses = ["new", "reviewed", "actioned", "dismissed"];
    const allowedTypes = ["bug", "suggestion", "problem", "experience"];
    const allowedContexts = ["room", "playback", "host", "participants", "chat", "video", "virtual-browser", "connection"];

    if (rawStatus && !allowedStatuses.includes(rawStatus)) {
      res.status(400).json({ error: "Invalid status filter" });
      return;
    }
    if (rawType && !allowedTypes.includes(rawType)) {
      res.status(400).json({ error: "Invalid type filter" });
      return;
    }
    if (rawContext && !allowedContexts.includes(rawContext)) {
      res.status(400).json({ error: "Invalid context filter" });
      return;
    }
    if (rawRating !== null && (!Number.isInteger(rawRating) || rawRating < 1 || rawRating > 5)) {
      res.status(400).json({ error: "Invalid rating filter" });
      return;
    }

    const filterStatus = rawStatus || null;
    const filterType = rawType || null;
    const filterContext = rawContext || null;
    const filterRating = rawRating;

    // Total Count
    const countResult = await postgres.query(
      `SELECT COUNT(*)::int as total
       FROM public.feedback
       WHERE ($1::text IS NULL OR status = $1)
         AND ($2::text IS NULL OR type = $2)
         AND ($3::text IS NULL OR context = $3)
         AND ($4::int IS NULL OR rating = $4)`,
      [filterStatus, filterType, filterContext, filterRating]
    );
    const total = countResult.rows[0]?.total || 0;
    const totalPages = Math.ceil(total / limit);

    // Items
    const itemsResult = await postgres.query(
      `SELECT id, user_id, type, rating, message, context, app_version, platform, status,
              reviewer_id, review_notes, reviewed_at, created_at, updated_at
       FROM public.feedback
       WHERE ($1::text IS NULL OR status = $1)
         AND ($2::text IS NULL OR type = $2)
         AND ($3::text IS NULL OR context = $3)
         AND ($4::int IS NULL OR rating = $4)
       ORDER BY created_at DESC
       LIMIT $5 OFFSET $6`,
      [filterStatus, filterType, filterContext, filterRating, limit, offset]
    );

    res.json({
      items: itemsResult.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  } catch (e: any) {
    console.error("Admin feedback list error:", e);
    res.status(500).json({ error: "Failed to retrieve feedback list" });
  }
});

// 2. Concurrency-Safe Review Transition Endpoint
app.patch("/api/admin/feedback/:id/status", async (req, res) => {
  try {
    const auth = await authenticateOperator(req);
    if (!auth.authorized) {
      res.status(403).json({ error: "Unauthorized operator access" });
      return;
    }

    if (!postgres) {
      res.status(503).json({ error: "Database unavailable" });
      return;
    }

    const { id } = req.params;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!id || !uuidRegex.test(id)) {
      res.status(400).json({ error: "Invalid feedback ID format" });
      return;
    }

    const { status: targetStatus, review_notes: rawNotes, expected_status: expectedStatus } = req.body || {};
    const allowedStatuses = ["new", "reviewed", "actioned", "dismissed"];
    if (!targetStatus || !allowedStatuses.includes(targetStatus)) {
      res.status(400).json({ error: "Invalid target status" });
      return;
    }

    // Retrieve current record state
    const currentResult = await postgres.query(
      `SELECT id, status FROM public.feedback WHERE id = $1`,
      [id]
    );
    if (currentResult.rows.length === 0) {
      res.status(404).json({ error: "Feedback record not found" });
      return;
    }

    const currentStatus = currentResult.rows[0].status;

    // Check optimistic lock if expected_status specified
    if (expectedStatus && expectedStatus !== currentStatus) {
      feedbackTelemetry.recordReviewUpdate(true);
      res.status(409).json({
        error: "Feedback status conflict",
        currentStatus,
        expectedStatus,
      });
      return;
    }

    // Valid State Transitions Map:
    // new -> reviewed, dismissed
    // reviewed -> actioned, dismissed, new
    // actioned -> reviewed, dismissed
    // dismissed -> reviewed
    const allowedTransitions: Record<string, string[]> = {
      new: ["reviewed", "dismissed"],
      reviewed: ["actioned", "dismissed", "new"],
      actioned: ["reviewed", "dismissed"],
      dismissed: ["reviewed"],
    };

    if (currentStatus === targetStatus) {
      res.status(400).json({ error: `Record is already in '${targetStatus}' status` });
      return;
    }

    const validNextStates = allowedTransitions[currentStatus] || [];
    if (!validNextStates.includes(targetStatus)) {
      res.status(400).json({
        error: `Invalid status transition from '${currentStatus}' to '${targetStatus}'`,
        allowedTransitions: validNextStates,
      });
      return;
    }

    const reviewNotes = typeof rawNotes === "string" ? rawNotes.trim().slice(0, 1000) : null;
    const reviewerId = auth.operatorId && uuidRegex.test(auth.operatorId) ? auth.operatorId : null;

    // Atomic conditional update
    const updateResult = await postgres.query(
      `UPDATE public.feedback
       SET status = $1,
           reviewer_id = $2,
           review_notes = $3,
           reviewed_at = now(),
           updated_at = now()
       WHERE id = $4 AND status = $5
       RETURNING id, user_id, type, rating, message, context, status, reviewer_id, review_notes, reviewed_at, updated_at`,
      [targetStatus, reviewerId, reviewNotes, id, currentStatus]
    );

    if (updateResult.rows.length === 0) {
      feedbackTelemetry.recordReviewUpdate(true);
      res.status(409).json({ error: "Concurrent update conflict. Please refresh and retry." });
      return;
    }

    feedbackTelemetry.recordReviewUpdate(false);

    res.json({
      success: true,
      feedback: updateResult.rows[0],
    });
  } catch (e: any) {
    console.error("Admin feedback status update error:", e);
    res.status(500).json({ error: "Failed to update feedback status" });
  }
});

// 3. Operational Product Signals & Metrics Aggregation Endpoint
app.get("/api/admin/feedback/metrics", async (req, res) => {
  try {
    const auth = await authenticateOperator(req);
    if (!auth.authorized) {
      res.status(403).json({ error: "Unauthorized operator access" });
      return;
    }

    if (!postgres) {
      res.status(503).json({ error: "Database unavailable" });
      return;
    }

    const metricsResult = await postgres.query(`
      SELECT 
        COUNT(*)::int as total,
        COUNT(CASE WHEN status = 'new' THEN 1 END)::int as count_new,
        COUNT(CASE WHEN status = 'reviewed' THEN 1 END)::int as count_reviewed,
        COUNT(CASE WHEN status = 'actioned' THEN 1 END)::int as count_actioned,
        COUNT(CASE WHEN status = 'dismissed' THEN 1 END)::int as count_dismissed,
        ROUND(AVG(rating)::numeric, 2) as avg_rating,
        COUNT(CASE WHEN rating IS NOT NULL THEN 1 END)::int as rated_count
      FROM public.feedback
    `);

    const typeResult = await postgres.query(`
      SELECT type, COUNT(*)::int as count
      FROM public.feedback
      GROUP BY type
      ORDER BY count DESC
    `);

    const contextResult = await postgres.query(`
      SELECT context, COUNT(*)::int as count
      FROM public.feedback
      GROUP BY context
      ORDER BY count DESC
    `);

    const ratingResult = await postgres.query(`
      SELECT rating, COUNT(*)::int as count
      FROM public.feedback
      WHERE rating IS NOT NULL
      GROUP BY rating
      ORDER BY rating ASC
    `);

    const base = metricsResult.rows[0] || {};
    const byType: Record<string, number> = {};
    for (const r of typeResult.rows) byType[r.type] = r.count;

    const byContext: Record<string, number> = {};
    for (const r of contextResult.rows) byContext[r.context] = r.count;

    const byRating: Record<number, number> = {};
    for (const r of ratingResult.rows) byRating[r.rating] = r.count;

    res.json({
      summary: {
        total: base.total || 0,
        countNew: base.count_new || 0,
        countReviewed: base.count_reviewed || 0,
        countActioned: base.count_actioned || 0,
        countDismissed: base.count_dismissed || 0,
        avgRating: base.avg_rating ? parseFloat(base.avg_rating) : null,
        ratedCount: base.rated_count || 0,
      },
      breakdowns: {
        byType,
        byContext,
        byRating,
      },
      telemetry: feedbackTelemetry.getMetrics(),
    });
  } catch (e: any) {
    console.error("Admin feedback metrics error:", e);
    res.status(500).json({ error: "Failed to calculate feedback metrics" });
  }
});

app.get("/health/:metric", async (req, res) => {
  const vmManagerStats = (
    await axios.get("http://localhost:" + config.VMWORKER_PORT + "/stats")
  ).data;
  const result = vmManagerStats[req.params.metric]?.availableVBrowsers?.length;
  res.status(result ? 200 : 500).json(result);
});

app.get("/timeSeries", async (req, res) => {
  if (req.query.key && req.query.key === config.STATS_KEY && redis) {
    const timeSeriesData = await redis.lrange("timeSeries", 0, -1);
    const timeSeries = timeSeriesData.map((entry) => JSON.parse(entry));
    res.json(timeSeries);
  } else {
    res.status(403).json({ error: "Access Denied" });
  }
});

app.get("/youtube", async (req, res) => {
  if (typeof req.query.q === "string") {
    try {
      redisCount("youtubeSearch");
      const items = await searchYoutube(req.query.q);
      res.json(items);
    } catch {
      res.status(500).json({ error: "youtube error" });
    }
  } else {
    res.status(500).json({ error: "query must be a string" });
  }
});

app.get("/youtubePlaylist/:playlistId", async (req, res) => {
  try {
    const items = await youtubePlaylist(req.params.playlistId);
    res.json(items);
  } catch {
    res.status(500).json({ error: "youtube error" });
  }
});

app.post("/checkPasscodeAvailability", async (req, res) => {
  const passcode = req.body?.passcode;
  if (typeof passcode !== "string" || passcode.length !== 8) {
    res.status(400).json({
      available: false,
      error: "Passcode must be strictly 8 characters long.",
    });
    return;
  }

  if (!postgres) {
    res.json({ available: true });
    return;
  }

  try {
    const fingerprint = computePasscodeFingerprint(passcode);
    const existing = await postgres.query(
      `SELECT "roomId" FROM rooms WHERE passcode_fingerprint = $1 LIMIT 1`,
      [fingerprint]
    );
    res.json({ available: existing.rows.length === 0 });
  } catch (err: any) {
    console.error("checkPasscodeAvailability error:", err);
    res.status(500).json({ error: "Failed to verify passcode availability." });
  }
});

app.post("/createRoom", async (req, res) => {
  // Authentication is required to create a room
  if (!req.body?.token || !req.body?.uid) {
    res.status(401).json({ error: "Authentication is required to create a room." });
    return;
  }
  const decoded = await validateUserToken(req.body.uid, req.body.token);
  if (!decoded) {
    res.status(401).json({ error: "Invalid authentication token." });
    return;
  }
  if (decoded === "EMAIL_NOT_VERIFIED") {
    res.status(403).json({ error: { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required." } });
    return;
  }

  const roomTitle =
    typeof req.body.roomTitle === "string"
      ? req.body.roomTitle.trim()
      : "";

  if (roomTitle.length === 0) {
    res.status(400).json({
      error: "Room title is required.",
    });
    return;
  }
  if (roomTitle.length > 50) {
    res.status(400).json({
      error: "Room title is too long (max 50 characters).",
    });
    return;
  }

  const rawPasscode = req.body?.passcode;
  if (typeof rawPasscode !== "string" || rawPasscode.length !== 8) {
    res.status(400).json({
      error: "Passcode is required and must be strictly 8 characters long.",
    });
    return;
  }

  // MEMBER-001 Invariant: Capacity range validation (2 - 10, default 10 platform ceiling)
  let maxParticipants = 10;
  if (req.body?.maxParticipants !== undefined && req.body?.maxParticipants !== null) {
    const parsedCapacity = Number(req.body.maxParticipants);
    if (!Number.isInteger(parsedCapacity) || parsedCapacity < 2 || parsedCapacity > 10) {
      res.status(400).json({
        error: "Participant capacity must be an integer between 2 and 10.",
      });
      return;
    }
    maxParticipants = parsedCapacity;
  }

  const passcodeFingerprint = computePasscodeFingerprint(rawPasscode);

  if (postgres) {
    const duplicateCheck = await postgres.query(
      `SELECT "roomId" FROM rooms WHERE passcode_fingerprint = $1 LIMIT 1`,
      [passcodeFingerprint]
    );
    if (duplicateCheck.rows.length > 0) {
      res.status(409).json({
        error: "This passcode is already taken. Each room passcode must be unique.",
      });
      return;
    }
  }

  const genName = () => makeRoomName(config.SHARD);
  let name = sanitizeRoomId(genName());
  console.log("createRoom: ", name, "by user:", decoded.email);

  const isPermanent = Boolean(req.body?.isPermanent);
  const roomKind = isPermanent ? "permanent" : "watch";
  const now = new Date();
  const expiresAt = isPermanent ? null : new Date(now.getTime() + 3 * 60 * 60 * 1000); // 3 hours from now

  if (postgres) {
    try {
      const passcodeHash = await hashRoomPasscode(rawPasscode);
      const ownerPasscodeEncrypted = encryptPasscodeForOwner(rawPasscode);

      await postgres.query(
        `SELECT public.create_room_authoritative(
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
        ) AS result`,
        [
          decoded.uid,
          name,
          roomKind,
          roomTitle,
          req.body?.roomDescription || null,
          passcodeHash,
          ownerPasscodeEncrypted,
          passcodeFingerprint,
          typeof req.body?.coverPhoto === "string" ? req.body.coverPhoto : null,
          Boolean(req.body?.isChatDisabled),
          expiresAt,
          config.FREE_ROOM_LIMIT || 5, // max total
          5,                          // max watch
          2,                          // max permanent
          maxParticipants,            // max participants
        ]
      );
    } catch (e: any) {
      redisCount("createRoomError");
      const errMsg = e?.message || "";
      if (errMsg.includes("INVALID_PARTICIPANT_CAPACITY")) {
        res.status(400).json({
          error: "Participant capacity must be an integer between 2 and 100.",
        });
        return;
      }
      if (errMsg.includes("TOTAL_ROOM_LIMIT_EXCEEDED")) {
        res.status(409).json({
          error: {
            code: "TOTAL_ROOM_LIMIT_EXCEEDED",
            message: "You have reached your room limit. Delete an existing room to create a new one.",
          },
        });
        return;
      }
      if (errMsg.includes("PERMANENT_ROOM_LIMIT_EXCEEDED")) {
        res.status(409).json({
          error: {
            code: "PERMANENT_ROOM_LIMIT_EXCEEDED",
            message: "You have reached your permanent room limit.",
          },
        });
        return;
      }
      if (errMsg.includes("WATCH_ROOM_LIMIT_EXCEEDED")) {
        res.status(409).json({
          error: {
            code: "WATCH_ROOM_LIMIT_EXCEEDED",
            message: "You have reached your temporary room limit.",
          },
        });
        return;
      }
      if (errMsg.includes("ACCOUNT_ROOMS_DISABLED")) {
        res.status(403).json({
          error: {
            code: "ACCOUNT_ROOMS_DISABLED",
            message: "Room creation is disabled for this account.",
          },
        });
        return;
      }
      if (e?.code === "23505" && e?.constraint === "rooms_passcode_fingerprint_key") {
        res.status(409).json({
          error: "This passcode is already taken. Each room passcode must be unique.",
        });
        return;
      }
      throw e;
    }
  }

  // Authoritative in-memory registration ONLY after DB commit succeeds
  const newRoom = new Room(io, name);
  if (req.body?.lock) {
    newRoom.lock = decoded.uid;
  }
  newRoom.isChatDisabled = Boolean(req.body?.isChatDisabled);
  newRoom.creator = decoded.email || "";
  newRoom.expiresAt = expiresAt ?? undefined;
  newRoom.status = 'inactive';
  newRoom.owner_id = decoded.uid;
  newRoom.isPermanent = isPermanent;
  newRoom.maxParticipants = maxParticipants;

  const preload = (req.body?.video || "").slice(0, 20000);
  if (preload) {
    redisCount("createRoomPreload");
    newRoom.video = preload;
    newRoom.paused = true;
    await newRoom.saveRoom();
  }
  const prePlaylist = Array.isArray(req.body?.playlist) && req.body?.playlist;
  if (prePlaylist) {
    for (let item of req.body.playlist) {
      newRoom.playlistAdd(null, item);
    }
  }
  rooms.set(name, newRoom);
  res.json({ name });
});

app.post("/updateRoomCover", async (req, res) => {
  const decoded = await validateUserToken(req.body?.uid, req.body?.token, false);
  if (!decoded || decoded === "EMAIL_NOT_VERIFIED") {
    res.status(400).json({ error: "invalid user token" });
    return;
  }

  const rawRoomId = req.body?.roomId;
  const coverPhoto = req.body?.coverPhoto;

  if (!rawRoomId || coverPhoto === undefined) {
    res.status(400).json({ error: "missing roomId or coverPhoto" });
    return;
  }

  if (!postgres) {
    res.status(500).json({ error: "Database not configured" });
    return;
  }

  const cleanRoomId = sanitizeRoomId(rawRoomId);
  const memRoom = rooms.get(cleanRoomId);
  const isMemActive = Boolean(memRoom && (memRoom.status === 'active' || (memRoom.roster && memRoom.roster.length > 0)));

  const roomCheck = await postgres.query(
    `SELECT status, "expiresAt", "isPermanent" FROM rooms WHERE "roomId" = $1 AND owner_id = $2`,
    [cleanRoomId, decoded.uid]
  );

  if (roomCheck.rowCount === 0) {
    res.status(404).json({ error: "Room not found or unauthorized" });
    return;
  }

  const roomRow = roomCheck.rows[0];
  const now = Date.now();
  const isExpired = !roomRow.isPermanent && roomRow.expiresAt && new Date(roomRow.expiresAt).getTime() <= now;
  const isDbActive = roomRow.status === 'active' && !isExpired;

  if (isDbActive || isMemActive) {
    res.status(403).json({
      error: "Cannot change room cover while the room is active. Please end the watch session or wait until all participants leave.",
    });
    return;
  }

  const result = await postgres.query(
    `SELECT public.update_room_metadata_authoritative(
      $1::uuid, $2::text, NULL, NULL, NULL, $3::text, NULL, NULL, NULL, false
    ) AS result`,
    [decoded.uid, cleanRoomId, coverPhoto]
  );
  if (result.rowCount === 0) {
    res.status(404).json({ error: "Room not found or unauthorized" });
    return;
  }
  res.json({ success: true });
});

app.post("/updateRoomSettings", async (req, res) => {
  const decoded = await validateUserToken(req.body?.uid, req.body?.token, false);
  if (!decoded || decoded === "EMAIL_NOT_VERIFIED") {
    res.status(400).json({ error: "invalid user token" });
    return;
  }

  const { roomId: rawRoomId, roomTitle, roomDescription, isPermanent, isChatDisabled, password, removePassword } = req.body;

  if (!rawRoomId || typeof roomTitle !== 'string' || typeof isPermanent !== 'boolean' || typeof isChatDisabled !== 'boolean') {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }

  const roomId = sanitizeRoomId(rawRoomId);

  const titleTrimmed = roomTitle.trim();
  if (titleTrimmed.length === 0 || titleTrimmed.length > 50) {
    res.status(400).json({ error: "Invalid title length" });
    return;
  }

  if (roomDescription && roomDescription.length > 500) {
    res.status(400).json({ error: "Description too long" });
    return;
  }

  let passcodeHash: string | null = null;
  let ownerPasscodeEncrypted: string | null = null;
  let passcodeFingerprint: string | null = null;
  const isClearingPassword = removePassword === true || password === "";

  if (!isClearingPassword && typeof password === 'string' && password.length > 0) {
    if (password.length !== 8) {
      res.status(400).json({ error: "Passcode must be strictly 8 characters long." });
      return;
    }
    if (Buffer.byteLength(password, 'utf8') > 72) {
      res.status(400).json({ error: "Password too long" });
      return;
    }
    passcodeFingerprint = computePasscodeFingerprint(password);
    passcodeHash = await hashRoomPasscode(password);
    ownerPasscodeEncrypted = encryptPasscodeForOwner(password);
  }

  if (!postgres) {
    res.status(500).json({ error: "Database not configured" });
    return;
  }

  const client = await postgres.connect();
  try {
    await client.query('BEGIN');

    const existingRoom = await client.query(
      `SELECT status, "expiresAt", "isSubRoom", "isPermanent" FROM rooms WHERE "roomId" = $1 AND owner_id = $2 FOR UPDATE`,
      [roomId, decoded.uid]
    );

    if (existingRoom.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: "Room not found or unauthorized" });
      return;
    }

    const room = existingRoom.rows[0];

    if (passcodeFingerprint) {
      const duplicateCheck = await client.query(
        `SELECT "roomId" FROM rooms WHERE passcode_fingerprint = $1 AND "roomId" != $2 LIMIT 1`,
        [passcodeFingerprint, roomId]
      );
      if (duplicateCheck.rows.length > 0) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: "This passcode is already taken by another room. Each room passcode must be unique." });
        return;
      }
    }

    const cleanRoomId = roomId;
    const memRoom = rooms.get(cleanRoomId);
    const isMemActive = Boolean(memRoom && (memRoom.status === 'active' || (memRoom.roster && memRoom.roster.length > 0)));
    const now = Date.now();
    const isExpired = !room.isPermanent && room.expiresAt && new Date(room.expiresAt).getTime() <= now;
    const isDbActive = room.status === 'active' && !isExpired;

    if (isDbActive || isMemActive) {
      await client.query('ROLLBACK');
      res.status(403).json({
        error: "Cannot change room details while the room is active. Please end the watch session or wait until all participants leave.",
      });
      return;
    }

    const currentlyPermanent = Boolean(room.isPermanent);
    const permanenceChanged = isPermanent !== currentlyPermanent;

    if (permanenceChanged) {
      await client.query(
        `SELECT public.set_room_permanence_authoritative($1, $2, $3) AS result`,
        [decoded.uid, roomId, isPermanent]
      );
    }

    await client.query(
      `SELECT public.update_room_metadata_authoritative(
        $1::uuid, $2::text, $3::text, $4::text, $5::boolean, NULL, $6::text, $7::text, $8::text, $9::boolean
      )`,
      [
        decoded.uid,
        roomId,
        titleTrimmed,
        roomDescription || null,
        isChatDisabled,
        isClearingPassword ? null : passcodeHash,
        isClearingPassword ? null : ownerPasscodeEncrypted,
        isClearingPassword ? null : passcodeFingerprint,
        isClearingPassword,
      ]
    );

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err: any) {
    try {
      await client.query('ROLLBACK');
    } catch { }
    console.error("updateRoomSettings error:", err);
    if (err?.code === "23505" && err?.constraint === "rooms_passcode_fingerprint_key") {
      res.status(409).json({ error: "This passcode is already taken by another room. Each room passcode must be unique." });
      return;
    }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.delete("/deleteAccount", async (req, res) => {
  // TODO pass this in req.query instead
  const decoded = await validateUserToken(req.body?.uid, req.body?.token, false);
  if (!decoded || decoded === "EMAIL_NOT_VERIFIED") {
    res.status(400).json({ error: "invalid user token" });
    return;
  }
  if (postgres) {
    // Authoritatively purge all rooms under lock, retaining policy and zeroed usage row
    const purgeRes = await postgres.query(
      "SELECT public.purge_account_rooms_authoritative($1) AS deleted_ids",
      [decoded.uid]
    );
    const deletedIds: string[] = purgeRes.rows?.[0]?.deleted_ids || [];
    for (const rId of deletedIds) {
      const memRoom = rooms.get(rId);
      if (memRoom) {
        memRoom.destroy();
        rooms.delete(rId);
        io._nsps.delete("/" + rId);
      }
    }

    // Delete linked accounts
    await postgres.query("DELETE FROM link_account WHERE uid = $1", [
      decoded.uid,
    ]);
  }
  await deleteUser(decoded.uid);
  redisCount("deleteAccount");
  res.json({});
});

app.get("/metadata", async (req, res) => {
  const decoded = await validateUserToken(
    String(req.query?.uid),
    String(req.query?.token),
  );
  if (decoded === "EMAIL_NOT_VERIFIED") {
    res.status(403).json({ error: { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required." } });
    return;
  }
  let isFreePoolFull = false;
  if (config.VM_MANAGER_CONFIG) {
    try {
      isFreePoolFull = (
        await axios.get(
          "http://localhost:" + config.VMWORKER_PORT + "/isFreePoolFull",
        )
      ).data.isFull;
    } catch (e: any) {
      console.warn("[WARNING]: free pool check failed: %s", e.code);
    }
  }
  const beta =
    decoded?.email != null &&
    Boolean(config.BETA_USER_EMAILS.split(",").includes(decoded?.email));
  const streamPath = beta ? config.STREAM_PATH : undefined;
  // Available to all authenticated users
  const convertPath = decoded ? config.CONVERT_PATH : undefined;

  // log metrics but don't wait for it
  if (postgres && decoded?.uid) {
    upsertObject(
      postgres,
      "active_user",
      { uid: decoded?.uid, lastActiveTime: new Date() },
      { uid: true },
    ).catch((e: any) => {
      console.warn("[WARNING]: active_user upsert failed:", e.message);
    });
  }
  const vBrowserProvider = getVBrowserProvider();
  res.json({
    isFreePoolFull,
    beta,
    streamPath,
    convertPath,
    capabilities: {
      virtualBrowser: vBrowserProvider.isEnabled,
    },
  });
});

app.get("/capabilities", (_req, res) => {
  const vBrowserProvider = getVBrowserProvider();
  res.json({
    virtualBrowser: vBrowserProvider.isEnabled,
    provider: vBrowserProvider.id,
  });
});

function sanitizeActionUrl(url?: string | null): string | null {
  if (!url || typeof url !== "string") {
    return null;
  }
  const trimmed = url.trim();
  // Allow internal relative paths starting with a single '/'
  if (trimmed.startsWith("/") && !trimmed.startsWith("//") && !trimmed.includes("\\")) {
    return trimmed;
  }
  // Allow absolute https:// URLs (and http:// in dev)
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:" || (config.NODE_ENV === "development" && parsed.protocol === "http:")) {
      return trimmed;
    }
  } catch {
    return null;
  }
  return null;
}

app.get("/announcements", async (_req, res) => {
  if (!postgres) {
    console.warn("[WARNING]: postgres not configured, returning empty announcements");
    res.json({ announcements: [] });
    return;
  }

  try {
    const result = await postgres.query(`
      SELECT
        id,
        title,
        body,
        level,
        action_label,
        action_url,
        published_at,
        updated_at
      FROM public.announcements
      WHERE is_active = true
        AND published_at <= NOW()
      ORDER BY published_at DESC
      LIMIT 10
    `);

    const announcements = (result.rows || []).map((row: any) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      level: row.level,
      action_label: row.action_label || null,
      action_url: sanitizeActionUrl(row.action_url),
      published_at: row.published_at,
      updated_at: row.updated_at,
    }));

    res.json({ announcements });
  } catch (err: any) {
    console.warn("[WARNING]: Failed to fetch announcements:", err.message);
    res.json({ announcements: [] });
  }
});

app.get("/roomData/:roomId", async (req, res) => {
  const cleanRoomId = sanitizeRoomId(req.params.roomId);
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : (req.query?.token as string | undefined);
  const uid = (req.query?.uid as string | undefined) || (req.headers["x-user-id"] as string | undefined);

  if (!uid || !token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const decoded = await validateUserToken(String(uid), String(token), false);
  if (!decoded || decoded === "EMAIL_NOT_VERIFIED") {
    res.status(403).json({ error: "Unauthorized or unverified email" });
    return;
  }

  if (!postgres) {
    res.status(500).json({ error: "Database not available" });
    return;
  }

  const result = await postgres.query(
    `SELECT data FROM rooms WHERE "roomId" = $1 AND owner_id = $2`,
    [cleanRoomId, decoded.uid],
  );

  if (!result || result.rows.length === 0) {
    res.status(404).json({ error: "Room not found or unauthorized" });
    return;
  }

  res.json(result.rows[0].data);
});

app.get("/roomInfo/:roomId", async (req, res) => {
  const rawRoomId = req.params.roomId;
  if (!rawRoomId || typeof rawRoomId !== "string") {
    res.status(400).json({ error: "Missing room identifier" });
    return;
  }
  const cleanRoomId = sanitizeRoomId(rawRoomId);

  // Attempt to decode caller token if provided (via Authorization header or query params)
  let callerUid: string | undefined;
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : (req.query?.token as string | undefined);
  const uid = (req.query?.uid as string | undefined) || (req.headers["x-user-id"] as string | undefined);

  if (token && uid) {
    try {
      const decoded = await validateUserToken(String(uid), String(token));
      if (decoded && decoded !== "EMAIL_NOT_VERIFIED") {
        callerUid = decoded.uid;
      }
    } catch {
      // Best-effort session check
    }
  }

  try {
    const result = await postgres?.query(
      `SELECT "roomId", "roomTitle", "roomDescription", "coverPhoto", status, "expiresAt", "isPermanent",
              (passcode IS NOT NULL AND passcode <> '') as "requiresPasscode", owner_id, participants_locked, max_participants
       FROM rooms WHERE "roomId" = $1`,
      [cleanRoomId],
    );

    if (!result || result.rows.length === 0) {
      res.status(404).json({ error: "Room not found" });
      return;
    }

    const row = result.rows[0];

    // Compute derived status if expired
    let derivedStatus = row.status;
    if ((row.status === "active" || row.status === "inactive") && !row.isPermanent && row.expiresAt) {
      const expiresAt = new Date(row.expiresAt).getTime();
      if (expiresAt <= Date.now()) {
        derivedStatus = "expired";
      }
    }

    const isOwner = Boolean(callerUid && row.owner_id && callerUid === row.owner_id);

    // Sanitize response: NEVER leak owner_id, passcode hash, or internal metadata
    res.json({
      roomId: row.roomId,
      roomTitle: row.roomTitle || row.roomId,
      roomDescription: row.roomDescription || "",
      coverPhoto: row.coverPhoto || null,
      status: derivedStatus,
      requiresPasscode: Boolean(row.requiresPasscode),
      participantsLocked: Boolean(row.participants_locked),
      maxParticipants: typeof row.max_participants === "number" ? row.max_participants : 10,
      isOwner,
    });
  } catch (err) {
    console.error("Error fetching roomInfo:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/verifyPasscode", async (req, res) => {
  const { roomId, passcode } = req.body || {};
  if (!roomId || typeof roomId !== "string") {
    res.status(400).json({ valid: false, error: "Missing room identifier." });
    return;
  }
  if (!passcode || typeof passcode !== "string") {
    res.status(400).json({ valid: false, error: "Passcode is required." });
    return;
  }

  const cleanRoomId = sanitizeRoomId(roomId);
  const cleanPasscode = passcode.trim();

  if (cleanPasscode.length !== 8) {
    res.status(400).json({ valid: false, error: "Passcode must be strictly 8 characters." });
    return;
  }

  // Extract client IP and user identity for rate limiting
  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown";

  // Optional user token
  let callerUid: string | undefined;
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : (req.query?.token as string | undefined);
  const uid = (req.query?.uid as string | undefined) || (req.headers["x-user-id"] as string | undefined);

  if (token && uid) {
    try {
      const decoded = await validateUserToken(String(uid), String(token));
      if (decoded && decoded !== "EMAIL_NOT_VERIFIED") {
        callerUid = decoded.uid;
      }
    } catch { }
  }

  const rateLimitTarget = { ip, roomId: cleanRoomId, userId: callerUid };

  // Multi-dimensional rate limit check (IP, Room, User)
  const rateLimitStatus = await checkPasscodeRateLimits(rateLimitTarget);
  if (!rateLimitStatus.allowed) {
    res.set("Retry-After", String(rateLimitStatus.retryAfterSeconds));
    res.status(429).json({
      valid: false,
      error: "Too many passcode attempts. Please wait a few minutes before trying again.",
      retryAfterSeconds: rateLimitStatus.retryAfterSeconds,
    });
    return;
  }

  try {
    const result = await postgres?.query(
      `SELECT passcode, status, owner_id, participants_locked, max_participants FROM rooms WHERE "roomId" = $1`,
      [cleanRoomId],
    );

    // If room does not exist, return generic 401 failure to avoid enumeration attacks
    if (!result || result.rows.length === 0) {
      await recordPasscodeFailure(rateLimitTarget);
      res.status(401).json({ valid: false, error: "Incorrect room passcode. Please try again." });
      return;
    }

    const row = result.rows[0];
    const roomPasscode = row.passcode;

    // Expired or ended rooms cannot be joined
    if (row.status === "expired" || row.status === "ended") {
      res.status(401).json({ valid: false, error: "This room has ended or expired." });
      return;
    }

    let isValid = false;
    if (roomPasscode) {
      if (isBcryptHash(roomPasscode)) {
        isValid = await verifyRoomPasscode(cleanPasscode, roomPasscode);
      } else {
        isValid = cleanPasscode === roomPasscode;
      }
    } else {
      // Room without passcode
      isValid = true;
    }

    if (!isValid) {
      await recordPasscodeFailure(rateLimitTarget);
      res.status(401).json({ valid: false, error: "Incorrect room passcode. Please try again." });
      return;
    }

    // Participant admission lock check: non-owners cannot bypass participant lock via passcode verification
    const isOwner = Boolean(callerUid && row.owner_id && callerUid === row.owner_id);
    if (row.participants_locked && !isOwner) {
      res.status(403).json({
        valid: false,
        error: "This room is currently locked to existing participants.",
        code: "PARTICIPANTS_LOCKED",
      });
      return;
    }

    // MEMBER-001 Invariant: Pre-check capacity enforcement
    // Non-owners entering a full room are rejected with ROOM_FULL
    const memoryRoom = rooms.get(cleanRoomId);
    if (memoryRoom && !isOwner) {
      if (typeof row.max_participants === "number") {
        memoryRoom.maxParticipants = row.max_participants;
      }
      if (memoryRoom.isRoomFull(isOwner)) {
        res.status(403).json({
          valid: false,
          error: "This room has reached its participant limit.",
          code: "ROOM_FULL",
        });
        return;
      }
    }

    // Success: reset rate limit attempts for this target and return 200
    // NOTE: This endpoint NEVER mutates room status (it never activates an inactive room).
    await resetPasscodeLimits(rateLimitTarget);
    res.json({ valid: true });
  } catch (err) {
    console.error("Error verifying passcode:", err);
    res.status(500).json({ valid: false, error: "Server error verifying passcode." });
  }
});

app.get("/resolveShard/:roomId", async (req, res) => {
  const cleanRoomId = sanitizeRoomId(req.params.roomId);
  const shardNum = resolveShard(cleanRoomId);
  res.send(String(config.SHARD ? shardNum : ""));
});

app.get("/listRooms", async (req, res) => {
  try {
    const decoded = await validateUserToken(
      String(req.query?.uid),
      String(req.query?.token),
    );
    if (decoded === "EMAIL_NOT_VERIFIED") {
      res.status(403).json({ error: { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required." } });
      return;
    }
    if (!decoded) {
      res.status(400).json({ error: "invalid user token" });
      return;
    }
    if (!postgres) {
      res.status(503).json({ error: "Database unavailable" });
      return;
    }
    const hasPagination = req.query.limit !== undefined || req.query.page !== undefined;
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = hasPagination ? Math.max(1, Math.min(100, parseInt(String(req.query.limit || "12"), 10) || 12)) : 0;
    const offset = (page - 1) * limit;

    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
    const access = typeof req.query.access === "string" ? req.query.access.trim() : "";
    const chat = typeof req.query.chat === "string" ? req.query.chat.trim() : "";
    const sort = typeof req.query.sort === "string" ? req.query.sort.trim() : "newest";

    const whereClauses: string[] = [`owner_id = $1`];
    const params: any[] = [decoded.uid];

    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      const idx = params.length;
      whereClauses.push(`(LOWER("roomTitle") LIKE $${idx} OR LOWER("roomDescription") LIKE $${idx} OR LOWER("roomId") LIKE $${idx})`);
    }

    if (status && status !== "all") {
      if (status === "active") {
        whereClauses.push(`status = 'active'`);
      } else if (status === "inactive") {
        whereClauses.push(`status = 'inactive'`);
      } else if (status === "permanent") {
        whereClauses.push(`"isPermanent" = true`);
      } else if (status === "expiring") {
        whereClauses.push(`(status = 'expiring' OR (status IN ('active', 'inactive') AND "isPermanent" IS NOT TRUE AND "expiresAt" IS NOT NULL AND "expiresAt" > NOW() AND "expiresAt" <= NOW() + INTERVAL '15 minutes'))`);
      } else if (status === "finished") {
        whereClauses.push(`(status IN ('expired', 'ended') OR (status IN ('active', 'inactive') AND "isPermanent" IS NOT TRUE AND "expiresAt" IS NOT NULL AND "expiresAt" <= NOW()))`);
      }
    }

    if (access && access !== "all") {
      if (access === "protected") {
        whereClauses.push(`(passcode IS NOT NULL AND passcode <> '')`);
      } else if (access === "public") {
        whereClauses.push(`(passcode IS NULL OR passcode = '')`);
      }
    }

    if (chat && chat !== "all") {
      if (chat === "enabled") {
        whereClauses.push(`"isChatDisabled" IS NOT TRUE`);
      } else if (chat === "disabled") {
        whereClauses.push(`"isChatDisabled" IS TRUE`);
      }
    }

    let orderBy = `"creationTime" DESC`;
    if (sort === "oldest") {
      orderBy = `"creationTime" ASC`;
    } else if (sort === "title-asc") {
      orderBy = `LOWER(COALESCE("roomTitle", "roomId")) ASC`;
    } else if (sort === "title-desc") {
      orderBy = `LOWER(COALESCE("roomTitle", "roomId")) DESC`;
    } else if (sort === "expiring") {
      orderBy = `CASE WHEN status IN ('active', 'expiring') THEN 0 ELSE 1 END, "expiresAt" ASC NULLS LAST, "creationTime" DESC`;
    }

    const whereSql = whereClauses.join(" AND ");

    let totalCount = 0;
    let stats = { total: 0, active: 0, expiring: 0, finished: 0 };

    if (hasPagination) {
      const statsPromise = postgres.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(CASE WHEN status = 'active' THEN 1 END)::int AS active,
           COUNT(CASE WHEN (status = 'expiring' OR (status IN ('active', 'inactive') AND "isPermanent" IS NOT TRUE AND "expiresAt" IS NOT NULL AND "expiresAt" > NOW() AND "expiresAt" <= NOW() + INTERVAL '15 minutes')) THEN 1 END)::int AS expiring,
           COUNT(CASE WHEN (status IN ('expired', 'ended') OR (status IN ('active', 'inactive') AND "isPermanent" IS NOT TRUE AND "expiresAt" IS NOT NULL AND "expiresAt" <= NOW())) THEN 1 END)::int AS finished
         FROM rooms WHERE owner_id = $1`,
        [decoded.uid]
      );

      const countPromise = postgres.query(
        `SELECT COUNT(*)::int AS count FROM rooms WHERE ${whereSql}`,
        params
      );

      const [statsRes, countRes] = await Promise.all([statsPromise, countPromise]);
      if (statsRes?.rows?.[0]) {
        stats = {
          total: Number(statsRes.rows[0].total) || 0,
          active: Number(statsRes.rows[0].active) || 0,
          expiring: Number(statsRes.rows[0].expiring) || 0,
          finished: Number(statsRes.rows[0].finished) || 0,
        };
      }
      totalCount = Number(countRes?.rows?.[0]?.count) || 0;
    }

    let querySql = `SELECT "roomId", (passcode IS NOT NULL AND passcode <> '') AS "isPasscodeProtected",
                           "creationTime", "roomTitle", "roomDescription", "coverPhoto", "isChatDisabled", "isSubRoom",
                           status, "startedAt", "expiresAt", "endedAt", "isPermanent", owner_passcode
                    FROM rooms WHERE ${whereSql} ORDER BY ${orderBy}`;

    const queryParams = [...params];
    if (hasPagination) {
      queryParams.push(limit, offset);
      querySql += ` LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`;
    }

    const result = await postgres.query(querySql, queryParams);

    const now = Date.now();
    const warningWindow = 15 * 60 * 1000; // 15 minutes
    const rows = (result?.rows ?? []).map((r: any) => {
      let derivedStatus = r.status;
      if ((r.status === 'active' || r.status === 'inactive') && !r.isPermanent && r.expiresAt) {
        const expiresAt = new Date(r.expiresAt).getTime();
        if (expiresAt <= now) {
          derivedStatus = 'expired';
        } else if (expiresAt <= now + warningWindow) {
          derivedStatus = 'expiring';
        }
      }
      const currentPasscode = r.owner_passcode ? decryptPasscodeForOwner(r.owner_passcode) : null;
      return {
        ...r,
        owner_passcode: undefined,
        currentPasscode,
        status: derivedStatus,
      };
    });

    if (hasPagination) {
      res.json({
        rooms: rows,
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit),
        stats,
      });
    } else {
      res.json(rows);
    }
  } catch (err: any) {
    console.error("Error in /listRooms:", err);
    res.status(500).json({ error: err?.message || "Failed to list rooms" });
  }
});

app.get("/roomDetails", async (req, res) => {
  const decoded = await validateUserToken(
    String(req.query?.uid),
    String(req.query?.token),
  );
  if (decoded === "EMAIL_NOT_VERIFIED") {
    res.status(403).json({ error: { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required." } });
    return;
  }
  if (!decoded) {
    res.status(400).json({ error: "invalid user token" });
    return;
  }

  const rawRoomId = req.query.roomId;
  if (!rawRoomId || typeof rawRoomId !== "string") {
    res.status(400).json({ error: "missing roomId" });
    return;
  }
  const roomId = sanitizeRoomId(rawRoomId);

  try {
    const roomResult = await postgres?.query(
      `SELECT "roomId", (passcode IS NOT NULL AND passcode <> '') AS "isPasscodeProtected",
              "creationTime", "roomTitle", "roomDescription", "coverPhoto", "isChatDisabled", "isSubRoom",
              status, "startedAt", "expiresAt", "endedAt", "isPermanent", owner_passcode, max_participants
       FROM rooms WHERE "roomId" = $1 AND owner_id = $2`,
      [roomId, decoded.uid],
    );

    if (!roomResult || roomResult.rows.length === 0) {
      res.status(404).json({ error: "Room not found or unauthorized" });
      return;
    }

    const room = roomResult.rows[0];

    const now = Date.now();
    const warningWindow = 15 * 60 * 1000; // 15 minutes
    let derivedStatus = room.status;
    if ((room.status === 'active' || room.status === 'inactive') && !room.isPermanent && room.expiresAt) {
      const expiresAt = new Date(room.expiresAt).getTime();
      if (expiresAt <= now) {
        derivedStatus = 'expired';
      } else if (expiresAt <= now + warningWindow) {
        derivedStatus = 'expiring';
      }
    }
    room.status = derivedStatus;

    const currentPasscode = room.owner_passcode ? decryptPasscodeForOwner(room.owner_passcode) : null;

    // Fetch lifecycle events
    const lifecycleResult = await postgres?.query(
      `SELECT id, actor, event, "previousStatus", "newStatus", "previousExpiresAt", "newExpiresAt", reason, timestamp
       FROM room_lifecycle_events WHERE "roomId" = $1
       ORDER BY timestamp DESC`,
      [roomId]
    );

    // Fetch chat summary
    const chatSummaryResult = await postgres?.query(
      `SELECT count(id)::int as "messagesCount", max(created_at) as "lastMessageAt"
       FROM room_messages WHERE room_id = $1`,
      [roomId]
    );
    const chatSummary = chatSummaryResult?.rows[0] || { messagesCount: 0, lastMessageAt: null };

    res.json({
      ...room,
      owner_passcode: undefined,
      currentPasscode,
      lifecycleEvents: lifecycleResult?.rows ?? [],
      chatSummary: {
        messagesCount: chatSummary.messagesCount || 0,
        lastMessageAt: chatSummary.lastMessageAt || null
      }
    });

  } catch (error) {
    console.error("Error fetching room details:", error);
    res.status(500).json({ error: "internal server error" });
  }
});

app.post("/extendRoom", async (req, res) => {
  const decoded = await validateUserToken(
    String(req.body?.uid),
    String(req.body?.token),
  );
  if (decoded === "EMAIL_NOT_VERIFIED") {
    res.status(403).json({ error: { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required." } });
    return;
  }
  if (!decoded) {
    res.status(400).json({ error: "invalid user token" });
    return;
  }
  const rawRoomId = req.body?.roomId;
  const durationSeconds = Number(req.body?.durationSeconds);
  if (!rawRoomId || !durationSeconds) {
    res.status(400).json({ error: "missing parameters" });
    return;
  }
  const roomId = sanitizeRoomId(rawRoomId);

  // max duration 3 hours = 10800s
  if (durationSeconds > 10800 || durationSeconds < 0) {
    res.status(400).json({ error: "invalid duration" });
    return;
  }

  try {
    const selectResult = await postgres?.query(
      `SELECT "startedAt", "expiresAt", "status" FROM rooms WHERE "roomId" = $1 AND owner_id = $2`,
      [roomId, decoded.uid]
    );

    if (!selectResult || selectResult.rows.length === 0) {
      res.status(400).json({ error: "Room not found or unowned" });
      return;
    }

    const roomRow = selectResult.rows[0];
    if (roomRow.status !== "active" && roomRow.status !== "scheduled" && roomRow.status !== "inactive") {
      res.status(400).json({ error: "Room cannot be extended in its current state" });
      return;
    }

    const startedAt = new Date(roomRow.startedAt || Date.now()).getTime();
    const proposedExpiresAt = Date.now() + durationSeconds * 1000;
    const maxExpiresAt = startedAt + 3 * 60 * 60 * 1000; // 3 hours max active duration

    if (proposedExpiresAt > maxExpiresAt) {
      res.status(400).json({
        error: {
          code: "ROOM_MAX_DURATION_EXCEEDED",
          message: "This room cannot be extended beyond its maximum duration.",
        },
      });
      return;
    }

    const updateResult = await postgres?.query(
      "SELECT public.extend_room_authoritative($1, $2, $3) AS new_expires_at",
      [decoded.uid, roomId, new Date(proposedExpiresAt)],
    );

    if (updateResult && updateResult.rowCount && updateResult.rowCount > 0) {
      const newExpiresAt = updateResult.rows[0].new_expires_at;

      const memoryRoom = rooms.get(roomId);
      if (memoryRoom) {
        memoryRoom.expiresAt = new Date(newExpiresAt);
      }
      res.json({ expiresAt: newExpiresAt });
    } else {
      res.status(400).json({ error: "Room not found, unowned, or cannot be extended" });
    }
  } catch (e) {
    console.error("Error extending room:", e);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/endRoom", async (req, res) => {
  const decoded = await validateUserToken(
    String(req.body?.uid),
    String(req.body?.token),
  );
  if (decoded === "EMAIL_NOT_VERIFIED") {
    res.status(403).json({ error: { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required." } });
    return;
  }
  if (!decoded) {
    res.status(400).json({ error: "invalid user token" });
    return;
  }
  const rawRoomId = typeof req.body?.roomId === "string" ? req.body.roomId : "";
  if (!rawRoomId) {
    res.status(400).json({ error: "missing roomId" });
    return;
  }
  const roomId = sanitizeRoomId(rawRoomId);

  try {
    if (!postgres) {
      res.status(503).json({ error: "Database unavailable" });
      return;
    }

    // 1. Authoritative DB transition: lock account usage, mark status = 'ended', and immediately reclaim quota slot
    try {
      await postgres.query(
        `SELECT public.end_room_authoritative($1, $2, 'host') AS result`,
        [decoded.uid, roomId]
      );
    } catch (dbErr: any) {
      const msg = dbErr?.message || "";
      if (msg.includes("ROOM_NOT_FOUND")) {
        res.status(404).json({ error: "Room not found or unauthorized" });
        return;
      }
      throw dbErr;
    }

    // 2. Broadcast ROOM_SESSION_STOPPED and system message, stop VM, then disconnect
    const cleanRoomId = roomId;
    const memoryRoom = rooms.get(roomId);
    if (memoryRoom) {
      memoryRoom.status = 'ended';

      // Explicit notification to all connected clients before disconnecting
      io.of(memoryRoom.roomId).emit("ROOM_SESSION_STOPPED");

      memoryRoom.addChatMessage(null, {
        id: '',
        system: true,
        msg: 'This watch party has been ended by the host.',
      });

      if (memoryRoom.vBrowser) {
        await memoryRoom.stopVBrowserInternal();
      }
      memoryRoom.disconnectAllSockets();
    }

    res.json({ success: true, status: 'ended' });
  } catch (error) {
    console.error("Error ending room session:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


app.delete("/deleteRoom", async (req, res) => {
  try {
    const decoded = await validateUserToken(
      String(req.query?.uid),
      String(req.query?.token),
    );
    if (decoded === "EMAIL_NOT_VERIFIED") {
      res.status(403).json({ error: { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required." } });
      return;
    }
    if (!decoded) {
      res.status(400).json({ error: "invalid user token" });
      return;
    }
    if (!postgres) {
      res.status(503).json({ error: "Database unavailable" });
      return;
    }

    const rawRoomId = typeof req.query.roomId === "string" ? req.query.roomId : "";
    if (!rawRoomId) {
      res.status(400).json({ error: "missing roomId" });
      return;
    }
    const roomId = sanitizeRoomId(rawRoomId);

    // Authoritative DB deletion with lock-first serialization and quota reclamation
    try {
      await postgres.query(
        `SELECT public.delete_room_authoritative($1, $2) AS result`,
        [decoded.uid, roomId]
      );
    } catch (dbErr: any) {
      const msg = dbErr?.message || "";
      if (msg.includes("ROOM_NOT_FOUND")) {
        res.status(404).json({ error: "Room not found or unauthorized" });
        return;
      }
      if (msg.includes("ROOM_ACTIVE_CANNOT_DELETE")) {
        res.status(409).json({ error: "Cannot delete an active room. Stop the session first." });
        return;
      }
      throw dbErr;
    }

    // Clean up memory structures ONLY after authoritative DB deletion succeeds
    const memoryRoom = rooms.get(roomId);
    if (memoryRoom) {
      memoryRoom.disconnectAllSockets();
      rooms.delete(roomId);
      io._nsps.delete(roomId);
      memoryRoom.destroy();
      await memoryRoom.stopVBrowserInternal();
    }

    res.status(204).end();
  } catch (error) {
    console.error("Error deleting room:", error);
    res.status(500).json({ error: "Failed to delete room" });
  }
});


app.get("/generateName", async (req, res) => {
  res.send(makeUserName());
});

// Proxy video segments
app.get("/proxy/*splat", async (req, res) => {
  redisCount("proxyReqs");
  try {
    const parsed = new URL("http://localhost" + req.url);
    const pathname = parsed.pathname.slice("/proxy".length);
    const host = parsed.searchParams.get("host");
    if (pathname.endsWith("index-dvr.m3u8")) {
      // VOD
      // https://d2vjef5jvl6bfs.cloudfront.net/3012391a6c3e84c79ef6_gamesdonequick_41198403369_1681059003/chunked/index-dvr.m3u8
      const resp = await axios.get("https://" + host + pathname);
      const re2 = /(.*.ts)/g;
      let repl = resp.data.replaceAll(re2, `$1?host=${host}`);
      // Mark this as a VOD
      repl += "#EXT-X-ENDLIST";
      res.send(repl);
    } else if (pathname.endsWith(".m3u8")) {
      // Stream
      // https://video-weaver.sea02.hls.ttvnw.net/v1/playlist/CrQEgv7Mz6nnsfJH3XtVQxeYXk8mViy1zNGWglcybvxZsI1rv3iLnjAnnqwCiVXCJ-DdD27J6RuFrLy7YUYwHUCKazIKICIupUCn9UXtaBYhBM5JIYqg9dz6NWYrCWU9HZJj2TGROv9mAOKuTR51YS82hdYL4PFZa3xxWXhgDsxXQHNDB03kY6S0aG0-EVva1xYrn5Ge6IAXRwug9QDGlb-ydtF3BtYppoTklVI7CVLySPPwbbt5Ow1JXdnKhLSwQEs4bh3BLwMnRBwUFI5nmE18BLYbkMOUivgYP5SSMgnGGlSkJO-iJNPWvepunEgyBUzB_7L-b1keTcV-Qak9IcWIITIWbRvmg6qB3ZSuWdcJgWKmdXdIn4qoRM4o16G1_0N_WRqPtMQFo0hmTlAVmHrzRArJQmaSgqAxZxRbFMd9RFeX6qjP9NtwguPbSeStdVbQxMNC34iavYUIxo8Ug812BHsG7J_kIlof2zkIqkEbP3oV3UkSByIo7xh9EEVargjaGDuQRt8zPQ6-fNBWJJe9F6IFu7lXBPIJ016lopyfcvTWjbLbBHsVkg6vG-3UISh0nud7KB5g5ipQePhtcFSI5hvjlfX1DAVHEpTWXkvlnL4wNqEqpBYL2btSXYeE1Cb-RAvrAT0s61usERcL2eI-S5aTcSO8_hxQ2afC7c9vlypOWgP6p6XNpViZHXmdXv4t-d68Z-MpLtSU7VbB3pRWnSswFFyA3W39ITic4lb97Djp3wHhGgz0Sy8aDb9r0tnphIYgASoJdXMtZWFzdC0yMKQG.m3u8
      // Extract the edge URL host and add it to URL so proxy can fetch
      const resp = await axios.get("https://" + host + pathname);
      // const re = /https:\/\/(.*)\/v1\/segment\/(.*)/g;
      // const match = re.exec(resp.data);
      // const edgehost = match?.[1];
      // const repl = resp.data.replaceAll(
      //   re,
      //   `/proxy/v1/segment/$2?host=${edgehost}`,
      // );
      const repl = resp.data;
      res.send(repl);
    } else if (pathname.endsWith(".ts")) {
      // Segment
      const resp = await axios.get("https://" + host + pathname, {
        responseType: "arraybuffer",
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
      res.status(404);
      res.end();
    }
  } catch (e) {
    // console.log(e);
    console.log("proxy failed: %s", req.url);
  }
});

async function saveRooms() {
  // Unload rooms that are empty and idle
  // Frees up some JS memory space when process is long-running
  // On reconnect, we'll attempt to reload the room
  let saveCount = 0;
  let skipCount = 0;
  const start = Date.now();
  await Promise.all(
    Array.from(rooms.entries()).map(async ([key, room]) => {
      if (
        room.roster.length === 0 &&
        !room.vBrowser &&
        Number(room.lastUpdateTime) < Date.now() - 8 * 60 * 60 * 1000
      ) {
        console.log(
          "freeing room %s from memory on shard %s",
          key,
          config.SHARD,
        );
        await room.saveRoom();
        room.destroy();
        rooms.delete(key);
        saveCount += 1;
        // Unregister the namespace to avoid dupes on reload
        io._nsps.delete(key);
      } else if (room.roster.length) {
        room.lastUpdateTime = new Date();
        await room.saveRoom();
        saveCount += 1;
      } else {
        skipCount += 1;
      }
    }),
  );
  const end = Date.now();
  console.log(
    "[SAVEROOMS] %s saved in %sms, %s skipped",
    saveCount,
    end - start,
    skipCount,
  );
}

async function expireRooms() {
  if (!postgres) return;
  try {
    const result = await postgres.query(`
      SELECT room_id AS "roomId", owner_id AS "ownerId", room_kind AS "roomKind",
             previous_expires_at AS "previousExpiresAt", ended_at AS "timestamp"
      FROM public.expire_rooms_authoritative()
    `);
    if (result.rowCount && result.rowCount > 0) {
      console.log(`[EXPIRE] Expired ${result.rowCount} rooms`);
      for (const row of result.rows) {
        const room = rooms.get(row.roomId);
        if (room) {
          room.status = 'expired';
          room.addChatMessage(null, {
            id: '',
            system: true,
            msg: 'This room has expired.',
          });

          if (room.vBrowser) {
            room.stopVBrowserInternal();
          }

          room.disconnectAllSockets();
        }
      }
    }
  } catch (e) {
    console.error("Error expiring rooms:", e);
  }
}

async function release() {
  // Reset VMs in rooms that are:
  // older than the session limit
  // assigned to a room with no users
  const roomArr = Array.from(rooms.values());
  console.log("[RELEASE] %s rooms in batch", roomArr.length);
  for (let room of roomArr) {
    if (room.vBrowser && room.vBrowser.assignTime) {
      const maxTime = getSessionLimitSeconds(room.vBrowser.large) * 1000;
      const elapsed = Date.now() - room.vBrowser.assignTime;
      const ttl = maxTime - elapsed;
      const isTimedOut = ttl && ttl < releaseInterval;
      const isAlmostTimedOut = ttl && ttl < releaseInterval * 2;
      const isRoomEmpty = room.roster.length === 0;
      const isRoomIdle =
        Date.now() - Number(room.lastUpdateTime) > 5 * 60 * 1000;
      if (isTimedOut || (isRoomEmpty && isRoomIdle)) {
        console.log("[RELEASE] VM in room:", room.roomId);
        room.stopVBrowserInternal();
        if (isTimedOut) {
          room.addChatMessage(null, {
            id: "",
            system: true,
            cmd: "vBrowserTimeout",
            msg: "",
          });
          redisCount("vBrowserTerminateTimeout");
        } else if (isRoomEmpty) {
          redisCount("vBrowserTerminateEmpty");
        }
      } else if (isAlmostTimedOut) {
        room.addChatMessage(null, {
          id: "",
          system: true,
          cmd: "vBrowserAlmostTimeout",
          msg: "",
        });
      }
    }
    // We want to spread out the jobs over about half the release interval
    // This gives other jobs some CPU time
    const waitTime = releaseInterval / 2 / roomArr.length;
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }
}

// Dirty presence snapshot tracking (Phase 4 Command Economics: dirty-set suppression)
const lastPresenceSnapshot = new Map<string, string>();

async function minuteMetrics() {
  const roomArr = Array.from(rooms.values());
  let vbWaiting = 0;
  const dirtyPresenceBatch: Record<string, string> = {};
  const emptyRoomsToClean: string[] = [];

  for (let room of roomArr) {
    if (room.vBrowser && room.vBrowser.id) {
      // Update the heartbeat in postgres
      await postgres?.query(
        `UPDATE vbrowser SET "heartbeatTime" = NOW() WHERE "roomId" = $1 and vmid = $2`,
        [room.roomId, room.vBrowser.id],
      );

      // Phase 8: In critical budget state, degrade non-essential analytics tracking
      if (!RedisMetrics.isDegradedMode() && redis) {
        const expireTime = getStartOfDay() / 1000 + 86400;
        if (room.vBrowser?.creatorClientID) {
          await redis.zincrby(
            "vBrowserClientIDMinutes",
            1,
            room.vBrowser.creatorClientID,
          );
          await redis.expireat("vBrowserClientIDMinutes", expireTime);
        }
        if (room.vBrowser?.creatorUID) {
          await redis.zincrby(
            "vBrowserUIDMinutes",
            1,
            room.vBrowser?.creatorUID,
          );
          await redis.expireat("vBrowserUIDMinutes", expireTime);
        }
      }
    }

    const users = room.roster.length;
    const rosterData = users > 0 ? room.getRosterForStats() : [];
    const currentSignature = `${users}:${rosterData.map((u: any) => u.id).join(",")}`;
    const previousSignature = lastPresenceSnapshot.get(room.roomId);

    // Phase 4: Only write presence if changed (Dirty-set suppression)
    if (currentSignature !== previousSignature) {
      lastPresenceSnapshot.set(room.roomId, currentSignature);
      if (users > 0) {
        dirtyPresenceBatch[room.roomId] = JSON.stringify({
          count: users,
          roster: rosterData,
        });
      } else {
        emptyRoomsToClean.push(room.roomId);
      }
    }
    vbWaiting += room.vBrowserQueue ? 1 : 0;
  }

  // Flush dirty presence batch in single atomic operation (1 command for all changed rooms)
  if (Object.keys(dirtyPresenceBatch).length > 0) {
    await redisCache.updateRoomPresenceBatch(dirtyPresenceBatch).catch(() => { });
  }
  if (emptyRoomsToClean.length > 0) {
    await redisCache.removeRoomPresenceBatch(emptyRoomsToClean).catch(() => { });
  }

  // Report shard metrics with atomic write-with-TTL
  const obj: ShardMetric = {
    uptime: process.uptime(),
    mem: process.memoryUsage().rss,
    roomCount: rooms.size,
    users: io.engine.clientsCount,
    vbWaiting,
  };
  await redis?.setex(
    `shardMetrics:${config.SHARD ?? 0}`,
    120,
    JSON.stringify(obj),
  );
}

function computeOpenSubtitlesHash(first: Buffer, last: Buffer, size: number) {
  // console.log(first.length, last.length, size);
  let temp = BigInt(size);
  process(first);
  process(last);

  temp = temp & BigInt("0xffffffffffffffff");
  return temp.toString(16).padStart(16, "0");

  function process(chunk: Buffer) {
    for (let i = 0; i < chunk.length; i += 8) {
      const long = chunk.readBigUInt64LE(i);
      temp += long;
    }
  }
}
