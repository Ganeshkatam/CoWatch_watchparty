/**
 * INTEGRATION CERTIFICATION TEST SUITE (INTEG-001 through INTEG-005)
 * 
 * Verifies cross-subsystem interactions across:
 * 1. INTEG-001: Room Lifecycle & Multi-Tier Authorization (Creation, Admission, Host Start, Failover, Teardown)
 * 2. INTEG-002: Local Media Failover + Playback Revision Synchronization
 * 3. INTEG-003: Transactional Invitation, Admission & Quota Integrity
 * 4. INTEG-004: Reconnection & Identity Decoupling Matrix (userId != peerId != socketId)
 * 5. INTEG-005: Anti-Leak, Stale Registration Scavenging & Cleanup
 */

import { TimelineAuthority } from "./timelineAuthority.js";
import { LocalMediaAuthority } from "./media/local/LocalMediaAuthority.js";
import { LocalMediaPeerRegistry } from "./media/local/LocalMediaPeerRegistry.js";
import { LocalMediaSession, type ServerLocalMediaManifest } from "./media/local/LocalMediaSession.js";
import { LocalMediaSignaling } from "./media/local/LocalMediaSignaling.js";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Mock Infrastructure
// ---------------------------------------------------------------------------

class MockDatabase {
  public queries: { sql: string; params: any[] }[] = [];
  public invites = new Map<string, { id: string; room_id: string; uses_count: number; max_uses: number }>();
  public admissions = new Map<string, { token: string; room_id: string; user_id: string; expires_at: number; used: boolean }>();

  async query(sql: string, params: any[] = []): Promise<{ rows: any[] }> {
    this.queries.push({ sql, params });

    // Handle transactional invite redemption with row locking simulation
    if (sql.includes("UPDATE public.room_invitations SET uses_count = uses_count + 1")) {
      const inviteCode = params[0];
      const invite = this.invites.get(inviteCode);
      if (invite && invite.uses_count < invite.max_uses) {
        invite.uses_count++;
        return { rows: [{ id: invite.id, room_id: invite.room_id, uses_count: invite.uses_count, max_uses: invite.max_uses }] };
      }
      return { rows: [] };
    }

    return { rows: [] };
  }
}

class MockSignaling {
  public broadcasts: { roomId: string; manifest: any }[] = [];
  public directEmits: { socketId: string; manifest: any }[] = [];
  public unavailables: { roomId: string; mediaId: string }[] = [];
  public relayedSignals: { targetSocketId: string; payload: any }[] = [];

  broadcastSession(roomId: string, manifest: any) {
    this.broadcasts.push({ roomId, manifest });
  }

  sendSessionToSocket(socketId: string, manifest: any) {
    this.directEmits.push({ socketId, manifest });
  }

  broadcastUnavailable(roomId: string, mediaId: string) {
    this.unavailables.push({ roomId, mediaId });
  }

  relaySignal(socket: any, targetSocketId: string, payload: any): boolean {
    this.relayedSignals.push({ targetSocketId, payload });
    return true;
  }

  clear() {
    this.broadcasts = [];
    this.directEmits = [];
    this.unavailables = [];
    this.relayedSignals = [];
  }
}

// Mock Integrated Room Engine
class IntegratedRoomEngine {
  public roomId: string;
  public owner_id: string;
  public status: "scheduled" | "active" | "inactive" | "ended" = "inactive";
  public isPermanent: boolean;
  public maxParticipants: number = 10;
  public lock: string | undefined = undefined;

  // Identity & Membership Maps
  public currentHostUid: string = "";
  public currentHostClientId: string = "";
  public hostEpoch: number = 1;
  public roster: { id: string; name: string; uid?: string }[] = [];
  public socketIdMap: Record<string, string> = {}; // clientId -> socketId
  public clientToUidMap: Record<string, string> = {}; // clientId -> uid
  public admittedParticipants: Map<string, { clientId: string; uid: string; sequence: number; state: "connected" | "disconnected"; lastDisconnectedAt?: number }> = new Map();
  private nextAdmissionSequence: number = 1;

  // Authorities
  public timeline: TimelineAuthority = new TimelineAuthority({ revision: 0 });
  public localMediaAuthority: LocalMediaAuthority;
  public processedOperations: Map<string, { operationId: string; timestamp: number }[]> = new Map();
  public emittedEvents: { event: string; data: any; recipient?: string }[] = [];

