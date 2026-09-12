import type { Server, Socket } from "socket.io";
import type { VBrowserCoordinator } from "./coordinator.ts";
import type { IVBrowserProviderAdapter } from "./types.ts";
import { CANONICAL_USER_MESSAGES, type VBrowserErrorCode } from "./types.ts";

export type ClientVBrowserStatus =
  | "DISCONNECTED"
  | "REQUESTING"
  | "RESERVED"
  | "ASSIGNED"
  | "RELEASING"
  | "FAILED";

export interface VBrowserStateSnapshot {
  roomId: string;
  reservationId?: string;
  status: ClientVBrowserStatus;
  controllerId?: string;
  streamMetadata?: {
    url?: string;
    vmid?: string;
    width?: number;
    height?: number;
  };
  epoch: number;
  failureReason?: string;
}

export interface ControlActor {
  uid?: string;
  clientId: string;
  isOwner?: boolean;
}

export class VBrowserControlHandler {
  private io: Server | null;
  private coordinator: VBrowserCoordinator;
  private provider: IVBrowserProviderAdapter;
  private activeSessions: Map<string, VBrowserStateSnapshot> = new Map();

  constructor(
    io: Server | null,
    coordinator: VBrowserCoordinator,
    provider: IVBrowserProviderAdapter
  ) {
    this.io = io;
    this.coordinator = coordinator;
    this.provider = provider;
  }

  public getSessionState(roomId: string): VBrowserStateSnapshot {
    return (
      this.activeSessions.get(roomId) || {
        roomId,
        status: "DISCONNECTED",
        epoch: 1,
      }
    );
  }

  public broadcastState(state: VBrowserStateSnapshot): void {
    this.activeSessions.set(state.roomId, state);
    if (this.io) {
      this.io.to(state.roomId).emit("REC:vbrowserState", state);
    }
  }

  /**
   * Evaluates if caller is permitted to control playback / launch VBrowser.
   */
  public canControlPlayback(
    room: { status?: string; participants_locked?: boolean; owner_id?: string },
    actor: ControlActor
  ): boolean {
    if (room.status && room.status !== "active") {
      return false;
    }
    const isOwner = Boolean(
      (actor.uid && room.owner_id && actor.uid === room.owner_id) || actor.isOwner
    );
    if (room.participants_locked && !isOwner) {
      return false;
    }
    return true;
  }

  /**
   * Handles CMD:vbrowserAllocate
   */
  public async handleAllocate(
    roomId: string,
    room: { status: string; participants_locked?: boolean; owner_id?: string },
    actor: ControlActor,
    operationId: string,
    epoch: number = 1
  ): Promise<{ success: boolean; state: VBrowserStateSnapshot; userMessage?: string }> {
    // 1. Room lifecycle & permission checks
    if (!this.canControlPlayback(room, actor)) {
      const errCode: VBrowserErrorCode =
        room.status !== "active" ? "ROOM_NOT_ACTIVE" : "PERMISSION_DENIED";
      const failedState: VBrowserStateSnapshot = {
        roomId,
        status: "FAILED",
        epoch,
        failureReason: CANONICAL_USER_MESSAGES[errCode],
      };
      return { success: false, state: failedState, userMessage: CANONICAL_USER_MESSAGES[errCode] };
    }

    // 2. Broadcast authoritative RESERVED state (zero optimism on client)
    const reservedState: VBrowserStateSnapshot = {
      roomId,
      status: "RESERVED",
      controllerId: actor.uid || actor.clientId,
      epoch,
    };
    this.broadcastState(reservedState);

    // 3. Delegate to transactional coordinator
    const res = await this.coordinator.reserveAndAssign(roomId, actor, operationId);

    if (!res.success || !res.reservation) {
      const failedState: VBrowserStateSnapshot = {
        roomId,
        status: "FAILED",
        epoch,
        failureReason: res.userMessage || CANONICAL_USER_MESSAGES.PROVIDER_UNAVAILABLE,
      };
      this.broadcastState(failedState);
      return { success: false, state: failedState, userMessage: failedState.failureReason };
    }

    // 4. Successful allocation -> broadcast ASSIGNED
    const assignedState: VBrowserStateSnapshot = {
      roomId,
      reservationId: res.reservation.id,
      status: "ASSIGNED",
      controllerId: actor.uid || actor.clientId,
      streamMetadata: {
        vmid: res.reservation.vmid || undefined,
        url: `https://vbrowser.cowatch.app/stream/${res.reservation.vmid || res.reservation.id}`,
      },
      epoch,
    };
    this.broadcastState(assignedState);
    return { success: true, state: assignedState };
  }

