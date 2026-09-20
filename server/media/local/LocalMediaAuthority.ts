/**
 * LOCAL-MEDIA-001: Local Media Authority Server Manager
 * Authoritative controller for room-scoped local media sessions, failover, and lifecycle reconciliation.
 */

import type { Pool } from "pg";
import type { DatabasePool } from "../../db.ts";
import { LocalMediaPeerRegistry } from "./LocalMediaPeerRegistry.ts";
import { LocalMediaSession, type ServerLocalMediaManifest } from "./LocalMediaSession.ts";
import { LocalMediaSignaling, type SignalMessagePayload } from "./LocalMediaSignaling.ts";

function toUuid(id: string): string {
  if (!id) return "00000000-0000-4000-a000-000000000000";
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(id)) return id;
  let hash1 = 0x811c9dc5;
  let hash2 = 0xcbf29ce4;
  for (let i = 0; i < id.length; i++) {
    const code = id.charCodeAt(i);
    hash1 = Math.imul(hash1 ^ code, 0x01000193);
    hash2 = Math.imul(hash2 ^ code, 0x5bd1e995);
  }
  const h1 = (hash1 >>> 0).toString(16).padStart(8, "0");
  const h2 = (hash2 >>> 0).toString(16).padStart(8, "0");
  const h3 = ((hash1 ^ hash2) >>> 0).toString(16).padStart(8, "0");
  const h4 = (((hash1 * 31) ^ (hash2 * 17)) >>> 0).toString(16).padStart(8, "0");
  const raw = `${h1}${h2}${h3}${h4}`;
  return `${raw.substring(0, 8)}-${raw.substring(8, 12)}-4${raw.substring(13, 16)}-a${raw.substring(17, 20)}-${raw.substring(20, 32)}`;
}

export class LocalMediaAuthority {
  private db: DatabasePool | Pool | null;
  private signaling: LocalMediaSignaling;
  private sessions: Map<string, LocalMediaSession> = new Map();
  private registries: Map<string, LocalMediaPeerRegistry> = new Map();

  constructor(db: DatabasePool | Pool | null | undefined, signaling: LocalMediaSignaling) {
    this.db = db || null;
    this.signaling = signaling;
  }

  public async announceSession(
    roomId: string,
    userId: string,
    isHost: boolean,
    manifest: ServerLocalMediaManifest
  ): Promise<LocalMediaSession | null> {
    if (!isHost) {
      console.warn(`Non-host ${userId} attempted to announce local media session in room ${roomId}`);
      return null;
    }

    const contentFingerprint =
      manifest.contentFingerprint ||
      (typeof (manifest as any).contentHash === "string" ? (manifest as any).contentHash.trim() : "") ||
      "";
    manifest.contentFingerprint = contentFingerprint;
    manifest.ownerId = userId;
    delete (manifest as any).contentHash;

    const session = new LocalMediaSession(manifest);
    this.sessions.set(roomId, session);

    let registry = this.registries.get(roomId);
    if (!registry) {
      registry = new LocalMediaPeerRegistry();
      this.registries.set(roomId, registry);
    }
    registry.clear();

    if (this.db) {
      try {
        const validMediaId = toUuid(manifest.mediaId);
        const validOwnerId = toUuid(userId || manifest.ownerId);

        await (this.db as any).query(
          `INSERT INTO public.room_media_sessions (
            media_id, room_id, owner_user_id, status, filename, mime_type, byte_size,
            duration_seconds, codec, container, content_hash, chunk_size, total_chunks
          ) VALUES (
            $1, $2, $3, 'ACTIVE', $4, $5, $6, $7, $8, $9, $10, $11, $12
          ) ON CONFLICT (media_id) DO UPDATE SET
            status = 'ACTIVE'`,
          [
            validMediaId,
            roomId,
            validOwnerId,
            manifest.filename,
            manifest.mimeType,
            manifest.byteLength,
            manifest.durationSeconds || 0,
            manifest.codec || "",
            manifest.container || "mp4",
            manifest.contentFingerprint,
            manifest.chunkSize,
            manifest.totalChunks,
          ]
        );
      } catch (err) {
        console.warn(`Failed to persist room_media_session to DB for room ${roomId}:`, err);
      }
    }

    this.signaling.broadcastSession(roomId, manifest);
    return session;
  }

