/**
 * LOCAL-MEDIA-001: Server Local Media Authority & Signaling Test Suite
 */

import { LocalMediaAuthority } from "./local/LocalMediaAuthority.ts";
import { LocalMediaPeerRegistry } from "./local/LocalMediaPeerRegistry.ts";
import { type ServerLocalMediaManifest } from "./local/LocalMediaSession.ts";

class MockDatabase {
  public queries: { sql: string; params: any[] }[] = [];
  async query(sql: string, params: any[] = []): Promise<{ rows: any[] }> {
    this.queries.push({ sql, params });
    return { rows: [] };
  }
}

class MockSignaling {
  public broadcasts: { roomId: string; manifest: any }[] = [];
  public unavailables: { roomId: string; mediaId: string }[] = [];
  public relayedSignals: any[] = [];

  broadcastSession(roomId: string, manifest: any) {
    this.broadcasts.push({ roomId, manifest });
  }

  broadcastUnavailable(roomId: string, mediaId: string) {
    this.unavailables.push({ roomId, mediaId });
  }

  relaySignal(socket: any, targetSocketId: string, payload: any): boolean {
    this.relayedSignals.push({ targetSocketId, payload });
    return true;
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

async function runLocalMediaServerTests() {
  console.log("----------------------------------------------------------------");
  console.log("LOCAL-MEDIA-001: Server Local Media Verification Suite");
  console.log("----------------------------------------------------------------");

  const db = new MockDatabase();
  const signaling = new MockSignaling();
  const authority = new LocalMediaAuthority(db as any, signaling as any);

  const testManifest: ServerLocalMediaManifest = {
    mediaId: "media_test_123",
    roomId: "room_alpha",
    ownerId: "host_user_1",
    filename: "sample_video.mp4",
    byteLength: 5242880,
    durationSeconds: 120,
    mimeType: "video/mp4",
    container: "mp4",
    codec: "avc1",
    chunkSize: 131072,
    totalChunks: 40,
    contentHash: "hash_abc_123",
    initializationSegmentByteLength: 262144,
    epoch: 1,
    createdAt: Date.now(),
  };

  // Test 1: Non-host cannot announce session
  const nonHostRes = await authority.announceSession("room_alpha", "guest_user", false, testManifest);
  assert(nonHostRes === null, "Test 1: Non-host announcement should be rejected fail-closed");
  console.log("  PASS [Test 1: Non-host announcement rejected fail-closed]");

  // Test 2: Host announces session successfully
  const hostSession = await authority.announceSession("room_alpha", "host_user_1", true, testManifest);
  assert(hostSession !== null, "Test 2: Host announcement should succeed");
  assert(hostSession!.ownerId === "host_user_1", "Test 2: Owner should match host");
  assert(signaling.broadcasts.length === 1, "Test 2: Manifest broadcast should trigger");
  console.log("  PASS [Test 2: Host announces session and triggers room broadcast]");

  // Test 3: Session persists to PostgreSQL table
  assert(db.queries.length === 1, "Test 3: Query should be logged to database");
  assert(db.queries[0].sql.includes("room_media_sessions"), "Test 3: Should insert into room_media_sessions");
  console.log("  PASS [Test 3: Session metadata persisted to PostgreSQL room_media_sessions]");

  // Test 4: Registering peers in registry
  authority.registerPeer("room_alpha", "peer_2", "socket_peer_2");
  authority.registerPeer("room_alpha", "peer_3", "socket_peer_3");
  const session = authority.getSession("room_alpha");
  assert(session !== null && session.status === "ACTIVE", "Test 4: Session should remain active");
  console.log("  PASS [Test 4: Peer registration in room registry]");

  // Test 5: WebRTC signal relay
  const signalOk = authority.handleSignalRelay({} as any, "socket_peer_2", {
    roomId: "room_alpha",
    fromPeerId: "host_user_1",
    toPeerId: "peer_2",
    signal: { sdp: "mock_offer" },
    epoch: 1,
  });
  assert(signalOk === true, "Test 5: Signal relay should succeed");
  assert(signaling.relayedSignals.length === 1, "Test 5: Relayed signals count should be 1");
  console.log("  PASS [Test 5: WebRTC signal relay between peers]");

  // Test 6: Peer availability update & Failover election
  const peerRegistry = new LocalMediaPeerRegistry();
  peerRegistry.registerPeer("peer_2", "socket_2");
  peerRegistry.registerPeer("peer_3", "socket_3");
  peerRegistry.updateAvailability("peer_2", 15, 10);
  peerRegistry.updateAvailability("peer_3", 30, 25);

  const electedSeed = peerRegistry.electFailoverSeed();
  assert(electedSeed === "peer_3", "Test 6: peer_3 with highest contiguous chunks (25) should be elected");
  console.log("  PASS [Test 6: Optimal failover seed election based on contiguous chunks]");

  // Test 7: Host disconnect triggers failover seed promotion or unavailable
  authority.unregisterPeer("room_alpha", "host_user_1");
  assert(signaling.unavailables.length === 1, "Test 7: Should broadcast unavailable if no peer has chunks");
  console.log("  PASS [Test 7: Host disconnect without viable seed triggers fail-closed UNAVAILABLE]");

  // Test 8: Session termination
  authority.terminateSession("room_alpha");
  assert(authority.getSession("room_alpha") === null, "Test 8: Session should be cleared");
  console.log("  PASS [Test 8: Clean session termination and registry cleanup]");

  console.log("----------------------------------------------------------------");
  console.log("ALL 8 LOCAL-MEDIA-001 SERVER TESTS PASSED SUCCESSFULLY!");
  console.log("----------------------------------------------------------------");
}

runLocalMediaServerTests().catch((err) => {
  console.error("Local Media Server Test Failed:", err);
  process.exit(1);
});
