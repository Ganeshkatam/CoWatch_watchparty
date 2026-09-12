/**
 * LOCAL-MEDIA-001: Local Media Coordinator
 * Unified client coordinator integrating file chunking, WebRTC mesh peers, MSE playback, and MEDIA-SYNC-001 authority.
 */

import { Socket } from "socket.io-client";
import { LocalMediaCache } from "./LocalMediaCache";
import { LocalMediaChunker } from "./LocalMediaChunker";
import { LocalMediaManifest, validateLocalMediaManifest } from "./LocalMediaManifest";
import { LocalMediaPeer } from "./LocalMediaPeer";
import { LocalMediaScheduler } from "./LocalMediaScheduler";
import { LocalMediaSource } from "./LocalMediaSource";

export type LocalMediaRole = "HOST_SEED" | "PARTICIPANT_PEER" | "IDLE";

export interface LocalMediaState {
  role: LocalMediaRole;
  manifest: LocalMediaManifest | null;
  objectUrl: string | null;
  bufferedPercent: number;
  inFlightRequests: number;
  peersCount: number;
  isReady: boolean;
}

export class LocalMediaCoordinator {
  private socket: Socket;
  private roomId: string;
  private userId: string;
  private role: LocalMediaRole = "IDLE";
  private chunker: LocalMediaChunker | null = null;
  private cache: LocalMediaCache | null = null;
  private scheduler: LocalMediaScheduler | null = null;
  private mediaSource: LocalMediaSource | null = null;
  private peers: Map<string, LocalMediaPeer> = new Map();
  private manifest: LocalMediaManifest | null = null;
  private objectUrl: string | null = null;
  private scheduleTimer: any = null;
  private onStateChange?: (state: LocalMediaState) => void;

  constructor(socket: Socket, roomId: string, userId: string, onStateChange?: (state: LocalMediaState) => void) {
    this.socket = socket;
    this.roomId = roomId;
    this.userId = userId;
    this.onStateChange = onStateChange;

    this.setupSocketListeners();
  }

  private setupSocketListeners(): void {
    // 1. Session announcement received from server
    this.socket.on("LOCAL_MEDIA_ANNOUNCE", (data: { manifest: LocalMediaManifest }) => {
      if (validateLocalMediaManifest(data.manifest) && data.manifest.roomId === this.roomId) {
        if (this.role !== "HOST_SEED") {
          this.handleParticipantManifest(data.manifest);
        }
      }
    });

    // 2. WebRTC Peer Signaling
    this.socket.on(
      "LOCAL_MEDIA_SIGNAL",
      async (data: { fromPeerId: string; toPeerId: string; signal: any; epoch: number }) => {
        if (data.toPeerId === this.userId) {
          let peer = this.peers.get(data.fromPeerId);
          if (!peer) {
            peer = this.createPeer(data.fromPeerId, false);
          }
          await peer.handleSignal(data.signal);
        }
      }
    );

    // 3. Session termination or unavailable
    this.socket.on("LOCAL_MEDIA_UNAVAILABLE", () => {
      this.reset();
    });
  }

  public async selectLocalFile(file: File): Promise<string> {
    this.reset();
    this.role = "HOST_SEED";

    // 1. Initialize Chunker
    this.chunker = new LocalMediaChunker(file, {
      filename: file.name,
      chunkSize: 131072, // 128KB
    });

    this.manifest = this.chunker.getManifest(this.roomId, this.userId);

    // 2. Host directly creates an Object URL from local file for instant zero-copy playback
    this.objectUrl = URL.createObjectURL(file);

    // 3. Cache all host chunks for seeding to peers
    this.cache = new LocalMediaCache(this.manifest, this.manifest.totalChunks);
    for (let i = 0; i < this.manifest.totalChunks; i++) {
      const chunk = await this.chunker.getChunk(i);
      if (chunk) {
        this.cache.putChunk(i, chunk.data);
      }
    }

    // 4. Announce manifest to server & room participants
    this.socket.emit("CMD_LOCAL_MEDIA_ANNOUNCE", {
      roomId: this.roomId,
      manifest: this.manifest,
    });

    this.notifyState();
    return this.objectUrl;
  }

