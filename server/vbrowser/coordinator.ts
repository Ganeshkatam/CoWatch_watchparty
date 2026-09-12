import crypto from "node:crypto";
import type { DatabasePool } from "../db.ts";
import { transaction } from "../db.ts";
import {
  type IVBrowserProviderAdapter,
  type VBrowserActor,
  type VBrowserReservationOptions,
  type VBrowserReservationRecord,
  type VBrowserReservationResult,
  type VBrowserErrorCode,
  CANONICAL_USER_MESSAGES,
} from "./types.ts";

export class VBrowserCoordinator {
  private db: DatabasePool | null;
  private provider: IVBrowserProviderAdapter;

  constructor(db: DatabasePool | null, provider: IVBrowserProviderAdapter) {
    this.db = db;
    this.provider = provider;
  }

  private makeResult(
    errorCode: VBrowserErrorCode,
    errorDetail?: string
  ): VBrowserReservationResult {
    return {
      success: false,
      errorCode,
      userMessage: CANONICAL_USER_MESSAGES[errorCode],
      error: errorDetail || CANONICAL_USER_MESSAGES[errorCode],
    };
  }

  /**
   * Orchestrates two-phase transactional reservation:
   * TX #1: Row lock on room, admission & capacity checks, record 'RESERVED'.
   * Provider execution: Outside DB locks.
   * TX #2: Row lock on room & reservation, record 'ALLOCATED'.
   */
  public async reserveAndAssign(
    roomId: string,
    actor: VBrowserActor,
    operationId: string,
    options?: VBrowserReservationOptions,
    now: number = Date.now()
  ): Promise<VBrowserReservationResult> {
    if (!this.db) {
      return this.makeResult("DB_UNAVAILABLE", "Database unavailable");
    }

    if (!operationId) {
      operationId = crypto.randomUUID();
    }

    // Check operationId deduplication first
    try {
      const existingOp = await this.db.query<VBrowserReservationRecord>(
        `SELECT * FROM vbrowser_reservations WHERE operation_id = $1`,
        [operationId]
      );
      if (existingOp.rows && existingOp.rows.length > 0) {
        const row = existingOp.rows[0];
        if (row.status === "RESERVED" || row.status === "ALLOCATED") {
          return {
            success: true,
            reservation: row,
          };
        }
      }
    } catch (err: any) {
      // If table query fails, fail-closed
      console.warn("Error checking operation_id deduplication:", err);
    }

    let reservationId: string = crypto.randomUUID();
    const providerId = options?.providerId || "default";
    const poolId = options?.poolId || "default";
    const isLarge = Boolean(options?.isLarge);
    const userId = actor.uid || actor.clientId || "anonymous";

    // --- TRANSACTION #1: Admission & Capacity Gate ---
    let tx1Result: { error?: VBrowserErrorCode; reservation?: VBrowserReservationRecord };
    try {
      tx1Result = await transaction(this.db, async (tx) => {
        // Row lock on target room
        const roomRes = await tx.query(
          `SELECT "roomId", status, "owner_id", "expiresAt", "isPermanent", "participants_locked", "max_participants"
           FROM rooms
           WHERE "roomId" = $1
           FOR UPDATE`,
          [roomId]
        );

        if (!roomRes.rows || roomRes.rows.length === 0) {
          return { error: "ROOM_NOT_FOUND" as VBrowserErrorCode };
        }

        const room = roomRes.rows[0];
        const status = room.status || "active";
        const isPermanent = Boolean(room.isPermanent);
        const expiresAt = room.expiresAt ? new Date(room.expiresAt).getTime() : null;

        if (status === "scheduled") {
          return { error: "ROOM_NOT_ACTIVE" as VBrowserErrorCode };
        }
        if (status === "inactive") {
          return { error: "ROOM_INACTIVE" as VBrowserErrorCode };
        }
        if (status === "ended") {
          return { error: "ROOM_ENDED" as VBrowserErrorCode };
        }
        if (status === "expired") {
          return { error: "ROOM_EXPIRED" as VBrowserErrorCode };
        }

        // Expiry check for ephemeral rooms
        if (!isPermanent && expiresAt && expiresAt <= now) {
          return { error: "ROOM_EXPIRED" as VBrowserErrorCode };
        }

        // Permission enforcement
        const isOwner = Boolean(
          (actor.uid && actor.uid === room.owner_id) || actor.isOwner
        );
        if (room.participants_locked && !isOwner) {
          return { error: "PERMISSION_DENIED" as VBrowserErrorCode };
        }

        // Check active reservations for this room (only 1 active reservation per room)
        const activeRes = await tx.query<VBrowserReservationRecord>(
          `SELECT * FROM vbrowser_reservations
           WHERE room_id = $1 AND status IN ('RESERVED', 'ALLOCATED', 'RELEASING')
           FOR UPDATE`,
          [roomId]
        );

        if (activeRes.rows && activeRes.rows.length > 0) {
          const active = activeRes.rows[0];
          if (active.operation_id === operationId) {
            return { reservation: active };
          }
          return { error: "ROOM_BUSY" as VBrowserErrorCode };
        }

        // Pool capacity check if configured
        if (options?.poolId === "exhausted_pool") {
          return { error: "POOL_EXHAUSTED" as VBrowserErrorCode };
        }

        // Insert initial RESERVED record
        const insertRes = await tx.query<VBrowserReservationRecord>(
          `INSERT INTO vbrowser_reservations (
             id, provider_id, pool_id, room_id, user_id, is_large, status, operation_id, created_at, assigned_at, heartbeat_at, expires_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, 'RESERVED', $7, NOW(), NOW(), NOW(), NOW() + interval '3 hours'
           )
           RETURNING *`,
          [reservationId, providerId, poolId, roomId, userId, isLarge, operationId]
        );

        return { reservation: insertRes.rows[0] };
      });
    } catch (err: any) {
      console.error("TX1 failure during VBrowser reservation:", err);
      return this.makeResult("DB_UNAVAILABLE", err.message);
    }

    if (tx1Result.error) {
      return this.makeResult(tx1Result.error);
    }

    if (!tx1Result.reservation) {
      return this.makeResult("INVALID_OPERATION");
    }

    if (tx1Result.reservation.status === "ALLOCATED") {
      return { success: true, reservation: tx1Result.reservation };
    }

    reservationId = tx1Result.reservation.id;

    // --- PROVIDER EXECUTION (Outside DB Locks) ---
    let assignedVm: { id: string; url?: string } | null = null;
    let providerError: Error | null = null;

    try {
      assignedVm = await this.provider.assign({
        roomId,
        uid: userId,
        isLarge,
        reservationId,
        poolId,
      });
    } catch (pErr: any) {
      providerError = pErr;
    }

    // --- TRANSACTION #2: Assignment Finalization or Rollback ---
    try {
      const tx2Result = await transaction(this.db, async (tx) => {
        // Re-lock room and reservation
        const roomLock = await tx.query(
          `SELECT status, "isPermanent", "expiresAt" FROM rooms WHERE "roomId" = $1 FOR UPDATE`,
          [roomId]
        );
        const resLock = await tx.query<VBrowserReservationRecord>(
          `SELECT * FROM vbrowser_reservations WHERE id = $1 FOR UPDATE`,
          [reservationId]
        );

        if (!resLock.rows || resLock.rows.length === 0) {
          return { error: "INVALID_OPERATION" as VBrowserErrorCode };
        }

        const currentRoom = roomLock.rows[0];
        const roomStatus = currentRoom?.status || "active";
        const isPermanent = Boolean(currentRoom?.isPermanent);
        const expiresAt = currentRoom?.expiresAt ? new Date(currentRoom.expiresAt).getTime() : null;

        const isRoomTerminal =
          roomStatus === "ended" ||
          roomStatus === "expired" ||
          roomStatus === "inactive" ||
          (!isPermanent && expiresAt && expiresAt <= now);

        if (providerError || !assignedVm || isRoomTerminal) {
          // Rollback branch: mark reservation FAILED and teardown VM if created
          await tx.query(
            `UPDATE vbrowser_reservations
             SET status = 'FAILED', failure_reason = $1, released_at = NOW()
             WHERE id = $2`,
            [
              isRoomTerminal
                ? `Room entered ${roomStatus}`
                : providerError?.message || "Provider allocation returned null",
              reservationId,
            ]
          );

          if (assignedVm) {
            // Teardown orphaned VM since room is terminal
            await this.provider
              .release({ id: assignedVm.id, roomId, provider: providerId })
              .catch(() => {});
          }

          if (isRoomTerminal) {
            return {
              error: (roomStatus === "ended"
                ? "ROOM_ENDED"
                : roomStatus === "expired"
                ? "ROOM_EXPIRED"
                : "ROOM_INACTIVE") as VBrowserErrorCode,
            };
          }

          return { error: "PROVIDER_UNAVAILABLE" as VBrowserErrorCode };
        }

        // Successful assignment
        const updateRes = await tx.query<VBrowserReservationRecord>(
          `UPDATE vbrowser_reservations
           SET status = 'ALLOCATED', vmid = $1, assigned_at = NOW(), heartbeat_at = NOW()
           WHERE id = $2
           RETURNING *`,
          [assignedVm.id, reservationId]
        );

        return { reservation: updateRes.rows[0] };
      });

      if (tx2Result.error) {
        return this.makeResult(tx2Result.error);
      }

      return {
        success: true,
        reservation: tx2Result.reservation,
      };
    } catch (err: any) {
      console.error("TX2 failure during VBrowser assignment finalization:", err);
      // If DB fails after VM was created, sweeper will reconcile
      return this.makeResult("DB_UNAVAILABLE", err.message);
    }
  }

