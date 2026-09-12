import {
  CURRENT_SCHEMA_VERSION,
  IDLE_EVACUATION_EPHEMERAL_MS,
  IDLE_EVACUATION_PERMANENT_MS,
  type RoomSnapshot,
} from "./types.ts";
import { Room } from "../room.ts";
import type { DatabasePool } from "./admissionCoordinator.ts";

export class RoomLifecycleManager {
  private db: DatabasePool | null;
  private inMemoryRooms: Map<string, Room>;

  constructor(db: DatabasePool | null, inMemoryRooms: Map<string, Room>) {
    this.db = db;
    this.inMemoryRooms = inMemoryRooms;
  }

  public createSnapshot(room: Room, lifecycleRevision: number = 1): RoomSnapshot {
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      lifecycleRevision,
      timeline: room.timeline.getSnapshot(),
      settings: {
        isChatDisabled: room.isChatDisabled,
        participantsLocked: room.participantsLocked,
        maxParticipants: room.maxParticipants,
        roomTitle: room.roomTitle,
        roomDescription: room.roomDescription,
        mediaPath: room.mediaPath,
      },
      locks: {
        lock: room.lock,
        participantsLocked: room.participantsLocked,
      },
      playlist: room.playlist,
      nameMap: (room as any).nameMap,
      pictureMap: (room as any).pictureMap,
      subtitle: (room as any).subtitle,
      loop: (room as any).loop,
      video: room.video || undefined,
      videoTS: room.videoTS,
      paused: room.paused,
      playbackRate: room.playbackRate,
    };
  }

  /**
   * Two-phase safe idle evacuation barrier:
   * 1. Check connected participants === 0.
   * 2. Transactional SELECT ... FOR UPDATE.
   * 3. Verify lifecycle revision monotonic increment.
   * 4. Idempotent external resource teardown (VMs/browsers).
   * 5. Re-check connected participants (abort if > 0).
   * 6. Evict from memory and unregister room.
   */
  public async unloadIfIdle(
    roomId: string,
    now: number = Date.now()
  ): Promise<{ evacuated: boolean; reason?: string; error?: string }> {
    const room = this.inMemoryRooms.get(roomId);
    if (!room) {
      return { evacuated: false, reason: "NOT_IN_MEMORY" };
    }

    if (room.roster.length > 0) {
      return { evacuated: false, reason: "PARTICIPANTS_PRESENT" };
    }

    const idleThreshold = room.isPermanent
      ? IDLE_EVACUATION_PERMANENT_MS
      : IDLE_EVACUATION_EPHEMERAL_MS;

    const lastUpdated = Number(room.lastUpdateTime || 0);
    if (now - lastUpdated < idleThreshold) {
      return { evacuated: false, reason: "NOT_IDLE" };
    }

    if (!this.db) {
      // In PostgreSQL failure, preserve room in RAM without data loss
      return { evacuated: false, reason: "DB_UNAVAILABLE" };
    }

    try {
      // Phase 2: Transactional serialization
      const res = await this.db.query(
        `SELECT lifecycle_revision, status FROM rooms WHERE "roomId" = $1 FOR UPDATE`,
        [roomId]
      );

      if (!res.rows || res.rows.length === 0) {
        return { evacuated: false, reason: "ROOM_NOT_FOUND" };
      }

      const currentDbRevision = res.rows[0].lifecycle_revision || 1;
      const nextRevision = currentDbRevision + 1;
      const snapshot = this.createSnapshot(room, nextRevision);
      const snapshotJson = JSON.stringify(snapshot);

      // Write versioned snapshot
      await this.db.query(
        `UPDATE rooms SET data = $1, lifecycle_revision = $2, "lastUpdateTime" = NOW() WHERE "roomId" = $3`,
        [snapshotJson, nextRevision, roomId]
      );

      // Phase 4: External resource teardown (VMs / VBrowsers) with idempotency
      if (room.vBrowser) {
        try {
          await room.stopVBrowserInternal();
        } catch (vErr) {
          console.warn(`Idempotent VM teardown notice for room ${roomId}:`, vErr);
        }
      }

      // Phase 5: Re-verify participant count before eviction
      if (room.roster.length > 0) {
        return { evacuated: false, reason: "PARTICIPANT_RACED_DURING_UNLOAD" };
      }

      // Phase 6: Evacuate from RAM
      room.destroy();
      this.inMemoryRooms.delete(roomId);

      return { evacuated: true };
    } catch (err: any) {
      // Failed DB write halts evacuation, keeping room resident in memory
      console.error(`Failed to unload room ${roomId}:`, err);
      return { evacuated: false, reason: "DB_WRITE_FAILED", error: err.message };
    }
  }

  /**
   * Batch expiration using SKIP LOCKED for multi-worker concurrency safety.
   */
  public async expireRoomsBatch(
    batchSize: number = 50,
    now: number = Date.now()
  ): Promise<{ expiredCount: number; expiredRoomIds: string[] }> {
    if (!this.db) {
      return { expiredCount: 0, expiredRoomIds: [] };
    }

    try {
      const res = await this.db.query(
        `SELECT "roomId", owner_id, status
         FROM rooms
         WHERE "isPermanent" = FALSE
           AND "expiresAt" IS NOT NULL
           AND "expiresAt" <= NOW()
           AND status NOT IN ('ended', 'expired')
         FOR UPDATE SKIP LOCKED
         LIMIT $1`,
        [batchSize]
      );

      const expiredRoomIds: string[] = [];
      if (res.rows && res.rows.length > 0) {
        for (const row of res.rows) {
          const roomId = row.roomId;
          await this.db.query(
            `UPDATE rooms SET status = 'expired', "endedAt" = NOW() WHERE "roomId" = $1`,
            [roomId]
          );

          // Handle active in-memory instance
          const inMem = this.inMemoryRooms.get(roomId);
          if (inMem) {
            inMem.status = "expired";
            if (inMem.vBrowser) {
              await inMem.stopVBrowserInternal().catch(() => {});
            }
            inMem.disconnectAllSockets();
            inMem.destroy();
            this.inMemoryRooms.delete(roomId);
          }

          expiredRoomIds.push(roomId);
        }
      }

      return { expiredCount: expiredRoomIds.length, expiredRoomIds };
    } catch (e) {
      console.error("Error running batch expiration:", e);
      return { expiredCount: 0, expiredRoomIds: [] };
    }
  }
}
