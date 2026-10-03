import config from "./config.ts"; // force reload
import fs from "node:fs";
import express, { type Request, type Response, type NextFunction } from "express";
import bodyParser from "body-parser";
import compression from "compression";
import cors from "cors";
import https from "node:https";
import http from "node:http";
import { Server } from "socket.io";
import { Room } from "./room.ts";
import { metricsRedis, edgeRedis, redisCount, redisEdge } from "./utils/redis.ts";
import { deleteUser, validateUserToken, supabaseAdmin, getUserByEmail } from "./utils/supabase.ts";

import { postgres } from "./utils/postgres.ts";
import axios, { isAxiosError } from "axios";
import crypto from "node:crypto";
import { resolveShard } from "./utils/resolveShard.ts";
import { RoomReconstructor } from "./lifecycle/roomReconstruction.ts";
import { RoomLifecycleManager } from "./lifecycle/roomManager.ts";
import { checkRateLimit, recordAttempt } from "./utils/rateLimit.ts";
import { sendDuplicateSignupSecurityAlert } from "./notifications/securityAlerts.ts";
import { sanitizeRoomId } from "./strip_slashes.ts";
import { isAllowedEmailDomain } from "./utils/emailDomain.ts";
import { profileRouter } from "./routes/profile.ts";
import { createSubtitleRouter } from "./routes/subtitleRouter.ts";
import { createFeedbackRouter } from "./routes/feedbackRouter.ts";
import { createOperatorRouter } from "./routes/operatorRouter.ts";
import { createMediaMetadataRouter } from "./routes/mediaMetadataRouter.ts";
import { createRoomLifecycleRouter } from "./routes/roomLifecycleRouter.ts";
import { createRoomConfigRouter } from "./routes/roomConfigRouter.ts";
import { createRoomAdmissionRouter } from "./routes/roomAdmissionRouter.ts";
import { createRoomDiscoveryRouter } from "./routes/roomDiscoveryRouter.ts";
import { createRoomOwnerInspectionRouter } from "./routes/roomOwnerInspectionRouter.ts";
import { createPublicUtilityRouter } from "./routes/publicUtilityRouter.ts";
import { registerNotificationNamespace } from "./notifications/notificationSocketNamespace.ts";
import { createNotificationRouter } from "./notifications/notificationRouter.ts";
import { createInvitationRouter } from "./invitations/invitationRouter.ts";
import { notificationService } from "./notifications/notificationService.ts";
import { startEmailWorker, stopEmailWorker } from "./notifications/emailWorker.ts";
import { EmailProviderRegistry } from "./notifications/emailProviderRegistry.ts";
import { providerWebhookRouter } from "./notifications/webhooks/providerWebhookRouter.ts";

import { getNotificationHealthReport } from "./notifications/notificationTelemetry.ts";
import {
  purgeReadNotificationsExpired,
  purgeSentOutboxRows,
  purgeFailedOutboxRows,
} from "./notifications/emailOutbox.ts";
import { validateExternalUrl, safeExternalGet } from "./utils/ssrfValidator.ts";

export class ServerLifecycleManager {
  private intervals: NodeJS.Timeout[] = [];
  private isShuttingDown = false;

  public registerInterval(fn: () => void | Promise<void>, intervalMs: number): NodeJS.Timeout {
    const timer = setInterval(() => {
      if (this.isShuttingDown) return;
      try {
        const result = fn();
        if (result && typeof (result as Promise<void>).catch === "function") {
          (result as Promise<void>).catch((err) => {
            console.error("[LIFECYCLE] Interval async error:", err);
          });
        }
      } catch (err) {
        console.error("[LIFECYCLE] Interval sync error:", err);
      }
    }, intervalMs);
    this.intervals.push(timer);
    return timer;
  }

  public clearAll(): void {
    for (const timer of this.intervals) {
      clearInterval(timer);
    }
    this.intervals = [];
  }

  public markShuttingDown(): void {
    this.isShuttingDown = true;
    this.clearAll();
  }

  public get activeIntervalsCount(): number {
    return this.intervals.length;
  }

  public get isShuttingDownState(): boolean {
    return this.isShuttingDown;
  }
}

export const serverLifecycle = new ServerLifecycleManager();

let isShuttingDown = false;