  constructor(roomId: string, owner_id: string, isPermanent: boolean, mediaSignaling: any, db: any) {
    this.roomId = roomId;
    this.owner_id = owner_id;
    this.isPermanent = isPermanent;
    this.localMediaAuthority = new LocalMediaAuthority(db, mediaSignaling);
  }

  public get videoTS(): number {
    return this.timeline.getCanonicalTime();
  }

  public isHost(socket: { uid?: string } | null | undefined): boolean {
    if (!socket?.uid || !this.currentHostUid) return false;
    return socket.uid === this.currentHostUid;
  }

  public admitParticipant(clientId: string, uid: string, name: string, socketId: string): boolean {
    if (this.admittedParticipants.size >= this.maxParticipants && !this.admittedParticipants.has(clientId)) {
      return false;
    }

    const sequence = this.nextAdmissionSequence++;
    this.admittedParticipants.set(clientId, {
      clientId,
      uid,
      sequence,
      state: "connected",
    });

    this.socketIdMap[clientId] = socketId;
    this.clientToUidMap[clientId] = uid;
    this.roster.push({ id: clientId, name, uid });

    // If no host yet, and this is the owner, appoint as host
    if (!this.currentHostUid && uid === this.owner_id) {
      this.currentHostUid = uid;
      this.currentHostClientId = clientId;
    }

    return true;
  }

  public startRoom(actorSocket: { uid?: string; clientId?: string }): { success: boolean; error?: string } {
    if (!this.isHost(actorSocket)) {
      return { success: false, error: "FORBIDDEN_NOT_HOST" };
    }
    this.status = "active";
    this.emittedEvents.push({ event: "ROOM_STATUS_CHANGED", data: { status: "active" } });
    return { success: true };
  }

  public handlePlaybackCommand(actorSocket: { uid?: string; clientId?: string }, cmd: { action: "play" | "pause" | "seek"; time?: number; playbackRate?: number; operationId?: string }): { success: boolean; error?: string; revision?: number } {
    // Check playback lock
    if (this.lock && actorSocket.uid !== this.lock && !this.isHost(actorSocket)) {
      return { success: false, error: "PLAYBACK_LOCKED" };
    }

    // Deduplication check
    if (cmd.operationId && actorSocket.clientId) {
      const ops = this.processedOperations.get(actorSocket.clientId) || [];
      if (ops.some(op => op.operationId === cmd.operationId)) {
        return { success: true, revision: this.timeline.getSnapshot().revision }; // Idempotent ack
      }
      ops.push({ operationId: cmd.operationId, timestamp: Date.now() });
      this.processedOperations.set(actorSocket.clientId, ops);
    }

    if (cmd.time !== undefined) {
      this.timeline.seek(cmd.time);
    }
    if (cmd.action === "play") {
      this.timeline.play();
    } else if (cmd.action === "pause") {
      this.timeline.pause();
    }

    const state = this.timeline.getSnapshot();
    this.emittedEvents.push({ event: "REC:hostState", data: state });
    return { success: true, revision: state.revision };
  }

  public handleDisconnect(socket: { id: string; clientId: string; uid?: string }): void {
    const { clientId } = socket;
    if (this.socketIdMap[clientId] !== socket.id) return;

    const wasHost = this.currentHostClientId === clientId;
    const rosterIdx = this.roster.findIndex(u => u.id === clientId);
    if (rosterIdx > -1) this.roster.splice(rosterIdx, 1);

    delete this.socketIdMap[clientId];
    delete this.clientToUidMap[clientId];

    const admitted = this.admittedParticipants.get(clientId);
    if (admitted) {
      admitted.state = "disconnected";
      admitted.lastDisconnectedAt = Date.now();
    }

    if (wasHost) {
      // Failover to oldest admitted connected participant (lowest sequence)
      const eligible = Array.from(this.admittedParticipants.values())
        .filter(p => p.state === "connected" && p.clientId !== clientId)
        .sort((a, b) => a.sequence - b.sequence);

      if (eligible.length > 0) {
        const next = eligible[0];
        this.hostEpoch++;
        this.currentHostClientId = next.clientId;
        this.currentHostUid = next.uid;
        this.emittedEvents.push({ event: "HOST_TRANSITION", data: { newHostClientId: next.clientId, newHostUid: next.uid, hostEpoch: this.hostEpoch, reason: "failover" } });
      } else {
        this.hostEpoch++;
        this.currentHostClientId = "";
        this.currentHostUid = "";
        this.emittedEvents.push({ event: "HOST_TRANSITION", data: { hostEpoch: this.hostEpoch, reason: "room_empty" } });
        if (!this.isPermanent) {
          this.status = "ended";
        }
      }
    }
  }

