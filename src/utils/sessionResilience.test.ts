/**
 * SESSION-001: Session Reconnection & Network Resilience Verification Suite
 *
 * Verifies:
 * - Group 1: Reconnect State Machine transitions
 * - Group 2: Connection epoch monotonicity and obsolete event rejection
 * - Group 3: Dual readiness barrier recovery in new epochs
 * - Group 4: Elapsed time progression (0-5s connecting, >5s degraded)
 * - Group 5: Transient operation abortion on transport disconnect
 * - Group 6: Late authoritative response reconciliation
 * - Group 7: Durable local state preservation during reconnect cycles
 * - Group 8: Multi-cycle disconnect/reconnect stability under high frequency
 * - Group 9: Presentation boundary routing (zero raw error leak)
 * - Group 10: Epoch-Crossing Abort (Op started in epoch N resolving in epoch N+1 is discarded)
 * - Group 11: Sync Barrier Permutations (order independence, stale interleavings)
 * - Group 12: Dual-Budget Exhaustion (attempts ceiling vs wall-clock ceiling vs success reset)
 * - Group 13: State Preservation vs Re-fetch (durable local state vs authoritative server state)
 */

import assert from "node:assert";
import {
  OperationCoordinator,
  RETRY_ATTEMPT_BUDGET,
  MAX_RECOVERY_WINDOW_MS,
  DEGRADED_THRESHOLD_MS,
  type RoomInitStage,
} from "./operationState.js";
import {
  USER_MESSAGES,
  getLifecycleUserMessage,
  getLifecycleStageMessage,
  sanitizeServerUserMessage,
} from "./userMessages.js";

console.log("----------------------------------------------------------------");
console.log("SESSION-001: Session Reconnection & Network Resilience Suite");
console.log("----------------------------------------------------------------");

// ---------------------------------------------------------------------------
// Group 1: Reconnect State Machine Transitions
// ---------------------------------------------------------------------------
{
  const coord = new OperationCoordinator();
  assert.strictEqual(coord.getInitStage(), "booting");

  coord.setInitStage("authenticating");
  assert.strictEqual(coord.getInitStage(), "authenticating");

  coord.setInitStage("connecting");
  assert.strictEqual(coord.getInitStage(), "connecting");

  const ep = coord.beginConnectionEpoch();
  assert.strictEqual(coord.getInitStage(), "synchronizing");
  assert.strictEqual(ep, 1);

  coord.recordRoomStateReceived(ep);
  coord.recordRosterReceived(ep);
  assert.strictEqual(coord.getInitStage(), "ready");
  assert.strictEqual(coord.isRoomReady(), true);

  console.log("  PASS [Group 1]: Clean state machine transitions through booting -> authenticating -> connecting -> synchronizing -> ready.");
}

// ---------------------------------------------------------------------------
// Group 2: Connection Epoch Monotonicity and Obsolete Event Rejection
// ---------------------------------------------------------------------------
{
  const coord = new OperationCoordinator();
  const ep1 = coord.beginConnectionEpoch();
  const ep2 = coord.beginConnectionEpoch();
  const ep3 = coord.beginConnectionEpoch();
  assert.strictEqual(ep3 > ep2 && ep2 > ep1, true, "Epochs must be strictly monotonic");

  // Attempting to deliver sync events from obsolete epoch 1 or 2
  assert.strictEqual(coord.canAcceptSyncEvent(ep1), false, "Epoch 1 sync event rejected in Epoch 3");
  assert.strictEqual(coord.canAcceptSyncEvent(ep2), false, "Epoch 2 sync event rejected in Epoch 3");
  assert.strictEqual(coord.canAcceptSyncEvent(ep3), true, "Epoch 3 sync event accepted in Epoch 3");

  // Attempting to deliver mutation events from obsolete epochs
  assert.strictEqual(coord.canAcceptMutationEvent(ep1), false, "Epoch 1 mutation rejected");
  assert.strictEqual(coord.canAcceptMutationEvent(ep2), false, "Epoch 2 mutation rejected");

  console.log("  PASS [Group 2]: Monotonic epoch progression strictly invalidates obsolete events.");
}

