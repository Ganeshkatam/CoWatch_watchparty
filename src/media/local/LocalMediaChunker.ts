/**
 * LOCAL-MEDIA-001: Local Media File Chunker
 * Efficiently slices local File/Blob objects into structured binary chunks on demand.
 */

import { LocalMediaChunk, LocalMediaChunkHeader, LocalMediaManifest, calculateTotalChunks, detectMediaContainer } from "./LocalMediaManifest";
import { cyrb53 } from "../../utils/hash";

export class LocalMediaChunker {
  private file: File | Blob;
  private filename: string;
  private mimeType: string;
  private chunkSize: number;
  private totalChunks: number;
  private mediaId: string;
  private epoch: number;
  private durationSeconds: number;
  private contentHash: string;
  private initSegmentLength: number;

  constructor(
    file: File | Blob,
    options?: {
      filename?: string;
      chunkSize?: number;
      mediaId?: string;
      epoch?: number;
      durationSeconds?: number;
    }
  ) {
    this.file = file;
    this.filename = options?.filename || (file instanceof File ? file.name : "local-media.mp4");
    this.mimeType = file.type || "video/mp4";
    this.chunkSize = options?.chunkSize || 131072; // 128 KB standard chunk size
    this.totalChunks = calculateTotalChunks(this.file.size, this.chunkSize);
    this.mediaId = options?.mediaId || `media_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    this.epoch = options?.epoch ?? 1;
    this.durationSeconds = options?.durationSeconds ?? 0;
    this.contentHash = `${this.file.size}_${cyrb53(this.filename)}`;
    this.initSegmentLength = Math.min(this.file.size, this.chunkSize * 2); // First 256KB typically houses MP4/WebM headers
  }

  public getManifest(roomId: string, ownerId: string): LocalMediaManifest {
    return {
      mediaId: this.mediaId,
      roomId,
      ownerId,
      filename: this.filename,
      byteLength: this.file.size,
      durationSeconds: this.durationSeconds,
      mimeType: this.mimeType,
      container: detectMediaContainer(this.filename, this.mimeType),
      codec: "",
      chunkSize: this.chunkSize,
      totalChunks: this.totalChunks,
      contentHash: this.contentHash,
      initializationSegmentByteLength: this.initSegmentLength,
      epoch: this.epoch,
      createdAt: Date.now(),
    };
  }

  public setDuration(duration: number): void {
    if (duration > 0) {
      this.durationSeconds = duration;
    }
  }

  public getMediaId(): string {
    return this.mediaId;
  }

  public getTotalChunks(): number {
    return this.totalChunks;
  }

  public getChunkSize(): number {
    return this.chunkSize;
  }

  public getFileSize(): number {
    return this.file.size;
  }

  public async getChunk(chunkIndex: number): Promise<LocalMediaChunk | null> {
    if (chunkIndex < 0 || chunkIndex >= this.totalChunks) {
      return null;
    }

    const start = chunkIndex * this.chunkSize;
    const end = Math.min(this.file.size, start + this.chunkSize);
    const slice = this.file.slice(start, end);
    const arrayBuffer = await slice.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    const header: LocalMediaChunkHeader = {
      mediaId: this.mediaId,
      chunkIndex,
      byteOffset: start,
      byteLength: data.byteLength,
      checksum: String(cyrb53(data.byteLength + "_" + chunkIndex)),
      epoch: this.epoch,
    };

    return {
      header,
      data,
    };
  }

  public async getInitSegment(): Promise<Uint8Array> {
    const slice = this.file.slice(0, this.initSegmentLength);
    const arrayBuffer = await slice.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }
}