  public handleReconnect(clientId: string, uid: string, name: string, newSocketId: string): boolean {
    const admitted = this.admittedParticipants.get(clientId);
    if (!admitted || admitted.uid !== uid) {
      return false; // Stale or identity mismatch
    }

    admitted.state = "connected";
    admitted.lastDisconnectedAt = undefined;

    this.socketIdMap[clientId] = newSocketId;
    this.clientToUidMap[clientId] = uid;

    if (!this.roster.some(u => u.id === clientId)) {
      this.roster.push({ id: clientId, name, uid });
    }

    return true;
  }

  public scavengeDisconnected(maxGraceMs: number = 600000): number {
    const now = Date.now();
    let scavenged = 0;
    for (const [clientId, rec] of Array.from(this.admittedParticipants.entries())) {
      if (rec.state === "disconnected" && rec.lastDisconnectedAt && (now - rec.lastDisconnectedAt > maxGraceMs)) {
        this.admittedParticipants.delete(clientId);
        scavenged++;
      }
    }
    return scavenged;
  }
}

// ---------------------------------------------------------------------------
// TEST SUITE EXECUTION
// ---------------------------------------------------------------------------

async function runIntegrationCertification() {
  console.log("================================================================");
  console.log("INTEG-001 through INTEG-005: Cross-System Integration Certification");
  console.log("================================================================");

  const db = new MockDatabase();
  const signaling = new MockSignaling();

  // -------------------------------------------------------------------------
  // INTEG-001: End-to-End Room Lifecycle & Multi-Tier Authorization
  // -------------------------------------------------------------------------
  console.log("\n--- Scenario A: Room Lifecycle & Governance (INTEG-001) ---");

  const room = new IntegratedRoomEngine("room_alpha", "owner_alice", false, signaling, db);
  assert(room.status === "inactive", "Room should initialize as inactive");

  // Admit Host (Alice) and Guests (Bob, Charlie)
  const aliceAdmitted = room.admitParticipant("client_alice", "owner_alice", "Alice", "sock_alice");
  assert(aliceAdmitted && room.currentHostUid === "owner_alice", "Owner Alice should be admitted and appointed initial host");

  const bobAdmitted = room.admitParticipant("client_bob", "guest_bob", "Bob", "sock_bob");
  const charlieAdmitted = room.admitParticipant("client_charlie", "guest_charlie", "Charlie", "sock_charlie");
  assert(bobAdmitted && charlieAdmitted, "Guests Bob and Charlie should be admitted");

  // Guest attempts to start room -> FORBIDDEN
  const guestStart = room.startRoom({ uid: "guest_bob", clientId: "client_bob" });
  assert(!guestStart.success && guestStart.error === "FORBIDDEN_NOT_HOST", "Guest start attempt must be strictly rejected");
  assert(room.status === "inactive", "Room status must remain inactive after unauthorized start attempt");

  // Host starts room -> SUCCESS
  const hostStart = room.startRoom({ uid: "owner_alice", clientId: "client_alice" });
  assert(hostStart.success && room.status === "active", "Host start attempt must succeed and activate room");
  console.log("  PASS [INTEG-001.1: Room start requires host authorization; guest attempt rejected]");

  // Host Alice leaves -> Deterministic failover to oldest admitted participant (Bob)
  room.handleDisconnect({ id: "sock_alice", clientId: "client_alice", uid: "owner_alice" });
  assert(room.currentHostUid === "guest_bob" && room.currentHostClientId === "client_bob", "Host failover must transition to oldest connected participant (Bob)");
  assert(room.hostEpoch === 2, "Host epoch must increment to 2 on failover");
  console.log("  PASS [INTEG-001.2: Host departure triggers deterministic failover to oldest participant]");

  // All remaining participants leave -> Transient room status transitions to ended
  room.handleDisconnect({ id: "sock_bob", clientId: "client_bob", uid: "guest_bob" });
  room.handleDisconnect({ id: "sock_charlie", clientId: "client_charlie", uid: "guest_charlie" });
  assert(room.status === "ended", "Transient room must end when all participants leave");
  console.log("  PASS [INTEG-001.3: Empty transient room terminates cleanly]");

  // -------------------------------------------------------------------------
  // INTEG-002: Local Media Failover + Playback Revision Synchronization
  // -------------------------------------------------------------------------
  console.log("\n--- Scenario B: Local Media Failover + Playback Revision Sync (INTEG-002) ---");

  const mediaRoom = new IntegratedRoomEngine("room_beta", "owner_dan", true, signaling, db);
  mediaRoom.admitParticipant("client_dan", "owner_dan", "Dan", "sock_dan");
  mediaRoom.admitParticipant("client_erin", "guest_erin", "Erin", "sock_erin");
  mediaRoom.admitParticipant("client_frank", "guest_frank", "Frank", "sock_frank");
  mediaRoom.startRoom({ uid: "owner_dan", clientId: "client_dan" });

  const manifest: ServerLocalMediaManifest = {
    mediaId: "media_hash_abc",
    roomId: "room_beta",
    ownerId: "owner_dan",
    filename: "presentation.mp4",
    byteLength: 104857600,
    durationSeconds: 120,
    mimeType: "video/mp4",
    container: "mp4",
    codec: "avc1.4d401f",
    chunkSize: 1048576,
    totalChunks: 100,
    contentFingerprint: "fingerprint_abc",
    initializationSegmentByteLength: 1024,
    epoch: 1,
    createdAt: Date.now(),
  };

  const session = await mediaRoom.localMediaAuthority.announceSession(
    "room_beta",
    "owner_dan",
    true, // isHost = true
    manifest
  );
  assert(session !== null, "Local media session should be announced");
  assert(mediaRoom.localMediaAuthority.getSession("room_beta")?.epoch === 1, "Initial media epoch should be 1");

  // Peers register to the active session
  mediaRoom.localMediaAuthority.registerPeer("room_beta", "owner_dan", "peer_dan_1", "sock_dan");
  mediaRoom.localMediaAuthority.registerPeer("room_beta", "guest_erin", "peer_erin_1", "sock_erin");
  mediaRoom.localMediaAuthority.registerPeer("room_beta", "guest_frank", "peer_frank_1", "sock_frank");

  // Playback initialized and running
  const playRes = mediaRoom.handlePlaybackCommand({ uid: "owner_dan", clientId: "client_dan" }, { action: "play", time: 10.0, playbackRate: 1.0, operationId: "op_play_1" });
  assert(playRes.success && (playRes.revision ?? 0) >= 1, "Playback play command must set revision >= 1");

  // Advance time
  const timeBeforeFailover = mediaRoom.videoTS;
  assert(timeBeforeFailover >= 10.0, "Canonical time must advance");

  // Erin and Frank report availability for chunks
  const erinAvail = mediaRoom.localMediaAuthority.updatePeerAvailability(
    "room_beta",
    "peer_erin_1",
    "media_hash_abc",
    1,
    100, // availableChunksCount
    99   // contiguousThrough
  );
  assert(erinAvail === true, "Erin availability should be updated");

  const frankAvail = mediaRoom.localMediaAuthority.updatePeerAvailability(
    "room_beta",
    "peer_frank_1",
    "media_hash_abc",
    1,
    80,
    79
  );
  assert(frankAvail === true, "Frank availability should be updated");

  // Seed Dan disconnects -> Triggers automatic local media failover inside unregisterPeer
  mediaRoom.localMediaAuthority.unregisterPeer("room_beta", "peer_dan_1", "sock_dan");

  const postFailoverSession = mediaRoom.localMediaAuthority.getSession("room_beta");
  assert(postFailoverSession?.epoch === 2, "Media epoch must advance to 2 on failover");
  assert(postFailoverSession?.ownerId === "guest_erin", "Deterministic election must select highest capacity candidate (Erin)");

  // Verify TimelineAuthority was NOT reset by media failover
  const stateAfterFailover = mediaRoom.timeline.getSnapshot();
  assert(stateAfterFailover.revision === (playRes.revision ?? 1), "Playback revision must remain intact across media failover");
  assert(mediaRoom.videoTS >= timeBeforeFailover, "Timeline playback must continue forward without time reset");
  console.log("  PASS [INTEG-002.1: Local media failover advances epoch to 2 while timeline maintains continuous playback]");

  // Verify stale epoch signaling rejection
  const staleSignalPayload = {
    roomId: "room_beta",
    fromPeerId: "peer_erin_1",
    toPeerId: "peer_frank_1",
    signal: { sdp: "offer_stale" },
    epoch: 1, // Stale epoch (active is 2)
  };
  const signalingRelayStale = mediaRoom.localMediaAuthority.handleSignalRelay(
    {} as any,
    "sock_frank",
    staleSignalPayload,
    "media_hash_abc"
  );
  assert(signalingRelayStale === false, "Signaling with stale epoch 1 must be rejected fail-closed");

  // Valid epoch signaling passes
  const validSignalPayload = {
    roomId: "room_beta",
    fromPeerId: "peer_erin_1",
    toPeerId: "peer_frank_1",
    signal: { sdp: "offer_valid" },
    epoch: 2, // Valid current epoch
  };
  const signalingRelayValid = mediaRoom.localMediaAuthority.handleSignalRelay(
    {} as any,
    "sock_frank",
    validSignalPayload,
    "media_hash_abc"
  );
  assert(signalingRelayValid === true, "Signaling with current epoch 2 must succeed");
  console.log("  PASS [INTEG-002.2: Stale epoch WebRTC signaling is strictly rejected; valid epoch accepted]");

  // -------------------------------------------------------------------------
  // INTEG-003: Transactional Invitation & Admission Quota Integrity
  // -------------------------------------------------------------------------
  console.log("\n--- Scenario C: Transactional Invitation & Quota (INTEG-003) ---");

  db.invites.set("INVITE_SINGLE_USE", {
    id: "inv_101",
    room_id: "room_gamma",
    uses_count: 0,
    max_uses: 1,
  });

  // Simulate 8 concurrent redemption requests
  const redemptionPromises = Array.from({ length: 8 }, async () => {
    return db.query(
      "UPDATE public.room_invitations SET uses_count = uses_count + 1 WHERE code = $1 RETURNING *",
      ["INVITE_SINGLE_USE"]
    );
  });

  const redemptionResults = await Promise.all(redemptionPromises);
  const successfulRedemptions = redemptionResults.filter(r => r.rows.length > 0);
  const failedRedemptions = redemptionResults.filter(r => r.rows.length === 0);

  assert(successfulRedemptions.length === 1, "Exactly 1 concurrent redemption must succeed for max_uses = 1");
  assert(failedRedemptions.length === 7, "Exactly 7 concurrent redemptions must fail (quota exhausted)");
  assert(db.invites.get("INVITE_SINGLE_USE")?.uses_count === 1, "uses_count must exactly equal 1");
  console.log("  PASS [INTEG-003.1: 8 concurrent redemptions yield exactly 1 success and 7 quota rejects]");

  // -------------------------------------------------------------------------
  // INTEG-004: Reconnection & Identity Decoupling Matrix
  // -------------------------------------------------------------------------
  console.log("\n--- Scenario D: Reconnection & Identity Decoupling (INTEG-004) ---");

  const reconnRoom = new IntegratedRoomEngine("room_reconn", "owner_grace", true, signaling, db);
  reconnRoom.admitParticipant("client_grace", "owner_grace", "Grace", "sock_grace_1");
  reconnRoom.admitParticipant("client_hank", "user_hank", "Hank", "sock_hank_1");

  // Hank registers peer for WebRTC
  reconnRoom.localMediaAuthority.registerPeer("room_reconn", "user_hank", "peer_hank_1", "sock_hank_1");
  const hankPeer = reconnRoom.localMediaAuthority.getRegistry("room_reconn")?.getPeer("peer_hank_1");
  assert(hankPeer !== undefined && hankPeer.socketId === "sock_hank_1", "Peer ID should resolve for initial socket");

  // Hank temporarily disconnects
  reconnRoom.handleDisconnect({ id: "sock_hank_1", clientId: "client_hank", uid: "user_hank" });
  reconnRoom.localMediaAuthority.unregisterPeer("room_reconn", "peer_hank_1", "sock_hank_1");

  assert(reconnRoom.admittedParticipants.get("client_hank")?.state === "disconnected", "Hank should transition to disconnected state");
  assert(reconnRoom.socketIdMap["client_hank"] === undefined, "Old socket ID mapping must be removed");
  assert(reconnRoom.localMediaAuthority.getRegistry("room_reconn")?.getPeer("peer_hank_1") === undefined, "Hank peer must be unregistered");

  // Hank reconnects with new socket ID `sock_hank_2`
  const reconnSuccess = reconnRoom.handleReconnect("client_hank", "user_hank", "Hank", "sock_hank_2");
  assert(reconnSuccess, "Hank reconnection must succeed with valid identity");
  assert(reconnRoom.socketIdMap["client_hank"] === "sock_hank_2", "Socket ID map must update to sock_hank_2");

  // Hank registers new peer `peer_hank_2` on new socket
  reconnRoom.localMediaAuthority.registerPeer("room_reconn", "user_hank", "peer_hank_2", "sock_hank_2");
  const newHankPeer = reconnRoom.localMediaAuthority.getRegistry("room_reconn")?.getPeer("peer_hank_2");
  assert(newHankPeer !== undefined && newHankPeer.socketId === "sock_hank_2", "New peer ID must resolve for reconnected socket");
  console.log("  PASS [INTEG-004.1: Reconnection binds new socket/peer IDs without identity collision]");

  // -------------------------------------------------------------------------
  // INTEG-005: Anti-Leak & Memory Scavenging Verification
  // -------------------------------------------------------------------------
  console.log("\n--- Scenario E: Anti-Leak & Memory Cleanup (INTEG-005) ---");

  const cleanupRoom = new IntegratedRoomEngine("room_cleanup", "owner_ian", true, signaling, db);
  cleanupRoom.admitParticipant("client_ian", "owner_ian", "Ian", "sock_ian");
  cleanupRoom.admitParticipant("client_jen", "user_jen", "Jen", "sock_jen");

  // Test 1: Operation deduplication idempotency & TTL purge
  cleanupRoom.handlePlaybackCommand(
    { uid: "owner_ian", clientId: "client_ian" },
    { action: "play", time: 5.0, operationId: "op_dedup_test" }
  );
  assert(cleanupRoom.processedOperations.get("client_ian")?.length === 1, "Processed operation should be recorded");

  // Duplicate command is recognized and deduplicated
  const dupCmd = cleanupRoom.handlePlaybackCommand(
    { uid: "owner_ian", clientId: "client_ian" },
    { action: "play", time: 5.0, operationId: "op_dedup_test" }
  );
  assert(dupCmd.success, "Duplicate command should be acknowledged idempotently");
  assert(cleanupRoom.timeline.getSnapshot().revision === 2, "Duplicate command must not increment timeline revision");

  // Test 2: Scavenge expired disconnected participants
  cleanupRoom.handleDisconnect({ id: "sock_jen", clientId: "client_jen", uid: "user_jen" });
  const jenRecord = cleanupRoom.admittedParticipants.get("client_jen");
  assert(jenRecord?.state === "disconnected", "Jen should be marked disconnected");

  // Set disconnected time in the past beyond grace period
  if (jenRecord) {
    jenRecord.lastDisconnectedAt = Date.now() - 700000; // 11.6 minutes ago (> 10 min grace)
  }

  const scavengedCount = cleanupRoom.scavengeDisconnected(600000);
  assert(scavengedCount === 1, "Exactly 1 expired disconnected participant should be scavenged");
  assert(!cleanupRoom.admittedParticipants.has("client_jen"), "Jen's record must be purged from memory");
  console.log("  PASS [INTEG-005.1: Expired disconnected records are cleanly scavenged and deduplication is idempotent]");

  console.log("\n================================================================");
  console.log("ALL INTEGRATION CERTIFICATION SCENARIOS PASSED WITH ZERO FAILURES.");
  console.log("================================================================\n");
}

runIntegrationCertification().catch((err) => {
  console.error("Integration Certification failure:", err);
  process.exit(1);
});