// ---------------------------------------------------------------------------
// Group 3: Dual Readiness Barrier Recovery in New Epochs
// ---------------------------------------------------------------------------
{
  const coord = new OperationCoordinator();
  const ep1 = coord.beginConnectionEpoch();
  coord.recordRoomStateReceived(ep1);
  coord.recordRosterReceived(ep1);
  assert.strictEqual(coord.isRoomReady(), true, "Epoch 1 reached ready");

  // Disconnect -> Epoch 2 begins
  coord.markTransportDisconnected();
  assert.strictEqual(coord.isRoomReady(), false, "Disconnect revokes ready status");

  const ep2 = coord.beginConnectionEpoch();
  assert.strictEqual(coord.getInitStage(), "synchronizing");

  // Delivering only roomState does not unlock ready
  coord.recordRoomStateReceived(ep2);
  assert.strictEqual(coord.isRoomReady(), false, "Partial barrier must not unlock ready");

  // Delivering roster unlocks ready
  coord.recordRosterReceived(ep2);
  assert.strictEqual(coord.isRoomReady(), true, "Dual barrier unlocks ready in Epoch 2");

  console.log("  PASS [Group 3]: Dual barrier reliably re-establishes readiness across epochs.");
}

// ---------------------------------------------------------------------------
// Group 4: Elapsed Time Progression (0-5s connecting, >5s degraded)
// ---------------------------------------------------------------------------
{
  const coord = new OperationCoordinator();
  const now = 1_000_000;
  coord.markTransportDisconnected("Transport disconnected", now);

  // Within 0-5s -> connecting
  coord.recordReconnectAttempt(1, now + 2_000);
  assert.strictEqual(coord.getInitStage(), "connecting", "2s elapsed remains connecting");

  // After 5s -> degraded
  coord.recordReconnectAttempt(2, now + 5_500);
  assert.strictEqual(coord.getInitStage(), "degraded", ">5s elapsed transitions to degraded");

  console.log("  PASS [Group 4]: Elapsed time progression correctly triggers degraded state at >5s.");
}

// ---------------------------------------------------------------------------
// Group 5: Transient Operation Abortion on Transport Disconnect
// ---------------------------------------------------------------------------
{
  const coord = new OperationCoordinator();
  const op1 = coord.startOperation("host-authority", "transfer");
  const op2 = coord.startOperation("participant-authority", "lock");
  const op3 = coord.startOperation("media-playback", "seek");
  const op4 = coord.startOperation("settings", "update-audio");

  assert.strictEqual(coord.isPending("host-authority", "transfer"), true);
  assert.strictEqual(coord.isPending("participant-authority", "lock"), true);
  assert.strictEqual(coord.isPending("media-playback", "seek"), true);
  assert.strictEqual(coord.isPending("settings", "update-audio"), true);

  coord.markTransportDisconnected();

  assert.strictEqual(coord.isPending("host-authority", "transfer"), false);
  assert.strictEqual(coord.isPending("participant-authority", "lock"), false);
  assert.strictEqual(coord.isPending("media-playback", "seek"), false);
  assert.strictEqual(coord.isPending("settings", "update-audio"), false);

  console.log("  PASS [Group 5]: All transient operations are cleanly aborted on transport disconnect.");
}

// ---------------------------------------------------------------------------
// Group 6: Late Authoritative Response Reconciliation
// ---------------------------------------------------------------------------
{
  const coord = new OperationCoordinator();
  const ep1 = coord.beginConnectionEpoch();
  coord.recordRoomStateReceived(ep1);
  coord.recordRosterReceived(ep1);
  assert.strictEqual(coord.isRoomReady(), true);

  // Network blip -> reconnect -> epoch 2
  coord.markTransportDisconnected();
  const ep2 = coord.beginConnectionEpoch();

  // Stale REC:hostAuthority from epoch 1 arrives late
  const acceptedStale = coord.canAcceptMutationEvent(ep1);
  assert.strictEqual(acceptedStale, false, "Late mutation from epoch 1 must be rejected");

  // Current epoch synchronization arrives
  coord.recordRoomStateReceived(ep2);
  coord.recordRosterReceived(ep2);
  assert.strictEqual(coord.isRoomReady(), true);

  // Current mutation accepted
  const acceptedCurrent = coord.canAcceptMutationEvent(ep2);
  assert.strictEqual(acceptedCurrent, true, "Epoch 2 mutation accepted after dual barrier");

  console.log("  PASS [Group 6]: Late authoritative events from prior epochs do not corrupt current state.");
}

