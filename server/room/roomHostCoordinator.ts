import { Server, Socket } from "socket.io";
import { randomUUID } from "crypto";
import config from "../config.ts";
import { redisCore } from "../utils/redis.ts";
import { notificationService } from "../notifications/notificationService.ts";
import {
  authorizeRoomAction as pureAuthorizeRoomAction,
  type AuthorizationContext,
  type AuthorizationResult,
  type RoomAction,
} from "../roomAuthorization.ts";
import type { AdmittedParticipantRecord } from "./roomAdmissionCoordinator.ts";

export type HostMode = "owner" | "temporary" | "none";

export type HostTransitionReason =
  | "explicit_transfer"
  | "failover"
  | "owner_regain"
  | "initial"
  | "room_empty";

export class HostTransitionUnavailableError extends Error {
  public readonly code = "HOST_TRANSITION_UNAVAILABLE" as const;

  public constructor(message = "Host transition is temporarily unavailable.") {
    super(message);
    this.name = "HostTransitionUnavailableError";
  }
}

export interface HostAuthorityPayload {
  hostId: string;
  hostClientId: string;
  mode: HostMode;
  reason: HostTransitionReason;
  hostName?: string;
  isOwner?: boolean;
}

export interface AuthorizeActionParams {
  actorSocket: Socket | null | undefined;
  action: RoomAction;
  targetUserId?: string;
  targetMessageAuthorId?: string;
  targetMessageRoomId?: string;
}

export interface RoomHostCoordinatorDependencies {
  roomId: string;
  io: Server;
  getOwnerId: () => string;
  getClientToUidMap: () => StringDict;
  getNameMap: () => StringDict;
  isParticipantEligibleForHost: (clientId: string) => boolean;
  getEligibleParticipants: (excludeClientId?: string) => { clientId: string; record: AdmittedParticipantRecord }[];
  buildAuthorizationContext: (socket: Socket | null | undefined) => AuthorizationContext;
  authorizeRoomAction: (params: AuthorizeActionParams) => AuthorizationResult;
  addChatMessage: (socket: Socket | null, chatMsg: any) => void;
  getRoomStateBroadcastDetails: () => {
    isChatDisabled?: boolean;
    roomTitle?: string;
    roomDescription?: string;
    mediaPath?: string;
    participantsLocked: boolean;
    maxParticipants: number;
  };
}

export class RoomHostCoordinator {
  public currentHostClientId: string = "";
  public currentHostUid: string = "";
  public hostMode: HostMode = "none";
  public hostEpoch: number = 1;

  private readonly deps: RoomHostCoordinatorDependencies;

  constructor(deps: RoomHostCoordinatorDependencies) {
    this.deps = deps;
  }

  public isHost = (socket: Socket | null | undefined): boolean => {
    if (!socket?.uid || !this.currentHostUid) return false;
    return socket.uid === this.currentHostUid;
  };

  public isHostUid = (uid: string): boolean => {
    if (!uid) return false;
    const ownerId = this.deps.getOwnerId();
    if (ownerId && ownerId === uid) return true;
    if (this.currentHostUid && this.currentHostUid === uid) return true;
    return false;
  };

  public getHostMode = (): HostMode => {
    if (!this.currentHostUid && !this.currentHostClientId) {
      return "none";
    }
    const ownerId = this.deps.getOwnerId();
    const isOwner = Boolean(ownerId && this.currentHostUid && this.currentHostUid === ownerId);
    return isOwner ? "owner" : "temporary";
  };

  public getHostDisplayName = (): string => {
    const nameMap = this.deps.getNameMap();
    if (this.currentHostClientId && nameMap[this.currentHostClientId]) {
      return nameMap[this.currentHostClientId];
    }
    return "Host";
  };

  public getHostAuthorityPayload = (
    reason: HostTransitionReason = "initial",
  ): HostAuthorityPayload => {
    const mode = this.getHostMode();
    const hostId = this.currentHostUid || this.currentHostClientId;
    return {
      hostId,
      hostClientId: this.currentHostClientId,
      mode,
      reason,
      hostName: this.getHostDisplayName(),
      isOwner: mode === "owner",
    };
  };

