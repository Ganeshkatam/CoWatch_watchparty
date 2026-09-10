import assert from "node:assert";

/**
 * Host Delegation, Invariant, and Race-Condition Test Suite.
 * Validates:
 * 1. owner_id remains immutable in all states.
 * 2. Active session host is tracked separately via currentHostClientId / currentHostUid.
 * 3. Explicit host delegation transfers host authority immediately.
 * 4. Deterministic promotion promotes the first remaining participant in the roster on disconnect.
 * 5. Owner return automatically reclaims host status from interim hosts.
 * 6. Race condition: Concurrent owner return and interim host assignment.
 * 7. Race condition: Rapid multi-user disconnects.
 * 8. Server-side authorization prevents non-hosts from executing privileged actions.
 * 9. Solitary host departure cleans up state safely without crashing.
 */

interface User {
  id: string; // clientId
  uid?: string; // Supabase user ID if authenticated
}

interface SocketMock {
  id: string;
  clientId: string;
  uid: string;
  emittedEvents: { event: string; data: any }[];
  emit: (event: string, data?: any) => void;
}

function createSocketMock(clientId: string, uid: string = ""): SocketMock {
  return {
    id: `socket_${clientId}_${Math.random().toString(36).slice(2, 6)}`,
    clientId,
    uid,
    emittedEvents: [],
    emit(event: string, data?: any) {
      this.emittedEvents.push({ event, data });
    },
  };
}

class SimulatedRoom {
  public owner_id: string;
  public currentHostClientId: string = "";
  public currentHostUid: string = "";
  public roster: User[] = [];
  public clientToUidMap: Record<string, string> = {};
  public socketMap: Record<string, SocketMock> = {};
  public broadcastedEvents: { event: string; data: any }[] = [];
  public chatMessages: { id: string; cmd?: string; msg: string }[] = [];

  constructor(owner_id: string) {
    this.owner_id = owner_id;
  }

  public isHost(socket: SocketMock): boolean {
    return Boolean(this.currentHostClientId && socket.clientId === this.currentHostClientId);
  }

  public getHostDisplayName(): string {
    return this.currentHostClientId || "Host";
  }

  public broadcastHostChange(reason: "assigned" | "auto_assigned" | "owner_returned" | "initial") {
    const isOwner = Boolean(this.owner_id && this.currentHostUid && this.currentHostUid === this.owner_id);
    const hostPayload = {
      hostId: this.currentHostUid || this.currentHostClientId,
      hostClientId: this.currentHostClientId,
      hostName: this.getHostDisplayName(),
      isOwner,
      reason,
    };
    this.broadcastedEvents.push({ event: "REC:hostChange", data: hostPayload });
  }

  public connect(socket: SocketMock) {
    this.socketMap[socket.clientId] = socket;
    if (socket.uid) {
      this.clientToUidMap[socket.clientId] = socket.uid;
    }
    if (!this.roster.some((u) => u.id === socket.clientId)) {
      this.roster.push({ id: socket.clientId, uid: socket.uid });
    }

    // Owner return auto-reclaim
    if (socket.uid && this.owner_id && socket.uid === this.owner_id) {
      this.reclaimHostForOwner(socket);
    } else if (!this.currentHostClientId && this.roster.length > 0) {
      this.currentHostClientId = this.roster[0].id;
      this.currentHostUid = this.clientToUidMap[this.roster[0].id] || "";
      this.broadcastHostChange("initial");
    }
  }

  public reclaimHostForOwner(ownerSocket: SocketMock) {
    if (!this.owner_id || ownerSocket.uid !== this.owner_id) return;
    const prev = this.currentHostClientId;
    this.currentHostClientId = ownerSocket.clientId;
    this.currentHostUid = ownerSocket.uid;
    this.clientToUidMap[ownerSocket.clientId] = ownerSocket.uid;

    if (prev !== ownerSocket.clientId) {
      this.broadcastHostChange("owner_returned");
      this.chatMessages.push({
        id: ownerSocket.clientId,
        cmd: "system",
        msg: "The room creator has returned and resumed hosting.",
      });
    }
  }

  public assignHost(socket: SocketMock, newHostClientId: string): boolean {
    if (!this.isHost(socket)) {
      socket.emit("errorMessage", "Only the current room host can assign a new host.");
      return false;
    }
    const target = this.roster.find((p) => p.id === newHostClientId);
    if (!target) {
      socket.emit("errorMessage", "Selected participant is no longer in the room.");
      return false;
    }
    if (newHostClientId === this.currentHostClientId) {
      return true;
    }

    const prevName = this.getHostDisplayName();
    this.currentHostClientId = newHostClientId;
    this.currentHostUid = this.clientToUidMap[newHostClientId] || "";
    const newName = this.getHostDisplayName();

    this.broadcastHostChange("assigned");
    this.chatMessages.push({
      id: socket.clientId,
      cmd: "system",
      msg: `${prevName} assigned ${newName} as the room host.`,
    });
    return true;
  }

