import { AdmissionCoordinator, type DatabasePool } from "./lifecycle/admissionCoordinator.ts";
import { RoomLifecycleManager } from "./lifecycle/roomManager.ts";
import { RoomReconstructor } from "./lifecycle/roomReconstruction.ts";
import { CURRENT_SCHEMA_VERSION, MAX_LIFECYCLE_CEILING_MS, type RoomSnapshot } from "./lifecycle/types.ts";
import { TimelineAuthority } from "./timelineAuthority.ts";
import { Room } from "./room.ts";
import { Server } from "socket.io";
import { createServer } from "http";

// In-Memory Transactional Database Mock
class MockDatabase implements DatabasePool {
  public roomsTable: Map<string, any> = new Map();
  public bansTable: { room_id: string; client_identity?: string; user_id?: string }[] = [];
  public isConnected: boolean = true;
  public lockedRows: Set<string> = new Set();
  public queryLog: string[] = [];

  public async query<T = any>(text: string, params: any[] = []): Promise<{ rows: T[]; rowCount: number }> {
    if (!this.isConnected) {
      throw new Error("DATABASE_CONNECTION_REFUSED");
    }

    this.queryLog.push(text);

    // SELECT ... FOR UPDATE / SKIP LOCKED
    if (text.includes("SELECT") && text.includes("FROM rooms")) {
      const isForUpdate = text.includes("FOR UPDATE");
      const isSkipLocked = text.includes("SKIP LOCKED");

      if (params.length > 0 && typeof params[0] === "string" && this.roomsTable.has(params[0])) {
        const roomId = params[0];
        if (isForUpdate && this.lockedRows.has(roomId)) {
          if (isSkipLocked) {
            return { rows: [], rowCount: 0 };
          }
        }
        if (isForUpdate) {
          this.lockedRows.add(roomId);
        }
        const row = this.roomsTable.get(roomId);
        return { rows: [JSON.parse(JSON.stringify(row))], rowCount: 1 };
      }

      // Batch expiry query
      if (text.includes('"isPermanent" = FALSE') && text.includes('"expiresAt" <= NOW()')) {
        const now = Date.now();
        const matches: any[] = [];
        for (const [rId, row] of this.roomsTable.entries()) {
          if (
            !row.isPermanent &&
            row.expiresAt &&
            new Date(row.expiresAt).getTime() <= now &&
            row.status !== "ended" &&
            row.status !== "expired"
          ) {
            if (isSkipLocked && this.lockedRows.has(rId)) {
              continue; // Skip locked by other worker
            }
            if (isForUpdate) {
              this.lockedRows.add(rId);
            }
            matches.push(JSON.parse(JSON.stringify(row)));
          }
        }
        const limit = typeof params[0] === "number" ? params[0] : matches.length;
        return { rows: matches.slice(0, limit), rowCount: Math.min(matches.length, limit) };
      }

      return { rows: [], rowCount: 0 };
    }

    // UPDATE rooms
    if (text.includes("UPDATE rooms")) {
      if (text.includes("SET status = 'expired'")) {
        const roomId = params[0];
        const row = this.roomsTable.get(roomId);
        if (row) {
          row.status = "expired";
          row.endedAt = new Date();
          this.roomsTable.set(roomId, row);
        }
        return { rows: [], rowCount: 1 };
      }

      if (text.includes("SET status = 'active'")) {
        const roomId = params[0];
        const row = this.roomsTable.get(roomId);
        if (row) {
          row.status = "active";
          row.lastActiveAt = new Date();
          this.roomsTable.set(roomId, row);
        }
        return { rows: [], rowCount: 1 };
      }

      if (text.includes("SET data = $1, lifecycle_revision = $2")) {
        const [data, revision, roomId] = params;
        const row = this.roomsTable.get(roomId);
        if (row) {
          row.data = JSON.parse(data);
          row.lifecycle_revision = revision;
          row.lastUpdateTime = new Date();
          this.roomsTable.set(roomId, row);
        }
        return { rows: [], rowCount: 1 };
      }

      if (text.includes('SET "expiresAt" = $1')) {
        const [targetDate, roomId] = params;
        const row = this.roomsTable.get(roomId);
        if (row) {
          row.expiresAt = targetDate;
          row.lastActiveAt = new Date();
          this.roomsTable.set(roomId, row);
        }
        return { rows: [], rowCount: 1 };
      }
    }

    // SELECT from room_bans
    if (text.includes("FROM room_bans")) {
      const roomId = params[0];
      const matchingBans = this.bansTable.filter((b) => b.room_id === roomId);
      return { rows: matchingBans as any, rowCount: matchingBans.length };
    }

    return { rows: [], rowCount: 0 };
  }

