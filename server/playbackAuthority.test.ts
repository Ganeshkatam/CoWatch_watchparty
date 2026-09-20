import { TimelineAuthority } from "./timelineAuthority.js";
import { PlaybackSyncController } from "../src/utils/playbackSyncController.js";
import { ClockSynchronizer } from "../src/utils/playback/clockSync.js";
import type { PlaybackAdapter } from "../src/utils/playback/adapters.js";

// Mock Playback Adapter for client tests
class MockAdapter implements PlaybackAdapter {
  public currentTime: number = 0;
  public playbackRate: number = 1.0;
  public paused: boolean = true;
  public ready: boolean = true;
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
    return this.ready;
  }
}

// Mock Server Room with exact Phase 4 architecture
class MockPlaybackRoom {
  public lock: string | undefined = undefined;
  public owner_id: string = "owner_uid_1";
  public currentHostUid: string = "host_uid_1";
  public currentHostClientId: string = "host_client_1";
  public timeline: TimelineAuthority = new TimelineAuthority();
  public paused: boolean = true;
  public playbackRate: number = 1.0;
  public tsMap: Record<string, number> = {};
  public lastTsMap: number = Date.now();
  public preventTSUpdate: boolean = false;
  public processedOperations: Map<string, { operationId: string; timestamp: number }[]> = new Map();
  public emittedEvents: { event: string; data: any; recipient?: string }[] = [];

  public get videoTS(): number {
    return this.timeline.getCanonicalTime();
  }

  public hasProcessedOperation(clientId?: string, operationId?: string): boolean {
    if (!clientId || !operationId) return false;
    const list = this.processedOperations.get(clientId);
    if (!list) return false;
    const now = Date.now();
    return list.some((op) => op.operationId === operationId && now - op.timestamp < 30000);
  }

  public recordProcessedOperation(clientId?: string, operationId?: string): void {
    if (!clientId || !operationId) return;
    const now = Date.now();
    const list = this.processedOperations.get(clientId) || [];
    const pruned = list.filter((op) => now - op.timestamp < 30000);
    pruned.push({ operationId, timestamp: now });
    if (pruned.length > 50) pruned.shift();
    this.processedOperations.set(clientId, pruned);
  }

  public canControlPlayback(socket: { clientId: string; uid?: string } | null | undefined): boolean {
    if (!socket) return false;
    if (this.lock) {
      return Boolean(socket.uid && socket.uid === this.currentHostUid);
    }
    return true;
  }

  public setTimestamp(socket: { clientId: string }, data: any) {
    if (String(data).length > 100 || typeof data !== "number" || !Number.isFinite(data)) {
      return;
    }
    if (this.preventTSUpdate) {
      return;
    }
    const sanitizedTs = Math.max(0, Math.round(data * 100) / 100);
    const timeSinceTsMap = Date.now() - this.lastTsMap;
    this.tsMap[socket.clientId] = sanitizedTs - timeSinceTsMap / 1000 + 1;
  }

  public playVideo(socket: { clientId: string; uid?: string }, data?: { operationId?: string } | string) {
    const operationId = typeof data === "object" ? data?.operationId : undefined;
    if (!this.canControlPlayback(socket)) {
      this.emittedEvents.push({ event: "CMD:error", data: "Playback controls are locked to the host.", recipient: socket.clientId });
      return;
    }
    if (this.hasProcessedOperation(socket.clientId, operationId)) {
      this.emittedEvents.push({ event: "REC:playbackSync", data: this.timeline.generateSyncPayload(undefined, undefined, operationId), recipient: socket.clientId });
      return;
    }
    this.recordProcessedOperation(socket.clientId, operationId);
    this.timeline.play();
    this.paused = false;
    this.emittedEvents.push({ event: "REC:play", data: undefined });
    this.emittedEvents.push({ event: "REC:playbackSync", data: this.timeline.generateSyncPayload(undefined, undefined, operationId) });
  }

