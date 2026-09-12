import assert from "node:assert/strict";
import { ClientVBrowserCoordinator } from "./vbrowserCoordinator";
import { operationCoordinator } from "./operationState";

async function runClientControlTests() {
  console.log("Starting Client VBrowser Coordinator Tests...");

  // Test 1: Initial state is DISCONNECTED
  {
    const coordinator = new ClientVBrowserCoordinator();
    const state = coordinator.getState();
    assert.equal(state.status, "DISCONNECTED");
    assert.equal(state.roomId, null);
    console.log("Client Test 1 Passed: Initial state is DISCONNECTED.");
  }

  // Test 2: Allocate sets state to REQUESTING and registers operation
  {
    const coordinator = new ClientVBrowserCoordinator();
    let sentCmd = "";
    let sentPayload: any = null;

    const opId = coordinator.allocate("room_123", (cmd, payload) => {
      sentCmd = cmd;
      sentPayload = payload;
    });

    assert.equal(sentCmd, "CMD:vbrowserAllocate");
    assert.equal(sentPayload.roomId, "room_123");
    assert.equal(sentPayload.operationId, opId);
    assert.equal(coordinator.getState().status, "REQUESTING");
    assert.equal(coordinator.getState().roomId, "room_123");
    console.log("Client Test 2 Passed: Allocate transitions state to REQUESTING and dispatches command.");
  }

  // Test 3: Stale epoch server state is dropped
  {
    const coordinator = new ClientVBrowserCoordinator();
    const currentEpoch = operationCoordinator.beginConnectionEpoch(); // Advance epoch

    coordinator.handleServerState({
      roomId: "room_123",
      status: "ASSIGNED",
      epoch: currentEpoch - 1, // Stale epoch N-1
    });

    assert.equal(coordinator.getState().status, "DISCONNECTED");
    console.log("Client Test 3 Passed: Stale epoch server updates (N-1) are discarded.");
  }

  // Test 4: Current epoch ASSIGNED state updates client
  {
    const coordinator = new ClientVBrowserCoordinator();
    const currentEpoch = operationCoordinator.getConnectionEpoch();

    coordinator.handleServerState(
      {
        roomId: "room_123",
        reservationId: "res_456",
        status: "ASSIGNED",
        controllerId: "user_me",
        streamMetadata: { url: "https://vbrowser.test/stream" },
        epoch: currentEpoch,
      },
      "user_me"
    );

    const state = coordinator.getState();
    assert.equal(state.status, "ASSIGNED");
    assert.equal(state.reservationId, "res_456");
    assert.equal(state.streamUrl, "https://vbrowser.test/stream");
    assert.equal(state.isController, true);
    console.log("Client Test 4 Passed: Authoritative ASSIGNED snapshot reconciles state and controller status.");
  }

  // Test 5: Release transitions state to RELEASING and dispatches command
  {
    const coordinator = new ClientVBrowserCoordinator();
    let sentCmd = "";
    let sentPayload: any = null;

    const opId = coordinator.release("room_123", "res_456", (cmd, payload) => {
      sentCmd = cmd;
      sentPayload = payload;
    });

    assert.equal(sentCmd, "CMD:vbrowserRelease");
    assert.equal(sentPayload.roomId, "room_123");
    assert.equal(sentPayload.reservationId, "res_456");
    assert.equal(coordinator.getState().status, "RELEASING");
    console.log("Client Test 5 Passed: Release transitions state to RELEASING.");
  }

  // Test 6: Disconnect cleans in-flight state
  {
    const coordinator = new ClientVBrowserCoordinator();
    coordinator.allocate("room_123", () => {});
    assert.equal(coordinator.getState().status, "REQUESTING");

    coordinator.handleDisconnect();
    assert.equal(coordinator.getState().status, "DISCONNECTED");
    console.log("Client Test 6 Passed: Disconnect safely clears in-flight state.");
  }

  console.log("ALL Client VBrowser Coordinator Tests Passed Successfully!");
  process.exit(0);
}

runClientControlTests().catch((err) => {
  console.error("Client VBrowser test failed:", err);
  process.exit(1);
});
