import { TimelineAuthority } from "../../server/timelineAuthority";
import { PlaybackSyncController } from "./playbackSyncController";
import { ClockSynchronizer } from "./playback/clockSync";
import { PlaybackAdapter } from "./playback/adapters";
import { operationCoordinator } from "./operationState";

// Mock Playback Adapter
class MockPlaybackAdapter implements PlaybackAdapter {
  public currentTime: number = 0;
  public playbackRate: number = 1.0;
  public paused: boolean = true;
  public ready: boolean = true;
  public buffering: boolean = false;
  public seekCount: number = 0;

  public getCurrentTime(): number {
    return this.currentTime;
  }
  public setCurrentTime(seconds: number): void {
    this.currentTime = seconds;
    this.seekCount++;
  }
  public getPlaybackRate(): number {
    return this.playbackRate;
  }
  public setPlaybackRate(rate: number): void {
    this.playbackRate = rate;
  }
  public isPaused(): boolean {
    return this.paused;
  }
  public isReady(): boolean {
    return this.ready && !this.buffering;
  }
}

// Mock Server Room for Permission & Mutation Tests
class MockServerRoom {
  public lock: string | undefined = undefined;
  public owner_id: string = "owner_123";
  public currentHostClientId: string = "host_client_1";
  public currentHostUid: string = "host_uid_1";
  public timeline: TimelineAuthority = new TimelineAuthority();
  public processedOperationIds: Set<string> = new Set();
  public emittedEvents: { event: string; data: any; recipient?: string }[] = [];

  public isHost(socket: { clientId: string; uid?: string }): boolean {
    return socket.clientId === this.currentHostClientId;
  }

  public canControlPlayback(socket: { clientId: string; uid?: string } | null | undefined): boolean {
    if (!socket) return false;
    if (this.lock) {
      const isOwner = Boolean(this.owner_id && socket.uid && socket.uid === this.owner_id);
      return this.isHost(socket) || isOwner;
    }
    return true;
  }

  public playVideo(socket: { clientId: string; uid?: string }, operationId?: string): boolean {
    if (!this.canControlPlayback(socket)) {
      this.emittedEvents.push({ event: "CMD:error", data: "Playback controls are locked to the host.", recipient: socket.clientId });
      return false;
    }
    if (operationId && this.processedOperationIds.has(operationId)) {
      this.emittedEvents.push({ event: "REC:playbackSync", data: this.timeline.generateSyncPayload(undefined, undefined, operationId) });
      return true;
    }
    if (operationId) {
      this.processedOperationIds.add(operationId);
    }
    this.timeline.play();
    this.emittedEvents.push({ event: "REC:playbackSync", data: this.timeline.generateSyncPayload(undefined, undefined, operationId) });
    return true;
  }

  public pauseVideo(socket: { clientId: string; uid?: string }, operationId?: string): boolean {
    if (!this.canControlPlayback(socket)) {
      this.emittedEvents.push({ event: "CMD:error", data: "Playback controls are locked to the host.", recipient: socket.clientId });
      return false;
    }
    if (operationId && this.processedOperationIds.has(operationId)) {
      this.emittedEvents.push({ event: "REC:playbackSync", data: this.timeline.generateSyncPayload(undefined, undefined, operationId) });
      return true;
    }
    if (operationId) {
      this.processedOperationIds.add(operationId);
    }
    this.timeline.pause();
    this.emittedEvents.push({ event: "REC:playbackSync", data: this.timeline.generateSyncPayload(undefined, undefined, operationId) });
    return true;
  }

  public seekVideo(socket: { clientId: string; uid?: string }, data: { time: number; operationId?: string }): boolean {
    if (!this.canControlPlayback(socket)) {
      this.emittedEvents.push({ event: "CMD:error", data: "Playback controls are locked to the host.", recipient: socket.clientId });
      return false;
    }
    const { time, operationId } = data;
    if (operationId && this.processedOperationIds.has(operationId)) {
      this.emittedEvents.push({ event: "REC:playbackSync", data: this.timeline.generateSyncPayload(undefined, undefined, operationId) });
      return true;
    }
    if (operationId) {
      this.processedOperationIds.add(operationId);
    }
    this.timeline.seek(time);
    this.emittedEvents.push({ event: "REC:playbackSync", data: this.timeline.generateSyncPayload(undefined, undefined, operationId) });
    return true;
  }
}