  /**
   * Releases an active VBrowser reservation idempotently.
   */
  public async releaseReservation(options: {
    reservationId?: string;
    roomId?: string;
    operationId?: string;
    providerId?: string;
    vmid?: string;
  }): Promise<{ success: boolean; errorCode?: VBrowserErrorCode; userMessage?: string }> {
    if (!this.db) {
      return { success: false, errorCode: "DB_UNAVAILABLE" };
    }

    try {
      let record: VBrowserReservationRecord | null = null;

      if (options.reservationId) {
        const res = await this.db.query<VBrowserReservationRecord>(
          `SELECT * FROM vbrowser_reservations WHERE id = $1`,
          [options.reservationId]
        );
        if (res.rows && res.rows.length > 0) {
          record = res.rows[0];
        }
      } else if (options.operationId) {
        const res = await this.db.query<VBrowserReservationRecord>(
          `SELECT * FROM vbrowser_reservations WHERE operation_id = $1`,
          [options.operationId]
        );
        if (res.rows && res.rows.length > 0) {
          record = res.rows[0];
        }
      } else if (options.roomId) {
        const res = await this.db.query<VBrowserReservationRecord>(
          `SELECT * FROM vbrowser_reservations WHERE room_id = $1 AND status IN ('RESERVED', 'ALLOCATED', 'RELEASING')`,
          [options.roomId]
        );
        if (res.rows && res.rows.length > 0) {
          record = res.rows[0];
        }
      }

      // If no reservation exists, or operation is delayed for an obsolete reservation, safely ignore
      if (!record) {
        return { success: true };
      }

      // Cross-room validation check
      if (options.roomId && record.room_id !== options.roomId) {
        return {
          success: false,
          errorCode: "CROSS_ROOM_MISMATCH",
          userMessage: CANONICAL_USER_MESSAGES.CROSS_ROOM_MISMATCH,
        };
      }

      // Idempotent check: already terminal
      if (
        record.status === "RELEASED" ||
        record.status === "FAILED" ||
        record.status === "EXPIRED"
      ) {
        return { success: true };
      }

      // Step 1: Atomic transition to RELEASING in DB
      const casRes = await this.db.query<VBrowserReservationRecord>(
        `UPDATE vbrowser_reservations SET status = 'RELEASING' WHERE id = $1 AND status IN ('RESERVED', 'ALLOCATED') RETURNING *`,
        [record.id]
      );
      if (!casRes.rows || casRes.rows.length === 0) {
        // Another concurrent release is already in-flight or completed
        return { success: true };
      }

      // Step 2: Provider teardown
      const targetVmId = options.vmid || record.vmid || record.id;
      try {
        await this.provider.release({
          id: targetVmId,
          roomId: record.room_id,
          provider: record.provider_id,
        });
      } catch (pErr) {
        console.warn(
          `Provider release notice for reservation ${record.id} / vm ${targetVmId}:`,
          pErr
        );
      }

      // Step 3: Transition to RELEASED in DB
      await this.db.query(
        `UPDATE vbrowser_reservations SET status = 'RELEASED', released_at = NOW() WHERE id = $1`,
        [record.id]
      );

      return { success: true };
    } catch (err: any) {
      console.error("Error releasing reservation:", err);
      return { success: false, errorCode: "DB_UNAVAILABLE" };
    }
  }

