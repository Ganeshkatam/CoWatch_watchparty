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
import { metricsRedis, edgeRedis } from "./utils/redis.ts";
import { supabaseAdmin } from "./utils/supabase.ts";

import { postgres } from "./utils/postgres.ts";
import axios, { isAxiosError } from "axios";
import crypto from "node:crypto";
import { resolveShard } from "./utils/resolveShard.ts";
import { RoomReconstructor } from "./lifecycle/roomReconstruction.ts";
import { RoomLifecycleManager } from "./lifecycle/roomManager.ts";
import { registerBackgroundMaintenance } from "./lifecycle/backgroundMaintenance.ts";
import { sanitizeRoomId } from "./strip_slashes.ts";
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
import { createInternalOperationsRouter } from "./routes/internalOperationsRouter.ts";
import { createMediaProxyRouter } from "./routes/mediaProxyRouter.ts";
import { createAuthAccountRouter } from "./routes/authAccountRouter.ts";
import { createAccountTeardownRouter } from "./routes/accountTeardownRouter.ts";
import { createIceServersRouter } from "./routes/iceServersRouter.ts";
import { registerNotificationNamespace } from "./notifications/notificationSocketNamespace.ts";
import { createNotificationRouter } from "./notifications/notificationRouter.ts";
import { createInvitationRouter } from "./invitations/invitationRouter.ts";
import { notificationService } from "./notifications/notificationService.ts";
import { startEmailWorker, stopEmailWorker } from "./notifications/emailWorker.ts";
import { EmailProviderRegistry } from "./notifications/emailProviderRegistry.ts";


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

    // 3. Concurrently drain PostgreSQL pool and Redis connections with bounded timeout
    const drainTimeout = new Promise<void>((resolve) => setTimeout(resolve, 2500));
    const drainActions = Promise.allSettled([
      postgres && typeof postgres.end === "function"
        ? postgres.end().catch((err: unknown) => console.error("[LIFECYCLE] Error closing PostgreSQL pool:", err))
        : Promise.resolve(),
      edgeRedis?.client
        ? Promise.resolve(edgeRedis.client.disconnect()).catch((err: unknown) => console.error("[LIFECYCLE] Error disconnecting edge Redis:", err))
        : Promise.resolve(),
      metricsRedis?.client
        ? Promise.resolve(metricsRedis.client.disconnect()).catch((err: unknown) => console.error("[LIFECYCLE] Error disconnecting metrics Redis:", err))
        : Promise.resolve(),
    ]);
    await Promise.race([drainActions, drainTimeout]);

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

  const allowedOrigins = new Set<string>([
    "https://cowatch.tomesphere.in",
    "https://www.cowatch.tomesphere.in",
    "https://tomesphere.in",
    "https://cowatch-api.tomesphere.in",
  ]);

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
  const bareNsp = (io as any)._nsps?.get(roomId);
  if (bareNsp) {
    bareNsp.removeAllListeners();
    (io as any)._nsps?.delete(roomId);
  }
  const slashNsp = (io as any)._nsps?.get(`/${roomId}`);
  if (slashNsp) {
    slashNsp.removeAllListeners();
    (io as any)._nsps?.delete(`/${roomId}`);
  }
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
// Background Scheduled Maintenance (Lifecycle, Persistence, Expiration, Metrics, Retention)
registerBackgroundMaintenance({
  rooms,
  postgres,
  io,
  roomLifecycleManager,
  unregisterRoomNamespace,
  serverLifecycle,
});

// NOTIFY-002: Strict Provider Startup Validation (Fail-closed)
EmailProviderRegistry.validateActiveProvider()
  .then((provider) => {
    console.log(`[EmailProvider] Active transactional provider initialized: ${provider.name}`);
    startEmailWorker();
  })
  .catch((err) => {
    // Transactional email is an optional capability. Keep the API available
    // when its provider is misconfigured. Leave pending outbox jobs untouched
    // until valid provider configuration is supplied.
    console.error('[EmailProvider] Startup validation failed; email delivery is unavailable until configuration is fixed:', err);
  });


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

// INTERNAL OPERATIONS & HEALTH: Handled by modular router (routes/internalOperationsRouter.ts)
app.use(createInternalOperationsRouter({ postgres }));

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
app.use(createIceServersRouter({ rooms, postgres }));

// AUTH & ACCOUNT SELF-SERVICE: Handled by modular router (routes/authAccountRouter.ts)
app.use(createAuthAccountRouter());

// FEEDBACK & ABUSE REPORTING: Handled by modular router mounted above (routes/feedbackRouter.ts)

// OPERATOR & ADMIN ENDPOINTS: Handled by modular router mounted above (routes/operatorRouter.ts)

// MEDIA METADATA & YOUTUBE: Handled by modular router mounted above (routes/mediaMetadataRouter.ts)

// ROOM CONFIGURATION: Handled by modular router mounted above (routes/roomConfigRouter.ts)

// DESTRUCTIVE ACCOUNT TEARDOWN: Handled by modular router (routes/accountTeardownRouter.ts)
app.use(createAccountTeardownRouter({ rooms, postgres, unregisterRoomNamespaceFn: unregisterRoomNamespace }));

// RUNTIME CLIENT METADATA: Handled by modular router mounted above (routes/mediaMetadataRouter.ts)



// PUBLIC CONTENT & UTILITIES: Handled by modular router mounted above (routes/publicUtilityRouter.ts)

// MEDIA PROXY: Handled by modular router (routes/mediaProxyRouter.ts)
app.use(createMediaProxyRouter());