export async function handleFatalError(
  type: "uncaughtException" | "unhandledRejection" | "SIGTERM" | "SIGINT",
  error?: unknown
): Promise<void> {
  const isSignal = type === "SIGTERM" || type === "SIGINT";
  if (error) {
    const errorMessage = error instanceof Error ? error.stack || error.message : String(error);
    console.error(`[FATAL] ${type} encountered:`, errorMessage);
  } else {
    console.log(`[LIFECYCLE] ${type} signal received; starting graceful shutdown`);
  }

  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  // Immediately cancel all background intervals and background workers
  serverLifecycle.markShuttingDown();
  try {
    stopEmailWorker();
  } catch (workerErr) {
    console.error("[LIFECYCLE] Error stopping email worker:", workerErr);
  }

  // Bounded failsafe timer: guarantee process termination within 4 seconds
  const failsafeTimer = setTimeout(() => {
    console.error("[LIFECYCLE] Graceful drain timed out; forcing exit");
    process.exit(isSignal ? 0 : 1);
  }, 4000);
  failsafeTimer.unref();

  try {
    // 1. Stop HTTP listener from taking new connections
    if (server && typeof server.close === "function") {
      server.close(() => {
        console.log("[LIFECYCLE] HTTP server stopped accepting connections");
      });
    }

    // 2. Close Socket.IO server
    if (io) {
      io.close();
    }

    // 3. Close PostgreSQL pool
    if (postgres && typeof postgres.end === "function") {
      await postgres.end().catch((err: unknown) => {
        console.error("[LIFECYCLE] Error closing PostgreSQL pool:", err);
      });
    }

    // 4. Disconnect Redis instances
    if (edgeRedis?.client) {
      edgeRedis.client.disconnect();
    }
    if (metricsRedis?.client) {
      metricsRedis.client.disconnect();
    }

    console.log(`[LIFECYCLE] Clean shutdown complete for ${type}`);
  } catch (err: unknown) {
    console.error("[LIFECYCLE] Error during shutdown drain:", err);
  } finally {
    process.exit(isSignal ? 0 : 1);
  }
}

process.on("uncaughtException", (err) => {
  void handleFatalError("uncaughtException", err);
});
process.on("unhandledRejection", (reason) => {
  void handleFatalError("unhandledRejection", reason);
});
process.on("SIGTERM", () => {
  void handleFatalError("SIGTERM");
});
process.on("SIGINT", () => {
  void handleFatalError("SIGINT");
});



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
const getCorsOptions = (): cors.CorsOptions => {
  if (process.env.NODE_ENV !== "production") {
    return {
      origin: true,
      credentials: true,
    };
  }

  const allowedOrigins = new Set<string>();

  if (config.APP_URL) {
    try {
      allowedOrigins.add(new URL(config.APP_URL).origin);
    } catch {
      console.warn("[CORS] Ignoring malformed APP_URL");
    }
  }

  if (config.CORS_ALLOWED_ORIGINS) {
    for (const origin of config.CORS_ALLOWED_ORIGINS.split(",")) {
      const trimmed = origin.trim();

      if (!trimmed) {
        continue;
      }

      try {
        allowedOrigins.add(new URL(trimmed).origin);
      } catch {
        console.warn(`[CORS] Ignoring malformed origin: ${trimmed}`);
      }
    }
  }

  return {
    origin: (origin, callback) => {
      // Server-to-server requests and health checks.
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      console.warn(`[CORS] Rejected origin: ${origin}`);
      callback(new Error("CORS_ORIGIN_NOT_ALLOWED"));
    },
    credentials: true,
  };
};

const corsOptions = getCorsOptions();

const io = new Server(server, {
  cors: corsOptions,

  // Allow Socket.IO to negotiate the best available transport.
  transports: ["polling", "websocket"],

  // Upgrade polling → websocket when possible.
  allowUpgrades: true,
});
registerNotificationNamespace(io);
notificationService.setIo(io);
const rooms = new Map<string, Room>();
const roomReconstructor = new RoomReconstructor(postgres ?? null);
const roomLifecycleManager = new RoomLifecycleManager(postgres ?? null, rooms);

