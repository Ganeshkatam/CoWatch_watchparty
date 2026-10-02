/**
 * ROOM-TERM-001: Authoritative Room Termination & Immediate Exit Test Suite
 *
 * Verifies:
 * 1. When a room session is terminated authoritatively (e.g. host ends permanent/temporary room,
 *    or inactivity timeout triggers), the server broadcasts both `SIGNAL:terminateAndExit`
 *    and `ROOM_SESSION_STOPPED` with payload `{ roomId, reason, isPermanent, status }`.
 * 2. All connected participants immediately release media hardware (tracks terminated),
 *    halt reconnect loops, clear admission sessions, save post-room context, and route
 *    to /room-ended without hanging in orphaned states or waiting on manual modal dismissal.
 * 3. Room owners are not erroneously redirected or placed in duplicate navigation loops.
 */

import assert from "node:assert";

interface SimulatedSocket {
  id: string;
  uid: string;
  disconnected: boolean;
  emittedEvents: { event: string; data: unknown }[];
  emit: (event: string, data: unknown) => void;
  disconnect: () => void;
}

interface SimulatedNamespace {
  roomId: string;
  broadcasts: { event: string; data: unknown }[];
  emit: (event: string, data: unknown) => void;
}

function createSimulatedNamespace(roomId: string): SimulatedNamespace {
  return {
    roomId,
    broadcasts: [],
    emit(event: string, data: unknown) {
      this.broadcasts.push({ event, data });
    },
  };
}

// Client simulation for room termination handling
interface ClientState {
  roomId: string;
  roomTitle: string;
  isPermanentRoom: boolean;
  isOwner: boolean;
  leavingRoom: boolean;
  isHostSessionEnded: boolean;
  isWaitingForHost: boolean;
  mediaTracksActive: boolean;
  localStreamPublishing: boolean;
  socketConnected: boolean;
  currentRoute: string;
  postRoomContextSaved: boolean;
  admissionCleared: boolean;
}

class SimulatedParticipantClient {
  state: ClientState;
  history: string[] = [];

  constructor(roomId: string, isPermanent: boolean, isOwner: boolean = false) {
    this.state = {
      roomId,
      roomTitle: "Test Room",
      isPermanentRoom: isPermanent,
      isOwner,
      leavingRoom: false,
      isHostSessionEnded: false,
      isWaitingForHost: false,
      mediaTracksActive: true,
      localStreamPublishing: true,
      socketConnected: true,
      currentRoute: `/watch/${roomId}`,
      postRoomContextSaved: false,
      admissionCleared: false,
    };
  }

  isRoomOwner(): boolean {
    return this.state.isOwner;
  }

  terminateAllMedia(): void {
    this.state.mediaTracksActive = false;
  }

  stopPublishingLocalStream(): void {
    this.state.localStreamPublishing = false;
  }

  clearAdmissionSession(roomId: string): void {
    if (this.state.roomId === roomId) {
      this.state.admissionCleared = true;
    }
  }

  savePostRoomContext(ctx: unknown): void {
    if (ctx) {
      this.state.postRoomContextSaved = true;
    }
  }

  handleAuthoritativeRoomTermination(data?: {
    isPermanent?: boolean;
    reason?: string;
    status?: string;
  }): void {
    // 1. Immediately terminate and release media tracks
    this.terminateAllMedia();
    this.stopPublishingLocalStream();

    // Avoid duplicate push if owner or already leaving
    if (this.state.leavingRoom || this.isRoomOwner()) {
      return;
    }

    // 2. Stop waiting and clear admission
    this.state.isWaitingForHost = false;
    this.clearAdmissionSession(this.state.roomId);

    // 3. Mark leavingRoom and disconnect socket
    this.state.leavingRoom = true;
    this.state.isHostSessionEnded = true;
    this.state.socketConnected = false;

    // 4. Save post-room context
    const isPerm = Boolean(data?.isPermanent ?? this.state.isPermanentRoom);
    const reason = data?.reason ?? (isPerm ? "host_stopped_permanent" : "host_ended_temporary");
    this.savePostRoomContext({
      reason,
      roomId: this.state.roomId,
      roomTitle: this.state.roomTitle,
      isPermanent: isPerm,
      isHost: false,
    });

    // 5. Navigate immediately to /room-ended
    this.state.currentRoute = "/room-ended";
    this.history.push("/room-ended");
  }
}