  public broadcastHostChange = (reason: HostTransitionReason): void => {
    const mode = this.getHostMode();
    this.hostMode = mode;
    const isOwner = mode === "owner";
    const hostId = this.currentHostUid || this.currentHostClientId;
    const hostPayload: HostAuthorityPayload = {
      hostId,
      hostClientId: this.currentHostClientId,
      mode,
      reason,
      hostName: this.getHostDisplayName(),
      isOwner,
    };
    this.deps.io.of(this.deps.roomId).emit("REC:hostAuthority", hostPayload);
    this.deps.io.of(this.deps.roomId).emit("REC:hostChange", hostPayload);

    if ((reason === "failover" || reason === "explicit_transfer") && this.currentHostUid) {
      notificationService
        .notifyUser({
          userId: this.currentHostUid,
          type: "ROOM_HOST_TRANSFER",
          title: "Host role assigned",
          body: `You are now the host of room ${this.deps.roomId}.`,
          metadata: {
            roomId: this.deps.roomId,
            action: "open_room",
            targetUrl: `/watch/${encodeURIComponent(this.deps.roomId)}`,
            reason,
            hostEpoch: this.hostEpoch,
          },
          eventId: `ROOM_HOST_TRANSFER:${this.deps.roomId}:${this.currentHostUid}`,
        })
        .catch((err) => console.error("[Notification] Failed to notify new host:", err));
    }

    const roomDetails = this.deps.getRoomStateBroadcastDetails();
    this.deps.io.of(this.deps.roomId).emit("REC:getRoomState", {
      owner: this.deps.getOwnerId(),
      currentHostId: hostId,
      currentHostClientId: this.currentHostClientId,
      hostName: this.getHostDisplayName(),
      hostMode: mode,
      isHost: false, // Per-socket value evaluated in getRoomState()
      isChatDisabled: roomDetails.isChatDisabled,
      roomTitle: roomDetails.roomTitle,
      roomDescription: roomDetails.roomDescription,
      mediaPath: roomDetails.mediaPath,
      participantsLocked: roomDetails.participantsLocked,
      maxParticipants: roomDetails.maxParticipants,
    });
  };

  public withHostTransitionLease = async <T>(
    action: () => Promise<T>,
  ): Promise<T> => {
    const isMultiInstance = Boolean(
      config.REDIS_CORE_URL || (config.NODE_ENV !== "production" && config.REDIS_URL),
    );

    if (!isMultiInstance) {
      return action();
    }

    const availability = redisCore.getAvailability();

    if (!availability.available) {
      throw new HostTransitionUnavailableError(
        `Redis is unavailable: ${availability.reason}`,
      );
    }

    const leaseKey = `room:host:${this.deps.roomId}`;
    const leaseVal =
      `${process.pid}:${Date.now()}:${randomUUID()}`;

    let acquired = false;

    try {
      acquired = await redisCore.setLease(
        leaseKey,
        leaseVal,
        5,
      );
    } catch (error: unknown) {
      console.warn(
        `[REDIS LEASE ERROR] Failed to acquire host lease in room ${this.deps.roomId}`,
        error,
      );

      throw new HostTransitionUnavailableError();
    }

    if (!acquired) {
      throw new HostTransitionUnavailableError(
        "Unable to acquire the host transition lease.",
      );
    }

    try {
      return await action();
    } finally {
      try {
        const released = await redisCore.delLease(
          leaseKey,
          leaseVal,
        );

        if (!released) {
          console.warn(
            `[REDIS LEASE WARNING] Lease ownership changed before release for room ${this.deps.roomId}`,
          );
        }
      } catch (error: unknown) {
        console.warn(
          `[REDIS LEASE RELEASE ERROR] Failed to release host lease in room ${this.deps.roomId}`,
          error,
        );
      }
    }
  };

  public reclaimHostForOwner = async (ownerSocket: Socket): Promise<boolean> => {
    const ownerId = this.deps.getOwnerId();
    if (!ownerId || ownerSocket.uid !== ownerId) return false;
    if (this.currentHostClientId === ownerSocket.clientId && this.hostMode === "owner") {
      return true;
    }

    try {
      return await this.withHostTransitionLease(async () => {
        const previousHostClientId = this.currentHostClientId;
        this.hostEpoch += 1;
        this.currentHostClientId = ownerSocket.clientId;
        this.currentHostUid = ownerSocket.uid;
        const clientToUidMap = this.deps.getClientToUidMap();
        clientToUidMap[ownerSocket.clientId] = ownerSocket.uid;
        this.hostMode = "owner";

        this.broadcastHostChange("owner_regain");
        if (previousHostClientId && previousHostClientId !== ownerSocket.clientId) {
          const chatMsg = {
            id: ownerSocket.clientId,
            cmd: "system",
            msg: "The room creator has returned and resumed hosting.",
          };
          this.deps.addChatMessage(ownerSocket, chatMsg);
        }
        return true;
      });
    } catch (err: any) {
      console.warn(`[RECLAIM HOST WARNING] Failed to reclaim host in room ${this.deps.roomId}:`, err.message);
      return false;
    }
  };

