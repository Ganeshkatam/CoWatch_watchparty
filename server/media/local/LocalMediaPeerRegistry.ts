/**
 * LOCAL-MEDIA-001: Local Media Peer Registry & Failover Election
 * Tracks participant availability maps and handles host seed failover election.
 */

export interface PeerAvailabilityRecord {
  userId: string;
  peerId: string;
  socketId: string;
  roomId: string;
  mediaId?: string;
  epoch?: number;
  availableChunksCount: number;
  contiguousThrough: number;
  lastHeartbeat: number;
}

export const HEARTBEAT_TIMEOUT_MS = 15000;

export class LocalMediaPeerRegistry {
  private peers: Map<string, PeerAvailabilityRecord> = new Map();

  public registerPeer(roomId: string, userId: string, peerId: string, socketId: string): void {
    const existing = this.peers.get(peerId);
    this.peers.set(peerId, {
      userId,
      peerId,
      socketId,
      roomId,
      mediaId: existing?.mediaId,
      epoch: existing?.epoch,
      availableChunksCount: existing?.availableChunksCount ?? 0,
      contiguousThrough: existing?.contiguousThrough ?? 0,
      lastHeartbeat: Date.now(),
    });
  }

  public unregisterPeer(peerId: string, socketId?: string): boolean {
    const record = this.peers.get(peerId);
    if (!record) return false;
    // Stale socket protection: only unregister if socket matches or if socketId not specified
    if (socketId && record.socketId !== socketId) {
      return false;
    }
    this.peers.delete(peerId);
    return true;
  }

  public getPeer(peerId: string): PeerAvailabilityRecord | undefined {
    return this.peers.get(peerId);
  }

  public getPeerBySocketId(socketId: string): PeerAvailabilityRecord | undefined {
    for (const record of this.peers.values()) {
      if (record.socketId === socketId) return record;
    }
    return undefined;
  }

  public updateAvailability(
    peerId: string,
    mediaId: string,
    epoch: number,
    availableChunksCount: number,
    contiguousThrough: number
  ): boolean {
    const record = this.peers.get(peerId);
    if (!record) return false;
    record.mediaId = mediaId;
    record.epoch = epoch;
    record.availableChunksCount = availableChunksCount;
    record.contiguousThrough = contiguousThrough;
    record.lastHeartbeat = Date.now();
    return true;
  }

  public electFailoverSeed(params?: {
    excludeUserId?: string;
    excludePeerId?: string;
    targetRoomId?: string;
    targetMediaId?: string;
    targetEpoch?: number;
    now?: number;
  }): { userId: string; peerId: string; socketId: string } | null {
    const now = params?.now ?? Date.now();
    let bestCandidate: PeerAvailabilityRecord | null = null;

    for (const record of this.peers.values()) {
      // Exclude disconnecting owner / seed
      if (params?.excludeUserId && record.userId === params.excludeUserId) continue;
      if (params?.excludePeerId && record.peerId === params.excludePeerId) continue;

      // Filter by room
      if (params?.targetRoomId && record.roomId !== params.targetRoomId) continue;

      // Filter by mediaId & epoch if specified
      if (params?.targetMediaId && record.mediaId && record.mediaId !== params.targetMediaId) continue;
      if (params?.targetEpoch && record.epoch && record.epoch !== params.targetEpoch) continue;

      // Must possess chunks to be a viable seed
      if (record.availableChunksCount <= 0 || record.contiguousThrough < 0) continue;

      // Liveness heartbeat check
      if (now - record.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) continue;

      if (!bestCandidate) {
        bestCandidate = record;
      } else {
        // Deterministic candidate selection:
        // 1. Highest contiguous coverage
        if (record.contiguousThrough > bestCandidate.contiguousThrough) {
          bestCandidate = record;
        } else if (record.contiguousThrough === bestCandidate.contiguousThrough) {
          // 2. Highest available chunks count
          if (record.availableChunksCount > bestCandidate.availableChunksCount) {
            bestCandidate = record;
          } else if (record.availableChunksCount === bestCandidate.availableChunksCount) {
            // 3. Deterministic canonical tie-break on userId (alphabetical)
            if (record.userId < bestCandidate.userId) {
              bestCandidate = record;
            }
          }
        }
      }
    }

    return bestCandidate ? { userId: bestCandidate.userId, peerId: bestCandidate.peerId, socketId: bestCandidate.socketId } : null;
  }

  public getPeerCount(): number {
    return this.peers.size;
  }

  public clear(): void {
    this.peers.clear();
  }
}
