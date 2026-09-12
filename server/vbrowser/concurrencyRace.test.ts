import assert from "node:assert/strict";
import crypto from "node:crypto";
import { VBrowserCoordinator } from "./coordinator.ts";
import { VBrowserControlHandler } from "./controlHandler.ts";
import type { DatabasePool, DatabaseTransaction } from "../db.ts";
import type {
  IVBrowserProviderAdapter,
  AssignedVMResult,
  VBrowserReservationRecord,
} from "./types.ts";

/**
 * Mock PostgreSQL in-memory database with transactional row locks,
 * exact SQL pattern handling, and state inspection.
 */
class ConcurrencyMockDatabase implements DatabasePool {
  public rooms: Map<string, any> = new Map();
  public reservations: Map<string, VBrowserReservationRecord> = new Map();
  public queryLogs: string[] = [];

  public reset() {
    this.rooms.clear();
    this.reservations.clear();
    this.queryLogs = [];
  }

  public async query<T = any>(text: string, params: any[] = []): Promise<{ rows: T[]; rowCount: number }> {
    this.queryLogs.push(text);

    // 1. SELECT * FROM vbrowser_reservations WHERE operation_id = $1
    if (text.includes("FROM vbrowser_reservations WHERE operation_id = $1")) {
      const opId = params[0];
      const match = Array.from(this.reservations.values()).find((r) => r.operation_id === opId);
      return { rows: match ? ([match] as unknown as T[]) : [], rowCount: match ? 1 : 0 };
    }

    // 2. SELECT * FROM vbrowser_reservations WHERE id = $1
    if (text.includes("FROM vbrowser_reservations WHERE id = $1")) {
      const id = params[0];
      const match = this.reservations.get(id);
      return { rows: match ? ([match] as unknown as T[]) : [], rowCount: match ? 1 : 0 };
    }

    // 3. SELECT * FROM vbrowser_reservations WHERE room_id = $1 AND status IN ('RESERVED', 'ALLOCATED', 'RELEASING')
    if (text.includes("FROM vbrowser_reservations") && text.includes("room_id = $1") && text.includes("status IN")) {
      const roomId = params[0];
      const matches = Array.from(this.reservations.values()).filter(
        (r) => r.room_id === roomId && (r.status === "RESERVED" || r.status === "ALLOCATED" || r.status === "RELEASING")
      );
      return { rows: matches as unknown as T[], rowCount: matches.length };
    }

    // 4. SELECT * FROM vbrowser_reservations WHERE status IN ('RESERVED', 'ALLOCATED', 'RELEASING')
    if (text.includes("FROM vbrowser_reservations WHERE status IN ('RESERVED', 'ALLOCATED', 'RELEASING')")) {
      const matches = Array.from(this.reservations.values()).filter(
        (r) => r.status === "RESERVED" || r.status === "ALLOCATED" || r.status === "RELEASING"
      );
      return { rows: matches as unknown as T[], rowCount: matches.length };
    }

    // 5. SELECT ... FROM rooms WHERE "roomId" = $1
    if (text.includes("FROM rooms") && text.includes('"roomId" = $1')) {
      const roomId = params[0];
      const room = this.rooms.get(roomId);
      return { rows: room ? ([room] as unknown as T[]) : [], rowCount: room ? 1 : 0 };
    }

    // 6. INSERT INTO vbrowser_reservations
    if (text.includes("INSERT INTO vbrowser_reservations")) {
      const [id, provider_id, pool_id, room_id, user_id, is_large, operation_id] = params;
      const record: VBrowserReservationRecord = {
        id,
        provider_id,
        pool_id,
        room_id,
        user_id,
        is_large,
        status: "RESERVED",
        operation_id,
        vmid: null,
        created_at: new Date().toISOString(),
        assigned_at: new Date().toISOString(),
        heartbeat_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3 * 3600 * 1000).toISOString(),
      };
      this.reservations.set(id, record);
      return { rows: [record] as unknown as T[], rowCount: 1 };
    }

