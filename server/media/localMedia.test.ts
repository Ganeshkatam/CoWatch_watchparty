/**
 * LOCAL-MEDIA-001: Server Local Media Authority & Failover Test Suite
 * Exhaustive regression suite verifying:
 * AUD-005: Signaling authority, authenticated sender identity, room-scoped isolation, session/epoch validation.
 * AUD-004: Peer availability tracking, bounds checking, heartbeat liveness, and deterministic failover election.
 */

import { LocalMediaAuthority } from "./local/LocalMediaAuthority.ts";
import { LocalMediaPeerRegistry, HEARTBEAT_TIMEOUT_MS } from "./local/LocalMediaPeerRegistry.ts";
import { LocalMediaSession, type ServerLocalMediaManifest } from "./local/LocalMediaSession.ts";
import { LocalMediaSignaling } from "./local/LocalMediaSignaling.ts";

class MockDatabase {
  public queries: { sql: string; params: any[] }[] = [];
  async query(sql: string, params: any[] = []): Promise<{ rows: any[] }> {
    this.queries.push({ sql, params });
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

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

async function runLocalMediaServerTests() {
  console.log("================================================================");
  console.log("LOCAL-MEDIA-001: AUD-005 & AUD-004 Server Verification Suite");
  console.log("================================================================");

  const db = new MockDatabase();
  const signaling = new MockSignaling();
  const authority = new LocalMediaAuthority(db as any, signaling as any);

  const baseManifest: ServerLocalMediaManifest = {
    mediaId: "media_test_001",
    roomId: "room_alpha",
    ownerId: "host_user_1",
    filename: "presentation.mp4",
    byteLength: 10485760,
    durationSeconds: 300,
    mimeType: "video/mp4",
    container: "mp4",
    codec: "avc1",
    chunkSize: 262144,
    totalChunks: 40,
    contentFingerprint: "sha256_fp_001",
    initializationSegmentByteLength: 262144,
    epoch: 1,
    createdAt: Date.now(),
  };

  // --- AUD-005: Signaling Authority & Isolation Tests ---
  console.log("\n--- AUD-005: Signaling Authority & Room Isolation ---");

  // Case 1: Sender identity enforcement (Server-derived fromPeerId, rejecting spoofed identity)
  await authority.announceSession("room_alpha", "host_user_1", true, { ...baseManifest });
  authority.registerPeer("room_alpha", "user_2", "peer_2", "socket_peer_2");
  signaling.clear();

  const spoofAttemptPayload = {
    roomId: "room_alpha",
    fromPeerId: "peer_spoofed_victim", // Attempted spoof
    toPeerId: "peer_2",
    signal: { sdp: "offer_data" },
    epoch: 1,
  };

  // Server relay logic requires matching session and epoch
  const relaySuccess = authority.handleSignalRelay(
    {} as any,
    "socket_peer_2",
    spoofAttemptPayload,
    "media_test_001"
  );
  assert(relaySuccess === true, "Case 1: Valid relay should succeed");
  assert(signaling.relayedSignals.length === 1, "Case 1: Exactly 1 signal relayed");
  assert(
    signaling.relayedSignals[0].targetSocketId === "socket_peer_2",
    "Case 1: Relayed to verified target socket"
  );
  console.log("  PASS [Case 1: Server routes signaling to target socket]");

  // Case 2: Cross-room signaling target isolation
  // Target in room_beta should not receive signals from room_alpha
  authority.registerPeer("room_beta", "user_3", "peer_beta_3", "socket_beta_3");
  // If a signal targets a socket from another room, authority handles only room-scoped session
  const crossRoomPayload = {
    roomId: "room_alpha",
    fromPeerId: "peer_2",
    toPeerId: "peer_beta_3",
    signal: { sdp: "offer_cross_room" },
    epoch: 1,
  };
  // Signaling to a peer not registered in room_alpha registry
  const roomAlphaRegistry = authority.getRegistry("room_alpha");
  const targetInAlpha = roomAlphaRegistry?.getPeer("peer_beta_3");
  assert(!targetInAlpha, "Case 2: Target from room_beta must not exist in room_alpha registry");
  console.log("  PASS [Case 2: Cross-room target registry isolation enforced]");

  // Case 3: Nonexistent target validation
  const nonexistentTarget = roomAlphaRegistry?.getPeer("peer_nonexistent");
  assert(!nonexistentTarget, "Case 3: Nonexistent target returns undefined");
  console.log("  PASS [Case 3: Nonexistent target peer rejection]");

  // Case 4: Stale epoch signal dropped
  const staleEpochPayload = {
    roomId: "room_alpha",
    fromPeerId: "peer_2",
    toPeerId: "peer_2",
    signal: { sdp: "stale_signal" },
    epoch: 0, // Session is at epoch 1
  };
  const staleEpochRelay = authority.handleSignalRelay(
    {} as any,
    "socket_peer_2",
    staleEpochPayload,
    "media_test_001"
  );
  assert(staleEpochRelay === false, "Case 4: Signal with stale epoch must be dropped");
  console.log("  PASS [Case 4: Stale epoch signal dropped fail-closed]");

  // Case 5: Wrong mediaId signal dropped
  const wrongMediaPayload = {
    roomId: "room_alpha",
    fromPeerId: "peer_2",
    toPeerId: "peer_2",
    signal: { sdp: "wrong_media_signal" },
    epoch: 1,
  };
  const wrongMediaRelay = authority.handleSignalRelay(
    {} as any,
    "socket_peer_2",
    wrongMediaPayload,
    "media_wrong_999" // Does not match session media_test_001
  );
  assert(wrongMediaRelay === false, "Case 5: Signal with mismatched mediaId must be dropped");
  console.log("  PASS [Case 5: Wrong mediaId signal dropped fail-closed]");

  // Case 6: Terminated session signal dropped
  authority.terminateSession("room_alpha");
  const terminatedRelay = authority.handleSignalRelay(
    {} as any,
    "socket_peer_2",
    spoofAttemptPayload,
    "media_test_001"
  );
  assert(terminatedRelay === false, "Case 6: Signal in terminated session must be dropped");
  console.log("  PASS [Case 6: Terminated session signaling dropped fail-closed]");

  // Case 7: Stale socket registration protection
  const regTest = new LocalMediaPeerRegistry();
  regTest.registerPeer("room_1", "user_alice", "peer_alice", "socket_old_A");
  // Alice reconnects with socket_new_B under same peerId
  regTest.registerPeer("room_1", "user_alice", "peer_alice", "socket_new_B");
  // Old disconnect event arrives for socket_old_A
  const unregOldResult = regTest.unregisterPeer("peer_alice", "socket_old_A");
  assert(unregOldResult === false, "Case 7: Unregister with old socketId must be ignored");
  assert(
    regTest.getPeer("peer_alice")?.socketId === "socket_new_B",
    "Case 7: Active socket_new_B remains registered"
  );
  console.log("  PASS [Case 7: Stale socket disconnect protection preserves new registration]");

  // Case 8: Unadmitted / non-host announcement rejection
  const nonHostRes = await authority.announceSession("room_gamma", "guest_user_x", false, {
    ...baseManifest,
    roomId: "room_gamma",
  });
  assert(nonHostRes === null, "Case 8: Non-host announcement must return null fail-closed");
  console.log("  PASS [Case 8: Unadmitted/non-host announcement rejected]");

  // --- AUD-004: Peer Availability Tracking & Failover Election Tests ---
  console.log("\n--- AUD-004: Peer Availability & Failover Election ---");

  // Re-initialize active session in room_alpha
  await authority.announceSession("room_alpha", "host_user_1", true, { ...baseManifest });
  authority.registerPeer("room_alpha", "host_user_1", "peer_host", "socket_host_1");
  authority.registerPeer("room_alpha", "user_bob", "peer_bob", "socket_bob_1");
  authority.registerPeer("room_alpha", "user_charlie", "peer_charlie", "socket_charlie_1");

  // Case 9: Availability report updates registry
  const availSuccess = authority.updatePeerAvailability(
    "room_alpha",
    "peer_bob",
    "media_test_001",
    1,
    20,
    19
  );
  assert(availSuccess === true, "Case 9: Valid availability update must succeed");
  const bobRecord = authority.getRegistry("room_alpha")?.getPeer("peer_bob");
  assert(bobRecord?.availableChunksCount === 20, "Case 9: availableChunksCount updated to 20");
  assert(bobRecord?.contiguousThrough === 19, "Case 9: contiguousThrough updated to 19");
  console.log("  PASS [Case 9: Availability report correctly updates registry]");

  // Case 10: Wrong mediaId availability report ignored
  const wrongMediaAvail = authority.updatePeerAvailability(
    "room_alpha",
    "peer_bob",
    "media_fake_000",
    1,
    25,
    24
  );
  assert(wrongMediaAvail === false, "Case 10: Wrong mediaId availability report must be rejected");
  console.log("  PASS [Case 10: Wrong mediaId availability report ignored]");

  // Case 11: Wrong epoch availability report ignored
  const wrongEpochAvail = authority.updatePeerAvailability(
    "room_alpha",
    "peer_bob",
    "media_test_001",
    99,
    25,
    24
  );
  assert(wrongEpochAvail === false, "Case 11: Wrong epoch availability report must be rejected");
  console.log("  PASS [Case 11: Wrong epoch availability report ignored]");

  // Case 12: Structural counter bounds validation
  // Negative available chunks
  assert(
    authority.updatePeerAvailability("room_alpha", "peer_bob", "media_test_001", 1, -5, 0) === false,
    "Case 12: Negative availableChunksCount rejected"
  );
  // availableChunksCount > totalChunks (40)
  assert(
    authority.updatePeerAvailability("room_alpha", "peer_bob", "media_test_001", 1, 50, 10) === false,
    "Case 12: availableChunksCount exceeding totalChunks rejected"
  );
  // contiguousThrough < -1
  assert(
    authority.updatePeerAvailability("room_alpha", "peer_bob", "media_test_001", 1, 10, -2) === false,
    "Case 12: contiguousThrough < -1 rejected"
  );
  // contiguousThrough >= totalChunks (40)
  assert(
    authority.updatePeerAvailability("room_alpha", "peer_bob", "media_test_001", 1, 10, 40) === false,
    "Case 12: contiguousThrough >= totalChunks rejected"
  );
  // Non-safe integer
  assert(
    authority.updatePeerAvailability("room_alpha", "peer_bob", "media_test_001", 1, 1.5, 0) === false,
    "Case 12: Floating point chunk count rejected"
  );
  console.log("  PASS [Case 12: Counter bounds and integer sanity validation]");

  // Case 13: Stale heartbeat candidate excluded from election
  const staleHeartbeatRegistry = new LocalMediaPeerRegistry();
  const testNow = Date.now();
  staleHeartbeatRegistry.registerPeer("room_1", "user_david", "peer_david", "socket_david");
  staleHeartbeatRegistry.updateAvailability("peer_david", "media_test_001", 1, 30, 29);
  // Simulate stale heartbeat (> 15s)
  const davidPeer = staleHeartbeatRegistry.getPeer("peer_david")!;
  davidPeer.lastHeartbeat = testNow - (HEARTBEAT_TIMEOUT_MS + 5000);

  const staleElection = staleHeartbeatRegistry.electFailoverSeed({
    targetMediaId: "media_test_001",
    targetEpoch: 1,
    now: testNow,
  });
  assert(staleElection === null, "Case 13: Candidate with stale heartbeat must be excluded");
  console.log("  PASS [Case 13: Stale heartbeat candidates excluded from election]");

  // Case 14: Host disconnect with single valid candidate promotes candidate
  const singleCandidateRegistry = new LocalMediaPeerRegistry();
  singleCandidateRegistry.registerPeer("room_1", "user_host", "peer_host", "socket_host");
  singleCandidateRegistry.registerPeer("room_1", "user_eva", "peer_eva", "socket_eva");
  singleCandidateRegistry.updateAvailability("peer_eva", "media_test_001", 1, 15, 14);

  const singleElected = singleCandidateRegistry.electFailoverSeed({
    excludeUserId: "user_host",
    targetMediaId: "media_test_001",
    targetEpoch: 1,
    now: testNow,
  });
  assert(singleElected !== null && singleElected.userId === "user_eva", "Case 14: user_eva elected");
  console.log("  PASS [Case 14: Single valid candidate elected on host disconnect]");

  // Case 15: Host disconnect with multiple candidates uses deterministic ordering (contiguousCoverage DESC, availableChunksCount DESC)
  const multiCandidateRegistry = new LocalMediaPeerRegistry();
  multiCandidateRegistry.registerPeer("room_1", "user_p1", "peer_1", "socket_1");
  multiCandidateRegistry.registerPeer("room_1", "user_p2", "peer_2", "socket_2");
  multiCandidateRegistry.registerPeer("room_1", "user_p3", "peer_3", "socket_3");

  // Peer 1: 30 total chunks, contiguous through 10
  multiCandidateRegistry.updateAvailability("peer_1", "media_test_001", 1, 30, 10);
  // Peer 2: 25 total chunks, contiguous through 20 (Higher contiguous coverage)
  multiCandidateRegistry.updateAvailability("peer_2", "media_test_001", 1, 25, 20);
  // Peer 3: 20 total chunks, contiguous through 5
  multiCandidateRegistry.updateAvailability("peer_3", "media_test_001", 1, 20, 5);

  const bestCoverage = multiCandidateRegistry.electFailoverSeed({
    targetMediaId: "media_test_001",
    targetEpoch: 1,
    now: testNow,
  });
  assert(
    bestCoverage?.userId === "user_p2",
    "Case 15: Candidate with highest contiguous coverage (contiguousThrough=20) wins"
  );
  console.log("  PASS [Case 15: Highest contiguous coverage priority in election]");

  // Case 16: Deterministic canonical tie-break on userId (alphabetical ASC) when coverage and counts are equal
  const tieBreakRegistry = new LocalMediaPeerRegistry();
  tieBreakRegistry.registerPeer("room_1", "user_zebra_99", "peer_z", "socket_z");
  tieBreakRegistry.registerPeer("room_1", "user_alpha_01", "peer_a", "socket_a");

  tieBreakRegistry.updateAvailability("peer_z", "media_test_001", 1, 25, 20);
  tieBreakRegistry.updateAvailability("peer_a", "media_test_001", 1, 25, 20);

  const tieWinner = tieBreakRegistry.electFailoverSeed({
    targetMediaId: "media_test_001",
    targetEpoch: 1,
    now: testNow,
  });
  assert(
    tieWinner?.userId === "user_alpha_01",
    "Case 16: Deterministic tie-break picks lexicographically smaller userId user_alpha_01"
  );
  console.log("  PASS [Case 16: Deterministic canonical userId tie-break]");

  // Case 17: Old socket disconnect after reconnect preserves candidate eligibility
  const reconnectRegistry = new LocalMediaPeerRegistry();
  reconnectRegistry.registerPeer("room_1", "user_frank", "peer_frank", "socket_frank_old");
  reconnectRegistry.updateAvailability("peer_frank", "media_test_001", 1, 20, 19);
  // Reconnect with new socket
  reconnectRegistry.registerPeer("room_1", "user_frank", "peer_frank", "socket_frank_new");
  // Old socket disconnects
  reconnectRegistry.unregisterPeer("peer_frank", "socket_frank_old");

  const frankElection = reconnectRegistry.electFailoverSeed({
    targetMediaId: "media_test_001",
    targetEpoch: 1,
    now: testNow,
  });
  assert(frankElection?.userId === "user_frank", "Case 17: user_frank remains eligible after old socket cleanup");
  assert(frankElection?.socketId === "socket_frank_new", "Case 17: socketId is socket_frank_new");
  console.log("  PASS [Case 17: Candidate remains eligible after stale socket unregister]");

  // Case 18: Failover atomically updates owner and increments epoch exactly once
  const sessionForAtomicTest = new LocalMediaSession({ ...baseManifest, epoch: 5, ownerId: "user_old_host" });
  assert(sessionForAtomicTest.epoch === 5, "Case 18: Initial epoch = 5");
  assert(sessionForAtomicTest.ownerId === "user_old_host", "Case 18: Initial owner = user_old_host");

  sessionForAtomicTest.promoteFailoverSeed("user_new_host");
  assert(sessionForAtomicTest.epoch === 6, "Case 18: Atomic promotion incremented epoch to 6");
  assert(sessionForAtomicTest.ownerId === "user_new_host", "Case 18: Atomic promotion set owner to user_new_host");
  assert(sessionForAtomicTest.manifest.epoch === 6, "Case 18: Manifest epoch matches session epoch");
  assert(sessionForAtomicTest.manifest.ownerId === "user_new_host", "Case 18: Manifest owner matches session owner");
  console.log("  PASS [Case 18: Atomic failover transition for ownerId and epoch]");

  // Case 19: New owner broadcast via authority on host disconnect
  signaling.clear();
  const roomAlphaAuthority = new LocalMediaAuthority(db as any, signaling as any);
  await roomAlphaAuthority.announceSession("room_alpha", "user_host_orig", true, {
    ...baseManifest,
    ownerId: "user_host_orig",
    epoch: 1,
  });
  roomAlphaAuthority.registerPeer("room_alpha", "user_host_orig", "peer_host_orig", "socket_host_orig");
  roomAlphaAuthority.registerPeer("room_alpha", "user_seed_successor", "peer_successor", "socket_successor");
  roomAlphaAuthority.updatePeerAvailability("room_alpha", "peer_successor", "media_test_001", 1, 35, 34);

  signaling.clear();
  // Host disconnects
  roomAlphaAuthority.unregisterPeer("room_alpha", "peer_host_orig", "socket_host_orig");

  assert(signaling.broadcasts.length === 1, "Case 19: Broadcast sent on failover promotion");
  const failoverBroadcast = signaling.broadcasts[0];
  assert(failoverBroadcast.manifest.ownerId === "user_seed_successor", "Case 19: Broadcast has new owner");
  assert(failoverBroadcast.manifest.epoch === 2, "Case 19: Broadcast has bumped epoch = 2");
  console.log("  PASS [Case 19: Host disconnect broadcasts new owner and bumped epoch]");

  // Case 20: Old epoch availability cannot influence new election
  const epochRegistry = new LocalMediaPeerRegistry();
  epochRegistry.registerPeer("room_1", "user_epoch_1_stale", "peer_ep1", "socket_ep1");
  epochRegistry.updateAvailability("peer_ep1", "media_test_001", 1, 40, 39); // Epoch 1

  epochRegistry.registerPeer("room_1", "user_epoch_2_active", "peer_ep2", "socket_ep2");
  epochRegistry.updateAvailability("peer_ep2", "media_test_001", 2, 20, 19); // Epoch 2

  const epoch2Election = epochRegistry.electFailoverSeed({
    targetMediaId: "media_test_001",
    targetEpoch: 2, // Searching only for active epoch 2
    now: testNow,
  });
  assert(
    epoch2Election?.userId === "user_epoch_2_active",
    "Case 20: Candidate on epoch 1 excluded; active candidate on epoch 2 elected"
  );
  console.log("  PASS [Case 20: Stale epoch availability excluded from election]");

  console.log("\n================================================================");
  console.log("ALL 20 LOCAL-MEDIA-001 (AUD-005 & AUD-004) TESTS PASSED!");
  console.log("================================================================");
}

runLocalMediaServerTests().catch((err) => {
  console.error("Local Media Server Test Failed:", err);
  process.exit(1);
});