  public transferHost = async (
    socket: Socket,
    targetClientId: string,
  ): Promise<{ success: boolean; error?: string }> => {
    const context = this.deps.buildAuthorizationContext(socket);
    const auth = pureAuthorizeRoomAction(context, "room:transfer_host");
    if (!auth.allowed) {
      socket.emit("CMD:error", { code: "FORBIDDEN" });
      return { success: false, error: "FORBIDDEN" };
    }
    if (!targetClientId) {
      return { success: false, error: "TARGET_REQUIRED" };
    }
    if (targetClientId === socket.clientId) {
      return { success: false, error: "CANNOT_TRANSFER_TO_SELF" };
    }
    if (!this.deps.isParticipantEligibleForHost(targetClientId)) {
      return { success: false, error: "TARGET_NOT_ELIGIBLE" };
    }

    return await this.withHostTransitionLease(async () => {
      // Re-verify under distributed lease
      if (!this.isHost(socket)) {
        return { success: false, error: "NOT_HOST" };
      }
      if (!this.deps.isParticipantEligibleForHost(targetClientId)) {
        return { success: false, error: "TARGET_NOT_ELIGIBLE" };
      }

      const previousHostName = this.getHostDisplayName();
      this.hostEpoch += 1;
      this.currentHostClientId = targetClientId;
      const clientToUidMap = this.deps.getClientToUidMap();
      this.currentHostUid = clientToUidMap[targetClientId] || "";
      this.hostMode = this.getHostMode();
      const newHostName = this.getHostDisplayName();

      this.broadcastHostChange("explicit_transfer");
      const chatMsg = {
        id: socket.clientId,
        cmd: "system",
        msg: `${previousHostName} transferred host authority to ${newHostName}.`,
      };
      this.deps.addChatMessage(socket, chatMsg);
      return { success: true };
    });
  };

  public assignHost = (socket: Socket, newHostClientId: string): boolean => {
    const auth = this.deps.authorizeRoomAction({
      actorSocket: socket,
      action: "room:transfer_host",
    });
    if (!auth.allowed) {
      socket.emit("CMD:error", { code: "FORBIDDEN" });
      socket.emit("errorMessage", "FORBIDDEN");
      return false;
    }
    this.transferHost(socket, newHostClientId).catch((err) => {
      socket.emit("errorMessage", err.message || "Failed to assign host.");
    });
    return true;
  };

  public handleHostDisconnect = async (departingClientId: string): Promise<void> => {
    const wasHost = Boolean(
      this.currentHostClientId && this.currentHostClientId === departingClientId,
    );
    if (!wasHost) return;

    try {
      await this.withHostTransitionLease(async () => {
        const eligible = this.deps.getEligibleParticipants(departingClientId);
        const clientToUidMap = this.deps.getClientToUidMap();
        if (eligible.length > 0) {
          // Deterministic lowest admissionSequence ASC
          const nextHost = eligible[0];
          const oldHostName = this.getHostDisplayName();
          this.hostEpoch += 1;
          this.currentHostClientId = nextHost.clientId;
          this.currentHostUid = clientToUidMap[nextHost.clientId] || "";
          this.hostMode = this.getHostMode();
          const newHostName = this.getHostDisplayName();

          this.broadcastHostChange("failover");
          const chatMsg = {
            id: nextHost.clientId,
            cmd: "system",
            msg: `${oldHostName} disconnected. ${newHostName} is now the temporary room host.`,
          };
          this.deps.addChatMessage(null, chatMsg);
        } else {
          // No eligible participants remaining
          this.hostEpoch += 1;
          this.currentHostClientId = "";
          this.currentHostUid = "";
          this.hostMode = "none";
          this.broadcastHostChange("room_empty");
        }
      });
    } catch (err: unknown) {
      console.error("Failed during host failover transition:", err);
    }
  };

  public handleInitialHost = async (socket: Socket, clientId: string): Promise<void> => {
    const ownerId = this.deps.getOwnerId();
    if (socket.uid && ownerId && socket.uid === ownerId) {
      await this.reclaimHostForOwner(socket);
    } else if (!this.currentHostUid && socket.uid) {
      this.currentHostUid = socket.uid;
      this.currentHostClientId = clientId;
    }
  };
}
