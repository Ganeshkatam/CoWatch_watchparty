/**
 * LOCAL-MEDIA-001: Media Source Extensions (MSE) Playback Pipeline
 * Manages W3C MediaSource and SourceBuffer appending for continuous zero-copy playback.
 */

import { LocalMediaCache } from "./LocalMediaCache";
import { LocalMediaManifest } from "./LocalMediaManifest";

export class LocalMediaSource {
  private manifest: LocalMediaManifest;
  private cache: LocalMediaCache;
  private mediaSource: MediaSource | null = null;
  private sourceBuffer: SourceBuffer | null = null;
  private objectUrl: string | null = null;
  private isAppending: boolean = false;
  private appendQueue: Uint8Array[] = [];
  private appendedChunks: Set<number> = new Set();
  private isMseSupported: boolean = false;
  private onReadyCallback?: () => void;
  private onErrorCallback?: (err: Error) => void;

  constructor(manifest: LocalMediaManifest, cache: LocalMediaCache) {
    this.manifest = manifest;
    this.cache = cache;
    this.isMseSupported = typeof window !== "undefined" && "MediaSource" in window;
  }

  public async initialize(callbacks?: { onReady?: () => void; onError?: (err: Error) => void }): Promise<string> {
    this.onReadyCallback = callbacks?.onReady;
    this.onErrorCallback = callbacks?.onError;

    if (!this.isMseSupported) {
      throw new Error("MediaSource Extensions (MSE) is not supported in this browser.");
    }

    this.mediaSource = new MediaSource();
    this.objectUrl = URL.createObjectURL(this.mediaSource);

    this.mediaSource.addEventListener("sourceopen", () => {
      this.handleSourceOpen();
    });

    return this.objectUrl;
  }

  private handleSourceOpen(): void {
    if (!this.mediaSource || this.mediaSource.readyState !== "open") return;

    try {
      let mime = this.manifest.mimeType;
      if (!mime || mime === "video/mp4") {
        mime = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
      }

      if (!MediaSource.isTypeSupported(mime)) {
        if (MediaSource.isTypeSupported("video/mp4")) {
          mime = "video/mp4";
        } else if (MediaSource.isTypeSupported('video/webm; codecs="vp8, vorbis"')) {
          mime = 'video/webm; codecs="vp8, vorbis"';
        }
      }

      this.sourceBuffer = this.mediaSource.addSourceBuffer(mime);
      this.sourceBuffer.mode = "sequence";

      this.sourceBuffer.addEventListener("updateend", () => {
        this.isAppending = false;
        this.processNextAppend();
      });

      this.sourceBuffer.addEventListener("error", (e) => {
        console.warn("SourceBuffer error:", e);
        this.onErrorCallback?.(new Error("SourceBuffer decode error"));
      });

      this.onReadyCallback?.();
      this.pumpAvailableChunks();
    } catch (err: any) {
      console.warn("Failed to create SourceBuffer:", err);
      this.onErrorCallback?.(err);
    }
  }

  public pumpAvailableChunks(): void {
    if (!this.sourceBuffer || this.isAppending) return;

    const contiguous = this.cache.getContiguousCoverageFromStart();
    for (let i = 0; i < contiguous; i++) {
      if (!this.appendedChunks.has(i)) {
        const chunk = this.cache.getChunk(i);
        if (chunk) {
          this.appendQueue.push(chunk);
          this.appendedChunks.add(i);
        }
      }
    }

    this.processNextAppend();
  }

  private processNextAppend(): void {
    if (this.isAppending || !this.sourceBuffer || this.sourceBuffer.updating || this.appendQueue.length === 0) {
      return;
    }

    const nextChunk = this.appendQueue.shift();
    if (!nextChunk) return;

    try {
      this.isAppending = true;
      this.sourceBuffer.appendBuffer(nextChunk as unknown as BufferSource);
    } catch (err: any) {
      console.warn("Error appending buffer to SourceBuffer:", err);
      this.isAppending = false;
    }
  }

  public isReady(): boolean {
    return !!this.sourceBuffer && this.mediaSource?.readyState === "open";
  }

  public getObjectUrl(): string | null {
    return this.objectUrl;
  }

  public release(): void {
    this.appendQueue = [];
    this.appendedChunks.clear();

    if (this.sourceBuffer && this.mediaSource && this.mediaSource.readyState === "open") {
      try {
        this.mediaSource.removeSourceBuffer(this.sourceBuffer);
      } catch {}
    }
    this.sourceBuffer = null;

    if (this.objectUrl) {
      try {
        URL.revokeObjectURL(this.objectUrl);
      } catch {}
      this.objectUrl = null;
    }

    this.mediaSource = null;
  }
}
