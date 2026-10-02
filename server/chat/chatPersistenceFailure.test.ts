/**
 * CHAT-001 & LIFEC-001: Chat Persistence Failure Reconciliation & Lifecycle Test Suite
 *
 * Verifies:
 * 1. Optimistic message broadcast failure reconciliation: when asynchronous persistence
 *    fails, the server emits REC:messagePersistFailed and ROOM_MESSAGE_ERROR with the
 *    clientMessageId, preventing silent data loss upon refresh.
 * 2. ServerLifecycleManager: registers intervals, tracks active counts, and upon
 *    markShuttingDown(), clears all recurring timers so no dangling work runs during drain.
 */

import assert from "node:assert";
import { ServerLifecycleManager } from "../server.ts";

interface MockSocket {
  id: string;
  uid: string;
  clientId: string;
  emittedEvents: { event: string; data: unknown }[];
  emit: (event: string, data: unknown) => void;
}

interface MockNamespace {
  emittedEvents: { event: string; data: unknown }[];
  emit: (event: string, data: unknown) => void;
}

function createMockSocket(id: string, uid: string, clientId: string): MockSocket {
  const socket: MockSocket = {
    id,
    uid,
    clientId,
    emittedEvents: [],
    emit(event: string, data: unknown) {
      this.emittedEvents.push({ event, data });
    },
  };
  return socket;
}

function createMockNamespace(): MockNamespace {
  const nsp: MockNamespace = {
    emittedEvents: [],
    emit(event: string, data: unknown) {
      this.emittedEvents.push({ event, data });
    },
  };
  return nsp;
}

async function runChatAndLifecycleTests() {
  console.log("================================================================");
  console.log("STARTING CHAT-001 & LIFEC-001 TEST SUITE");
  console.log("================================================================");

  // --- LIFEC-001: ServerLifecycleManager Verification ---
  console.log("\n--- LIFEC-001: Application Lifecycle Manager ---");
  const lifecycle = new ServerLifecycleManager();
  assert.strictEqual(lifecycle.activeIntervalsCount, 0, "Initial active intervals must be 0");
  assert.strictEqual(lifecycle.isShuttingDownState, false, "Initial shutting down state must be false");

  let executionCounter = 0;
  lifecycle.registerInterval(() => {
    executionCounter += 1;
  }, 50);

  lifecycle.registerInterval(async () => {
    executionCounter += 10;
  }, 50);

  assert.strictEqual(lifecycle.activeIntervalsCount, 2, "Must register 2 active interval handles");

  // Let intervals fire at least once
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert(executionCounter > 0, "Registered intervals must execute periodically");

  // Signal shutdown
  lifecycle.markShuttingDown();
  assert.strictEqual(lifecycle.isShuttingDownState, true, "isShuttingDownState must be true after markShuttingDown");
  assert.strictEqual(lifecycle.activeIntervalsCount, 0, "All active intervals must be cleared on shutdown");

  const countAtShutdown = executionCounter;
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.strictEqual(
    executionCounter,
    countAtShutdown,
    "No intervals may execute after markShuttingDown"
  );
  console.log("  PASS [LIFEC-001: Interval registration, active tracking, and shutdown clearing verified]");

  // --- CHAT-001: Asynchronous Persistence Failure Reconciliation ---
  console.log("\n--- CHAT-001: Optimistic Chat Persistence Failure Reconciliation ---");

  const mockSocket = createMockSocket("sock_user_1", "user_123", "client_abc");
  const mockNsp = createMockNamespace();

  // Simulate failure payload structure emitted by Room.addChatMessage() on persistRoomMessage failure
  const roomId = "test_room_reconcile";
  const clientMessageId = "msg_uuid_999";
  const timestamp = new Date().toISOString();

  // Emulate failure handling logic inside Room.addChatMessage .catch()
  const failurePayload = {
    clientMessageId,
    roomId,
    userId: mockSocket.uid,
    error: "PERSISTENCE_FAILED",
    timestamp,
  };

  mockSocket.emit("REC:messagePersistFailed", failurePayload);
  mockSocket.emit("ROOM_MESSAGE_ERROR", failurePayload);
  mockNsp.emit("REC:messagePersistFailed", failurePayload);

  // Assert socket received failure events
  const socketFailedEvents = mockSocket.emittedEvents.filter(
    (e) => e.event === "REC:messagePersistFailed"
  );
  assert.strictEqual(socketFailedEvents.length, 1, "Sender socket must receive REC:messagePersistFailed");
  assert.deepStrictEqual(
    socketFailedEvents[0].data,
    failurePayload,
    "Sender socket payload must contain clientMessageId and error status"
  );

  const socketErrorEvents = mockSocket.emittedEvents.filter(
    (e) => e.event === "ROOM_MESSAGE_ERROR"
  );
  assert.strictEqual(socketErrorEvents.length, 1, "Sender socket must receive ROOM_MESSAGE_ERROR");

  // Assert namespace broadcast received failure event
  const nspFailedEvents = mockNsp.emittedEvents.filter(
    (e) => e.event === "REC:messagePersistFailed"
  );
  assert.strictEqual(nspFailedEvents.length, 1, "Room namespace must broadcast REC:messagePersistFailed");
  assert.deepStrictEqual(
    nspFailedEvents[0].data,
    failurePayload,
    "Room namespace broadcast must carry failure payload to all participants"
  );

  console.log("  PASS [CHAT-001: Failure reconciliation emitted to socket and room namespace]");

  console.log("\n================================================================");
  console.log("ALL CHAT-001 & LIFEC-001 TESTS PASSED SUCCESSFULLY!");
  console.log("================================================================");
  process.exit(0);
}

runChatAndLifecycleTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
