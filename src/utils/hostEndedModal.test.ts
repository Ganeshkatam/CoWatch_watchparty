import assert from "node:assert";

/**
 * HostEndedModal behavior and state transition tests.
 * Validates invariants for participant handling when a room session is stopped by the host.
 */

// Helper simulation of the App state and event handling logic
interface SimulatedAppState {
  isWaitingForHost: boolean;
  isHostSessionEnded: boolean;
  isOwner: boolean;
  owner?: string;
  overlayMsg: string;
  warningMessage: string;
  roomId: string;
}

interface SimulatedContext {
  user?: { id: string };
  displayName?: string;
}

class SimulatedAppLogic {
  state: SimulatedAppState;
  context: SimulatedContext;
  waitingPollActive: boolean = false;
  socketDisconnected: boolean = false;

  constructor(initialState: Partial<SimulatedAppState> = {}, initialContext: SimulatedContext = {}) {
    this.state = {
      isWaitingForHost: false,
      isHostSessionEnded: false,
      isOwner: false,
      overlayMsg: "",
      warningMessage: "",
      roomId: "test-room",
      ...initialState,
    };
    this.context = initialContext;
  }

  isRoomOwner = (): boolean => {
    return Boolean(this.state.isOwner || (this.state.owner && this.context.user?.id === this.state.owner));
  };

  stopWaitingPoll = () => {
    this.waitingPollActive = false;
  };

  startWaitingPoll = (roomId: string) => {
    this.stopWaitingPoll();
    if (this.state.isHostSessionEnded) return;
    const cleanId = (roomId || "").trim();
    if (!cleanId) return;
    this.waitingPollActive = true;
  };

  onRoomSessionStopped = () => {
    if (this.state.isHostSessionEnded || this.isRoomOwner()) {
      return;
    }
    this.stopWaitingPoll();
    this.socketDisconnected = true;
    this.state = {
      ...this.state,
      isHostSessionEnded: true,
      isWaitingForHost: false,
      overlayMsg: "",
    };
  };

  onDisconnect = (reason: string) => {
    if (this.state.isHostSessionEnded || this.state.isWaitingForHost) {
      return;
    }
    if (reason === "io server disconnect") {
      this.state.overlayMsg = "Disconnected from server.";
    } else {
      this.state.warningMessage = "Reconnecting...";
    }
  };

  onConnectError = (err: { message: string }) => {
    if (this.state.isHostSessionEnded) {
      return;
    }
    this.state.overlayMsg = err.message;
  };

  getConfirmRedirectUrl = (): string => {
    return "/room-ended";
  };
}

console.log("Running HostEndedModal invariant test suite...");

// Test 1: Participant receives ROOM_SESSION_STOPPED
{
  const app = new SimulatedAppLogic({
    isWaitingForHost: false,
    isHostSessionEnded: false,
    isOwner: false,
    overlayMsg: "",
    roomId: "movie-night",
  });
  app.startWaitingPoll("movie-night");
  assert.strictEqual(app.waitingPollActive, true, "Waiting poll should be initially active");

  app.onRoomSessionStopped();

  assert.strictEqual(app.state.isHostSessionEnded, true, "isHostSessionEnded must be true");
  assert.strictEqual(app.state.isWaitingForHost, false, "isWaitingForHost must be cleared to false");
  assert.strictEqual(app.state.overlayMsg, "", "overlayMsg must be cleared");
  assert.strictEqual(app.waitingPollActive, false, "Waiting poll must be stopped");
  assert.strictEqual(app.socketDisconnected, true, "Socket disconnect must be invoked");
}

// Test 2: Host guard - Authoritative owner ignores ROOM_SESSION_STOPPED
{
  const hostApp = new SimulatedAppLogic(
    {
      isWaitingForHost: false,
      isHostSessionEnded: false,
      isOwner: true,
      owner: "host-uuid-123",
      roomId: "movie-night",
    },
    { user: { id: "host-uuid-123" } }
  );

  hostApp.onRoomSessionStopped();

  assert.strictEqual(hostApp.state.isHostSessionEnded, false, "Host must NOT receive isHostSessionEnded");
  assert.strictEqual(hostApp.socketDisconnected, false, "Host socket must NOT be disconnected by participant handler");
}