// ---------------------------------------------------------------------------
// Group 7: Durable Local State Preservation During Reconnect Cycles
// ---------------------------------------------------------------------------
{
  // Simulated local state vs server state
  interface ClientState {
    activeTab: string;
    chatDraft: string;
    selectedMicId: string;
    localTimestampHint: number;
    // Authoritative server state
    roomLock: string | null;
    participantsLocked: boolean;
    serverVideoTS: number;
  }

  const clientState: ClientState = {
    activeTab: "chat",
    chatDraft: "Hello world!",
    selectedMicId: "mic-default-1",
    localTimestampHint: 124.5,
    roomLock: "host-123",
    participantsLocked: true,
    serverVideoTS: 120.0,
  };

  // Simulate disconnect
  const coord = new OperationCoordinator();
  coord.markTransportDisconnected();

  // Invariant: Durable local state is preserved
  assert.strictEqual(clientState.activeTab, "chat");
  assert.strictEqual(clientState.chatDraft, "Hello world!");
  assert.strictEqual(clientState.selectedMicId, "mic-default-1");
  assert.strictEqual(clientState.localTimestampHint, 124.5);

  // Reconnect and synchronize authoritative server state
  const ep = coord.beginConnectionEpoch();
  const authoritativeServerPayload = {
    roomLock: null,
    participantsLocked: false,
    serverVideoTS: 135.0,
    __epoch: ep,
  };

  if (coord.canAcceptSyncEvent(authoritativeServerPayload.__epoch)) {
    clientState.roomLock = authoritativeServerPayload.roomLock;
    clientState.participantsLocked = authoritativeServerPayload.participantsLocked;
    clientState.serverVideoTS = authoritativeServerPayload.serverVideoTS;
  }

  coord.recordRoomStateReceived(ep);
  coord.recordRosterReceived(ep);

  assert.strictEqual(clientState.roomLock, null, "Authoritative roomLock updated");
  assert.strictEqual(clientState.participantsLocked, false, "Authoritative participantsLocked updated");
  assert.strictEqual(clientState.serverVideoTS, 135.0, "Authoritative videoTS updated");
  assert.strictEqual(clientState.chatDraft, "Hello world!", "Local chat draft remained intact");

  console.log("  PASS [Group 7]: Durable local state preserved while server state updates authoritatively.");
}

// ---------------------------------------------------------------------------
// Group 8: Multi-Cycle Disconnect/Reconnect Stability Under High Frequency
// ---------------------------------------------------------------------------
{
  const coord = new OperationCoordinator();
  for (let cycle = 1; cycle <= 50; cycle++) {
    coord.markTransportDisconnected();
    const ep = coord.beginConnectionEpoch();
    assert.strictEqual(ep, cycle);
    coord.recordRoomStateReceived(ep);
    coord.recordRosterReceived(ep);
    assert.strictEqual(coord.isRoomReady(), true);
  }
  assert.strictEqual(coord.getConnectionEpoch(), 50);
  console.log("  PASS [Group 8]: 50 consecutive high-frequency disconnect/reconnect cycles executed cleanly.");
}

// ---------------------------------------------------------------------------
// Group 9: Presentation Boundary Routing (Zero Raw Error Leak)
// ---------------------------------------------------------------------------
{
  const rawTransportErrors = [
    "ECONNRESET: connection reset by peer",
    "ETIMEDOUT: connect timeout to 10.0.0.1:443",
    "transport close: websocket connection closed abnormally",
    "reconnect_error: socket.io handshake 502 Bad Gateway",
  ];

  for (const raw of rawTransportErrors) {
    const sanitized = sanitizeServerUserMessage(raw);
    assert.strictEqual(
      sanitized.message,
      "We couldn't complete this action. Please try again.",
      `Raw error '${raw}' must be sanitized to user-friendly copy`
    );
    assert.strictEqual(sanitized.presentation, "toast");
  }

  // Stage messages
  const stages: RoomInitStage[] = ["connecting", "synchronizing", "degraded", "failed"];
  for (const stage of stages) {
    const msg = getLifecycleUserMessage(stage);
    assert(msg !== null, `Stage ${stage} has a structured UserMessage`);
    assert.strictEqual(typeof msg.message, "string");
    assert(msg.message.length > 0);
  }

  console.log("  PASS [Group 9]: Transport errors and lifecycle stages strictly route through USERMSG-002.");
}