  public pauseVideo(socket: { clientId: string; uid?: string }, data?: { operationId?: string } | string) {
    const operationId = typeof data === "object" ? data?.operationId : undefined;
    if (!this.canControlPlayback(socket)) {
      this.emittedEvents.push({ event: "CMD:error", data: "Playback controls are locked to the host.", recipient: socket.clientId });
      return;
    }
    if (this.hasProcessedOperation(socket.clientId, operationId)) {
      this.emittedEvents.push({ event: "REC:playbackSync", data: this.timeline.generateSyncPayload(undefined, undefined, operationId), recipient: socket.clientId });
      return;
    }
    this.recordProcessedOperation(socket.clientId, operationId);
    this.timeline.pause();
    this.paused = true;
    this.emittedEvents.push({ event: "REC:pause", data: undefined });
    this.emittedEvents.push({ event: "REC:playbackSync", data: this.timeline.generateSyncPayload(undefined, undefined, operationId) });
  }

  public seekVideo(socket: { clientId: string; uid?: string }, data: any) {
    if (!this.canControlPlayback(socket)) {
      this.emittedEvents.push({ event: "CMD:error", data: "Playback controls are locked to the host.", recipient: socket.clientId });
      return;
    }
    const rawTarget = typeof data === "object" ? Number(data?.time) : Number(data);
    const operationId = typeof data === "object" ? data?.operationId : undefined;
    if (String(rawTarget).length > 100 || !Number.isFinite(rawTarget)) {
      return;
    }
    if (this.hasProcessedOperation(socket.clientId, operationId)) {
      this.emittedEvents.push({ event: "REC:playbackSync", data: this.timeline.generateSyncPayload(undefined, undefined, operationId), recipient: socket.clientId });
      return;
    }
    this.recordProcessedOperation(socket.clientId, operationId);
    const targetTime = Math.max(0, rawTarget);
    this.timeline.seek(targetTime);
    this.emittedEvents.push({ event: "REC:seek", data: targetTime });
    this.emittedEvents.push({ event: "REC:playbackSync", data: this.timeline.generateSyncPayload(undefined, undefined, operationId) });
  }

  public setPlaybackRate(socket: { clientId: string; uid?: string }, data: any) {
    if (!this.canControlPlayback(socket)) {
      this.emittedEvents.push({ event: "CMD:error", data: "Playback controls are locked to the host.", recipient: socket.clientId });
      return;
    }
    const rawRate = typeof data === "object" ? Number(data?.rate) : Number(data);
    const operationId = typeof data === "object" ? data?.operationId : undefined;
    if (String(rawRate).length > 100 || !Number.isFinite(rawRate) || rawRate <= 0 || rawRate > 16) {
      return;
    }
    if (this.hasProcessedOperation(socket.clientId, operationId)) {
      this.emittedEvents.push({ event: "REC:playbackSync", data: this.timeline.generateSyncPayload(undefined, undefined, operationId), recipient: socket.clientId });
      return;
    }
    this.recordProcessedOperation(socket.clientId, operationId);
    this.timeline.setPlaybackRate(rawRate);
    this.playbackRate = rawRate;
    this.emittedEvents.push({ event: "REC:playbackRate", data: rawRate });
    this.emittedEvents.push({ event: "REC:playbackSync", data: this.timeline.generateSyncPayload(undefined, undefined, operationId) });
  }
}