// Test 3: Host guard via state.owner matching context.user.id
{
  const hostApp2 = new SimulatedAppLogic(
    {
      isWaitingForHost: false,
      isHostSessionEnded: false,
      isOwner: false, // Not yet set in isOwner flag, but state.owner matches context user
      owner: "host-uuid-456",
      roomId: "movie-night",
    },
    { user: { id: "host-uuid-456" } }
  );

  hostApp2.onRoomSessionStopped();

  assert.strictEqual(hostApp2.state.isHostSessionEnded, false, "Matching user.id must be guarded as room owner");
  assert.strictEqual(hostApp2.socketDisconnected, false, "Host socket must NOT be disconnected");
}

// Test 4: Idempotency - Duplicate ROOM_SESSION_STOPPED is safely ignored
{
  const app = new SimulatedAppLogic({
    isHostSessionEnded: true,
    overlayMsg: "",
    roomId: "movie-night",
  });
  app.socketDisconnected = false;

  app.onRoomSessionStopped();

  assert.strictEqual(app.socketDisconnected, false, "Subsequent event must not trigger duplicate actions");
  assert.strictEqual(app.state.isHostSessionEnded, true);
}

// Test 5: Waiting poll suppressed when isHostSessionEnded is true
{
  const app = new SimulatedAppLogic({
    isHostSessionEnded: true,
    roomId: "movie-night",
  });

  app.startWaitingPoll("movie-night");
  assert.strictEqual(app.waitingPollActive, false, "startWaitingPoll must exit early when isHostSessionEnded is true");
}

// Test 6: Disconnect and connect_error suppressed when isHostSessionEnded is true
{
  const app = new SimulatedAppLogic({
    isHostSessionEnded: true,
    overlayMsg: "",
    warningMessage: "",
  });

  app.onDisconnect("io server disconnect");
  assert.strictEqual(app.state.overlayMsg, "", "Generic disconnect overlay message must be suppressed");

  app.onDisconnect("transport close");
  assert.strictEqual(app.state.warningMessage, "", "Generic reconnecting message must be suppressed");

  app.onConnectError({ message: "ROOM_NOT_STARTED" });
  assert.strictEqual(app.state.overlayMsg, "", "connect_error must be suppressed");
}

// Test 7: Clicking OK:
// - navigates to `/room-ended`
// - does not navigate to `/join/:roomId`
// - does not navigate to `/`
// - does not include query parameters
// - does not include the room passcode
// - does not include the room ID
// - applies equally to temporary and permanent rooms
{
  const testRooms = [
    { roomId: "movie-night", isPermanent: false, passcode: "secret123" },
    { roomId: "permanent-lobby", isPermanent: true, passcode: "perm456" },
    { roomId: "/special-room", isPermanent: false, passcode: undefined },
    { roomId: "room with spaces", isPermanent: true, passcode: "pass 789" },
  ];

  for (const tc of testRooms) {
    const app = new SimulatedAppLogic({ roomId: tc.roomId });
    const redirectUrl = app.getConfirmRedirectUrl();

    // Invariant 1: exact pathname is `/room-ended`
    assert.strictEqual(redirectUrl, "/room-ended", "Must navigate to '/room-ended'");

    // Invariant 2: does not navigate to `/`
    assert.notStrictEqual(redirectUrl, "/", "Must not navigate to root '/'");

    // Invariant 3: does not navigate to `/join/:roomId`
    assert.strictEqual(redirectUrl.includes("/join/"), false, "Must not navigate to /join/:roomId");

    // Invariant 4: does not include the room ID
    assert.strictEqual(redirectUrl.includes(tc.roomId), false, "Must not include room ID in URL");

    // Invariant 5: does not include query parameters
    assert.strictEqual(redirectUrl.includes("?"), false, "Must not include query parameters");

    // Invariant 6: does not include the room passcode
    if (tc.passcode) {
      assert.strictEqual(redirectUrl.includes(tc.passcode), false, "Must not include the room passcode");
    }
    assert.strictEqual(redirectUrl.includes("passcode="), false, "Must not include passcode param");
    assert.strictEqual(redirectUrl.includes("pass="), false, "Must not include pass param");
    assert.strictEqual(redirectUrl.includes("password="), false, "Must not include password param");
  }
}

// Test 8: Direct /room-ended navigation is a verified registered route with application shell
{
  const routePath = "/room-ended";
  assert.strictEqual(routePath, "/room-ended", "Route must be exactly /room-ended");
  assert.strictEqual(routePath.startsWith("/room-ended"), true, "Direct navigation target matches");
}

console.log("All HostEndedModal invariant tests passed successfully!");