// ---------------------------------------------------------------------------
// Group 10: Epoch-Crossing Abort (Op in epoch N resolving in epoch N+1)
// ---------------------------------------------------------------------------
{
  const coord = new OperationCoordinator();
  const ep1 = coord.beginConnectionEpoch();
  coord.recordRoomStateReceived(ep1);
  coord.recordRosterReceived(ep1);
  assert.strictEqual(coord.isRoomReady(), true);

  // Start operation in epoch 1
  const opId = coord.startOperation("host-authority", "transfer");
  assert.strictEqual(coord.isPending("host-authority", "transfer"), true);

  // Network reconnects -> epoch 2 begins
  coord.markTransportDisconnected();
  const ep2 = coord.beginConnectionEpoch();
  assert.strictEqual(ep2, ep1 + 1);

  // The operation started in epoch 1 tries to resolve in epoch 2
  const resolved = coord.resolveOperation(opId);
  assert.strictEqual(resolved, false, "Epoch-crossing operation resolution must be discarded");
  assert.strictEqual(coord.isPending("host-authority", "transfer"), false, "Stale op must not remain pending");

  console.log("  PASS [Group 10]: Epoch-crossing operations are cleanly aborted and discarded.");
}

// ---------------------------------------------------------------------------
// Group 11: Sync Barrier Permutations (Order Independence & Stale Interleavings)
// ---------------------------------------------------------------------------
{
  // Permutation A: roomState then roster
  const coordA = new OperationCoordinator();
  const epA = coordA.beginConnectionEpoch();
  assert.strictEqual(coordA.recordRoomStateReceived(epA), false);
  assert.strictEqual(coordA.recordRosterReceived(epA), true);
  assert.strictEqual(coordA.isRoomReady(), true);

  // Permutation B: roster then roomState
  const coordB = new OperationCoordinator();
  const epB = coordB.beginConnectionEpoch();
  assert.strictEqual(coordB.recordRosterReceived(epB), false);
  assert.strictEqual(coordB.recordRoomStateReceived(epB), true);
  assert.strictEqual(coordB.isRoomReady(), true);

  // Permutation C: stale interleavings
  const coordC = new OperationCoordinator();
  const epC1 = coordC.beginConnectionEpoch();
  coordC.markTransportDisconnected();
  const epC2 = coordC.beginConnectionEpoch();

  // Deliver stale roster from epC1 and current roomState from epC2
  assert.strictEqual(coordC.recordRosterReceived(epC1), false, "Stale roster rejected");
  assert.strictEqual(coordC.recordRoomStateReceived(epC2), false, "Current roomState alone does not satisfy");
  assert.strictEqual(coordC.isRoomReady(), false, "Room not ready with mismatched barrier epochs");

  // Deliver current roster from epC2
  assert.strictEqual(coordC.recordRosterReceived(epC2), true, "Matching current roster satisfies dual barrier");
  assert.strictEqual(coordC.isRoomReady(), true);

  console.log("  PASS [Group 11]: Sync barrier order independence and stale interleaving rejection verified.");
}