async function runPlaybackAuthorityMatrix() {
  console.log("================================================================");
  console.log("PHASE 4: PLAYBACK AUTHORITY & SYNCHRONIZATION TEST MATRIX");
  console.log("================================================================");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testNum: number, testName: string, detail?: string) {
    if (condition) {
      console.log(`  PASS [Test ${testNum}: ${testName}]`);
      passed++;
    } else {
      console.error(`  FAIL [Test ${testNum}: ${testName}] - ${detail || "Assertion failed"}`);
      failed++;
    }
  }

  const hostSocket = { clientId: "host_c1", uid: "host_uid_1" };
  const guestSocket = { clientId: "guest_c2", uid: "guest_uid_2" };
  const otherSocket = { clientId: "guest_c3", uid: "guest_uid_3" };

  // AUD-006: Telemetry Isolation Matrix (Tests 1-6)

  // 1. CMD:ts does not modify canonical time
  {
    const room = new MockPlaybackRoom();
    room.timeline = new TimelineAuthority({ anchorTime: 50.0, anchorWallClock: 100000, paused: true });
    const initialCanonical = room.timeline.getCanonicalTime(100000);
    room.setTimestamp(guestSocket, 120.0);
    const postCanonical = room.timeline.getCanonicalTime(100000);
    const getterVideoTS = room.videoTS;
    assert(initialCanonical === 50.0 && postCanonical === 50.0 && getterVideoTS === 50.0, 1, "CMD:ts does not modify canonical time");
  }

  // 2. CMD:ts does not modify play state
  {
    const room = new MockPlaybackRoom();
    room.timeline = new TimelineAuthority({ anchorTime: 50.0, anchorWallClock: 100000, paused: true });
    room.setTimestamp(guestSocket, 80.0);
    assert(room.timeline.isPaused() === true && room.paused === true, 2, "CMD:ts does not modify play state");
  }

  // 3. CMD:ts does not modify playback rate
  {
    const room = new MockPlaybackRoom();
    room.timeline = new TimelineAuthority({ anchorTime: 50.0, anchorWallClock: 100000, paused: false, playbackRate: 1.0 });
    room.setTimestamp(guestSocket, 999.0);
    assert(room.timeline.getPlaybackRate() === 1.0 && room.playbackRate === 1.0, 3, "CMD:ts does not modify playback rate");
  }

  // 4. CMD:ts only updates sender's telemetry entry
  {
    const room = new MockPlaybackRoom();
    room.lastTsMap = Date.now();
    room.setTimestamp(guestSocket, 45.678);
    const hasGuest = guestSocket.clientId in room.tsMap;
    const hasHost = hostSocket.clientId in room.tsMap;
    const guestValue = Math.round(room.tsMap[guestSocket.clientId] * 100) / 100;
    assert(hasGuest && !hasHost && guestValue >= 45.0 && guestValue <= 47.0, 4, "CMD:ts only updates sender's telemetry entry");
  }

  // 5. NaN / Infinity / negative timestamp rejected or normalized
  {
    const room = new MockPlaybackRoom();
    room.lastTsMap = Date.now();
    room.setTimestamp(guestSocket, NaN);
    room.setTimestamp(guestSocket, Infinity);
    room.setTimestamp(guestSocket, -100);
    const valAfterNegative = room.tsMap[guestSocket.clientId];
    assert(valAfterNegative !== undefined && valAfterNegative >= 0 && valAfterNegative <= 2, 5, "NaN / Infinity / negative timestamp rejected or normalized");
  }

  // 6. excessively large timestamp bounded
  {
    const room = new MockPlaybackRoom();
    const badInput = "9".repeat(150) as any;
    room.setTimestamp(guestSocket, badInput);
    assert(!(guestSocket.clientId in room.tsMap), 6, "Excessively large timestamp bounded and rejected");
  }

  // AUD-007: Playback Authority Matrix (Tests 7-20)

  // 7. unauthorized play does not mutate timeline
  {
    const room = new MockPlaybackRoom();
    room.lock = "owner_uid_1";
    room.timeline = new TimelineAuthority({ anchorTime: 10.0, anchorWallClock: 100000, paused: true });
    room.playVideo(guestSocket, { operationId: "op_guest_play" });
    assert(room.timeline.isPaused() === true && room.videoTS === 10.0, 7, "Unauthorized play does not mutate timeline");
  }

  // 8. unauthorized pause does not mutate timeline
  {
    const room = new MockPlaybackRoom();
    room.lock = "owner_uid_1";
    room.timeline = new TimelineAuthority({ anchorTime: 10.0, anchorWallClock: 100000, paused: false });
    room.pauseVideo(guestSocket, { operationId: "op_guest_pause" });
    assert(room.timeline.isPaused() === false, 8, "Unauthorized pause does not mutate timeline");
  }

  // 9. unauthorized seek does not mutate timeline
  {
    const room = new MockPlaybackRoom();
    room.lock = "owner_uid_1";
    room.timeline = new TimelineAuthority({ anchorTime: 10.0, anchorWallClock: 100000, paused: true });
    room.seekVideo(guestSocket, { time: 500.0, operationId: "op_guest_seek" });
    assert(room.videoTS === 10.0, 9, "Unauthorized seek does not mutate timeline");
  }

  // 10. unauthorized rate change does not mutate timeline
  {
    const room = new MockPlaybackRoom();
    room.lock = "owner_uid_1";
    room.timeline = new TimelineAuthority({ anchorTime: 10.0, anchorWallClock: 100000, paused: false, playbackRate: 1.0 });
    room.setPlaybackRate(guestSocket, { rate: 2.0, operationId: "op_guest_rate" });
    assert(room.timeline.getPlaybackRate() === 1.0, 10, "Unauthorized rate change does not mutate timeline");
  }

  // 11. authorized play produces canonical sync
  {
    const room = new MockPlaybackRoom();
    room.timeline = new TimelineAuthority({ anchorTime: 15.0, anchorWallClock: 100000, paused: true });
    room.playVideo(hostSocket, { operationId: "op_host_play" });
    const syncEvent = room.emittedEvents.find((e) => e.event === "REC:playbackSync" && e.data?.operationId === "op_host_play");
    assert(
      room.timeline.isPaused() === false &&
      Boolean(syncEvent) &&
      syncEvent?.data?.paused === false &&
      typeof syncEvent?.data?.revision === "number",
      11,
      "Authorized play produces canonical sync"
    );
  }

  // 12. authorized pause produces canonical sync
  {
    const room = new MockPlaybackRoom();
    room.timeline = new TimelineAuthority({ anchorTime: 15.0, anchorWallClock: 100000, paused: false });
    room.pauseVideo(hostSocket, { operationId: "op_host_pause" });
    const syncEvent = room.emittedEvents.find((e) => e.event === "REC:playbackSync" && e.data?.operationId === "op_host_pause");
    assert(
      room.timeline.isPaused() === true &&
      Boolean(syncEvent) &&
      syncEvent?.data?.paused === true &&
      syncEvent?.data?.revision > 1,
      12,
      "Authorized pause produces canonical sync"
    );
  }

  // 13. authorized seek produces canonical sync
  {
    const room = new MockPlaybackRoom();
    room.timeline = new TimelineAuthority({ anchorTime: 0.0, anchorWallClock: 100000, paused: true });
    room.seekVideo(hostSocket, { time: 142.5, operationId: "op_host_seek" });
    const syncEvent = room.emittedEvents.find((e) => e.event === "REC:playbackSync" && e.data?.operationId === "op_host_seek");
    assert(
      room.videoTS === 142.5 &&
      Boolean(syncEvent) &&
      syncEvent?.data?.canonicalTime === 142.5,
      13,
      "Authorized seek produces canonical sync"
    );
  }

  // 14. authorized rate change produces canonical sync
  {
    const room = new MockPlaybackRoom();
    room.timeline = new TimelineAuthority({ anchorTime: 0.0, anchorWallClock: 100000, paused: false, playbackRate: 1.0 });
    room.setPlaybackRate(hostSocket, { rate: 1.75, operationId: "op_host_rate" });
    const syncEvent = room.emittedEvents.find((e) => e.event === "REC:playbackSync" && e.data?.operationId === "op_host_rate");
    assert(
      room.timeline.getPlaybackRate() === 1.75 &&
      Boolean(syncEvent) &&
      syncEvent?.data?.playbackRate === 1.75,
      14,
      "Authorized rate change produces canonical sync"
    );
  }

  // 15. duplicate operationId does not execute twice
  {
    const room = new MockPlaybackRoom();
    room.timeline = new TimelineAuthority({ anchorTime: 0.0, anchorWallClock: 100000, paused: true });
    room.seekVideo(hostSocket, { time: 50.0, operationId: "op_dup_1" });
    const rev1 = room.timeline.getRevision();
    // Attempt re-execution of same operationId
    room.seekVideo(hostSocket, { time: 100.0, operationId: "op_dup_1" });
    const rev2 = room.timeline.getRevision();
    assert(rev1 === rev2 && room.videoTS === 50.0, 15, "Duplicate operationId does not execute twice");
  }

  // 16. same operationId from different participants does not collide
  {
    const room = new MockPlaybackRoom();
    room.timeline = new TimelineAuthority({ anchorTime: 0.0, anchorWallClock: 100000, paused: true });
    // User A executes op_shared_1
    room.seekVideo(hostSocket, { time: 30.0, operationId: "op_shared_1" });
    const rev1 = room.timeline.getRevision();
    // User B executes op_shared_1 independently (when room is unlocked)
    room.seekVideo(guestSocket, { time: 60.0, operationId: "op_shared_1" });
    const rev2 = room.timeline.getRevision();
    assert(rev2 > rev1 && room.videoTS === 60.0, 16, "Same operationId from different participants does not collide");
  }

  // 17. stale playback revision is ignored client-side
  {
    const clockSync = new ClockSynchronizer();
    const adapter = new MockAdapter();
    const controller = new PlaybackSyncController(adapter, clockSync);

    const acceptedRev5 = controller.onPlaybackSyncReceived({
      canonicalTime: 50.0,
      paused: true,
      playbackRate: 1.0,
      serverTime: 100000,
      revision: 5,
    });

    const acceptedRev4 = controller.onPlaybackSyncReceived({
      canonicalTime: 20.0,
      paused: false,
      playbackRate: 1.0,
      serverTime: 90000,
      revision: 4,
    });

    assert(
      acceptedRev5 === true &&
      acceptedRev4 === false &&
      controller.getLatestRevision() === 5 &&
      controller.getLatestState()?.canonicalTime === 50.0,
      17,
      "Stale playback revision is ignored client-side"
    );
  }

  // 18. newer revision supersedes older state
  {
    const clockSync = new ClockSynchronizer();
    const adapter = new MockAdapter();
    const controller = new PlaybackSyncController(adapter, clockSync);

    controller.onPlaybackSyncReceived({
      canonicalTime: 50.0,
      paused: true,
      playbackRate: 1.0,
      serverTime: 100000,
      revision: 5,
    });

    const acceptedRev6 = controller.onPlaybackSyncReceived({
      canonicalTime: 75.0,
      paused: false,
      playbackRate: 1.5,
      serverTime: 105000,
      revision: 6,
    });

    assert(
      acceptedRev6 === true &&
      controller.getLatestRevision() === 6 &&
      controller.getLatestState()?.canonicalTime === 75.0 &&
      controller.getLatestState()?.playbackRate === 1.5,
      18,
      "Newer revision supersedes older state"
    );
  }

  // 19. server canonical seek differs safely from requested target
  {
    const room = new MockPlaybackRoom();
    room.timeline = new TimelineAuthority({ anchorTime: 10.0, anchorWallClock: 100000, paused: true });
    // Client requested negative time -25
    room.seekVideo(hostSocket, { time: -25.0, operationId: "op_neg_seek" });
    assert(room.videoTS === 0.0 && room.timeline.getCanonicalTime() === 0.0, 19, "Server canonical seek clamps negative targets safely");
  }

  // 20. reconnecting client receives canonical current state
  {
    const room = new MockPlaybackRoom();
    room.timeline = new TimelineAuthority({ anchorTime: 20.0, anchorWallClock: 100000, paused: false, playbackRate: 1.0 });
    // Time elapsed on server = 15 seconds
    const serverNow = 100000 + 15000;
    const currentSyncPayload = room.timeline.generateSyncPayload(serverNow);

    const reconnectingClockSync = new ClockSynchronizer();
    reconnectingClockSync.setDirectOffset(0);
    const reconnectingAdapter = new MockAdapter();
    const reconnectingController = new PlaybackSyncController(reconnectingAdapter, reconnectingClockSync);

    reconnectingController.onPlaybackSyncReceived(currentSyncPayload);
    const clientComputedCanonical = reconnectingController.calculateCanonicalTime(serverNow);

    assert(
      clientComputedCanonical === 35.0 &&
      currentSyncPayload.canonicalTime === 35.0 &&
      currentSyncPayload.paused === false,
      20,
      "Reconnecting client receives canonical current state without local assumption drift"
    );
  }

  console.log("================================================================");
  if (failed === 0) {
    console.log(`ALL 20 PLAYBACK AUTHORITY MATRIX TESTS PASSED WITH 0 FAILURES.`);
  } else {
    console.error(`MATRIX FAILED: ${passed} passed, ${failed} failed.`);
    process.exit(1);
  }
  console.log("================================================================\n");
}

runPlaybackAuthorityMatrix();
