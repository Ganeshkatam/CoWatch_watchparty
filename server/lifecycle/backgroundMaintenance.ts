import type { Server } from "socket.io";
import type { Room } from "../room.ts";
import type { DatabasePool } from "./admissionCoordinator.ts";
import type { RoomLifecycleManager } from "./roomManager.ts";
import config from "../config.ts";
import { notificationService as defaultNotificationService } from "../notifications/notificationService.ts";
import { redisEdge as defaultRedisEdge, edgeRedis as defaultEdgeRedis } from "../utils/redis.ts";
import {
  purgeReadNotificationsExpired as defaultPurgeReadNotificationsExpired,
  purgeSentOutboxRows as defaultPurgeSentOutboxRows,
  purgeFailedOutboxRows as defaultPurgeFailedOutboxRows,
} from "../notifications/emailOutbox.ts";

export interface LifecycleIntervalRegistrar {
  registerInterval(fn: () => void | Promise<void>, intervalMs: number): NodeJS.Timeout;
}

export interface NotificationServiceDependency {
  notifyUser: (payload: {
    userId: string;
    type: string;
    title: string;
    body: string;
    metadata?: Record<string, unknown>;
    eventId?: string;
  }) => Promise<unknown>;
}

export interface RedisEdgeDependency {
  updateRoomPresenceBatch: (batch: Record<string, string>) => Promise<unknown>;
  removeRoomPresenceBatch: (rooms: string[]) => Promise<unknown>;
}

export interface EdgeRedisDependency {
  client?: unknown;
  isReady: () => boolean;
  execute: (
    name: string,
    cmd: string,
    fn: (client: { setex: (key: string, ttl: number, value: string) => Promise<unknown> }) => Promise<unknown>,
  ) => Promise<unknown>;
}

export interface BackgroundMaintenanceOptions {
  rooms: Map<string, Room>;
  postgres?: DatabasePool | null;
  io: Server;
  roomLifecycleManager: RoomLifecycleManager;
  unregisterRoomNamespace: (roomId: string) => void;
  serverLifecycle: LifecycleIntervalRegistrar;
  notificationService?: NotificationServiceDependency;
  redisEdge?: RedisEdgeDependency;
  edgeRedis?: EdgeRedisDependency;
  configOverride?: {
    SHARD?: string | number;
    EMAIL_SENT_RETENTION_DAYS?: string | number;
    EMAIL_FAILED_RETENTION_DAYS?: string | number;
  };
  purgeReadNotificationsExpiredFn?: () => Promise<number>;
  purgeSentOutboxRowsFn?: (days: number) => Promise<number>;
  purgeFailedOutboxRowsFn?: (days: number) => Promise<number>;
}

export interface BackgroundMaintenanceController {
  checkIdleRooms: () => Promise<void>;
  saveRooms: () => Promise<void>;
  expireRooms: () => Promise<void>;
  checkEndingSoonRooms: () => Promise<void>;
  minuteMetrics: () => Promise<void>;
  retentionMaintenance: () => Promise<void>;
  clearPresenceSnapshot: () => void;
  intervals: NodeJS.Timeout[];
}

// Dirty presence snapshot tracking (Phase 4 Command Economics: dirty-set suppression)
const lastPresenceSnapshot = new Map<string, string>();

export function clearPresenceSnapshot(): void {
  lastPresenceSnapshot.clear();
}

