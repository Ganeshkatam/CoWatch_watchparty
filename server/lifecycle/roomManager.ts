import {
  CURRENT_SCHEMA_VERSION,
  IDLE_EVACUATION_EPHEMERAL_MS,
  IDLE_EVACUATION_PERMANENT_MS,
  type RoomSnapshot,
} from "./types.ts";
import { Room } from "../room.ts";
import type { DatabasePool } from "./admissionCoordinator.ts";
import type { VBrowserCoordinator } from "../vbrowser/coordinator.ts";

export class RoomLifecycleManager {
  private db: DatabasePool | null;
  private inMemoryRooms: Map<string, Room>;
  private vbrowserCoordinator?: VBrowserCoordinator;

  constructor(
    db: DatabasePool | null,
    inMemoryRooms: Map<string, Room>,
    vbrowserCoordinator?: VBrowserCoordinator
  ) {
    this.db = db;
    this.inMemoryRooms = inMemoryRooms;
    this.vbrowserCoordinator = vbrowserCoordinator;
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
   * Two-phase safe idle evacuation barrier with optimistic revision CAS:
   * 1. Check connected participants === 0.
   * 2. Read room lifecycle_revision = N.
   * 3. Begin resource teardown (VBrowser / VMs) with unique teardownOperationId.
   * 4. Execute final atomic evacuation CAS:
   *    UPDATE rooms SET status = 'inactive', lifecycle_revision = N + 1, data = $snapshot
   *    WHERE "roomId" = $roomId AND lifecycle_revision = N AND status = 'active'
   * 5. If rows_affected === 0, abort evacuation immediately and preserve resident room state.
   * 6. Evacuate from memory.
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
      // Step 2: Read current revision N and status
      const res = await this.db.query(
        `SELECT lifecycle_revision, status FROM rooms WHERE "roomId" = $1`,
        [roomId]
      );

      if (!res.rows || res.rows.length === 0) {
        return { evacuated: false, reason: "ROOM_NOT_FOUND" };
      }

      const currentDbRevision = res.rows[0].lifecycle_revision || 1;
      const currentStatus = res.rows[0].status;

      if (currentStatus !== "active") {
        return { evacuated: false, reason: "ROOM_NOT_ACTIVE" };
      }

      // Step 3: Resource teardown with idempotency
      const teardownOpId = `unload_teardown_${roomId}_${Date.now()}`;
      if (this.vbrowserCoordinator) {
        await this.vbrowserCoordinator.releaseByRoom(roomId, teardownOpId).catch((err) => {
          console.warn(`Idempotent coordinator teardown notice for room ${roomId}:`, err);
        });
      }

      if (room.vBrowser) {
        try {
          await room.stopVBrowserInternal();
        } catch (vErr) {
          console.warn(`Idempotent VM teardown notice for room ${roomId}:`, vErr);
        }
      }

      // Re-verify in-memory participant barrier before CAS
      if (room.roster.length > 0) {
        return { evacuated: false, reason: "PARTICIPANT_RACED_DURING_UNLOAD" };
      }

      // Step 4: Final atomic evacuation CAS
      const nextRevision = currentDbRevision + 1;
      const snapshot = this.createSnapshot(room, nextRevision);
      const snapshotJson = JSON.stringify(snapshot);

      const casRes = await this.db.query(
        `UPDATE rooms
         SET status = 'inactive',
             lifecycle_revision = $1,
             data = $2,
             "lastUpdateTime" = NOW()
         WHERE "roomId" = $3
           AND lifecycle_revision = $4
           AND status = 'active'`,
        [nextRevision, snapshotJson, roomId, currentDbRevision]
      );

      if (casRes.rowCount === 0) {
        // CAS failed: concurrent reconnect incremented revision or altered status
        return { evacuated: false, reason: "CAS_REVISION_MISMATCH_ABORTED" };
      }

      // Step 6: Evacuate from RAM
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

          // Teardown VBrowser allocations
          if (this.vbrowserCoordinator) {
            await this.vbrowserCoordinator.releaseByRoom(roomId, `expire_${roomId}_${now}`).catch(() => {});
          }

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