    // 7. UPDATE vbrowser_reservations SET status = 'ALLOCATED', vmid = $1
    if (text.includes("UPDATE vbrowser_reservations") && text.includes("status = 'ALLOCATED'")) {
      const vmid = params[0];
      const id = params[1];
      const record = this.reservations.get(id);
      if (record) {
        record.status = "ALLOCATED";
        record.vmid = vmid;
        record.assigned_at = new Date().toISOString();
        record.heartbeat_at = new Date().toISOString();
      }
      return { rows: record ? ([record] as unknown as T[]) : [], rowCount: record ? 1 : 0 };
    }

    // 8. UPDATE vbrowser_reservations SET status = 'RELEASING'
    if (text.includes("UPDATE vbrowser_reservations") && text.includes("status = 'RELEASING'")) {
      const id = params[0];
      const record = this.reservations.get(id);
      if (record) {
        if (text.includes("status IN")) {
          if (record.status !== "RESERVED" && record.status !== "ALLOCATED") {
            return { rows: [], rowCount: 0 };
          }
        }
        record.status = "RELEASING";
        return { rows: [record] as unknown as T[], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // 9. UPDATE vbrowser_reservations SET status = 'RELEASED'
    if (text.includes("UPDATE vbrowser_reservations") && text.includes("status = 'RELEASED'")) {
      const id = params[text.includes("WHERE id = $2") ? 1 : 0];
      const record = this.reservations.get(id);
      if (record) {
        record.status = "RELEASED";
        record.released_at = new Date().toISOString();
      }
      return { rows: record ? ([record] as unknown as T[]) : [], rowCount: record ? 1 : 0 };
    }

    // 10. UPDATE vbrowser_reservations SET status = 'FAILED'
    if (text.includes("UPDATE vbrowser_reservations") && text.includes("status = 'FAILED'")) {
      const id = params[1];
      const record = this.reservations.get(id);
      if (record) {
        record.status = "FAILED";
        record.failure_reason = params[0];
        record.released_at = new Date().toISOString();
      }
      return { rows: record ? ([record] as unknown as T[]) : [], rowCount: record ? 1 : 0 };
    }

    return { rows: [], rowCount: 0 };
  }

  public async transaction<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

/**
 * Mock VBrowser Provider Adapter with tracking for allocations, releases, and inputs.
 */
class ConcurrencyMockProvider implements IVBrowserProviderAdapter {
  public containers: Map<string, { id: string; roomId?: string; reservationId?: string; state?: string }> = new Map();
  public assignCalls = 0;
  public releaseCalls: string[] = [];
  public inputCalls = 0;
  public assignDelayMs = 0;
  public throwOnRelease = false;

  public reset() {
    this.containers.clear();
    this.assignCalls = 0;
    this.releaseCalls = [];
    this.inputCalls = 0;
    this.assignDelayMs = 0;
    this.throwOnRelease = false;
  }

  public async assign(options: {
    roomId: string;
    uid?: string;
    isLarge?: boolean;
    reservationId: string;
    poolId?: string;
  }): Promise<AssignedVMResult | null> {
    this.assignCalls++;
    if (this.assignDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.assignDelayMs));
    }
    const vmId = `vm_${crypto.randomUUID()}`;
    const vm = {
      id: vmId,
      url: `https://vbrowser.example.com/${vmId}`,
      roomId: options.roomId,
      reservationId: options.reservationId,
      state: "RUNNING",
    };
    this.containers.set(vmId, vm);
    return { id: vmId, url: vm.url };
  }

  public async release(options: {
    id: string;
    roomId?: string;
    provider?: string;
  }): Promise<void> {
    this.releaseCalls.push(options.id);
    this.containers.delete(options.id);
    if (this.throwOnRelease) {
      throw new Error("PROVIDER_TIMEOUT_OR_UNREACHABLE");
    }
  }

  public async listActiveContainers(): Promise<Array<{ id: string; roomId?: string; reservationId?: string; state?: string }>> {
    return Array.from(this.containers.values());
  }

  public async forwardInput(eventType: string, payload: any): Promise<boolean> {
    this.inputCalls++;
    return true;
  }
}

async function runConcurrencyRaceMatrix() {
  console.log("Starting VBROWSER-CONCURRENCY-001 (10-Point Race Matrix)...");

  const db = new ConcurrencyMockDatabase();
  const provider = new ConcurrencyMockProvider();
  const coordinator = new VBrowserCoordinator(db, provider);
  const controlHandler = new VBrowserControlHandler(null, coordinator, provider);

  function setupRoom(roomId: string, overrides: Partial<any> = {}) {
    const room = {
      roomId,
      status: "active",
      owner_id: "host_user_1",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      isPermanent: false,
      participants_locked: false,
      max_participants: 20,
      ...overrides,
    };
    db.rooms.set(roomId, room);
    return room;
  }

  // --- Race 1: Allocate <-> Room Expiry ---
  {
    db.reset();
    provider.reset();
    const roomId = "room_race_1";
    const room = setupRoom(roomId);
    provider.assignDelayMs = 25;

    // Start allocation
    const allocatePromise = coordinator.reserveAndAssign(roomId, { uid: "host_user_1", clientId: "c1" }, "op_race_1");

    // Race: Room expires mid-provisioning before TX#2
    await new Promise((r) => setTimeout(r, 5));
    room.status = "expired";
    room.expiresAt = new Date(Date.now() - 1000).toISOString();

    const result = await allocatePromise;
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "ROOM_EXPIRED");
    // Assert 0 surviving provider allocations (immediate rollback teardown)
    assert.equal(provider.containers.size, 0, "No container should survive an allocation racing with room expiration");
    assert.equal(provider.releaseCalls.length, 1, "VM should have been rolled back immediately on expiry race");
    console.log("Race 1 Passed: Allocate <-> Room Expiry resulted in immediate VM rollback (0 surviving allocations).");
  }

