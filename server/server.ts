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
import { makeRoomName, makeUserName } from "./utils/moniker.ts";
import {
  hashRoomPasscode,
  verifyRoomPasscode,
  isBcryptHash,
  encryptPasscodeForOwner,
  decryptPasscodeForOwner,
  computePasscodeFingerprint,
} from "./utils/roomPasscode.ts";
import { issueRoomAdmissionToken } from "./utils/admissionToken.ts";
import { isTerminalRoom } from "./lifecycle/types.ts";
import { RoomReconstructor } from "./lifecycle/roomReconstruction.ts";
import { RoomLifecycleManager } from "./lifecycle/roomManager.ts";
import {
  checkPasscodeRateLimits,
  recordPasscodeFailure,
  resetPasscodeLimits,
  checkRateLimit,
  recordAttempt,
} from "./utils/rateLimit.ts";
import { sendDuplicateSignupSecurityAlert } from "./notifications/securityAlerts.ts";
import { sanitizeRoomId } from "./strip_slashes.ts";
import { isAllowedEmailDomain } from "./utils/emailDomain.ts";
import { profileRouter } from "./routes/profile.ts";
import { createSubtitleRouter } from "./routes/subtitleRouter.ts";
import { createFeedbackRouter } from "./routes/feedbackRouter.ts";
import { createOperatorRouter } from "./routes/operatorRouter.ts";
import { createMediaMetadataRouter } from "./routes/mediaMetadataRouter.ts";
import { createRoomLifecycleRouter } from "./routes/roomLifecycleRouter.ts";
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

// Response shape for GET /roomEntitlements.
// Numeric fields are narrowed with Number() — never bare "as number" casts.
interface RoomEntitlementResponse {
  planId: string;
  planDisplayName: string;
  enabled: boolean;
  maxTotalRooms: number;
  maxWatchRooms: number;
  maxPermanentRooms: number;
  // DOMAIN PLATFORM MAX = 500 | FREE PLAN MAX = 10 | CURRENT USER = this field
  maxParticipantCapacity: number;
  // Arbitrary integer 1–720; no discrete set at any layer
  maxRoomDurationHours: number;
  hasOverrides: boolean;
  usageTotalRooms: number;
  usageWatchRooms: number;
  usagePermanentRooms: number;
}