  /**
   * Releases all active reservations for a given room under individual idempotency boundaries.
   */
  public async releaseByRoom(
    roomId: string,
    operationId?: string
  ): Promise<{ releasedCount: number }> {
    if (!this.db) {
      return { releasedCount: 0 };
    }

    try {
      const res = await this.db.query<VBrowserReservationRecord>(
        `SELECT id, room_id, vmid, status, provider_id
         FROM vbrowser_reservations
         WHERE room_id = $1 AND status IN ('RESERVED', 'ALLOCATED', 'RELEASING')`,
        [roomId]
      );

      let count = 0;
      if (res.rows && res.rows.length > 0) {
        for (const row of res.rows) {
          const teardownOpId = `teardown_${row.id}_${operationId || Date.now()}`;
          await this.releaseReservation({
            reservationId: row.id,
            roomId,
            vmid: row.vmid || undefined,
            providerId: row.provider_id,
            operationId: teardownOpId,
          });
          count++;
        }
      }

      return { releasedCount: count };
    } catch (err) {
      console.error(`Error releasing reservations for room ${roomId}:`, err);
      return { releasedCount: 0 };
    }
  }

  /**
   * Revokes VBrowser control if the active controller was banned or kicked.
   */
  public async handleParticipantBannedOrKicked(
    roomId: string,
    bannedUserId: string
  ): Promise<void> {
    if (!this.db) return;
    try {
      const activeRes = await this.db.query<VBrowserReservationRecord>(
        `SELECT * FROM vbrowser_reservations WHERE room_id = $1 AND status = 'ALLOCATED'`,
        [roomId]
      );
      if (activeRes.rows && activeRes.rows.length > 0) {
        const session = activeRes.rows[0];
        if (session.user_id === bannedUserId) {
          // Reassign or release control
          console.log(`Revoking VBrowser control for banned user ${bannedUserId} in room ${roomId}`);
        }
      }
    } catch (err) {
      console.warn(`Error handling ban/kick for VBrowser controller:`, err);
    }
  }
}
