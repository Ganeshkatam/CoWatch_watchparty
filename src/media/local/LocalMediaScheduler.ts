/**
 * LOCAL-MEDIA-001: Local Media Chunk Scheduler
 * Intelligently prioritizes and dispatches chunk requests across P2P peers based on playback position and seeking.
 */

import { LocalMediaCache } from "./LocalMediaCache";
import { LocalMediaManifest } from "./LocalMediaManifest";
import { LocalMediaPeer } from "./LocalMediaPeer";

export class LocalMediaScheduler {
  private manifest: LocalMediaManifest;
  private cache: LocalMediaCache;
  private peers: Map<string, LocalMediaPeer>;
  private peerAvailability: Map<string, Set<number>>;
  private inFlightRequests: Map<number, { peerId: string; timestamp: number }>;
  private readonly BUFFER_FORWARD_CHUNKS = 20; // ~2.5MB ahead
  private readonly REQUEST_TIMEOUT_MS = 4000;

  constructor(manifest: LocalMediaManifest, cache: LocalMediaCache) {
    this.manifest = manifest;
    this.cache = cache;
    this.peers = new Map();
    this.peerAvailability = new Map();
    this.inFlightRequests = new Map();
  }

  public registerPeer(peer: LocalMediaPeer): void {
    this.peers.set(peer.peerId, peer);
    if (!this.peerAvailability.has(peer.peerId)) {
      this.peerAvailability.set(peer.peerId, new Set());
    }
  }

  public unregisterPeer(peerId: string): void {
    this.peers.delete(peerId);
    this.peerAvailability.delete(peerId);

    // Cancel in-flight requests assigned to this peer
    for (const [chunkIdx, req] of this.inFlightRequests.entries()) {
      if (req.peerId === peerId) {
        this.inFlightRequests.delete(chunkIdx);
      }
    }
  }

  public updatePeerAvailability(peerId: string, availableChunks: number[]): void {
    const set = this.peerAvailability.get(peerId) || new Set();
    for (const chunk of availableChunks) {
      set.add(chunk);
    }
    this.peerAvailability.set(peerId, set);
  }

  public calculateCurrentChunkIndex(currentSeconds: number): number {
    if (this.manifest.durationSeconds <= 0 || this.manifest.totalChunks <= 0) {
      return 0;
    }
    const ratio = Math.min(1, Math.max(0, currentSeconds / this.manifest.durationSeconds));
    const targetChunk = Math.floor(ratio * this.manifest.totalChunks);
    return Math.min(this.manifest.totalChunks - 1, Math.max(0, targetChunk));
  }

  public schedule(currentPlaybackSeconds: number): void {
    this.cleanupTimeouts();

    const targetChunk = this.calculateCurrentChunkIndex(currentPlaybackSeconds);
    const neededChunks: number[] = [];

    // 1. Critical Init Segments (Chunks 0, 1)
    if (!this.cache.hasChunk(0)) neededChunks.push(0);
    if (this.manifest.totalChunks > 1 && !this.cache.hasChunk(1)) neededChunks.push(1);

    // 2. Playback Forward Window
    const endChunk = Math.min(this.manifest.totalChunks, targetChunk + this.BUFFER_FORWARD_CHUNKS);
    for (let i = targetChunk; i < endChunk; i++) {
      if (!this.cache.hasChunk(i) && !neededChunks.includes(i)) {
        neededChunks.push(i);
      }
    }

    // Filter out already in-flight requests
    const unrequested = neededChunks.filter((idx) => !this.inFlightRequests.has(idx));

    // Dispatch requests across peers
    for (const chunkIdx of unrequested) {
      const selectedPeer = this.selectBestPeerForChunk(chunkIdx);
      if (selectedPeer) {
        selectedPeer.requestChunks(this.manifest.mediaId, this.manifest.epoch, [chunkIdx]);
        this.inFlightRequests.set(chunkIdx, {
          peerId: selectedPeer.peerId,
          timestamp: Date.now(),
        });
      }
    }
  }

  public onChunkReceived(chunkIndex: number): void {
    this.inFlightRequests.delete(chunkIndex);
  }

  private selectBestPeerForChunk(chunkIndex: number): LocalMediaPeer | null {
    const candidatePeers: LocalMediaPeer[] = [];

    for (const [peerId, peer] of this.peers.entries()) {
      if (!peer.isReady()) continue;
      const availability = this.peerAvailability.get(peerId);
      // If peer reported availability, verify they have it (or if no availability map, assume seed has all)
      if (!availability || availability.size === 0 || availability.has(chunkIndex)) {
        candidatePeers.push(peer);
      }
    }

    if (candidatePeers.length === 0) return null;

    // Pick peer with lowest bufferedAmount / workload
    candidatePeers.sort((a, b) => a.getBufferedAmount() - b.getBufferedAmount());
    return candidatePeers[0];
  }

  private cleanupTimeouts(): void {
    const now = Date.now();
    for (const [chunkIdx, req] of this.inFlightRequests.entries()) {
      if (now - req.timestamp > this.REQUEST_TIMEOUT_MS) {
        this.inFlightRequests.delete(chunkIdx);
      }
    }
  }

  public getInFlightCount(): number {
    return this.inFlightRequests.size;
  }
}
