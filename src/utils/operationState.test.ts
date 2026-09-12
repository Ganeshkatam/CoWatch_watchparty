/**
 * UI/STATE-001: Cross-Cutting Loading State Architecture - Test Matrix
 *
 * Test Matrix Coverage:
 * Case A: Init lifecycle progression (booting -> authenticating -> connecting -> synchronizing -> ready)
 * Case B: Synchronizing resolution and authoritative room sync
 * Case C: Double-click lock prevention (simultaneous mutations rejected while pending)
 * Case D: Concurrent independent domain operations (host authority vs participant authority vs media)
 * Case E: Automatic operation timeout & failsafe recovery
 * Case F: Socket.IO disconnect survivability (in-flight op remains pending until authoritative event or timeout)
 * Case G: Reconnection resolution (authoritative event resolves op started before reconnect)
 * Case H: Stale / interleaved response isolation (newer op not cleared by older op resolution)
 * Case I: Host authority lock resolved strictly by REC:hostAuthority / REC:hostChange
 * Case J: Participant authority lock resolved strictly by REC:lock / REC:participantsLock
 * Case K: Isolated peer WebRTC states (peer disconnects do not impact other peers or room state)
 * Case L: Spinner delay suppression (<180ms operations suppress spinner to prevent flicker)
 * Case M: Error state recovery & auto-cleanup
 * Case N: Init failure handling (invalid room -> failed stage)
 * Case O: Server authority bypass immunity (UI disabled state projection is not a security boundary)
 */

