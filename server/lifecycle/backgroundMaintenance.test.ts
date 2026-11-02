import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  registerBackgroundMaintenance,
  clearPresenceSnapshot,
  type BackgroundMaintenanceOptions,
  type LifecycleIntervalRegistrar,
} from "./backgroundMaintenance.ts";
import type { Room } from "../room.ts";
import type { Server } from "socket.io";
import type { RoomLifecycleManager } from "./roomManager.ts";

class MockLifecycleRegistrar implements LifecycleIntervalRegistrar {
  public registered: { fn: () => void | Promise<void>; intervalMs: number }[] = [];
  public clearedCount = 0;

  public registerInterval(
    fn: () => void | Promise<void>,
    intervalMs: number,
  ): NodeJS.Timeout {
    this.registered.push({ fn, intervalMs });
    // Return dummy timeout handle
    const timer = setTimeout(() => {}, 100000);
    return timer;
  }

  public clearAll(): void {
    this.clearedCount = this.registered.length;
    this.registered = [];
  }
}

describe("BackgroundMaintenance Coordinator", () => {
  let mockServerLifecycle: MockLifecycleRegistrar;
  let mockUnregisterRoomNamespaceCalls: string[];
  let unregisterRoomNamespace: (roomId: string) => void;
  let mockNotificationCalls: any[];
  let mockRedisEdgeBatches: Record<string, string>[];
  let mockRedisEdgeCleans: string[][];
  let mockShardMetricsWrites: { key: string; ttl: number; value: any }[];
  let mockPurgeCalls: { read: number; sentDays: number[]; failedDays: number[] };

  beforeEach(() => {
    clearPresenceSnapshot();
    mockServerLifecycle = new MockLifecycleRegistrar();
    mockUnregisterRoomNamespaceCalls = [];
    unregisterRoomNamespace = (id: string) => {
      mockUnregisterRoomNamespaceCalls.push(id);
    };
    mockNotificationCalls = [];
    mockRedisEdgeBatches = [];
    mockRedisEdgeCleans = [];
    mockShardMetricsWrites = [];
    mockPurgeCalls = { read: 0, sentDays: [], failedDays: [] };
  });

  const createMockIo = (clientsCount = 5): Server =>
    ({
      engine: { clientsCount },
    } as unknown as Server);

  const createOptions = (
    partial: Partial<BackgroundMaintenanceOptions> = {},
  ): BackgroundMaintenanceOptions => {
    const rooms = partial.rooms ?? new Map<string, Room>();
    const mockRoomLifecycleManager = {
      unloadIfIdle: async (roomId: string) => ({ evacuated: false }),
    } as unknown as RoomLifecycleManager;

    return {
      rooms,
      postgres: null,
      io: createMockIo(),
      roomLifecycleManager: partial.roomLifecycleManager ?? mockRoomLifecycleManager,
      unregisterRoomNamespace,
      serverLifecycle: mockServerLifecycle,
      notificationService: {
        notifyUser: async (payload: any) => {
          mockNotificationCalls.push(payload);
          return Promise.resolve();
        },
      },
      redisEdge: {
        updateRoomPresenceBatch: async (batch) => {
          mockRedisEdgeBatches.push(batch);
        },
        removeRoomPresenceBatch: async (rms) => {
          mockRedisEdgeCleans.push(rms);
        },
      },
      edgeRedis: {
        client: {},
        isReady: () => true,
        execute: async (_name, _cmd, fn) => {
          await fn({
            setex: async (key: string, ttl: number, value: string) => {
              mockShardMetricsWrites.push({ key, ttl, value: JSON.parse(value) });
            },
          });
        },
      },
      purgeReadNotificationsExpiredFn: async () => {
        mockPurgeCalls.read++;
        return 3;
      },
      purgeSentOutboxRowsFn: async (days) => {
        mockPurgeCalls.sentDays.push(days);
        return 2;
      },
      purgeFailedOutboxRowsFn: async (days) => {
        mockPurgeCalls.failedDays.push(days);
        return 1;
      },
      configOverride: {
        SHARD: "1",
        EMAIL_SENT_RETENTION_DAYS: 14,
        EMAIL_FAILED_RETENTION_DAYS: 60,
      },
      ...partial,
    };
  };

  it("1. Registers all 6 maintenance intervals with exact cadences", () => {
    const options = createOptions();
    const controller = registerBackgroundMaintenance(options);

    assert.equal(mockServerLifecycle.registered.length, 6);
    assert.equal(controller.intervals.length, 6);

    const cadences = mockServerLifecycle.registered.map((r) => r.intervalMs);
    assert.deepEqual(cadences, [
      60 * 1000, // minuteMetrics
      30 * 1000, // checkIdleRooms
      15 * 1000, // saveRooms
      60 * 1000, // expireRooms
      60 * 1000, // checkEndingSoonRooms
      60 * 60 * 1000, // retentionMaintenance
    ]);

    // Clean up timers
    for (const timer of controller.intervals) {
      clearTimeout(timer);
    }
  });

  it("2. saveRooms: saves active rooms with roster and skips empty rooms", async () => {
    let room1Saved = false;
    let room2Saved = false;

    const mockRoom1 = {
      roster: [{ id: "u1" }],
      lastUpdateTime: new Date(0),
      saveRoom: async () => {
        room1Saved = true;
      },
    } as unknown as Room;

    const mockRoom2 = {
      roster: [],
      lastUpdateTime: new Date(0),
      saveRoom: async () => {
        room2Saved = true;
      },
    } as unknown as Room;

    const rooms = new Map<string, Room>([
      ["room-1", mockRoom1],
      ["room-2", mockRoom2],
    ]);

    const options = createOptions({ rooms });
    const controller = registerBackgroundMaintenance(options);

    await controller.saveRooms();

    assert.equal(room1Saved, true, "Room 1 with connected roster must be saved");
    assert.equal(room2Saved, false, "Room 2 with empty roster must be skipped");
    assert.ok(mockRoom1.lastUpdateTime.getTime() > 0, "lastUpdateTime must be updated");

    for (const timer of controller.intervals) {
      clearTimeout(timer);
    }
  });

  it("3. checkIdleRooms: unregisters namespace on CAS evacuation and handles errors gracefully", async () => {
    const evacuatedRooms: string[] = [];
    const mockRoomLifecycleManager = {
      unloadIfIdle: async (roomId: string) => {
        if (roomId === "idle-room") {
          evacuatedRooms.push(roomId);
          return { evacuated: true };
        }
        if (roomId === "error-room") {
          throw new Error("DB lock timeout");
        }
        return { evacuated: false };
      },
    } as unknown as RoomLifecycleManager;

    const rooms = new Map<string, Room>([
      ["idle-room", {} as Room],
      ["busy-room", {} as Room],
      ["error-room", {} as Room],
    ]);

    const options = createOptions({
      rooms,
      roomLifecycleManager: mockRoomLifecycleManager,
    });
    const controller = registerBackgroundMaintenance(options);

    await controller.checkIdleRooms();

    assert.deepEqual(mockUnregisterRoomNamespaceCalls, ["idle-room"]);
    assert.deepEqual(evacuatedRooms, ["idle-room"]);

    for (const timer of controller.intervals) {
      clearTimeout(timer);
    }
  });

  it("4. expireRooms: calls authoritative DB expiration, notifies owner and participants, injects system chat, and disconnects sockets", async () => {
    let disconnectedSockets = false;
    let chatMessageAdded: any = null;

    const mockRoom = {
      roomId: "expired-room-1",
      roomTitle: "Movie Night",
      status: "active",
      getConnectedParticipantUids: () => ["owner-1", "viewer-2"],
      addChatMessage: (_sender: any, msg: any) => {
        chatMessageAdded = msg;
      },
      disconnectAllSockets: () => {
        disconnectedSockets = true;
      },
    } as unknown as Room;

    const rooms = new Map<string, Room>([["expired-room-1", mockRoom]]);

    const mockPostgres = {
      query: async <T = unknown>(queryText: string) => {
        assert.ok(queryText.includes("public.expire_rooms_authoritative()"));
        return {
          rowCount: 1,
          rows: [
            {
              roomId: "expired-room-1",
              ownerId: "owner-1",
              roomKind: "ephemeral",
              previousExpiresAt: new Date().toISOString(),
              timestamp: new Date().toISOString(),
            },
          ] as unknown as T[],
        };
      },
    };


    const options = createOptions({
      rooms,
      postgres: mockPostgres,
    });
    const controller = registerBackgroundMaintenance(options);

    await controller.expireRooms();

    // Verify notifications sent to owner and viewer-2
    assert.equal(mockNotificationCalls.length, 2);
    assert.equal(mockNotificationCalls[0].userId, "owner-1");
    assert.equal(mockNotificationCalls[0].type, "ROOM_ENDED");
    assert.equal(mockNotificationCalls[1].userId, "viewer-2");
    assert.equal(mockNotificationCalls[1].type, "ROOM_ENDED");

    // Verify room status and side effects
    assert.equal(mockRoom.status, "expired");
    assert.ok(chatMessageAdded);
    assert.equal(chatMessageAdded.msg, "This room has expired.");
    assert.equal(chatMessageAdded.system, true);
    assert.equal(disconnectedSockets, true);
    assert.equal(rooms.has("expired-room-1"), false);
    assert.ok(mockUnregisterRoomNamespaceCalls.includes("expired-room-1"));

    for (const timer of controller.intervals) {
      clearTimeout(timer);
    }
  });

  it("5. checkEndingSoonRooms: updates endingNotifiedAt, sends warnings to owner and connected participants", async () => {
    let chatMessageAdded: any = null;

    const mockRoom = {
      roomId: "ending-room-1",
      roomTitle: "Study Session",
      getConnectedParticipantUids: () => ["host-uid", "participant-uid"],
      addChatMessage: (_sender: any, msg: any) => {
        chatMessageAdded = msg;
      },
    } as unknown as Room;

    const rooms = new Map<string, Room>([["ending-room-1", mockRoom]]);

    const mockPostgres = {
      query: async <T = unknown>(queryText: string) => {
        assert.ok(queryText.includes("endingNotifiedAt"));
        assert.ok(queryText.includes("FOR UPDATE SKIP LOCKED"));
        return {
          rowCount: 1,
          rows: [
            {
              roomId: "ending-room-1",
              ownerId: "host-uid",
              expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
              roomTitle: "Study Session",
            },
          ] as unknown as T[],
        };
      },
    };


    const options = createOptions({
      rooms,
      postgres: mockPostgres,
    });
    const controller = registerBackgroundMaintenance(options);

    await controller.checkEndingSoonRooms();

    assert.equal(mockNotificationCalls.length, 2);
    assert.equal(mockNotificationCalls[0].userId, "host-uid");
    assert.equal(mockNotificationCalls[0].type, "ROOM_ENDING");
    assert.equal(mockNotificationCalls[1].userId, "participant-uid");
    assert.equal(mockNotificationCalls[1].type, "ROOM_ENDING");

    assert.ok(chatMessageAdded);
    assert.equal(chatMessageAdded.msg, "Notice: This room will expire in 15 minutes.");

    for (const timer of controller.intervals) {
      clearTimeout(timer);
    }
  });

  it("6. minuteMetrics: enforces dirty-set suppression and writes shard telemetry to Redis", async () => {
    const mockRoomA = {
      roomId: "room-a",
      roster: [{ id: "u1" }, { id: "u2" }],
      getRosterForStats: () => [{ id: "u1" }, { id: "u2" }],
    } as unknown as Room;

    const mockRoomB = {
      roomId: "room-b",
      roster: [],
      getRosterForStats: () => [],
    } as unknown as Room;

    const rooms = new Map<string, Room>([
      ["room-a", mockRoomA],
      ["room-b", mockRoomB],
    ]);

    const options = createOptions({
      rooms,
      io: createMockIo(42),
    });
    const controller = registerBackgroundMaintenance(options);

    // First execution: state is dirty, should write room-a to batch and room-b to clean
    await controller.minuteMetrics();

    assert.equal(mockRedisEdgeBatches.length, 1);
    assert.ok(mockRedisEdgeBatches[0]["room-a"]);
    assert.equal(mockRedisEdgeCleans.length, 1);
    assert.deepEqual(mockRedisEdgeCleans[0], ["room-b"]);

    // Shard metrics write
    assert.equal(mockShardMetricsWrites.length, 1);
    assert.equal(mockShardMetricsWrites[0].key, "shardMetrics:1");
    assert.equal(mockShardMetricsWrites[0].value.roomCount, 2);
    assert.equal(mockShardMetricsWrites[0].value.users, 42);

    // Second execution with no change: should NOT emit dirty presence batch
    mockRedisEdgeBatches = [];
    mockRedisEdgeCleans = [];
    await controller.minuteMetrics();

    assert.equal(
      mockRedisEdgeBatches.length,
      0,
      "Clean presence snapshot must suppress redundant Redis writes",
    );
    assert.equal(
      mockRedisEdgeCleans.length,
      0,
      "Clean empty room snapshot must suppress redundant Redis writes",
    );

    for (const timer of controller.intervals) {
      clearTimeout(timer);
    }
  });

  it("7. retentionMaintenance: executes expired read and aged outbox purges with configured retention", async () => {
    const options = createOptions({
      configOverride: {
        EMAIL_SENT_RETENTION_DAYS: 21,
        EMAIL_FAILED_RETENTION_DAYS: 90,
      },
    });
    const controller = registerBackgroundMaintenance(options);

    await controller.retentionMaintenance();

    assert.equal(mockPurgeCalls.read, 1);
    assert.deepEqual(mockPurgeCalls.sentDays, [21]);
    assert.deepEqual(mockPurgeCalls.failedDays, [90]);

    for (const timer of controller.intervals) {
      clearTimeout(timer);
    }
  });
}).then(() => {
  process.exit(0);
}).catch((err) => {
  console.error("BackgroundMaintenance test failure:", err);
  process.exit(1);
});


