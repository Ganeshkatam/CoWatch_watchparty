/**
 * LOCAL-MEDIA-001: Local Media Signaling Coordinator
 * Relays WebRTC SDP offers/answers and ICE candidates securely between room participants.
 */

import { Server, Socket } from "socket.io";

export interface SignalMessagePayload {
  roomId: string;
  fromPeerId: string;
  toPeerId: string;
  signal: any;
  epoch: number;
}

export class LocalMediaSignaling {
  private io: Server;

  constructor(io: Server) {
    this.io = io;
  }

  public relaySignal(
    socket: Socket,
    targetSocketId: string,
    payload: SignalMessagePayload
  ): boolean {
    if (!targetSocketId) return false;

    const ns = typeof this.io.of === "function" ? this.io.of(payload.roomId) : this.io;
    ns.to(targetSocketId).emit("LOCAL_MEDIA_SIGNAL", {
      fromPeerId: payload.fromPeerId,
      toPeerId: payload.toPeerId,
      signal: payload.signal,
      epoch: payload.epoch,
    });

    return true;
  }

  public broadcastSession(roomId: string, manifest: any): void {
    if (typeof this.io.of === "function") {
      this.io.of(roomId).emit("LOCAL_MEDIA_ANNOUNCE", {
        manifest,
      });
    } else {
      this.io.to(roomId).emit("LOCAL_MEDIA_ANNOUNCE", {
        manifest,
      });
    }
  }

  public broadcastUnavailable(roomId: string, mediaId: string): void {
    if (typeof this.io.of === "function") {
      this.io.of(roomId).emit("LOCAL_MEDIA_UNAVAILABLE", {
        mediaId,
      });
    } else {
      this.io.to(roomId).emit("LOCAL_MEDIA_UNAVAILABLE", {
        mediaId,
      });
    }
  }
}
