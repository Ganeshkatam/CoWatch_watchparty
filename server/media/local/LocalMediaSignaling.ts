/**
 * LOCAL-MEDIA-001: Local Media Signaling Coordinator
 * Relays WebRTC SDP offers/answers and ICE candidates securely between room participants.
 */

import type { Namespace, Server, Socket } from "socket.io";
import type { ServerLocalMediaManifest } from "./LocalMediaSession.ts";

export interface SignalMessagePayload {
  roomId: string;
  fromPeerId: string;
  toPeerId: string;
  signal: unknown;
  epoch: number;
}

export interface SignalingSocketContext {
  id?: string;
  uid?: string;
}

export class LocalMediaSignaling {
  private io: Namespace | Server;

  constructor(io: Namespace | Server) {
    this.io = io;
  }

  public relaySignal(
    _socket: Socket | SignalingSocketContext | null | undefined,
    targetSocketId: string,
    payload: SignalMessagePayload
  ): boolean {
    if (!targetSocketId) return false;

    this.io.to(targetSocketId).emit("LOCAL_MEDIA_SIGNAL", {
      fromPeerId: payload.fromPeerId,
      toPeerId: payload.toPeerId,
      signal: payload.signal,
      epoch: payload.epoch,
    });

    return true;
  }

  public broadcastSession(roomId: string, manifest: ServerLocalMediaManifest): void {
    if ("to" in this.io && typeof (this.io as { to: unknown }).to === "function") {
      this.io.to(roomId).emit("LOCAL_MEDIA_ANNOUNCE", {
        manifest,
      });
    } else {
      this.io.emit("LOCAL_MEDIA_ANNOUNCE", {
        manifest,
      });
    }
  }

  public broadcastUnavailable(roomId: string, mediaId: string): void {
    if ("to" in this.io && typeof (this.io as { to: unknown }).to === "function") {
      this.io.to(roomId).emit("LOCAL_MEDIA_UNAVAILABLE", {
        mediaId,
      });
    } else {
      this.io.emit("LOCAL_MEDIA_UNAVAILABLE", {
        mediaId,
      });
    }
  }

  public sendSessionToSocket(targetSocketId: string, manifest: ServerLocalMediaManifest): void {
    if (!targetSocketId) return;
    this.io.to(targetSocketId).emit("LOCAL_MEDIA_ANNOUNCE", {
      manifest,
    });
  }
}
