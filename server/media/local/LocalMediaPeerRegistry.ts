/**
 * LOCAL-MEDIA-001: Local Media Peer Registry & Failover Election
 * Tracks participant availability maps and handles host seed failover election.
 */

export interface PeerAvailabilityRecord {
  peerId: string;
  socketId: string;
  availableChunksCount: number;
  contiguousThrough: number;
  lastHeartbeat: number;
}

export class LocalMediaPeerRegistry {
  private peers: Map<string, PeerAvailabilityRecord> = new Map();

  public registerPeer(peerId: string, socketId: string): void {
    const existing = this.peers.get(peerId);
    this.peers.set(peerId, {
      peerId,
      socketId,
      availableChunksCount: existing?.availableChunksCount ?? 0,
      contiguousThrough: existing?.contiguousThrough ?? 0,
      lastHeartbeat: Date.now(),
    });
  }

  public unregisterPeer(peerId: string): void {
    this.peers.delete(peerId);
  }

  public updateAvailability(peerId: string, availableChunksCount: number, contiguousThrough: number): void {
    const record = this.peers.get(peerId);
    if (record) {
      record.availableChunksCount = availableChunksCount;
      record.contiguousThrough = contiguousThrough;
      record.lastHeartbeat = Date.now();
    }
  }

  public electFailoverSeed(excludePeerId?: string): string | null {
    let bestCandidate: PeerAvailabilityRecord | null = null;

    for (const [id, record] of this.peers.entries()) {
      if (excludePeerId && id === excludePeerId) continue;
      if (record.availableChunksCount <= 0) continue; // Must possess chunks to be a viable seed

      if (!bestCandidate) {
        bestCandidate = record;
      } else {
        // Prioritize highest contiguous coverage, then total count
        if (record.contiguousThrough > bestCandidate.contiguousThrough) {
          bestCandidate = record;
        } else if (
          record.contiguousThrough === bestCandidate.contiguousThrough &&
          record.availableChunksCount > bestCandidate.availableChunksCount
        ) {
          bestCandidate = record;
        }
      }
    }

    return bestCandidate ? bestCandidate.peerId : null;
  }

  public getPeerCount(): number {
    return this.peers.size;
  }

  public clear(): void {
    this.peers.clear();
  }
}