app.get("/roomEntitlements", async (req, res) => {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  const decoded = await validateUserToken("", token);
  if (decoded === "EMAIL_NOT_VERIFIED") {
    res.status(403).json({ error: { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required." } });
    return;
  }
  if (!decoded) {
    res.status(401).json({ error: "Invalid authentication token." });
    return;
  }

  if (!postgres) {
    res.status(503).json({ error: "Database unavailable." });
    return;
  }

  try {
    const result = await postgres.query(
      `SELECT
         e.plan_id            AS "planId",
         e.plan_display_name  AS "planDisplayName",
         e.enabled,
         e.max_total_rooms    AS "maxTotalRooms",
         e.max_watch_rooms    AS "maxWatchRooms",
         e.max_permanent_rooms AS "maxPermanentRooms",
         e.max_participant_capacity AS "maxParticipantCapacity",
         e.max_room_duration_hours  AS "maxRoomDurationHours",
         e.has_overrides      AS "hasOverrides",
         COALESCE(u.total_rooms,     0) AS "usageTotalRooms",
         COALESCE(u.watch_rooms,     0) AS "usageWatchRooms",
         COALESCE(u.permanent_rooms, 0) AS "usagePermanentRooms"
       FROM public.resolve_account_entitlement($1) e
       LEFT JOIN public.account_room_usage u ON u.account_id = $1`,
      [decoded.uid]
    );

    if (result.rows.length === 0) {
      // resolve_account_entitlement returned no row — account not provisioned.
      // Distinct 404 semantics; contrast with the 500 catch block below.
      res.status(404).json({
        error: { code: "ACCOUNT_ENTITLEMENT_NOT_FOUND", message: "No subscription plan found for this account." },
      });
      return;
    }

    const row = result.rows[0];
    const response: RoomEntitlementResponse = {
      planId: String(row.planId ?? ""),
      planDisplayName: String(row.planDisplayName ?? ""),
      enabled: Boolean(row.enabled),
      maxTotalRooms: Number(row.maxTotalRooms),
      maxWatchRooms: Number(row.maxWatchRooms),
      maxPermanentRooms: Number(row.maxPermanentRooms),
      maxParticipantCapacity: Number(row.maxParticipantCapacity),
      maxRoomDurationHours: Number(row.maxRoomDurationHours),
      hasOverrides: Boolean(row.hasOverrides),
      usageTotalRooms: Number(row.usageTotalRooms),
      usageWatchRooms: Number(row.usageWatchRooms),
      usagePermanentRooms: Number(row.usagePermanentRooms),
    };
    res.json(response);
  } catch (err: any) {
    const msg: string = err?.message ?? "";
    if (msg.includes("ACCOUNT_ENTITLEMENT_NOT_FOUND")) {
      res.status(404).json({
        error: { code: "ACCOUNT_ENTITLEMENT_NOT_FOUND", message: "No subscription plan found for this account." },
      });
      return;
    }
    console.error("GET /roomEntitlements error:", err);
    res.status(500).json({ error: "Failed to load entitlement data." });
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
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Authentication is required to create a room." });
    return;
  }
  const decoded = await validateUserToken("", token);
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
  // Capacity range validation.
  // DOMAIN PLATFORM MAX = 500 (rooms_max_participants_check DB constraint)
  // FREE PLAN MAX = 10 (entitlement — fetched below via preliminary STABLE read)
  // The authoritative enforcement boundary remains inside create_room_authoritative().
  if (!postgres) {
    res.status(503).json({ error: "Database unavailable." });
    return;
  }
  const entRow = await postgres.query(
    `SELECT max_participant_capacity, max_room_duration_hours
     FROM public.resolve_account_entitlement($1)`,
    [decoded.uid]
  );
  if (entRow.rows.length === 0) {
    res.status(403).json({
      error: {
        code: "ACCOUNT_ENTITLEMENT_NOT_FOUND",
        message: "No active subscription plan found for this account.",
      },
    });
    return;
  }
  const planCapacityCeiling = Number(entRow.rows[0].max_participant_capacity);
  const planDurationCeiling = Number(entRow.rows[0].max_room_duration_hours);
  if (!Number.isFinite(planCapacityCeiling) || !Number.isFinite(planDurationCeiling)) {
    console.error("createRoom: malformed entitlement row for uid:", decoded.uid, entRow.rows[0]);
    res.status(503).json({ error: "Malformed entitlement data." });
    return;
  }

  let maxParticipants = planCapacityCeiling;
  if (req.body?.maxParticipants !== undefined && req.body?.maxParticipants !== null) {
    const parsedCapacity = Number(req.body.maxParticipants);
    if (!Number.isInteger(parsedCapacity) || parsedCapacity < 2 || parsedCapacity > planCapacityCeiling) {
      res.status(400).json({
        error: `Participant capacity must be an integer between 2 and ${planCapacityCeiling}.`,
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
  let requestedDurationHours = Math.min(3, planDurationCeiling);
  if (typeof req.body?.durationHours === "number" && req.body.durationHours > 0) {
    requestedDurationHours = Math.min(Math.max(1, Math.floor(req.body.durationHours)), planDurationCeiling);
  } else if (typeof req.body?.sessionTimeHours === "number" && req.body.sessionTimeHours > 0) {
    requestedDurationHours = Math.min(Math.max(1, Math.floor(req.body.sessionTimeHours)), planDurationCeiling);
  }
  const expiresAt = isPermanent ? null : new Date(now.getTime() + requestedDurationHours * 60 * 60 * 1000);

  if (postgres) {
    try {
      const passcodeHash = await hashRoomPasscode(rawPasscode);
      const ownerPasscodeEncrypted = encryptPasscodeForOwner(rawPasscode);

      await postgres.query(
        `SELECT public.create_room_authoritative(
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
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
          maxParticipants,
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
      if (errMsg.includes("ROOM_DURATION_EXCEEDS_PLAN_LIMIT")) {
        res.status(400).json({
          error: "Requested room duration exceeds the maximum duration permitted by your subscription plan.",
        });
        return;
      }
      if (errMsg.includes("ACCOUNT_ENTITLEMENT_NOT_FOUND")) {
        res.status(403).json({
          error: "No active subscription plan or entitlement found for this account.",
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
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: { code: "FORBIDDEN", message: "Authentication required" } });
    return;
  }
  const decoded = await validateUserToken("", token, false);
  if (!decoded || decoded === "EMAIL_NOT_VERIFIED") {
    res.status(403).json({ error: { code: "FORBIDDEN", message: "Forbidden" } });
    return;
  }

  const rawRoomId = req.body?.roomId;
  const coverPhoto = req.body?.coverPhoto;

  if (!rawRoomId || coverPhoto === undefined) {
    res.status(400).json({ error: { code: "FORBIDDEN", message: "Missing parameters" } });
    return;
  }

  if (!postgres) {
    res.status(500).json({ error: { code: "FORBIDDEN", message: "Database not configured" } });
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
    res.status(403).json({ error: { code: "FORBIDDEN", message: "Forbidden" } });
    return;
  }

  const roomRow = roomCheck.rows[0];
  const now = Date.now();
  const isExpired = !roomRow.isPermanent && roomRow.expiresAt && new Date(roomRow.expiresAt).getTime() <= now;
  const isDbActive = roomRow.status === 'active' && !isExpired;

  if (isDbActive || isMemActive) {
    res.status(403).json({
      error: {
        code: "FORBIDDEN",
        message: "Cannot change room cover while the room is active. Please end the watch session or wait until all participants leave.",
      },
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
    res.status(403).json({ error: { code: "FORBIDDEN", message: "Forbidden" } });
    return;
  }
  res.json({ success: true });
});

app.post("/updateRoomSettings", async (req, res) => {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const decoded = await validateUserToken("", token, false);
  if (!decoded || decoded === "EMAIL_NOT_VERIFIED") {
    res.status(403).json({ error: { code: "FORBIDDEN", message: "Forbidden" } });
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
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Forbidden" } });
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
  const token = extractBearerToken(req);

  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const decoded = await validateUserToken("", token, false);
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

  // Attempt to decode caller token if provided strictly via Authorization header
  let callerUid: string | undefined;
  const token = extractBearerToken(req);

  if (token) {
    try {
      const decoded = await validateUserToken("", token);
      if (decoded && decoded !== "EMAIL_NOT_VERIFIED") {
        callerUid = decoded.uid;
      }
    } catch {
      // Best-effort session check
    }
  }

  try {
    const result = await postgres?.query(
      `SELECT r."roomId", r."roomTitle", r."roomDescription", r."coverPhoto", r.status, r."expiresAt", r."isPermanent",
              (r.passcode IS NOT NULL AND r.passcode <> '') as "requiresPasscode", r.owner_id, r.participants_locked, r.max_participants,
              p.display_name as "hostName"
       FROM rooms r
       LEFT JOIN profiles p ON r.owner_id = p.id
       WHERE r."roomId" = $1`,
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
    let isHost = isOwner;
    let memoryRoom = rooms.get(cleanRoomId);
    if (!memoryRoom) {
      memoryRoom = (await getOrCreateRoom(cleanRoomId)) || undefined;
    }
    let isHostPresent = false;
    if (memoryRoom && typeof memoryRoom.isHostPresent === "function") {
      isHostPresent = memoryRoom.isHostPresent();
    }
    if (memoryRoom && callerUid) {
      if (typeof memoryRoom.isHostUid === "function") {
        isHost = isHost || memoryRoom.isHostUid(callerUid);
      } else if (memoryRoom.currentHostUid) {
        isHost = isHost || memoryRoom.currentHostUid === callerUid;
      }
    }

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
      isHost,
      owner_id: isOwner ? row.owner_id : null,
      isHostPresent: Boolean(isHostPresent),
      hostName: row.hostName || "Host",
      isPermanent: Boolean(row.isPermanent),
    });
  } catch (err) {
    console.error("Error fetching roomInfo:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/verifyPasscode", async (req, res) => {
  const { roomId, passcode, sessionId } = req.body || {};
  if (!roomId || typeof roomId !== "string") {
    res.status(400).json({ valid: false, error: "Missing room identifier." });
    return;
  }

  const cleanRoomId = sanitizeRoomId(roomId);

  // Extract client IP and user identity for rate limiting & token binding
  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown";

  // Authenticate caller strictly from Supabase token
  let callerUid: string | undefined;
  const token = extractBearerToken(req);

  if (token) {
    try {
      const decoded = await validateUserToken("", token);
      if (decoded && decoded !== "EMAIL_NOT_VERIFIED") {
        callerUid = decoded.uid;
      }
    } catch { }
  }

  if (!callerUid) {
    res.status(401).json({
      valid: false,
      error: "Authentication required to enter room.",
      code: "AUTH_REQUIRED",
    });
    return;
  }

  const cleanSessionId =
    typeof sessionId === "string" && sessionId.trim()
      ? sessionId.trim()
      : crypto.randomUUID();

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
      `SELECT passcode, status, owner_id, participants_locked, max_participants, "isPermanent", "expiresAt" FROM rooms WHERE "roomId" = $1`,
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

    // Expired or ended rooms cannot be joined (evaluates dynamic expiresAt on temporary rooms)
    if (isTerminalRoom(row)) {
      res.status(401).json({ valid: false, error: "This room has ended or expired." });
      return;
    }

    let isValid = false;
    if (roomPasscode) {
      const cleanPasscode = typeof passcode === "string" ? passcode.trim() : "";
      if (cleanPasscode.length !== 8) {
        res.status(400).json({ valid: false, error: "Passcode must be strictly 8 characters." });
        return;
      }
      if (isBcryptHash(roomPasscode)) {
        isValid = await verifyRoomPasscode(cleanPasscode, roomPasscode);
      } else {
        isValid = cleanPasscode === roomPasscode;
      }
    } else {
      // Room without passcode: authenticated admission authorized directly
      isValid = true;
    }

    if (!isValid) {
      await recordPasscodeFailure(rateLimitTarget);
      res.status(401).json({ valid: false, error: "Incorrect room passcode. Please try again." });
      return;
    }

    // Resolve host authority for participant lock and capacity bypass
    const isOwner = Boolean(row.owner_id && callerUid === row.owner_id);
    let isHost = isOwner;
    const memoryRoom = rooms.get(cleanRoomId);
    if (memoryRoom && callerUid) {
      if (typeof memoryRoom.isHostUid === "function") {
        isHost = isHost || memoryRoom.isHostUid(callerUid);
      } else if (memoryRoom.currentHostUid) {
        isHost = isHost || memoryRoom.currentHostUid === callerUid;
      }
    }

    // Authoritative post-credential admission evaluation
    const admissionAuth = issueRoomAdmissionToken({
      roomId: cleanRoomId,
      callerUid,
      sessionId: cleanSessionId,
      roomRow: row,
      memoryRoom,
      isHost,
    });

    if (!admissionAuth.allowed) {
      res.status(admissionAuth.status).json({
        valid: false,
        error: admissionAuth.error,
        code: admissionAuth.code,
      });
      return;
    }

    if (postgres) {
      try {
        await postgres.query(
          `INSERT INTO public.room_admissions (room_id, user_id, admission_method, admitted_at, revoked_at, revoked_reason)
           VALUES ($1, $2::uuid, 'passcode', now(), NULL, NULL)
           ON CONFLICT (room_id, user_id) DO UPDATE
           SET admitted_at = now(), revoked_at = NULL, revoked_reason = NULL, admission_method = 'passcode'`,
          [cleanRoomId, callerUid]
        );
      } catch (admDbErr) {
        console.error("[Admission] Failed to record durable admission in DB:", admDbErr);
        res.status(500).json({ valid: false, error: "Database error recording room admission. Please try again.", code: "DATABASE_ERROR" });
        return;
      }
    }

    if (memoryRoom && callerUid) {
      memoryRoom.admittedMembers.add(callerUid);
    }

    // Success: reset rate limit attempts for this target and return token
    await resetPasscodeLimits(rateLimitTarget);
    res.json({ valid: true, admissionToken: admissionAuth.admissionToken, sessionId: cleanSessionId });
  } catch (err) {
    console.error("Error verifying passcode:", err);
    res.status(500).json({ valid: false, error: "Server error verifying passcode." });
  }
});

app.post("/room-admission/restore", async (req, res) => {
  const { roomId } = req.body || {};
  if (!roomId || typeof roomId !== "string") {
    res.status(400).json({ valid: false, error: "Missing room identifier." });
    return;
  }

  const cleanRoomId = sanitizeRoomId(roomId);

  const token = extractBearerToken(req);

  let callerUid: string | undefined;
  if (token) {
    try {
      const decoded = await validateUserToken("", token);
      if (decoded && decoded !== "EMAIL_NOT_VERIFIED") {
        callerUid = decoded.uid;
      }
    } catch { }
  }

  if (!callerUid) {
    res.status(401).json({
      valid: false,
      error: "Authentication required to restore room admission.",
      code: "AUTH_REQUIRED",
    });
    return;
  }

  try {
    const roomResult = await postgres?.query(
      `SELECT passcode, status, owner_id, participants_locked, max_participants, "isPermanent", "expiresAt" FROM rooms WHERE "roomId" = $1`,
      [cleanRoomId]
    );

    if (!roomResult || roomResult.rows.length === 0) {
      res.status(404).json({ valid: false, error: "Room not found.", code: "ROOM_NOT_FOUND" });
      return;
    }

    const row = roomResult.rows[0];
    if (isTerminalRoom(row)) {
      res.status(401).json({ valid: false, error: "This room has ended or expired.", code: "ROOM_TERMINAL" });
      return;
    }

    const isOwner = Boolean(row.owner_id && callerUid === row.owner_id);

    // 1. Check bans in database
    const banResult = await postgres?.query(
      `SELECT id FROM room_bans WHERE room_id = $1 AND user_id = $2::uuid LIMIT 1`,
      [cleanRoomId, callerUid]
    );
    if (banResult && banResult.rows.length > 0) {
      res.status(403).json({ valid: false, error: "You have been banned from this room.", code: "BANNED" });
      return;
    }

    // 2. Check live memory room ban state
    let memoryRoom = rooms.get(cleanRoomId);
    if (!memoryRoom) {
      memoryRoom = (await getOrCreateRoom(cleanRoomId)) || undefined;
    }
    if (memoryRoom && memoryRoom.isBanned?.(undefined, callerUid)) {
      res.status(403).json({ valid: false, error: "You have been removed from this room.", code: "BANNED" });
      return;
    }

    // 3. Durable admission check (non-owners must have an active admission record)
    if (!isOwner) {
      const admResult = await postgres?.query(
        `SELECT admission_method, admitted_at, revoked_at FROM room_admissions WHERE room_id = $1 AND user_id = $2::uuid`,
        [cleanRoomId, callerUid]
      );
      if (!admResult || admResult.rows.length === 0 || admResult.rows[0].revoked_at) {
        res.status(401).json({
          valid: false,
          error: "No active room admission found.",
          code: "NO_ACTIVE_ADMISSION",
        });
        return;
      }
    }

    // 4. Resolve host authority
    let isHost = isOwner;
    if (memoryRoom && callerUid) {
      if (typeof memoryRoom.isHostUid === "function") {
        isHost = isHost || memoryRoom.isHostUid(callerUid);
      } else if (memoryRoom.currentHostUid) {
        isHost = isHost || memoryRoom.currentHostUid === callerUid;
      }
    }

    // 5. Generate fresh session ID for this new connection
    const freshSessionId = crypto.randomUUID();

    // 6. Use shared authoritative admission engine issueRoomAdmissionToken with isRestoration: true
    const admissionAuth = issueRoomAdmissionToken({
      roomId: cleanRoomId,
      callerUid,
      sessionId: freshSessionId,
      roomRow: row,
      memoryRoom,
      isHost,
      isRestoration: true,
    });

    if (!admissionAuth.allowed) {
      res.status(admissionAuth.status).json({
        valid: false,
        error: admissionAuth.error,
        code: admissionAuth.code,
      });
      return;
    }

    if (memoryRoom && callerUid) {
      memoryRoom.admittedMembers.add(callerUid);
    }

    res.json({
      valid: true,
      admissionToken: admissionAuth.admissionToken,
      sessionId: freshSessionId,
      restored: true,
    });
  } catch (err) {
    console.error("Error restoring room admission:", err);
    res.status(500).json({ valid: false, error: "Server error restoring admission." });
  }
});

app.get("/resolveShard/:roomId", async (req, res) => {
  const cleanRoomId = sanitizeRoomId(req.params.roomId);
  const shardNum = resolveShard(cleanRoomId);
  res.send(String(config.SHARD ? shardNum : ""));
});

app.get("/listRooms", async (req, res) => {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const decoded = await validateUserToken("", token);
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
      const isEnded = derivedStatus === 'ended' || derivedStatus === 'expired';
      const currentPasscode = (isEnded || !r.owner_passcode) ? null : decryptPasscodeForOwner(r.owner_passcode);
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
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const decoded = await validateUserToken("", token);
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

    const isEnded = derivedStatus === 'ended' || derivedStatus === 'expired';
    const currentPasscode = (isEnded || !room.owner_passcode) ? null : decryptPasscodeForOwner(room.owner_passcode);

    // Fetch lifecycle events
    const lifecycleResult = await postgres?.query(
      `SELECT id, actor, event, "previousStatus", "newStatus", "previousExpiresAt", "newExpiresAt", reason, timestamp
       FROM room_lifecycle_events WHERE "roomId" = $1
       ORDER BY timestamp DESC`,
      [roomId]
    );

    // Fetch recent messages
    const messagesResult = await postgres?.query(
      `SELECT rm.id, rm.user_id, rm.message, rm.message_type, rm.event_type, rm.metadata, rm.created_at, rm.updated_at, rm.is_deleted, p.display_name as profile_name, p.avatar_url as profile_picture
       FROM room_messages rm
       LEFT JOIN profiles p ON rm.user_id = p.id
       WHERE rm.room_id = $1
       ORDER BY rm.created_at DESC, rm.id DESC LIMIT 20`,
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
      recentMessages: messagesResult?.rows.reverse() ?? [],
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