  public async handleParticipantManifest(manifest: LocalMediaManifest): Promise<string | null> {
    this.reset();
    this.role = "PARTICIPANT_PEER";
    this.manifest = manifest;

    // 1. Initialize Cache & Scheduler
    this.cache = new LocalMediaCache(this.manifest);
    this.scheduler = new LocalMediaScheduler(this.manifest, this.cache);

    // 2. Initialize MediaSource MSE pipeline
    this.mediaSource = new LocalMediaSource(this.manifest, this.cache);
    this.objectUrl = await this.mediaSource.initialize({
      onReady: () => {
        this.notifyState();
      },
      onError: (err) => {
        console.warn("LocalMediaSource error:", err);
      },
    });

    // 3. Start periodic scheduler loop (every 250ms)
    this.startSchedulerLoop();

    // 4. Connect to host seed
    if (manifest.ownerId && manifest.ownerId !== this.userId) {
      const peer = this.createPeer(manifest.ownerId, true);
      await peer.startNegotiation();
    }

    this.notifyState();
    return this.objectUrl;
  }

  private createPeer(targetPeerId: string, isInitiator: boolean): LocalMediaPeer {
    const peer = new LocalMediaPeer(
      targetPeerId,
      isInitiator,
      (signalData) => {
        this.socket.emit("CMD_LOCAL_MEDIA_SIGNAL", {
          roomId: this.roomId,
          fromPeerId: this.userId,
          toPeerId: targetPeerId,
          signal: signalData,
          epoch: this.manifest?.epoch ?? 1,
        });
      },
      {
        onChunkReceived: (chunkIndex, data) => {
          this.handleChunkReceived(chunkIndex, data);
        },
        onChunkRequested: (requesterId, chunkIndices) => {
          this.handleChunkRequested(requesterId, chunkIndices);
        },
        onAvailabilityReceived: (senderId, availableChunks) => {
          this.scheduler?.updatePeerAvailability(senderId, availableChunks);
        },
      }
    );

    this.peers.set(targetPeerId, peer);
    this.scheduler?.registerPeer(peer);
    return peer;
  }

  private handleChunkReceived(chunkIndex: number, data: Uint8Array): void {
    if (!this.cache || !this.manifest) return;

    this.cache.putChunk(chunkIndex, data);
    this.scheduler?.onChunkReceived(chunkIndex);

    // Feed MSE buffer
    this.mediaSource?.pumpAvailableChunks();

    // Broadcast our updated availability to all connected peers for mesh relay
    const available = this.cache.getAvailableChunks();
    for (const peer of this.peers.values()) {
      peer.broadcastAvailability(this.manifest.mediaId, this.manifest.epoch, available);
    }

    this.notifyState();
  }

  private handleChunkRequested(requesterId: string, chunkIndices: number[]): void {
    const peer = this.peers.get(requesterId);
    if (!peer || !this.cache) return;

    for (const idx of chunkIndices) {
      const chunkData = this.cache.getChunk(idx);
      if (chunkData) {
        const sent = peer.sendChunk(idx, chunkData);
        if (!sent) break; // Backpressure reached
      }
    }
  }

  private startSchedulerLoop(): void {
    if (this.scheduleTimer) clearInterval(this.scheduleTimer);
    this.scheduleTimer = setInterval(() => {
      if (this.scheduler && this.manifest) {
        // Query current leader time from player if attached, otherwise start from 0
        this.scheduler.schedule(0);
      }
    }, 250);
  }

  public notifyTimelineTick(currentSeconds: number): void {
    if (this.scheduler && this.role === "PARTICIPANT_PEER") {
      this.scheduler.schedule(currentSeconds);
    }
  }

  public getState(): LocalMediaState {
    const total = this.manifest?.totalChunks || 1;
    const available = this.cache?.getAvailableChunks().length || 0;
    const bufferedPercent = Math.min(100, Math.round((available / total) * 100));

    return {
      role: this.role,
      manifest: this.manifest,
      objectUrl: this.objectUrl,
      bufferedPercent,
      inFlightRequests: this.scheduler?.getInFlightCount() ?? 0,
      peersCount: this.peers.size,
      isReady: this.role === "HOST_SEED" ? !!this.objectUrl : (this.mediaSource?.isReady() ?? false),
    };
  }

  private notifyState(): void {
    this.onStateChange?.(this.getState());
  }

  public reset(): void {
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = null;
    }

    for (const peer of this.peers.values()) {
      peer.close();
    }
    this.peers.clear();

    if (this.mediaSource) {
      this.mediaSource.release();
      this.mediaSource = null;
    }

    if (this.role === "HOST_SEED" && this.objectUrl) {
      try {
        URL.revokeObjectURL(this.objectUrl);
      } catch {}
    }

    this.chunker = null;
    this.cache = null;
    this.scheduler = null;
    this.manifest = null;
    this.objectUrl = null;
    this.role = "IDLE";
    this.notifyState();
  }
}