export async function getOrCreateRoom(rawRoomId: string): Promise<Room | null> {
  const cleanId = sanitizeRoomId(rawRoomId);
  if (!cleanId) return null;
  const existing = rooms.get(cleanId);
  if (existing) return existing;

  const shard = resolveShard(cleanId);
  const isCorrectShard = !config.SHARD || shard === Number(config.SHARD);
  if (!isCorrectShard) return null;

  if (!postgres) return null;
  try {
    const persistedRoom = (
      await postgres.query<PersistentRoom>(
        `SELECT * from rooms where "roomId" = $1`,
        [cleanId],
      )
    )?.rows?.[0];

    if (!persistedRoom) return null;

    if (rooms.has(cleanId)) return rooms.get(cleanId)!;

    const { room } = await roomReconstructor.reconstructRoom(persistedRoom, io);
    rooms.set(cleanId, room);
    console.log(
      "loading room %s into memory on shard %s",
      cleanId,
      config.SHARD,
    );
    return room;
  } catch (err) {
    console.error(`[Room] Failed to load room ${cleanId} from database:`, err);
    return null;
  }
}

// Background engine pre-load
io.engine.use((req: any, res: Response, next: () => void) => {
  const rawRoomId = req._query?.roomId;
  if (!rawRoomId) {
    return next();
  }
  const roomId = sanitizeRoomId(rawRoomId);
  req._query.roomId = roomId;
  if (!rooms.has(roomId)) {
    getOrCreateRoom(roomId).catch((err) => {
      console.warn(`[Engine] Background room pre-load error for ${roomId}:`, err);
    });
  }
  next();
});

// Helper to cleanly unregister room namespaces regardless of slash prefix
export function unregisterRoomNamespace(roomId: string) {
  if (!roomId) return;
  (io as any)._nsps?.delete(roomId);
  (io as any)._nsps?.delete(`/${roomId}`);
}

// Dynamic room namespace handler to prevent "Invalid namespace" on direct WebSocket or initial connection
const dynamicRoomNsp = io.of(/^\/[a-zA-Z0-9_\-\s%]+$/);
dynamicRoomNsp.use(async (socket, next) => {
  const cleanId = sanitizeRoomId(socket.nsp.name);
  if (!cleanId || cleanId === "notifications") {
    return next();
  }
  try {
    let memoryRoom = rooms.get(cleanId);
    if (!memoryRoom) {
      memoryRoom = (await getOrCreateRoom(cleanId)) || undefined;
    }
    if (!memoryRoom) {
      return next(new Error("ROOM_NOT_FOUND"));
    }
    next();
  } catch (err) {
    console.error(`[Socket] Failed loading dynamic room namespace ${cleanId}:`, err);
    next(new Error("ROOM_LOAD_ERROR"));
  }
});
// Following functions iterate over in-memory rooms
serverLifecycle.registerInterval(minuteMetrics, 60 * 1000);
serverLifecycle.registerInterval(checkIdleRooms, 30 * 1000);
serverLifecycle.registerInterval(saveRooms, 15 * 1000);
serverLifecycle.registerInterval(expireRooms, 60 * 1000);
serverLifecycle.registerInterval(checkEndingSoonRooms, 60 * 1000);
// NOTIFY-002: Strict Provider Startup Validation (Fail-closed)
EmailProviderRegistry.validateActiveProvider()
  .then((provider) => {
    console.log(`[EmailProvider] Active transactional provider initialized: ${provider.name}`);
  })
  .catch((err) => {
    console.error('[EmailProvider] Startup validation failed:', err);
    if (process.env.NODE_ENV === 'production') {
      throw err;
    }
  });

startEmailWorker();


// NOTIFY-001A: Authoritative retention maintenance (every 1 hour)
// Invariant: UNREAD notifications are NEVER purged; only expired READ notifications and aged outbox records.
const retentionInterval = 60 * 60 * 1000;
serverLifecycle.registerInterval(async () => {
  try {
    const readPurged = await purgeReadNotificationsExpired();
    const sentRetentionDays = Number(config.EMAIL_SENT_RETENTION_DAYS) || 14;
    const failedRetentionDays = Number(config.EMAIL_FAILED_RETENTION_DAYS) || 60;
    const sentPurged = await purgeSentOutboxRows(sentRetentionDays);
    const failedPurged = await purgeFailedOutboxRows(failedRetentionDays);
    if (readPurged > 0 || sentPurged > 0 || failedPurged > 0) {
      console.log(
        `[Retention] Purged: ${readPurged} read notifications, ${sentPurged} sent outbox, ${failedPurged} failed outbox`,
      );
    }
  } catch (err) {
    console.error("[Retention] Error running notification retention purge:", err);
  }
}, retentionInterval);

