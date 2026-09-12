/**
 * UI/STATE-001: Cross-Cutting Loading State Architecture
 *
 * Invariants:
 * 1. UX !== Authority: Loading state is strictly an ephemeral UI projection of in-flight mutations.
 * 2. Independent Domains: Room lifecycle, host authority, participant authority, media playback, and WebRTC.
 * 3. Monotonic Operation Tracking: Unique operation IDs ensure stale responses never clear newer states.
 * 4. Spinner Delay Suppression: Operations completing under 150-200ms avoid showing spinners.
 */

export type AsyncStatus = "idle" | "pending" | "success" | "error";

export type OperationDomain =
  | "room-lifecycle"
  | "host-authority"
  | "participant-authority"
  | "media-playback"
  | "webrtc-peer";

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
}

export type OperationListener = (domain: OperationDomain, operations: OperationRecord[]) => void;

class OperationCoordinator {
  private operations: Map<string, OperationRecord> = new Map();
  private listeners: Set<OperationListener> = new Set();
  private spinnerTimers: Map<string, any> = new Map();
  private timeoutTimers: Map<string, any> = new Map();
  private peerRtcStates: Map<string, PeerRtcStatus> = new Map();
  private peerListeners: Set<(peerId: string, status: PeerRtcStatus) => void> = new Set();

  private initStage: RoomInitStage = "booting";
  private initStageListeners: Set<(stage: RoomInitStage) => void> = new Set();

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
      this.rejectOperation(id, "Operation timed out waiting for server response");
    }, timeoutMs);
    this.timeoutTimers.set(id, timeoutTimer);

    this.notify(domain);
    return id;
  }

  public resolveOperation(id: string): void {
    const op = this.operations.get(id);
    if (!op || op.status !== "pending") return;

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
  }

  public rejectOperation(id: string, error?: string): void {
    const op = this.operations.get(id);
    if (!op || op.status !== "pending") return;

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