export function registerBackgroundMaintenance(
  options: BackgroundMaintenanceOptions,
): BackgroundMaintenanceController {
  const {
    rooms,
    postgres,
    io,
    roomLifecycleManager,
    unregisterRoomNamespace,
    serverLifecycle,
    notificationService = defaultNotificationService,
    redisEdge = defaultRedisEdge,
    edgeRedis = defaultEdgeRedis,
    configOverride,
    purgeReadNotificationsExpiredFn = defaultPurgeReadNotificationsExpired,
    purgeSentOutboxRowsFn = defaultPurgeSentOutboxRows,
    purgeFailedOutboxRowsFn = defaultPurgeFailedOutboxRows,
  } = options;

  const currentConfig = {
    SHARD: configOverride?.SHARD ?? config.SHARD,
    EMAIL_SENT_RETENTION_DAYS:
      configOverride?.EMAIL_SENT_RETENTION_DAYS ?? config.EMAIL_SENT_RETENTION_DAYS,
    EMAIL_FAILED_RETENTION_DAYS:
      configOverride?.EMAIL_FAILED_RETENTION_DAYS ?? config.EMAIL_FAILED_RETENTION_DAYS,
  };

  async function checkIdleRooms(): Promise<void> {
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

  async function saveRooms(): Promise<void> {
    let saveCount = 0;
    let skipCount = 0;
    const start = Date.now();
    await Promise.all(
      Array.from(rooms.entries()).map(async ([_key, room]) => {
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

  async function expireRooms(): Promise<void> {
    if (!postgres) return;
    try {
      const result = await postgres.query<{
        roomId: string;
        ownerId: string | null;
        roomKind: string;
        previousExpiresAt: string;
        timestamp: string;
      }>(`
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
            const participantUids =
              typeof room.getConnectedParticipantUids === "function"
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
                  .catch((err) =>
                    console.error("[EXPIRE] Failed to notify participant of room ended:", err),
                  );
              }
            }

            room.status = "expired";
            room.addChatMessage(null, {
              id: "",
              system: true,
              msg: "This room has expired.",
            });

            room.disconnectAllSockets();
            room.destroy?.();
            rooms.delete(row.roomId);
            unregisterRoomNamespace(row.roomId);
          }
        }
      }
    } catch (e) {
      console.error("Error expiring rooms:", e);
    }
  }

  async function checkEndingSoonRooms(): Promise<void> {
    if (!postgres) return;
    try {
      const result = await postgres.query<{
        roomId: string;
        ownerId: string | null;
        expiresAt: string;
        roomTitle: string | null;
      }>(`
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
        console.log(
          `[ENDING_SOON] Dispatched 15-minute advance warnings for ${result.rowCount} rooms`,
        );
        for (const row of result.rows) {
          if (row.ownerId) {
            notificationService
              .notifyUser({
                userId: row.ownerId,
                type: "ROOM_ENDING",
                title: "Room Ending Soon",
                body: `Your room "${row.roomTitle || row.roomId}" will expire in approximately 15 minutes.`,
                metadata: {
                  roomId: row.roomId,
                  action: "open_room",
                  targetUrl: `/room/${encodeURIComponent(row.roomId)}`,
                },
                eventId: `ROOM_ENDING:${row.roomId}:15m`,
              })
              .catch((err) => console.error("[ENDING_SOON] Failed to notify owner:", err));
          }
          const room = rooms.get(row.roomId);
          if (room) {
            room.addChatMessage(null, {
              id: "",
              system: true,
              msg: "Notice: This room will expire in 15 minutes.",
            });
            const participantUids =
              typeof room.getConnectedParticipantUids === "function"
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
                    metadata: {
                      roomId: row.roomId,
                      action: "open_room",
                      targetUrl: `/room/${encodeURIComponent(row.roomId)}`,
                    },
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

  async function minuteMetrics(): Promise<void> {
    const roomArr = Array.from(rooms.values());
    const dirtyPresenceBatch: Record<string, string> = {};
    const emptyRoomsToClean: string[] = [];

    for (const room of roomArr) {
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
      await redisEdge.updateRoomPresenceBatch(dirtyPresenceBatch).catch(() => {});
    }
    if (emptyRoomsToClean.length > 0) {
      await redisEdge.removeRoomPresenceBatch(emptyRoomsToClean).catch(() => {});
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
        await edgeRedis.execute("stats", "setex", (c) =>
          c.setex(`shardMetrics:${currentConfig.SHARD ?? 0}`, 120, JSON.stringify(obj)),
        );
      }
    } catch (_err) {
      // Redis shard metrics degradation fallback
    }
  }

  // NOTIFY-001A: Authoritative retention maintenance (every 1 hour)
  // Invariant: UNREAD notifications are NEVER purged; only expired READ notifications and aged outbox records.
  async function retentionMaintenance(): Promise<void> {
    try {
      const readPurged = await purgeReadNotificationsExpiredFn();
      const sentRetentionDays = Number(currentConfig.EMAIL_SENT_RETENTION_DAYS) || 14;
      const failedRetentionDays = Number(currentConfig.EMAIL_FAILED_RETENTION_DAYS) || 60;
      const sentPurged = await purgeSentOutboxRowsFn(sentRetentionDays);
      const failedPurged = await purgeFailedOutboxRowsFn(failedRetentionDays);
      if (readPurged > 0 || sentPurged > 0 || failedPurged > 0) {
        console.log(
          `[Retention] Purged: ${readPurged} read notifications, ${sentPurged} sent outbox, ${failedPurged} failed outbox`,
        );
      }
    } catch (err) {
      console.error("[Retention] Error running notification retention purge:", err);
    }
  }

  // Register scheduled maintenance intervals
  const minuteMetricsInterval = serverLifecycle.registerInterval(minuteMetrics, 60 * 1000);
  const checkIdleRoomsInterval = serverLifecycle.registerInterval(checkIdleRooms, 30 * 1000);
  const saveRoomsInterval = serverLifecycle.registerInterval(saveRooms, 15 * 1000);
  const expireRoomsInterval = serverLifecycle.registerInterval(expireRooms, 60 * 1000);
  const checkEndingSoonRoomsInterval = serverLifecycle.registerInterval(
    checkEndingSoonRooms,
    60 * 1000,
  );
  const retentionInterval = serverLifecycle.registerInterval(
    retentionMaintenance,
    60 * 60 * 1000,
  );

  const intervals = [
    minuteMetricsInterval,
    checkIdleRoomsInterval,
    saveRoomsInterval,
    expireRoomsInterval,
    checkEndingSoonRoomsInterval,
    retentionInterval,
  ];

  return {
    checkIdleRooms,
    saveRooms,
    expireRooms,
    checkEndingSoonRooms,
    minuteMetrics,
    retentionMaintenance,
    clearPresenceSnapshot,
    intervals,
  };
}