if (process.env.NODE_ENV === "development") {
  try {

    // import('./syncSubs.ts');
    // import('./timeSeries.ts');
  } catch (e) {
    console.error(e);
  }
}

app.use(cors(corsOptions));

// NOTIFY-004: Production Security Headers (WebRTC, WebSocket, Media safe)
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  const scriptSrc = isProd
    ? "script-src 'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.youtube.com https://s.ytimg.com";
  const csp = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: data: https:",
    "connect-src 'self' ws: wss: https: blob:",
    "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
  ].join("; ");
  res.setHeader("Content-Security-Policy", csp);
  next();
});

function requireInternalAuth(req: Request, res: Response, next: NextFunction): void {
  const secret = config.INTERNAL_API_SECRET;
  if (!secret) {
    const clientIp = String(req.ip || req.socket?.remoteAddress || "");
    const isLoopback = clientIp.includes("127.0.0.1") || clientIp === "::1" || clientIp === "::ffff:127.0.0.1";
    if (!isLoopback && process.env.NODE_ENV === "production") {
      res.status(403).json({ error: "FORBIDDEN: Internal endpoint accessible only via loopback or INTERNAL_API_SECRET" });
      return;
    }
    return next();
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : req.headers["x-internal-secret"];
  if (token !== secret) {
    res.status(401).json({ error: "UNAUTHORIZED: Valid INTERNAL_API_SECRET required" });
    return;
  }
  next();
}

function extractBearerToken(req: express.Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    return token || undefined;
  }
  return undefined;
}

app.use(
  bodyParser.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  }),
);
app.use(bodyParser.raw({ type: "text/plain", limit: 1000000 }));
app.use("/api/notifications", createNotificationRouter(io, (roomId) => rooms.get(roomId)));
app.use("/api/invitations", createInvitationRouter({ roomLookup: (roomId) => rooms.get(roomId), rooms }));
app.use("/api", profileRouter);
app.use(createFeedbackRouter({ postgres, supabaseAdmin }));

// NOTIFY-002: Universal Provider Delivery Webhook Ingress (POST /internal/webhooks/email/:provider)
app.post("/internal/webhooks/email/:provider", async (req, res) => {
  await providerWebhookRouter.handleWebhook(req, res);
});


// NOTIFY-001A & NOTIFY-004: Database-derived Notification Health Probe (locked behind internal boundary)
app.get("/internal/health/notifications", requireInternalAuth, async (_req, res) => {
  try {
    const report = await getNotificationHealthReport();
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: "HEALTH_CHECK_FAILED", details: err?.message });
  }
});

app.get("/ping", (_req, res) => {
  res.json("pong");
});

app.use(createSubtitleRouter());
app.use(compression());
app.use(createOperatorRouter({ postgres }));
app.use(createMediaMetadataRouter({ postgres }));
app.use(createRoomLifecycleRouter({ rooms, io, postgres, getOrCreateRoom, unregisterRoomNamespace }));
app.use(createRoomConfigRouter({ rooms, io, postgres }));
app.use(createRoomAdmissionRouter({ rooms, postgres, getOrCreateRoom }));
app.use(createRoomDiscoveryRouter({ rooms, postgres, getOrCreateRoom }));
app.use(createRoomOwnerInspectionRouter({ postgres }));
app.use(createPublicUtilityRouter({ postgres }));

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