async function runMediaSyncTests() {
  console.log("----------------------------------------------------------------");
  console.log("MEDIA-SYNC-001: Authoritative Playback Synchronization Test Suite");
  console.log("----------------------------------------------------------------");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  PASS [${testName}]`);
      passed++;
    } else {
      console.error(`  FAIL [${testName}] - ${detail || "Assertion failed"}`);
      failed++;
    }
  }

  // Test 1: Pause Canonical Freeze
  {
    const baseTime = 100000;
    const timeline = new TimelineAuthority({ anchorTime: 42.5, anchorWallClock: baseTime, paused: true });
    const pos1 = timeline.getCanonicalTime(baseTime);
    const pos2 = timeline.getCanonicalTime(baseTime + 50000);
    assert(pos1 === 42.5 && pos2 === 42.5, "Test 1: Pause Canonical Freeze", `pos1=${pos1}, pos2=${pos2}`);
  }

  // Test 2: Continuous Rate Transition
  {
    const baseTime = 100000;
    const timeline = new TimelineAuthority({ anchorTime: 10, anchorWallClock: baseTime, paused: false, playbackRate: 1.0 });
    // After 10s at 1.0x, position is 20.0
    const timeAtTransition = baseTime + 10000;
    timeline.setPlaybackRate(2.0, timeAtTransition);
    const posAtTransition = timeline.getCanonicalTime(timeAtTransition);
    // After another 5s at 2.0x, position should be 20.0 + 10 = 30.0
    const posLater = timeline.getCanonicalTime(timeAtTransition + 5000);
    assert(
      Math.abs(posAtTransition - 20.0) < 0.001 && Math.abs(posLater - 30.0) < 0.001,
      "Test 2: Continuous Rate Transition",
      `posAtTransition=${posAtTransition}, posLater=${posLater}`
    );
  }

  // Test 3: Continuous Seek Anchor
  {
    const baseTime = 100000;
    const timeline = new TimelineAuthority({ anchorTime: 50, anchorWallClock: baseTime, paused: false, playbackRate: 1.0 });
    timeline.seek(120.5, baseTime + 5000);
    const posImmediate = timeline.getCanonicalTime(baseTime + 5000);
    const posAfter2s = timeline.getCanonicalTime(baseTime + 7000);
    assert(
      Math.abs(posImmediate - 120.5) < 0.001 && Math.abs(posAfter2s - 122.5) < 0.001,
      "Test 3: Continuous Seek Anchor",
      `posImmediate=${posImmediate}, posAfter2s=${posAfter2s}`
    );
  }

  // Test 4: Clock-Offset Independence
  {
    const serverBaseTime = 500000;
    const clockSync = new ClockSynchronizer();
    clockSync.setDirectOffset(5000); // offset = server - client = +5000ms

    const timeline = new TimelineAuthority({ anchorTime: 0, anchorWallClock: serverBaseTime, paused: false, playbackRate: 1.0 });
    const syncPayload = timeline.generateSyncPayload(serverBaseTime);

    const adapter = new MockPlaybackAdapter();
    const controller = new PlaybackSyncController(adapter, clockSync);
    controller.onPlaybackSyncReceived(syncPayload);

    // Client evaluates at local wall clock (serverBaseTime - 5000ms) + 10s elapsed (local 505000)
    const clientLocalNow = (serverBaseTime - 5000) + 10000;
    const canonicalTime = controller.calculateCanonicalTime(clientLocalNow);
    assert(Math.abs(canonicalTime - 10.0) < 0.001, "Test 4: Clock-Offset Independence", `canonicalTime=${canonicalTime}`);
  }

  // Test 5: Monotonic Tier-1 Adjustment
  {
    const clockSync = new ClockSynchronizer();
    clockSync.setDirectOffset(0);
    const adapter = new MockPlaybackAdapter();
    const controller = new PlaybackSyncController(adapter, clockSync);

    const now = 100000;
    // Server is at 100.0s playing at 1.0x
    controller.onPlaybackSyncReceived({ canonicalTime: 100.0, paused: false, playbackRate: 1.0, serverTime: now });

    // Client is at 100.5s (500ms ahead -> drift = +0.5s)
    adapter.currentTime = 100.5;
    const res1 = controller.evaluateAndSync(now);

    // Client is at 101.2s (1200ms ahead -> drift = +1.2s)
    adapter.currentTime = 101.2;
    const res2 = controller.evaluateAndSync(now);

    // Rate reduction should be monotonically larger for res2 than res1
    const rate1 = res1.adjustedRate;
    const rate2 = res2.adjustedRate;
    assert(
      res1.tier === "TIER_1_RATE_ADJUST" &&
      res2.tier === "TIER_1_RATE_ADJUST" &&
      rate1 < 1.0 && rate2 < rate1 && rate2 >= 0.92,
      "Test 5: Monotonic Tier-1 Adjustment",
      `rate1=${rate1}, rate2=${rate2}`
    );
  }

  // Test 6: Oscillation Suppression
  {
    const clockSync = new ClockSynchronizer();
    const adapter = new MockPlaybackAdapter();
    const controller = new PlaybackSyncController(adapter, clockSync);
    const now = 100000;

    controller.onPlaybackSyncReceived({ canonicalTime: 50.0, paused: false, playbackRate: 1.0, serverTime: now });

    // Step 1: Small ahead drift (+300ms)
    adapter.currentTime = 50.3;
    const step1 = controller.evaluateAndSync(now);

    // Step 2: At now + 1000ms, server canonicalTime is 51.0s. If adapter is at 51.15s (drift +150ms), it is in deadband Tier 0!
    adapter.currentTime = 51.15;
    const step2 = controller.evaluateAndSync(now + 1000);

    assert(
      step1.tier === "TIER_1_RATE_ADJUST" &&
      step2.tier === "TIER_0_DEADBAND" &&
      adapter.getPlaybackRate() === 1.0,
      "Test 6: Oscillation Suppression",
      `step1Rate=${step1.adjustedRate}, step2Rate=${adapter.getPlaybackRate()}`
    );
  }

  // Test 7: Seek Cooldown Enforcement
  {
    const clockSync = new ClockSynchronizer();
    const adapter = new MockPlaybackAdapter();
    const controller = new PlaybackSyncController(adapter, clockSync);
    controller.setSeekCooldownMs(1000);

    const now = 100000;
    controller.onPlaybackSyncReceived({ canonicalTime: 50.0, paused: false, playbackRate: 1.0, serverTime: now });

    // Severe drift (2.5s ahead)
    adapter.currentTime = 52.5;
    const res1 = controller.evaluateAndSync(now);
    assert(res1.actionTaken === "SEEK_EXECUTED", "Test 7 (Part 1): Initial seek executed", `action=${res1.actionTaken}`);

    // Burst drift check 200ms later with still large drift
    adapter.currentTime = 52.5;
    const res2 = controller.evaluateAndSync(now + 200);
    assert(
      res2.actionTaken === "SEEK_DEFERRED_COOLDOWN" && adapter.seekCount === 1,
      "Test 7 (Part 2): Seek Cooldown Enforcement",
      `action=${res2.actionTaken}, seekCount=${adapter.seekCount}`
    );
  }

  // Test 8: Buffering Readiness Guard
  {
    const clockSync = new ClockSynchronizer();
    const adapter = new MockPlaybackAdapter();
    adapter.buffering = true; // Player buffering
    const controller = new PlaybackSyncController(adapter, clockSync);

    const now = 100000;
    controller.onPlaybackSyncReceived({ canonicalTime: 50.0, paused: false, playbackRate: 1.0, serverTime: now });
    adapter.currentTime = 53.0; // 3.0s drift

    const res = controller.evaluateAndSync(now);
    assert(
      res.actionTaken === "SEEK_DEFERRED_UNREADY" && adapter.seekCount === 0,
      "Test 8: Buffering Readiness Guard",
      `actionTaken=${res.actionTaken}`
    );
  }

  // Test 9: Derived Legacy Compatibility
  {
    const now = 200000;
    const timeline = new TimelineAuthority({ anchorTime: 120.0, anchorWallClock: now, paused: false, playbackRate: 1.0 });
    const syncPayload = timeline.generateSyncPayload(now + 5000);
    const legacyTs = timeline.getCanonicalTime(now + 5000);
    assert(
      syncPayload.canonicalTime === legacyTs && syncPayload.canonicalTime === 125.0,
      "Test 9: Derived Legacy Compatibility",
      `syncTime=${syncPayload.canonicalTime}, legacyTs=${legacyTs}`
    );
  }

  // Test 10: Timeline Reconstruction
  {
    const savedSnapshot = {
      videoTS: 75.5,
      paused: false,
      playbackRate: 1.25,
      video: "https://example.com/video.mp4",
    };

    const timeline = new TimelineAuthority({
      anchorTime: savedSnapshot.videoTS,
      anchorWallClock: 100000,
      paused: savedSnapshot.paused,
      playbackRate: savedSnapshot.playbackRate,
      mediaSource: savedSnapshot.video,
    });

    const calculated = timeline.getCanonicalTime(100000 + 4000); // 4s at 1.25x = +5.0s -> 80.5s
    assert(Math.abs(calculated - 80.5) < 0.001, "Test 10: Timeline Reconstruction", `calculated=${calculated}`);
  }

  // Test 11: Paused Reconstruction Invariant
  {
    const savedSnapshot = {
      videoTS: 99.0,
      paused: true,
      playbackRate: 1.0,
      video: "https://example.com/video.mp4",
    };

    const downtimeMs = 3600 * 1000; // 1 hour downtime
    const timeline = new TimelineAuthority({
      anchorTime: savedSnapshot.videoTS,
      anchorWallClock: 100000,
      paused: savedSnapshot.paused,
      playbackRate: savedSnapshot.playbackRate,
    });

    const pos = timeline.getCanonicalTime(100000 + downtimeMs);
    assert(pos === 99.0, "Test 11: Paused Reconstruction Invariant", `pos=${pos}`);
  }

  // Test 12: Source Switch Anchor Reset
  {
    const timeline = new TimelineAuthority({ anchorTime: 50.0, anchorWallClock: 100000, paused: false });
    timeline.setMediaSource("https://example.com/new-media.mp4", 110000);
    const sync = timeline.generateSyncPayload(110000);
    assert(
      sync.canonicalTime === 0 && sync.mediaSource === "https://example.com/new-media.mp4" && sync.paused === false,
      "Test 12: Source Switch Anchor Reset",
      `sync=${JSON.stringify(sync)}`
    );
  }

  // Test 13: Host Failover Preservation
  {
    const room = new MockServerRoom();
    room.timeline = new TimelineAuthority({ anchorTime: 33.0, anchorWallClock: 100000, paused: false, playbackRate: 1.0 });

    // Host departs or transfers
    room.currentHostClientId = "host_client_2";
    room.currentHostUid = "host_uid_2";

    const pos = room.timeline.getCanonicalTime(100000 + 7000);
    assert(pos === 40.0 && !room.timeline.isPaused(), "Test 13: Host Failover Preservation", `pos=${pos}`);
  }

  // Test 14: Stale Epoch Rejection
  {
    const ep = operationCoordinator.beginConnectionEpoch();
    operationCoordinator.recordRoomStateReceived(ep);
    operationCoordinator.recordRosterReceived(ep);

    const isStaleAccepted = operationCoordinator.canAcceptMutationEvent(ep - 1);
    const isCurrentAccepted = operationCoordinator.canAcceptMutationEvent(ep);

    assert(
      !isStaleAccepted && isCurrentAccepted,
      "Test 14: Stale Epoch Rejection",
      `stale=${isStaleAccepted}, current=${isCurrentAccepted}`
    );
  }

  // Test 15: Server Permission Gate
  {
    const room = new MockServerRoom();
    room.lock = "owner_123"; // Locked room

    const guestSocket = { clientId: "guest_1", uid: "guest_uid" };
    const success = room.playVideo(guestSocket);
    const errorEvent = room.emittedEvents.find((e) => e.event === "CMD:error" && e.recipient === "guest_1");

    assert(!success && Boolean(errorEvent), "Test 15: Server Permission Gate", `success=${success}`);
  }

  // Test 16: Locked-Room Authority Enforcement
  {
    const room = new MockServerRoom();
    room.lock = "owner_123";

    const hostSocket = { clientId: "host_client_1", uid: "host_uid_1" };
    const guestSocket = { clientId: "guest_2", uid: "guest_uid_2" };

    const hostCan = room.canControlPlayback(hostSocket);
    const guestCan = room.canControlPlayback(guestSocket);

    assert(hostCan && !guestCan, "Test 16: Locked-Room Authority Enforcement", `hostCan=${hostCan}, guestCan=${guestCan}`);
  }

  // Test 17: Mutation Idempotency
  {
    const room = new MockServerRoom();
    const hostSocket = { clientId: "host_client_1", uid: "host_uid_1" };

    room.seekVideo(hostSocket, { time: 88.0, operationId: "op_seek_1" });
    const eventsAfterFirst = room.emittedEvents.length;

    // Retry identical mutation
    room.seekVideo(hostSocket, { time: 88.0, operationId: "op_seek_1" });
    const eventsAfterSecond = room.emittedEvents.length;

    assert(
      eventsAfterSecond === eventsAfterFirst + 1 &&
      room.processedOperationIds.has("op_seek_1") &&
      room.timeline.getCanonicalTime() === 88.0,
      "Test 17: Mutation Idempotency",
      `first=${eventsAfterFirst}, second=${eventsAfterSecond}`
    );
  }

  console.log("----------------------------------------------------------------");
  if (failed === 0) {
    console.log(`ALL 17 MEDIA-SYNC-001 TESTS PASSED WITH ZERO FAILURES.`);
  } else {
    console.error(`TEST SUITE FAILED: ${passed} passed, ${failed} failed.`);
    process.exit(1);
  }
  console.log("----------------------------------------------------------------\n");
}

runMediaSyncTests();