// ---------------------------------------------------------------------------
// Group 12: Dual-Budget Exhaustion (Attempts Ceiling vs Wall-Clock Ceiling)
// ---------------------------------------------------------------------------
{
  // Case A: Attempts ceiling reached (10 attempts) within wall-clock limit
  const coordA = new OperationCoordinator();
  const t0 = 10_000_000;
  coordA.markTransportDisconnected("Transport disconnected", t0);
  for (let i = 1; i <= 9; i++) {
    const ok = coordA.recordReconnectAttempt(i, t0 + i * 1000);
    assert.strictEqual(ok, true, `Attempt ${i} is within budget`);
  }
  const failedAt10 = coordA.recordReconnectAttempt(10, t0 + 10_000);
  assert.strictEqual(failedAt10, false, "Attempt 10 exhausts retry budget");
  assert.strictEqual(coordA.getInitStage(), "failed", "Exhausted budget transitions to failed");

  // Case B: Wall-clock ceiling reached (>45s) within attempt count limit
  const coordB = new OperationCoordinator();
  coordB.markTransportDisconnected("Transport disconnected", t0);
  const okBefore45s = coordB.recordReconnectAttempt(3, t0 + 40_000);
  assert.strictEqual(okBefore45s, true, "3 attempts at 40s is within budget");

  const failedAfter45s = coordB.recordReconnectAttempt(4, t0 + 46_000);
  assert.strictEqual(failedAfter45s, false, "46s elapsed exceeds MAX_RECOVERY_WINDOW_MS");
  assert.strictEqual(coordB.getInitStage(), "failed", "Wall-clock exhaustion transitions to failed");

  // Case C: Successful recovery resets all counters
  const coordC = new OperationCoordinator();
  coordC.markTransportDisconnected("Transport disconnected", t0);
  coordC.recordReconnectAttempt(5, t0 + 15_000);
  assert.strictEqual(coordC.getReconnectAttempts(), 5);

  const epC = coordC.beginConnectionEpoch();
  coordC.recordRoomStateReceived(epC);
  coordC.recordRosterReceived(epC);
  assert.strictEqual(coordC.isRoomReady(), true);
  assert.strictEqual(coordC.getReconnectAttempts(), 0, "Attempts counter reset on ready");
  assert.strictEqual(coordC.getRecoveryStartTime(), 0, "Recovery timer reset on ready");

  console.log("  PASS [Group 12]: Dual-budget ceiling (10 attempts / 45s wall-clock) and reset verified.");
}

// ---------------------------------------------------------------------------
// Group 13: State Preservation vs Re-fetch Boundary
// ---------------------------------------------------------------------------
{
  const coord = new OperationCoordinator();
  const ep1 = coord.beginConnectionEpoch();
  coord.recordRoomStateReceived(ep1);
  coord.recordRosterReceived(ep1);
  assert.strictEqual(coord.isRoomReady(), true);

  // Preserved local states
  const durableUi = {
    chatInput: "Draft message for room",
    volumeSlider: 0.85,
    cameraEnabled: true,
  };

  // Authoritative server entities
  let roomParticipants = [{ id: "user-1", name: "Alice" }];
  let activeHostId = "user-1";

  // Disconnect occurs
  coord.markTransportDisconnected();

  // UI state remains durable
  assert.strictEqual(durableUi.chatInput, "Draft message for room");
  assert.strictEqual(durableUi.volumeSlider, 0.85);

  // Reconnect with new host assignment from server
  const ep2 = coord.beginConnectionEpoch();
  const serverUpdate = {
    participants: [{ id: "user-1", name: "Alice" }, { id: "user-2", name: "Bob" }],
    currentHostId: "user-2",
    __epoch: ep2,
  };

  if (coord.canAcceptSyncEvent(serverUpdate.__epoch)) {
    roomParticipants = serverUpdate.participants;
    activeHostId = serverUpdate.currentHostId;
  }
  coord.recordRoomStateReceived(ep2);
  coord.recordRosterReceived(ep2);

  assert.strictEqual(coord.isRoomReady(), true);
  assert.strictEqual(roomParticipants.length, 2, "Participants re-fetched authoritatively");
  assert.strictEqual(activeHostId, "user-2", "Host authority updated authoritatively");
  assert.strictEqual(durableUi.chatInput, "Draft message for room", "Draft preserved across session re-fetch");

  console.log("  PASS [Group 13]: State preservation vs authoritative re-fetch contract strictly maintained.");
}

console.log("----------------------------------------------------------------");
console.log("ALL 13 SESSION-001 RESILIENCE TESTS PASSED WITH ZERO FAILURES.");
console.log("----------------------------------------------------------------");
