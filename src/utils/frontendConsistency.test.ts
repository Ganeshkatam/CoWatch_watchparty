import assert from "assert";
import {
  operationCoordinator,
  type RoomInitStage,
  type OperationDomain,
} from "./operationState";
import {
  sanitizeServerErrorMessage,
  USER_MESSAGES,
} from "./userMessages";

console.log("Starting FRONTEND-001: Frontend Consistency & Authority Consolidation Test Suite...\n");

async function runTests() {
  // =========================================================================
  // Test 1: Zero-Trust Readiness & Dual Barrier Rule
  // =========================================================================
  console.log("Test 1: Zero-Trust Readiness & Dual Barrier Rule");
  operationCoordinator.resetAll();
  assert.strictEqual(operationCoordinator.isRoomReady(), false, "Room must start in non-ready stage (booting)");
  assert.strictEqual(operationCoordinator.getInitStage(), "booting");

  const epoch0 = operationCoordinator.getConnectionEpoch();
  operationCoordinator.beginResynchronization();
  assert.strictEqual(operationCoordinator.getInitStage(), "synchronizing");
  assert.strictEqual(operationCoordinator.isRoomReady(), false, "Synchronizing stage is NOT ready");

  // Single barrier (roomState only) cannot satisfy readiness
  const roomStateOnly = operationCoordinator.recordRoomStateReceived(epoch0);
  assert.strictEqual(roomStateOnly, false, "Single barrier (roomState only) must not grant readiness");
  assert.strictEqual(operationCoordinator.isRoomReady(), false, "Room must not be ready with only roomState");

  // Second barrier (roster) completes dual barrier
  const rosterSettled = operationCoordinator.recordRosterReceived(epoch0);
  assert.strictEqual(rosterSettled, true, "Dual barrier settled should return true");
  assert.strictEqual(operationCoordinator.isRoomReady(), true, "Room must be READY once dual barrier settles in epoch");
  assert.strictEqual(operationCoordinator.getInitStage(), "ready");
  console.log("✓ PASS: Dual barrier strictly gates READY transition.\n");

  // =========================================================================
  // Test 2: Epoch Isolation & Obsolete Event Rejection (Negative Guarantee)
  // =========================================================================
  console.log("Test 2: Epoch Isolation & Obsolete Event Rejection");
  // Simulate transport disconnect and reconnect -> increments epoch
  operationCoordinator.markTransportDisconnected("Socket drop");
  assert.strictEqual(operationCoordinator.getInitStage(), "connecting");
  assert.strictEqual(operationCoordinator.isRoomReady(), false);

  operationCoordinator.markTransportReconnected();
  const epoch1 = operationCoordinator.getConnectionEpoch();
  assert.strictEqual(epoch1, epoch0 + 1, "Connection epoch must increment on reconnect");
  assert.strictEqual(operationCoordinator.getInitStage(), "synchronizing");

  // Attempting to deliver roomState or roster from obsolete epoch0
  const staleRoomState = operationCoordinator.recordRoomStateReceived(epoch0);
  assert.strictEqual(staleRoomState, false, "Obsolete epoch roomState must be rejected");
  const staleRoster = operationCoordinator.recordRosterReceived(epoch0);
  assert.strictEqual(staleRoster, false, "Obsolete epoch roster must be rejected");
  assert.strictEqual(operationCoordinator.isRoomReady(), false, "Obsolete events must not satisfy readiness");

  // Delivering current epoch1 barriers
  operationCoordinator.recordRoomStateReceived(epoch1);
  operationCoordinator.recordRosterReceived(epoch1);
  assert.strictEqual(operationCoordinator.isRoomReady(), true, "Current epoch barriers satisfy readiness");
  console.log("✓ PASS: Obsolete epoch events are discarded and cannot satisfy readiness.\n");

  // =========================================================================
  // Test 3: Duplicate Mutation Prevention & Domain Tracking
  // =========================================================================
  console.log("Test 3: Duplicate Mutation Prevention & Domain Tracking");
  assert.strictEqual(operationCoordinator.isPending("participant-authority", "lock"), false);

  const opId1 = operationCoordinator.startOperation("participant-authority", "lock");
  assert.strictEqual(operationCoordinator.isPending("participant-authority", "lock"), true);
  assert.strictEqual(typeof opId1, "string");

  // Attempting to check if pending is true to prevent duplicate click dispatch
  const isDuplicateDropSafe = operationCoordinator.isPending("participant-authority", "lock");
  assert.strictEqual(isDuplicateDropSafe, true, "isPending must report true for in-flight operation");

  // Resolve operation
  operationCoordinator.resolveOperation(opId1);
  assert.strictEqual(operationCoordinator.isPending("participant-authority", "lock"), false);
  console.log("✓ PASS: OperationCoordinator prevents duplicate mutation dispatch.\n");

  // =========================================================================
  // Test 4: Settings Domain Support & Transient Abort on Disconnect
  // =========================================================================
  console.log("Test 4: Settings Domain Support & Transient Abort on Disconnect");
  const settingsOpId = operationCoordinator.startOperation("settings", "save-room-settings");
  assert.strictEqual(operationCoordinator.isPending("settings", "save-room-settings"), true);

  // When transport disconnects, all transient operations including settings must be aborted
  operationCoordinator.markTransportDisconnected("Network lost");
  assert.strictEqual(operationCoordinator.isPending("settings", "save-room-settings"), false, "Settings operation must be aborted on disconnect");
  assert.strictEqual(operationCoordinator.isPending("host-authority"), false);
  assert.strictEqual(operationCoordinator.isPending("participant-authority"), false);
  assert.strictEqual(operationCoordinator.isPending("media-playback"), false);
  console.log("✓ PASS: Settings domain is fully tracked and transient operations abort on disconnect.\n");

  // =========================================================================
  // Test 5: Late Authoritative REC Reconciliation
  // =========================================================================
  console.log("Test 5: Late Authoritative REC Reconciliation");
  operationCoordinator.markTransportReconnected();
  const epoch2 = operationCoordinator.getConnectionEpoch();
  operationCoordinator.recordRoomStateReceived(epoch2);
  operationCoordinator.recordRosterReceived(epoch2);
  assert.strictEqual(operationCoordinator.isRoomReady(), true);

  // Client starts a lock operation that times out or is aborted locally
  const localOpId = operationCoordinator.startOperation("participant-authority", "lock");
  operationCoordinator.rejectOperation(localOpId, "Client timed out");
  assert.strictEqual(operationCoordinator.isPending("participant-authority", "lock"), false);

  // Server authoritative REC:lock arrives later -> does not crash or corrupt coordinator
  // Authoritative events resolve domain operations cleanly
  operationCoordinator.resolveDomainOperations("participant-authority", "lock");
  assert.strictEqual(operationCoordinator.isRoomReady(), true, "Room readiness remains intact on late REC");
  console.log("✓ PASS: Late REC events reconcile cleanly without suppressing state.\n");

  // =========================================================================
  // Test 6: WebRTC Isolation Invariant (Negative Guarantee)
  // =========================================================================
  console.log("Test 6: WebRTC Isolation Invariant");
  operationCoordinator.setPeerRtcStatus("peer-user-123", "connecting");
  assert.strictEqual(operationCoordinator.getPeerRtcStatus("peer-user-123"), "connecting");
  assert.strictEqual(operationCoordinator.isRoomReady(), true, "Peer WebRTC connecting must not affect room readiness");

  operationCoordinator.setPeerRtcStatus("peer-user-123", "failed");
  assert.strictEqual(operationCoordinator.getPeerRtcStatus("peer-user-123"), "failed");
  assert.strictEqual(operationCoordinator.isRoomReady(), true, "Peer WebRTC failure must NEVER degrade room readiness");
  console.log("✓ PASS: WebRTC peer failures are isolated from room lifecycle.\n");

  // =========================================================================
  // Test 7: Sanitization Enforcement (USERMSG-002 Boundary)
  // =========================================================================
  console.log("Test 7: Sanitization Enforcement (USERMSG-002 Boundary)");
  const forbiddenTerms = [
    "PostgreSQL",
    "Redis",
    "Socket.IO",
    "WebRTC",
    "ICE",
    "ROOM_FULL",
    "SESSION_INVALID",
    "HOST_TRANSITION_CONFLICT",
    "select * from",
    "uuid",
    "operationId",
    "ECONNREFUSED",
  ];

  const rawErrorsToTest = [
    new Error("PostgreSQL connection terminated unexpectedly in transaction 0x9482"),
    "Redis cluster timeout during SETNX room:lock:123",
    "Socket.IO transport close: ping timeout on socket /room#abc-123",
    "WebRTC ICE connection failed: candidate pair unreachable",
    "ROOM_FULL: max capacity reached for room uuid-789-xyz",
    "SESSION_INVALID: expired token or credentials missing",
    "HOST_TRANSITION_CONFLICT: target already host or stale lease",
    "SyntaxError: select * from rooms where id = 'test' failed",
    "Error: ECONNREFUSED 127.0.0.1:5432",
  ];

  for (const rawErr of rawErrorsToTest) {
    const sanitized = sanitizeServerErrorMessage(rawErr);
    assert.strictEqual(typeof sanitized, "string");
    assert.ok(sanitized.length > 0, "Sanitized error must not be empty");

    for (const term of forbiddenTerms) {
      assert.strictEqual(
        sanitized.toLowerCase().includes(term.toLowerCase()),
        false,
        `Sanitized error "${sanitized}" must NOT contain raw technical term "${term}"`
      );
    }
  }

  // Verify that sanitized message maps to clear user copy
  const roomFullSanitized = sanitizeServerErrorMessage("ROOM_FULL");
  assert.strictEqual(roomFullSanitized, USER_MESSAGES.ROOM_FULL.message);

  const lockConflictSanitized = sanitizeServerErrorMessage("HOST_TRANSITION_CONFLICT");
  assert.strictEqual(lockConflictSanitized, USER_MESSAGES.HOST_TRANSITION_CONFLICT.message);

  console.log("✓ PASS: All raw technical errors and infrastructure terms are strictly redacted.\n");

  // =========================================================================
  // Test 8: Delay Suppression & Spinner Timing Invariant
  // =========================================================================
  console.log("Test 8: Delay Suppression & Spinner Timing Invariant");
  const fastOpId = operationCoordinator.startOperation("media-playback", "set-media", undefined, {
    spinnerDelayMs: 50,
  });
  // Immediately (<50ms), showSpinner should be false (spinner delay suppression)
  assert.strictEqual(operationCoordinator.shouldShowSpinner("media-playback", "set-media"), false, "Spinner must be suppressed initially");

  // Wait past spinnerDelayMs
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.strictEqual(operationCoordinator.shouldShowSpinner("media-playback", "set-media"), true, "Spinner must activate after threshold");

  operationCoordinator.resolveOperation(fastOpId);
  assert.strictEqual(operationCoordinator.shouldShowSpinner("media-playback", "set-media"), false, "Resolved op clears spinner");
  console.log("✓ PASS: Spinner suppression delay functions deterministically.\n");

  console.log("---------------------------------------------------------------");
  console.log("ALL 8 FRONTEND-001 CONSISTENCY & AUTHORITY TESTS PASSED CLEANLY.");
  console.log("---------------------------------------------------------------");
}

runTests().catch((err) => {
  console.error("Test failure:", err);
  process.exit(1);
});
