import { operationCoordinator } from "./operationState";
import { USER_MESSAGES, sanitizeServerUserMessage } from "./userMessages";
import { showUserMessage } from "./toast";

export type ClientVBrowserStatus =
  | "DISCONNECTED"
  | "REQUESTING"
  | "RESERVED"
  | "ASSIGNED"
  | "RELEASING"
  | "FAILED";

export interface VBrowserServerState {
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

export type VBrowserStateListener = (state: VBrowserClientState) => void;

export interface VBrowserClientState {
  roomId: string | null;
  status: ClientVBrowserStatus;
  reservationId?: string;
  controllerId?: string;
  streamUrl?: string;
  isController: boolean;
  canControl: boolean;
  failureReason?: string;
  epoch: number;
}

export class ClientVBrowserCoordinator {
  private state: VBrowserClientState = {
    roomId: null,
    status: "DISCONNECTED",
    isController: false,
    canControl: false,
    epoch: 1,
  };

  private listeners: Set<VBrowserStateListener> = new Set();
  private activeOperationId: string | null = null;

  public getState(): VBrowserClientState {
    return { ...this.state };
  }

  public subscribe(listener: VBrowserStateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const currentState = this.getState();
    for (const listener of this.listeners) {
      listener(currentState);
    }
  }

  /**
   * Dispatches CMD:vbrowserAllocate bound to OperationCoordinator.
   */
  public allocate(
    roomId: string,
    sendSocketCmd: (cmd: string, payload: any) => void,
    options?: { isOwner?: boolean; canControl?: boolean }
  ): string {
    const epoch = operationCoordinator.getConnectionEpoch();
    const opId = operationCoordinator.startOperation(
      "media-playback",
      "vbrowser-allocate",
      roomId
    );

    this.activeOperationId = opId;
    this.state = {
      ...this.state,
      roomId,
      status: "REQUESTING",
      epoch,
    };
    this.notify();

    sendSocketCmd("CMD:vbrowserAllocate", {
      roomId,
      operationId: opId,
      epoch,
    });

    return opId;
  }

  /**
   * Dispatches CMD:vbrowserRelease bound to OperationCoordinator.
   */
  public release(
    roomId: string,
    reservationId: string,
    sendSocketCmd: (cmd: string, payload: any) => void
  ): string {
    const epoch = operationCoordinator.getConnectionEpoch();
    const opId = operationCoordinator.startOperation(
      "media-playback",
      "vbrowser-release",
      reservationId
    );

    this.activeOperationId = opId;
    this.state = {
      ...this.state,
      status: "RELEASING",
      epoch,
    };
    this.notify();

    sendSocketCmd("CMD:vbrowserRelease", {
      roomId,
      reservationId,
      operationId: opId,
      epoch,
    });

    return opId;
  }

  /**
   * Dispatches CMD:vbrowserInput with strict epoch and capability gating.
   */
  public sendInput(
    eventType: string,
    payload: any,
    sendSocketCmd: (cmd: string, payload: any) => void
  ): boolean {
    if (this.state.status !== "ASSIGNED" || !this.state.roomId || !this.state.reservationId) {
      return false;
    }
    if (!this.state.isController && !this.state.canControl) {
      return false;
    }

    const epoch = operationCoordinator.getConnectionEpoch();
    sendSocketCmd("CMD:vbrowserInput", {
      roomId: this.state.roomId,
      reservationId: this.state.reservationId,
      eventType,
      payload,
      epoch,
    });

    return true;
  }

  /**
   * Receives REC:vbrowserState and authoritatively reconciles client state.
   */
  public handleServerState(
    serverState: VBrowserServerState,
    currentUserId?: string
  ): void {
    const currentEpoch = operationCoordinator.getConnectionEpoch();

    // 1. Drop stale epoch updates (SESSION-001)
    if (serverState.epoch < currentEpoch) {
      return;
    }

    // 2. Resolve or complete pending operations
    if (this.activeOperationId) {
      if (serverState.status === "ASSIGNED" || serverState.status === "DISCONNECTED") {
        operationCoordinator.resolveOperation(this.activeOperationId);
        this.activeOperationId = null;
      } else if (serverState.status === "FAILED") {
        operationCoordinator.rejectOperation(
          this.activeOperationId,
          serverState.failureReason
        );
        this.activeOperationId = null;
      }
    }

    // 3. Update authoritative client state
    const isController = Boolean(
      currentUserId && serverState.controllerId && currentUserId === serverState.controllerId
    );

    this.state = {
      roomId: serverState.roomId,
      status: serverState.status,
      reservationId: serverState.reservationId,
      controllerId: serverState.controllerId,
      streamUrl: serverState.streamMetadata?.url,
      isController,
      canControl: isController,
      failureReason: serverState.failureReason,
      epoch: serverState.epoch,
    };

    if (serverState.status === "FAILED" && serverState.failureReason) {
      showUserMessage(sanitizeServerUserMessage(serverState.failureReason));
    }

    this.notify();
  }

  /**
   * Socket disconnect resets in-flight operations and marks state disconnected.
   */
  public handleDisconnect(): void {
    if (this.activeOperationId) {
      operationCoordinator.rejectOperation(this.activeOperationId, "Disconnected");
      this.activeOperationId = null;
    }
    this.state = {
      ...this.state,
      status: "DISCONNECTED",
      isController: false,
    };
    this.notify();
  }

  /**
   * Unmounts or clears state upon room exit / reset.
   */
  public reset(): void {
    this.state = {
      roomId: null,
      status: "DISCONNECTED",
      isController: false,
      canControl: false,
      epoch: 1,
    };
    this.activeOperationId = null;
    this.notify();
  }
}

export const clientVBrowserCoordinator = new ClientVBrowserCoordinator();