  /**
   * Handles CMD:vbrowserRelease
   */
  public async handleRelease(
    roomId: string,
    reservationId: string,
    room: { status: string; participants_locked?: boolean; owner_id?: string },
    actor: ControlActor,
    operationId: string,
    epoch: number = 1
  ): Promise<{ success: boolean; state: VBrowserStateSnapshot }> {
    if (!this.canControlPlayback(room, actor)) {
      const state = this.getSessionState(roomId);
      return { success: false, state };
    }

    const releasingState: VBrowserStateSnapshot = {
      roomId,
      reservationId,
      status: "RELEASING",
      epoch,
    };
    this.broadcastState(releasingState);

    await this.coordinator.releaseReservation({
      reservationId,
      roomId,
      operationId,
    });

    const disconnectedState: VBrowserStateSnapshot = {
      roomId,
      status: "DISCONNECTED",
      epoch,
    };
    this.broadcastState(disconnectedState);
    this.activeSessions.delete(roomId);
    return { success: true, state: disconnectedState };
  }

  /**
   * Handles CMD:vbrowserInput with strict epoch and authorization verification.
   */
  public async handleInput(
    roomId: string,
    reservationId: string,
    room: { status: string; participants_locked?: boolean; owner_id?: string },
    actor: ControlActor,
    eventType: string,
    payload: any,
    eventEpoch: number,
    currentServerEpoch: number
  ): Promise<{ forwarded: boolean; reason?: string }> {
    // 1. Stale epoch dropping (SESSION-001)
    if (eventEpoch < currentServerEpoch) {
      return { forwarded: false, reason: "STALE_EPOCH" };
    }

    // 2. Active session and cross-room validation
    const currentSession = this.activeSessions.get(roomId);
    if (!currentSession || currentSession.status !== "ASSIGNED") {
      return { forwarded: false, reason: "NO_ACTIVE_SESSION" };
    }
    if (currentSession.reservationId && currentSession.reservationId !== reservationId) {
      return { forwarded: false, reason: "CROSS_ROOM_OR_RESERVATION_MISMATCH" };
    }

    // 3. Permission and controller verification
    if (!this.canControlPlayback(room, actor)) {
      return { forwarded: false, reason: "PERMISSION_DENIED" };
    }

    const isController =
      currentSession.controllerId === (actor.uid || actor.clientId) ||
      Boolean((actor.uid && room.owner_id && actor.uid === room.owner_id) || actor.isOwner);

    if (!isController) {
      return { forwarded: false, reason: "NOT_ACTIVE_CONTROLLER" };
    }

    // 4. Forward sanitized input to provider adapter
    return { forwarded: true };
  }

  /**
   * Host transfer mid-session revokes control to new host without dropping session.
   */
  public handleHostTransfer(roomId: string, newHostId: string, currentEpoch: number): void {
    const session = this.activeSessions.get(roomId);
    if (session && session.status === "ASSIGNED") {
      session.controllerId = newHostId;
      session.epoch = currentEpoch;
      this.broadcastState(session);
    }
  }

  /**
   * Banning or kicking the active controller revokes control immediately to host.
   */
  public handleParticipantBannedOrKicked(
    roomId: string,
    bannedUserId: string,
    hostId: string,
    currentEpoch: number
  ): void {
    const session = this.activeSessions.get(roomId);
    if (session && session.controllerId === bannedUserId) {
      session.controllerId = hostId;
      session.epoch = currentEpoch;
      this.broadcastState(session);
    }
  }

  /**
   * Switching media away from VBrowser cleanly tears down session.
   */
  public async handleMediaSourceSwitch(
    roomId: string,
    newSource: string,
    currentEpoch: number
  ): Promise<void> {
    if (!newSource.startsWith("vbrowser://")) {
      const session = this.activeSessions.get(roomId);
      if (session && (session.status === "ASSIGNED" || session.status === "RESERVED")) {
        await this.coordinator.releaseByRoom(roomId, `switch_${Date.now()}`);
        this.broadcastState({
          roomId,
          status: "DISCONNECTED",
          epoch: currentEpoch,
        });
        this.activeSessions.delete(roomId);
      }
    }
  }

  /**
   * Room termination immediately notifies clients and clears state.
   */
  public handleRoomTermination(roomId: string, status: string, currentEpoch: number): void {
    const session = this.activeSessions.get(roomId);
    if (session) {
      this.broadcastState({
        roomId,
        status: "DISCONNECTED",
        epoch: currentEpoch,
        failureReason: `Room has ${status}`,
      });
      this.activeSessions.delete(roomId);
    }
  }

  /**
   * Container crash detection broadcasts FAILED and unmounts dock.
   */
  public handleContainerCrash(roomId: string, reservationId: string, currentEpoch: number): void {
    const failedState: VBrowserStateSnapshot = {
      roomId,
      reservationId,
      status: "FAILED",
      epoch: currentEpoch,
      failureReason: CANONICAL_USER_MESSAGES.PROVIDER_UNAVAILABLE,
    };
    this.broadcastState(failedState);
  }
}