app.post("/api/auth/duplicate-signup-alert", async (req, res) => {
  try {
    const rawEmail = req.body?.email;
    if (!rawEmail || typeof rawEmail !== "string") {
      res.json({ success: true });
      return;
    }

    const email = rawEmail.trim().toLowerCase();
    if (!isAllowedEmailDomain(email)) {
      res.json({ success: true });
      return;
    }

    const clientIp = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
    const userAgent = String(req.headers["user-agent"] || "");

    // Rate limit per email (max 3 in 15 min) and per IP (max 10 in 10 min) to prevent abuse
    const emailRateLimit = await checkRateLimit(`dup-signup:email:${email}`, 3, 15 * 60);
    const ipRateLimit = await checkRateLimit(`dup-signup:ip:${clientIp || 'unknown'}`, 10, 10 * 60);

    if (!emailRateLimit.allowed || !ipRateLimit.allowed) {
      res.json({ success: true });
      return;
    }

    await recordAttempt(`dup-signup:email:${email}`, 15 * 60);
    await recordAttempt(`dup-signup:ip:${clientIp || 'unknown'}`, 10 * 60);

    // Verify whether account exists before sending notification
    const existingUser = await getUserByEmail(email);
    if (!existingUser) {
      // Do not send alert if user does not exist (prevents unsolicited notifications)
      res.json({ success: true });
      return;
    }

    // Trigger security alert email asynchronously without blocking the client response
    sendDuplicateSignupSecurityAlert({
      email,
      ipAddress: clientIp || undefined,
      userAgent: userAgent || undefined,
      attemptedAt: new Date(),
    }).catch((err) => {
      console.error("[Auth] Duplicate signup alert dispatch error:", err);
    });

    res.json({ success: true });
  } catch (err) {
    console.error("[Auth] Duplicate signup alert handler exception:", err);
    res.json({ success: true });
  }
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

// FEEDBACK & ABUSE REPORTING: Handled by modular router mounted above (routes/feedbackRouter.ts)

// OPERATOR & ADMIN ENDPOINTS: Handled by modular router mounted above (routes/operatorRouter.ts)

// MEDIA METADATA & YOUTUBE: Handled by modular router mounted above (routes/mediaMetadataRouter.ts)

// ROOM CONFIGURATION: Handled by modular router mounted above (routes/roomConfigRouter.ts)

app.delete("/deleteAccount", async (req, res) => {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "invalid user token" });
    return;
  }
  const decoded = await validateUserToken("", token, false);
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
        unregisterRoomNamespace(rId);
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

// RUNTIME CLIENT METADATA: Handled by modular router mounted above (routes/mediaMetadataRouter.ts)



// PUBLIC CONTENT & UTILITIES: Handled by modular router mounted above (routes/publicUtilityRouter.ts)

// Proxy video segments
app.get("/proxy/*splat", async (req, res) => {
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

async function checkIdleRooms() {
  const roomKeys = Array.from(rooms.keys());
  for (const roomId of roomKeys) {
    try {
      const res = await roomLifecycleManager.unloadIfIdle(roomId);
      if (res.evacuated) {
        unregisterRoomNamespace(roomId);
        console.log(`[Lifecycle] Room ${roomId} evacuated to inactive status via CAS`);
      }
    } catch (err) {
      console.warn(`[Lifecycle] Idle evacuation check failed for ${roomId}:`, err);
    }
  }
}

async function saveRooms() {
  let saveCount = 0;
  let skipCount = 0;
  const start = Date.now();
  await Promise.all(
    Array.from(rooms.entries()).map(async ([key, room]) => {
      if (room.roster.length > 0) {
        room.lastUpdateTime = new Date();
        await room.saveRoom();
        saveCount += 1;
      } else {
        skipCount += 1;
      }
    }),
  );
  const end = Date.now();
  if (saveCount > 0) {
    console.log(
      "[SAVEROOMS] %s active rooms saved in %sms, %s skipped",
      saveCount,
      end - start,
      skipCount,
    );
  }
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
        if (row.ownerId) {
          notificationService
            .notifyUser({
              userId: row.ownerId,
              type: "ROOM_ENDED",
              title: "Room Expired",
              body: "Your room has expired and ended.",
              metadata: { roomId: row.roomId, action: "go_home", targetUrl: "/home" },
              eventId: `ROOM_ENDED:${row.roomId}:${new Date(row.timestamp).getTime()}`,
            })
            .catch((err) => console.error("[EXPIRE] Failed to notify room owner:", err));
        }

        if (room) {
          const participantUids = typeof room.getConnectedParticipantUids === "function"
            ? room.getConnectedParticipantUids()
            : [];
          for (const pUid of participantUids) {
            if (pUid !== row.ownerId) {
              notificationService
                .notifyUser({
                  userId: pUid,
                  type: "ROOM_ENDED",
                  title: "Room Expired",
                  body: `The room "${room.roomTitle || row.roomId}" has expired and ended.`,
                  metadata: { roomId: row.roomId, action: "go_home", targetUrl: "/home" },
                  eventId: `ROOM_ENDED:${row.roomId}:${new Date(row.timestamp).getTime()}:${pUid}`,
                })
                .catch((err) => console.error("[EXPIRE] Failed to notify participant of room ended:", err));
            }
          }

          room.status = 'expired';
          room.addChatMessage(null, {
            id: '',
            system: true,
            msg: 'This room has expired.',
          });



          room.disconnectAllSockets();
        }
      }
    }
  } catch (e) {
    console.error("Error expiring rooms:", e);
  }
}

