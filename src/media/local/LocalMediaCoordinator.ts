/**
 * LOCAL-MEDIA-001: Local Media Coordinator
 * Unified client coordinator integrating file chunking, WebRTC mesh peers, MSE playback, and MEDIA-SYNC-001 authority.
 */

import { Socket } from "socket.io-client";
import { LocalMediaCache } from "./LocalMediaCache";
import { LocalMediaChunker } from "./LocalMediaChunker";
import {
  LocalMediaManifest,
  normalizeLocalMediaManifest,
  validateLocalMediaManifest,
} from "./LocalMediaManifest";
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

export interface MediaCompatibilityProbeResult {
  compatible: boolean;
  duration: number;
  codec: string;
  error?: string;
}

export async function probeMediaCompatibility(
  file: File,
  chunkSize: number = 131072,
): Promise<MediaCompatibilityProbeResult> {
  if (
    typeof window === "undefined" ||
    typeof MediaSource === "undefined" ||
    typeof document === "undefined"
  ) {
    return {
      compatible: true,
      duration: 60,
      codec: 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
    };
  }

  let duration = 0;
  try {
    const tempVideo = document.createElement("video");
    tempVideo.preload = "metadata";
    const objectUrl = URL.createObjectURL(file);
    tempVideo.src = objectUrl;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            "Timeout probing video metadata (file took too long to parse)",
          ),
        );
      }, 5000);

      function cleanup() {
        clearTimeout(timeout);
        tempVideo.onloadedmetadata = null;
        tempVideo.onerror = null;
      }

      tempVideo.onloadedmetadata = () => {
        cleanup();
        duration = tempVideo.duration || 0;
        resolve();
      };
      tempVideo.onerror = () => {
        cleanup();
        reject(
          new Error("Browser video decoder failed to read media metadata"),
        );
      };
    });

    URL.revokeObjectURL(objectUrl);
  } catch (err: any) {
    return {
      compatible: false,
      duration: 0,
      codec: "",
      error: err?.message || "Failed to parse video metadata",
    };
  }

  if (duration <= 0 || !Number.isFinite(duration)) {
    return {
      compatible: false,
      duration: 0,
      codec: "",
      error: "Unable to detect a valid video duration for streaming",
    };
  }

  const lowerName = file.name.toLowerCase();
  const lowerMime = (file.type || "").toLowerCase();
  let candidateCodecs: string[] = [];

  if (lowerName.endsWith(".webm") || lowerMime.includes("webm")) {
    candidateCodecs = [
      'video/webm; codecs="vp9, opus"',
      'video/webm; codecs="vp8, opus"',
      'video/webm; codecs="vp8, vorbis"',
      "video/webm",
    ];
  } else {
    candidateCodecs = [
      'video/mp4; codecs="avc1.640028, mp4a.40.2"',
      'video/mp4; codecs="avc1.4d401f, mp4a.40.2"',
      'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
      'video/mp4; codecs="avc1.42E01E"',
      "video/mp4",
    ];
  }

  let selectedCodec = "";
  for (const candidate of candidateCodecs) {
    if (MediaSource.isTypeSupported(candidate)) {
      selectedCodec = candidate;
      break;
    }
  }

  if (!selectedCodec) {
    return {
      compatible: false,
      duration,
      codec: "",
      error:
        "No compatible MSE video codec found on this browser for this file container",
    };
  }

  try {
    const sandboxMs = new MediaSource();
    const sandboxUrl = URL.createObjectURL(sandboxMs);
    const sandboxVideo = document.createElement("video");
    sandboxVideo.src = sandboxUrl;

    const appendSucceeded = await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve(false);
      }, 4000);

      function cleanup() {
        clearTimeout(timeout);
        sandboxMs.removeEventListener("sourceopen", onSourceOpen);
        URL.revokeObjectURL(sandboxUrl);
      }

      async function onSourceOpen() {
        try {
          const sb = sandboxMs.addSourceBuffer(selectedCodec);
          sb.addEventListener(
            "updateend",
            () => {
              cleanup();
              resolve(true);
            },
            { once: true },
          );
          sb.addEventListener(
            "error",
            () => {
              cleanup();
              resolve(false);
            },
            { once: true },
          );

          const sliceLength = Math.min(file.size, chunkSize);
          const chunk0Slice = await file.slice(0, sliceLength).arrayBuffer();
          sb.appendBuffer(chunk0Slice);
        } catch {
          cleanup();
          resolve(false);
        }
      }

      sandboxMs.addEventListener("sourceopen", onSourceOpen);
    });

    if (!appendSucceeded) {
      return {
        compatible: false,
        duration,
        codec: selectedCodec,
        error:
          "Media is not formatted for direct MSE streaming (non-fragmented container). Please use WebRTC screenshare or convert to WebM/fMP4.",
      };
    }
  } catch (err: any) {
    return {
      compatible: false,
      duration,
      codec: selectedCodec,
      error: err?.message || "Sandbox append probe failed",
    };
  }

  return {
    compatible: true,
    duration,
    codec: selectedCodec,
  };
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
  private lastKnownTime: number = 0;
  private onStateChange?: (state: LocalMediaState) => void;

  constructor(
    socket: Socket,
    roomId: string,
    userId: string,
    onStateChange?: (state: LocalMediaState) => void,
  ) {
    this.socket = socket;
    this.roomId = roomId;
    this.userId = userId;
    this.onStateChange = onStateChange;

    this.setupSocketListeners();
  }

  private setupSocketListeners(): void {
    // 1. Session announcement received from server
    this.socket.on(
      "LOCAL_MEDIA_ANNOUNCE",
      (data: { manifest: unknown }) => {
        const normalized = normalizeLocalMediaManifest(data?.manifest);
        console.log("[LOCAL_MEDIA] LOCAL_MEDIA_ANNOUNCE received", {
          mediaId: normalized?.mediaId,
          myRole: this.role,
          myUserId: this.userId,
          ownerId: normalized?.ownerId,
        });
        if (normalized && normalized.roomId === this.roomId) {
          if (this.role !== "HOST_SEED") {
            this.handleParticipantManifest(normalized);
          }
        }
      },
    );

    // 2. WebRTC Peer Signaling
    this.socket.on(
      "LOCAL_MEDIA_SIGNAL",
      async (data: {
        fromPeerId: string;
        toPeerId: string;
        signal: any;
        epoch: number;
      }) => {
        console.log("[LOCAL_MEDIA] LOCAL_MEDIA_SIGNAL received", {
          fromPeerId: data.fromPeerId,
          toPeerId: data.toPeerId,
          isMe: data.toPeerId === this.userId,
          signalType:
            data.signal?.sdp?.type ||
            (data.signal?.candidate ? "candidate" : "unknown"),
        });
        if (data.toPeerId === this.userId) {
          let peer = this.peers.get(data.fromPeerId);
          if (!peer) {
            peer = this.createPeer(data.fromPeerId, false);
          }
          await peer.handleSignal(data.signal);
        }
      },
    );

    // 3. Session termination or unavailable
    this.socket.on("LOCAL_MEDIA_UNAVAILABLE", () => {
      this.reset();
    });
  }

  public async selectLocalFile(file: File): Promise<string> {
    this.reset();
    this.role = "HOST_SEED";

    // 0. Probe media compatibility gate before announcing
    const CHUNK_SIZE = 131072; // 128KB standard production chunk size
    const probe = await probeMediaCompatibility(file, CHUNK_SIZE);
    if (!probe.compatible) {
      throw new Error(
        probe.error ||
          "Selected media file is not compatible with Local Media streaming",
      );
    }

    // 1. Initialize Chunker with verified duration and codec
    this.chunker = new LocalMediaChunker(file, {
      filename: file.name,
      chunkSize: CHUNK_SIZE,
      durationSeconds: probe.duration,
      codec: probe.codec,
    });
    await this.chunker.initializeFingerprint();

    this.manifest = this.chunker.getManifest(this.roomId, this.userId);

    // 2. Host directly creates an Object URL from local file for instant zero-copy playback
    this.objectUrl = URL.createObjectURL(file);

    // 3. Cache only initial header chunks (first 2 chunks, ~256KB) for fast startup.
    // Remaining chunks are read from disk on-demand via chunker in handleChunkRequested.
    this.cache = new LocalMediaCache(this.manifest, 500);
    const initChunksToPreload = Math.min(2, this.manifest.totalChunks);
    for (let i = 0; i < initChunksToPreload; i++) {
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

  public async handleParticipantManifest(
    manifest: LocalMediaManifest,
  ): Promise<string | null> {
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

  private createPeer(
    targetPeerId: string,
    isInitiator: boolean,
  ): LocalMediaPeer {
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
      },
    );

    this.peers.set(targetPeerId, peer);
    this.scheduler?.registerPeer(peer);
    return peer;
  }

  private handleChunkReceived(chunkIndex: number, data: Uint8Array): void {
    if (!this.cache || !this.manifest) return;

    console.log("[LOCAL_MEDIA] chunk received", {
      chunkIndex,
      bytes: data.byteLength,
    });

    this.cache.putChunk(chunkIndex, data);
    this.scheduler?.onChunkReceived(chunkIndex);

    // Feed MSE buffer
    this.mediaSource?.pumpAvailableChunks();

    console.log("[LOCAL_MEDIA] MSE pump", {
      available: this.cache.getAvailableChunks().length,
    });

    // Broadcast our updated availability to all connected peers for mesh relay
    const available = this.cache.getAvailableChunks();
    for (const peer of this.peers.values()) {
      peer.broadcastAvailability(
        this.manifest.mediaId,
        this.manifest.epoch,
        available,
      );
    }

    this.notifyState();
  }

  private async handleChunkRequested(
    requesterId: string,
    chunkIndices: number[],
  ): Promise<void> {
    console.log("[LOCAL_MEDIA] chunk request", {
      requesterId,
      chunkIndices,
    });
    const peer = this.peers.get(requesterId);
    if (!peer) return;

    for (const idx of chunkIndices) {
      let chunkData = this.cache?.getChunk(idx);
      if (!chunkData && this.chunker) {
        const chunk = await this.chunker.getChunk(idx);
        if (chunk) {
          chunkData = chunk.data;
          this.cache?.putChunk(idx, chunkData);
        }
      }
      if (chunkData) {
        console.log("[LOCAL_MEDIA] sending chunk", {
          requesterId,
          chunkIndex: idx,
          bytes: chunkData.byteLength,
        });
        const sent = peer.sendChunk(idx, chunkData);
        if (!sent) break; // Backpressure reached
      }
    }
  }

  private startSchedulerLoop(): void {
    if (this.scheduleTimer) clearInterval(this.scheduleTimer);
    this.scheduleTimer = setInterval(() => {
      if (this.scheduler && this.manifest) {
        console.log("[LOCAL_MEDIA] scheduling", {
          time: this.lastKnownTime,
          inFlight: this.scheduler?.getInFlightCount(),
          available: this.cache?.getAvailableChunks().length,
        });
        this.scheduler.schedule(this.lastKnownTime);
      }
    }, 250);
  }

  public notifyTimelineTick(currentSeconds: number): void {
    this.lastKnownTime = currentSeconds;
    if (this.scheduler && this.role === "PARTICIPANT_PEER") {
      this.scheduler.schedule(currentSeconds);
    }
  }

  public getState(): LocalMediaState {
    const total = this.manifest?.totalChunks || 1;
    const available =
      this.role === "HOST_SEED"
        ? total
        : this.cache?.getAvailableChunks().length || 0;
    const bufferedPercent = Math.min(
      100,
      Math.round((available / total) * 100),
    );

    return {
      role: this.role,
      manifest: this.manifest,
      objectUrl: this.objectUrl,
      bufferedPercent,
      inFlightRequests: this.scheduler?.getInFlightCount() ?? 0,
      peersCount: this.peers.size,
      isReady:
        this.role === "HOST_SEED"
          ? !!this.objectUrl
          : (this.mediaSource?.isReady() ?? false),
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
    this.lastKnownTime = 0;
    this.role = "IDLE";
    this.notifyState();
  }
}
