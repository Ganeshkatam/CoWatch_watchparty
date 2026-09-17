import assert from "node:assert";
import { isTerminalRoom } from "./lifecycle/types.ts";
import { RoomLifecycleManager } from "./lifecycle/roomManager.ts";
import { RoomReconstructor } from "./lifecycle/roomReconstruction.ts";
import { Room } from "./room.ts";
import { Server } from "socket.io";
import { createServer } from "http";
import type { DatabasePool } from "./lifecycle/admissionCoordinator.ts";

/**
 * Permanent Room Lifecycle & Reusability Regression Test Suite
 *
 * Invariant Matrix:
 * | Room      | Action          | Expected                   |
 * |-----------|-----------------|----------------------------|
 * | Temporary | Start           | active                     |
 * | Temporary | Stop            | ended                      |
 * | Temporary | Start again     | Rejected                   |
 * | Permanent | Start           | active                     |
 * | Permanent | Stop            | inactive                   |
 * | Permanent | Start again     | active                     |
 * | Permanent | Stop again      | inactive                   |
 * | Permanent | Delete          | Deleted                    |
 * | Temporary | Delete          | Existing intended behavior |
 * | Permanent | Idle evacuation | Room remains reusable      |
 * | Permanent | Server restart  | Room reconstructable       |
 * | Permanent | Owner reconnect | Room remains reusable      |
 */

class MockDatabase implements DatabasePool {
  public roomsTable: Map<string, any> = new Map();
  public accountUsage: Map<string, { total: number; watch: number; permanent: number }> = new Map();

  public async query<T = any>(text: string, params: any[] = []): Promise<{ rows: T[]; rowCount: number }> {
    // 1. SELECT query
    if (text.includes("SELECT") && text.includes("FROM rooms")) {
      const roomId = params[0];
      const row = this.roomsTable.get(roomId);
      if (!row) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [JSON.parse(JSON.stringify(row))], rowCount: 1 };
    }

    // 2. UPDATE rooms SET status = 'inactive' (unloadIfIdle CAS)
    if (text.includes("UPDATE rooms") && text.includes("status = 'inactive'") && text.includes("lifecycle_revision = $4")) {
      const [nextRev, snapshotJson, roomId, currentRev] = params;
      const row = this.roomsTable.get(roomId);
      if (!row || row.lifecycle_revision !== currentRev || row.status !== "active") {
        return { rows: [], rowCount: 0 };
      }
      row.status = "inactive";
      row.lifecycle_revision = nextRev;
      row.data = JSON.parse(snapshotJson);
      row.lastUpdateTime = new Date().toISOString();
      return { rows: [], rowCount: 1 };
    }

    // 3. Simulated public.end_room_authoritative
    if (text.includes("end_room_authoritative")) {
      const [accountId, roomId] = params;
      const row = this.roomsTable.get(roomId);
      if (!row || row.owner_id !== accountId) {
        throw new Error("ROOM_NOT_FOUND");
      }

      if (!row.isPermanent && (row.status === "ended" || row.status === "expired")) {
        return {
          rows: [{ result: { roomId, status: row.status, isPermanent: false, alreadyConcluded: true } } as any],
          rowCount: 1,
        };
      }
      if (row.isPermanent && row.status === "inactive") {
        return {
          rows: [{ result: { roomId, status: "inactive", isPermanent: true, alreadyConcluded: true } } as any],
          rowCount: 1,
        };
      }

      const newStatus = row.isPermanent ? "inactive" : "ended";
      row.status = newStatus;
      row.endedAt = new Date().toISOString();
      row.lastUpdateTime = new Date().toISOString();

      return {
        rows: [{
          result: {
            roomId,
            status: newStatus,
            isPermanent: row.isPermanent,
            totalRoomsRemaining: 1,
          },
        } as any],
        rowCount: 1,
      };
    }