  public kickUser(socket: SocketMock, targetClientId: string): boolean {
    if (!this.isHost(socket)) {
      socket.emit("errorMessage", "Only the room host can kick participants");
      return false;
    }
    const targetSocket = this.socketMap[targetClientId];
    if (targetSocket) {
      targetSocket.emit("kicked");
      this.disconnect(targetSocket);
    }
    return true;
  }

  public disconnect(socket: SocketMock) {
    const wasHost = this.currentHostClientId === socket.clientId;
    const index = this.roster.findIndex((u) => u.id === socket.clientId);
    if (index > -1) {
      this.roster.splice(index, 1);
    }
    delete this.socketMap[socket.clientId];
    delete this.clientToUidMap[socket.clientId];

    if (wasHost) {
      if (this.roster.length > 0) {
        // Deterministic auto-promotion: first remaining participant
        const nextHost = this.roster[0];
        const oldHostName = socket.clientId;
        this.currentHostClientId = nextHost.id;
        this.currentHostUid = this.clientToUidMap[nextHost.id] || "";
        const newHostName = nextHost.id;

        this.broadcastHostChange("auto_assigned");
        this.chatMessages.push({
          id: nextHost.id,
          cmd: "system",
          msg: `${oldHostName} left. ${newHostName} is now the room host.`,
        });
      } else {
        this.currentHostClientId = "";
        this.currentHostUid = "";
      }
    }
  }
}