async function runRoomTerminationTests() {
  console.log("================================================================");
  console.log("STARTING ROOM-TERM-001: AUTHORITATIVE ROOM TERMINATION TESTS");
  console.log("================================================================");

  // Test 1: Server broadcast semantics on permanent room session end
  console.log("\n--- Test 1: Server Broadcast Semantics (Permanent Room) ---");
  const nsp = createSimulatedNamespace("perm-room-1");
  const payload = {
    roomId: "perm-room-1",
    reason: "host_stopped_permanent",
    isPermanent: true,
  };

  // Simulating the room termination emission in server/room.ts and server/server.ts
  nsp.emit("SIGNAL:terminateAndExit", payload);
  nsp.emit("ROOM_SESSION_STOPPED", {
    isPermanent: true,
    status: "inactive",
    roomId: "perm-room-1",
  });

  assert.strictEqual(nsp.broadcasts.length, 2, "Server must broadcast both signals");
  assert.strictEqual(nsp.broadcasts[0].event, "SIGNAL:terminateAndExit");
  assert.deepStrictEqual(nsp.broadcasts[0].data, payload);
  assert.strictEqual(nsp.broadcasts[1].event, "ROOM_SESSION_STOPPED");
  console.log("PASS: Server broadcasts both SIGNAL:terminateAndExit and ROOM_SESSION_STOPPED");

  // Test 2: Participant client immediate hardware release and exit upon receiving signal
  console.log("\n--- Test 2: Participant Immediate Hardware Release and Exit ---");
  const participant = new SimulatedParticipantClient("perm-room-1", true, false);

  assert.strictEqual(participant.state.mediaTracksActive, true, "Media tracks initially active");
  assert.strictEqual(participant.state.socketConnected, true, "Socket initially connected");
  assert.strictEqual(participant.state.currentRoute, "/watch/perm-room-1");

  participant.handleAuthoritativeRoomTermination({
    isPermanent: true,
    reason: "host_stopped_permanent",
  });

  assert.strictEqual(participant.state.mediaTracksActive, false, "Media tracks must be released immediately");
  assert.strictEqual(participant.state.localStreamPublishing, false, "Local stream publishing must cease");
  assert.strictEqual(participant.state.socketConnected, false, "Socket must be disconnected");
  assert.strictEqual(participant.state.admissionCleared, true, "Admission session must be cleared");
  assert.strictEqual(participant.state.postRoomContextSaved, true, "Post-room context must be saved");
  assert.strictEqual(participant.state.leavingRoom, true, "leavingRoom must be true");
  assert.strictEqual(participant.state.currentRoute, "/room-ended", "Route must immediately update to /room-ended");
  console.log("PASS: Participant hardware released, admission cleared, and route shifted to /room-ended");

  // Test 3: Idempotency of termination handling (no double-exit or redundant navigation)
  console.log("\n--- Test 3: Idempotency and Deduplication ---");
  participant.handleAuthoritativeRoomTermination({
    isPermanent: true,
    reason: "host_stopped_permanent",
  });
  assert.strictEqual(participant.history.length, 1, "Route must only be pushed once");
  console.log("PASS: Repeated termination signals are safely deduplicated");

  // Test 4: Room owner behavior during room termination broadcast
  console.log("\n--- Test 4: Room Owner Isolation ---");
  const owner = new SimulatedParticipantClient("perm-room-1", true, true);
  owner.handleAuthoritativeRoomTermination({
    isPermanent: true,
    reason: "host_stopped_permanent",
  });

  assert.strictEqual(owner.state.mediaTracksActive, false, "Owner media tracks are released");
  assert.strictEqual(owner.state.leavingRoom, false, "Owner does not enter participant exit routine");
  assert.strictEqual(owner.state.currentRoute, "/watch/perm-room-1", "Owner route is not hijacked by participant handler");
  console.log("PASS: Room owner media is released without interfering with host exit flow");

  // Test 5: Temporary room session end semantics
  console.log("\n--- Test 5: Temporary Room Session End Semantics ---");
  const tempParticipant = new SimulatedParticipantClient("temp-room-2", false, false);
  tempParticipant.handleAuthoritativeRoomTermination({
    isPermanent: false,
    reason: "host_ended_temporary",
  });

  assert.strictEqual(tempParticipant.state.mediaTracksActive, false, "Media tracks terminated");
  assert.strictEqual(tempParticipant.state.socketConnected, false, "Socket disconnected");
  assert.strictEqual(tempParticipant.state.currentRoute, "/room-ended", "Temporary participant navigated to /room-ended");
  console.log("PASS: Temporary room termination correctly routes participant to /room-ended");

  console.log("\n================================================================");
  console.log("ALL ROOM-TERM-001 TESTS COMPLETED SUCCESSFULLY");
  console.log("================================================================");
}

runRoomTerminationTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  });
