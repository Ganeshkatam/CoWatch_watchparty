/**
 * UI/STATE-001 & SESSION-001: Cross-Cutting Loading State & Session Resilience Architecture
 *
 * Invariants:
 * 1. UX !== Authority: Loading state is strictly an ephemeral UI projection of in-flight mutations.
 * 2. Independent Domains: Room lifecycle, host authority, participant authority, media playback, WebRTC, settings, feedback.
 * 3. Monotonic Epoch Tracking: OperationCoordinator is the SOLE authority for connection epochs.
 * 4. Epoch-Crossing Abort: Operations created in epoch N cannot resolve, reject, or mutate state in epoch N+1.
 * 5. Dual-Budget Failure Ceiling: 10 retry attempts or 45s wall-clock ceiling -> terminal FAILED.
 * 6. Elapsed Time Progression: 0-5s CONNECTING, >5s DEGRADED, budget exhaustion FAILED.
 * 7. Dual Readiness Barrier: Both roomState AND roster must be recorded for the current connectionEpoch before transition to READY.
 * 8. Spinner Delay Suppression: Operations completing under 150-200ms avoid showing spinners.
 */

import { USER_MESSAGES } from "./userMessages";

export const RETRY_ATTEMPT_BUDGET = 10;
export const MAX_RECOVERY_WINDOW_MS = 45_000;
export const DEGRADED_THRESHOLD_MS = 5_000;

export type AsyncStatus = "idle" | "pending" | "success" | "error";

export type OperationDomain =
  | "room-lifecycle"
  | "host-authority"
  | "participant-authority"
  | "media-playback"
  | "webrtc-peer"
  | "feedback"
  | "settings";

export type RoomInitStage =
  | "booting"
  | "authenticating"
  | "connecting"
  | "synchronizing"
  | "ready"
  | "degraded"
  | "failed";

export type PeerRtcStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed";

export interface OperationRecord {
  id: string;
  domain: OperationDomain;
  type: string;
  targetId?: string;
  status: AsyncStatus;
  startTime: number;
  showSpinner: boolean;
  error?: string;
  epoch: number;
}

export type OperationListener = (domain: OperationDomain, operations: OperationRecord[]) => void;

export class OperationCoordinator {
  private operations: Map<string, OperationRecord> = new Map();
  private listeners: Set<OperationListener> = new Set();
  private spinnerTimers: Map<string, any> = new Map();
  private timeoutTimers: Map<string, any> = new Map();
  private peerRtcStates: Map<string, PeerRtcStatus> = new Map();
  private peerListeners: Set<(peerId: string, status: PeerRtcStatus) => void> = new Set();

  private initStage: RoomInitStage = "booting";
  private initStageListeners: Set<(stage: RoomInitStage) => void> = new Set();
  private connectionEpoch: number = 0;
  private roomStateEpoch: number = -1;
  private rosterEpoch: number = -1;
  private syncWatchdogTimer: any = null;

  private reconnectAttempts: number = 0;
  private recoveryStartTime: number = 0;
  private degradedTimer: any = null;
  private recoveryTimer: any = null;

  public getConnectionEpoch(): number {
    return this.connectionEpoch;
  }

  public getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  public getRecoveryStartTime(): number {
    return this.recoveryStartTime;
  }

  /**
   * SOLE authority for advancing connection epochs.
   * Increments epoch, resets sync barriers, clears recovery timers, and begins synchronization.
   */
  public beginConnectionEpoch(): number {
    this.connectionEpoch += 1;
    this.resetSyncBarriers();
    this.clearRecoveryTimers();
    this.beginResynchronization(10000);
    return this.connectionEpoch;
  }

  public incrementConnectionEpoch(): number {
    return this.beginConnectionEpoch();
  }

  public resetSyncBarriers(): void {
    this.roomStateEpoch = -1;
    this.rosterEpoch = -1;
  }

  public getInitStage(): RoomInitStage {
    return this.initStage;
  }

  public setInitStage(stage: RoomInitStage): void {
    if (this.initStage === stage) return;
    this.initStage = stage;
    this.initStageListeners.forEach((fn) => fn(stage));
  }

  public onInitStageChange(listener: (stage: RoomInitStage) => void): () => void {
    this.initStageListeners.add(listener);
    return () => {
      this.initStageListeners.delete(listener);
    };
  }