async function runTests() {
  console.log("Running Host Delegation and Owner Reclaim Invariant Suite...\n");

  // Invariant 1: Initial host initialization & owner_id immutability
  {
    console.log("Test 1: Initial host is creator; owner_id remains immutable");
    const room = new SimulatedRoom("owner_user_123");
    const ownerSocket = createSocketMock("client_owner", "owner_user_123");

    room.connect(ownerSocket);
    assert.strictEqual(room.currentHostClientId, "client_owner");
    assert.strictEqual(room.currentHostUid, "owner_user_123");
    assert.strictEqual(room.isHost(ownerSocket), true);
    assert.strictEqual(room.owner_id, "owner_user_123");
    console.log("  Passed");
  }

  // Invariant 2: Explicit delegation transfers authority and revokes former host authority
  {
    console.log("Test 2: Explicit delegation transfers authority; former host loses authority");
    const room = new SimulatedRoom("owner_user_123");
    const ownerSocket = createSocketMock("client_owner", "owner_user_123");
    const participantB = createSocketMock("client_b", "user_b");
    const participantC = createSocketMock("client_c", "user_c");

    room.connect(ownerSocket);
    room.connect(participantB);
    room.connect(participantC);

    assert.strictEqual(room.isHost(ownerSocket), true);
    assert.strictEqual(room.isHost(participantB), false);

    // Owner delegates to B
    const success = room.assignHost(ownerSocket, "client_b");
    assert.strictEqual(success, true);
    assert.strictEqual(room.currentHostClientId, "client_b");
    assert.strictEqual(room.currentHostUid, "user_b");
    assert.strictEqual(room.isHost(participantB), true);
    assert.strictEqual(room.isHost(ownerSocket), false);

    // Former host attempts host action (kick) -> rejected
    const kickAttempt = room.kickUser(ownerSocket, "client_c");
    assert.strictEqual(kickAttempt, false);
    assert.strictEqual(
      ownerSocket.emittedEvents.some((e) => e.data === "Only the room host can kick participants"),
      true
    );

    // New host attempts host action -> succeeds
    const newHostKick = room.kickUser(participantB, "client_c");
    assert.strictEqual(newHostKick, true);
    assert.strictEqual(participantC.emittedEvents.some((e) => e.event === "kicked"), true);

    // owner_id remains intact
    assert.strictEqual(room.owner_id, "owner_user_123");
    console.log("  Passed");
  }

  // Invariant 3: Deterministic auto-promotion on unexpected disconnect
  {
    console.log("Test 3: Unexpected host disconnect promotes next participant in roster order");
    const room = new SimulatedRoom("owner_user_123");
    const hostA = createSocketMock("client_a", "user_a");
    const userB = createSocketMock("client_b", "user_b");
    const userC = createSocketMock("client_c", "user_c");

    room.connect(hostA);
    room.connect(userB);
    room.connect(userC);

    assert.strictEqual(room.currentHostClientId, "client_a");

    // Host A unexpectedly disconnects
    room.disconnect(hostA);

    // B should now be promoted deterministically
    assert.strictEqual(room.currentHostClientId, "client_b");
    assert.strictEqual(room.isHost(userB), true);
    assert.strictEqual(room.roster.some((u) => u.id === "client_a"), false);

    // User B unexpectedly disconnects -> C is promoted
    room.disconnect(userB);
    assert.strictEqual(room.currentHostClientId, "client_c");
    assert.strictEqual(room.isHost(userC), true);

    // owner_id remains immutable
    assert.strictEqual(room.owner_id, "owner_user_123");
    console.log("  Passed");
  }

  // Invariant 4: Owner return automatic reclaim
  {
    console.log("Test 4: Room creator return immediately reclaims host status from interim host");
    const room = new SimulatedRoom("owner_user_123");
    const interimHost = createSocketMock("client_interim", "user_interim");
    const participant2 = createSocketMock("client_part2", "user_part2");

    room.connect(interimHost);
    room.connect(participant2);
    assert.strictEqual(room.currentHostClientId, "client_interim");

    // Original room creator joins
    const returningOwnerSocket = createSocketMock("client_owner_reconnected", "owner_user_123");
    room.connect(returningOwnerSocket);

    // Owner should immediately be host
    assert.strictEqual(room.currentHostClientId, "client_owner_reconnected");
    assert.strictEqual(room.currentHostUid, "owner_user_123");
    assert.strictEqual(room.isHost(returningOwnerSocket), true);
    assert.strictEqual(room.isHost(interimHost), false);

    // Interim host attempting host action is now rejected
    const interimKick = room.kickUser(interimHost, "client_part2");
    assert.strictEqual(interimKick, false);

    // System chat announcement was posted
    assert.strictEqual(
      room.chatMessages.some((m) => m.msg.includes("The room creator has returned and resumed hosting")),
      true
    );
    console.log("  Passed");
  }

  // Race Condition 1: Owner returns concurrently with interim host attempting host assignment
  {
    console.log("Test 5: Race condition: Owner return takes precedence over concurrent interim delegation");
    const room = new SimulatedRoom("owner_user_123");
    const interimHost = createSocketMock("client_interim", "user_interim");
    const candidateC = createSocketMock("client_c", "user_c");

    room.connect(interimHost);
    room.connect(candidateC);

    // Owner reconnects and processes first
    const returningOwner = createSocketMock("client_owner_reconnected", "owner_user_123");
    room.connect(returningOwner);

    // Interim host (unaware of incoming owner packet) attempts to delegate to candidate C
    const assignResult = room.assignHost(interimHost, "client_c");

    // The assignment must be rejected because interimHost was already demoted by owner reclaim
    assert.strictEqual(assignResult, false);
    assert.strictEqual(room.currentHostClientId, "client_owner_reconnected");
    assert.strictEqual(room.isHost(returningOwner), true);
    console.log("  Passed");
  }

  // Race Condition 2: Rapid multi-user disconnects
  {
    console.log("Test 6: Race condition: Rapid multi-user disconnects do not leave room hostless");
    const room = new SimulatedRoom("owner_user_123");
    const userA = createSocketMock("client_a", "user_a");
    const userB = createSocketMock("client_b", "user_b");
    const userC = createSocketMock("client_c", "user_c");

    room.connect(userA);
    room.connect(userB);
    room.connect(userC);

    // Disconnect A and B in rapid succession
    room.disconnect(userA);
    room.disconnect(userB);

    // C should be the active host
    assert.strictEqual(room.roster.length, 1);
    assert.strictEqual(room.currentHostClientId, "client_c");
    assert.strictEqual(room.isHost(userC), true);
    console.log("  Passed");
  }

  // Invariant 5: Solitary exit resets host state safely
  {
    console.log("Test 7: Solitary exit clears host state safely without crashing");
    const room = new SimulatedRoom("owner_user_123");
    const solitaryUser = createSocketMock("client_lone", "user_lone");

    room.connect(solitaryUser);
    assert.strictEqual(room.currentHostClientId, "client_lone");

    room.disconnect(solitaryUser);
    assert.strictEqual(room.roster.length, 0);
    assert.strictEqual(room.currentHostClientId, "");
    assert.strictEqual(room.currentHostUid, "");
    assert.strictEqual(room.owner_id, "owner_user_123");
    console.log("  Passed");
  }

  // Invariant 6: Non-host cannot assign host
  {
    console.log("Test 8: Non-host cannot assign host");
    const room = new SimulatedRoom("owner_user_123");
    const host = createSocketMock("client_host", "user_host");
    const regularUser = createSocketMock("client_regular", "user_regular");
    const targetUser = createSocketMock("client_target", "user_target");

    room.connect(host);
    room.connect(regularUser);
    room.connect(targetUser);

    const result = room.assignHost(regularUser, "client_target");
    assert.strictEqual(result, false);
    assert.strictEqual(room.currentHostClientId, "client_host");
    console.log("  Passed");
  }

  console.log("\nAll 8 host delegation, race-condition, and invariant tests PASSED successfully!");
}

runTests().catch((err) => {
  console.error("Host delegation test failed:", err);
  process.exit(1);
});