  public handleSignalRelay(
    socket: any,
    targetSocketId: string,
    payload: SignalMessagePayload,
    mediaId?: string
  ): boolean {
    const session = this.sessions.get(payload.roomId);
    if (!session || session.status !== "ACTIVE") {
      return false;
    }

    // Media and epoch integrity validation
    if (mediaId && mediaId !== session.mediaId) {
      return false;
    }
    if (payload.epoch !== session.epoch) {
      return false;
    }

    return this.signaling.relaySignal(socket, targetSocketId, payload);
  }

  public registerPeer(roomId: string, userId: string, peerId: string, socketId: string): void {
    let registry = this.registries.get(roomId);
    if (!registry) {
      registry = new LocalMediaPeerRegistry();
      this.registries.set(roomId, registry);
    }
    registry.registerPeer(roomId, userId, peerId, socketId);

    const session = this.sessions.get(roomId);
    if (session && session.isActive() && session.ownerId !== userId) {
      this.signaling.sendSessionToSocket(socketId, session.manifest);
    }
  }

  public unregisterPeer(roomId: string, peerId: string, socketId?: string): void {
    const registry = this.registries.get(roomId);
    if (!registry) return;

    const existingPeer = registry.getPeer(peerId);
    if (!existingPeer) return;

    const wasRemoved = registry.unregisterPeer(peerId, socketId);
    if (!wasRemoved) return; // Stale socket disconnect ignored

    const session = this.sessions.get(roomId);
    if (session && session.isActive() && session.ownerId === existingPeer.userId) {
      this.handleHostDisconnect(roomId);
    }
  }

  public updatePeerAvailability(
    roomId: string,
    peerId: string,
    mediaId: string,
    epoch: number,
    availableChunksCount: number,
    contiguousThrough: number
  ): boolean {
    const session = this.sessions.get(roomId);
    if (!session || !session.isActive()) {
      return false;
    }

    // Must match active session media and epoch
    if (session.mediaId !== mediaId || session.epoch !== epoch) {
      return false;
    }

    // Structural counter bounds validation
    const total = session.manifest.totalChunks;
    if (
      !Number.isSafeInteger(availableChunksCount) ||
      availableChunksCount < 0 ||
      availableChunksCount > total
    ) {
      return false;
    }

    if (
      !Number.isSafeInteger(contiguousThrough) ||
      contiguousThrough < -1 ||
      contiguousThrough >= total
    ) {
      return false;
    }

    const registry = this.registries.get(roomId);
    if (!registry) return false;

    return registry.updateAvailability(peerId, mediaId, epoch, availableChunksCount, contiguousThrough);
  }

  public handleHostDisconnect(roomId: string): boolean {
    const session = this.sessions.get(roomId);
    const registry = this.registries.get(roomId);
    if (!session || !registry || !session.isActive()) return false;

    const candidate = registry.electFailoverSeed({
      excludeUserId: session.ownerId,
      targetRoomId: roomId,
      targetMediaId: session.mediaId,
      targetEpoch: session.epoch,
    });

    if (candidate) {
      session.promoteFailoverSeed(candidate.userId);
      this.signaling.broadcastSession(roomId, session.manifest);
      return true;
    } else {
      session.terminate();
      this.signaling.broadcastUnavailable(roomId, session.mediaId);
      return false;
    }
  }

  public getSession(roomId: string): LocalMediaSession | null {
    return this.sessions.get(roomId) || null;
  }

  public getRegistry(roomId: string): LocalMediaPeerRegistry | null {
    return this.registries.get(roomId) || null;
  }

  public terminateSession(roomId: string): void {
    const session = this.sessions.get(roomId);
    if (session) {
      session.terminate();
      this.sessions.delete(roomId);
    }
    this.registries.delete(roomId);
  }
}