  public isRoomReady(): boolean {
    return this.initStage === "ready";
  }

  public isEpochValid(epoch?: number): boolean {
    return epoch === undefined || epoch === this.connectionEpoch;
  }

  /**
   * Sync barrier events (roomState, roster) are accepted during SYNCHRONIZING or READY
   * if their epoch matches the current connectionEpoch.
   */
  public canAcceptSyncEvent(epoch?: number): boolean {
    return (
      (this.initStage === "synchronizing" || this.initStage === "ready") &&
      this.isEpochValid(epoch)
    );
  }

  /**
   * Post-ready mutation events (REC:hostAuthority, REC:lock, playback, etc.) are
   * accepted ONLY when initStage === 'ready' AND epoch matches current connectionEpoch.
   */
  public canAcceptMutationEvent(epoch?: number): boolean {
    return this.initStage === "ready" && this.isEpochValid(epoch);
  }

  public beginResynchronization(timeoutMs: number = 10000): void {
    if (this.syncWatchdogTimer) {
      clearTimeout(this.syncWatchdogTimer);
      this.syncWatchdogTimer = null;
    }
    this.setInitStage("synchronizing");

    // Watchdog: If dual barrier does not settle in timeoutMs, drop to DEGRADED
    this.syncWatchdogTimer = setTimeout(() => {
      if (this.initStage === "synchronizing") {
        this.setInitStage("degraded");
      }
    }, timeoutMs);
  }

  public completeResynchronization(): void {
    if (this.syncWatchdogTimer) {
      clearTimeout(this.syncWatchdogTimer);
      this.syncWatchdogTimer = null;
    }
    this.clearRecoveryTimers();
    this.reconnectAttempts = 0;
    this.recoveryStartTime = 0;
    this.setInitStage("ready");
  }

  public recordRoomStateReceived(epoch: number = this.connectionEpoch): boolean {
    if (epoch !== this.connectionEpoch) {
      // Obsolete sync generation event -> strictly discarded
      return false;
    }
    this.roomStateEpoch = epoch;
    return this.checkDualBarrier();
  }

  public recordRosterReceived(epoch: number = this.connectionEpoch): boolean {
    if (epoch !== this.connectionEpoch) {
      // Obsolete sync generation event -> strictly discarded
      return false;
    }
    this.rosterEpoch = epoch;
    return this.checkDualBarrier();
  }

  public checkDualBarrier(): boolean {
    if (
      this.roomStateEpoch === this.connectionEpoch &&
      this.rosterEpoch === this.connectionEpoch
    ) {
      this.completeResynchronization();
      return true;
    }
    return false;
  }

  public markTransportDisconnected(reason: string = "Transport disconnected", now: number = Date.now()): void {
    if (this.syncWatchdogTimer) {
      clearTimeout(this.syncWatchdogTimer);
      this.syncWatchdogTimer = null;
    }
    this.resetSyncBarriers();
    this.abortAllTransientOperations(reason);

    if (this.recoveryStartTime === 0) {
      this.recoveryStartTime = now;
    }
    this.setInitStage("connecting");

    // Non-blocking transition to degraded after 5s
    if (!this.degradedTimer) {
      this.degradedTimer = setTimeout(() => {
        if (this.initStage === "connecting") {
          this.setInitStage("degraded");
        }
      }, DEGRADED_THRESHOLD_MS);
    }

    // Hard ceiling timeout after 45s
    if (!this.recoveryTimer) {
      this.recoveryTimer = setTimeout(() => {
        if (
          this.initStage === "connecting" ||
          this.initStage === "degraded" ||
          this.initStage === "synchronizing"
        ) {
          this.markTerminalFailure("Maximum recovery window exceeded");
        }
      }, MAX_RECOVERY_WINDOW_MS);
    }
  }