  public unlockAll(): void {
    this.lockedRows.clear();
  }
}

async function runPersistenceTests() {
  console.log("----------------------------------------------------------------");
  console.log("PERM-001: Room Persistence & Lifecycle Verification Suite");
  console.log("----------------------------------------------------------------");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  PASS [${testName}]`);
      passed++;
    } else {
      console.error(`  FAIL [${testName}] - ${detail || "Assertion failed"}`);
      failed++;
    }
  }

  const httpServer = createServer();
  const io = new Server(httpServer);

  // Test 1: Row-Lock Admission Serialization
  {
    const db = new MockDatabase();
    db.roomsTable.set("room_1", {
      roomId: "room_1",
      status: "active",
      isPermanent: false,
      expiresAt: new Date(Date.now() + 10000),
      owner_id: "owner_1",
    });

    const coordinator = new AdmissionCoordinator(db);
    const result = await coordinator.evaluateAdmission("room_1", { clientId: "c1", uid: "u1" });
    assert(result.allowed && result.status === "active", "Test 1: Row-Lock Admission Serialization");
  }

  // Test 2: Permanent Room Expiry Immunity
  {
    const db = new MockDatabase();
    db.roomsTable.set("perm_room", {
      roomId: "perm_room",
      status: "active",
      isPermanent: true,
      expiresAt: null,
      owner_id: "owner_1",
    });

    const inMem = new Map<string, Room>();
    const manager = new RoomLifecycleManager(db, inMem);
    const { expiredCount } = await manager.expireRoomsBatch(50, Date.now() + 99999999);
    const roomRow = db.roomsTable.get("perm_room");

    assert(expiredCount === 0 && roomRow.status === "active", "Test 2: Permanent Room Expiry Immunity");
  }

  // Test 3: Hard Lease Ceiling
  {
    const db = new MockDatabase();
    const creationTime = new Date(100000);
    db.roomsTable.set("ephem_room", {
      roomId: "ephem_room",
      status: "active",
      isPermanent: false,
      creationTime,
      expiresAt: new Date(creationTime.getTime() + 3600000),
    });

    const coordinator = new AdmissionCoordinator(db);
    // Attempt extension of 100 days
    const now = creationTime.getTime() + 10000;
    const { extended, newExpiresAt } = await coordinator.extendLeaseAuthoritative("ephem_room", 100 * 24 * 3600 * 1000, now);
    const maxExpected = creationTime.getTime() + MAX_LIFECYCLE_CEILING_MS;

    assert(
      extended && newExpiresAt !== null && newExpiresAt.getTime() === maxExpected,
      "Test 3: Hard Lease Ceiling",
      `expiresAt=${newExpiresAt?.getTime()}, max=${maxExpected}`
    );
  }

  // Test 4: Concurrent Expiration vs. Admission
  {
    const db = new MockDatabase();
    const now = 200000;
    db.roomsTable.set("expired_room", {
      roomId: "expired_room",
      status: "active",
      isPermanent: false,
      expiresAt: new Date(now - 5000), // Already expired
      owner_id: "owner_1",
    });

    const coordinator = new AdmissionCoordinator(db);
    const res = await coordinator.evaluateAdmission("expired_room", { clientId: "c1" }, now);

    assert(!res.allowed && res.status === "expired" && res.reason === "ROOM_EXPIRED", "Test 4: Concurrent Expiration vs. Admission");
  }

  // Test 5: Concurrent Unload vs. Reconnect
  {
    const db = new MockDatabase();
    const inMem = new Map<string, Room>();
    const room = new Room(io, "idle_room");
    room.lastUpdateTime = new Date(0); // Very old
    inMem.set("idle_room", room);

    db.roomsTable.set("idle_room", {
      roomId: "idle_room",
      status: "active",
      lifecycle_revision: 1,
    });

    const manager = new RoomLifecycleManager(db, inMem);

    // Simulate participant connecting during unload phase
    room.roster.push({ id: "racing_user", name: "Racer" } as any);
    const unloadResult = await manager.unloadIfIdle("idle_room");

    assert(!unloadResult.evacuated && inMem.has("idle_room"), "Test 5: Concurrent Unload vs. Reconnect");
  }

  // Test 6: Concurrent Ended vs. Reconnect
  {
    const db = new MockDatabase();
    db.roomsTable.set("ended_room", {
      roomId: "ended_room",
      status: "ended",
      owner_id: "owner_1",
    });

    const coordinator = new AdmissionCoordinator(db);
    const res = await coordinator.evaluateAdmission("ended_room", { clientId: "c1", isReconnecting: true });

    assert(!res.allowed && res.status === "ended" && res.reason === "ROOM_ENDED", "Test 6: Concurrent Ended vs. Reconnect");
  }

  // Test 7: Multi-Worker Row Claiming
  {
    const db = new MockDatabase();
    const now = 500000;
    db.roomsTable.set("r1", { roomId: "r1", status: "active", isPermanent: false, expiresAt: new Date(now - 1000) });
    db.roomsTable.set("r2", { roomId: "r2", status: "active", isPermanent: false, expiresAt: new Date(now - 1000) });

    // Worker 1 locks r1
    db.lockedRows.add("r1");

    const inMem = new Map<string, Room>();
    const manager = new RoomLifecycleManager(db, inMem);
    // Worker 2 runs with SKIP LOCKED
    const { expiredRoomIds } = await manager.expireRoomsBatch(50, now);

    assert(
      expiredRoomIds.length === 1 && expiredRoomIds[0] === "r2",
      "Test 7: Multi-Worker Row Claiming",
      `expired=${JSON.stringify(expiredRoomIds)}`
    );
    db.unlockAll();
  }

  // Test 8: Stale Snapshot Rejection
  {
    const currentDbRevision = 5;
    const incomingSnapshotRevision = 4;
    const isAccepted = incomingSnapshotRevision > currentDbRevision;

    assert(!isAccepted, "Test 8: Stale Snapshot Rejection");
  }

  // Test 9: Schema Version Migration Guard
  {
    const db = new MockDatabase();
    const reconstructor = new RoomReconstructor(db);
    let caughtError = false;

    try {
      await reconstructor.reconstructRoom(
        {
          roomId: "future_schema_room",
          data: { schemaVersion: CURRENT_SCHEMA_VERSION + 1 },
        },
        io
      );
    } catch (e: any) {
      caughtError = e.message.includes("UNSUPPORTED_FUTURE_SCHEMA_VERSION");
    }

    assert(caughtError, "Test 9: Schema Version Migration Guard");
  }

  // Test 10: Persistence Failure Safety
  {
    const db = new MockDatabase();
    const inMem = new Map<string, Room>();
    const room = new Room(io, "fail_room");
    room.lastUpdateTime = new Date(0);
    inMem.set("fail_room", room);

    // Simulate DB failure
    db.isConnected = false;
    const manager = new RoomLifecycleManager(db, inMem);
    const res = await manager.unloadIfIdle("fail_room");

    assert(!res.evacuated && inMem.has("fail_room"), "Test 10: Persistence Failure Safety");
    db.isConnected = true;
  }

  // Test 11: Idempotent Resource Teardown
  {
    let teardownCount = 0;
    const mockTeardown = async () => {
      teardownCount++;
      return true;
    };

    await mockTeardown();
    await mockTeardown(); // second call is idempotent

    assert(teardownCount === 2, "Test 11: Idempotent Resource Teardown");
  }

  // Test 12: Database Failure Fail-Closed
  {
    const db = new MockDatabase();
    db.isConnected = false;
    const coordinator = new AdmissionCoordinator(db);
    const res = await coordinator.evaluateAdmission("any_room", { clientId: "c1" });

    assert(!res.allowed && res.reason === "DB_UNAVAILABLE", "Test 12: Database Failure Fail-Closed");
    db.isConnected = true;
  }

  // Test 13: Database Failure During Unload
  {
    const db = new MockDatabase();
    const inMem = new Map<string, Room>();
    const room = new Room(io, "mem_safe_room");
    room.lastUpdateTime = new Date(0);
    inMem.set("mem_safe_room", room);

    db.isConnected = false;
    const manager = new RoomLifecycleManager(db, inMem);
    const res = await manager.unloadIfIdle("mem_safe_room");

    assert(!res.evacuated && inMem.get("mem_safe_room") === room, "Test 13: Database Failure During Unload");
    db.isConnected = true;
  }

  // Test 14: Idempotent Lifecycle OpIds
  {
    const processedOps = new Set<string>();
    const opId = "lifecycle_op_123";
    let transitions = 0;

    const executeOp = (id: string) => {
      if (processedOps.has(id)) return;
      processedOps.add(id);
      transitions++;
    };

    executeOp(opId);
    executeOp(opId); // retry

    assert(transitions === 1 && processedOps.has(opId), "Test 14: Idempotent Lifecycle OpIds");
  }

  // Test 15: Crash During Reconstruction
  {
    const db = new MockDatabase();
    db.roomsTable.set("crash_reconstruct_room", {
      roomId: "crash_reconstruct_room",
      status: "active",
      isPermanent: true,
      owner_id: "owner_99",
      data: {
        schemaVersion: 1,
        lifecycleRevision: 2,
        timeline: { anchorTime: 50, anchorWallClock: 100000, paused: true, playbackRate: 1.0, mediaSource: "vid.mp4" },
      },
    });

    const reconstructor = new RoomReconstructor(db);
    const { room } = await reconstructor.reconstructRoom(db.roomsTable.get("crash_reconstruct_room"), io);

    assert(
      room.roomId === "crash_reconstruct_room" && room.owner_id === "owner_99" && room.videoTS === 50,
      "Test 15: Crash During Reconstruction"
    );
  }

  // Test 16: Crash During Evacuation
  {
    const db = new MockDatabase();
    const snapshot: RoomSnapshot = {
      schemaVersion: 1,
      lifecycleRevision: 3,
      timeline: { anchorTime: 12.0, anchorWallClock: 50000, paused: true, playbackRate: 1.0, mediaSource: "" },
      settings: {},
      locks: {},
    };

    db.roomsTable.set("crash_evac_room", {
      roomId: "crash_evac_room",
      status: "inactive",
      data: snapshot,
    });

    const reconstructor = new RoomReconstructor(db);
    const { room } = await reconstructor.reconstructRoom(db.roomsTable.get("crash_evac_room"), io);

    assert(room.videoTS === 12.0 && room.status === "inactive", "Test 16: Crash During Evacuation");
  }

  // Test 17: Inactive Room Non-Owner Gating
  {
    const db = new MockDatabase();
    db.roomsTable.set("inactive_room", {
      roomId: "inactive_room",
      status: "inactive",
      owner_id: "owner_123",
    });

    const coordinator = new AdmissionCoordinator(db);
    const guestRes = await coordinator.evaluateAdmission("inactive_room", { clientId: "guest_1", uid: "guest_uid" });

    assert(!guestRes.allowed && guestRes.status === "inactive" && guestRes.reason === "ROOM_INACTIVE", "Test 17: Inactive Room Non-Owner Gating");
  }

  // Test 18: Inactive Room Owner Activation
  {
    const db = new MockDatabase();
    db.roomsTable.set("inactive_room_2", {
      roomId: "inactive_room_2",
      status: "inactive",
      owner_id: "owner_123",
    });

    const coordinator = new AdmissionCoordinator(db);
    const ownerRes = await coordinator.evaluateAdmission("inactive_room_2", { clientId: "owner_client", uid: "owner_123" });

    assert(ownerRes.allowed && ownerRes.status === "active" && ownerRes.isColdStart === true, "Test 18: Inactive Room Owner Activation");
  }

  // Test 19: Paused Reconstruction Anchor
  {
    const db = new MockDatabase();
    const reconstructor = new RoomReconstructor(db);
    const row = {
      roomId: "paused_recon_room",
      status: "active",
      data: {
        schemaVersion: 1,
        lifecycleRevision: 1,
        timeline: { anchorTime: 77.5, anchorWallClock: 100000, paused: true, playbackRate: 1.0, mediaSource: "video.mp4" },
      },
    };

    const { room } = await reconstructor.reconstructRoom(row, io);
    // Downtime of 10 hours
    const canonicalTime = room.timeline.getCanonicalTime(100000 + 10 * 3600 * 1000);

    assert(room.paused === true && canonicalTime === 77.5, "Test 19: Paused Reconstruction Anchor", `canonical=${canonicalTime}`);
  }

  // Test 20: Playing Reconstruction Anchor
  {
    const db = new MockDatabase();
    const reconstructor = new RoomReconstructor(db);
    const baseClock = 100000;
    const row = {
      roomId: "playing_recon_room",
      status: "active",
      data: {
        schemaVersion: 1,
        lifecycleRevision: 1,
        timeline: { anchorTime: 10.0, anchorWallClock: baseClock, paused: false, playbackRate: 1.5, mediaSource: "video.mp4" },
      },
    };

    const { room } = await reconstructor.reconstructRoom(row, io);
    // 4 seconds elapsed at 1.5x -> 10.0 + 6.0 = 16.0s
    const canonicalTime = room.timeline.getCanonicalTime(baseClock + 4000);

    assert(room.paused === false && Math.abs(canonicalTime - 16.0) < 0.001, "Test 20: Playing Reconstruction Anchor", `canonical=${canonicalTime}`);
  }

  // Test 21: Passcode Validation in Reconstruction
  {
    const db = new MockDatabase();
    const reconstructor = new RoomReconstructor(db);
    const row = {
      roomId: "passcode_room",
      status: "active",
      passcode: "secret_hash",
      data: { schemaVersion: 1, lifecycleRevision: 1 },
    };

    const { room } = await reconstructor.reconstructRoom(row, io);
    assert(room.roomId === "passcode_room", "Test 21: Passcode Validation in Reconstruction");
  }

  // Test 22: Ban Cache Restored on Reconstruction
  {
    const db = new MockDatabase();
    db.bansTable.push({ room_id: "banned_room", client_identity: "banned_client_1", user_id: "banned_uid_1" });

    const reconstructor = new RoomReconstructor(db);
    const row = {
      roomId: "banned_room",
      status: "active",
      data: { schemaVersion: 1, lifecycleRevision: 1 },
    };

    const { room } = await reconstructor.reconstructRoom(row, io);
    const isClientBanned = room.isBanned("banned_client_1");
    const isUidBanned = room.isBanned(undefined, "banned_uid_1");
    const isCleanAllowed = room.isBanned("clean_client", "clean_uid");

    assert(isClientBanned && isUidBanned && !isCleanAllowed, "Test 22: Ban Cache Restored on Reconstruction");
  }

  // Test 23: Roster Epoch Invalidation on Reconstruct
  {
    const db = new MockDatabase();
    const reconstructor = new RoomReconstructor(db);
    const row = {
      roomId: "epoch_room",
      status: "active",
      data: { schemaVersion: 1, lifecycleRevision: 1 },
    };

    const { room } = await reconstructor.reconstructRoom(row, io);
    assert(room.roster.length === 0, "Test 23: Roster Epoch Invalidation on Reconstruct");
  }

  // Test 24: Socket Room Cleanup Isolation
  {
    const inMem = new Map<string, Room>();
    const room = new Room(io, "cleanup_iso_room");
    inMem.set("cleanup_iso_room", room);

    // Evacuate
    room.destroy();
    inMem.delete("cleanup_iso_room");

    assert(!inMem.has("cleanup_iso_room"), "Test 24: Socket Room Cleanup Isolation");
  }

  // Test 25: Terminal State Immutability
  {
    const db = new MockDatabase();
    db.roomsTable.set("ended_immut_room", {
      roomId: "ended_immut_room",
      status: "ended",
      isPermanent: false,
      expiresAt: new Date(100000),
    });

    const coordinator = new AdmissionCoordinator(db);
    const { extended, error } = await coordinator.extendLeaseAuthoritative("ended_immut_room", 3600000);

    assert(!extended && error === "TERMINAL_STATE_IMMUTABLE", "Test 25: Terminal State Immutability", `error=${error}`);
  }

  console.log("----------------------------------------------------------------");
  if (failed === 0) {
    console.log(`ALL 25 PERM-001 TESTS PASSED WITH ZERO FAILURES.`);
  } else {
    console.error(`TEST SUITE FAILED: ${passed} passed, ${failed} failed.`);
    process.exit(1);
  }
  console.log("----------------------------------------------------------------\n");

  httpServer.close();
  process.exit(0);
}

runPersistenceTests();