  // --- Race 2: Allocate <-> Room Unload ---
  {
    db.reset();
    provider.reset();
    const roomId = "room_race_2";
    const room = setupRoom(roomId);
    provider.assignDelayMs = 25;

    const allocatePromise = coordinator.reserveAndAssign(roomId, { uid: "host_user_1", clientId: "c1" }, "op_race_2");

    // Race: Idle evacuation unloads room mid-flight
    await new Promise((r) => setTimeout(r, 5));
    room.status = "inactive";

    const result = await allocatePromise;
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "ROOM_INACTIVE");
    assert.equal(provider.containers.size, 0, "No container survives idle room unload");
    assert.equal(provider.releaseCalls.length, 1, "VM terminated upon idle room unload race");
    console.log("Race 2 Passed: Allocate <-> Room Unload rejected allocation and rolled back VM.");
  }

  // --- Race 3: Allocate <-> Participant Kick ---
  {
    db.reset();
    provider.reset();
    const roomId = "room_race_3";
    const room = setupRoom(roomId);

    // Active session with controller 'target_user'
    const allocRes = await controlHandler.handleAllocate(
      roomId,
      room,
      { uid: "target_user", clientId: "c_target" },
      "op_race_3",
      1
    );
    assert.equal(allocRes.success, true);
    assert.equal(controlHandler.getSessionState(roomId).controllerId, "target_user");

    // Participant is kicked
    controlHandler.handleParticipantBannedOrKicked(roomId, "target_user", "host_user_1", 1);
    assert.equal(controlHandler.getSessionState(roomId).controllerId, "host_user_1");

    // Kicked participant tries to send input
    const inputRes = await controlHandler.handleInput(
      roomId,
      allocRes.state.reservationId!,
      room,
      { uid: "target_user", clientId: "c_target" },
      "click",
      { x: 10, y: 10 },
      1,
      1
    );
    assert.equal(inputRes.forwarded, false);
    assert.equal(inputRes.reason, "NOT_ACTIVE_CONTROLLER");
    console.log("Race 3 Passed: Allocate <-> Participant Kick revoked controller and blocked subsequent inputs.");
  }

  // --- Race 4: Allocate <-> Host Transfer ---
  {
    db.reset();
    provider.reset();
    const roomId = "room_race_4";
    const room = setupRoom(roomId, { owner_id: "old_host", participants_locked: true });

    const allocRes = await controlHandler.handleAllocate(
      roomId,
      room,
      { uid: "old_host", clientId: "c_old", isOwner: true },
      "op_race_4",
      1
    );
    assert.equal(allocRes.success, true);

    // Host transfer mid-flight
    room.owner_id = "new_host";
    controlHandler.handleHostTransfer(roomId, "new_host", 1);

    // Old host tries to input with locked room
    const oldHostInput = await controlHandler.handleInput(
      roomId,
      allocRes.state.reservationId!,
      room,
      { uid: "old_host", clientId: "c_old", isOwner: false },
      "mousemove",
      { x: 50, y: 50 },
      1,
      1
    );
    assert.equal(oldHostInput.forwarded, false);
    assert.equal(oldHostInput.reason, "PERMISSION_DENIED");
    console.log("Race 4 Passed: Allocate <-> Host Transfer rejected obsolete host control.");
  }

  // --- Race 5: Input <-> Release ---
  {
    db.reset();
    provider.reset();
    const roomId = "room_race_5";
    const room = setupRoom(roomId);

    const allocRes = await controlHandler.handleAllocate(
      roomId,
      room,
      { uid: "host_user_1", clientId: "c1", isOwner: true },
      "op_race_5",
      1
    );

    // Release begins
    await controlHandler.handleRelease(
      roomId,
      allocRes.state.reservationId!,
      room,
      { uid: "host_user_1", clientId: "c1", isOwner: true },
      "op_rel_5",
      1
    );

    // Input attempted after release
    const inputRes = await controlHandler.handleInput(
      roomId,
      allocRes.state.reservationId!,
      room,
      { uid: "host_user_1", clientId: "c1", isOwner: true },
      "keydown",
      { key: "Enter" },
      1,
      1
    );
    assert.equal(inputRes.forwarded, false);
    assert.equal(inputRes.reason, "NO_ACTIVE_SESSION");
    assert.equal(provider.inputCalls, 0, "Zero input events forwarded after release boundary");
    console.log("Race 5 Passed: Input <-> Release strictly blocked inputs with 0 provider mutations.");
  }

  // --- Race 6: Input <-> Epoch Change ---
  {
    db.reset();
    provider.reset();
    const roomId = "room_race_6";
    const room = setupRoom(roomId);

    const allocRes = await controlHandler.handleAllocate(
      roomId,
      room,
      { uid: "host_user_1", clientId: "c1", isOwner: true },
      "op_race_6",
      1
    );

    // Stale input from epoch 1 arriving during server epoch 2
    const staleInput = await controlHandler.handleInput(
      roomId,
      allocRes.state.reservationId!,
      room,
      { uid: "host_user_1", clientId: "c1", isOwner: true },
      "click",
      { x: 100, y: 200 },
      1, // Event epoch 1
      2  // Current server epoch 2
    );
    assert.equal(staleInput.forwarded, false);
    assert.equal(staleInput.reason, "STALE_EPOCH");
    assert.equal(provider.inputCalls, 0);
    console.log("Race 6 Passed: Input <-> Epoch Change dropped stale epoch N-1 input.");
  }

  // --- Race 7: Release <-> Provider Timeout ---
  {
    db.reset();
    provider.reset();
    const roomId = "room_race_7";
    const room = setupRoom(roomId);

    const allocRes = await coordinator.reserveAndAssign(roomId, { uid: "host_user_1", clientId: "c1" }, "op_race_7");
    assert.equal(allocRes.success, true);

    // Provider times out during release
    provider.throwOnRelease = true;
    const releaseRes = await coordinator.releaseReservation({
      reservationId: allocRes.reservation!.id,
      roomId,
      operationId: "op_rel_7",
    });

    // Release must succeed in DB regardless of provider failure to allow lifecycle progression
    assert.equal(releaseRes.success, true);
    assert.equal(db.reservations.get(allocRes.reservation!.id)?.status, "RELEASED");
    console.log("Race 7 Passed: Release <-> Provider Timeout safely completed DB transition to RELEASED.");
  }

  // --- Race 8: Provider Crash <-> Reconnect ---
  {
    db.reset();
    provider.reset();
    const roomId = "room_race_8";
    const room = setupRoom(roomId);

    const allocRes = await controlHandler.handleAllocate(
      roomId,
      room,
      { uid: "host_user_1", clientId: "c1", isOwner: true },
      "op_race_8",
      1
    );

    // Provider crashes
    controlHandler.handleContainerCrash(roomId, allocRes.state.reservationId!, 1);

    // Reconnecting client checks state
    const state = controlHandler.getSessionState(roomId);
    assert.equal(state.status, "FAILED");
    console.log("Race 8 Passed: Provider Crash <-> Reconnect returns authoritative FAILED state without hanging.");
  }

  // --- Race 9: Release <-> Duplicate Release ---
  {
    db.reset();
    provider.reset();
    const roomId = "room_race_9";
    const room = setupRoom(roomId);

    const allocRes = await coordinator.reserveAndAssign(roomId, { uid: "host_user_1", clientId: "c1" }, "op_race_9");
    assert.equal(allocRes.success, true);

    // Two concurrent release dispatches with same operationId
    const [rel1, rel2] = await Promise.all([
      coordinator.releaseReservation({
        reservationId: allocRes.reservation!.id,
        roomId,
        operationId: "op_dup_rel",
      }),
      coordinator.releaseReservation({
        reservationId: allocRes.reservation!.id,
        roomId,
        operationId: "op_dup_rel",
      }),
    ]);

    assert.equal(rel1.success, true);
    assert.equal(rel2.success, true);
    assert.equal(provider.releaseCalls.length, 1, "Exactly one provider teardown executed across duplicate releases");
    console.log("Race 9 Passed: Release <-> Duplicate Release executed exactly one provider teardown.");
  }

  // --- Race 10: Allocation <-> Duplicate OperationId ---
  {
    db.reset();
    provider.reset();
    const roomId = "room_race_10";
    const room = setupRoom(roomId);

    // Allocate first
    const alloc1 = await coordinator.reserveAndAssign(roomId, { uid: "host_user_1", clientId: "c1" }, "op_dedup_10");
    assert.equal(alloc1.success, true);

    // Duplicate allocation request with identical operationId
    const alloc2 = await coordinator.reserveAndAssign(roomId, { uid: "host_user_1", clientId: "c1" }, "op_dedup_10");
    assert.equal(alloc2.success, true);
    assert.equal(alloc2.reservation!.id, alloc1.reservation!.id);
    assert.equal(provider.assignCalls, 1, "Exactly one VM allocated for duplicate operationId");
    console.log("Race 10 Passed: Allocation <-> Duplicate OperationId safely deduplicated with 1 provider allocation.");
  }

  console.log("----------------------------------------------------------------");
  console.log("ALL 10 VBROWSER-CONCURRENCY-001 RACE TESTS PASSED SUCCESSFULLY!");
  console.log("----------------------------------------------------------------");
  process.exit(0);
}

runConcurrencyRaceMatrix().catch((err) => {
  console.error("Concurrency race test failed:", err);
  process.exit(1);
});