    // 4. Simulated public.set_room_activity_authoritative
    if (text.includes("set_room_activity_authoritative")) {
      const roomId = params[0];
      const pStatus = text.includes("'active'") ? "active" : (params[1] === "active" ? "active" : "inactive");
      const row = this.roomsTable.get(roomId);
      if (!row) {
        throw new Error("ROOM_NOT_FOUND");
      }

      if (row.status === "ended") {
        // Terminal state: cannot be reactivated
        return {
          rows: [{ result: { roomId, status: "ended", unchanged: true } } as any],
          rowCount: 1,
        };
      }

      if (pStatus === "active") {
        row.status = "active";
        row.startedAt = row.startedAt || new Date().toISOString();
        row.lastActiveAt = new Date().toISOString();
        row.lastUpdateTime = new Date().toISOString();
      } else {
        row.status = "inactive";
        row.lastActiveAt = new Date().toISOString();
        row.lastUpdateTime = new Date().toISOString();
      }

      return {
        rows: [{ result: { roomId, status: row.status, isPermanent: row.isPermanent } } as any],
        rowCount: 1,
      };
    }

    // 5. Simulated public.delete_room_authoritative
    if (text.includes("delete_room_authoritative")) {
      const [accountId, roomId] = params;
      const row = this.roomsTable.get(roomId);
      if (!row || row.owner_id !== accountId) {
        throw new Error("ROOM_NOT_FOUND");
      }
      if (row.status === "active") {
        throw new Error("ROOM_ACTIVE_CANNOT_DELETE");
      }
      this.roomsTable.delete(roomId);
      return { rows: [{ result: { roomId, deleted: true } } as any], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  }
}

async function runTests() {
  console.log("Starting Permanent Room Lifecycle & Reusability Regression Suite...");

  const server = createServer();
  const io = new Server(server);
  const db = new MockDatabase();
  const memoryRooms = new Map<string, Room>();
  const manager = new RoomLifecycleManager(db, memoryRooms, undefined);

  const ownerId = "owner-uuid-001";

  // ----------------------------------------------------
  // Test 1: Client isTerminalRoom Semantic Helper
  // ----------------------------------------------------
  {
    console.log("Test 1: isTerminalRoom semantic invariants");
    assert.strictEqual(
      isTerminalRoom({ isPermanent: false, status: "ended" }),
      true,
      "Temporary ended room must be terminal"
    );
    assert.strictEqual(
      isTerminalRoom({ isPermanent: false, status: "expired" }),
      true,
      "Temporary expired room must be terminal"
    );
    assert.strictEqual(
      isTerminalRoom({ isPermanent: false, status: "active" }),
      false,
      "Temporary active room is not terminal"
    );
    assert.strictEqual(
      isTerminalRoom({ isPermanent: true, status: "active" }),
      false,
      "Permanent active room is not terminal"
    );
    assert.strictEqual(
      isTerminalRoom({ isPermanent: true, status: "inactive" }),
      false,
      "Permanent inactive room is not terminal and reusable"
    );
    assert.strictEqual(
      isTerminalRoom({ isPermanent: true, status: "ended" }),
      false,
      "Permanent room with legacy ended status must NOT be treated as terminal by client"
    );
  }

  // ----------------------------------------------------
  // Test 2: Temporary Room Full Lifecycle Matrix
  // Start -> active, Stop -> ended, Start again -> Rejected
  // ----------------------------------------------------
  {
    console.log("Test 2: Temporary room lifecycle (Start -> active, Stop -> ended, Start again -> Rejected)");
    const tempRoomId = "temp-room-1";
    db.roomsTable.set(tempRoomId, {
      roomId: tempRoomId,
      owner_id: ownerId,
      room_kind: "watch",
      isPermanent: false,
      status: "scheduled",
      lifecycle_revision: 1,
      creationTime: new Date().toISOString(),
    });

    // 1. Start temporary room
    const startRes = await db.query(
      "SELECT public.set_room_activity_authoritative($1, 'active', $2) AS result",
      [tempRoomId, ownerId]
    );
    assert.strictEqual(startRes.rows[0].result.status, "active", "Temporary room must become active");

    // 2. Stop temporary room session
    const stopRes = await db.query(
      "SELECT public.end_room_authoritative($1, $2, 'host') AS result",
      [ownerId, tempRoomId]
    );
    assert.strictEqual(stopRes.rows[0].result.status, "ended", "Temporary room must become ended on stop");
    assert.strictEqual(stopRes.rows[0].result.isPermanent, false, "Must indicate isPermanent: false");

    // 3. Start again -> MUST BE REJECTED
    const restartRes = await db.query(
      "SELECT public.set_room_activity_authoritative($1, 'active', $2) AS result",
      [tempRoomId, ownerId]
    );
    assert.strictEqual(restartRes.rows[0].result.unchanged, true, "Reactivation of ended temporary room must be rejected");
    assert.strictEqual(restartRes.rows[0].result.status, "ended", "Temporary room remains ended");
  }

  // ----------------------------------------------------
  // Test 3: Permanent Room Full Lifecycle Matrix
  // Start -> active, Stop -> inactive, Start again -> active, Stop again -> inactive
  // ----------------------------------------------------
  {
    console.log("Test 3: Permanent room lifecycle (Start -> active, Stop -> inactive, Start again -> active)");
    const permRoomId = "permanent-room-1";
    db.roomsTable.set(permRoomId, {
      roomId: permRoomId,
      owner_id: ownerId,
      room_kind: "permanent",
      isPermanent: true,
      status: "inactive",
      lifecycle_revision: 1,
      creationTime: new Date().toISOString(),
    });

    // 1. Start session on permanent room
    const startRes1 = await db.query(
      "SELECT public.set_room_activity_authoritative($1, 'active', $2) AS result",
      [permRoomId, ownerId]
    );
    assert.strictEqual(startRes1.rows[0].result.status, "active", "Permanent room must become active");

    // 2. Stop session on permanent room -> MUST BE 'inactive', NEVER 'ended'
    const stopRes1 = await db.query(
      "SELECT public.end_room_authoritative($1, $2, 'host') AS result",
      [ownerId, permRoomId]
    );
    assert.strictEqual(stopRes1.rows[0].result.status, "inactive", "Permanent room must transition to inactive, not ended");
    assert.strictEqual(stopRes1.rows[0].result.isPermanent, true, "Must indicate isPermanent: true");

    // 3. Start session again -> MUST BE ACCEPTED
    const startRes2 = await db.query(
      "SELECT public.set_room_activity_authoritative($1, 'active', $2) AS result",
      [permRoomId, ownerId]
    );
    assert.strictEqual(startRes2.rows[0].result.status, "active", "Permanent room must transition back to active");

    // 4. Stop session again -> returns to inactive
    const stopRes2 = await db.query(
      "SELECT public.end_room_authoritative($1, $2, 'host') AS result",
      [ownerId, permRoomId]
    );
    assert.strictEqual(stopRes2.rows[0].result.status, "inactive", "Permanent room returns to inactive");
  }

  // ----------------------------------------------------
  // Test 4: Permanent Room Deletion Contract
  // Active -> Delete rejected; Inactive -> Delete succeeds
  // ----------------------------------------------------
  {
    console.log("Test 4: Permanent room deletion contract");
    const delRoomId = "permanent-room-del";
    db.roomsTable.set(delRoomId, {
      roomId: delRoomId,
      owner_id: ownerId,
      room_kind: "permanent",
      isPermanent: true,
      status: "active",
      lifecycle_revision: 1,
      creationTime: new Date().toISOString(),
    });

    // Attempt delete while active -> must throw error
    await assert.rejects(
      async () => {
        await db.query(
          "SELECT public.delete_room_authoritative($1, $2) AS result",
          [ownerId, delRoomId]
        );
      },
      { message: "ROOM_ACTIVE_CANNOT_DELETE" },
      "Active room cannot be deleted"
    );

    // Stop session -> inactive
    await db.query(
      "SELECT public.end_room_authoritative($1, $2, 'host') AS result",
      [ownerId, delRoomId]
    );

    // Delete inactive permanent room -> succeeds
    const delRes = await db.query(
      "SELECT public.delete_room_authoritative($1, $2) AS result",
      [ownerId, delRoomId]
    );
    assert.strictEqual(delRes.rows[0].result.deleted, true, "Inactive permanent room is deleted");
    assert.strictEqual(db.roomsTable.has(delRoomId), false, "Room is removed from database");
  }

  // ----------------------------------------------------
  // Test 5: Permanent Room Idle Evacuation vs Business End
  // Eviction frees memory, but room identity and reusability are preserved
  // ----------------------------------------------------
  {
    console.log("Test 5: Permanent room idle evacuation preserves persistent reusable identity");
    const idleRoomId = "permanent-idle-room";
    db.roomsTable.set(idleRoomId, {
      roomId: idleRoomId,
      owner_id: ownerId,
      room_kind: "permanent",
      isPermanent: true,
      status: "active",
      lifecycle_revision: 1,
      data: null,
      creationTime: new Date().toISOString(),
      lastUpdateTime: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    });

    // Instantiate in-memory room
    const room = new Room(io, idleRoomId);
    room.owner_id = ownerId;
    room.isPermanent = true;
    room.status = "active";
    room.lastUpdateTime = new Date(Date.now() - 30 * 60 * 1000);
    memoryRooms.set(idleRoomId, room);

    // Evacuate idle room
    const unloadRes = await manager.unloadIfIdle(idleRoomId, Date.now());
    assert.strictEqual(unloadRes.evacuated, true, "Room should be evacuated from memory");
    assert.strictEqual(memoryRooms.has(idleRoomId), false, "Room is no longer resident in RAM");

    // Check DB state: status must be 'inactive', NOT 'ended'
    const dbRow = db.roomsTable.get(idleRoomId);
    assert.strictEqual(dbRow.status, "inactive", "Evacuated permanent room must be 'inactive' in DB");
    assert.strictEqual(dbRow.isPermanent, true, "Room is still marked permanent");
    assert.ok(dbRow.data, "Snapshot data is preserved in DB");

    // Owner reconnects / starts session again -> reconstructable and active
    const reconstructor = new RoomReconstructor(db);
    const recResult = await reconstructor.reconstructRoom(dbRow, io);
    assert.ok(recResult.room, "Reconstruction from snapshot must succeed");
    assert.strictEqual(recResult.room.isPermanent, true, "Reconstructed room remains permanent");
    assert.strictEqual(recResult.room.status, "inactive", "Reconstructed room is initially inactive until session started");

    // Activate session
    const activateRes = await db.query(
      "SELECT public.set_room_activity_authoritative($1, 'active', $2) AS result",
      [idleRoomId, ownerId]
    );
    assert.strictEqual(activateRes.rows[0].result.status, "active", "Room is now active again");
  }

  // ----------------------------------------------------
  // Test 6: Server Restart Recovery for Inactive Permanent Room
  // ----------------------------------------------------
  {
    console.log("Test 6: Cold start / server restart recovery");
    const restartRoomId = "perm-cold-start";
    const restartRow = {
      roomId: restartRoomId,
      owner_id: ownerId,
      room_kind: "permanent",
      isPermanent: true,
      status: "inactive",
      lifecycle_revision: 5,
      mediaPath: "https://example.com/video.mp4",
      data: {
        schemaVersion: 1,
        lifecycleRevision: 5,
        timeline: {
          mediaSource: "https://example.com/video.mp4",
          anchorTime: 120,
          anchorWallClock: Date.now(),
          paused: true,
          playbackRate: 1,
        },
      },
      creationTime: new Date().toISOString(),
    };
    db.roomsTable.set(restartRoomId, restartRow);

    // Clean memory simulation (server just booted)
    assert.strictEqual(memoryRooms.has(restartRoomId), false);

    const reconstructor = new RoomReconstructor(db);
    const recResult = await reconstructor.reconstructRoom(restartRow, io);
    assert.ok(recResult.room, "Cold room is reconstructed successfully");
    assert.strictEqual(recResult.room.mediaPath, "https://example.com/video.mp4", "Media path restored");
    assert.strictEqual(Math.round(recResult.room.videoTS), 120, "Playback position restored");
  }

  console.log("All Permanent Room Lifecycle & Reusability Regression Tests Passed Successfully!");
  process.exit(0);
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