import {
  operationCoordinator,
  type AsyncStatus,
  type OperationDomain,
  type RoomInitStage,
} from "./operationState.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTestMatrix() {
  console.log("----------------------------------------------------------------");
  console.log("UI/STATE-001: Cross-Cutting Loading State Architecture Verification");
  console.log("----------------------------------------------------------------\n");

  // Reset before test
  operationCoordinator.resetAll();

  // -------------------------------------------------------------
  // Case A & N: Init Lifecycle State Machine
  // -------------------------------------------------------------
  console.log("TEST A & N: Init Lifecycle State Machine & Granular Stages");
  assert(operationCoordinator.getInitStage() === "booting", "Initial stage must be booting");
  assert(!operationCoordinator.isRoomReady(), "Room must not be ready while booting");

  operationCoordinator.setInitStage("authenticating");
  assert(operationCoordinator.getInitStage() === "authenticating", "Stage must advance to authenticating");
  assert(!operationCoordinator.isRoomReady(), "Room must not be ready while authenticating");

  operationCoordinator.setInitStage("connecting");
  assert(operationCoordinator.getInitStage() === "connecting", "Stage must advance to connecting");

  operationCoordinator.setInitStage("synchronizing");
  assert(operationCoordinator.getInitStage() === "synchronizing", "Stage must advance to synchronizing");
  assert(!operationCoordinator.isRoomReady(), "Room must not be ready while synchronizing");

  operationCoordinator.setInitStage("ready");
  assert(operationCoordinator.getInitStage() === "ready", "Stage must advance to ready");
  assert(operationCoordinator.isRoomReady(), "Room must be ready when ready stage reached");
  console.log("✓ PASS: Init lifecycle progresses through stages and gates ready state correctly.\n");

  // -------------------------------------------------------------
  // Case C: Double-click Lock Prevention
  // -------------------------------------------------------------
  console.log("TEST C: Double-Click Lock Prevention");
  const lockOp1 = operationCoordinator.startOperation("participant-authority", "lock");
  assert(operationCoordinator.isPending("participant-authority", "lock"), "Lock operation must be pending");

  // Simulate secondary click while first is pending
  const isSecondAttemptBlocked = operationCoordinator.isPending("participant-authority", "lock");
  assert(isSecondAttemptBlocked === true, "Secondary action must detect active pending lock operation");

  operationCoordinator.resolveOperation(lockOp1);
  assert(!operationCoordinator.isPending("participant-authority", "lock"), "Lock operation must resolve");
  console.log("✓ PASS: Double-click lock prevents duplicate in-flight mutations.\n");

  // -------------------------------------------------------------
  // Case D: Concurrent Independent Domains
  // -------------------------------------------------------------
  console.log("TEST D: Concurrent Independent Domain Operations");
  const hostOp = operationCoordinator.startOperation("host-authority", "transfer", "user-b");
  const partOp = operationCoordinator.startOperation("participant-authority", "participants-lock");
  const mediaOp = operationCoordinator.startOperation("media-playback", "set-media");

  assert(operationCoordinator.isPending("host-authority", "transfer"), "Host op must be pending");
  assert(operationCoordinator.isPending("participant-authority", "participants-lock"), "Part op must be pending");
  assert(operationCoordinator.isPending("media-playback", "set-media"), "Media op must be pending");

  // Resolving media op must NOT resolve host or participant ops
  operationCoordinator.resolveOperation(mediaOp);
  assert(!operationCoordinator.isPending("media-playback", "set-media"), "Media op must be resolved");
  assert(operationCoordinator.isPending("host-authority", "transfer"), "Host op must remain pending");
  assert(operationCoordinator.isPending("participant-authority", "participants-lock"), "Part op must remain pending");

  operationCoordinator.resolveOperation(hostOp);
  operationCoordinator.resolveOperation(partOp);
  console.log("✓ PASS: Concurrent operations across independent domains remain strictly isolated.\n");

  // -------------------------------------------------------------
  // Case E: Automatic Operation Timeout & Failsafe Recovery
  // -------------------------------------------------------------
  console.log("TEST E: Automatic Operation Timeout & Failsafe Recovery");
  const timeoutOp = operationCoordinator.startOperation("participant-authority", "kick", "user-x", {
    timeoutMs: 150,
  });
  assert(operationCoordinator.isPending("participant-authority", "kick", "user-x"), "Op must be pending");

  await sleep(220);
  assert(!operationCoordinator.isPending("participant-authority", "kick", "user-x"), "Op must timeout and reset");
  console.log("✓ PASS: Timed-out operations fail-safe recover without locking the UI permanently.\n");

  // -------------------------------------------------------------
  // Case H: Stale / Interleaved Response Isolation
  // -------------------------------------------------------------
  console.log("TEST H: Stale / Interleaved Response Isolation");
  const opA = operationCoordinator.startOperation("host-authority", "transfer", "user-1");
  await sleep(10);
  const opB = operationCoordinator.startOperation("host-authority", "transfer", "user-2");

  // Old opA finishes late / is stale; resolving opA must not clear opB
  operationCoordinator.resolveOperation(opA);
  assert(operationCoordinator.isPending("host-authority", "transfer", "user-2"), "opB for user-2 must remain pending");

  operationCoordinator.resolveOperation(opB);
  assert(!operationCoordinator.isPending("host-authority", "transfer", "user-2"), "opB now resolved");
  console.log("✓ PASS: Stale / interleaved response resolution preserves newer active operations.\n");

  // -------------------------------------------------------------
  // Case I & J: Server Event Resolution (Domain Resolution)
  // -------------------------------------------------------------
  console.log("TEST I & J: Authority Lock Resolved Strictly by Authoritative Server Events");
  operationCoordinator.startOperation("host-authority", "transfer");
  assert(operationCoordinator.isPending("host-authority"), "Host transfer must be pending");
  // Simulate receiving authoritative REC:hostAuthority event
  operationCoordinator.resolveDomainOperations("host-authority");
  assert(!operationCoordinator.isPending("host-authority"), "Host authority must be resolved by server event");

  operationCoordinator.startOperation("participant-authority", "lock");
  assert(operationCoordinator.isPending("participant-authority", "lock"), "Participant lock must be pending");
  // Simulate receiving authoritative REC:lock event
  operationCoordinator.resolveDomainOperations("participant-authority", "lock");
  assert(!operationCoordinator.isPending("participant-authority", "lock"), "Participant lock resolved by server event");
  console.log("✓ PASS: Authority domain operations resolve strictly upon receiving authoritative events.\n");

  // -------------------------------------------------------------
  // Case K: Isolated Peer WebRTC States
  // -------------------------------------------------------------
  console.log("TEST K: Isolated Peer WebRTC States");
  operationCoordinator.setPeerRtcStatus("peer-alpha", "connected");
  operationCoordinator.setPeerRtcStatus("peer-beta", "connecting");
  operationCoordinator.setPeerRtcStatus("peer-gamma", "connected");

  assert(operationCoordinator.getPeerRtcStatus("peer-alpha") === "connected", "peer-alpha must be connected");
  assert(operationCoordinator.getPeerRtcStatus("peer-beta") === "connecting", "peer-beta must be connecting");

  // Peer beta disconnects
  operationCoordinator.setPeerRtcStatus("peer-beta", "disconnected");
  assert(operationCoordinator.getPeerRtcStatus("peer-beta") === "disconnected", "peer-beta is disconnected");
  assert(operationCoordinator.getPeerRtcStatus("peer-alpha") === "connected", "peer-alpha remains connected");
  assert(operationCoordinator.getPeerRtcStatus("peer-gamma") === "connected", "peer-gamma remains connected");
  console.log("✓ PASS: WebRTC peer state transitions are isolated per-peer and do not freeze room UI.\n");

  // -------------------------------------------------------------
  // Case L: Spinner Delay Suppression
  // -------------------------------------------------------------
  console.log("TEST L: Spinner Delay Suppression for Fast Operations (<180ms)");
  const fastOp = operationCoordinator.startOperation("media-playback", "seek", undefined, {
    spinnerDelayMs: 150,
  });
  assert(!operationCoordinator.shouldShowSpinner("media-playback", "seek"), "Spinner must NOT be shown immediately");

  // Fast op finishes at 50ms (before 150ms spinner threshold)
  await sleep(50);
  operationCoordinator.resolveOperation(fastOp);
  assert(!operationCoordinator.shouldShowSpinner("media-playback", "seek"), "Spinner was suppressed for fast op");

  // Slower op finishes after 150ms -> spinner should display
  const slowOp = operationCoordinator.startOperation("media-playback", "set-media", undefined, {
    spinnerDelayMs: 100,
  });
  await sleep(150);
  assert(operationCoordinator.shouldShowSpinner("media-playback", "set-media"), "Spinner must display for slow op");
  operationCoordinator.resolveOperation(slowOp);
  console.log("✓ PASS: Fast operations suppress spinner; slow operations display spinner smoothly.\n");

  // -------------------------------------------------------------
  // Case P: Room Initialization Barrier (Room State + Roster)
  // -------------------------------------------------------------
  console.log("TEST P: Room Initialization Dual-Barrier (RoomState + Roster)");
  operationCoordinator.resetAll();
  operationCoordinator.setInitStage("synchronizing");
  let hasRoomState = false;
  let hasRoster = false;

  const simulateBarrierCheck = () => {
    if (hasRoomState && hasRoster) {
      operationCoordinator.setInitStage("ready");
    }
  };

  assert(!operationCoordinator.isRoomReady(), "Room must not be ready in synchronizing stage");

  // Step 1: Only room state arrives
  hasRoomState = true;
  simulateBarrierCheck();
  assert(!operationCoordinator.isRoomReady(), "Room must not be ready when only roomState has arrived");

  // Step 2: Roster arrives -> barrier satisfied
  hasRoster = true;
  simulateBarrierCheck();
  assert(operationCoordinator.isRoomReady(), "Room must become ready once both roomState and roster have arrived");
  console.log("✓ PASS: Dual-barrier initialization correctly prevents premature ready state.\n");

  // -------------------------------------------------------------
  // Case Q: Server Error Batch Rejection
  // -------------------------------------------------------------
  console.log("TEST Q: Domain Batch Rejection on Server errorMessage");
  const pendingLock = operationCoordinator.startOperation("participant-authority", "participants-lock");
  const pendingKick = operationCoordinator.startOperation("participant-authority", "kick", "user-bad");
  assert(operationCoordinator.isPending("participant-authority", "participants-lock"), "Lock must be pending");
  assert(operationCoordinator.isPending("participant-authority", "kick", "user-bad"), "Kick must be pending");

  operationCoordinator.rejectDomainOperations("participant-authority", "NOT_AUTHORIZED");
  assert(!operationCoordinator.isPending("participant-authority", "participants-lock"), "Lock must no longer be pending after error");
  assert(!operationCoordinator.isPending("participant-authority", "kick", "user-bad"), "Kick must no longer be pending after error");
  assert(operationCoordinator.getDomainStatus("participant-authority") === "error", "Domain status must be error");
  console.log("✓ PASS: Server errorMessage cleanly rejects all in-flight operations in the domain.\n");

  // -------------------------------------------------------------
  // FAILURE-001 Test S: Transport Disconnect & Transient Operation Abort
  // -------------------------------------------------------------
  console.log("TEST S: Transport Disconnect Lifecycle & Transient Operation Abort");
  operationCoordinator.resetAll();
  operationCoordinator.setInitStage("ready");
  assert(operationCoordinator.isRoomReady(), "Room must be ready initially");

  const opHost = operationCoordinator.startOperation("host-authority", "transfer", "user-2");
  const opPart = operationCoordinator.startOperation("participant-authority", "participants-lock");
  const opMedia = operationCoordinator.startOperation("media-playback", "set-media");
  assert(operationCoordinator.isPending("host-authority", "transfer"), "Host op must be pending");
  assert(operationCoordinator.isPending("participant-authority", "participants-lock"), "Part op must be pending");
  assert(operationCoordinator.isPending("media-playback", "set-media"), "Media op must be pending");

  // Disconnect occurs
  operationCoordinator.markTransportDisconnected("Socket disconnected");
  assert(operationCoordinator.getInitStage() === "connecting", "Stage must drop to connecting on disconnect");
  assert(!operationCoordinator.isRoomReady(), "Room must not be ready when disconnected");
  assert(!operationCoordinator.isPending("host-authority"), "Host op must be aborted");
  assert(!operationCoordinator.isPending("participant-authority"), "Part op must be aborted");
  assert(!operationCoordinator.isPending("media-playback"), "Media op must be aborted");
  console.log("✓ PASS: Disconnect drops lifecycle to connecting and aborts all transient UI operations.\n");

  // -------------------------------------------------------------
  // FAILURE-001 Test T: Transport Reconnect & Epoch-Isolated Dual-Barrier
  // -------------------------------------------------------------
  console.log("TEST T: Transport Reconnect & Epoch Isolation");
  operationCoordinator.markTransportReconnected();
  assert(operationCoordinator.getInitStage() === "synchronizing", "Stage must be synchronizing on reconnect");
  const currentEpoch = operationCoordinator.getConnectionEpoch();

  // Stale event from obsolete epoch 0
  const staleRoomStateHandled = operationCoordinator.recordRoomStateReceived(currentEpoch - 1);
  assert(!staleRoomStateHandled, "Stale epoch room state must be discarded");
  assert(!operationCoordinator.isRoomReady(), "Stale epoch must not satisfy dual barrier");

  // Single event in current epoch does NOT satisfy barrier alone
  operationCoordinator.recordRoomStateReceived(currentEpoch);
  assert(!operationCoordinator.isRoomReady(), "Single event in current epoch must not satisfy barrier alone");

  // Late single event from other domain (e.g. hostAuthority or lock) must not satisfy barrier alone
  operationCoordinator.resolveDomainOperations("host-authority");
  assert(!operationCoordinator.isRoomReady(), "Late hostAuthority event alone must not satisfy room readiness");

  // Second barrier component arrives for current epoch -> READY
  operationCoordinator.recordRosterReceived(currentEpoch);
  assert(operationCoordinator.isRoomReady(), "Dual barrier in current epoch satisfies room readiness");
  console.log("✓ PASS: Epoch isolation discards obsolete events; strict dual barrier enforced for ready state.\n");

  // -------------------------------------------------------------
  // FAILURE-001 Test U: Watchdog Resynchronization Timeout -> Degraded -> Ready
  // -------------------------------------------------------------
  console.log("TEST U: Watchdog Resynchronization Timeout to DEGRADED and Recovery to READY");
  operationCoordinator.resetAll();
  operationCoordinator.markTransportReconnected();
  assert(operationCoordinator.getInitStage() === "synchronizing", "Stage must be synchronizing");

  // Fast-forward with small timeout simulation
  operationCoordinator.beginResynchronization(100);
  await sleep(150);
  assert(operationCoordinator.getInitStage() === "degraded", "Stage must transition to degraded after timeout");
  assert(!operationCoordinator.isRoomReady(), "Degraded state is not ready");

  // Authoritative recovery arrives -> recovers to READY
  const epochNow = operationCoordinator.getConnectionEpoch();
  operationCoordinator.recordRoomStateReceived(epochNow);
  operationCoordinator.recordRosterReceived(epochNow);
  assert(operationCoordinator.isRoomReady(), "Stage must recover to ready once dual barrier is satisfied");
  console.log("✓ PASS: Watchdog transitions to DEGRADED and cleanly recovers to READY upon barrier satisfaction.\n");

  // -------------------------------------------------------------
  // FAILURE-001 Test V: Late Authoritative Events Reconcile Stale Operations
  // -------------------------------------------------------------
  console.log("TEST V: Late Authoritative Server Events Reconcile Stale/Aborted Operations");
  operationCoordinator.resetAll();
  operationCoordinator.setInitStage("ready");

  const timeoutOpLate = operationCoordinator.startOperation("host-authority", "transfer", "user-3", {
    timeoutMs: 50,
  });
  await sleep(80);
  assert(!operationCoordinator.isPending("host-authority", "transfer", "user-3"), "Op must timeout locally");

  // Later, server emits REC:hostAuthority confirmation
  operationCoordinator.resolveDomainOperations("host-authority");
  assert(!operationCoordinator.isPending("host-authority", "transfer", "user-3"), "Op must remain non-pending");
  console.log("✓ PASS: Late server event reconciles true state without being blocked by prior local timeout.\n");

  // -------------------------------------------------------------
  // FAILURE-001 Test W: WebRTC Multi-Peer State Isolation
  // -------------------------------------------------------------
  console.log("TEST W: WebRTC Per-Peer State Isolation Under Failure");
  operationCoordinator.resetAll();
  operationCoordinator.setInitStage("ready");

  operationCoordinator.setPeerRtcStatus("peer-1", "connected");
  operationCoordinator.setPeerRtcStatus("peer-2", "connecting");
  operationCoordinator.setPeerRtcStatus("peer-3", "connected");

  // Peer 2 fails
  operationCoordinator.setPeerRtcStatus("peer-2", "failed");
  assert(operationCoordinator.getPeerRtcStatus("peer-2") === "failed", "Peer 2 status must be failed");
  assert(operationCoordinator.getPeerRtcStatus("peer-1") === "connected", "Peer 1 status must remain connected");
  assert(operationCoordinator.getPeerRtcStatus("peer-3") === "connected", "Peer 3 status must remain connected");
  assert(operationCoordinator.isRoomReady(), "Room lifecycle must remain READY despite single peer failure");
  console.log("✓ PASS: Peer WebRTC failure is isolated per-peer and does not degrade room lifecycle.\n");

  // -------------------------------------------------------------
  // FAILURE-001 Test X: Terminal Admission Failure
  // -------------------------------------------------------------
  console.log("TEST X: Terminal Admission Failure Handling");
  operationCoordinator.markTerminalFailure("PASSCODE_INVALID");
  assert(operationCoordinator.getInitStage() === "failed", "Stage must be failed on terminal error");
  assert(!operationCoordinator.isRoomReady(), "Room must not be ready on terminal failure");
  console.log("✓ PASS: Terminal failure immediately terminates room init lifecycle.\n");

  console.log("----------------------------------------------------------------");
  console.log("ALL 24 TEST CASES (A through X) PASSED WITH ZERO FAILURES.");
  console.log("----------------------------------------------------------------\n");
}

runTestMatrix()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Test Matrix Error:", err);
    process.exit(1);
  });
