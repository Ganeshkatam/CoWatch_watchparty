/**
 * LOCAL-MEDIA-001: Client Local Media Distribution Test Suite
 */

import { LocalMediaCache } from "./LocalMediaCache";
import { LocalMediaChunker } from "./LocalMediaChunker";
import {
  LocalMediaManifest,
  calculateTotalChunks,
  detectMediaContainer,
  validateLocalMediaManifest,
} from "./LocalMediaManifest";
import { LocalMediaScheduler } from "./LocalMediaScheduler";
import { LocalMediaPeer } from "./LocalMediaPeer";
import { LocalMediaCoordinator } from "./LocalMediaCoordinator";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

async function runLocalMediaClientTests() {
  console.log("----------------------------------------------------------------");
  console.log("LOCAL-MEDIA-001: Client Local Media Verification Suite");
  console.log("----------------------------------------------------------------");

  // Test 1: Container detection
  assert(detectMediaContainer("movie.mp4", "video/mp4") === "mp4", "Test 1: MP4 detection");
  assert(detectMediaContainer("clip.webm", "video/webm") === "webm", "Test 1: WebM detection");
  assert(detectMediaContainer("film.mkv", "video/x-matroska") === "mkv", "Test 1: MKV detection");
  console.log("  PASS [Test 1: Media container and format detection]");

  // Test 2: Chunk calculation
  assert(calculateTotalChunks(1000000, 131072) === 8, "Test 2: Total chunk calculation (ceil)");
  assert(calculateTotalChunks(262144, 131072) === 2, "Test 2: Exact chunk boundary");
  console.log("  PASS [Test 2: Chunk boundary and total calculations]");

  // Test 3: LocalMediaChunker with mock Blob
  const mockData = new Uint8Array(500000); // ~500KB
  for (let i = 0; i < mockData.length; i++) {
    mockData[i] = i % 256;
  }
  const mockBlob = new Blob([mockData], { type: "video/mp4" });

  const chunker = new LocalMediaChunker(mockBlob, {
    filename: "test_video.mp4",
    chunkSize: 100000,
    durationSeconds: 60,
  });

  assert(chunker.getTotalChunks() === 5, "Test 3: Chunker total chunks");
  const manifest = chunker.getManifest("room_xyz", "user_host");
  assert(validateLocalMediaManifest(manifest), "Test 3: Manifest validation");
  assert(manifest.container === "mp4", "Test 3: Manifest container MP4");
  console.log("  PASS [Test 3: LocalMediaChunker slicing and manifest generation]");

  // Test 4: Chunk retrieval & Checksum
  const chunk0 = await chunker.getChunk(0);
  assert(chunk0 !== null, "Test 4: Chunk 0 exists");
  assert(chunk0!.header.byteLength === 100000, "Test 4: Chunk 0 length");
  assert(chunk0!.header.chunkIndex === 0, "Test 4: Chunk index 0");
  assert(chunk0!.data.length === 100000, "Test 4: Binary payload length");
  console.log("  PASS [Test 4: Binary chunk extraction and header metadata]");

  // Test 5: LocalMediaCache operations
  const cache = new LocalMediaCache(manifest, 10);
  assert(cache.getAvailableChunks().length === 0, "Test 5: Empty cache");

  cache.putChunk(0, chunk0!.data);
  const chunk1 = await chunker.getChunk(1);
  cache.putChunk(1, chunk1!.data);

  assert(cache.hasChunk(0), "Test 5: Has chunk 0");
  assert(cache.hasChunk(1), "Test 5: Has chunk 1");
  assert(!cache.hasChunk(2), "Test 5: Does not have chunk 2");
  assert(cache.getContiguousCoverageFromStart() === 2, "Test 5: Contiguous coverage = 2");
  console.log("  PASS [Test 5: In-memory cache storage and contiguous coverage]");

  // Test 6: Contiguous byte segment extraction
  const mergedSegment = cache.getContiguousByteSegment(0, 2);
  assert(mergedSegment !== null, "Test 6: Segment merged");
  assert(mergedSegment!.length === 200000, "Test 6: Merged segment length");
  console.log("  PASS [Test 6: Contiguous byte segment extraction for MSE buffer]");

  // Test 7: Cache LRU eviction (retaining critical headers)
  const smallCache = new LocalMediaCache(manifest, 3);
  smallCache.putChunk(0, new Uint8Array(10));
  smallCache.putChunk(1, new Uint8Array(10));
  smallCache.putChunk(2, new Uint8Array(10));
  smallCache.putChunk(3, new Uint8Array(10)); // Triggers eviction of chunk 2, keeping 0 and 1

  assert(smallCache.hasChunk(0), "Test 7: Chunk 0 preserved");
  assert(smallCache.hasChunk(1), "Test 7: Chunk 1 preserved");
  assert(smallCache.hasChunk(3), "Test 7: Chunk 3 present");
  assert(!smallCache.hasChunk(2), "Test 7: Chunk 2 evicted by LRU");
  console.log("  PASS [Test 7: LRU chunk eviction with critical header protection]");

  // Test 8: LocalMediaScheduler window calculation
  const scheduler = new LocalMediaScheduler(manifest, cache);
  const chunkAt10s = scheduler.calculateCurrentChunkIndex(10); // 10s out of 60s
  assert(chunkAt10s === 0, "Test 8: Chunk at 10s = 0");
  const chunkAt30s = scheduler.calculateCurrentChunkIndex(30); // 30s out of 60s -> 50% of 5 = chunk 2
  assert(chunkAt30s === 2, "Test 8: Chunk at 30s = 2");
  const chunkAt60s = scheduler.calculateCurrentChunkIndex(60);
  assert(chunkAt60s === 4, "Test 8: Chunk at 60s = 4");
  console.log("  PASS [Test 8: Playback timestamp to chunk index mapping on seek]");

  // Test 9: Missing chunks detection
  const missing = cache.getMissingChunkIndices([0, 1, 2, 3, 4]);
  assert(missing.length === 3 && missing.includes(2) && missing.includes(3) && missing.includes(4), "Test 9: Missing indices");
  console.log("  PASS [Test 9: Missing chunk indices detection for P2P requests]");

  // --- MOCK WEBRTC CLASSES FOR P2P TESTS ---
  class MockDataChannel {
    public readyState: string = "connecting";
    public bufferedAmount: number = 0;
    public binaryType: string = "blob";
    public onopen: (() => void) | null = null;
    public onclose: (() => void) | null = null;
    public onerror: ((err: any) => void) | null = null;
    public onmessage: ((event: any) => void) | null = null;
    public sentMessages: any[] = [];

    send(data: any) {
      this.sentMessages.push(data);
    }

    close() {
      this.readyState = "closed";
      this.onclose?.();
    }
  }

  class MockRTCPeerConnection {
    public connectionState: string = "new";
    public iceConnectionState: string = "new";
    public onconnectionstatechange: (() => void) | null = null;
    public oniceconnectionstatechange: (() => void) | null = null;
    public onicecandidate: ((event: any) => void) | null = null;
    public ondatachannel: ((event: any) => void) | null = null;
    public localDescription: any = null;
    public remoteDescription: any = null;
    public dataChannel: MockDataChannel;

    constructor() {
      this.dataChannel = new MockDataChannel();
    }

    createDataChannel(_label: string, _opts?: any) {
      return this.dataChannel as any;
    }

    async createOffer() {
      return { type: "offer", sdp: "mock-offer-sdp" } as any;
    }

    async createAnswer() {
      return { type: "answer", sdp: "mock-answer-sdp" } as any;
    }

    async setLocalDescription(desc: any) {
      this.localDescription = desc;
    }

    async setRemoteDescription(desc: any) {
      this.remoteDescription = desc;
    }

    async addIceCandidate(_cand: any) {}

    close() {
      this.connectionState = "closed";
      this.iceConnectionState = "closed";
      this.dataChannel.close();
    }

    simulateConnectionState(state: string) {
      this.connectionState = state;
      this.onconnectionstatechange?.();
    }

    simulateIceConnectionState(iceState: string) {
      this.iceConnectionState = iceState;
      this.oniceconnectionstatechange?.();
    }
  }

  (globalThis as any).RTCPeerConnection = MockRTCPeerConnection;

  // Test 10: LocalMediaPeer terminal connection failure
  let failureCallCount = 0;
  let failureReason = "";
  const mockPc10 = new MockRTCPeerConnection();
  const peer10 = new LocalMediaPeer(
    "peer_failed_test",
    true,
    () => {},
    {
      onConnectionFailed: (peerId, reason) => {
        failureCallCount++;
        failureReason = reason;
      },
    },
    { pc: mockPc10 as any }
  );

  mockPc10.simulateConnectionState("failed");
  assert(failureCallCount === 1, "Test 10: Failure callback called once on connectionState failed");
  assert(peer10.hasFailed() === true, "Test 10: hasFailed is true");
  assert(peer10.isReady() === false, "Test 10: isReady is false");
  console.log("  PASS [Test 10: LocalMediaPeer terminal connection failure detection]");

  // Test 11: LocalMediaPeer terminal ICE failure
  let iceFailureCount = 0;
  const mockPc11 = new MockRTCPeerConnection();
  const peer11 = new LocalMediaPeer(
    "peer_ice_failed_test",
    true,
    () => {},
    {
      onConnectionFailed: () => {
        iceFailureCount++;
      },
    },
    { pc: mockPc11 as any }
  );

  mockPc11.simulateIceConnectionState("failed");
  assert(iceFailureCount === 1, "Test 11: Failure callback called once on iceConnectionState failed");
  assert(peer11.hasFailed() === true, "Test 11: hasFailed is true on ICE failure");
  console.log("  PASS [Test 11: LocalMediaPeer terminal ICE failure detection]");

  // Test 12: LocalMediaPeer failure idempotence (duplicate events)
  let idempotentCount = 0;
  const mockPc12 = new MockRTCPeerConnection();
  const peer12 = new LocalMediaPeer(
    "peer_idempotent_test",
    true,
    () => {},
    {
      onConnectionFailed: () => {
        idempotentCount++;
      },
    },
    { pc: mockPc12 as any }
  );

  mockPc12.simulateConnectionState("failed");
  mockPc12.simulateIceConnectionState("failed");
  mockPc12.simulateConnectionState("failed");
  assert(idempotentCount === 1, "Test 12: Multiple failed state events fire callback exactly once");
  console.log("  PASS [Test 12: LocalMediaPeer failure reporting idempotency]");

  // Test 13: LocalMediaPeer negotiation timeout
  let timeoutFired: boolean = false;
  const mockPc13 = new MockRTCPeerConnection();
  const peer13 = new LocalMediaPeer(
    "peer_timeout_test",
    true,
    () => {},
    {
      onConnectionFailed: (_peerId, reason) => {
        if (reason.includes("Negotiation timeout")) {
          timeoutFired = true;
        }
      },
    },
    { pc: mockPc13 as any, negotiationTimeoutMs: 50 }
  );

  await peer13.startNegotiation();
  await new Promise((r) => setTimeout(r, 80));
  assert(Boolean(timeoutFired), "Test 13: Negotiation timeout fired when connection not established");
  assert(peer13.hasFailed() === true, "Test 13: Peer marked failed after timeout");
  console.log("  PASS [Test 13: LocalMediaPeer negotiation timeout detection]");

  // Test 14: Successful connection cancels negotiation timeout
  let cancelledTimeoutFired: boolean = false;
  const mockPc14 = new MockRTCPeerConnection();
  const peer14 = new LocalMediaPeer(
    "peer_open_cancel_test",
    true,
    () => {},
    {
      onConnectionFailed: () => {
        cancelledTimeoutFired = true;
      },
    },
    { pc: mockPc14 as any, negotiationTimeoutMs: 50 }
  );

  await peer14.startNegotiation();
  mockPc14.dataChannel.readyState = "open";
  mockPc14.dataChannel.onopen?.();
  await new Promise((r) => setTimeout(r, 80));
  assert(cancelledTimeoutFired === false, "Test 14: Timeout was canceled upon data channel open");
  assert(peer14.isReady() === true, "Test 14: Peer is ready");
  console.log("  PASS [Test 14: DataChannel open cancels negotiation timeout]");

  // Test 15: Transient disconnection recovers within grace period
  let transientFailed: boolean = false;
  const mockPc15 = new MockRTCPeerConnection();
  const peer15 = new LocalMediaPeer(
    "peer_transient_test",
    true,
    () => {},
    {
      onConnectionFailed: () => {
        transientFailed = true;
      },
    },
    { pc: mockPc15 as any, disconnectGraceMs: 60 }
  );

  mockPc15.dataChannel.readyState = "open";
  mockPc15.dataChannel.onopen?.();
  mockPc15.simulateConnectionState("disconnected");
  await new Promise((r) => setTimeout(r, 20));
  // Reconnect before grace period expires
  mockPc15.simulateConnectionState("connected");
  await new Promise((r) => setTimeout(r, 60));
  assert(transientFailed === false, "Test 15: Transient disconnection did not trigger failure callback");
  assert(peer15.hasFailed() === false, "Test 15: Peer did not fail after recovery");
  console.log("  PASS [Test 15: Transient disconnection recovers within grace period]");

  // Test 16: Unrecovered disconnection triggers failure after grace period
  let unrecoveredFailed: boolean = false;
  const mockPc16 = new MockRTCPeerConnection();
  const peer16 = new LocalMediaPeer(
    "peer_unrecovered_test",
    true,
    () => {},
    {
      onConnectionFailed: (_peerId, reason) => {
        if (reason.includes("grace period")) {
          unrecoveredFailed = true;
        }
      },
    },
    { pc: mockPc16 as any, disconnectGraceMs: 40 }
  );

  mockPc16.simulateConnectionState("disconnected");
  await new Promise((r) => setTimeout(r, 70));
  assert(Boolean(unrecoveredFailed), "Test 16: Failure callback fired after grace period elapsed");
  console.log("  PASS [Test 16: Unrecovered disconnection fails after grace period]");

  // Test 17: Close cancels all pending timers
  let closedPeerCallbackFired: boolean = false;
  const mockPc17 = new MockRTCPeerConnection();
  const peer17 = new LocalMediaPeer(
    "peer_closed_timer_test",
    true,
    () => {},
    {
      onConnectionFailed: () => {
        closedPeerCallbackFired = true;
      },
    },
    { pc: mockPc17 as any, negotiationTimeoutMs: 30 }
  );

  await peer17.startNegotiation();
  peer17.close();
  await new Promise((r) => setTimeout(r, 60));
  assert(closedPeerCallbackFired === false, "Test 17: Close cancelled negotiation timer");
  console.log("  PASS [Test 17: LocalMediaPeer close cancels all active timers]");

  // Test 18: Coordinator failure handling, retry, and terminal error reporting
  class MockSocket {
    public emitted: { event: string; data: any }[] = [];
    public listeners = new Map<string, Set<(...args: any[]) => void>>();
    on(event: string, handler: (...args: any[]) => void) {
      const handlers = this.listeners.get(event) || new Set();
      handlers.add(handler);
      this.listeners.set(event, handlers);
      return this;
    }
    off(event: string, handler: (...args: any[]) => void) {
      this.listeners.get(event)?.delete(handler);
      return this;
    }
    emit(event: string, data: any) {
      this.emitted.push({ event, data });
    }
  }

  const mockSocket = new MockSocket();
  let coordinatorStateUpdates: any[] = [];
  const coordinator = new LocalMediaCoordinator(
    mockSocket as any,
    "room_xyz",
    "part_user_1",
    (state) => {
      coordinatorStateUpdates.push({ ...state });
    }
  );

  // Participant role with manifest from host_user
  const partManifest: LocalMediaManifest = { ...manifest, ownerId: "host_user" };
  // Access private methods for controlled failure simulation
  const coordAny = coordinator as any;
  coordAny.role = "PARTICIPANT_PEER";
  coordAny.manifest = partManifest;
  coordAny.cache = new LocalMediaCache(partManifest);
  coordAny.scheduler = new LocalMediaScheduler(partManifest, coordAny.cache);

  // Register host seed peer
  const mockHostPc = new MockRTCPeerConnection();
  const hostPeer = new LocalMediaPeer(
    "host_user",
    true,
    () => {},
    {
      onConnectionFailed: (peerId, reason) => {
        coordAny.handlePeerFailure(peerId, reason);
      },
    },
    { pc: mockHostPc as any }
  );
  coordAny.peers.set("host_user", hostPeer);
  coordAny.scheduler.registerPeer(hostPeer);

  assert(coordinator.getState().peersCount === 1, "Test 18: Initial peer registered");
  assert(coordinator.getState().error === null, "Test 18: Initial error is null");

  // First failure: Should trigger recovery reconnect attempt without immediate error
  coordAny.handlePeerFailure("host_user", "Simulated first ICE drop");
  assert(coordAny.hostReconnectAttempts === 1, "Test 18: Reconnect attempt count incremented to 1");
  assert(coordinator.getState().error === null, "Test 18: Error still null during recovery reconnect");

  // Second failure on retried peer: Terminal failure, should populate lastError with actionable guidance
  coordAny.handlePeerFailure("host_user", "Simulated terminal reconnect failure");
  const finalState = coordinator.getState();
  assert(finalState.peersCount === 0, "Test 18: Failed peer removed from peers map");
  assert(finalState.error !== null, "Test 18: Terminal error populated in state");
  assert(finalState.error!.includes("restricting direct P2P connections"), "Test 18: Error mentions network/firewall restrictions");
  assert(finalState.error!.includes("Screenshare"), "Test 18: Error mentions Screenshare fallback guidance");
  console.log("  PASS [Test 18: Coordinator peer failure, recovery retry, and actionable error notification]");

  assert(mockSocket.listeners.size === 3, "Test 19: Coordinator registers exactly three socket listeners");
  coordinator.destroy();
  assert([...mockSocket.listeners.values()].every((handlers) => handlers.size === 0), "Test 19: destroy removes all owned socket listeners");
  console.log("  PASS [Test 19: Coordinator listener teardown is deterministic]");

  console.log("----------------------------------------------------------------");
  console.log("ALL 18 LOCAL-MEDIA-001 CLIENT TESTS PASSED SUCCESSFULLY!");
  console.log("----------------------------------------------------------------");
}

runLocalMediaClientTests().catch((err) => {
  console.error("Local Media Client Test Failed:", err);
  process.exit(1);
});
