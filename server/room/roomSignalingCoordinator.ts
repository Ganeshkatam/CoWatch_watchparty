import { randomUUID } from "crypto";
import type { Server, Socket } from "socket.io";
import config from "../config.ts";
import { redisCount } from "../utils/redis.ts";
import { postgres } from "../utils/postgres.ts";
import {
  authorizeRoomAction as pureAuthorizeRoomAction,
  type AuthorizationContext,
} from "../roomAuthorization.ts";
import { LocalMediaAuthority } from "../media/local/LocalMediaAuthority.ts";
import { LocalMediaSignaling } from "../media/local/LocalMediaSignaling.ts";
import type { ServerLocalMediaManifest } from "../media/local/LocalMediaSession.ts";

export interface RoomSignalingOptions {
  roomId: string;
  io: Server;
  socketIdMap: StringDict;
  roster: User[];
  localMediaAuthority?: LocalMediaAuthority;
  postgres?: any;
  getRosterForApp: () => User[];
  setMediaSource: (socket: Socket | null, mediaUrl: string) => void;
  buildAuthorizationContext: (socket: Socket) => AuthorizationContext;
}

export class RoomSignalingCoordinator {
  private readonly options: RoomSignalingOptions;
  public readonly localMediaAuthority: LocalMediaAuthority;

  public constructor(options: RoomSignalingOptions) {
    this.options = options;
    this.localMediaAuthority =
      options.localMediaAuthority ??
      new LocalMediaAuthority(
        options.postgres ?? postgres,
        new LocalMediaSignaling(options.io.of(options.roomId)),
      );
  }

  public sendSignal = (
    socket: Socket,
    raw: unknown,
    eventName: "signal" | "signalSS",
  ): void => {
    const data = raw as { to: string; msg: string; sharer?: boolean };
    if (!data || typeof data.to !== "string" || !data.msg) {
      return;
    }
    const fromClientId = socket.clientId;
    if (!fromClientId) {
      return;
    }
    const isSenderInRoster = this.options.roster.some((user) => user.id === fromClientId);
    const isTargetInRoster = this.options.roster.some((user) => user.id === data.to);
    if (!isSenderInRoster || !isTargetInRoster) {
      return;
    }
    const toId = this.options.socketIdMap[data.to];
    if (toId) {
      this.options.io.of(this.options.roomId).to(toId).emit(eventName, {
        from: fromClientId,
        msg: data.msg,
        sharer: data.sharer,
      });
    }
  };

  public joinVideo = async (socket: Socket): Promise<void> => {
    const match = this.options.roster.find((user) => user.id === socket.clientId);
    if (match) {
      match.isVideoChat = true;
      redisCount("videoChatStarts");
    }
    this.options.io.of(this.options.roomId).emit("roster", this.options.getRosterForApp());
  };

  public leaveVideo = async (socket: Socket): Promise<void> => {
    const match = this.options.roster.find((user) => user.id === socket.clientId);
    if (match) {
      match.isVideoChat = false;
    }
    this.options.io.of(this.options.roomId).emit("roster", this.options.getRosterForApp());
  };

  public setUserMute = (socket: Socket, raw: unknown): void => {
    const data = raw as { isMuted: boolean };
    if (!data) {
      return;
    }
    const match = this.options.roster.find((user) => user.id === socket.clientId);
    if (match) {
      match.isMuted = data.isMuted;
    }
    this.options.io.of(this.options.roomId).emit("roster", this.options.getRosterForApp());
  };

  public joinScreenSharing = (socket: Socket, raw: unknown): void => {
    const data = raw as { file: boolean; mediasoup?: boolean };
    if (!data) {
      return;
    }
    const sharer = this.options.getRosterForApp().find((user) => user.isScreenShare);
    if (sharer) {
      socket.emit(
        "errorMessage",
        "There is already an active share in this room",
      );
      return;
    }
    let mediasoupSuffix = "";
    if (data?.mediasoup) {
      mediasoupSuffix =
        "@" + config.MEDIASOUP_SERVER + "/" + randomUUID();
      redisCount("mediasoupStarts");
    }
    if (data && data.file) {
      this.options.setMediaSource(socket, "fileshare://" + socket.clientId + mediasoupSuffix);
      redisCount("fileShareStarts");
    } else {
      this.options.setMediaSource(
        socket,
        "screenshare://" + socket.clientId + mediasoupSuffix,
      );
      redisCount("screenShareStarts");
    }
    this.options.io.of(this.options.roomId).emit("roster", this.options.getRosterForApp());
  };

  public leaveScreenSharing = (socket: Socket): void => {
    const sharer = this.options.getRosterForApp().find((user) => user.isScreenShare);
    if (!sharer || sharer?.id !== socket.clientId) {
      socket.emit("errorMessage", "Not the active sharer");
      return;
    }
    this.options.setMediaSource(socket, "");
    this.options.io.of(this.options.roomId).emit("roster", this.options.getRosterForApp());
  };

  public handleLocalMediaAnnounce = async (
    socket: Socket,
    data: { roomId: string; manifest: ServerLocalMediaManifest },
  ): Promise<void> => {
    const context = this.options.buildAuthorizationContext(socket);
    const auth = pureAuthorizeRoomAction(context, "room:set_media");
    if (!auth.allowed) {
      socket.emit("CMD:error", { code: "FORBIDDEN" });
      return;
    }
    const userId = socket.uid || socket.clientId;
    const session = await this.localMediaAuthority.announceSession(
      this.options.roomId,
      userId,
      auth.allowed,
      data?.manifest,
    );
    if (session) {
      this.options.setMediaSource(socket, "localmedia://" + data.manifest.mediaId);
    }
  };

  public handleLocalMediaSignal = (socket: Socket, data: any): void => {
    if (!data || typeof data !== "object") return;

    const senderPeerId = socket.clientId;
    const targetPeerId = data.toPeerId;
    if (!targetPeerId || typeof targetPeerId !== "string") return;

    const targetSocketId = this.options.socketIdMap[targetPeerId];
    if (!targetSocketId) return;

    const targetSocket = this.options.io.of(this.options.roomId).sockets.get(targetSocketId);
    if (!targetSocket) return;

    const relayPayload = {
      roomId: this.options.roomId,
      fromPeerId: senderPeerId,
      toPeerId: targetPeerId,
      signal: data.signal,
      epoch: typeof data.epoch === "number" ? data.epoch : 1,
    };

    this.localMediaAuthority.handleSignalRelay(
      socket,
      targetSocketId,
      relayPayload,
      data.mediaId,
    );
  };

  public handleLocalMediaAvailability = (socket: Socket, data: any): void => {
    if (!data || typeof data !== "object") return;
    const { mediaId, epoch, availableChunksCount, contiguousThrough } = data;
    if (!mediaId || typeof mediaId !== "string" || typeof epoch !== "number") return;

    this.localMediaAuthority.updatePeerAvailability(
      this.options.roomId,
      socket.clientId,
      mediaId,
      epoch,
      availableChunksCount,
      contiguousThrough,
    );
  };

  public registerPeer = (clientId: string, userId: string, socketId: string): void => {
    this.localMediaAuthority.registerPeer(this.options.roomId, userId, clientId, socketId);
  };

  public unregisterPeer = (clientId: string, socketId: string): void => {
    this.localMediaAuthority.unregisterPeer(this.options.roomId, clientId, socketId);
  };

  public terminateSession = (): void => {
    this.localMediaAuthority.terminateSession(this.options.roomId);
  };
}