  /**
   * Tracks reconnection attempts against the dual-budget failure ceiling.
   * Returns false if budget is exhausted (transitions to FAILED), true otherwise.
   */
  public recordReconnectAttempt(attempt?: number, now: number = Date.now()): boolean {
    if (typeof attempt === "number") {
      this.reconnectAttempts = attempt;
    } else {
      this.reconnectAttempts += 1;
    }

    if (this.recoveryStartTime === 0) {
      this.recoveryStartTime = now;
    }

    const elapsed = now - this.recoveryStartTime;

    // Dual-budget exhaustion check
    if (this.reconnectAttempts >= RETRY_ATTEMPT_BUDGET || elapsed >= MAX_RECOVERY_WINDOW_MS) {
      this.markTerminalFailure("Reconnection budget exhausted");
      return false;
    }

    // Elapsed time progression: > 5s -> DEGRADED
    if (elapsed >= DEGRADED_THRESHOLD_MS && this.initStage === "connecting") {
      this.setInitStage("degraded");
    }

    return true;
  }

  public markTransportReconnected(): void {
    this.beginConnectionEpoch();
  }

  public markTerminalFailure(reason: string = "Terminal connection failure"): void {
    if (this.syncWatchdogTimer) {
      clearTimeout(this.syncWatchdogTimer);
      this.syncWatchdogTimer = null;
    }
    this.clearRecoveryTimers();
    this.resetSyncBarriers();
    this.abortAllTransientOperations(reason);
    this.setInitStage("failed");
  }