async function checkEndingSoonRooms() {
  if (!postgres) return;
  try {
    const result = await postgres.query(`
      WITH candidates AS (
        SELECT "roomId"
        FROM public.rooms
        WHERE status = 'active'
          AND "isPermanent" = false
          AND "expiresAt" IS NOT NULL
          AND "expiresAt" > clock_timestamp()
          AND "expiresAt" <= clock_timestamp() + interval '15 minutes'
          AND "endingNotifiedAt" IS NULL
        FOR UPDATE SKIP LOCKED
      )
      UPDATE public.rooms r
      SET "endingNotifiedAt" = clock_timestamp()
      FROM candidates c
      WHERE r."roomId" = c."roomId"
      RETURNING r."roomId", r.owner_id AS "ownerId", r."expiresAt", r."roomTitle";
    `);

    if (result.rowCount && result.rowCount > 0) {
      console.log(`[ENDING_SOON] Dispatched 15-minute advance warnings for ${result.rowCount} rooms`);
      for (const row of result.rows) {
        if (row.ownerId) {
          notificationService
            .notifyUser({
              userId: row.ownerId,
              type: "ROOM_ENDING",
              title: "Room Ending Soon",
              body: `Your room "${row.roomTitle || row.roomId}" will expire in approximately 15 minutes.`,
              metadata: { roomId: row.roomId, action: "open_room", targetUrl: `/room/${encodeURIComponent(row.roomId)}` },
              eventId: `ROOM_ENDING:${row.roomId}:15m`,
            })
            .catch((err) => console.error("[ENDING_SOON] Failed to notify owner:", err));
        }
        const room = rooms.get(row.roomId);
        if (room) {
          room.addChatMessage(null, {
            id: '',
            system: true,
            msg: 'Notice: This room will expire in 15 minutes.',
          });
          const participantUids = typeof room.getConnectedParticipantUids === "function"
            ? room.getConnectedParticipantUids()
            : [];
          for (const pUid of participantUids) {
            if (pUid !== row.ownerId) {
              notificationService
                .notifyUser({
                  userId: pUid,
                  type: "ROOM_ENDING",
                  title: "Room Ending Soon",
                  body: `The room "${room.roomTitle || row.roomId}" will expire in approximately 15 minutes.`,
                  metadata: { roomId: row.roomId, action: "open_room", targetUrl: `/room/${encodeURIComponent(row.roomId)}` },
                  eventId: `ROOM_ENDING:${row.roomId}:15m:${pUid}`,
                })
                .catch((err) => console.error("[ENDING_SOON] Failed to notify participant:", err));
            }
          }
        }
      }
    }
  } catch (e: any) {
    console.warn("Error checking ending soon rooms:", e?.message || e);
  }
}

// Dirty presence snapshot tracking (Phase 4 Command Economics: dirty-set suppression)
const lastPresenceSnapshot = new Map<string, string>();

async function minuteMetrics() {
  const roomArr = Array.from(rooms.values());
  const dirtyPresenceBatch: Record<string, string> = {};
  const emptyRoomsToClean: string[] = [];

  for (let room of roomArr) {


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

  }

  // Flush dirty presence batch in single atomic operation (1 command for all changed rooms)
  if (Object.keys(dirtyPresenceBatch).length > 0) {
    await redisEdge.updateRoomPresenceBatch(dirtyPresenceBatch).catch(() => { });
  }
  if (emptyRoomsToClean.length > 0) {
    await redisEdge.removeRoomPresenceBatch(emptyRoomsToClean).catch(() => { });
  }

  // Report shard metrics with atomic write-with-TTL
  const obj: ShardMetric = {
    uptime: process.uptime(),
    mem: process.memoryUsage().rss,
    roomCount: rooms.size,
    users: io.engine.clientsCount,
  };
  try {
    if (edgeRedis.client && edgeRedis.isReady()) {
      await edgeRedis.execute("stats", "setex", (c) => c.setex(
        `shardMetrics:${config.SHARD ?? 0}`,
        120,
        JSON.stringify(obj),
      ));
    }
  } catch (err) {
    // Redis shard metrics degradation fallback
  }
}

