import {
  type AdmissionActor,
  type AdmissionResult,
  type RoomLifecycleStatus,
  DEFAULT_LEASE_DURATION_MS,
  MAX_LIFECYCLE_CEILING_MS,
} from "./types.ts";
import { notificationService } from "../notifications/notificationService.ts";
import config from "../config.ts";

export interface DatabasePool {
  query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }>;
}

export class AdmissionCoordinator {
  private db: DatabasePool | null;

  constructor(db: DatabasePool | null) {
    this.db = db;
  }

  public async evaluateAdmission(
    roomId: string,
    actor: AdmissionActor,
    now: number = Date.now()
  ): Promise<AdmissionResult> {
    if (!this.db) {
      return {
        allowed: false,
        status: "inactive",
        reason: "DB_UNAVAILABLE",
        error: "Database unavailable",
      };
    }

    try {
      // Transactional row-level lock
      const client = this.db;
      const res = await client.query(
        `SELECT "roomId", status, "owner_id", "expiresAt", "creationTime", "isPermanent", 
                passcode, "participants_locked", "max_participants", data, lifecycle_revision, schema_version
         FROM rooms
         WHERE "roomId" = $1
         FOR UPDATE`,
        [roomId]
      );

      if (!res.rows || res.rows.length === 0) {
        return {
          allowed: false,
          status: "inactive",
          reason: "ROOM_NOT_FOUND",
        };
      }

      const row = res.rows[0];
      let status: RoomLifecycleStatus = (row.status as RoomLifecycleStatus) || "active";
      const isPermanent = Boolean(row.isPermanent);
      const expiresAt = row.expiresAt ? new Date(row.expiresAt).getTime() : null;
      const ownerId = row.owner_id;
      const isActorOwner = Boolean((actor.uid && actor.uid === ownerId) || actor.isOwner);

      // 1. Expiration check on ephemeral rooms
      if (!isPermanent && expiresAt !== null && expiresAt <= now) {
        if (status !== "expired" && status !== "ended") {
          await client.query(
            `UPDATE rooms SET status = 'expired', "endedAt" = NOW() WHERE "roomId" = $1`,
            [roomId]
          );
        }
        return {
          allowed: false,
          status: "expired",
          reason: "ROOM_EXPIRED",
          roomRow: row,
        };
      }

      // 2. Explicit terminal state check
      if (status === "ended") {
        return {
          allowed: false,
          status: "ended",
          reason: "ROOM_ENDED",
          roomRow: row,
        };
      }
      if (status === "expired") {
        return {
          allowed: false,
          status: "expired",
          reason: "ROOM_EXPIRED",
          roomRow: row,
        };
      }

      // 3. Scheduled state check
      if (status === "scheduled") {
        if (isActorOwner) {
          // Owner activates the scheduled room
          await client.query(
            `UPDATE rooms SET status = 'active', "startedAt" = NOW() WHERE "roomId" = $1`,
            [roomId]
          );

          // Persist authoritative lifecycle event for session boundary
          const eventRes = await client.query(
            `INSERT INTO public.room_lifecycle_events ("roomId", actor, event, "previousStatus", "newStatus", reason)
             VALUES ($1, $2, 'room.started', 'scheduled', 'active', 'owner_activation')
             RETURNING id`,
            [roomId, actor.uid || actor.clientId]
          );
          const sessionId = eventRes?.rows?.[0]?.id;

          if (row.owner_id && sessionId) {
            notificationService
              .notifyUser({
                userId: row.owner_id,
                type: "ROOM_STARTED",
                title: `Room Live: "${row.roomTitle || roomId}"`,
                body: `Your scheduled room "${row.roomTitle || roomId}" is now live.`,
                metadata: {
                  roomId,
                  action: "open_room",
                  targetUrl: `/room/${encodeURIComponent(roomId)}`,
                  sessionId,
                },
                eventId: `ROOM_STARTED:${roomId}:${sessionId}`,
                emailTemplateKey: "room-started",
                emailPayload: {
                  roomTitle: row.roomTitle || roomId,
                  roomUrl: `${config.APP_URL || 'https://cowatch.tv'}/room/${encodeURIComponent(roomId)}`,
                },
              })
              .catch((err) => console.error("[Lifecycle] Failed to notify owner of room start:", err));
          }

          return {
            allowed: true,
            status: "active",
            isColdStart: true,
            roomRow: { ...row, status: "active" },
          };
        } else {
          return {
            allowed: false,
            status: "scheduled",
            reason: "ROOM_SCHEDULED_NOT_STARTED",
            roomRow: row,
          };
        }
      }

      // 4. Inactive state check (Cold-start reconstruction)
      if (status === "inactive") {
        if (isActorOwner || actor.isReconnecting) {
          await client.query(
            `UPDATE rooms SET status = 'active', "lastActiveAt" = NOW() WHERE "roomId" = $1`,
            [roomId]
          );
          return {
            allowed: true,
            status: "active",
            isColdStart: true,
            roomRow: { ...row, status: "active" },
          };
        } else {
          return {
            allowed: false,
            status: "inactive",
            reason: "ROOM_INACTIVE",
            roomRow: row,
          };
        }
      }

      // 5. Active state
      return {
        allowed: true,
        status: "active",
        roomRow: row,
      };
    } catch (e: any) {
      console.error("Error evaluating room admission:", e);
      return {
        allowed: false,
        status: "inactive",
        reason: "DB_UNAVAILABLE",
        error: e.message,
      };
    }
  }

  public async extendLeaseAuthoritative(
    roomId: string,
    extensionMs: number = DEFAULT_LEASE_DURATION_MS,
    now: number = Date.now()
  ): Promise<{ extended: boolean; newExpiresAt: Date | null; error?: string }> {
    if (!this.db) return { extended: false, newExpiresAt: null, error: "DB_UNAVAILABLE" };

    try {
      const res = await this.db.query(
        `SELECT "roomId", status, "expiresAt", "creationTime", "isPermanent"
         FROM rooms
         WHERE "roomId" = $1
         FOR UPDATE`,
        [roomId]
      );

      if (!res.rows || res.rows.length === 0) {
        return { extended: false, newExpiresAt: null, error: "ROOM_NOT_FOUND" };
      }

      const row = res.rows[0];
      if (row.isPermanent) {
        return { extended: true, newExpiresAt: null };
      }

      if (row.status === "ended" || row.status === "expired") {
        return { extended: false, newExpiresAt: null, error: "TERMINAL_STATE_IMMUTABLE" };
      }

      const creationTime = row.creationTime ? new Date(row.creationTime).getTime() : now;
      const maxCeilingTime = creationTime + MAX_LIFECYCLE_CEILING_MS;

      // Target = min(now + extensionMs, creationTime + MAX_LIFECYCLE_CEILING_MS)
      const targetTime = Math.min(now + extensionMs, maxCeilingTime);
      const targetDate = new Date(targetTime);

      await this.db.query(
        `UPDATE rooms SET "expiresAt" = $1, "lastActiveAt" = NOW() WHERE "roomId" = $2`,
        [targetDate, roomId]
      );

      return { extended: true, newExpiresAt: targetDate };
    } catch (e: any) {
      return { extended: false, newExpiresAt: null, error: e.message };
    }
  }
}
