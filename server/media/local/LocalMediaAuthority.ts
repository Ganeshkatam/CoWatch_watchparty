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
    actorId: string,
    isHost: boolean,
    manifest: ServerLocalMediaManifest
  ): Promise<LocalMediaSession | null> {
    if (!isHost) {
      console.warn(`Non-host ${actorId} attempted to announce local media session in room ${roomId}`);
      return null;
    }

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
        const validOwnerId = toUuid(actorId || manifest.ownerId);

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
            manifest.contentFingerprint || manifest.contentHash || "",
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
    payload: SignalMessagePayload
  ): boolean {
    const session = this.sessions.get(payload.roomId);
    if (!session || session.status !== "ACTIVE") {
      return false;
    }
    return this.signaling.relaySignal(socket, targetSocketId, payload);
  }

  public registerPeer(roomId: string, peerId: string, socketId: string): void {
    let registry = this.registries.get(roomId);
    if (!registry) {
      registry = new LocalMediaPeerRegistry();
      this.registries.set(roomId, registry);
    }
    registry.registerPeer(peerId, socketId);

    const session = this.sessions.get(roomId);
    if (session && session.isActive() && session.ownerId !== peerId) {
      this.signaling.sendSessionToSocket(socketId, session.manifest);
    }
  }

  public unregisterPeer(roomId: string, peerId: string): void {
    const registry = this.registries.get(roomId);
    if (registry) {
      registry.unregisterPeer(peerId);
    }

    const session = this.sessions.get(roomId);
    if (session && session.ownerId === peerId) {
      this.handleHostDisconnect(roomId);
    }
  }

  private handleHostDisconnect(roomId: string): void {
    const session = this.sessions.get(roomId);
    const registry = this.registries.get(roomId);
    if (!session || !registry) return;

    const newSeedId = registry.electFailoverSeed(session.ownerId);
    if (newSeedId) {
      session.updateOwner(newSeedId);
      session.incrementEpoch();
      this.signaling.broadcastSession(roomId, session.manifest);
    } else {
      session.terminate();
      this.signaling.broadcastUnavailable(roomId, session.mediaId);
    }
  }

  public getSession(roomId: string): LocalMediaSession | null {
    return this.sessions.get(roomId) || null;
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