  private clearRecoveryTimers(): void {
    if (this.degradedTimer) {
      clearTimeout(this.degradedTimer);
      this.degradedTimer = null;
    }
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  public abortDomain(domain: OperationDomain, reason?: string): void {
    for (const [id, op] of this.operations.entries()) {
      if (op.domain === domain && op.status === "pending") {
        this.cleanupTimers(id);
        op.status = "error";
        op.error = reason || "Operation aborted";
        op.showSpinner = false;
        this.notify(domain);
        this.operations.delete(id);
      }
    }
  }

  public abortAllTransientOperations(reason?: string): void {
    this.abortDomain("host-authority", reason);
    this.abortDomain("participant-authority", reason);
    this.abortDomain("media-playback", reason);
    this.abortDomain("settings", reason);
  }

  public subscribe(listener: OperationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public subscribePeer(listener: (peerId: string, status: PeerRtcStatus) => void): () => void {
    this.peerListeners.add(listener);
    return () => {
      this.peerListeners.delete(listener);
    };
  }

  public setPeerRtcStatus(peerId: string, status: PeerRtcStatus): void {
    if (!peerId) return;
    this.peerRtcStates.set(peerId, status);
    this.peerListeners.forEach((fn) => fn(peerId, status));
  }

  public getPeerRtcStatus(peerId: string): PeerRtcStatus {
    return this.peerRtcStates.get(peerId) || "idle";
  }

  public startOperation(
    domain: OperationDomain,
    type: string,
    targetId?: string,
    options?: { timeoutMs?: number; spinnerDelayMs?: number }
  ): string {
    const id = `${domain}:${type}:${Date.now()}:${Math.random().toString(36).substring(2, 7)}`;
    const spinnerDelay = options?.spinnerDelayMs ?? 180;
    const timeoutMs = options?.timeoutMs ?? 10000;

    const op: OperationRecord = {
      id,
      domain,
      type,
      targetId,
      status: "pending",
      startTime: Date.now(),
      showSpinner: false,
      epoch: this.connectionEpoch,
    };

    this.operations.set(id, op);

    // Suppress spinner for short operations (<180ms)
    const spinnerTimer = setTimeout(() => {
      const current = this.operations.get(id);
      if (current && current.status === "pending") {
        current.showSpinner = true;
        this.notify(domain);
      }
    }, spinnerDelay);
    this.spinnerTimers.set(id, spinnerTimer);

    // Failsafe auto-timeout
    const timeoutTimer = setTimeout(() => {
      this.rejectOperation(id, USER_MESSAGES.OPERATION_TIMEOUT_RETRY.message);
    }, timeoutMs);
    this.timeoutTimers.set(id, timeoutTimer);

    this.notify(domain);
    return id;
  }

  public resolveOperation(id: string): boolean {
    const op = this.operations.get(id);
    if (!op || op.status !== "pending") return false;

    // Epoch-Crossing Abort Invariant: Op started in epoch N resolving in epoch N+1 must be discarded
    if (op.epoch !== this.connectionEpoch) {
      this.cleanupTimers(id);
      this.operations.delete(id);
      return false;
    }

    this.cleanupTimers(id);
    op.status = "success";
    op.showSpinner = false;
    this.notify(op.domain);

    // Auto cleanup resolved op after 1s
    setTimeout(() => {
      if (this.operations.get(id)?.status === "success") {
        this.operations.delete(id);
        this.notify(op.domain);
      }
    }, 1000);
    return true;
  }

  public rejectOperation(id: string, error?: string): boolean {
    const op = this.operations.get(id);
    if (!op || op.status !== "pending") return false;

    // Epoch-Crossing Abort Invariant: Op started in epoch N rejecting in epoch N+1 must be discarded
    if (op.epoch !== this.connectionEpoch) {
      this.cleanupTimers(id);
      this.operations.delete(id);
      return false;
    }

    this.cleanupTimers(id);
    op.status = "error";
    op.error = error;
    op.showSpinner = false;
    this.notify(op.domain);

    // Auto cleanup errored op after 3s
    setTimeout(() => {
      if (this.operations.get(id)?.status === "error") {
        this.operations.delete(id);
        this.notify(op.domain);
      }
    }, 3000);
    return true;
  }

  public resolveDomainOperations(domain: OperationDomain, type?: string, targetId?: string): void {
    for (const [id, op] of this.operations.entries()) {
      if (op.domain === domain && op.status === "pending") {
        if (type && op.type !== type) continue;
        if (targetId && op.targetId !== targetId) continue;
        this.resolveOperation(id);
      }
    }
  }

  public rejectDomainOperations(domain: OperationDomain, error?: string, type?: string): void {
    for (const [id, op] of this.operations.entries()) {
      if (op.domain === domain && op.status === "pending") {
        if (type && op.type !== type) continue;
        this.rejectOperation(id, error);
      }
    }
  }

  public isPending(domain: OperationDomain, type?: string, targetId?: string): boolean {
    for (const op of this.operations.values()) {
      if (op.domain === domain && op.status === "pending") {
        if (type && op.type !== type) continue;
        if (targetId && op.targetId !== targetId) continue;
        return true;
      }
    }
    return false;
  }

  public shouldShowSpinner(domain: OperationDomain, type?: string, targetId?: string): boolean {
    for (const op of this.operations.values()) {
      if (op.domain === domain && op.status === "pending" && op.showSpinner) {
        if (type && op.type !== type) continue;
        if (targetId && op.targetId !== targetId) continue;
        return true;
      }
    }
    return false;
  }

  public getDomainStatus(domain: OperationDomain, type?: string): AsyncStatus {
    let hasPending = false;
    let hasError = false;
    let hasSuccess = false;

    for (const op of this.operations.values()) {
      if (op.domain === domain) {
        if (type && op.type !== type) continue;
        if (op.status === "pending") hasPending = true;
        if (op.status === "error") hasError = true;
        if (op.status === "success") hasSuccess = true;
      }
    }

    if (hasPending) return "pending";
    if (hasError) return "error";
    if (hasSuccess) return "success";
    return "idle";
  }

  public getActiveOperations(): OperationRecord[] {
    return Array.from(this.operations.values());
  }

  public resetAll(): void {
    for (const id of this.operations.keys()) {
      this.cleanupTimers(id);
    }
    this.operations.clear();
    this.peerRtcStates.clear();
    this.clearRecoveryTimers();
    this.reconnectAttempts = 0;
    this.recoveryStartTime = 0;
    this.connectionEpoch = 0;
    this.resetSyncBarriers();
    this.initStage = "booting";
    this.notify("room-lifecycle");
    this.notify("host-authority");
    this.notify("participant-authority");
    this.notify("media-playback");
    this.notify("webrtc-peer");
  }

  private cleanupTimers(id: string): void {
    const st = this.spinnerTimers.get(id);
    if (st) {
      clearTimeout(st);
      this.spinnerTimers.delete(id);
    }
    const tt = this.timeoutTimers.get(id);
    if (tt) {
      clearTimeout(tt);
      this.timeoutTimers.delete(id);
    }
  }

  private notify(domain: OperationDomain): void {
    const domainOps = Array.from(this.operations.values()).filter((op) => op.domain === domain);
    this.listeners.forEach((fn) => fn(domain, domainOps));
  }
}

export const operationCoordinator = new OperationCoordinator();
